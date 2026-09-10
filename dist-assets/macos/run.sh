#!/bin/sh
# Serene Pub - launcher
# Licensed under AGPL-3.0 - See LICENSE file
# Source: https://github.com/doolijb/serene-pub
#
# A forwarder: the real entrypoint is the run.sh inside the application bundle,
# where everything that makes up the application lives so an update can replace
# it wholesale.
#
# The SAME text is shipped twice, from this one file - scripts/bundle-dist.js
# puts the second copy in place - because there are two ways in and both have to
# behave identically:
#
#   serene-pub/run.sh
#       Outside the bundle, at the path people bookmark and put in their
#       shortcuts, so those keep working across an update that replaces
#       everything under them.
#
#   serene-pub/Serene Pub.app/Contents/Resources/run.sh
#       Inside it, beside the payload. "Contents/MacOS/serene-pub" - the
#       bundle's declared executable, and so the only thing a Dock or Finder
#       launch runs - exec's this one. It used to exec the payload's bare
#       app/run.sh directly, which meant a double-click got none of what this
#       file adds, on the one launch path that has no terminal to fall back on:
#       a database that would not open produced no window, no browser tab and
#       no log at all. It is also the only copy a .app dragged to /Applications
#       still has beside it.
#
# A later release replaces both with a compiled launcher, which will own error
# display itself.
#
# Run the bundle's app/run.sh directly for a headless Mac, a launchd job, or
# debugging. Double-clicking "Serene Pub.app" gets you here too, and everything
# below is about that case - it costs the terminal path nothing.
#
# ── WHAT THIS ADDS OVER CALLING THE BUNDLE'S run.sh DIRECTLY ───────────────
#
# Launched from the Dock or from Finder there is no terminal at all, so its
# output goes nowhere a person will ever look. A start that fails from there is
# *completely silent* - no window, no error, nothing in the Dock. Three answers,
# in descending order of how much is still working:
#
#  1. The server is up but serving only the recovery page (HTTP 503 on
#     /recovery). The database would not open; the app is running and can
#     explain itself and put a backup back. Open a browser at /recovery, which
#     is the one thing nothing else is going to do.
#  2. Nothing ever listened on the port, or the app exited non-zero. There is
#     no page to open, so leave evidence instead: serene-pub-last-error.log in
#     the data directory. No dialog - a Mac has no zenity/notify-send, and
#     raising one through osascript is a Finder permission prompt of its own.
#  3. A terminal is attached. Nothing above applies - the output is already on
#     screen - so this only waits for a keypress before the window closes, as
#     it always has. SERENE_PUB_NO_PAUSE=1 (or "true") skips that.
#
# SERENE_PUB_START_TIMEOUT (seconds, default 30) is how long to wait for the
# port before concluding nothing started; 0 disables the watch entirely.

# ── Which copy is running, and what it can see from there ──────────────────
#
# The two placements differ in exactly two facts, and the whole of the rest of
# this file is written against them:
#
#   APP_DIR  the payload - app/run.sh, and the node runtime the probe uses.
#   DIR      the install root: what a legacy .env and a relative
#            SERENE_PUB_DATA_DIR are anchored to.

SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ -f "$SELF_DIR/app/run.sh" ]; then
    # Inside the bundle. The payload is beside this file. The extracted folder
    # is three levels up - and is only claimed as the install root when the
    # sibling run.sh is there to say the bundle is still inside one. A .app
    # dragged to /Applications, or to a home directory where a stray .env
    # belonging to something else would otherwise be read as ours, has no
    # install root outside itself; app/run.sh's own SERENE_PUB_INSTALL_ROOT -
    # the parent of app/, which is this directory - is then the only one there
    # is, so the app and this script still agree.
    APP_DIR="$SELF_DIR/app"
    DIR=$(CDPATH= cd -- "$SELF_DIR/../../.." 2>/dev/null && pwd)
    if [ -z "$DIR" ] || [ ! -f "$DIR/run.sh" ]; then
        DIR=$SELF_DIR
    fi
else
    # Outside it, at the top of the extracted folder: the payload is reached
    # through the bundle, and this directory is the install root.
    APP_DIR="$SELF_DIR/Serene Pub.app/Contents/Resources/app"
    DIR=$SELF_DIR
fi

# ── Where things are ───────────────────────────────────────────────────────
#
# Read the same way src/lib/server/config/preloadEnv.js reads them, and
# best-effort: this only decides which port to probe and where to leave a log,
# never what the app itself does. The app remains the authority on both.

# One KEY=value out of a .env file. Last assignment wins, as dotenv does.
env_file_value() {
    [ -f "$2" ] || return 0
    sed -n "s/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}$1[[:space:]]*=[[:space:]]*//p" "$2" 2>/dev/null \
        | sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/" \
        | tail -n 1
}

