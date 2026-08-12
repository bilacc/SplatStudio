[CmdletBinding()]
param(
  [string]$Destination = '',
  [string]$CacheDirectory = '',
  [string]$HostPython = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Destination = if ($Destination) { $Destination } else { Join-Path $PSScriptRoot '..\bin' }
$CacheDirectory = if ($CacheDirectory) { $CacheDirectory } else { Join-Path $PSScriptRoot '..\work\runtime-cache' }
$Destination = [IO.Path]::GetFullPath($Destination)
$CacheDirectory = [IO.Path]::GetFullPath($CacheDirectory)
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

if (-not $Destination.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Runtime destination must stay inside the project: $Destination"
}
if (-not $HostPython -or -not (Test-Path -LiteralPath $HostPython -PathType Leaf)) {
  $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $pythonCommand) { throw 'A Python 3.12 x64 build interpreter is required.' }
  $HostPython = $pythonCommand.Source
}

$components = @{
  Python = @{
    Name = 'python-3.12.10-embed-amd64.zip'
    Uri = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip'
    Sha256 = '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3'
  }
  Colmap = @{
    Name = 'colmap-x64-windows-nocuda-4.1.1.zip'
    Uri = 'https://github.com/colmap/colmap/releases/download/4.1.1/colmap-x64-windows-nocuda.zip'
    Sha256 = 'faf1247d2ec90933aa8bd003709790abf0211cdc132cceec4c831718f2e0895a'
  }
  FfmpegX64 = @{
    Name = 'ffmpeg-n8.1-win64-lgpl.zip'
    Uri = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-win64-lgpl-8.1.zip'
    Sha256 = '83ac35561c5ef5bfaf9ec28cd72b5c546c6d1b03fb422b991f45869b5a6c532f'
  }
  FfmpegArm64 = @{
    Name = 'ffmpeg-n8.1-winarm64-lgpl.zip'
    Uri = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-winarm64-lgpl-8.1.zip'
    Sha256 = 'a4491838533ee04560c180c2c6dd2794aac2553f0e6263a466724018197e3b2e'
  }
}

New-Item -ItemType Directory -Path $CacheDirectory -Force | Out-Null

function Get-VerifiedArchive {
  param([hashtable]$Component)
  $archive = Join-Path $CacheDirectory $Component.Name
  if (Test-Path -LiteralPath $archive -PathType Leaf) {
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -eq $Component.Sha256) { return $archive }
    Remove-Item -LiteralPath $archive -Force
  }

  $partial = "$archive.partial"
  Write-Host "Downloading $($Component.Name)..."
  $curl = (Get-Command curl.exe -ErrorAction Stop).Source
  & $curl --http1.1 --location --fail --retry 8 --retry-all-errors --retry-delay 2 --continue-at - --output $partial $Component.Uri
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $($Component.Uri)" }
  $actual = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Component.Sha256) {
    Remove-Item -LiteralPath $partial -Force
    throw "SHA-256 mismatch for $($Component.Name): $actual"
  }
  Move-Item -LiteralPath $partial -Destination $archive
  return $archive
}

