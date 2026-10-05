// scripts/android-icons.js
//
// Writes the Android launcher icons from static/icon-x1024.png — the same
// artwork as the web, desktop and tray icons — so the APK cannot fall behind
// them again. Run after changing that file:
//
//     npm run android:icons
//
// Outputs, under android/app/src/main/res/:
//   mipmap-anydpi-v26/ic_launcher.xml, ic_launcher_round.xml
//       the adaptive icon every device uses (minSdk is 26)
//   mipmap-<density>/ic_launcher_foreground.png
//       the artwork centred on the 108 dp adaptive canvas
//   values/ic_launcher_background.xml
//       the background colour: the web app's theme-color (src/app.html)
//   mipmap-<density>/ic_launcher.png, ic_launcher_round.png
//       pre-masked 48 dp fallbacks, for anything that reads the bitmaps

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import sharp from "sharp"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE = path.join(root, "static", "icon-x1024.png")
const RES = path.join(root, "android", "app", "src", "main", "res")

export const BACKGROUND = "#1B2338"

// Adaptive icons are 108 dp; launchers mask the inner 72 dp to a circle,
// squircle or rounded square. At 60 dp the artwork's furthest point (an ear
// tip, 577 of 1024 px from the centre) stays inside even the circle mask.
const CANVAS_DP = 108
const VISIBLE_DP = 72
const ART_DP = 60
const LEGACY_DP = 48

export const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }

async function foreground(px) {
	const art = Math.round((px * ART_DP) / CANVAS_DP)
	const inset = Math.floor((px - art) / 2)
	const resized = await sharp(SOURCE)
		.resize(art, art, { kernel: "lanczos3" })
		.png()
		.toBuffer()
	return sharp({
		create: {
			width: px,
			height: px,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 }
		}
	})
		.composite([{ input: resized, left: inset, top: inset }])
		.png()
		.toBuffer()
}

/** What a launcher shows: background + foreground, inner 72 dp, masked. */
async function legacy(px, round) {
	const canvas = 432 // 108 dp at xxxhdpi; downscaled at the end
	const visible = (canvas * VISIBLE_DP) / CANVAS_DP
	const offset = (canvas - visible) / 2
	const mask = round
		? `<svg width="${visible}" height="${visible}"><circle cx="${visible / 2}" cy="${visible / 2}" r="${visible / 2}"/></svg>`
		: `<svg width="${visible}" height="${visible}"><rect width="${visible}" height="${visible}" rx="${visible * 0.12}"/></svg>`
	const full = await sharp({
		create: {
			width: canvas,
			height: canvas,
			channels: 4,
			background: BACKGROUND
		}
	})
		.composite([{ input: await foreground(canvas) }])
		.png()
		.toBuffer()
	const masked = await sharp(full)
		.extract({ left: offset, top: offset, width: visible, height: visible })
		.composite([{ input: Buffer.from(mask), blend: "dest-in" }])
		.png()
		.toBuffer()
	return sharp(masked).resize(px, px, { kernel: "lanczos3" }).png().toBuffer()
}

const ADAPTIVE = `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by scripts/android-icons.js — edit static/icon-x1024.png and rerun. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`

export async function writeAndroidIcons() {
	const anydpi = path.join(RES, "mipmap-anydpi-v26")
	fs.mkdirSync(anydpi, { recursive: true })
	fs.writeFileSync(path.join(anydpi, "ic_launcher.xml"), ADAPTIVE)
	fs.writeFileSync(path.join(anydpi, "ic_launcher_round.xml"), ADAPTIVE)
	fs.writeFileSync(
		path.join(RES, "values", "ic_launcher_background.xml"),
		`<?xml version="1.0" encoding="utf-8"?>
<!-- Written by scripts/android-icons.js: the web app's theme-color. -->
<resources>
    <color name="ic_launcher_background">${BACKGROUND}</color>
</resources>
`
	)
	for (const [density, scale] of Object.entries(DENSITIES)) {
		const dir = path.join(RES, `mipmap-${density}`)
		fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(
			path.join(dir, "ic_launcher_foreground.png"),
			await foreground(Math.round(CANVAS_DP * scale))
		)
		fs.writeFileSync(
			path.join(dir, "ic_launcher.png"),
			await legacy(Math.round(LEGACY_DP * scale), false)
		)
		fs.writeFileSync(
			path.join(dir, "ic_launcher_round.png"),
			await legacy(Math.round(LEGACY_DP * scale), true)
		)
	}
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await writeAndroidIcons()
	console.log(
		`Android launcher icons written from ${path.relative(root, SOURCE)}`
	)
}
