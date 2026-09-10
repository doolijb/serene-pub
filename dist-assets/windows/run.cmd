@echo off
REM Serene Pub - launcher
REM Licensed under AGPL-3.0 - See LICENSE file
REM Source: https://github.com/doolijb/serene-pub
REM
REM A forwarder: the real entrypoint is app\run.cmd, and everything that makes
REM up the application lives under app\ so an update can replace that one
REM directory wholesale. This file stays outside it, at the path people pin to
REM the taskbar or put in a shortcut, so those keep working across updates. A
REM later release replaces it with a compiled launcher, which will own error
REM display itself.
REM
REM Run app\run.cmd directly for a headless machine, a service, or debugging.
REM
REM === WHAT THIS ADDS OVER CALLING app\run.cmd DIRECTLY ======================
REM
REM 1. A window opened by double-clicking closes the instant the script ends,
REM    so a failure would flash past unread. If %cmdcmdline% says Explorer
REM    started us (it runs cmd.exe with "/c"; a window already at a prompt does
REM    not), this waits for a keypress. SERENE_PUB_NO_PAUSE=1 (or "true") skips
REM    that unconditionally.
REM 2. The database can fail to open while the server itself comes up fine - it
REM    then serves one page, at /recovery, that explains what happened and can
REM    put a backup back. Nothing opens a browser for a launcher, so this does:
REM    if the port answers 503 with that page, it is opened for you.
REM 3. A start that dies leaves serene-pub-last-error.log in the data directory,
REM    and - only when the pause above is not going to happen, so nobody is
REM    going to read this window - a msg.exe one-liner if that command exists.
REM
REM SERENE_PUB_START_TIMEOUT (seconds, default 30) is how long to wait for the
REM port before concluding nothing started; 0 disables the watch entirely.

REM The startup watch runs this same file again in the background (see
REM :StartupWatch at the bottom), so that branch is taken before anything else.
if /i "%~1"=="--serene-pub-startup-watch" goto :StartupWatch

setlocal enabledelayedexpansion

set "SP_DIR=%~dp0"
set "SP_DIR=%SP_DIR:~0,-1%"
set "SP_NODE=%SP_DIR%\app\node.exe"

REM === Where things are ======================================================
REM
REM Read the same way src\lib\server\config\preloadEnv.js reads them, and
REM best-effort: this only decides which port to probe and where to leave a log,
REM never what the app itself does. The app remains the authority on both.

REM Precedence: the real environment, then the legacy <installRoot>\.env - which
REM is the only .env that can name the data directory, since the other one lives
REM inside it. Then the platform default (env-paths "SerenePub", no suffix).
set "SP_DATA_DIR=%SERENE_PUB_DATA_DIR%"
if not defined SP_DATA_DIR if exist "%SP_DIR%\.env" (
    for /f "usebackq tokens=1,* delims==" %%A in (`findstr /i /r /c:"^ *SERENE_PUB_DATA_DIR *=" "%SP_DIR%\.env"`) do set "SP_DATA_DIR=%%B"
)
call :Unquote SP_DATA_DIR
if not defined SP_DATA_DIR set "SP_DATA_DIR=%LOCALAPPDATA%\SerenePub\Data"
REM A relative value is anchored to the install root, never to the working
REM directory - the same rule preloadEnv.js applies, for the same reason.
echo !SP_DATA_DIR!| findstr /r /c:"^[A-Za-z]:" /c:"^\\\\" >nul
if errorlevel 1 set "SP_DATA_DIR=%SP_DIR%\!SP_DATA_DIR!"

REM Environment, then <dataDir>\.env, then the legacy <installRoot>\.env, then
REM adapter-node's own default.
set "SP_PORT=%PORT%"
if not defined SP_PORT if exist "!SP_DATA_DIR!\.env" (
    for /f "usebackq tokens=1,* delims==" %%A in (`findstr /i /r /c:"^ *PORT *=" "!SP_DATA_DIR!\.env"`) do set "SP_PORT=%%B"
)
if not defined SP_PORT if exist "%SP_DIR%\.env" (
    for /f "usebackq tokens=1,* delims==" %%A in (`findstr /i /r /c:"^ *PORT *=" "%SP_DIR%\.env"`) do set "SP_PORT=%%B"
)
call :Unquote SP_PORT
if defined SP_PORT set "SP_PORT=!SP_PORT: =!"
if not defined SP_PORT set "SP_PORT=3000"

