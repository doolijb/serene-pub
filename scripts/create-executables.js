#!/usr/bin/env node

/**
 * Script to create platform-specific executables with custom icons
 * This script generates clickable applications for Windows, Linux, and macOS
 */

import fs from "fs"
import path from "path"
import { execSync } from "child_process"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const packageJson = JSON.parse(
	fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")
)
// Confirmed stale before this fix: the macOS Info.plist below had "0.4.1"
// hardcoded while package.json had already moved past it — read live
// instead of duplicating the version as a literal.
const appVersion = packageJson.version

const platforms = {
	windows: {
		name: "Serene Pub.exe",
		launcher: "Serene Pub.bat",
		icon: "favicon.ico",
		template: "serene-pub-launcher.exe"
	},
	linux: {
		name: "Serene Pub",
		executable: "Serene Pub",
		icon: "favicon.png",
		desktop: "Serene Pub.desktop"
	},
	macos: {
		name: "Serene Pub.app",
		icon: "favicon.icns",
		bundle: "Serene Pub.app"
	}
}

async function createExecutables() {
	console.log("🚀 Creating platform-specific executables...")

	// Ensure output directories exist
	const distDir = path.join(__dirname, "..", "dist-assets")
	const staticDir = path.join(__dirname, "..", "static")
	const faviconSource = path.join(staticDir, "favicon.png")

	// Check if favicon exists
	if (!fs.existsSync(faviconSource)) {
		console.error("❌ favicon.png not found in static directory")
		return
	}

	for (const [platform, config] of Object.entries(platforms)) {
		const platformDir = path.join(distDir, platform)

		if (!fs.existsSync(platformDir)) {
			console.log(`📁 Creating directory: ${platformDir}`)
			fs.mkdirSync(platformDir, { recursive: true })
		}

		// Copy favicon to platform directory
		const faviconDest = path.join(platformDir, "favicon.png")
		fs.copyFileSync(faviconSource, faviconDest)
		console.log(`📎 Copied favicon to ${platform}`)

		console.log(`🔧 Processing ${platform}...`)

		switch (platform) {
			case "windows":
				await createWindowsExecutable(platformDir, config)
				break
			case "linux":
				await createLinuxExecutable(platformDir, config)
				break
			case "macos":
				await createMacOSExecutable(platformDir, config)
				break
		}
	}

	console.log("✅ All executables created successfully!")
	console.log("")
	console.log("📋 Next steps:")
	console.log(
		'  Windows: Convert "Serene Pub.bat" to "Serene Pub.exe" with custom icon'
	)
	console.log(
		'  Linux: Use "Serene Pub" executable or "Serene Pub.desktop" file'
	)
	console.log("  macOS: Convert favicon.png to .icns and place in app bundle")
}

async function createWindowsExecutable(platformDir, config) {
	// Create a simple batch wrapper that launches the existing run.cmd script
	const launcherBat = path.join(platformDir, "Serene Pub.bat")
	const content = `@echo off
REM Serene Pub Application Launcher
REM This launches the main run.cmd script
cd /d "%~dp0"
call run.cmd
`
	fs.writeFileSync(launcherBat, content)

	// We'll need to use a tool like ResourceHacker or create a proper .exe
	// For now, create instructions for manual icon setting
	const iconInstructions = path.join(platformDir, "ICON_SETUP.txt")
	const instructions = `To set up the application icon:

1. Convert favicon.png to favicon.ico using an online converter
2. Use Resource Hacker (http://www.angusj.com/resourcehacker/) to:
   - Open "Serene Pub Launcher.bat"
   - Add the favicon.ico as the application icon
   - Save as "Serene Pub.exe"

Or use a batch-to-exe converter that supports custom icons.
`
	fs.writeFileSync(iconInstructions, instructions)

	console.log(`   ✓ Windows launcher created: ${launcherBat}`)
}

