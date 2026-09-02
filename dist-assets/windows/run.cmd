@echo off
REM Serene Pub - launcher
REM Licensed under AGPL-3.0 - See LICENSE file
REM Source: https://github.com/doolijb/serene-pub
REM
REM A forwarder, deliberately trivial: the real entrypoint is app\run.cmd, and
REM everything that makes up the application lives under app\ so an update can
REM replace that one directory wholesale. This file stays outside it, at the
REM path people pin to the taskbar or put in a shortcut, so those keep working
REM across updates. A later release replaces it with a compiled launcher,
REM which will own error display itself; keeping this near-trivial is what
REM makes that swap clean.
REM
REM Run app\run.cmd directly for a headless machine, a service, or debugging.
REM
REM The one thing this adds over calling app\run.cmd directly: on failure, if
REM the window looks like it was opened by double-clicking (Explorer starts
REM cmd.exe with "/c", which is what %cmdcmdline% is checked for below - a
REM window already open at a prompt does not use /c to run this), it waits
REM for a keypress so the window doesn't close before the error can be read.
REM A successful run never pauses, and SERENE_PUB_NO_PAUSE=1 (or "true")
REM skips the pause unconditionally.

call "%~dp0app\run.cmd" %*
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" if /i not "%SERENE_PUB_NO_PAUSE%"=="1" if /i not "%SERENE_PUB_NO_PAUSE%"=="true" (
    echo %cmdcmdline% | find /i "/c" >nul
    if not errorlevel 1 (
        echo.
        echo Press any key to exit...
        pause >nul
    )
)

exit /b %EXIT_CODE%
