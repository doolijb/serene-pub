#!/bin/sh
# Serene Pub - terminal shortcut into the bare entrypoint (portable zip only)
# Licensed under AGPL-3.0 - See LICENSE file
# Source: https://github.com/doolijb/serene-pub
#
# Double-click "Serene Pub.app" for the normal start (menu-bar icon, window or
# browser, in-app updates). This file is for a terminal: it runs the server
# that lives inside the bundle, with no launcher, and prints its output here -
# for a headless Mac, a launchd job, or debugging a start-up problem.
#
# It does nothing but exec the bundle's bare entrypoint, so it keeps working
# when an update replaces "Serene Pub.app" wholesale.
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$DIR/Serene Pub.app/Contents/Resources/app/run.sh" "$@"