# Precedence: the real environment, then the legacy <installRoot>/.env - which
# is the only .env that can name the data directory, since the other one lives
# inside it. Then the platform default (env-paths "SerenePub", no suffix).
DATA_DIR=$SERENE_PUB_DATA_DIR
[ -n "$DATA_DIR" ] || DATA_DIR=$(env_file_value SERENE_PUB_DATA_DIR "$DIR/.env")
[ -n "$DATA_DIR" ] || DATA_DIR="$HOME/Library/Application Support/SerenePub"
# A relative value is anchored to the install root, never to the working
# directory - same rule preloadEnv.js applies, for the same reason.
case "$DATA_DIR" in
    /*) ;;
    *) DATA_DIR="$DIR/$DATA_DIR" ;;
esac

# Environment, then <dataDir>/.env, then the legacy <installRoot>/.env, then
# adapter-node's own default.
APP_PORT=$PORT
[ -n "$APP_PORT" ] || APP_PORT=$(env_file_value PORT "$DATA_DIR/.env")
[ -n "$APP_PORT" ] || APP_PORT=$(env_file_value PORT "$DIR/.env")
[ -n "$APP_PORT" ] || APP_PORT=3000

RECOVERY_URL="http://localhost:$APP_PORT/recovery"
APP_ENTRY="$APP_DIR/run.sh"
NODE_BIN="$APP_DIR/node"
START_TIMEOUT=${SERENE_PUB_START_TIMEOUT:-30}

# Scratch space for this run only. $$ rather than mktemp, which is not POSIX.
WORK_DIR="${TMPDIR:-/tmp}/serene-pub-start-$$"
STOPPED_FILE="$WORK_DIR/stopped"
CODE_FILE="$WORK_DIR/code"
OUTPUT_FILE="$WORK_DIR/output"
# Cleared first: a run interrupted with Ctrl+C leaves this behind, and a later
# run that inherits the same pid would find a "stopped" marker from a start it
# knows nothing about and never watch at all.
rm -rf "$WORK_DIR" 2>/dev/null
mkdir -p "$WORK_DIR" 2>/dev/null || WORK_DIR=

# This shell's own pid, readable from the watch subshell ($$ keeps the parent's
# value there). See the loop below for what it is for.
MAIN_PID=$$

# ── Asking the server what it is ───────────────────────────────────────────
#
# Through the Node runtime that ships beside the app, because it is the one
# HTTP client guaranteed to be present - curl, wget and nc are each absent from
# some perfectly ordinary desktop. Prints exactly one word:
#
#   none     nothing is listening on the port yet
#   busy     something is listening but has not answered - a long migration
#            holds every request until startup finishes, which is not a failure
#   recovery answered with the recovery page: up, with an unopenable database
#   up       answered with anything else, including the 404 a healthy instance
#            serves on /recovery (see src/routes/recovery/guard.ts)
probe_server() {
    [ -x "$NODE_BIN" ] || { echo none; return 0; }
    "$NODE_BIN" -e '
const port = process.argv[1]
fetch("http://127.0.0.1:" + port + "/recovery", {
    signal: AbortSignal.timeout(2000)
})
    .then(function (res) {
        return res.text().then(function (body) {
            const recovery =
                res.status === 503 &&
                body.indexOf("could not open its database") >= 0
            process.stdout.write(recovery ? "recovery" : "up")
        })
    })
    .catch(function (error) {
        // A refused connection means no listener. Anything else - an aborted
        // request, a socket hangup - means something answered the phone and
        // then did not speak, which is what a boot still migrating looks like.
        const code = (error && error.cause && error.cause.code) || ""
        process.stdout.write(code === "ECONNREFUSED" ? "none" : "busy")
    })
' "$APP_PORT" 2>/dev/null
}

# ── Saying so ──────────────────────────────────────────────────────────────

open_recovery_page() {
    if command -v open > /dev/null 2>&1; then
        # Detached: `open` can block for as long as the browser takes to start,
        # and this is running beside a server that is already up.
        open "$RECOVERY_URL" > /dev/null 2>&1 &
    else
        echo "Serene Pub is running in recovery mode: $RECOVERY_URL" >&2
    fi
}

# Everything a bug report needs about a start nobody saw, in the one directory
# that survives an update. Best-effort throughout: a failed start must not turn
# into a failed error report.
write_error_log() {
    _log_dir=$DATA_DIR
    mkdir -p "$_log_dir" 2>/dev/null || _log_dir="${TMPDIR:-/tmp}"
    _log="$_log_dir/serene-pub-last-error.log"
    {
        echo "Serene Pub did not start."
        echo
        echo "When:      $(date 2>/dev/null)"
        echo "Reason:    $1"
        echo "Install:   $DIR"
        # Which of the two copies ran - the one thing that tells a Dock launch
        # from a terminal one once the window is gone.
        echo "Launcher:  $0"
        echo "Data dir:  $DATA_DIR"
        echo "Address:   http://localhost:$APP_PORT"
        echo
        echo "If this says the database could not be opened, the recovery steps are in"
        echo "docs/troubleshooting.md#database-wont-open - online at"
        echo "https://github.com/doolijb/serene-pub/blob/main/docs/troubleshooting.md#database-wont-open"
        echo
        echo "---- output ----"
        if [ -n "$WORK_DIR" ] && [ -f "$OUTPUT_FILE" ]; then
            cat "$OUTPUT_FILE" 2>/dev/null
        else
            echo "(went to the terminal this was launched from)"
        fi
    } > "$_log" 2>/dev/null || return 0
    echo "Wrote $_log" >&2
}

# ── The startup watch ──────────────────────────────────────────────────────
#
# A background subshell rather than backgrounding the app, and that is
# load-bearing: a shell without job control sets SIGINT to be ignored in an
# asynchronous child, and an ignored signal cannot be trapped - so the bundle's
# own Ctrl+C handler would silently stop working and leave the server orphaned.
# The app therefore stays exactly where it was, in the foreground.
watch_startup() {
    _waited=0
    _listening=0
    while :; do
        [ -n "$WORK_DIR" ] && [ -f "$STOPPED_FILE" ] && return 0
        # Ctrl+C kills this shell outright - a non-interactive shell does not
        # trap SIGINT - so the `kill` at the bottom of the file never runs and
        # this subshell, which inherited SIGINT ignored, would poll on alone
        # and eventually report a start the user stopped on purpose as failed.
        kill -0 "$MAIN_PID" 2>/dev/null || return 0
        case "$(probe_server)" in
            recovery)
                open_recovery_page
                return 0
                ;;
            up)
                return 0
                ;;
            busy)
                _listening=1
                ;;
        esac
        if [ "$_waited" -ge "$START_TIMEOUT" ]; then
            if [ "$_listening" -eq 1 ]; then
                # Up, and still working. Saying "did not start" here would be
                # a false alarm on every upgrade with a long migration.
                echo "Serene Pub is taking longer than ${START_TIMEOUT}s to answer on http://localhost:$APP_PORT - still waiting." >&2
            else
                # The log, and only the log. The Linux launcher raises a
                # zenity/notify-send one-liner here; a Mac has neither, and
                # osascript's equivalent asks Finder for permission the first
                # time - a consent prompt on top of a failed start is not an
                # improvement on silence.
                write_error_log "nothing was listening on port $APP_PORT after ${START_TIMEOUT}s"
            fi
            return 0
        fi
        sleep 1
        _waited=$((_waited + 1))
    done
}

WATCH_PID=
if [ -n "$WORK_DIR" ] && [ "$START_TIMEOUT" -gt 0 ] 2>/dev/null; then
    watch_startup &
    WATCH_PID=$!
fi

# ── Run it ─────────────────────────────────────────────────────────────────
#
# With a terminal attached the app is run untouched, keeping a real tty on its
# stdout so its own output is formatted the way it always was. Without one,
# the output is teed: it still goes wherever it was already going (a pipe, a
# redirect, /dev/null under a menu entry) and a copy is kept for the log. The
# exit status travels through a file because a pipeline's $? belongs to tee.

if [ -t 1 ] || [ -z "$WORK_DIR" ]; then
    "$APP_ENTRY" "$@"
    EXIT_CODE=$?
else
    { "$APP_ENTRY" "$@"; echo $? > "$CODE_FILE"; } 2>&1 | tee "$OUTPUT_FILE"
    EXIT_CODE=$(cat "$CODE_FILE" 2>/dev/null)
    [ -n "$EXIT_CODE" ] || EXIT_CODE=1
fi

if [ -n "$WORK_DIR" ]; then
    : > "$STOPPED_FILE" 2>/dev/null
fi
if [ -n "$WATCH_PID" ]; then
    kill "$WATCH_PID" 2>/dev/null
    wait "$WATCH_PID" 2>/dev/null
fi

if [ "$EXIT_CODE" -ne 0 ]; then
    # Nothing is listening any more, so there is no page to send anyone to -
    # deliberately not probed either, because a *previous* instance still up on
    # this port would answer and send them somewhere that has nothing to do
    # with the start that just failed.
    write_error_log "the application exited with code $EXIT_CODE"
fi

if [ "$EXIT_CODE" -ne 0 ] && [ -t 0 ] \
    && [ "$SERENE_PUB_NO_PAUSE" != "1" ] && [ "$SERENE_PUB_NO_PAUSE" != "true" ]; then
    echo
    echo "Press Enter to exit..."
    read _
fi

[ -n "$WORK_DIR" ] && rm -rf "$WORK_DIR" 2>/dev/null

exit "$EXIT_CODE"
