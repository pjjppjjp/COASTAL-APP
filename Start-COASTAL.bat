@echo off
setlocal
set "COASTAL_HTML=%~dp0OPEN-COASTAL.html"
if not exist "%COASTAL_HTML%" (
  echo OPEN-COASTAL.html is missing. Extract the complete COASTAL-Planner ZIP first.
  pause
  exit /b 1
)
start "" "%COASTAL_HTML%"
endlocal