async function createLinuxExecutable(platformDir, config) {
	// A .desktop file's Exec=/Icon=/Path= must be absolute paths to wherever
	// the user actually extracted the release — a value baked in here, at
	// build time, only ever reflects the build machine's own path (this repo
	// shipped exactly that bug: the checked-in .desktop file pointed at a
	// path that exists on no user's machine). Generate an installer script
	// instead, shipped alongside run.sh, that a user runs once after
	// extracting — it resolves its own directory at runtime (same pattern
	// already used by the executable wrapper below) and writes the .desktop
	// file with the correct local paths right there.
	const installScript = path.join(platformDir, "install-desktop-shortcut.sh")
	const installScriptContent = `#!/bin/bash
# Creates a Linux desktop shortcut for Serene Pub, pointing at wherever this
# script actually lives — run this once after extracting the release.
set -e
DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Only Exec= needs the Desktop Entry spec's own quoting rules — it's the one
# field parsed as a command line (space-separated arguments), so a value
# containing a space (the common case here — "Serene Pub" is the app's own
# name) must be double-quoted, with any literal backslash/backtick/dollar/
# double-quote within it escaped with a backslash. Icon= and Path= are plain
# single string values, not argument lists — confirmed against
# desktop-file-validate, which flags a quoted Icon/Path as *not* looking
# like a valid path (the quote characters would become part of the value).
escape_exec_value() {
    printf '%s' "$1" | sed -e 's/\\\\/\\\\\\\\/g' -e 's/"/\\\\"/g' -e 's/\`/\\\\\`/g' -e 's/\\$/\\\\$/g'
}
ESCAPED_DIR="$(escape_exec_value "$DIR")"

DESKTOP_FILE="$DIR/Serene Pub.desktop"
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
chmod +x "$DESKTOP_FILE"

echo "Desktop shortcut created: $DESKTOP_FILE"
echo "Double-click it to launch Serene Pub, or copy it to ~/.local/share/applications/ to add it to your app menu."
`

	fs.writeFileSync(installScript, installScriptContent)

	try {
		execSync(`chmod +x "${installScript}"`)
		console.log(`   ✓ Linux desktop-shortcut installer created: ${installScript}`)
	} catch (error) {
		console.log(
			`   ⚠️  Installer script created but chmod failed: ${installScript}`
		)
	}

	// Create a simple executable wrapper that calls the existing run.sh
	const executableScript = path.join(platformDir, config.executable)
	const scriptContent = `#!/bin/bash
# Serene Pub Application Launcher
# This launches the main run.sh script
DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$DIR"
exec ./run.sh
`

	fs.writeFileSync(executableScript, scriptContent)

	try {
		execSync(`chmod +x "${executableScript}"`)
		console.log(`   ✓ Linux executable created: ${executableScript}`)
	} catch (error) {
		console.log(
			`   ⚠️  Executable created but chmod failed: ${executableScript}`
		)
	}
}

async function createMacOSExecutable(platformDir, config) {
	// Create macOS .app bundle structure
	const appBundle = path.join(platformDir, "Serene Pub.app")
	const contentsDir = path.join(appBundle, "Contents")
	const macOSDir = path.join(contentsDir, "MacOS")
	const resourcesDir = path.join(contentsDir, "Resources")

	// Create directories
	fs.mkdirSync(appBundle, { recursive: true })
	fs.mkdirSync(contentsDir, { recursive: true })
	fs.mkdirSync(macOSDir, { recursive: true })
	fs.mkdirSync(resourcesDir, { recursive: true })

	// Create Info.plist
	const infoPlist = path.join(contentsDir, "Info.plist")
	const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>serene-pub</string>
	<key>CFBundleIdentifier</key>
	<string>com.doolijb.serene-pub</string>
	<key>CFBundleName</key>
	<string>Serene Pub</string>
	<key>CFBundleVersion</key>
	<string>${appVersion}</string>
	<key>CFBundleShortVersionString</key>
	<string>${appVersion}</string>
	<key>CFBundleIconFile</key>
	<string>favicon.icns</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>LSMinimumSystemVersion</key>
	<string>10.15</string>
</dict>
</plist>
`
	fs.writeFileSync(infoPlist, plistContent)

	// Create executable script that launches the existing run.sh
	const executableScript = path.join(macOSDir, "serene-pub")
	const scriptContent = `#!/bin/bash
# Serene Pub Application Launcher for macOS
# This launches the main run.sh script
APP_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
BUNDLE_DIR="$( cd "$APP_DIR/../.." &> /dev/null && pwd )"
cd "$BUNDLE_DIR"
exec ./run.sh
`

	fs.writeFileSync(executableScript, scriptContent)

	try {
		execSync(`chmod +x "${executableScript}"`)
		console.log(`   ✓ macOS app bundle created: ${appBundle}`)
	} catch (error) {
		console.log(`   ⚠️  App bundle created but chmod failed: ${appBundle}`)
	}

	// Create instructions for icon conversion
	const iconInstructions = path.join(platformDir, "ICON_SETUP.txt")
	const instructions = `To set up the application icon:

1. Convert favicon.png to favicon.icns using:
   - sips command: sips -s format icns favicon.png --out Resources/favicon.icns
   - Or use an online converter
   - Or use Image2icon app

2. Place the favicon.icns file in: Serene Pub.app/Contents/Resources/

The .app bundle is ready to use after adding the icon.
`
	fs.writeFileSync(iconInstructions, instructions)
}

// Run the script
createExecutables().catch(console.error)
