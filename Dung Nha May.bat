@echo off
rem ================================================================
rem  Tat han app "Nha May San Xuat Phuong Quan"
rem ================================================================
cd /d "%~dp0"
set KILLED=0
if exist "data\server.pid" (
  for /f "usebackq" %%A in ("data\server.pid") do (
    taskkill /f /pid %%A >nul 2>&1 && set KILLED=1
  )
)
if "%KILLED%"=="1" (
  echo Da tat app.
) else (
  echo Khong thay app dang chay ^(co the da tat roi^).
)
timeout /t 2 /nobreak >nul
