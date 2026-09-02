@echo off
REM Serene Pub - launcher
REM Licensed under AGPL-3.0 - See LICENSE file
REM Source: https://github.com/doolijb/serene-pub
REM
REM A forwarder, deliberately trivial: the real entrypoint is app\run.cmd, and
REM everything that makes up the application lives under app\ so an update can
REM replace that one directory wholesale. This file stays outside it, at the
REM path people pin to the taskbar or put in a shortcut, so those keep working
REM across updates. A later release replaces it with a compiled launcher;
REM keeping it to a single call is what makes that swap clean.
REM
REM Run app\run.cmd directly for a headless machine, a service, or debugging.

call "%~dp0app\run.cmd" %*
exit /b %ERRORLEVEL%
