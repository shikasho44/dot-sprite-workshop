@echo off
setlocal
cd /d "%~dp0"
if exist "Local-Settings.cmd" call "Local-Settings.cmd"
if not defined SPRITE_VENV set "SPRITE_VENV=%LOCALAPPDATA%\DotSpriteWorkshop\venv-v1"
if not defined SPRITE_DATA set "SPRITE_DATA=%CD%\data"
if not defined SPRITE_PYTHON (
  if not exist "%SPRITE_VENV%\Scripts\python.exe" goto setup
  if not exist "%SPRITE_DATA%\.base-ready" goto setup
  set "SPRITE_PYTHON=%SPRITE_VENV%\Scripts\python.exe"
)
"%SPRITE_PYTHON%" -X utf8 app.py --open
if errorlevel 1 pause
exit /b
:setup
echo Run Setup.cmd for a first install, or Diagnose.cmd to check and repair an existing install.
pause
exit /b 1
