/**
 * The message STYLE PACKS, declared app-side as widget style presets (PLAN 25;
 * the "packs become per-widget style choices" ruling of 2026-08-30).
 *
 * ## Why they live here and not in the SDK
 *
 * `CORE_WIDGETS` (`@serene-pub/core-catalog`, `ui/sessions/widgets.ts`) is the
 * announcement: which widgets exist, what they request, and — for a widget
 * whose look the SDK owns — the presets it ships. The five message packs are
 * NOT the SDK's look: every selector in them names a widget part of the
 * message (`[data-widget-part~="messages.message"]`, `messages.message-avatar`;
 * STYLE-GUIDE §6.16), and the SDK's catalog carries no look for them. So the app contributes them for its own primary widget here,
 * and `withCorePresets` is the single seam the boot seed passes them through.
 * Nothing in the SDK changed.
 *
 * The composer is part of that same widget and its look is a SETTING on it
 * (`CORE_WIDGETS`'s `composer` field), not a skin: a style is CSS over one
 * widget's markup, and which of three shapes the field takes is a fact the
 * component reads, not a stylesheet. A message pack therefore carries no rule
 * for the compose block or the composer's parts (`messages.compose`,
 * `messages.composer-*`; STYLE-GUIDE §6.16).
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
 * i.e. Bubbles. The reading column itself is the stage too (NOMENCLATURE §23,
 * reversed 2026-09-28): the log's rows are the part `messages.stage`.
 *
 * ## The markup a pack is written against
 *
 * `messageLayouts.css` holds the zero-styled base: the four-cell grid
 * (`avatar identity controls` over `content`: the parts `messages.message-avatar`,
 * `-identity`, `-controls`, `-content` under `messages.message`, in a
 * `messages.message-row`), the avatar sized by `--sp-av`
 * and `--sp-av-radius`, the control boxes, and the shared message-STATE
 * overlays (selected / dim / editing / hidden). A pack restructures by
 * overriding `grid-template-areas` and the four cells; it never restyles a
 * state, so selection and the editing outline are one treatment everywhere.
 *
 * Story prose is set in two tones (STYLE-GUIDE §3.3) through a pair of custom
 * properties the pack OWNS and `messageLayouts.css` reads: `--sp-body` colours
 * the prose (`messages.prose`) and `--sp-quote` colours dialogue inside
 * quotation marks, both resolved under the widget's root (`messages.root`). A
 * pack that sets neither gets one flat tone.
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
 * Each pack opens by naming its palette on the root (`messages.root`) — the two prose
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
[data-widget-part~="messages.root"] {
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
[data-widget-part~="messages.message"] {
	position: relative;
	column-gap: 0.75rem;
	row-gap: 0.25rem;
	padding: 0.5rem 0.75rem;
	border-radius: 12px;
}
/* Guarded on the NORMAL state so the shared selected / dim / editing overlay
   keeps the message under the pointer. */
[data-widget-part~="messages.message"][data-msg-state="normal"]:hover,
[data-widget-part~="messages.message"][data-msg-state="normal"]:focus-within {
	background: var(--sp-stage-hover);
}
[data-widget-part~="messages.message-avatar"] {
	--sp-av: 2.5rem;
	--sp-av-radius: 9999px;
}
[data-widget-part~="messages.message-name"] {
	color: var(--sp-speaker);
}
[data-widget-part~="messages.message"][data-msg-author="persona"] [data-widget-part~="messages.message-name"] {
	color: var(--sp-speaker-persona);
}
[data-widget-part~="messages.message-body"] {
	font-family: var(--sp-prose);
	font-size: calc(17px * var(--sp-prose-scale, 1));
	line-height: 1.65;
}
/* The scene's edge: a 2px rule in the row's own --sp-scene, at the leading edge
   INSIDE the message's padding box, where a scrolling log cannot clip it and
   no horizontal scrollbar can appear. */
