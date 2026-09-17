/**
 * The message STYLE PACKS, declared app-side as widget style presets (PLAN 25;
 * the "packs become per-widget style choices" ruling of 2026-08-30).
 *
 * ## Why they live here and not in the SDK
 *
 * `CORE_WIDGETS` (`@serene-pub/core-catalog`, `ui/sessions/widgets.ts`) is the
 * announcement: which widgets exist, what they request, and — for a widget
 * whose look the SDK owns — the presets it ships. The five message packs are
 * NOT the SDK's look: every selector in them (`.sp-msg`, `.sp-msg-avatar`) is a
 * class the APP's SessionMessage authors, and the SDK has no view of that
 * markup at all. So the app contributes them for its own primary widget here,
 * and `withCorePresets` is the single seam the boot seed passes them through.
 * Nothing in the SDK changed.
 *
 * The composer is part of that same widget and its look is a SETTING on it
 * (`CORE_WIDGETS`'s `composer` field), not a skin: a style is CSS over one
 * widget's markup, and which of three shapes the field takes is a fact the
 * component reads, not a stylesheet. A message pack therefore carries no
 * `.sp-compose` / `.sp-composer` rule.
 *
 * ## The `default` slot carries Stage
 *
 * `resolveStyle` degrades an unresolvable (or absent) pin to
 * `systemStyleSlug(widgetId, "default")`, so the `default` slug is the SLOT an
 * unpinned widget lands in — and that slot has to hold the house look, which is
 * Stage. Hence Stage IS the `default` preset (titled "Stage") rather than an
 * additional row beside an empty one: an empty `default` alongside a separate
 * `stage` would silently un-style every existing session on upgrade, and
 * dropping `default` entirely would leave the fallback to `defaultStyleFor`'s
 * "first row for the widget", which is list order — i.e. alphabetical by title,
 * i.e. Bubbles. **Stage is a display name only** (NOMENCLATURE §23): the
 * reading column is `.sp-column`, never `.sp-stage`.
 *
 * ## The markup a pack is written against
 *
 * `messageLayouts.css` holds the zero-styled base: the four-cell grid
 * (`avatar identity controls` over `content`), the avatar sized by `--sp-av`
 * and `--sp-av-radius`, the control boxes, and the shared message-STATE
 * overlays (selected / dim / editing / hidden). A pack restructures by
 * overriding `grid-template-areas` and the four cells; it never restyles a
 * state, so selection and the editing outline are one treatment everywhere.
 *
 * Story prose is set in two tones (STYLE-GUIDE §3.3) through a pair of custom
 * properties the pack OWNS and `app.css` reads: `--sp-body` colours the prose
 * and `--sp-quote` colours dialogue inside quotation marks, both resolved
 * under `.sp-conversation`. A pack that sets neither gets one flat tone.
 *
 * ## Colour: roles, and a light/dark pair for anything that needs one
 *
 * A preset's CSS is injected scoped to the widget's own box (`scopeWidgetCss`),
 * so it can only ever select the widget and its descendants — `[data-mode]`
 * lives on `<html>`, an ANCESTOR no scoped skin can reach. A theme's colour
 * ladder is also ONE ladder rather than a light/dark pair: `--color-surface-950`
 * is night indigo under a light theme too. So every value that differs by mode
 * is written as `light-dark(light, dark)`, which resolves against the
 * `color-scheme` Skeleton sets on `:root` and needs no ancestor selector. A
 * clone of a pack inherits the pairing and keeps working in both modes.
 *
 * Each pack opens by naming its palette on `.sp-conversation` — the two prose
 * tones plus who-is-speaking and the aside tone — so a person editing a clone
 * changes one block rather than hunting through rules.
 */
import { systemStyleSlug, type WidgetDecl, type WidgetStylePreset, type WidgetStyleRef } from "./types"
import type { ResolvableStyle } from "./resolve"

