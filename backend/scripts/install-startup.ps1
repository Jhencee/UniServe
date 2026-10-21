$taskScript=Join-Path $PSScriptRoot 'run-services.ps1'
$taskUser=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAction=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "'+$taskScript+'"')
$taskTrigger=New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$taskSettings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'UniServe Background Services' -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Description 'Supervises UniServe mail, scheduler and realtime processes.' -Force
Start-ScheduledTask -TaskName 'UniServe Background Services'
