@echo off
REM Docker gerektirmeyen taşınabilir Redis sunucusu (Windows).
REM Bu pencereyi açık bırakın; server\.env içindeki REDIS_URL=redis://localhost:6379
REM bu örneği bulur. Durdurmak için bu pencereyi kapatın ya da Ctrl+C yapın.
cd /d "%~dp0"
redis-server.exe --port 6379 --notify-keyspace-events Ex
