Push-Location $PSScriptRoot
$env:CARGO_TARGET_DIR = "D:\ec_target"
cargo build --release --target i686-pc-windows-msvc
$distBin = Join-Path $PSScriptRoot "..\..\dist\bin"
if (-not (Test-Path $distBin)) { New-Item -ItemType Directory -Path $distBin -Force | Out-Null }
Copy-Item "D:\ec_target\i686-pc-windows-msvc\release\ec_parser.dll" $distBin -Force
Pop-Location