/* ── the message packs ───────────────────────────────────────────────── */

/**
 * STAGE — the house look. Occupies the `default` slot (see the file header):
 * what an unpinned messages widget resolves to.
 */
const STAGE_CSS = `/* Stage — prose in a reading column, the cast in lamp gold, the persona's turn
   on a card, narration a centred aside with no portrait. */
.sp-conversation {
	--sp-quote: light-dark(var(--color-surface-950), var(--color-surface-50));
	--sp-body: light-dark(var(--color-surface-700), var(--color-surface-300));
	--sp-speaker: light-dark(var(--color-primary-700), var(--color-primary-500));
	--sp-speaker-persona: light-dark(var(--color-surface-800), var(--color-surface-200));
	--sp-aside: light-dark(var(--color-surface-600), var(--color-surface-400));
	--sp-stage-card: light-dark(var(--color-surface-50), var(--color-surface-950));
	--sp-stage-edge: light-dark(var(--color-surface-300), var(--color-surface-800));
	--sp-stage-hover: light-dark(
		color-mix(in oklab, var(--color-surface-500) 10%, transparent),
		color-mix(in oklab, var(--color-surface-950) 55%, transparent)
	);
}
.sp-msg {
	position: relative;
	column-gap: 0.75rem;
	row-gap: 0.25rem;
	padding: 0.5rem 0.75rem;
	border-radius: 12px;
}
/* Guarded on the NORMAL state so the shared selected / dim / editing overlay
   keeps the message under the pointer. */
.sp-msg[data-msg-state="normal"]:hover,
.sp-msg[data-msg-state="normal"]:focus-within {
	background: var(--sp-stage-hover);
}
.sp-msg-avatar {
	--sp-av: 2.5rem;
	--sp-av-radius: 9999px;
}
.sp-msg-name {
	color: var(--sp-speaker);
}
.sp-msg[data-msg-author="persona"] .sp-msg-name {
	color: var(--sp-speaker-persona);
}
.sp-msg-body {
	font-family: var(--sp-prose);
	font-size: 17px;
	line-height: 1.65;
}
/* The scene's edge: a 2px rule in the row's own --sp-scene, at the leading edge
   INSIDE the message's padding box, where a scrolling log cannot clip it and
   no horizontal scrollbar can appear. */
.sp-msg-row[style*="--sp-scene"] .sp-msg::before {
	content: "";
	position: absolute;
	inset-block: 10px;
	inset-inline-start: 0;
	width: 2px;
	border-radius: 2px;
	background: var(--sp-scene);
	opacity: 0.55;
}
/* The persona's turn reads as a card; the cast's sits straight on the page. */
.sp-msg[data-msg-author="persona"] .sp-msg-content {
	background: var(--sp-stage-card);
	border: 1px solid var(--sp-stage-edge);
	border-radius: 12px;
	padding: 14px 16px;
	margin-top: 6px;
}
/* Narration: centred italic, no portrait, the name reduced to a quiet label. */
.sp-msg[data-msg-role="narration"] {
	grid-template-columns: minmax(0, 1fr) auto;
	grid-template-areas:
		"identity controls"
		"content  content";
}
.sp-msg[data-msg-role="narration"] .sp-msg-avatar {
	display: none;
}
.sp-msg[data-msg-role="narration"] .sp-msg-name {
	font-size: 12px;
	font-weight: 400;
	color: var(--color-surface-500);
}
.sp-msg[data-msg-role="narration"] .sp-msg-body {
	--sp-body: var(--sp-aside);
	--sp-quote: var(--sp-aside);
	justify-content: center;
	font-size: 16px;
	font-style: italic;
	text-align: center;
}`

