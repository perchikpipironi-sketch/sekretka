@echo off
rem Секретка — публичный доступ: Cloudflare Quick Tunnel
rem Новый URL печатается в окне (https://xxx.trycloudflare.com) и в tools/tunnel-url.txt.
cd /d %~dp0
set EDGE=198.41.192.57:7844
:retry
cloudflared.exe tunnel --url http://127.0.0.1:8080 --no-autoupdate --edge-ip-version 4 --edge %EDGE% > tunnel-current.log 2>&1
echo Tunnel stopped. Restarting in 3s... & timeout /t 3 >nul & goto retry
