@echo off
setlocal

echo [SmartLift] Setting up Python dependencies...

if not exist ".venv\Scripts\python.exe" (
  echo [SmartLift] Virtual environment not found. Creating .venv...
  py -m venv .venv
)

echo [SmartLift] Upgrading pip...
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :err

echo [SmartLift] Installing required packages...
".venv\Scripts\python.exe" -m pip install flask
if errorlevel 1 goto :err

echo.
echo [SmartLift] Dependencies installed successfully.
echo [SmartLift] Run: .venv\Scripts\python.exe app.py
exit /b 0

:err
echo.
echo [SmartLift] Dependency setup failed.
exit /b 1
