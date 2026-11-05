# Builds the portable distributable package for Virtual ONVIF Camera.
# Output: dist\VirtualONVIFCamera\ (folder) + dist\VirtualONVIFCamera-win-x64.zip
#
# ffmpeg/mediamtx don't need to be pre-installed on the build machine: this
# script looks for them on PATH or in winget's package folder, and if neither
# has them, installs them itself via "winget install" (silent). Requires
# winget to be available if they aren't already installed some other way.
# The resulting zip needs nothing pre-installed on the target machine - no
# Node.js, no ffmpeg, no mediamtx.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$appDir = Join-Path $root "dist\VirtualONVIFCamera"
$zipPath = Join-Path $root "dist\VirtualONVIFCamera-win-x64.zip"

Write-Host "[1/6] Cleaning previous build..."
if (Test-Path (Join-Path $root "dist")) {
    Remove-Item (Join-Path $root "dist") -Recurse -Force
}
New-Item -ItemType Directory -Path $appDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $appDir "bin") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $appDir "cam") | Out-Null

Write-Host "[2/6] Locating ffmpeg.exe / mediamtx.exe..."

# Looks in three places, same priority the app itself uses at runtime
# (see src/rtspServer/ffmpegLocator.js / mediamtxLocator.js):
#   1. PATH
#   2. winget's package install folder (works even if winget never added it to PATH)
# so this works on a fresh machine as long as the tool is installed *somehow*.
function Find-Exe($exeName, $packagePrefix) {
    $onPath = Get-Command $exeName -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }

    $base = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    if (Test-Path $base) {
        $pkgDirs = Get-ChildItem $base -Directory | Where-Object { $_.Name -like "$packagePrefix*" }
        foreach ($pkgDir in $pkgDirs) {
            $found = Get-ChildItem $pkgDir.FullName -Recurse -Filter $exeName -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($found) { return $found.FullName }
        }
    }
    return $null
}

# If a tool is missing entirely, try installing it automatically via winget
# (silent, no prompts) so packaging works out of the box on a fresh PC.
function Install-WingetPackage($wingetId) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { return $false }
    Write-Host "  $wingetId not found - installing via winget (silent)..."
    winget install --id $wingetId -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
    return $LASTEXITCODE -eq 0
}

$ffmpegSrc = Find-Exe "ffmpeg.exe" "Gyan.FFmpeg"
if (-not $ffmpegSrc -and (Install-WingetPackage "Gyan.FFmpeg")) {
    $ffmpegSrc = Find-Exe "ffmpeg.exe" "Gyan.FFmpeg"
}

$mediamtxSrc = Find-Exe "mediamtx.exe" "bluenviron.mediamtx"
if (-not $mediamtxSrc -and (Install-WingetPackage "bluenviron.mediamtx")) {
    $mediamtxSrc = Find-Exe "mediamtx.exe" "bluenviron.mediamtx"
}

# ffprobe ships next to ffmpeg in the same install; check there before a
# separate PATH/winget-package search.
$ffprobeSrc = $null
if ($ffmpegSrc) {
    $sibling = Join-Path (Split-Path -Parent $ffmpegSrc) "ffprobe.exe"
    if (Test-Path $sibling) { $ffprobeSrc = $sibling }
}
if (-not $ffprobeSrc) { $ffprobeSrc = Find-Exe "ffprobe.exe" "Gyan.FFmpeg" }

if (-not $ffmpegSrc) { throw "ffmpeg.exe not found and winget auto-install failed. Install it manually: winget install Gyan.FFmpeg" }
if (-not $ffprobeSrc) { throw "ffprobe.exe not found next to ffmpeg.exe. Reinstall a full ffmpeg build: winget install Gyan.FFmpeg" }
if (-not $mediamtxSrc) { throw "mediamtx.exe not found and winget auto-install failed. Install it manually: winget install bluenviron.mediamtx" }

Write-Host "  ffmpeg   : $ffmpegSrc"
Write-Host "  ffprobe  : $ffprobeSrc"
Write-Host "  mediamtx : $mediamtxSrc"

Write-Host "[3/6] Building single exe with bundled Node runtime (pkg)..."
npx pkg . --targets node22-win-x64 --output (Join-Path $appDir "VirtualONVIFCamera.exe")
if ($LASTEXITCODE -ne 0) { throw "pkg build failed (exit $LASTEXITCODE)" }

Write-Host "[4/6] Copying ffmpeg / ffprobe / mediamtx binaries..."
Copy-Item $ffmpegSrc (Join-Path $appDir "bin\ffmpeg.exe")
Copy-Item $ffprobeSrc (Join-Path $appDir "bin\ffprobe.exe")
Copy-Item $mediamtxSrc (Join-Path $appDir "bin\mediamtx.exe")

Write-Host "[5/6] Copying config.yaml, README, cam folder placeholder, and TLS cert..."
Copy-Item (Join-Path $PSScriptRoot "config.dist.yaml") (Join-Path $appDir "config.yaml")
Copy-Item (Join-Path $PSScriptRoot "README-package.txt") (Join-Path $appDir "README.txt")
Copy-Item (Join-Path $PSScriptRoot "cam-placeholder.txt") (Join-Path $appDir "cam\PUT_VIDEOS_HERE.txt")
# auto.crt/auto.key let each camera's ONVIF port also answer HTTPS (some ONVIF
# clients open a TLS connection to the device_service port regardless of the
# advertised http:// XAddr) - see httpServer.js. Optional: if absent, the app
# just serves plain HTTP as before and logs a warning once per camera.
$autoCrt = Join-Path $PSScriptRoot "..\auto.crt"
$autoKey = Join-Path $PSScriptRoot "..\auto.key"
if ((Test-Path $autoCrt) -and (Test-Path $autoKey)) {
    Copy-Item $autoCrt (Join-Path $appDir "auto.crt")
    Copy-Item $autoKey (Join-Path $appDir "auto.key")
} else {
    Write-Host "  (auto.crt/auto.key not found - packaged app will serve ONVIF over plain HTTP only)"
}

Write-Host "[6/6] Creating zip archive..."
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "$appDir\*" -DestinationPath $zipPath

Write-Host ""
Write-Host "Done: $zipPath"
Write-Host "Folder: $appDir"
