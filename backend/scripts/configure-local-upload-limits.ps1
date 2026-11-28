param(
    [string]$PhpIni = 'C:\tools\php85\php.ini',
    [string]$MysqlIni = 'C:\xampp1\mysql\bin\my.ini'
)
$ErrorActionPreference = 'Stop'
$php = [IO.File]::ReadAllText($PhpIni)
$mysql = [IO.File]::ReadAllText($MysqlIni)
foreach ($name in @('memory_limit','post_max_size','upload_max_filesize')) {
    if ([regex]::Matches($php, "(?m)^\s*$name\s*=.*$").Count -ne 1) { throw "Expected exactly one active $name setting in PHP configuration." }
}
$match = [regex]::Match($mysql, '(?ms)^\[mysqld\]\s*\r?\n(?<body>.*?)(?=^\[|\z)')
if (-not $match.Success -or [regex]::Matches($match.Groups['body'].Value, '(?m)^\s*max_allowed_packet\s*=.*$').Count -ne 1) { throw 'Expected exactly one max_allowed_packet setting in the mysqld section.' }
$backupDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'storage\app\private\server-config-backups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-ffff'
[IO.File]::WriteAllText((Join-Path $backupDir "php-$stamp.ini"), $php)
[IO.File]::WriteAllText((Join-Path $backupDir "mysql-$stamp.ini"), $mysql)
$php = [regex]::Replace($php, '(?m)^\s*memory_limit\s*=.*$', 'memory_limit = 512M')
$php = [regex]::Replace($php, '(?m)^\s*post_max_size\s*=.*$', 'post_max_size = 64M')
$php = [regex]::Replace($php, '(?m)^\s*upload_max_filesize\s*=.*$', 'upload_max_filesize = 64M')
$updatedSection = [regex]::Replace($match.Value, '(?m)^\s*max_allowed_packet\s*=.*$', 'max_allowed_packet=128M')
$mysql = $mysql.Substring(0, $match.Index) + $updatedSection + $mysql.Substring($match.Index + $match.Length)
[IO.File]::WriteAllText($PhpIni, $php)
[IO.File]::WriteAllText($MysqlIni, $mysql)
Write-Output 'Configuration updated; restart the PHP API and MySQL before verifying the limits. Original configurations were saved in private server-config-backups.'
