@echo off
rem ================================================================
rem  Mo app "Nha May San Xuat Phuong Quan" (chay tren may nay)
rem ================================================================
cd /d "%~dp0"
setlocal enabledelayedexpansion

set RUNNING=0
if exist "data\server.pid" (
  set /p SRVPID=<data\server.pid
  for /f %%A in ('tasklist /nh /fi "pid eq !SRVPID!" 2^>nul ^| find /c /i "powershell"') do set RUNNING=%%A
)

if "!RUNNING!"=="1" (
  echo App dang chay san - dang mo trinh duyet...
) else (
  echo Dang khoi dong app...
  start "NhaMaySanXuat" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
  timeout /t 3 /nobreak >nul
)

start "" "http://localhost:8756/"
endlocal
