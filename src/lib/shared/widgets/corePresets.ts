/**
 * The message + composer STYLE PACKS, declared app-side as widget style
 * presets (PLAN 25; the "packs become per-widget style choices" ruling of
 * 2026-08-30).
 *
 * ## Why they live here and not in the SDK
 *
 * `CORE_WIDGETS` (`@serene-pub/core-catalog`, `ui/sessions/widgets.ts`) is the
 * announcement: which widgets exist, what they request, and — for a widget
 * whose look the SDK owns — the presets it ships. The five message packs and
 * three composer packs are NOT the SDK's look: every selector in them
 * (`.sp-msg`, `.sp-msg-avatar`, `.sp-composer`) is a class the APP's
 * SessionMessage / SessionComposer authors, and the SDK has no view of that
 * markup at all. So the app contributes them for its own two primary widgets
 * here, and `withCorePresets` is the single seam the boot seed passes them
 * through. Nothing in the SDK changed.
 *
 * ## The `default` slot carries Clean / Classic
 *
 * `resolveStyle` degrades an unresolvable (or absent) pin to
 * `systemStyleSlug(widgetId, "default")`, so the `default` slug is the SLOT an
 * unpinned widget lands in — and that slot has to hold what a session looks
 * like today, which is Clean for messages and Classic for the composer. Hence
 * they ARE the `default` preset (titled "Clean" / "Classic") rather than
 * additional rows beside an empty one: an empty `default` alongside a separate
 * `clean` would silently un-style every existing session on upgrade, and
 * dropping `default` entirely would leave the fallback to
 * `defaultStyleFor`'s "first row for the widget", which is list order — i.e.
 * alphabetical by title, i.e. Bubbles.
 *
 * ## Mode-aware values are TOKENS, not rules
 *
 * A preset's CSS is injected scoped to the widget's own box
 * (`scopeWidgetCss`), so it can only ever select the widget and its
 * descendants. `[data-mode="dark"]` is on `<html>` — an ANCESTOR — which a
 * scoped skin can never reach. Every value that differed by mode is therefore
 * published as a custom property by `messageLayouts.css` (the `--sp-*` skin
 * palette, defined light on `:root` and dark on `[data-mode="dark"]`), and the
 * packs below only ever read them. A user who clones a pack inherits the same
 * arrangement, and their clone keeps working in both modes.
 */
import { systemStyleSlug, type WidgetDecl, type WidgetStylePreset, type WidgetStyleRef } from "./types"
import type { ResolvableStyle } from "./resolve"

/* ── the message packs ───────────────────────────────────────────────── */

/**
 * CLEAN — the classic Serene Pub card. Occupies the `default` slot (see the
 * file header): what an unpinned messages widget resolves to.
 */
const CLEAN_CSS = `/* The classic Serene Pub card: the base grid plus a tinted surface. */
.sp-msg[data-msg-state="normal"] {
	background: var(--sp-clean-card);
}`

/** BUBBLES — avatar beside a speaker-coloured bubble; the user on the right. */
const BUBBLES_CSS = `.sp-msg {
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
/* Menu + swipes on ONE line, so the header row stays a single control tall. */
.sp-msg-controls {
	flex-direction: row;
	align-items: center;
	gap: 0.25rem;
	min-inline-size: 0;
}
.sp-msg-avatar {
	--sp-av: 2.2rem;
}
.sp-msg-content {
	width: 100%;
}
.sp-msg-body {
	width: fit-content;
	max-width: 100%;
	padding: 0.5rem 0.8rem;
	border-radius: 1.05rem;
	border-top-left-radius: 0.3rem;
	background: var(--sp-bub-bg);
	border: 1px solid var(--sp-bub-bd);
}
/* User / persona: mirror to the right; the controls sit to the RIGHT of the
   avatar (avatar is the right-side anchor, as the name is on the left side). */
.sp-msg[data-msg-role="user"],
.sp-msg[data-msg-author="persona"] {
	margin-left: auto;
	grid-template-columns: minmax(0, 1fr) auto auto;
	grid-template-areas:
		"identity avatar controls"
		"content  avatar controls";
}
.sp-msg[data-msg-role="user"] .sp-msg-identity,
.sp-msg[data-msg-author="persona"] .sp-msg-identity {
	flex-direction: row-reverse;
	text-align: right;
}
.sp-msg[data-msg-role="user"] .sp-msg-body,
.sp-msg[data-msg-author="persona"] .sp-msg-body {
	margin-left: auto;
	background: var(--sp-bub-user-bg);
	border-color: var(--sp-bub-user-bd);
	border-radius: 1.05rem;
	border-top-right-radius: 0.3rem;
}
/* Narration: a centred, dashed strip; no avatar. */
.sp-msg[data-msg-role="narration"] {
	margin-inline: auto;
	max-width: 70%;
	grid-template-areas:
		"identity identity controls"
		"content  content  content";
}
.sp-msg[data-msg-role="narration"] .sp-msg-avatar {
	display: none;
}
.sp-msg[data-msg-role="narration"] .sp-msg-body {
	margin-inline: auto;
	background: transparent;
	border-style: dashed;
	font-style: italic;
	text-align: center;
}`

