<?php
namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\{DB, Crypt};

class AppointmentSlots
{
    public static function offices(): array
    {
        return VisitFlow::settings()['appointmentOffices'] ?? ['Office of Student Services'];
    }

    public static function slots(string $date, string $office, ?string $except = null): array
    {
        return array_values(array_map(fn ($slot) => $slot['time'], array_filter(self::availability($date, $office, $except), fn ($slot) => $slot['available'])));
    }

    public static function availability(string $date, string $office, ?string $except = null): array
    {
        abort_unless(in_array($office, self::offices(), true), 422, 'Choose an available office.');
        $counts = [];
        $query = DB::table('shared_appointments')->where('date', $date)->whereIn('status', ['Requested', 'Booked', 'Checked-in']);
        if ($except) $query->where('id', '!=', $except);
        foreach ($query->get() as $row) {
            $payload = json_decode(Crypt::decryptString($row->payload), true);
            if (($payload['office'] ?? 'Office of Student Services') === $office) {
                $counts[$row->time] ??= ['pending' => 0, 'confirmed' => 0];
                $counts[$row->time][$row->status === 'Requested' ? 'pending' : 'confirmed']++;
            }
        }
        $capacity = max(1, (int)(VisitFlow::settings()['appointmentSlotCapacity'] ?? 1));
        $slots = [];
        foreach (OfficeCalendar::intervals($date, OfficeCalendar::get()) as [$start, $end]) {
            $at = CarbonImmutable::parse($date.' '.$start, 'Asia/Manila');
            $until = CarbonImmutable::parse($date.' '.$end, 'Asia/Manila');
            while ($at->addMinutes(30) <= $until) {
                $time = $at->format('H:i');
                $occupied = 0; $pending = 0; $confirmed = 0;
                foreach ($counts as $reservedTime => $count) {
                    $reserved = CarbonImmutable::parse($date.' '.$reservedTime, 'Asia/Manila');
                    if ($reserved < $at->addMinutes(30) && $reserved->addMinutes(30) > $at) {
                        $pending += $count['pending']; $confirmed += $count['confirmed'];
                    }
                }
                $occupied = $pending + $confirmed;
                $past = $at <= CarbonImmutable::now('Asia/Manila');
                $slots[] = ['time' => $time, 'capacity' => $capacity, 'occupied' => $occupied, 'pending' => $pending, 'confirmed' => $confirmed,
                    'remaining' => max(0, $capacity - $occupied), 'available' => !$past && $occupied < $capacity,
                    'status' => $past ? 'past' : ($occupied >= $capacity ? 'full' : 'available')];
                $at = $at->addMinutes(30);
            }
        }
        return $slots;
    }

    // Call while holding the office_calendar row lock, shared by booking and calendar updates.
    public static function reserve(string $date, string $time, string $office, ?string $except = null): void
    {
        abort_unless(in_array($time, self::slots($date, $office, $except), true), 409, 'This slot is unavailable. Refresh availability and choose another time.');
    }
}
