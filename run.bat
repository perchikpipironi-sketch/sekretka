@echo off
rem Секретка — запуск сервера
cd /d %~dp0
echo Секретка запускается... http://127.0.0.1:8080
node server.js
pause
