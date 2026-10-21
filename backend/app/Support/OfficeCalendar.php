<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

class OfficeCalendar
{
    public static function defaults(): array
    {
        $names = [
            '01-01' => "New Year's Day", '02-17' => 'Chinese New Year', '03-20' => 'Eid’l Fitr',
            '04-02' => 'Maundy Thursday', '04-03' => 'Good Friday', '04-04' => 'Black Saturday',
            '04-09' => 'Araw ng Kagitingan', '05-01' => 'Labor Day', '05-27' => 'Eid’l Adha',
            '06-12' => 'Independence Day', '08-21' => 'Ninoy Aquino Day', '08-31' => 'National Heroes Day',
            '11-01' => 'All Saints’ Day', '11-02' => 'All Souls’ Day', '11-30' => 'Bonifacio Day',
            '12-08' => 'Feast of the Immaculate Conception of Mary', '12-24' => 'Christmas Eve',
            '12-25' => 'Christmas Day', '12-30' => 'Rizal Day', '12-31' => 'Last Day of the Year',
        ];
        $days = [];
        foreach ($names as $date => $name) $days['2026-'.$date] = ['type' => 'holiday', 'name' => $name];
        return ['revision' => 0, 'weekly' => array_map(fn ($i) => ['open' => $i > 0 && $i < 6, 'start' => '08:00', 'end' => '17:00'], range(0, 6)),
            'lunch' => ['enabled' => true, 'start' => '12:00', 'end' => '13:00'], 'days' => $days];
    }

    public static function get(): array
    {
        return json_decode(DB::table('office_calendar')->where('id', 1)->value('payload'), true);
    }

    public static function intervals(string $date, array $calendar): array
    {
        $weekly = $calendar['weekly'][CarbonImmutable::parse($date, 'Asia/Manila')->dayOfWeek];
        $day = $calendar['days'][$date] ?? null;
        if ($day && in_array($day['type'], ['closed', 'holiday'])) return [];
        if (!$day && !$weekly['open']) return [];
        $start = $day['start'] ?? $weekly['start']; $end = $day['end'] ?? $weekly['end'];
        $lunch = $calendar['lunch'];
        if (!$lunch['enabled'] || $lunch['end'] <= $start || $lunch['start'] >= $end) return [[$start, $end]];
        return array_values(array_filter([[$start, min($end, $lunch['start'])], [max($start, $lunch['end']), $end]], fn ($range) => $range[0] < $range[1]));
    }

    public static function status(?CarbonImmutable $now = null, ?array $calendar = null): array
    {
        $now = ($now ?? CarbonImmutable::now('Asia/Manila'))->setTimezone('Asia/Manila');
        $calendar ??= self::get(); $date = $now->toDateString(); $time = $now->format('H:i');
        $ranges = self::intervals($date, $calendar);
        $open = count(array_filter($ranges, fn ($r) => $time >= $r[0] && $time < $r[1])) > 0;
        $exception = $calendar['days'][$date] ?? null;
        $weekly = $calendar['weekly'][$now->dayOfWeek];
        $dayOpen = $exception ? in_array($exception['type'], ['open', 'special']) : $weekly['open'];
        $start = $exception['start'] ?? $weekly['start']; $end = $exception['end'] ?? $weekly['end'];
        $lunch = $dayOpen && $calendar['lunch']['enabled'] && $time >= $calendar['lunch']['start'] && $time < $calendar['lunch']['end'] && $time >= $start && $time < $end;
        $reason = $open ? 'Open now' : ($lunch ? 'Closed for lunch' : (!$dayOpen ? 'Closed today, '.($exception['name'] ?? 'Weekend') : 'Closed outside daily hours'));
        $next = null;
        if (!$open) for ($i = 0; $i < 370 && !$next; $i++) {
            $day = $now->startOfDay()->addDays($i);
            foreach (self::intervals($day->toDateString(), $calendar) as [$a]) {
                $candidate = CarbonImmutable::parse($day->toDateString().' '.$a, 'Asia/Manila');
                if ($candidate > $now) { $next = $candidate->toIso8601String(); break; }
            }
        }
        return ['open' => $open, 'reason' => $reason, 'nextOpening' => $next];
    }
}
