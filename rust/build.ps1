Push-Location $PSScriptRoot
cargo build --release
if (-not (Test-Path "..\dist\bin")) { New-Item -ItemType Directory -Path "..\dist\bin" -Force | Out-Null }
Copy-Item "target\release\jade-ec-launcher.exe" "..\dist\bin\" -Force
Pop-Location
