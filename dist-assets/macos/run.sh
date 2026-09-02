#!/bin/sh
# Serene Pub - launcher
# Licensed under AGPL-3.0 - See LICENSE file
# Source: https://github.com/doolijb/serene-pub
#
# A forwarder, deliberately trivial: the real entrypoint is the run.sh inside
# the application bundle, where everything that makes up the application lives
# so an update can replace it wholesale. This file stays outside the bundle, at
# the path people bookmark and put in their shortcuts, so those keep working
# across updates. A later release replaces it with a compiled launcher; keeping
# it to a single exec is what makes that swap clean.
#
# Run the bundle's app/run.sh directly for a headless Mac, a launchd job, or
# debugging. Double-clicking "Serene Pub.app" gets you here too.

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$DIR/Serene Pub.app/Contents/Resources/app/run.sh" "$@"
