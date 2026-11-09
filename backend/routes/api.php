<?php

use App\Http\Controllers\StaffLoginController;
use App\Http\Controllers\AdminManagementController;
use App\Http\Controllers\QueueController;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\CalendarController;
use App\Http\Controllers\AuditController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\VisitorHistoryController;
use App\Http\Controllers\ConfidentialAccessController;
use App\Http\Controllers\AppointmentController;
use App\Http\Controllers\SharedFlowController;
Route::get('/realtime/config',[\App\Http\Controllers\RealtimeController::class,'config'])->middleware('throttle:60,1,realtime-config');
Route::post('/realtime/auth',[\App\Http\Controllers\RealtimeController::class,'auth'])->middleware('throttle:60,1,realtime-auth');
Route::post('/import-browser',[\App\Http\Controllers\LegacyImportController::class,'store'])->middleware('throttle:5,1,api-route-1');
Route::get('/public-queue',[SharedFlowController::class,'publicQueue'])->middleware('throttle:120,1,api-route-2');
Route::get('/settings',[SharedFlowController::class,'settings']);
Route::get('/attention',[\App\Http\Controllers\AttentionController::class,'index'])->middleware('throttle:60,1,attention');
Route::get('/reports',[SharedFlowController::class,'reports'])->middleware('throttle:30,1,api-route-3');
Route::post('/report-data',[\App\Http\Controllers\ReportDataController::class,'snapshot'])->middleware('throttle:30,1,report-output');
Route::get('/backup',[SharedFlowController::class,'backup'])->middleware('throttle:5,1,api-route-4');
Route::post('/backup/preview',[\App\Http\Controllers\BackupController::class,'preview'])->middleware('throttle:5,1');
Route::post('/backup/restore',[\App\Http\Controllers\BackupController::class,'restore'])->middleware('throttle:5,1');
Route::put('/settings',[SharedFlowController::class,'saveSettings'])->middleware('throttle:20,1,api-route-5');
Route::get('/chats',[SharedFlowController::class,'chats'])->middleware('throttle:120,1,api-route-6');
Route::post('/chats',[SharedFlowController::class,'createChat'])->middleware('throttle:10,1,api-route-7');
Route::get('/chats/{id}',[SharedFlowController::class,'chat'])->middleware('throttle:120,1,api-route-8');
Route::post('/chats/{id}/messages',[SharedFlowController::class,'message'])->middleware('throttle:30,1,api-route-9');
Route::post('/chats/{id}/read',[SharedFlowController::class,'readChat'])->middleware('throttle:120,1,api-route-10');
Route::patch('/chats/{id}',[SharedFlowController::class,'manageChat'])->middleware('throttle:30,1,api-route-11');
Route::delete('/chats/{id}',[SharedFlowController::class,'deleteChat'])->middleware('throttle:10,1,api-route-12');
Route::post('/queue/{id}/feedback',[SharedFlowController::class,'feedback'])->middleware('throttle:10,1,api-route-13');
Route::get('/services', [AppointmentController::class,'services']);
Route::put('/services/{key}', [AppointmentController::class,'saveService']);
Route::delete('/services/{key}', [AppointmentController::class,'deleteService']);
Route::get('/service-records', [\App\Http\Controllers\ServiceRecordController::class,'index']);
Route::patch('/service-records/{id}', [\App\Http\Controllers\ServiceRecordController::class,'update'])->middleware('throttle:30,1,api-route-14');
Route::get('/appointment-offices', [AppointmentController::class,'offices']);
Route::get('/appointment-slots', [AppointmentController::class,'slots'])->middleware('throttle:60,1,appointment-slots');
Route::get('/appointments', [AppointmentController::class,'index']);
Route::post('/appointments', [AppointmentController::class,'store'])->middleware('throttle:10,1,api-route-15');
Route::get('/appointments/visit/{visitId}', [AppointmentController::class,'show'])->middleware('throttle:30,1,api-route-16');
Route::patch('/appointments/{id}/documents/{index}', [AppointmentController::class,'reviewDocument'])->middleware('throttle:30,1,document-review');
Route::patch('/appointments/{id}', [AppointmentController::class,'update'])->middleware('throttle:30,1,api-route-17');
Route::post('/appointments/{id}/check-in', [AppointmentController::class,'checkIn'])->middleware('throttle:20,1,api-route-18');
Route::post('/appointments/{id}/reschedule-request', [AppointmentController::class,'requestReschedule'])->middleware('throttle:10,1,reschedule-request');
Route::post('/appointments/{id}/cancel', [AppointmentController::class,'cancel'])->middleware('throttle:20,1,api-route-19');
Route::get('/confidential', [ConfidentialAccessController::class,'index']);
Route::get('/confidential/notifications', [ConfidentialAccessController::class,'notifications'])->middleware('throttle:60,1,head-access-notifications');
Route::get('/confidential/approvals', [ConfidentialAccessController::class,'approvals'])->middleware('throttle:60,1,admin-access-approvals');
Route::get('/confidential/cases/{id}/status', [ConfidentialAccessController::class,'status']);
Route::get('/confidential/cases/{id}/history', [ConfidentialAccessController::class,'history']);
Route::post('/confidential/cases', [ConfidentialAccessController::class,'register'])->middleware('throttle:60,1,api-route-20');
Route::patch('/confidential/cases/{id}', [ConfidentialAccessController::class,'assign']);
Route::post('/confidential/requests', [ConfidentialAccessController::class,'store'])->middleware('throttle:20,1,api-route-21');
Route::patch('/confidential/requests/{id}', [ConfidentialAccessController::class,'review']);
Route::post('/confidential/cases/{id}/unlock', [ConfidentialAccessController::class,'unlock'])->middleware('throttle:10,1,api-route-22');