/** BUBBLES — a portrait beside a speech bubble; the persona's mirrored right. */
const BUBBLES_CSS = `/* Bubbles — portrait beside a speech bubble, the persona's turn mirrored to the
   trailing edge, narration a centred dashed strip. */
.sp-conversation {
	--sp-quote: light-dark(var(--color-surface-950), var(--color-surface-50));
	--sp-body: light-dark(var(--color-surface-700), var(--color-surface-300));
	--sp-speaker: light-dark(var(--color-primary-700), var(--color-primary-500));
	--sp-speaker-persona: light-dark(var(--color-surface-800), var(--color-surface-200));
	--sp-aside: light-dark(var(--color-surface-600), var(--color-surface-400));
	/* The cast's bubble carries an indigo tint so it reads AS a bubble instead
	   of melting into the page; the persona's is the plain card surface. */
	--sp-bub-cast: light-dark(
		color-mix(in oklab, var(--color-secondary-500) 10%, var(--color-surface-100)),
		color-mix(in oklab, var(--color-secondary-500) 12%, var(--color-surface-800))
	);
	--sp-bub-cast-edge: light-dark(
		color-mix(in oklab, var(--color-secondary-500) 30%, transparent),
		color-mix(in oklab, var(--color-secondary-500) 26%, transparent)
	);
	--sp-bub-persona: light-dark(var(--color-surface-50), var(--color-surface-950));
	--sp-bub-persona-edge: light-dark(var(--color-surface-300), var(--color-surface-800));
}
.sp-msg {
	/* The trailing 1fr column absorbs the body's width so the name and controls
	   in row 1 stay adjacent (a small gap) instead of the controls being shoved
	   to the far edge. */
	grid-template-columns: auto auto auto minmax(0, 1fr);
	grid-template-areas:
		"avatar identity controls ."
		"avatar content  content  content";
	column-gap: 0.4rem;
	max-width: 82%;
	padding: 0.15rem;
}
.sp-msg-controls {
	min-inline-size: 0;
}
.sp-msg-avatar {
	--sp-av: 2rem;
}
.sp-msg-name {
	color: var(--sp-speaker);
}
.sp-msg[data-msg-author="persona"] .sp-msg-name {
	color: var(--sp-speaker-persona);
}
.sp-msg-content {
	width: 100%;
}
.sp-msg-body {
	font-family: inherit;
	font-size: 15px;
	line-height: 1.55;
	width: fit-content;
	max-width: 100%;
	padding: 0.5rem 0.8rem;
	border-radius: 1.05rem;
	border-top-left-radius: 0.3rem;
	background: var(--sp-bub-cast);
	border: 1px solid var(--sp-bub-cast-edge);
}
/* The persona's turn mirrors: bubble and portrait on the trailing edge, with
   the controls beside the portrait, which is that side's anchor. */
.sp-msg:is([data-msg-role="user"], [data-msg-author="persona"]) {
	margin-left: auto;
	grid-template-columns: minmax(0, 1fr) auto auto;
	grid-template-areas:
		"identity avatar controls"
		"content  avatar controls";
}
.sp-msg:is([data-msg-role="user"], [data-msg-author="persona"]) .sp-msg-identity {
	flex-direction: row-reverse;
	text-align: right;
}
.sp-msg:is([data-msg-role="user"], [data-msg-author="persona"]) .sp-msg-body {
	margin-left: auto;
	background: var(--sp-bub-persona);
	border-color: var(--sp-bub-persona-edge);
	border-radius: 1.05rem;
	border-top-right-radius: 0.3rem;
}
/* Narration: a centred dashed strip on the page ground, no portrait. */
.sp-msg[data-msg-role="narration"] {
	margin-inline: auto;
	max-width: 70%;
	grid-template-columns: auto minmax(0, 1fr) auto;
	grid-template-areas:
		"identity identity controls"
		"content  content  content";
}
.sp-msg[data-msg-role="narration"] .sp-msg-avatar {
	display: none;
}
.sp-msg[data-msg-role="narration"] .sp-msg-body {
	--sp-body: var(--sp-aside);
	margin-inline: auto;
	background: transparent;
	border-style: dashed;
	border-color: var(--sp-bub-cast-edge);
	font-style: italic;
	text-align: center;
}`

