#!/bin/bash
# Adds Serene Pub to your applications menu, pointing at wherever this folder
# actually is — run this once after extracting the release, and again if you
# move the folder. Nothing else is installed anywhere on your system.
set -e
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# The spec-mandated location for a per-user entry. The menu only reads entries
# from here (or the system-wide /usr/share/applications) — a .desktop file left
# sitting in the extracted folder is not "installed" in any sense, which is
# what the previous version of this script produced.
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_FILE="$APPS_DIR/serene-pub.desktop"
mkdir -p "$APPS_DIR"

# Only Exec= needs the Desktop Entry spec's own quoting rules — it's the one
# field parsed as a command line (space-separated arguments), so a value
# containing a space (the common case here — people extract into paths with
# spaces) must be double-quoted, with any literal backslash/backtick/dollar/
# double-quote within it escaped with a backslash. Icon= and Path= are plain
# single string values, not argument lists — confirmed against
# desktop-file-validate, which flags a quoted Icon/Path as *not* looking
# like a valid path (the quote characters would become part of the value).
escape_exec_value() {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/`/\\`/g' -e 's/\$/\\$/g'
}
ESCAPED_DIR="$(escape_exec_value "$DIR")"

# Exec= points at the top-level run.sh forwarder, never straight into app/:
# app/ is the directory an update replaces wholesale, and a later release
# swaps this forwarder for a compiled launcher at the same path. Both stay
# true for an entry written against run.sh.
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Serene Pub
Comment=AI Chat Application
Exec="$ESCAPED_DIR/run.sh"
Icon=$DIR/favicon.png
Terminal=false
Categories=Network;Chat;
StartupNotify=true
Path=$DIR
EOF

# Some desktops cache the menu; harmless and absent on plenty of systems.
if command -v update-desktop-database > /dev/null 2>&1; then
    update-desktop-database "$APPS_DIR" > /dev/null 2>&1 || true
fi

echo "Serene Pub added to your applications menu."
echo "Entry: $DESKTOP_FILE"
echo "Remove it again with: rm \"$DESKTOP_FILE\""