Route::post('/history/code', [VisitorHistoryController::class,'send'])->middleware('throttle:5,1,api-route-23');
Route::post('/history/verify', [VisitorHistoryController::class,'verify'])->middleware('throttle:15,1,api-route-24');

Route::get('/audit', [AuditController::class, 'index'])->middleware('throttle:120,1,api-route-25');
Route::post('/audit', [AuditController::class, 'store'])->middleware('throttle:120,1,api-route-26');
Route::get('/notifications', [NotificationController::class, 'index'])->middleware('throttle:60,1,api-route-27');
Route::post('/notifications', [NotificationController::class, 'store'])->middleware('throttle:20,1,api-route-28');
Route::delete('/notifications', [NotificationController::class, 'cancel'])->middleware('throttle:20,1,api-route-29');
Route::post('/notifications/cancel-token', [NotificationController::class,'cancelToken'])->middleware('throttle:20,1,api-route-30');

Route::get('/calendar', [CalendarController::class, 'index']);
Route::put('/calendar', [CalendarController::class, 'update'])->middleware('throttle:60,1,api-route-31');
Route::get('/calendar/audit', [CalendarController::class, 'audit'])->middleware('throttle:60,1,api-route-32');

Route::post('/login', StaffLoginController::class)->middleware('throttle:60,1,staff-login-ip');
Route::get('/login/challenge',[StaffLoginController::class,'challenge'])->middleware('throttle:60,1');
Route::post('/logout',[StaffLoginController::class,'logout'])->middleware('throttle:30,1,api-route-34');
Route::post('/password', [StaffLoginController::class, 'changePassword'])->middleware('throttle:10,1,api-route-35');
Route::post('/password/confirm', [StaffLoginController::class, 'confirmPassword'])->middleware('throttle:5,1,staff-password-confirm');
Route::patch('/profile', [StaffLoginController::class, 'profile'])->middleware('throttle:10,1,api-route-36');
Route::match(['GET', 'POST'], '/admins', [AdminManagementController::class, 'handle'])->middleware('throttle:60,1,api-route-37');
Route::match(['PATCH', 'DELETE'], '/admins/{id}', [AdminManagementController::class, 'handle'])->middleware('throttle:60,1,api-route-38');
Route::post('/visits', [QueueController::class, 'create'])->middleware('throttle:20,1,api-route-39');
Route::get('/visits/{visitId}', [QueueController::class, 'visit'])->middleware('throttle:120,1,api-route-40');
Route::post('/visits/{visitId}/cancel', [QueueController::class, 'cancel'])->middleware('throttle:20,1,api-route-41');
Route::get('/queue', [QueueController::class, 'index'])->middleware('throttle:120,1,api-route-42');
Route::post('/queue/call-next', [QueueController::class,'callNext'])->middleware('throttle:30,1,api-route-43');
Route::patch('/queue/{id}/requirements', [QueueController::class,'checkRequirement'])->middleware('throttle:60,1,queue-requirements');
Route::post('/queue/{id}/follow-up', [QueueController::class,'followUp'])->middleware('throttle:20,1,queue-follow-up');
Route::patch('/queue/{id}', [QueueController::class, 'update'])->middleware('throttle:120,1,api-route-44');

