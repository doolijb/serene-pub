#!/bin/sh
# Serene Pub - bare entrypoint
# Licensed under AGPL-3.0 - See LICENSE file
# Source: https://github.com/doolijb/serene-pub
#
# This starts the Node server and nothing else: no launcher, no tray, no
# window. It is the supported way to run Serene Pub on a headless box, from a
# launchd job, over ssh/tmux, or when debugging a start-up problem. The
# "Serene Pub.app" bundle around it and the run.sh forwarder at the top of the
# extracted folder both end up exec'ing this file.
#
# Everything the application is made of lives in this directory
# ("Serene Pub.app/Contents/Resources/app") so that an update can replace the
# whole directory in one rename. Nothing the user owns is kept in here - the
# database and .env live in the OS data directory (see .env.example).

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export NODE_ENV=production
NODE_BIN="$DIR/node"
APP_MAIN="$DIR/build/index.js"

# The top of the install: the folder the user extracted, one level above this
# one. State it rather than leaving the server to guess, because the two
# directories mean different things and only this script knows the layout.
# Everything the user owns is anchored here - a legacy .env, and a relative
# SERENE_PUB_DATA_DIR - so that none of it lands inside the folder an update
# replaces. src/lib/server/config/preloadEnv.js is what reads this.
SERENE_PUB_INSTALL_ROOT=$(CDPATH= cd -- "$DIR/.." && pwd)
export SERENE_PUB_INSTALL_ROOT

# The server resolves ./drizzle (migrations) and ./build/client (static assets)
# against the working directory, so it has to be this one - not wherever the
# user happened to launch from.
cd "$DIR" || exit 1

# Load environment variables from .env file if present
ENV_FILE="$DIR/.env"
if [ -f "$ENV_FILE" ]; then
    echo "Loading environment variables from .env file..."
    # Use a more portable way to load environment variables
    while IFS='=' read -r key value; do
        # Skip comments and empty lines
        case "$key" in
            '#'*|'') continue ;;
        esac
        # Export the variable, removing any surrounding quotes
        export "$key"="$(echo "$value" | sed 's/^["'\'']\|["'\'']$//g')"
    done < "$ENV_FILE"
fi

echo "========================================"
echo "Serene Pub - AI Chat Application"
echo "https://github.com/doolijb/serene-pub"
echo "========================================"
echo

# Verify Node.js runtime exists
if [ ! -f "$NODE_BIN" ]; then
    echo "ERROR: Node.js runtime not found at $NODE_BIN"
    echo "Please ensure all application files are present in this directory."
    echo "Press Enter to exit..."
    read
    exit 1
fi

# Verify application files exist
if [ ! -f "$APP_MAIN" ]; then
    echo "ERROR: Application file not found at $APP_MAIN"
    echo "Please ensure all application files are present in this directory."
    echo "Press Enter to exit..."
    read
    exit 1
fi

chmod +x "$NODE_BIN"

echo "Starting Serene Pub..."
echo
echo "The application will be available at:"
echo "  - http://localhost:3000"
echo "  - http://127.0.0.1:3000"
echo
echo "Press Ctrl+C to stop the application."
echo "========================================"
echo

# Set up signal handling for graceful shutdown
trap 'echo; echo "Shutting down Serene Pub..."; kill $NODE_PID 2>/dev/null; wait $NODE_PID 2>/dev/null; echo "Serene Pub stopped."; exit 0' INT TERM

# Start the application in background to handle signals
"$NODE_BIN" "$APP_MAIN" "$@" &
NODE_PID=$!

# Wait for the Node.js process
wait $NODE_PID
EXIT_CODE=$?

echo
echo "========================================"
if [ $EXIT_CODE -eq 0 ]; then
    echo "Serene Pub stopped normally."
else
    echo "Serene Pub exited with code: $EXIT_CODE"
    echo "Check the output above for any error messages."
fi
echo

echo "Press Enter to exit..."
read
exit $EXIT_CODE
read
