/**
 * THE MESSAGE BACKING (note 18, agreed 2026-10-02) — pure, and the whole
 * decision.
 *
 * A **message backing** is the surface drawn behind a messages widget's log
 * and composer: one pane that stands still while the log scrolls over it,
 * under Comfortable as wide as the column. Three of them:
 *
 *   • `card`  — an opaque card (Skeleton's `card` + a filled surface preset);
 *   • `glass` — a translucent, blurred pane (`preset-glass-surface`, app.css);
 *   • `none`  — nothing: the rows sit on whatever is behind the widget.
 *
 * The GLOBAL THEME owns how a card and a glass pane look — their surface,
 * opacity, blur, border and radius are theme tokens and Skeleton presets
 * (app.css, widgets.css). A message style never draws its backing; it only
 * DECLARES which one it prefers, as the custom property `--sp-backing` in its
 * stylesheet (or its vars). The person's **Card** setting on the widget
 * (`backingMode`) decides whether that preference is followed:
 *
 *   • `auto` — the style's declaration; a style that declares nothing gets a
 *     card when an app background image is set, and nothing otherwise;
 *   • `on`   — always a backing: the style's card or glass, a card if it
 *     declares none;
 *   • `off`  — never a backing, even with an app background.
 *
 * Not the **host card** (`hostCard`, `sessionLayout/hostCard`): that is the
 * card the HOST draws around a whole widget box, which other widgets' Card
 * setting still means. A stored messages-widget `hostCard: true` reads
 * as `on`, `false` as `off` (`withLegacyBackingMode`). Not a **backdrop**
 * (NOMENCLATURE §26, a computed still) and not the app background image.
 */

/** The surfaces a messages widget can be backed by. */
export const MESSAGE_BACKINGS = ["card", "glass", "none"] as const
export type MessageBacking = (typeof MESSAGE_BACKINGS)[number]

/** The person's Card setting on a messages widget. */
export const BACKING_MODES = ["auto", "on", "off"] as const
export type BackingMode = (typeof BACKING_MODES)[number]

/** The setting key (core-owned on a backed widget, in place of `hostCard`). */
export const BACKING_MODE_KEY = "backingMode"

/** The custom property a message style declares its preferred backing in. */
export const BACKING_PROPERTY = "--sp-backing"

/**
 * Widgets whose Card setting is a backing mode rather than a host card: the
 * ones message styles skin. Every copy of the conversation is `messages`.
 */
export const BACKED_WIDGETS: readonly string[] = ["messages"]

export function isBackedWidget(widgetId: string): boolean {
	return BACKED_WIDGETS.includes(widgetId)
}

function isBacking(v: unknown): v is MessageBacking {
	return (
		typeof v === "string" &&
		(MESSAGE_BACKINGS as readonly string[]).includes(v)
	)
}

const DECL_RE = /(?:^|[\s;{])--sp-backing\s*:\s*([a-z]+)\s*(?=[;}!]|$)/gi

/**
 * The backing a style declares, if any: `--sp-backing: card | glass | none`
 * anywhere in its stylesheet (the last one wins, as the cascade would), or in
 * its vars. Comments are not declarations. Anything else is "declares none".
 */
export function declaredBacking(
	skin:
		| { css?: string | null; vars?: Record<string, string> | null }
		| null
		| undefined
): MessageBacking | undefined {
	if (!skin) return undefined
	const fromVars = skin.vars?.[BACKING_PROPERTY] ?? skin.vars?.["sp-backing"]
	if (typeof fromVars === "string" && isBacking(fromVars.trim().toLowerCase()))
		return fromVars.trim().toLowerCase() as MessageBacking
	const css = (skin.css ?? "").replace(/\/\*[\s\S]*?\*\//g, "")
	let found: MessageBacking | undefined
	for (const m of css.matchAll(DECL_RE)) {
		const v = m[1].toLowerCase()
		if (isBacking(v)) found = v
	}
	return found
}

/** A stored setting, read as a mode: only the three values count. */
export function backingModeOf(value: unknown): BackingMode {
	return typeof value === "string" &&
		(BACKING_MODES as readonly string[]).includes(value)
		? (value as BackingMode)
		: "auto"
}

export interface BackingInput {
	/** The widget's `backingMode` setting (untrusted). */
	mode: unknown
	/** What the widget's current style declares (`declaredBacking`). */
	declared: MessageBacking | undefined
	/** Is an app background image painted behind the session? */
	background: boolean
}

/** The backing to draw. */
export function resolveBacking(o: BackingInput): MessageBacking {
	const mode = backingModeOf(o.mode)
	if (mode === "off") return "none"
	if (mode === "on")
		return o.declared === "glass" ? "glass" : "card"
	return o.declared ?? (o.background ? "card" : "none")
}

/**
 * Read a pre-`backingMode` value at read time: a backed widget's stored
 * `hostCard: true | false` becomes `backingMode: "on" | "off"` unless a mode
 * is already stored. Returns the input untouched when there is nothing to map.
 */
export function withLegacyBackingMode(raw: unknown): unknown {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
	const r = raw as Record<string, unknown>
	if (typeof r.hostCard !== "boolean") return raw
	const { hostCard, ...rest } = r
	if (rest[BACKING_MODE_KEY] !== undefined) return rest
	return { ...rest, [BACKING_MODE_KEY]: hostCard ? "on" : "off" }
}