function Reset-Directory {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) {
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    if (-not $resolved.StartsWith($Destination + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to replace runtime outside destination: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Expand-Fresh {
  param([string]$Archive, [string]$Name)
  $extractRoot = Join-Path $CacheDirectory $Name
  if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }
  Expand-Archive -LiteralPath $Archive -DestinationPath $extractRoot -Force
  return $extractRoot
}

function Copy-ArchiveContents {
  param([string]$ExtractRoot, [string]$Target)
  $children = @(Get-ChildItem -LiteralPath $ExtractRoot -Force)
  $contentRoot = if ($children.Count -eq 1 -and $children[0].PSIsContainer) { $children[0].FullName } else { $ExtractRoot }
  Get-ChildItem -LiteralPath $contentRoot -Force | Copy-Item -Destination $Target -Recurse -Force
}

$pythonArchive = Get-VerifiedArchive $components.Python
$colmapArchive = Get-VerifiedArchive $components.Colmap
$ffmpegX64Archive = Get-VerifiedArchive $components.FfmpegX64
$ffmpegArm64Archive = Get-VerifiedArchive $components.FfmpegArm64

$x64Root = Join-Path $Destination 'win32-x64'
$arm64Root = Join-Path $Destination 'win32-arm64'
Reset-Directory $x64Root
Reset-Directory $arm64Root

$pythonRoot = Join-Path $x64Root 'python'
New-Item -ItemType Directory -Path $pythonRoot -Force | Out-Null
Expand-Archive -LiteralPath $pythonArchive -DestinationPath $pythonRoot -Force
$pthFile = Get-ChildItem -LiteralPath $pythonRoot -Filter 'python*._pth' | Select-Object -First 1
if (-not $pthFile) { throw 'Embedded Python path configuration was not found.' }
$pthLines = @(Get-Content -LiteralPath $pthFile.FullName)
$pthLines = @($pthLines | Where-Object { $_ -ne 'Lib\site-packages' } | ForEach-Object {
  if ($_ -match '^#\s*import site') { 'import site' } else { $_ }
})
$importSiteIndex = [Array]::IndexOf($pthLines, 'import site')
if ($importSiteIndex -lt 0) {
  $pthLines += 'Lib\site-packages'
  $pthLines += 'import site'
} else {
  $before = if ($importSiteIndex -gt 0) { @($pthLines[0..($importSiteIndex - 1)]) } else { @() }
  $after = @($pthLines[$importSiteIndex..($pthLines.Count - 1)])
  $pthLines = @($before + 'Lib\site-packages' + $after)
}
Set-Content -LiteralPath $pthFile.FullName -Value $pthLines -Encoding Ascii

$sitePackages = Join-Path $pythonRoot 'Lib\site-packages'
New-Item -ItemType Directory -Path $sitePackages -Force | Out-Null
Write-Host 'Installing the offline Python compute stack...'
& $HostPython -m pip install --disable-pip-version-check --no-cache-dir --only-binary=:all: --target $sitePackages `
  'torch==2.4.1' 'numpy==1.26.4' 'opencv-python-headless==4.10.0.84' 'plyfile==1.1.3' 'tqdm==4.67.1'
if ($LASTEXITCODE -ne 0) { throw 'Python runtime package installation failed.' }
& $HostPython -m pip install --disable-pip-version-check --no-cache-dir --no-deps --target $sitePackages `
  'https://files.pythonhosted.org/packages/71/f2/eb7d3c601310c758f6aef891773e4a00f7388eeb613d536c0d2681fcb105/torch_directml-0.2.5.dev240914-cp312-cp312-win_amd64.whl'
if ($LASTEXITCODE -ne 0) { throw 'DirectML runtime package installation failed.' }

$colmapTarget = Join-Path $x64Root 'colmap'
New-Item -ItemType Directory -Path $colmapTarget -Force | Out-Null
$colmapExtract = Expand-Fresh $colmapArchive 'colmap-extracted'
Copy-ArchiveContents $colmapExtract $colmapTarget
if (-not (Get-ChildItem -LiteralPath $colmapTarget -Recurse -Filter 'colmap.exe' | Select-Object -First 1)) {
  throw 'COLMAP executable was not found after extraction.'
}
Set-Content -LiteralPath (Join-Path $colmapTarget 'SPLATSTUDIO_CPU_ONLY') -Value 'This official COLMAP build does not include CUDA.' -Encoding Ascii
Copy-Item -LiteralPath (Join-Path $projectRoot 'licenses\COLMAP-COPYING.txt') -Destination (Join-Path $colmapTarget 'COLMAP-COPYING.txt') -Force

foreach ($ffmpeg in @(
  @{ Archive = $ffmpegX64Archive; Extract = 'ffmpeg-x64-extracted'; Target = $x64Root },
  @{ Archive = $ffmpegArm64Archive; Extract = 'ffmpeg-arm64-extracted'; Target = $arm64Root }
)) {
  $extract = Expand-Fresh $ffmpeg.Archive $ffmpeg.Extract
  $executable = Get-ChildItem -LiteralPath $extract -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
  if (-not $executable) { throw "FFmpeg executable was not found in $($ffmpeg.Archive)." }
  Copy-Item -LiteralPath $executable.FullName -Destination (Join-Path $ffmpeg.Target 'ffmpeg.exe') -Force
  $license = Get-ChildItem -LiteralPath $extract -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|COPYING)(\.txt)?$' } | Select-Object -First 1
  if ($license) { Copy-Item -LiteralPath $license.FullName -Destination (Join-Path $ffmpeg.Target 'FFMPEG-LICENSE.txt') -Force }
}

$manifest = [ordered]@{
  schema = 1
  generated_at = (Get-Date).ToUniversalTime().ToString('o')
  windows = [ordered]@{
    x64 = [ordered]@{
      python = '3.12.10 x64 embedded'
      pytorch = '2.4.1'
      torch_directml = '0.2.5.dev240914'
      colmap = '4.1.1 CPU'
      ffmpeg = '8.1 LGPL x64'
    }
    arm64 = [ordered]@{
      ffmpeg = '8.1 LGPL ARM64'
      compute_worker = 'x64 Python/COLMAP through Windows x64 emulation'
    }
  }
  archives = [ordered]@{
    python = $components.Python
    colmap = $components.Colmap
    ffmpeg_x64 = $components.FfmpegX64
    ffmpeg_arm64 = $components.FfmpegArm64
  }
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Destination 'runtime-manifest.json') -Encoding UTF8

$embeddedPython = Join-Path $pythonRoot 'python.exe'
& $embeddedPython -I (Join-Path $Destination 'hardware_probe.py')
if ($LASTEXITCODE -ne 0) { throw 'Embedded Python hardware probe failed.' }

Write-Host "Embedded runtime assembled at $Destination"
