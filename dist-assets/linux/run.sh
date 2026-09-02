#!/bin/sh
# Serene Pub - launcher
# Licensed under AGPL-3.0 - See LICENSE file
# Source: https://github.com/doolijb/serene-pub
#
# A forwarder, deliberately trivial: the real entrypoint is app/run.sh, and
# everything that makes up the application lives under app/ so an update can
# replace that one directory wholesale. This file stays outside it, at the
# path people bookmark, pin and put in their shortcuts, so those keep working
# across updates. A later release replaces it with a compiled launcher; keeping
# it to a single exec is what makes that swap clean.
#
# Run app/run.sh directly for a headless box, a systemd unit, or debugging.

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$DIR/app/run.sh" "$@"
