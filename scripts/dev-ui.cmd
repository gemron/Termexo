@echo off
setlocal
pushd "%~dp0..\apps\desktop-ui"
call npm start -- --host 127.0.0.1 --port 4200
popd
endlocal