/** NOVEL — flowing prose at a reading measure. No bubbles, no portraits. */
const NOVEL_CSS = `/* Novel — flowing prose at a reading measure. No portraits, no cards; the
   speaker's name is a quiet label above the passage, in sentence case. */
.sp-conversation {
	--sp-quote: light-dark(var(--color-surface-950), var(--color-surface-50));
	--sp-body: light-dark(var(--color-surface-700), var(--color-surface-300));
	/* The persona's passages sit a shade closer to the ink than the cast's —
	   the only mark this pack makes between speakers. */
	--sp-body-persona: light-dark(var(--color-surface-800), var(--color-surface-200));
	--sp-aside: light-dark(var(--color-surface-600), var(--color-surface-400));
}
.sp-msg {
	grid-template-areas:
		"identity identity controls"
		"content  content  content";
	padding: 0.35rem 0.25rem;
	max-width: 100%;
}
.sp-msg-avatar {
	display: none;
}
.sp-msg-name {
	font-size: 12px;
	font-weight: 600;
	color: var(--color-surface-500);
}
.sp-msg-body {
	font-family: var(--sp-prose);
	font-size: 17px;
	line-height: 1.75;
}
.sp-msg:is([data-msg-role="user"], [data-msg-author="persona"]) .sp-msg-body {
	--sp-body: var(--sp-body-persona);
}
/* Narration runs the full measure in italic. */
.sp-msg[data-msg-role="narration"] .sp-msg-body {
	--sp-body: var(--sp-aside);
	font-style: italic;
}`

/** COMPACT — one dense line: portrait · name · text · controls. */
const COMPACT_CSS = `/* Compact — one dense line per message. The name is its own narrow column
   BEFORE the text rather than a word inside the same line box: name and body
   are separate grid cells, which no amount of inline flow can make share one
   line, so the text hangs under itself as an IRC client's does. */
.sp-conversation {
	--sp-quote: light-dark(var(--color-surface-950), var(--color-surface-50));
	--sp-body: light-dark(var(--color-surface-700), var(--color-surface-300));
	--sp-speaker: light-dark(var(--color-primary-700), var(--color-primary-500));
	--sp-speaker-persona: light-dark(var(--color-surface-800), var(--color-surface-200));
	--sp-aside: light-dark(var(--color-surface-600), var(--color-surface-400));
}
.sp-msg {
	grid-template-columns: auto auto minmax(0, 1fr) auto;
	grid-template-areas: "avatar identity content controls";
	align-items: start;
	column-gap: 0.5rem;
	row-gap: 0;
	padding: 0.1rem 0.25rem;
}
.sp-msg-controls {
	min-inline-size: 0;
}
.sp-msg-avatar {
	--sp-av: 1.75rem;
	--sp-av-radius: 0.5rem;
	align-self: start;
}
/* One line means one line: the badges ride beside the name rather than wrapping
   under it, and a long name truncates instead of eating the text column. */
.sp-msg-identity {
	flex-wrap: nowrap;
	max-inline-size: 11rem;
	white-space: nowrap;
}
.sp-msg-name {
	font-size: 15px;
	color: var(--sp-speaker);
}
.sp-msg[data-msg-author="persona"] .sp-msg-name {
	color: var(--sp-speaker-persona);
}
.sp-msg-body {
	font-family: inherit;
	font-size: 15px;
	line-height: 1.5;
}
.sp-msg-body :where(p) {
	margin-block: 0.15em;
}
.sp-msg-time {
	font-size: 11px;
}
/* Narration: an italic line with neither portrait nor attribution. */
.sp-msg[data-msg-role="narration"] {
	grid-template-columns: minmax(0, 1fr) auto;
	grid-template-areas: "content controls";
}
.sp-msg[data-msg-role="narration"] .sp-msg-avatar,
.sp-msg[data-msg-role="narration"] .sp-msg-identity {
	display: none;
}
.sp-msg[data-msg-role="narration"] .sp-msg-body {
	--sp-body: var(--sp-aside);
	font-style: italic;
}`

