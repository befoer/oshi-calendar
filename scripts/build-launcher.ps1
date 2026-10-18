$ErrorActionPreference = 'Stop'
$launcherRoot = Split-Path -Parent $PSScriptRoot
$launcherCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $launcherCompiler)) {
    $launcherCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $launcherCompiler)) { throw 'Windows .NET Framework 4.x compiler was not found.' }

# launcher.ico is generated with the other app icons by `npm run icons` (multi-size, from public/icon.svg).
# Only fall back to a single-size icon built from icon-192.png when it is missing.
$launcherIcon = Join-Path $PSScriptRoot 'launcher.ico'
if (-not (Test-Path -LiteralPath $launcherIcon)) {
    $launcherPng = [IO.File]::ReadAllBytes((Join-Path $launcherRoot 'public\icon-192.png'))
    $launcherBytes = New-Object IO.MemoryStream
    $launcherWriter = New-Object IO.BinaryWriter($launcherBytes)
    try {
        $launcherWriter.Write([uint16]0)
        $launcherWriter.Write([uint16]1)
        $launcherWriter.Write([uint16]1)
        $launcherWriter.Write([byte]192)
        $launcherWriter.Write([byte]192)
        $launcherWriter.Write([byte]0)
        $launcherWriter.Write([byte]0)
        $launcherWriter.Write([uint16]1)
        $launcherWriter.Write([uint16]32)
        $launcherWriter.Write([uint32]$launcherPng.Length)
        $launcherWriter.Write([uint32]22)
        $launcherWriter.Write($launcherPng)
        [IO.File]::WriteAllBytes($launcherIcon, $launcherBytes.ToArray())
    } finally { $launcherWriter.Dispose(); $launcherBytes.Dispose() }
}

$launcherOutput = Join-Path $launcherRoot (([string][char]0x63A8) + ([string][char]0x65E5) + '.exe')
& $launcherCompiler /nologo /codepage:65001 /target:winexe /platform:anycpu /optimize+ "/out:$launcherOutput" "/win32icon:$launcherIcon" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll (Join-Path $PSScriptRoot 'windows-launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
Write-Output "Created: $launcherOutput"
