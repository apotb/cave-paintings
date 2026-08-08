@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "ngrok.env" (
  echo Missing ngrok.env
  echo Copy ngrok.env.example to ngrok.env and set NGROK_URL
  pause
  exit /b 1
)

for /f "usebackq eol=# tokens=1,* delims==" %%A in ("ngrok.env") do (
  if not "%%A"=="" set "%%A=%%B"
)

if "%NGROK_URL%"=="" (
  echo NGROK_URL is not set in ngrok.env
  pause
  exit /b 1
)
if "%NGROK_PORT%"=="" set "NGROK_PORT=8888"

ngrok http --url=%NGROK_URL% %NGROK_PORT%
pause