/**
 * CAMEO — a profile card: a squircle portrait on a soft, borderless surface,
 * with the name row set above the card.
 */
const CAMEO_CSS = `/* Dreamlit Cameo — a profile card: a ringed squircle portrait on a soft,
   borderless surface, the name row set above it, the persona's turn mirrored.

   The query container the portrait sizes against is the widget's OWN root box,
   not the reading column: a skin is injected scoped to a \`display: contents\`
   wrapper, which has no box and so cannot be a container itself. \`cqi\` then
   resolves the portrait against the widget WIDTH on either axis. */
:root > * {
	container-type: inline-size;
}
.sp-conversation {
	--sp-quote: light-dark(var(--color-surface-950), var(--color-surface-50));
	--sp-body: light-dark(var(--color-surface-700), var(--color-surface-300));
	--sp-speaker: light-dark(var(--color-primary-700), var(--color-primary-500));
	--sp-speaker-persona: light-dark(var(--color-surface-800), var(--color-surface-200));
	--sp-aside: light-dark(var(--color-surface-600), var(--color-surface-400));
	--sp-portrait: clamp(4.5rem, 20cqi, 6rem);
	--sp-cameo-card: light-dark(
		color-mix(in oklab, var(--color-surface-50) 70%, transparent),
		color-mix(in oklab, var(--color-surface-950) 60%, transparent)
	);
	--sp-cameo-edge: light-dark(var(--color-surface-300), var(--color-surface-800));
	--sp-cameo-glow: light-dark(
		color-mix(in oklab, var(--color-surface-500) 28%, transparent),
		color-mix(in oklab, var(--color-surface-950) 55%, transparent)
	);
}
.sp-msg {
	position: relative;
	/* Row 1 = the name and controls ABOVE the card; row 2 = the card itself
	   (portrait beside body). */
	grid-template-columns: auto minmax(0, 1fr) auto;
	grid-template-areas:
		"identity identity controls"
		"avatar   content  content";
	column-gap: 0.9rem;
	row-gap: 0.25rem;
	padding: 0;
}
/* The CARD: an absolutely-positioned pseudo placed INTO row 2, so it measures
   itself against the grid rather than against a guessed header height, and its
   shadow is never clipped by a cell. */
.sp-msg::before {
	content: "";
	grid-row: 2;
	grid-column: 1 / -1;
	position: absolute;
	inset: 0;
	border-radius: 14px;
	background: var(--sp-cameo-card);
	box-shadow: 0 8px 26px -18px var(--sp-cameo-glow);
	backdrop-filter: blur(6px);
	z-index: 0;
	pointer-events: none;
}
/* Name row, above the card. */
.sp-msg-identity {
	align-self: center;
	padding-inline-start: 1.15rem;
	z-index: 1;
}
.sp-msg-name {
	font-size: 18px;
	letter-spacing: -0.01em;
	color: var(--sp-speaker);
}
.sp-msg[data-msg-author="persona"] .sp-msg-name {
	color: var(--sp-speaker-persona);
}
.sp-msg-controls {
	/* row-reverse puts the swipe controls BEFORE the menu (⟨ 1/2 ⟩ · ⋮). */
	flex-direction: row-reverse;
	min-inline-size: 0;
	padding-inline-end: 0.35rem;
	z-index: 1;
}
/* The portrait: a squircle with a 2px ring, sitting on the card. */
.sp-msg-avatar {
	--sp-av: var(--sp-portrait);
	--sp-av-radius: 22px;
	position: relative;
	align-self: start;
	margin-block: 0.9rem;
	margin-inline-start: 0.9rem;
	z-index: 1;
}
.sp-msg-avatar-img,
.sp-msg-avatar-glyph {
	box-shadow: 0 0 0 2px var(--sp-cameo-edge);
}
.sp-msg:is([data-msg-role="user"], [data-msg-author="persona"]) .sp-msg-avatar-img,
.sp-msg:is([data-msg-role="user"], [data-msg-author="persona"]) .sp-msg-avatar-glyph {
	box-shadow: 0 0 0 2px var(--color-primary-500);
}
/* Body sits on the card; a square-ish floor keeps it at least as tall as the
   portrait is wide. */
.sp-msg-content {
	position: relative;
	z-index: 1;
	align-self: stretch;
	min-block-size: var(--sp-portrait);
	padding-block: 0.9rem 0.95rem;
	padding-inline-end: 1.15rem;
}
.sp-msg-body {
	font-family: var(--sp-prose);
	font-size: 17px;
	line-height: 1.65;
}
/* The persona's turn mirrors: name right-aligned, portrait on the trailing
   edge of the card. */
.sp-msg:is([data-msg-role="user"], [data-msg-author="persona"]) {
	grid-template-areas:
		"identity identity controls"
		"content  content  avatar";
}
.sp-msg:is([data-msg-role="user"], [data-msg-author="persona"]) .sp-msg-identity {
	padding-inline: 0 1.15rem;
	justify-content: flex-end;
	text-align: right;
}
.sp-msg:is([data-msg-role="user"], [data-msg-author="persona"]) .sp-msg-avatar {
	margin-inline: 0 0.9rem;
}
.sp-msg:is([data-msg-role="user"], [data-msg-author="persona"]) .sp-msg-content {
	padding-inline: 1.15rem 0;
}
/* Narration: no portrait; a dashed card at the full measure, centred. */
.sp-msg[data-msg-role="narration"] {
	grid-template-columns: minmax(0, 1fr) auto;
	grid-template-areas:
		"identity controls"
		"content  content";
}
.sp-msg[data-msg-role="narration"] .sp-msg-avatar {
	display: none;
}
.sp-msg[data-msg-role="narration"] .sp-msg-content {
	min-block-size: 0;
	padding: 0.75rem 1.15rem;
	text-align: center;
}
.sp-msg[data-msg-role="narration"] .sp-msg-body {
	--sp-body: var(--sp-aside);
	justify-content: center;
	font-style: italic;
}
.sp-msg[data-msg-role="narration"]::before {
	border: 1px dashed var(--sp-cameo-edge);
	box-shadow: none;
}`