/** NOVEL — flowing serif prose at a reading measure. No bubbles, no avatars. */
const NOVEL_CSS = `.sp-msg {
	grid-template-areas:
		"identity identity controls"
		"content  content  content";
	padding: 0.15rem 0.25rem;
	max-width: 100%;
}
.sp-msg-controls {
	flex-direction: row;
	align-items: center;
	gap: 0.25rem;
	min-inline-size: 0;
}
.sp-msg-avatar {
	display: none;
}
.sp-msg-name {
	font-size: 0.66rem !important;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.14em;
	opacity: 0.7;
}
.sp-msg-body {
	font-family: Georgia, "Times New Roman", serif;
	font-size: 1.02rem;
	line-height: 1.75;
}
.sp-msg[data-msg-role="user"] .sp-msg-body {
	border-left: 3px solid var(--color-primary-500);
	padding-left: 0.95rem;
}
.sp-msg[data-msg-role="narration"] .sp-msg-body {
	text-align: center;
	font-style: italic;
	opacity: 0.85;
}`

/** COMPACT — dense single IRC line: avatar · name · text · controls. */
const COMPACT_CSS = `.sp-msg {
	grid-template-columns: auto minmax(0, 1fr) auto;
	grid-template-areas:
		"avatar identity controls"
		"avatar content  content";
	align-items: start;
	column-gap: 0.5rem;
	row-gap: 0;
	padding: 0.15rem;
}
.sp-msg-controls {
	flex-direction: row;
	align-items: center;
	gap: 0.25rem;
	min-inline-size: 0;
}
.sp-msg-avatar {
	--sp-av: 1.75rem;
	--sp-av-radius: 0.4rem;
	align-self: start;
	margin-top: 0.15rem;
}
.sp-msg-identity {
	white-space: nowrap;
}
.sp-msg-name {
	font-size: 0.8rem !important;
	color: var(--sp-compact-name);
}
.sp-msg[data-msg-role="user"] .sp-msg-name {
	color: var(--sp-compact-user-name);
}
.sp-msg-body {
	font-size: 0.86rem;
	margin-top: -0.1rem;
}
.sp-msg-body :where(p) {
	margin-top: 0.2em;
	margin-bottom: 0.2em;
}
.sp-msg[data-msg-role="narration"] {
	grid-template-columns: minmax(0, 1fr) auto;
	grid-template-areas: "content controls";
}
.sp-msg[data-msg-role="narration"] .sp-msg-avatar,
.sp-msg[data-msg-role="narration"] .sp-msg-identity {
	display: none;
}
.sp-msg[data-msg-role="narration"] .sp-msg-body {
	font-style: italic;
	text-align: center;
	opacity: 0.85;
}`

/**
 * CAMEO — a profile card: a large character portrait bleeding into a soft,
 * borderless surface, with the name row set above the card.
 */
