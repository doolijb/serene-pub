import type { AtmospherePalette, Rgb } from "./types"

/**
 * Read the live theme's stops as RGB.
 *
 * Effects need to compose alpha (`rgba(pal.primary, .35)`), and a theme stop is
 * whatever syntax its author wrote — Lamplight is `oklch(...)`, Skeleton's
 * built-ins need not be, and a future theme may be something else again.
 * Rather than parse any of it, a stop is painted into a 1×1 canvas and read
 * back: the browser's own colour parser answers, so every syntax it
 * understands works here without this file knowing one of them.
 */

/** Lamplight's stops, for the window before a theme stylesheet has applied. */
const FALLBACK = {
	"primary-500": [227, 184, 93],
	"secondary-500": [167, 190, 243],
	"tertiary-500": [97, 151, 163],
	"surface-50": [231, 234, 241],
	"surface-100": [225, 228, 235],
	"surface-400": [145, 159, 191],
	"surface-500": [100, 118, 161],
	"surface-600": [82, 98, 137],
	"surface-900": [42, 50, 72],
	"surface-950": [27, 35, 56]
} as const satisfies Record<string, Rgb>

type StopName = keyof typeof FALLBACK

/** The 1×1 probe, made once and kept — see the note at the top of the file. */
let probe: CanvasRenderingContext2D | null | undefined

function probeContext(): CanvasRenderingContext2D | null {
	if (probe === undefined) {
		const canvas = document.createElement("canvas")
		canvas.width = canvas.height = 1
		probe = canvas.getContext("2d", { willReadFrequently: true })
	}
	return probe
}

function toRgb(value: string, fallback: Rgb): Rgb {
	const colour = value.trim()
	if (!colour) return fallback
	const ctx = probeContext()
	if (!ctx) return fallback
	// fillStyle keeps its previous value when handed something it cannot
	// parse, so it is reset to a known colour first: an unparseable stop
	// paints black rather than whatever the last stop happened to be.
	ctx.fillStyle = "#000000"
	ctx.fillStyle = colour
	ctx.fillRect(0, 0, 1, 1)
	const data = ctx.getImageData(0, 0, 1, 1).data
	return [data[0], data[1], data[2]]
}

/** `rgb(r g b)`, or `rgb(r g b / a)` below full opacity. */
export function rgba(c: Rgb, a = 1): string {
	return a >= 1
		? `rgb(${c[0]} ${c[1]} ${c[2]})`
		: `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`
}

/**
 * The stops an atmosphere paints with, read off `<html>` right now.
 *
 * A light theme swaps the ink and ground roles rather than inverting anything:
 * the effects are written against "ink is the far end of the ladder from the
 * page", which is stop 50 on a dark theme and stop 950 on a light one.
 */
export function resolvePalette(): AtmospherePalette {
	const root = document.documentElement
	const dark = root.getAttribute("data-mode") !== "light"
	const style = getComputedStyle(root)
	const stop = (name: StopName): Rgb =>
		toRgb(style.getPropertyValue(`--color-${name}`), FALLBACK[name])
	// Skeleton's ladders all carry a 100, but a theme is free not to, and a
	// light page falling back to the 50 is one step flatter rather than wrong.
	const lightPage = style.getPropertyValue("--color-surface-100").trim()
		? stop("surface-100")
		: stop("surface-50")
	return {
		dark,
		primary: stop("primary-500"),
		secondary: stop("secondary-500"),
		tertiary: stop("tertiary-500"),
		ink: dark ? stop("surface-50") : stop("surface-950"),
		muted: dark ? stop("surface-400") : stop("surface-600"),
		quiet: stop("surface-500"),
		page: dark ? stop("surface-900") : lightPage,
		deep: dark ? stop("surface-950") : stop("surface-50")
	}
}
