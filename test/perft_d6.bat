@echo off
setlocal
chcp 65001 >nul
title Mateless perft - CPW positions, depth 1..6
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
if not exist "%~dp0..\mateless.js" (
  echo mateless.js is not in the parent folder: %~dp0..
  pause
  exit /b 1
)
node "%~dp0perft_cpw.js" "%~dp0..\mateless.js" 6 %*
set RC=%errorlevel%
echo.
if "%RC%"=="0" (echo All counts match.) else (echo ERROR: some counts do not match. For details: perft_d6.bat --divide)
pause
exit /b %RC%