const CAMEO_CSS = `/* The query container the portrait sizes against.
   It is the widget's OWN root box, not the chat column: a skin is injected
   scoped to a \`display: contents\` wrapper, which has no box and so cannot be
   a container itself. \`cqi\` then resolves the portrait against the chat WIDTH
   on any axis — which lets the card's min-HEIGHT equal the portrait's WIDTH
   (a bare 25% in min-block-size would resolve against height, which is
   indefinite, and collapse). */
:root > * {
	container-type: inline-size;
}
.sp-msg {
	--sp-portrait: clamp(5.5rem, 25cqi, 11rem);
	/* Height of the name row above the card (row 1 + gap). */
	--sp-header: calc(var(--msg-ctrl-size) + 0.25rem);
	position: relative;
	/* Row 1 = the name/controls ABOVE the card; row 2 = the card (portrait +
	   body). The card itself is drawn by ::before so its shadow isn't clipped. */
	grid-template-columns: var(--sp-portrait) minmax(0, 1fr) auto;
	grid-template-areas:
		"identity identity controls"
		"avatar   content  content";
	column-gap: 0;
	row-gap: 0.25rem;
	padding: 0;
}
.sp-msg[data-msg-state="normal"] {
	background: transparent;
}
/* The CARD: a pseudo covering row 2 (full width), behind the portrait + body. */
.sp-msg::before {
	content: "";
	position: absolute;
	inset-block-start: var(--sp-header);
	inset-block-end: 0;
	inset-inline: 0;
	border-radius: 1.1rem;
	box-shadow: 0 8px 26px -16px var(--sp-cameo-glow);
	backdrop-filter: blur(6px);
	z-index: 0;
	pointer-events: none;
}
.sp-msg[data-msg-state="normal"]::before {
	background: var(--sp-cameo-card);
}
/* Name row, above the card. */
.sp-msg-identity {
	align-self: center;
	padding-inline-start: 1.15rem;
	z-index: 1;
}
.sp-msg-name {
	font-size: 1.18rem !important;
	letter-spacing: 0.01em;
	color: var(--sp-cameo-accent);
}
.sp-msg-controls {
	/* row-reverse puts the swipe controls BEFORE the menu (⟨ 1/2 ⟩ · ⋮), and
	   one row keeps the header a single control tall (--sp-header). */
	flex-direction: row-reverse;
	align-items: center;
	gap: 0.25rem;
	min-inline-size: 0;
	padding-inline-end: 0.35rem;
	z-index: 1;
}
/* Body sits on the card, clearing the portrait column via padding. */
.sp-msg-content {
	position: relative;
	z-index: 1;
	align-self: stretch;
	/* A square-ish floor: at least as tall as the portrait is wide. */
	min-block-size: var(--sp-portrait);
	padding: 0.85rem 1.15rem 0.9rem 0.95rem;
	line-height: 1.7;
}
/* Portrait: a real grid cell (row 2, leading column) that STRETCHES to the
   card height. The image is absolute inside, so it never expands the row and
   is clipped to the card by the cell's overflow. Width-bound; fades on the
   text side + bottom so it blends into the card. */
.sp-msg-avatar {
	grid-area: avatar;
	position: relative;
	align-self: stretch;
	overflow: hidden;
	border-radius: 1.1rem 0 0 1.1rem;
	z-index: 1;
}
.sp-msg-avatar-btn {
	position: relative;
	display: block;
	width: 100%;
	height: 100%;
	min-height: 0;
	border-radius: 0;
	overflow: hidden;
}
.sp-msg-avatar-img {
	position: absolute;
	inset-block-start: 0;
	inset-inline: 0;
	width: 100%;
	height: auto;
	border-radius: 0;
	box-shadow: none;
	-webkit-mask-image:
		linear-gradient(to right, #000 42%, transparent 100%),
		linear-gradient(to bottom, #000 76%, transparent 100%);
	-webkit-mask-composite: source-in;
	mask-image:
		linear-gradient(to right, #000 42%, transparent 100%),
		linear-gradient(to bottom, #000 76%, transparent 100%);
	mask-composite: intersect;
}
.sp-msg-avatar-glyph {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	border-radius: 0;
	box-shadow: none;
}
/* User / persona: the portrait mirrors to the RIGHT and sits UNDER the name +
   controls, which are anchored to the card's right edge (name then controls). */
.sp-msg[data-msg-role="user"],
.sp-msg[data-msg-author="persona"] {
	grid-template-columns: minmax(0, 1fr) minmax(4.5rem, auto) auto;
	grid-template-areas:
		".        identity controls"
		"content  avatar   avatar";
}
.sp-msg[data-msg-role="user"] .sp-msg-identity,
.sp-msg[data-msg-author="persona"] .sp-msg-identity {
	text-align: right;
}
.sp-msg[data-msg-role="user"] .sp-msg-content,
.sp-msg[data-msg-author="persona"] .sp-msg-content {
	padding: 0.85rem 0.95rem 0.9rem 1.15rem;
}
.sp-msg[data-msg-role="user"] .sp-msg-avatar,
.sp-msg[data-msg-author="persona"] .sp-msg-avatar {
	border-radius: 0 1.1rem 1.1rem 0;
}
.sp-msg[data-msg-role="user"] .sp-msg-avatar-img,
.sp-msg[data-msg-author="persona"] .sp-msg-avatar-img {
	-webkit-mask-image:
		linear-gradient(to left, #000 42%, transparent 100%),
		linear-gradient(to bottom, #000 76%, transparent 100%);
	-webkit-mask-composite: source-in;
	mask-image:
		linear-gradient(to left, #000 42%, transparent 100%),
		linear-gradient(to bottom, #000 76%, transparent 100%);
	mask-composite: intersect;
}
/* Narration: no portrait; the card is full width, the name row centred. */
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
	padding: 0.7rem 1.15rem;
	text-align: center;
	font-style: italic;
	opacity: 0.95;
}
.sp-msg[data-msg-role="narration"]::before {
	border: 1px dashed var(--sp-cameo-bd);
	box-shadow: none;
}`