[data-widget-part~="messages.message-row"][style*="--sp-scene"] [data-widget-part~="messages.message"]::before {
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
[data-widget-part~="messages.message"][data-msg-author="persona"] [data-widget-part~="messages.message-content"] {
	background: var(--sp-stage-card);
	border: 1px solid var(--sp-stage-edge);
	border-radius: 12px;
	padding: 14px 16px;
	margin-top: 6px;
}
/* Narration: centred italic, no portrait, the name reduced to a quiet label. */
[data-widget-part~="messages.message"][data-msg-role="narration"] {
	grid-template-columns: minmax(0, 1fr) auto;
	grid-template-areas:
		"identity controls"
		"content  content";
}
[data-widget-part~="messages.message"][data-msg-role="narration"] [data-widget-part~="messages.message-avatar"] {
	display: none;
}
[data-widget-part~="messages.message"][data-msg-role="narration"] [data-widget-part~="messages.message-name"] {
	font-size: 12px;
	font-weight: 400;
	color: var(--color-surface-500);
}
[data-widget-part~="messages.message"][data-msg-role="narration"] [data-widget-part~="messages.message-body"] {
	--sp-body: var(--sp-aside);
	--sp-quote: var(--sp-aside);
	justify-content: center;
	font-size: calc(16px * var(--sp-prose-scale, 1));
	font-style: italic;
	text-align: center;
}`

/** BUBBLES — a portrait beside a speech bubble; the persona's mirrored right. */
const BUBBLES_CSS = `/* Bubbles — portrait beside a speech bubble, the persona's turn mirrored to the
   trailing edge, narration a centred dashed strip. */
[data-widget-part~="messages.root"] {
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
[data-widget-part~="messages.message"] {
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
[data-widget-part~="messages.message-controls"] {
	min-inline-size: 0;
}
[data-widget-part~="messages.message-avatar"] {
	--sp-av: 2rem;
}
[data-widget-part~="messages.message-name"] {
	color: var(--sp-speaker);
}
[data-widget-part~="messages.message"][data-msg-author="persona"] [data-widget-part~="messages.message-name"] {
	color: var(--sp-speaker-persona);
}
[data-widget-part~="messages.message-content"] {
	width: 100%;
}
[data-widget-part~="messages.message-body"] {
	font-family: inherit;
	font-size: calc(15px * var(--sp-prose-scale, 1));
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
[data-widget-part~="messages.message"]:is([data-msg-role="user"], [data-msg-author="persona"]) {
	margin-left: auto;
	grid-template-columns: minmax(0, 1fr) auto auto;
	grid-template-areas:
		"identity avatar controls"
		"content  avatar controls";
}
[data-widget-part~="messages.message"]:is([data-msg-role="user"], [data-msg-author="persona"]) [data-widget-part~="messages.message-identity"] {
	flex-direction: row-reverse;
	text-align: right;
}
[data-widget-part~="messages.message"]:is([data-msg-role="user"], [data-msg-author="persona"]) [data-widget-part~="messages.message-body"] {
	margin-left: auto;
	background: var(--sp-bub-persona);
	border-color: var(--sp-bub-persona-edge);
	border-radius: 1.05rem;
	border-top-right-radius: 0.3rem;
}
/* Narration: a centred dashed strip on the page ground, no portrait. */
[data-widget-part~="messages.message"][data-msg-role="narration"] {
	margin-inline: auto;
	max-width: 70%;
	grid-template-columns: auto minmax(0, 1fr) auto;
	grid-template-areas:
		"identity identity controls"
		"content  content  content";
}
[data-widget-part~="messages.message"][data-msg-role="narration"] [data-widget-part~="messages.message-avatar"] {
	display: none;
}
[data-widget-part~="messages.message"][data-msg-role="narration"] [data-widget-part~="messages.message-body"] {
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
[data-widget-part~="messages.root"] {
	--sp-quote: light-dark(var(--color-surface-950), var(--color-surface-50));
	--sp-body: light-dark(var(--color-surface-700), var(--color-surface-300));
	/* The persona's passages sit a shade closer to the ink than the cast's —
	   the only mark this pack makes between speakers. */
	--sp-body-persona: light-dark(var(--color-surface-800), var(--color-surface-200));
	--sp-aside: light-dark(var(--color-surface-600), var(--color-surface-400));
}
[data-widget-part~="messages.message"] {
	grid-template-areas:
		"identity identity controls"
		"content  content  content";
	padding: 0.35rem 0.25rem;
	max-width: 100%;
}
[data-widget-part~="messages.message-avatar"] {
	display: none;
}
[data-widget-part~="messages.message-name"] {
	font-size: 12px;
	font-weight: 600;
	color: var(--color-surface-500);
}
[data-widget-part~="messages.message-body"] {
	font-family: var(--sp-prose);
	font-size: calc(17px * var(--sp-prose-scale, 1));
	line-height: 1.75;
}
[data-widget-part~="messages.message"]:is([data-msg-role="user"], [data-msg-author="persona"]) [data-widget-part~="messages.message-body"] {
	--sp-body: var(--sp-body-persona);
}
/* Narration runs the full measure in italic. */
[data-widget-part~="messages.message"][data-msg-role="narration"] [data-widget-part~="messages.message-body"] {
	--sp-body: var(--sp-aside);
	font-style: italic;
}`

/** COMPACT — one dense line: portrait · name · text · controls. */
const COMPACT_CSS = `/* Compact — one dense line per message. The name is its own narrow column
   BEFORE the text rather than a word inside the same line box: name and body
   are separate grid cells, which no amount of inline flow can make share one
   line, so the text hangs under itself as an IRC client's does. */
[data-widget-part~="messages.root"] {
	--sp-quote: light-dark(var(--color-surface-950), var(--color-surface-50));
	--sp-body: light-dark(var(--color-surface-700), var(--color-surface-300));
	--sp-speaker: light-dark(var(--color-primary-700), var(--color-primary-500));
	--sp-speaker-persona: light-dark(var(--color-surface-800), var(--color-surface-200));
	--sp-aside: light-dark(var(--color-surface-600), var(--color-surface-400));
}
[data-widget-part~="messages.message"] {
	grid-template-columns: auto auto minmax(0, 1fr) auto;
	grid-template-areas: "avatar identity content controls";
	align-items: start;
	column-gap: 0.5rem;
	row-gap: 0;
	padding: 0.1rem 0.25rem;
}
[data-widget-part~="messages.message-controls"] {
	min-inline-size: 0;
}
[data-widget-part~="messages.message-avatar"] {
	--sp-av: 1.75rem;
	--sp-av-radius: 0.5rem;
	align-self: start;
}
/* One line means one line: the badges ride beside the name rather than wrapping
   under it, and a long name truncates instead of eating the text column. */
[data-widget-part~="messages.message-identity"] {
	flex-wrap: nowrap;
	max-inline-size: 11rem;
	white-space: nowrap;
}
[data-widget-part~="messages.message-name"] {
	font-size: 15px;
	color: var(--sp-speaker);
}
[data-widget-part~="messages.message"][data-msg-author="persona"] [data-widget-part~="messages.message-name"] {
	color: var(--sp-speaker-persona);
}
[data-widget-part~="messages.message-body"] {
	font-family: inherit;
	font-size: calc(15px * var(--sp-prose-scale, 1));
	line-height: 1.5;
}
[data-widget-part~="messages.message-body"] :where(p) {
	margin-block: 0.15em;
}
[data-widget-part~="messages.message-time"] {
	font-size: 11px;
}
/* Narration: an italic line with neither portrait nor attribution. */
[data-widget-part~="messages.message"][data-msg-role="narration"] {
	grid-template-columns: minmax(0, 1fr) auto;
	grid-template-areas: "content controls";
}
[data-widget-part~="messages.message"][data-msg-role="narration"] [data-widget-part~="messages.message-avatar"],
[data-widget-part~="messages.message"][data-msg-role="narration"] [data-widget-part~="messages.message-identity"] {
	display: none;
}
[data-widget-part~="messages.message"][data-msg-role="narration"] [data-widget-part~="messages.message-body"] {
	--sp-body: var(--sp-aside);
	font-style: italic;
}
/* A narrow box has no room for the name's column beside the text: the text
   drops under the name row, beside the portrait, rather than into a sliver. */
@container sp-widget (max-width: 36rem) {
	[data-widget-part~="messages.message"] {
		grid-template-columns: auto minmax(0, 1fr) auto;
		grid-template-areas:
			"avatar identity controls"
			"avatar content  content";
	}
	[data-widget-part~="messages.message-identity"] {
		max-inline-size: none;
	}
}`

/**
 * CAMEO — after Moonlit Echoes' "Echo" style: a large, unframed portrait laid
 * into the leading edge of a glass card and fading into it.
 */
const CAMEO_CSS = `/* Dreamlit Cameo — after Moonlit Echoes' "Echo" message style: each line is a
   soft glass card, and the speaker's portrait is LARGE and unframed, laid into
   the card's leading edge and fading into it (toward the text and at the
   bottom), so the face sits partly under the glass rather than in a box of
   its own. The persona's turn mirrors to the trailing edge. In a narrow box
   the portrait goes behind the text, faint, and the text takes the width.

   The portrait's size answers the widget's box (\`cqi\`, the \`sp-widget\`
   container the host gives every widget), never the window. */
[data-widget-part~="messages.root"] {
	--sp-quote: light-dark(var(--color-surface-950), var(--color-surface-50));
	--sp-body: light-dark(var(--color-surface-700), var(--color-surface-300));
	--sp-speaker: light-dark(var(--color-primary-700), var(--color-primary-500));
	--sp-speaker-persona: light-dark(var(--color-surface-800), var(--color-surface-200));
	--sp-aside: light-dark(var(--color-surface-600), var(--color-surface-400));
	--sp-portrait: clamp(8rem, 30cqi, 13rem);
	--sp-cameo-glass: light-dark(
		color-mix(in oklab, var(--color-surface-50) 74%, transparent),
		color-mix(in oklab, var(--color-surface-900) 58%, transparent)
	);
	--sp-cameo-glass-hover: light-dark(
		color-mix(in oklab, var(--color-surface-50) 90%, transparent),
		color-mix(in oklab, var(--color-surface-900) 78%, transparent)
	);
	--sp-cameo-edge: light-dark(
		color-mix(in oklab, var(--color-surface-400) 40%, transparent),
		color-mix(in oklab, var(--color-surface-500) 24%, transparent)
	);
	--sp-cameo-glow: light-dark(
		color-mix(in oklab, var(--color-surface-500) 30%, transparent),
		color-mix(in oklab, var(--color-surface-950) 70%, transparent)
	);
}
/* The card: the name row over the text, both clear of the portrait's
   leading part (the inset), and at least as tall as the portrait wants. */
[data-widget-part~="messages.message"] {
	--sp-cameo-inset: max(1.1rem, calc(var(--sp-portrait) * 0.72));
	position: relative;
	grid-template-columns: minmax(0, 1fr) auto;
	grid-template-areas:
		"identity controls"
		"content  content";
	align-content: start;
	column-gap: 0.75rem;
	row-gap: 0.35rem;
	min-block-size: calc(var(--sp-portrait) * 0.9);
	padding-block: 0.8rem 1rem;
	padding-inline: var(--sp-cameo-inset) 1.1rem;
	border-radius: 18px;
}
/* The glass, behind the card's own ground: the shared selected / editing
   overlays still paint over it. */
[data-widget-part~="messages.message"]::before {
	content: "";
	position: absolute;
	inset: 0;
	z-index: -1;
	border-radius: inherit;
	background: var(--sp-cameo-glass);
	border: 1px solid var(--sp-cameo-edge);
	box-shadow: 0 14px 34px -24px var(--sp-cameo-glow);
	backdrop-filter: blur(10px);
	pointer-events: none;
	transition: background-color 150ms ease-out;
}
[data-widget-part~="messages.message"][data-msg-state="normal"]:hover::before,
[data-widget-part~="messages.message"][data-msg-state="normal"]:focus-within::before {
	background: var(--sp-cameo-glass-hover);
}
/* A line in a scene carries the scene's colour along its leading edge. */
[data-widget-part~="messages.message-row"][style*="--sp-scene"] [data-widget-part~="messages.message"]::before {
	border-inline-start: 2px solid color-mix(in oklab, var(--sp-scene) 70%, transparent);
}
/* The portrait: laid into the card's leading edge, the card's full height,
   no frame — it fades toward the text and at the bottom. */
[data-widget-part~="messages.message-avatar"] {
	--sp-av: var(--sp-portrait);
	--sp-av-radius: 0;
	grid-area: auto;
	position: absolute;
	inset-block: 0;
	inset-inline-start: 0;
	inline-size: var(--sp-portrait);
	overflow: hidden;
	border-start-start-radius: 18px;
	border-end-start-radius: 18px;
	-webkit-mask-image:
		linear-gradient(to right, #000 38%, transparent 100%),
		linear-gradient(to bottom, #000 55%, transparent 100%);
	-webkit-mask-composite: source-in;
	mask-image:
		linear-gradient(to right, #000 38%, transparent 100%),
		linear-gradient(to bottom, #000 55%, transparent 100%);
	mask-composite: intersect;
}
[data-widget-part~="messages.message-avatar-button"] {
	inline-size: 100%;
	block-size: 100%;
}
[data-widget-part~="messages.message-avatar-img"] {
	object-fit: cover;
	object-position: 50% 18%;
}
/* No picture: the speaker's initial, large and faint, as a watermark. */
[data-widget-part~="messages.message-avatar-glyph"] {
	inline-size: 100%;
	block-size: 100%;
	align-items: flex-start;
	padding-block-start: 0.4rem;
	font-size: calc(var(--sp-portrait) * 0.6);
	background: linear-gradient(
		160deg,
		color-mix(in oklab, var(--color-primary-500) 22%, transparent),
		transparent 75%
	);
	color: color-mix(in oklab, var(--color-primary-500) 55%, transparent);
}
/* The text rides above the portrait. */
[data-widget-part~="messages.message-identity"],
[data-widget-part~="messages.message-controls"],
[data-widget-part~="messages.message-content"] {
	position: relative;
	z-index: 1;
}
[data-widget-part~="messages.message-controls"] {
	min-inline-size: 0;
}
[data-widget-part~="messages.message-name"] {
	font-size: 18px;
	letter-spacing: -0.01em;
	color: var(--sp-speaker);
}
[data-widget-part~="messages.message"][data-msg-author="persona"] [data-widget-part~="messages.message-name"] {
	color: var(--sp-speaker-persona);
}
[data-widget-part~="messages.message-content"] {
	min-inline-size: 0;
}
[data-widget-part~="messages.message-body"] {
	font-family: var(--sp-prose);
	font-size: calc(17px * var(--sp-prose-scale, 1));
	line-height: 1.65;
}
/* The persona's turn mirrors: the portrait on the trailing edge, fading the
   other way, the name row set to the end. */
[data-widget-part~="messages.message"]:is([data-msg-role="user"], [data-msg-author="persona"]) {
	grid-template-columns: auto minmax(0, 1fr);
	grid-template-areas:
		"controls identity"
		"content  content";
	padding-inline: 1.1rem var(--sp-cameo-inset);
}
[data-widget-part~="messages.message"]:is([data-msg-role="user"], [data-msg-author="persona"]) [data-widget-part~="messages.message-identity"] {
	justify-content: flex-end;
	text-align: right;
}
[data-widget-part~="messages.message"]:is([data-msg-role="user"], [data-msg-author="persona"]) [data-widget-part~="messages.message-controls"] {
	justify-self: start;
	flex-direction: row-reverse;
}
[data-widget-part~="messages.message"]:is([data-msg-role="user"], [data-msg-author="persona"]) [data-widget-part~="messages.message-avatar"] {
	inset-inline: auto 0;
	border-radius: 0;
	border-start-end-radius: 18px;
	border-end-end-radius: 18px;
	-webkit-mask-image:
		linear-gradient(to left, #000 38%, transparent 100%),
		linear-gradient(to bottom, #000 55%, transparent 100%);
	mask-image:
		linear-gradient(to left, #000 38%, transparent 100%),
		linear-gradient(to bottom, #000 55%, transparent 100%);
}
/* Narration: no portrait; the card at the full measure, its text centred. */
[data-widget-part~="messages.message"][data-msg-role="narration"] {
	min-block-size: 0;
	padding-inline: 1.1rem;
}
[data-widget-part~="messages.message"][data-msg-role="narration"] [data-widget-part~="messages.message-avatar"] {
	display: none;
}
[data-widget-part~="messages.message"][data-msg-role="narration"]::before {
	border-style: dashed;
	box-shadow: none;
}
[data-widget-part~="messages.message"][data-msg-role="narration"] [data-widget-part~="messages.message-body"] {
	--sp-body: var(--sp-aside);
	justify-content: center;
	font-style: italic;
	text-align: center;
}
/* A narrow box: the portrait goes behind the text, faint, and the text takes
   the card's width. */
@container sp-widget (max-width: 36rem) {
	[data-widget-part~="messages.message"],
	[data-widget-part~="messages.message"]:is([data-msg-role="user"], [data-msg-author="persona"]) {
		--sp-portrait: clamp(7rem, 45cqi, 10rem);
		min-block-size: 0;
		padding-inline: 1rem;
	}
	[data-widget-part~="messages.message-avatar"] {
		opacity: 0.3;
	}
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
