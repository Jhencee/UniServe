param([string]$PhpPath='C:\tools\php85\php.exe')
$previewBackend=Split-Path -Parent $PSScriptRoot
$previewNode=(Get-Command node.exe).Source
# Official Cloudflare development keys, limited to the new backend process.
$previewOverrides=@{
 TURNSTILE_ENABLED='true'
 TURNSTILE_SITE_KEY='1x00000000000000000000AA'
 TURNSTILE_SECRET_KEY='1x0000000000000000000000000000000AA'
 TURNSTILE_HOSTNAMES=' '
 APP_CONFIG_CACHE=(Join-Path $previewBackend 'storage\app\mobile-preview-no-cache.php')
 MOBILE_PREVIEW_API_PORT='8002'
}
$previewOriginal=@{}
try {
 foreach($previewName in $previewOverrides.Keys){$previewOriginal[$previewName]=[Environment]::GetEnvironmentVariable($previewName,'Process');[Environment]::SetEnvironmentVariable($previewName,$previewOverrides[$previewName],'Process')}
 $previewApi=Start-Process -FilePath $PhpPath -ArgumentList @('artisan','serve','--host=127.0.0.1','--port=8002','--no-reload') -WorkingDirectory $previewBackend -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $previewBackend 'storage\logs\mobile-api.log') -RedirectStandardError (Join-Path $previewBackend 'storage\logs\mobile-api-error.log')
 $previewWeb=Start-Process -FilePath $previewNode -ArgumentList @('scripts/mobile-preview.cjs') -WorkingDirectory $previewBackend -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $previewBackend 'storage\logs\mobile-preview.log') -RedirectStandardError (Join-Path $previewBackend 'storage\logs\mobile-preview-error.log')
 Write-Output "Mobile preview PID: $($previewWeb.Id); test API PID: $($previewApi.Id)"
} finally {
 foreach($previewName in $previewOverrides.Keys){[Environment]::SetEnvironmentVariable($previewName,$previewOriginal[$previewName],'Process')}
}
