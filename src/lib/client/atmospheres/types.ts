/**
 * **Atmospheres** — the animated background layers that paint with whatever
 * theme is live.
 *
 * An atmosphere is one of two kinds, and the kind decides what it costs after
 * mount. A `canvas` atmosphere draws into a 2D context on the shared rAF loop
 * in `host.ts`. A `css` atmosphere is a few `<div>`s and a stylesheet rule:
 * once mounted it runs no JavaScript at all.
 *
 * Neither kind knows a colour. Both are handed the theme's stops — canvas
 * through `AtmosphereEnv.pal`, CSS through the `--sp-fx*` custom properties the
 * host writes on the layer root — so an atmosphere is never the thing that
 * decides what Serene Pub looks like. See `docs/` for the user-facing side.
 */

/** A colour resolved off the live theme, as `[r, g, b]` in 0–255. */
export type Rgb = readonly [number, number, number]

/** Whether the effect paints once per frame or is already still. */
export type AtmosphereKind = "canvas" | "css"

/**
 * The theme's stops, resolved to RGB so an effect can compose alpha without
 * knowing whether the theme wrote oklch, hex or anything else.
 *
 * `ink`/`page`/`deep` swap roles under a light theme — see `resolvePalette`.
 */
export interface AtmospherePalette {
	dark: boolean
	primary: Rgb
	secondary: Rgb
	tertiary: Rgb
	ink: Rgb
	muted: Rgb
	quiet: Rgb
	page: Rgb
	deep: Rgb
}

/** What a canvas atmosphere is told on every frame it draws. */
export interface AtmosphereEnv {
	/** Layer width in CSS pixels (the context is already DPR-scaled). */
	w: number
	/** Layer height in CSS pixels. */
	h: number
	/** Intensity, 0.12–1.4. Effects read it for density and opacity. */
	k: number
	/** Seconds since the page loaded. */
	t: number
	/** Seconds since the previous frame, clamped to 50ms. */
	dt: number
	pal: AtmospherePalette
}

/** What a canvas atmosphere is told when it builds its state. */
export interface AtmosphereInitEnv {
	w: number
	h: number
	k: number
	rnd: () => number
}

interface AtmosphereBase {
	/** `core:atmosphere/<slug>`. */
	id: string
	/** Sentence-case display name. */
	label: string
	/** One line describing what the effect does, for a picker. */
	blurb: string
	/**
	 * What it looks like when motion is off: `frame` freezes on one rendered
	 * frame, `static` was barely moving to begin with.
	 */
	still: "frame" | "static"
}

export interface CanvasAtmosphere<S = unknown> extends AtmosphereBase {
	kind: "canvas"
	/** Roughly how many things it draws at full intensity — a cost hint. */
	particles: number
	/** Frames to render before freezing, for effects that build up a trail. */
	warm?: number
	/** False keeps the previous frame; the effect fades it itself. */
	clear?: boolean
	init(env: AtmosphereInitEnv): S
	frame(ctx: CanvasRenderingContext2D, state: S, env: AtmosphereEnv): void
}

export interface CssAtmosphere extends AtmosphereBase {
	kind: "css"
	/** The class on the layer's `.fx-dom` element (always `sp-atmo-…`). */
	cls: string
	/** The element's inner markup — a handful of empty divs. */
	html: string
}

export type AtmosphereDefinition = CanvasAtmosphere<any> | CssAtmosphere
