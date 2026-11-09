$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Push-Location $projectRoot
try {
    $uiTests = @(Get-ChildItem -LiteralPath 'backend/tests/ui' -Filter '*.test.cjs' | ForEach-Object FullName)
    & node --test --test-isolation=none @uiTests
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript flow tests failed.' }
    # Enable the installed SQLite drivers for this process without changing php.ini.
    $phpOptions = @()
    $loaded = & php -m
    if ($loaded -notcontains 'pdo_sqlite') { $phpOptions += @('-d', 'extension=pdo_sqlite') }
    if ($loaded -notcontains 'sqlite3') { $phpOptions += @('-d', 'extension=sqlite3') }
    Push-Location 'backend'
    try {
        & php @phpOptions vendor/bin/pest --compact
        if ($LASTEXITCODE -ne 0) { throw 'Backend flow tests failed.' }
    } finally { Pop-Location }
} finally { Pop-Location }
