@echo off
setlocal

rem Runs any cargo command inside the MSVC environment tauri-msvc.cmd uses, so crates outside the
rem Tauri build (the shared relay protocol crate) link with the same toolchain:
rem   scripts\cargo-msvc.cmd test --manifest-path crates/termexo-relay-protocol/Cargo.toml

set "REPOSITORY_ROOT=%~dp0.."
set "VSDEVCMD=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"

if not exist "%VSDEVCMD%" (
  echo Visual Studio Build Tools 2022 with the Desktop C++ workload is required.
  exit /b 1
)

call "%VSDEVCMD%" -arch=x64 -host_arch=x64 >nul
if errorlevel 1 exit /b %errorlevel%

if exist "%REPOSITORY_ROOT%\.tooling\cargo\bin\cargo.exe" (
  set "CARGO_HOME=%REPOSITORY_ROOT%\.tooling\cargo"
  set "RUSTUP_HOME=%REPOSITORY_ROOT%\.tooling\rustup"
  set "PATH=%REPOSITORY_ROOT%\.tooling\cargo\bin;%PATH%"
)

cargo %*
exit /b %errorlevel%
