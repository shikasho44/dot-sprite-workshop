@echo off
setlocal
cd /d "%~dp0"
if not defined SPRITE_VENV set "SPRITE_VENV=%LOCALAPPDATA%\DotSpriteWorkshop\venv-v1"
if not exist "%SPRITE_VENV%\Scripts\python.exe" (
  echo Run Setup.cmd in NVIDIA mode first.
  pause
  exit /b 1
)
"%SPRITE_VENV%\Scripts\python.exe" -X utf8 setup_models.py --image-edit
if errorlevel 1 (
  echo Image editing setup stopped. Run Diagnose.cmd for details.
  pause
  exit /b 1
)
echo Image editing setup complete. Restart Dot Sprite Workshop to use it.
pause
