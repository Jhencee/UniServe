param([string]$PhpPath='C:\tools\php85\php.exe')
$taskBackend = Split-Path -Parent $PSScriptRoot
$taskArtisan = Join-Path $taskBackend 'artisan'
$taskLock = New-Object System.Threading.Mutex($false, 'Local\UniServeBackgroundServices')
if (-not $taskLock.WaitOne(0)) { exit }
$taskCommands = @(
 @{Name='worker'; Match='queue:work.*mail-verification'; Args=@($taskArtisan,'queue:work','--queue=mail-verification,realtime,default','--sleep=1','--tries=2','--timeout=60')},
 @{Name='reverb'; Match='reverb:start'; Args=@($taskArtisan,'reverb:start','--host=127.0.0.1','--port=8080')},
 @{Name='scheduler'; Match='schedule:work'; Args=@($taskArtisan,'schedule:work')}
)
try {
 while ($true) {
  $taskProcesses=Get-CimInstance Win32_Process -Filter "Name = 'php.exe'"
  foreach ($taskService in $taskCommands) {
   $taskRunning=$taskProcesses | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($taskBackend) -and $_.CommandLine -match $taskService.Match }
   if (-not $taskRunning) { Start-Process -FilePath $PhpPath -ArgumentList $taskService.Args -WorkingDirectory $taskBackend -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskBackend ("storage\logs\"+$taskService.Name+"-service.log")) -RedirectStandardError (Join-Path $taskBackend ("storage\logs\"+$taskService.Name+"-service-error.log")) }
  }
  Start-Sleep -Seconds 15
 }
} finally { $taskLock.ReleaseMutex(); $taskLock.Dispose() }
