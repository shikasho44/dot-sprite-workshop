@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul
if exist "Local-Settings.cmd" call "Local-Settings.cmd"
if not defined SPRITE_VENV set "SPRITE_VENV=%LOCALAPPDATA%\DotSpriteWorkshop\venv-v1"
if not defined SPRITE_PYTHON goto try_venv
if exist "%SPRITE_PYTHON%" (
  "%SPRITE_PYTHON%" -c "import sys" >nul 2>nul
  if not errorlevel 1 goto use_python
)
echo The configured Python could not start. Checking the standard environment.
:try_venv
set "SPRITE_PYTHON=%SPRITE_VENV%\Scripts\python.exe"
if exist "%SPRITE_PYTHON%" (
  "%SPRITE_PYTHON%" -c "import sys" >nul 2>nul
  if not errorlevel 1 goto use_python
  echo The workshop Python environment could not start. Checking installed Python.
)
py -3.12 -c "import sys" >nul 2>nul
if not errorlevel 1 goto use_launcher
py -3 -c "import sys; assert sys.version_info >= (3, 11)" >nul 2>nul
if not errorlevel 1 goto use_other
echo Python 3.12 not found. Install Python 3.12 (64-bit), including the py launcher.
echo https://www.python.org/downloads/release/python-31210/
powershell -NoProfile -Command ^
  "Write-Host '[GPU]'; if(Get-Command nvidia-smi -ErrorAction SilentlyContinue){nvidia-smi '--query-gpu=name,memory.total,driver_version' '--format=csv,noheader'}else{try{Get-CimInstance Win32_VideoController -ErrorAction Stop | Format-Table Name,DriverVersion}catch{Write-Host 'GPU details unavailable.'}};" ^
  "Write-Host '[Disks]'; foreach($drive in [IO.DriveInfo]::GetDrives()){try{if($drive.IsReady){Write-Host ('{0} {1:N2} GiB free' -f $drive.Name,($drive.AvailableFreeSpace/1GB))}}catch{}};" ^
  "$data=if($env:SPRITE_DATA){$env:SPRITE_DATA}else{Join-Path (Get-Location) 'data'}; $m=Get-Content model-integrity.json -Raw | ConvertFrom-Json; $found=0; $total=0; foreach($e in $m.PSObject.Properties){$total++; if(Test-Path -LiteralPath (Join-Path $data $e.Name) -PathType Leaf){$found++}else{Write-Host ('[Missing] '+$e.Name)}}; Write-Host ('Model files present: {0}/{1}' -f $found,$total); Write-Host 'Python is required for checksums and repair.'"
if "%~1"=="" pause
exit /b 1
:use_python
"%SPRITE_PYTHON%" -X utf8 diagnose.py %1
goto done
:use_launcher
py -3.12 -X utf8 diagnose.py %1
goto done
:use_other
py -3 -X utf8 diagnose.py %1
:done
set "SPRITE_DIAG_RESULT=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %SPRITE_DIAG_RESULT%