/* ── the decls ───────────────────────────────────────────────────────── */

/** The five message packs, `default` (Stage) first. */
export const MESSAGE_STYLE_PRESETS: WidgetStylePreset[] = [
	{ slug: "default", title: "Stage", css: STAGE_CSS },
	{ slug: "bubbles", title: "Bubbles", css: BUBBLES_CSS },
	{ slug: "novel", title: "Novel", css: NOVEL_CSS },
	{ slug: "compact", title: "Compact", css: COMPACT_CSS },
	{ slug: "cameo", title: "Dreamlit Cameo", css: CAMEO_CSS }
]

/** The app's preset contribution, by widget id. */
export const CORE_STYLE_PRESETS: Record<string, WidgetStylePreset[]> = {
	messages: MESSAGE_STYLE_PRESETS
}

/**
 * The widget decls the seed reconciler should sync: core's announcement with
 * the app's own presets attached to the widget whose markup the app owns.
 *
 * REPLACES rather than appends, deliberately: the SDK ships each widget a bare
 * `default` preset so a fresh layout always resolves to something, and the
 * packs' own `default` (Stage) is that same slot filled in. Merging would leave
 * two rows fighting over one slug.
 */
export function withCorePresets(decls: WidgetDecl[]): WidgetDecl[] {
	return decls.map((decl) => {
		const presets = CORE_STYLE_PRESETS[decl.id]
		return presets ? { ...decl, presets } : decl
	})
}

