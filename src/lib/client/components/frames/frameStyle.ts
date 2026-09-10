/**
 * The frame half of the widget skin (PLAN 25, ruled 2026-08-30).
 *
 * A frame widget is a widget: the host resolves ONE skin for it exactly as it
 * does for a native one (`effectiveWidgetSkin` — the pinned row, or the unsaved
 * draft while its editor is open) and injects it. The only thing that differs
 * is where it lands. Native gets a scoped `<style>` in THIS document; a frame
 * gets its own document's `<style>`, pushed over the port as `{ t: "style" }`.
 *
 * That difference is why this uses the store's UNSCOPED `sanitizeWidgetCss`.
 * Scoping exists to stop a skin bleeding out of its widget's box, and an
 * opaque-origin iframe already is that boundary — `body {}` inside it means the
 * frame's body and can reach nothing else, so rewriting selectors would only
 * make a frame skin unable to say the one thing it is for. What the sanitiser
 * still refuses is the other half of the boundary: `@import` and cross-origin
 * `url()` / `image-set()` are exfiltration rather than bleed, and a skin can be
 * marked `shared` — i.e. it runs in other people's browsers — so a beacon is
 * refused whichever document it would fire from.
 */
import {
	sanitizeWidgetCss,
	varsToStyle
} from "$lib/client/stores/widgetStyles.svelte"

/**
 * Frame protocol v1: the host's skin push. See `PluginFrame.svelte`.
 *
 * A type alias rather than an interface so it keeps an implicit index
 * signature — `PluginFrame.post()` takes the protocol's common
 * `Record<string, unknown>`, and an interface is not assignable to one.
 */
export type FrameStyleMessage = {
	t: "style"
	css: string
	vars: Record<string, string>
}

/**
 * A skin's `vars`, filtered EXACTLY as the native path filters them, as the
 * record a frame hands to `style.setProperty`.
 *
 * Spent through `varsToStyle` and parsed back rather than re-implemented: the
 * rule it enforces (a var value can smuggle a cross-origin `url()` that a
 * `var()` elsewhere fetches for real) is one rule, and a second copy of it is a
 * copy that drifts. The round trip is safe by construction — `varsToStyle`
 * strips `;`, `{` and `}` from every value it emits, so no declaration in its
 * output can contain the separator split on here.
 */
export function sanitizeFrameVars(
	vars: Record<string, string> | null | undefined
): Record<string, string> {
	const out: Record<string, string> = {}
	for (const decl of varsToStyle(vars).split(";")) {
		// `--name:value` — the name cannot contain a colon (VAR_KEY_RE), so the
		// FIRST one splits it and a value like `url("data:…")` stays whole.
		const at = decl.indexOf(":")
		if (at < 1) continue
		out[decl.slice(0, at)] = decl.slice(at + 1)
	}
	return out
}

/**
 * The `style` message for a resolved skin.
 *
 * An absent skin is an empty style rather than no message at all: taking a skin
 * off has to reach the frame, and a host that simply stopped posting would
 * leave the last one applied for ever.
 */
export function buildStyleMessage(
	skin:
		| { css?: string | null; vars?: Record<string, string> | null }
		| null
		| undefined
): FrameStyleMessage {
	return {
		t: "style",
		css: sanitizeWidgetCss(skin?.css ?? ""),
		vars: sanitizeFrameVars(skin?.vars)
	}
}
