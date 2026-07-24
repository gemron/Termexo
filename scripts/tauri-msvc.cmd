@echo off
setlocal

set "REPOSITORY_ROOT=%~dp0.."
set "VSDEVCMD=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"

if not exist "%VSDEVCMD%" (
  echo Visual Studio Build Tools 2022 with the Desktop C++ workload is required.
  exit /b 1
)

call "%VSDEVCMD%" -arch=x64 -host_arch=x64
if errorlevel 1 exit /b %errorlevel%

if exist "%REPOSITORY_ROOT%\.tooling\cargo\bin\cargo.exe" (
  set "CARGO_HOME=%REPOSITORY_ROOT%\.tooling\cargo"
  set "RUSTUP_HOME=%REPOSITORY_ROOT%\.tooling\rustup"
  set "PATH=%REPOSITORY_ROOT%\.tooling\cargo\bin;%PATH%"
)

call npm --prefix "%REPOSITORY_ROOT%\apps\desktop-ui" run tauri:%1
exit /b %errorlevel%
