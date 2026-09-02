@echo off
REM Serene Pub - bare entrypoint
REM Licensed under AGPL-3.0 - See LICENSE file
REM Source: https://github.com/doolijb/serene-pub
REM
REM This starts the Node server and nothing else: no launcher, no tray. It is
REM the supported way to run Serene Pub headless, as a service, or when
REM debugging a start-up problem. The forwarder one directory up (..\run.cmd)
REM exists so a double-click still works; it does nothing but call this file.
REM
REM Everything the application is made of lives in this directory ("app\") so
REM that an update can replace the whole directory in one rename. Nothing the
REM user owns is kept in here - the database and .env live in the OS data
REM directory (see .env.example).

setlocal enabledelayedexpansion

REM === Configuration ===
set NODE_ENV=production
set DIR=%~dp0
set DIR=%DIR:~0,-1%
set NODE_BIN=%DIR%\node.exe
set APP_MAIN=%DIR%\build\index.js

REM The top of the install: the folder the user extracted, one level above this
REM one. State it rather than leaving the server to guess, because the two
REM directories mean different things and only this script knows the layout.
REM Everything the user owns is anchored here - a legacy .env, and a relative
REM SERENE_PUB_DATA_DIR - so that none of it lands inside the folder an update
REM replaces. src\lib\server\config\preloadEnv.js is what reads this.
REM
REM for %%~f resolves the ".." away, so the value handed to the server is a
REM clean absolute path rather than one containing a parent-directory hop.
for %%I in ("%DIR%\..") do set "SERENE_PUB_INSTALL_ROOT=%%~fI"

REM The server resolves .\drizzle (migrations) and .\build\client (static
REM assets) against the working directory, so it has to be this one - not
REM wherever the user happened to launch from.
cd /d "%DIR%"

REM === Load Environment Variables ===
set ENV_FILE=%DIR%\.env
if exist "%ENV_FILE%" (
    echo Loading configuration from .env file...
    for /f "usebackq tokens=1* delims==" %%a in ("%ENV_FILE%") do (
        set "line=%%a"
        if not "!line:~0,1!"=="#" (
            if not "%%a"=="" if not "%%b"=="" (
                set "%%a=%%b"
            )
        )
    )
)

echo ========================================
echo Serene Pub - AI Chat Application
echo https://github.com/doolijb/serene-pub
echo ========================================
echo.

REM === Verify Node.js Runtime ===
if not exist "%NODE_BIN%" (
    echo ERROR: Node.js runtime not found at %NODE_BIN%
    echo Please ensure all application files are present in this directory.
    goto :Error
)

REM === Verify Application Files ===
if not exist "%APP_MAIN%" (
    echo ERROR: Application file not found at %APP_MAIN%
    echo Please ensure all application files are present in this directory.
    goto :Error
)

echo Starting Serene Pub...
echo.
echo The application will be available at:
echo   - http://localhost:3000
echo   - http://127.0.0.1:3000
echo.
echo Press Ctrl+C to stop the application.
echo ========================================
echo.

REM === Start Application ===
echo Starting application...
"%NODE_BIN%" "%APP_MAIN%"

REM === Application Exit Handling ===
set EXIT_CODE=%ERRORLEVEL%
echo.
echo ========================================
if %EXIT_CODE% equ 0 (
    echo Serene Pub stopped normally.
) else (
    echo Serene Pub exited with code: %EXIT_CODE%
    echo Check the output above for any error messages.
    echo.
    echo Common issues:
    echo - Missing or corrupted application files
    echo - Port 3000 already in use by another application
    echo - Insufficient permissions
    echo - Antivirus software blocking the application
)
echo.
goto :End

:Error
echo.
echo ========================================
echo Setup failed. Please ensure:
echo 1. All application files are present
echo 2. Node.js runtime (node.exe) is included
echo 3. Visit https://github.com/doolijb/serene-pub for help
echo ========================================
echo.

:End
echo Press any key to exit...
pause >nul
exit /b %EXIT_CODE%
