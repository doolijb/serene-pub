/**
 * THE PANEL'S CARD (PLAN R7, D9) — pure. The host draws the backing on the
 * PANEL box as four CSS custom properties, from the layout's look; a widget's
 * style may override them.
 */

import { filterWidgetStyleValue } from "../stores/widgetStyles.svelte"

export const WIDGET_BOX_VARS = [
	"--sp-widget-margin",
	"--sp-widget-background",
	"--sp-widget-radius",
	"--sp-widget-border"
] as const
export type WidgetBoxVar = (typeof WIDGET_BOX_VARS)[number]
export type WidgetBox = Partial<Record<WidgetBoxVar, string>>

interface Look {
	backing: "card" | "glass" | "none"
	opacity: number
}

const pct = (v: unknown): number =>
	typeof v === "number" && Number.isFinite(v)
		? Math.min(100, Math.max(0, v))
		: 100

/** The host's values for a layout look. */
export function hostWidgetBox(look: Look): Required<WidgetBox> {
	const op = pct(look.opacity)
	if (look.backing === "card")
		return {
			"--sp-widget-margin": "0",
			"--sp-widget-background": `color-mix(in oklab, var(--color-surface-100-900) ${op}%, transparent)`,
			"--sp-widget-radius": "var(--radius-container)",
			// No border around a widget (owner, 2026-11-06); a style may add one.
			"--sp-widget-border": "none"
		}
	if (look.backing === "glass")
		return {
			"--sp-widget-margin": "0",
			"--sp-widget-background": `color-mix(in oklab, var(--sp-glass-bg) ${op}%, transparent)`,
			"--sp-widget-radius": "var(--radius-container)",
			"--sp-widget-border": "none"
		}
	return {
		"--sp-widget-margin": "0",
		"--sp-widget-background": "transparent",
		"--sp-widget-radius": "0",
		"--sp-widget-border": "none"
	}
}

// A backslash is a CSS escape: `u\72 l(` reads as `url(` and the app filter does not decode it.
const UNSAFE = /[;{}<\\]|url\(/i

function safe(v: unknown): string | undefined {
	if (typeof v !== "string") return undefined
	const t = v.trim()
	if (t === "" || UNSAFE.test(t)) return undefined
	// The app's style filter is stricter (image-set(), escaped url, breakout):
	// a value it would change is dropped, never partly kept.
	if (filterWidgetStyleValue(t) !== t) return undefined
	return t
}

/** What a style declares for the four: vars first (they beat the CSS), then its CSS (the last declaration wins; comments ignored). */
export function declaredWidgetBox(
	skin:
		| { css?: string | null; vars?: Record<string, string> | null }
		| null
		| undefined
): WidgetBox {
	if (!skin) return {}
	const out: WidgetBox = {}
	const css = (skin.css ?? "").replace(/\/\*[\s\S]*?\*\//g, "")
	for (const name of WIDGET_BOX_VARS) {
		const bare = name.slice(2)
		const fromVars = safe(skin.vars?.[name] ?? skin.vars?.[bare])
		// A custom property's value runs to the next `;` or `}`.
		const re = new RegExp(`(?:^|[\\s;{])${name}\\s*:\\s*([^;}]*)`, "gi")
		let fromCss: string | undefined
		for (const m of css.matchAll(re))
			fromCss = safe(m[1].replace(/!important\s*$/i, ""))
		const v = fromVars ?? fromCss
		if (v !== undefined) out[name] = v
	}
	return out
}

/** The host's values with the style's on top, as one inline style string. */
export function widgetBoxStyle(
	look: Look,
	skin: Parameters<typeof declaredWidgetBox>[0]
): string {
	const box = { ...hostWidgetBox(look), ...declaredWidgetBox(skin) }
	return WIDGET_BOX_VARS.map((k) => `${k}: ${box[k]}`).join("; ")
}

/** Does the panel draw a backing (chrome.card)? */
export function backingShown(look: Pick<Look, "backing">): boolean {
	return look.backing !== "none"
}