/* ── the legacy pack choice (transitional, one release) ──────────────── */

/**
 * The pack ids the pre-style-system layout blob stored in `styles.chat`,
 * mapped to the preset slug that replaced each one.
 *
 * `clean` maps to `default` because that is the slot it now fills (see the file
 * header) — everything else kept its name.
 *
 * Messages is the only widget with a bridge: the blob's other slot named a
 * choice about the composer, which is a SETTING on this widget rather than a
 * skin (`CORE_WIDGETS`), so there is no style row for it to point at.
 */
const LEGACY_PACK_SLUGS: Record<string, Record<string, string>> = {
	messages: {
		clean: "default",
		bubbles: "bubbles",
		novel: "novel",
		compact: "compact",
		cameo: "cameo"
	}
}

/** Which legacy slot a widget's pack choice lived in. */
const LEGACY_PACK_KEY: Record<string, "chat"> = {
	messages: "chat"
}

/** The shape `ZoneLayout.styles` has carried since the pack rows shipped. */
export interface LegacyStylePacks {
	chat?: string | null
}

/**
 * DERIVE the style pin a pre-style-system layout implies — never write it back.
 *
 * A layout saved before the packs became styles carries its choice in
 * `styles.chat` and has no `layoutSettings.widgetStyles` entry at all. Rather
 * than migrate that on load (a silent write to everyone's layout on first open,
 * and an irreversible one), the old choice is READ as a pin every time it is
 * needed: the moment the user picks a style from the widget's own overlay, a
 * real pin is written and this stops mattering.
 *
 * Returns `undefined` for anything that isn't a widget with a bridge, an
 * unrecognised pack id, or a pack whose system row isn't among `candidates`
 * (not seeded yet, or the list hasn't landed) — in every case the caller's
 * `resolveStyle` then degrades to the widget's default, which IS the old
 * `clean`.
 */
export function legacyPackPin<T extends ResolvableStyle>(
	widgetId: string,
	packs: LegacyStylePacks | null | undefined,
	candidates: T[]
): WidgetStyleRef | undefined {
	const key = LEGACY_PACK_KEY[widgetId]
	if (!key || !packs) return undefined
	const packId = packs[key]
	if (!packId || typeof packId !== "string") return undefined
	const presetSlug = LEGACY_PACK_SLUGS[widgetId]?.[packId]
	if (!presetSlug) return undefined
	const slug = systemStyleSlug(widgetId, presetSlug)
	const row = candidates.find(
		(c) => c.widgetSlug === widgetId && c.slug === slug
	)
	return row ? { id: row.id, slug: row.slug } : undefined
}

/**
 * The transitional `data-msg-layout` value for a resolved style row — kept for
 * one release so CSS still keyed on the old attribute keeps working while the
 * packs' own rules live in `widget_styles`.
 *
 * A shipped preset answers with its LEGACY pack id (`messages:default` →
 * `clean`), because that is the value such CSS was written against. A row with
 * no legacy name — a user's own style, or a preset added after the packs —
 * answers with its preset slug, and a user row (whose slug is not prefixed with
 * the widget id) answers `undefined`: no pack is active, so no pack attribute
 * should be either.
 */
export function legacyLayoutAttr(
	widgetId: string,
	styleSlug: string | null | undefined
): string | undefined {
	if (!styleSlug) return undefined
	const prefix = `${widgetId}:`
	if (!styleSlug.startsWith(prefix)) return undefined
	const presetSlug = styleSlug.slice(prefix.length)
	const legacy = Object.entries(LEGACY_PACK_SLUGS[widgetId] ?? {}).find(
		([, slug]) => slug === presetSlug
	)
	return legacy?.[0] ?? presetSlug
}