if not defined SERENE_PUB_START_TIMEOUT set "SERENE_PUB_START_TIMEOUT=30"
REM How the watch below is told to stand down. A file rather than a process
REM handle because `start /b` hands back no pid to signal. The watch deletes it
REM when it sees it; this script only deletes it on a clean exit, when the watch
REM has necessarily answered and gone long before.
set "SP_STOPPED=%TEMP%\serene-pub-start-%RANDOM%%RANDOM%.stopped"

REM === Is a window going to stay open? =======================================
REM
REM Explorer runs cmd.exe with "/c" to open a .cmd; a window already sitting at
REM a prompt does not. That is the same test the pause at the bottom has always
REM used, and it is the closest thing cmd has to "is anyone going to read this".
set "SP_WINDOW_CLOSES="
echo %cmdcmdline% | find /i "/c" >nul
if not errorlevel 1 set "SP_WINDOW_CLOSES=1"

REM === Start the watch =======================================================
REM
REM In the background, as a second copy of this file. It inherits everything
REM set above through the environment, and stops on its own - either when it
REM has an answer, when the deadline passes, or when it sees the marker file
REM this one drops on the way out.
if not "%SERENE_PUB_START_TIMEOUT%"=="0" (
    start "" /b "%~f0" --serene-pub-startup-watch
)

REM === Run it ================================================================
REM
REM In the foreground and untouched: a double-clicked window is a real console,
REM so redirecting the output to a file to keep a copy would hide it from the
REM one person who can currently see it. The log below therefore records the
REM circumstances rather than the output.
call "%~dp0app\run.cmd" %*
set EXIT_CODE=%ERRORLEVEL%

REM Tell the watch to stand down. Harmless if it has already finished.
echo stopped > "%SP_STOPPED%" 2>nul

if not "%EXIT_CODE%"=="0" (
    REM Nothing is listening any more, so there is no page to send anyone to -
    REM and deliberately nothing is probed here either, because a *previous*
    REM instance still up on this port would answer and send them somewhere
    REM that has nothing to do with the start that just failed.
    call :WriteErrorLog "the application exited with code %EXIT_CODE%"
    REM Only where the message would otherwise reach nobody. A window still at
    REM a prompt has the error on screen; a double-clicked one is held open by
    REM the pause below. That leaves the case where the window is going to close
    REM AND the pause has been switched off, which is the silent one.
    if defined SP_WINDOW_CLOSES if defined SERENE_PUB_NO_PAUSE call :NotifyDesktop "Serene Pub stopped with an error (exit %EXIT_CODE%). See serene-pub-last-error.log in !SP_DATA_DIR!"
)

if not "%EXIT_CODE%"=="0" if /i not "%SERENE_PUB_NO_PAUSE%"=="1" if /i not "%SERENE_PUB_NO_PAUSE%"=="true" (
    if defined SP_WINDOW_CLOSES (
        echo.
        echo Press any key to exit...
        pause >nul
    )
)

if "%EXIT_CODE%"=="0" del "%SP_STOPPED%" >nul 2>&1
exit /b %EXIT_CODE%

REM ===========================================================================
REM Subroutines
REM ===========================================================================

REM Tidy a value read out of a .env file: drop the quotes dotenv would have
REM stripped, and any leading whitespace findstr left on the line. Written as a
REM substitution rather than a comparison against a literal quote, which cmd has
REM no way to escape inside an IF.
:Unquote
call set "_UQ=%%%~1%%"
if not defined _UQ goto :eof
set "_UQ=!_UQ:"=!"
for /f "tokens=* delims= " %%V in ("!_UQ!") do set "_UQ=%%V"
set "%~1=!_UQ!"
set "_UQ="
goto :eof