Route::post('/password/reset-code', [\App\Http\Controllers\StaffPasswordResetController::class,'send'])->middleware('throttle:5,1,staff-reset-send');
Route::post('/password/verify-reset-code', [\App\Http\Controllers\StaffPasswordResetController::class,'verify'])->middleware('throttle:10,1,staff-reset-verify');
Route::post('/password/reset', [\App\Http\Controllers\StaffPasswordResetController::class,'reset'])->middleware('throttle:10,1,staff-reset-verify');

Route::get('/public-feedback',[SharedFlowController::class,'publicFeedback'])->middleware('throttle:60,1,public-feedback');

Route::get('/walk-in-capacity',[\App\Http\Controllers\WalkInCapacityController::class,'show'])->middleware('throttle:60,1,walkin-capacity');
Route::post('/walk-in-capacity/override',[\App\Http\Controllers\WalkInCapacityController::class,'override'])->middleware('throttle:10,1,walkin-override');

Route::post('/history/session', function(\Illuminate\Http\Request $request) {
 $data=$request->validate(['email'=>'required|email|max:120']);
 \App\Support\VisitorAccess::requireEmail($request,$data['email']);
 return response()->json(['verified'=>true]);
})->middleware('throttle:30,1,visitor-email-session');

Route::patch('/appointments/{id}/waitlist', [\App\Http\Controllers\VisitEnhancementController::class,'preferences'])->middleware('throttle:20,1,visit-waitlist');
Route::patch('/appointments/{id}/follow-up-task', [\App\Http\Controllers\VisitEnhancementController::class,'task'])->middleware('throttle:30,1,visit-task');

Route::get('/history', [VisitorHistoryController::class,'records'])->middleware('throttle:30,1,visitor-history-records');

Route::put('/appointments/{id}/documents/{index}', [AppointmentController::class,'replaceDocument'])->middleware('throttle:10,1,document-replacement');
Route::get('/appointments/{id}/document-history', function(\Illuminate\Http\Request $request,string $id) {
 \App\Support\StaffAuth::user($request,'ADMIN');
 $row=\Illuminate\Support\Facades\DB::table('shared_appointments')->where('id',$id)->first();abort_unless($row,404);
 (new AppointmentController)->access($request,$row);
 $a=json_decode(\Illuminate\Support\Facades\Crypt::decryptString($row->payload),true);
 return response()->json(['versions'=>$a['documentVersions']??[]]);
})->middleware('throttle:30,1,document-history');

Route::get('/task-owners', function(\Illuminate\Http\Request $request) {
 \App\Support\StaffAuth::user($request,'ADMIN');
 return response()->json(['owners'=>\Illuminate\Support\Facades\DB::table('staff_users')->where('role','ADMIN')->where('is_active',true)->orderBy('full_name')->get(['id','full_name'])]);
})->middleware('throttle:60,1,task-owners');
