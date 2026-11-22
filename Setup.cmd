@echo off
setlocal
cd /d "%~dp0"
if not defined SPRITE_VENV set "SPRITE_VENV=%LOCALAPPDATA%\DotSpriteWorkshop\venv-v1"
set "SPRITE_SETUP_PYTHON=%SPRITE_VENV%\Scripts\python.exe"
if not exist "%SPRITE_SETUP_PYTHON%" (
  py -3.12 -c "import struct; assert struct.calcsize('P') == 8" >nul 2>nul
  if errorlevel 1 (
    echo Install 64-bit Python 3.12 and its py launcher, then run Setup.cmd again.
    echo https://www.python.org/downloads/release/python-31210/
    pause
    exit /b 1
  )
  py -3.12 -m venv "%SPRITE_VENV%"
  if errorlevel 1 goto fail
)
set "SPRITE_WHEEL=cpu"
if /i "%~1"=="cuda" goto use_cuda
if /i "%~1"=="cpu" goto setup
choice /c CN /n /m "1: CPU (any supported PC) [C]   2: NVIDIA GPU (CUDA 13) [N]   "
if errorlevel 2 goto use_cuda
goto setup
:use_cuda
set "SPRITE_WHEEL=cu130"
:setup
"%SPRITE_SETUP_PYTHON%" -m pip install "torch==2.13.0+%SPRITE_WHEEL%" --index-url "https://download.pytorch.org/whl/%SPRITE_WHEEL%"
if errorlevel 1 goto fail
if "%SPRITE_WHEEL%"=="cu130" (
  "%SPRITE_SETUP_PYTHON%" -c "import torch; torch.empty(1, device='cuda'); print(torch.cuda.get_device_name(0))"
  if errorlevel 1 (
    echo CUDA could not start. Check the NVIDIA driver or choose CPU.
    goto fail
  )
)
"%SPRITE_SETUP_PYTHON%" -m pip install -r requirements.txt
if errorlevel 1 goto fail
"%SPRITE_SETUP_PYTHON%" -m pip check
if errorlevel 1 goto fail
"%SPRITE_SETUP_PYTHON%" -X utf8 setup_models.py
if errorlevel 1 goto fail
echo Setup complete. Open Start.cmd to use Dot Sprite Workshop.
if "%~1"=="" pause
exit /b 0
:fail
echo Setup stopped. Run Diagnose.cmd to check installation or rerun Setup.cmd.
if "%~1"=="" pause
exit /b 1
