<?php

namespace App\Http\Controllers;

use App\Support\OfficeCalendar;
use App\Support\StaffAuth;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class CalendarController extends Controller
{
    public function index()
    {
        return response()->json(['calendar' => OfficeCalendar::get(), 'status' => OfficeCalendar::status()]);
    }

    public function update(Request $request)
    {
        $actor = StaffAuth::user($request, 'ADMIN');
        $data = $request->validate([
            'calendar' => ['required', 'array:revision,weekly,lunch,days'],
            'calendar.revision' => ['required', 'integer', 'min:0'],
            'calendar.weekly' => ['required', 'array', 'size:7'],
            'calendar.weekly.*' => ['required', 'array:open,start,end'],
            'calendar.weekly.*.open' => ['required', 'boolean'],
            'calendar.weekly.*.start' => ['required', 'date_format:H:i'],
            'calendar.weekly.*.end' => ['required', 'date_format:H:i'],
            'calendar.lunch' => ['required', 'array:enabled,start,end'],
            'calendar.lunch.enabled' => ['required', 'boolean'],
            'calendar.lunch.start' => ['required', 'date_format:H:i'],
            'calendar.lunch.end' => ['required', 'date_format:H:i'],
            'calendar.days' => ['present', 'array', 'max:5000'],
            'calendar.days.*' => ['required', 'array:type,name,start,end'],
            'calendar.days.*.type' => ['required', 'in:open,closed,holiday,special'],
            'calendar.days.*.name' => ['nullable', 'string', 'max:200'],
            'calendar.days.*.start' => ['required_if:calendar.days.*.type,special', 'date_format:H:i'],
            'calendar.days.*.end' => ['required_if:calendar.days.*.type,special', 'date_format:H:i'],
            'effects' => ['required', 'array:affected,decision'],
            'effects.affected' => ['required', 'integer', 'min:0'],
            'effects.decision' => ['required', 'in:keep,review'],
        ]);
        $calendar = $data['calendar'];
        if (!array_is_list($calendar['weekly'])) throw ValidationException::withMessages(['calendar' => 'Weekly schedule must be ordered Sunday through Saturday.']);
        foreach (array_merge($calendar['weekly'], [$calendar['lunch']], array_values($calendar['days'])) as $range) {
            if (isset($range['start'], $range['end']) && $range['start'] >= $range['end']) throw ValidationException::withMessages(['calendar' => 'Closing time must be after opening time.']);
            if (in_array($range['type'] ?? '', ['closed', 'holiday']) && empty(trim($range['name'] ?? ''))) throw ValidationException::withMessages(['calendar' => 'A closure reason or holiday name is required.']);
        }
        foreach (array_keys($calendar['days']) as $date) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !checkdate((int)substr($date, 5, 2), (int)substr($date, 8, 2), (int)substr($date, 0, 4))) throw ValidationException::withMessages(['calendar' => 'Invalid calendar date.']);
        }
        $result = DB::transaction(function () use ($calendar, $data, $actor) {
            $row = DB::table('office_calendar')->where('id', 1)->lockForUpdate()->first();
            $before = json_decode($row->payload, true);
            abort_unless($calendar['revision'] === $before['revision'], 409, 'Another Admin changed the calendar. Reload it and try again.');
            if(\Illuminate\Support\Facades\Schema::hasTable('shared_appointments')){
                $affected=0;$affectedRows=[];
                foreach(DB::table('shared_appointments')->where('status','Booked')->whereNotNull('date')->get() as $appointment){
                    $at=\Carbon\CarbonImmutable::parse($appointment->date.' '.$appointment->time,'Asia/Manila');
                    if($at->isPast())continue;
                    if(OfficeCalendar::status($at,$before)['open']&&!OfficeCalendar::status($at,$calendar)['open']){$affected++;$affectedRows[]=$appointment;}
                }
                abort_unless($data['effects']['affected']===$affected,409,'Affected bookings changed. Reload Calendar before confirming this change.');
                $data['effects']['affected']=$affected;
                foreach($affectedRows as $appointment){
                    $payload=AppointmentController::present($appointment);$payload['calendarReview']=true;
                    if($data['effects']['decision']==='review'){$payload['rescheduleRequested']=true;$payload['rescheduleReason']='Office calendar changed; confirm a new open time.';}
                    DB::table('shared_appointments')->where('id',$appointment->id)->update(['payload'=>\Illuminate\Support\Facades\Crypt::encryptString(json_encode($payload)),'revision'=>$appointment->revision+1,'updated_at'=>now()]);
                    \App\Support\AppointmentNotifications::calendarChange(DB::table('shared_appointments')->where('id',$appointment->id)->first());
                }
            }
            $calendar['revision']++;
            DB::table('office_calendar')->where('id', 1)->update(['payload' => json_encode($calendar)]);
            $id = DB::table('calendar_audit')->insertGetId(['actor_id' => $actor->id, 'actor_name' => $actor->full_name,
                'before' => json_encode($before), 'after' => json_encode($calendar), 'effects' => json_encode($data['effects']), 'created_at' => now()]);
            return ['calendar' => $calendar, 'auditId' => $id];
        });
        return response()->json($result);
    }

    public function audit(Request $request)
    {
        StaffAuth::user($request, 'SUPER_ADMIN');
        return response()->json(['entries' => DB::table('calendar_audit')->orderByDesc('id')->limit(500)->get()->map(function ($row) {
            foreach (['before', 'after', 'effects'] as $key) $row->$key = json_decode($row->$key, true);
            return $row;
        })]);
    }
}
