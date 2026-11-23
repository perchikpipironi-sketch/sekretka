@echo off
cd /d "%~dp0.."
set KEY=%USERPROFILE%\.ssh\serveo
:loop
echo [%date% %time%] starting serveo tunnel...
ssh -i "%KEY%" -o StrictHostKeyChecking=no -o ServerAliveInterval=60 -R 80:127.0.0.1:8080 serveo.net > tunnel-serveo.log 2>&1
echo tunnel died, restarting in 3s...
timeout /t 3 /nobreak >nul
goto loop
