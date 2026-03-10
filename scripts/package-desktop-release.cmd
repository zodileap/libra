@echo off
REM 描述：
REM
REM   - 兼容 Windows 原生 shell 调用 Desktop 发布脚本，实际逻辑统一委托给跨平台 Node CLI。
setlocal
set "SCRIPT_DIR=%~dp0"
node "%SCRIPT_DIR%package-desktop-release.mjs" %*
exit /b %ERRORLEVEL%
