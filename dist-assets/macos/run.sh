#!/bin/sh
# Serene Pub - launcher
# Licensed under AGPL-3.0 - See LICENSE file
# Source: https://github.com/doolijb/serene-pub
#
# A forwarder, deliberately trivial: the real entrypoint is the run.sh inside
# the application bundle, where everything that makes up the application lives
# so an update can replace it wholesale. This file stays outside the bundle, at
# the path people bookmark and put in their shortcuts, so those keep working
# across updates. A later release replaces it with a compiled launcher, which
# will own error display itself; keeping this near-trivial is what makes that
# swap clean.
#
# Run the bundle's app/run.sh directly for a headless Mac, a launchd job, or
# debugging. Double-clicking "Serene Pub.app" gets you here too.
#
# The one thing this adds over calling the bundle's run.sh directly: on
# failure, if someone is sitting at an interactive terminal (as when
# double-clicking this file from a file manager), it waits for a keypress so
# the window doesn't close before they can read the error. A successful run
# never pauses, and SERENE_PUB_NO_PAUSE=1 (or "true") skips the pause
# unconditionally.

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$DIR/Serene Pub.app/Contents/Resources/app/run.sh" "$@"
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ] && [ -t 0 ] \
    && [ "$SERENE_PUB_NO_PAUSE" != "1" ] && [ "$SERENE_PUB_NO_PAUSE" != "true" ]; then
    echo
    echo "Press Enter to exit..."
    read _
fi

exit "$EXIT_CODE"