/* ── the composer packs ──────────────────────────────────────────────── */

/** MINIMAL — a single-line pill; token meter and chatter tucked away. */
const MINIMAL_CSS = `.sp-composer {
	border-radius: 999px;
	padding-block: 0.25rem;
}
.sp-composer textarea {
	min-height: 2.2rem !important;
	border: none !important;
	background: transparent !important;
}
.sp-composer .rag-notice {
	display: none;
}`

/** WRITER — a tall editor with room to draft long prose. */
const WRITER_CSS = `.sp-composer textarea {
	min-height: 8rem !important;
	font-size: 0.98rem;
	line-height: 1.65;
}`

/* ── the decls ───────────────────────────────────────────────────────── */

/** The five message packs, `default` (Clean) first. */
export const MESSAGE_STYLE_PRESETS: WidgetStylePreset[] = [
	{ slug: "default", title: "Clean", css: CLEAN_CSS },
	{ slug: "bubbles", title: "Bubbles", css: BUBBLES_CSS },
	{ slug: "novel", title: "Novel", css: NOVEL_CSS },
	{ slug: "compact", title: "Compact", css: COMPACT_CSS },
	{ slug: "cameo", title: "Dreamlit Cameo", css: CAMEO_CSS }
]

/** The three composer packs, `default` (Classic — no rules at all) first. */
export const COMPOSER_STYLE_PRESETS: WidgetStylePreset[] = [
	{ slug: "default", title: "Classic", css: "" },
	{ slug: "minimal", title: "Minimal", css: MINIMAL_CSS },
	{ slug: "writer", title: "Writer", css: WRITER_CSS }
]

/** The app's preset contribution, by widget id. */
export const CORE_STYLE_PRESETS: Record<string, WidgetStylePreset[]> = {
	messages: MESSAGE_STYLE_PRESETS,
	composer: COMPOSER_STYLE_PRESETS
}

/**
 * The widget decls the seed reconciler should sync: core's announcement with
 * the app's own presets attached to the two widgets whose markup the app owns.
 *
 * REPLACES rather than appends, deliberately: the SDK ships each widget a bare
 * `default` preset so a fresh layout always resolves to something, and the
 * packs' own `default` (Clean / Classic) is that same slot filled in. Merging
 * would leave two rows fighting over one slug.
 */
export function withCorePresets(decls: WidgetDecl[]): WidgetDecl[] {
	return decls.map((decl) => {
		const presets = CORE_STYLE_PRESETS[decl.id]
		return presets ? { ...decl, presets } : decl
	})
}

/* ── the legacy pack choice (transitional, one release) ──────────────── */

/**
 * The pack ids the pre-style-system layout blob stored in `styles.chat` /
 * `styles.composer`, mapped to the preset slug that replaced each one.
 *
 * `clean` and `classic` map to `default` because that is the slot they now
 * fill (see the file header) — everything else kept its name.
 */
const LEGACY_PACK_SLUGS: Record<string, Record<string, string>> = {
	messages: {
		clean: "default",
		bubbles: "bubbles",
		novel: "novel",
		compact: "compact",
		cameo: "cameo"
	},
	composer: {
		classic: "default",
		minimal: "minimal",
		writer: "writer"
	}
}

/** Which legacy slot a widget's pack choice lived in. */
const LEGACY_PACK_KEY: Record<string, "chat" | "composer"> = {
	messages: "chat",
	composer: "composer"
}

/** The shape `ZoneLayout.styles` has carried since the pack rows shipped. */
export interface LegacyStylePacks {
	chat?: string | null
	composer?: string | null
}

/**
 * DERIVE the style pin a pre-style-system layout implies — never write it back.
 *
 * A layout saved before the packs became styles carries its choice in
 * `styles.chat` / `styles.composer` and has no `layoutSettings.widgetStyles`
 * entry at all. Rather than migrate that on load (a silent write to everyone's
 * layout on first open, and an irreversible one), the old choice is READ as a
 * pin every time it is needed: the moment the user picks a style from the
 * widget's own overlay, a real pin is written and this stops mattering.
 *
 * Returns `undefined` for anything that isn't one of the two widgets, an
 * unrecognised pack id, or a pack whose system row isn't among `candidates`
 * (not seeded yet, or the list hasn't landed) — in every case the caller's
 * `resolveStyle` then degrades to the widget's default, which IS the old
 * `clean` / `classic`.
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
 * The transitional `data-msg-layout` / `data-composer-layout` value for a
 * resolved style row — kept for one release so CSS still keyed on the old
 * attributes keeps working while the packs' own rules live in `widget_styles`.
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
