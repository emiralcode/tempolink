@echo off
REM SecureShare - tek komutla tum servisleri baslatir (Redis + server + client).
REM Her servis kendi penceresinde acilir; loglari o pencerelerden takip edebilirsiniz.
REM Kapatmak icin ilgili pencereyi kapatin ya da icinde Ctrl+C yapin.

setlocal
cd /d "%~dp0"

echo ============================================
echo   SecureShare baslatiliyor...
echo ============================================

echo [1/3] Redis baslatiliyor...
start "SecureShare - Redis" cmd /k "cd /d "%~dp0redis-portable" && redis-server.exe --port 6379 --notify-keyspace-events Ex"

timeout /t 2 /nobreak >nul

echo [2/3] Sunucu (server) baslatiliyor...
start "SecureShare - Server" cmd /k "cd /d "%~dp0server" & if not exist node_modules npm install & npm run dev"

timeout /t 2 /nobreak >nul

echo [3/3] Istemci (client) baslatiliyor...
start "SecureShare - Client" cmd /k "cd /d "%~dp0client" & if not exist node_modules npm install & npm run dev"

echo.
echo Uc pencere de acildi: Redis, Server, Client.
echo Server hazir oldugunda tarayicida http://localhost:5173 adresini acin.
echo Bu pencereyi kapatabilirsiniz; diger uc pencere calismaya devam eder.
echo.
pause