REM Everything a bug report needs about a start nobody saw, in the one
REM directory that survives an update.
:WriteErrorLog
if not exist "!SP_DATA_DIR!" mkdir "!SP_DATA_DIR!" >nul 2>&1
set "SP_LOG=!SP_DATA_DIR!\serene-pub-last-error.log"
(
    echo Serene Pub did not start.
    echo.
    echo When:      %DATE% %TIME%
    echo Reason:    %~1
    echo Install:   %SP_DIR%
    echo Data dir:  !SP_DATA_DIR!
    echo Address:   http://localhost:!SP_PORT!
    echo.
    echo If this says the database could not be opened, the recovery steps are in
    echo docs\troubleshooting.md#database-wont-open - online at
    echo https://github.com/doolijb/serene-pub/blob/main/docs/troubleshooting.md#database-wont-open
    echo.
    echo ---- output ----
    echo The application's own output went to the console window this was
    echo launched from; it is not captured here, so that it stays visible there.
) > "!SP_LOG!" 2>nul
if exist "!SP_LOG!" echo Wrote !SP_LOG!
goto :eof

REM One line, and only where nothing else is going to carry it. msg.exe ships
REM with Pro and Enterprise but not with Home, so its absence is normal and
REM silent - "else nothing" is the specified behaviour, not a missing fallback.
:NotifyDesktop
where msg >nul 2>&1
if errorlevel 1 goto :eof
msg * "%~1" >nul 2>&1
goto :eof

REM ===========================================================================
REM The startup watch
REM ===========================================================================
REM
REM A second copy of this file, started with /b above. Polls the port until it
REM gets an answer, the deadline passes, or the main copy says it has stopped.
REM
REM The probe is the Node runtime that ships beside the app - the one HTTP
REM client guaranteed to be present on any Windows this runs on - and it
REM answers through its EXIT CODE rather than its output, so nothing here has
REM to parse a captured string:
REM
REM   0  answered with the recovery page: up, with a database that will not open
REM   1  answered with anything else, including the 404 a healthy instance
REM      serves on /recovery (see src\routes\recovery\guard.ts)
REM   2  listening but not answering - a long migration holds every request
REM      until startup finishes, which is not a failure
REM   3  nothing is listening on the port yet
:StartupWatch
setlocal enabledelayedexpansion
set /a SP_WAITED=0
set /a SP_LISTENING=0

:WatchLoop
if exist "%SP_STOPPED%" goto :WatchStopped
if not exist "%SP_NODE%" goto :WatchTick
"%SP_NODE%" -e "const port = process.argv[1]; fetch('http://127.0.0.1:' + port + '/recovery', { signal: AbortSignal.timeout(2000) }).then(function (res) { return res.text().then(function (body) { let code = 1; if (res.status === 503) { if (body.indexOf('could not open its database') === -1) { code = 1 } else { code = 0 } } process.exitCode = code }) }).catch(function (err) { let cause = ''; if (err) { if (err.cause) { if (err.cause.code) { cause = err.cause.code } } } if (cause === 'ECONNREFUSED') { process.exitCode = 3 } else { process.exitCode = 2 } })" %SP_PORT% >nul 2>&1
if errorlevel 3 goto :WatchTick
if errorlevel 2 (
    set /a SP_LISTENING=1
    goto :WatchTick
)
if errorlevel 1 goto :WatchDone
start "" "http://localhost:%SP_PORT%/recovery"
goto :WatchDone

:WatchTick
if !SP_WAITED! GEQ %SERENE_PUB_START_TIMEOUT% goto :WatchDeadline
REM ping is the portable sleep; timeout.exe refuses to run without a console.
ping -n 2 127.0.0.1 >nul 2>&1
set /a SP_WAITED+=1
goto :WatchLoop

:WatchDeadline
if exist "%SP_STOPPED%" goto :WatchStopped
if !SP_LISTENING! EQU 1 (
    REM Up, and still working. Saying "did not start" here would be a false
    REM alarm on every upgrade with a long migration.
    echo Serene Pub is taking longer than %SERENE_PUB_START_TIMEOUT%s to answer on http://localhost:%SP_PORT% - still waiting.
    goto :WatchDone
)
call :WriteErrorLog "nothing was listening on port %SP_PORT% after %SERENE_PUB_START_TIMEOUT%s"
call :NotifyDesktop "Serene Pub did not start. See serene-pub-last-error.log in %SP_DATA_DIR%"

:WatchStopped
REM The application has already ended and the copy of this file that ran it
REM owns whatever is said about that. Take the marker with us.
del "%SP_STOPPED%" >nul 2>&1

:WatchDone
endlocal
exit /b 0
