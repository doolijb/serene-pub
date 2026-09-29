/**
 * Widget styles, client side (PLAN 25, ruled 2026-08-30).
 *
 * Two jobs live here, and they are deliberately in one module:
 *
 *   1. **The rows.** One module-scoped cache of every `widget_styles` row this
 *      user may USE (system + own private + shared), fetched once over the
 *      socket and refreshed after a write. Module-scoped for the same reason
 *      `completionTemplateOptions` next door is: the Settings tab, every
 *      `WidgetHost` on the screen and the style editor all want the same list,
 *      and a subscription per consumer is N handlers racing over one event.
 *
 *   2. **The skin boundary.** `scopeWidgetCss` / `varsToStyle` are the only
 *      sanctioned way a row's `css`/`vars` reach the DOM. A style is
 *      user-authored CSS that can be marked `shared`, i.e. it runs in other
 *      people's browsers — so it is treated as hostile input, not as content.
 *      See the boundary notes on `scopeWidgetCss`.
 *
 *   3. **The overlay's state.** Styling is a hover gesture on the widget
 *      itself (ruled 2026-09-09), so which widget is pinned open, whether an
 *      overlay shows, and what a widget renders while a draft is being typed
 *      all live here too — for the same reason the pins do: the overlay is
 *      inside a `WidgetHost`, far below anything the page hands down. The pure
 *      half of that (`nextArmed`, `overlayVisible`, `skinToRender`,
 *      `createDebouncer`, `nextSaveState`) is separated out so it can be tested
 *      without a DOM.
 *
 * ## The socket contract
 *
 * `widgetStyles:list | :create | :update | :delete | :clone`, each with an
 * `:error` twin. The server pushes a fresh, UNFILTERED `:list` to the actor
 * after every mutation, so this never patches rows by hand off a mutation
 * reply and never asks for a narrowed list — an arriving list is always the
 * whole usable set, and the per-widget narrowing happens here.
 */
import {
	declareInterest,
	requestWithInterest
} from "$lib/client/sockets/interest.svelte"
import { untrack } from "svelte"
import { typedSocketOrNull } from "$lib/client/sockets/typedSocket"
import { resolveStyle } from "$lib/shared/widgets/resolve"
import { widgetOfInstance } from "$lib/shared/widgets/instanceId"
import {
	legacyPackPin,
	type LegacyStylePacks
} from "$lib/shared/widgets/corePresets"
import type { WidgetStyleRef } from "$lib/shared/widgets/types"

/* ── the contract ─────────────────────────────────────────────────────── */

/**
 * One `widget_styles` row as the client sees it. Aliased rather than restated:
 * the wire shape is the server lane's to define (`Sockets.WidgetStyles`), and a
 * second copy of it here would drift the first time a column is added.
 */
export type WidgetStyleRow = Sockets.WidgetStyles.WidgetStyleRow

/**
 * A var key is stored in the CSS spelling — `--accent`, never `accent` — and
 * the server refuses anything else, so the editor validates against the SAME
 * expression rather than a looser one that would only fail on save.
 */
export const VAR_KEY_RE = /^--[a-z0-9-]+$/

/* ── the list reducer ─────────────────────────────────────────────────── */

/** System rows first within a widget, then by title — a stable picker order. */
function compareRows(a: WidgetStyleRow, b: WidgetStyleRow): number {
	if (a.widgetSlug !== b.widgetSlug)
		return a.widgetSlug < b.widgetSlug ? -1 : 1
	if (a.source !== b.source) return a.source === "system" ? -1 : 1
	if (a.title !== b.title) return a.title.localeCompare(b.title)
	return a.id - b.id
}

/**
 * Fold a `widgetStyles:list` reply into the cache.
 *
 * `widgetSlug` is the scope the CALLER asked for, never something read off the
 * reply: a scoped reply replaces that widget's rows and leaves every other
 * widget's alone, and a reply that over-answers (rows for a widget nobody
 * asked about) has the strays dropped rather than smuggled in. An unscoped
 * reply is the whole visible set and replaces everything.
 */
export function mergeStyles(
	prev: WidgetStyleRow[],
	incoming: WidgetStyleRow[],
	widgetSlug?: string
): WidgetStyleRow[] {
	const next = widgetSlug
		? [
				...prev.filter((r) => r.widgetSlug !== widgetSlug),
				...incoming.filter((r) => r.widgetSlug === widgetSlug)
			]
		: [...incoming]
	return next.sort(compareRows)
}

/**
 * May this user edit/delete the row? UI affordance only — the server owns the
 * rule, this just keeps a button off the screen that would only be refused.
 * System rows are read-only for everyone (an admin included): they are
 * reconciler-managed, and an edit would be silently reverted on the next boot.
 */
export function canManageStyle(
	row: WidgetStyleRow,
	user: { id: number; isAdmin?: boolean } | null | undefined
): boolean {
	if (!user) return false
	if (row.source === "system" || row.visibility === "system") return false
	if (row.ownerUserId === user.id) return true
	return row.visibility === "shared" && !!user.isAdmin
}

/** Which bucket a row shows under in the picker. */
export function styleGroupOf(
	row: WidgetStyleRow,
	userId: number | null | undefined
): "Built-in" | "Mine" | "Shared" {
	if (row.source === "system" || row.visibility === "system")
		return "Built-in"
	if (userId != null && row.ownerUserId === userId) return "Mine"
	return "Shared"
}

/** The picker's options for one widget, grouped Built-in / Mine / Shared. */
export function stylePickerOptions(
	rows: WidgetStyleRow[],
	widgetSlug: string,
	userId: number | null | undefined
): { value: string; label: string; group: string }[] {
	return rows
		.filter((r) => r.widgetSlug === widgetSlug)
		.map((r) => ({
			value: String(r.id),
			label: r.title,
			group: styleGroupOf(r, userId)
		}))
}

/* ── the hover overlay's pure state (ruled 2026-09-09) ─────────────────── */

/**
 * Styling a widget is a HOVER gesture on the widget itself, not a row in the
 * settings panel: in the editor's Style tab every widget wears a controls
 * overlay that is invisible until you hover it. Three questions that produces
 * are pure, and are answered here so they can be tested without a DOM.
 */

/** What can happen to the pin. */
export type ArmEvent =
	| { type: "arm"; widgetId: string }
	| { type: "disarm"; widgetId?: string }
	/** Style mode ended (Done, or another tab). */
	| { type: "exit" }

/**
 * Which widget's overlay is PINNED open, given what just happened.
 *
 * Hover alone is not enough to keep an overlay up: the style picker's popup is
 * portalled to `<body>` and the style editor is a popover, so the pointer
 * genuinely leaves the widget the moment you use either. Interacting therefore
 * pins — and because only one may be pinned, arming a second widget releases
 * the first, which is what stops two editors being open at once.
 *
 * Arming the already-pinned widget is deliberately NOT a toggle: every click
 * inside an open overlay re-arms it, and a toggle would shut it mid-use.
 */
export function nextArmed(
	current: string | null,
	event: ArmEvent
): string | null {
	switch (event.type) {
		case "arm":
			return event.widgetId
		case "disarm":
			// A widget may only release its OWN pin — an overlay reacting to
			// its pointer leaving must not close the one you just opened.
			return event.widgetId && event.widgetId !== current ? current : null
		case "exit":
			return null
	}
}

/** Is the overlay showing at all? */
export function overlayVisible(input: {
	styleMode: boolean
	hovered: boolean
	focused: boolean
	armed: boolean
}): boolean {
	if (!input.styleMode) return false
	return input.hovered || input.focused || input.armed
}

/** An unsaved style draft, as the widget should render it while it is typed. */
export interface StyleDraftPreview {
	widgetId: string
	css: string
	vars: Record<string, string>
}

/** What a widget actually renders: `css` + `vars`, never undefined. */
export interface RenderedSkin {
	css: string
	vars: Record<string, string>
}

/**
 * The skin a widget wears RIGHT NOW: the unsaved draft while its editor is
 * open, otherwise the saved row it is pinned to.
 *
 * This is the whole of live-apply and the whole of revert. Cancel does not undo
 * anything — it drops the draft, and the saved row is what is left. An emptied
 * draft is honoured rather than treated as absent, or an author could never see
 * what deleting a rule was worth.
 */
export function skinToRender(
	widgetId: string,
	saved:
		| { css?: string | null; vars?: Record<string, string> | null }
		| null
		| undefined,
	preview: StyleDraftPreview | null | undefined
): RenderedSkin {
	if (preview && preview.widgetId === widgetId)
		return { css: preview.css, vars: preview.vars }
	return { css: saved?.css ?? "", vars: saved?.vars ?? {} }
}

/**
 * A trailing debounce: schedule as often as you like, only the last call runs,
 * and only once the caller has stopped for `delayMs`.
 *
 * It exists so live-apply does not re-sanitise and re-inject a whole stylesheet
 * on every keystroke, and it is a factory rather than a module singleton so two
 * editors (or two tests) never share one timer.
 */
export function createDebouncer(delayMs: number) {
	let handle: ReturnType<typeof setTimeout> | null = null
	return {
		schedule(fn: () => void) {
			if (handle !== null) clearTimeout(handle)
			handle = setTimeout(() => {
				handle = null
				fn()
			}, delayMs)
		},
		/** Drop a pending call — Cancel must not re-apply the draft it just threw away. */
		cancel() {
			if (handle === null) return
			clearTimeout(handle)
			handle = null
		}
	}
}

/* ── the save hold (the flash between Save and the saved row) ─────────── */

/**
 * A write whose live preview is still standing in for the row it saved.
 *
 * Save used to drop the draft the instant it emitted, and the persisted row
 * only arrives on the next `widgetStyles:list` — so for a frame or two the
 * widget repainted itself with the PRE-save CSS and then jumped to the new one.
 * The draft is the only thing that spans that gap, so it is held across it.
 */
export interface PendingSave {
	widgetId: string
	/**
	 * The row the widget has to end up wearing. `null` until a create's reply
	 * names it: a refreshed list cannot say which of its rows is the new one
	 * (several may have changed), and only the mutation reply can.
	 */
	id: number | null
}

/** What just happened to a save in flight. */
export type SaveEvent =
	/** A `create`/`clone` reply, naming the row the server minted. */
	| { type: "created"; id: number }
	/** Rows or pins landed: this is what the widget resolves to now. */
	| { type: "resolved"; id: number | null | undefined }
	/** The server refused the write (`:error`). */
	| { type: "refused" }

/** Whether the hold survives this event, and whether the preview comes down. */
export interface SaveState {
	/** What is still being waited for; `null` once nothing is. */
	pending: PendingSave | null
	/** Drop the held preview — the widget wears the saved row itself now. */
	drop: boolean
}

/**
 * Advance a held save.
 *
 * The bar for letting go is not "the write was acknowledged" but "the widget
 * RESOLVES to the saved row" — its pin, against the rows in the cache. That is
 * one list round trip for an edit, and a list AND a pin round trip for a new
 * style (the pin is written from the create reply and comes back through the
 * page's `layoutSettings`, so the row can be in the cache a beat before the
 * widget is wearing it). Dropping the draft at either earlier moment is the
 * same flash in a different place.
 *
 * A refusal ends the wait but keeps the preview: the draft is the only copy of
 * what the author typed, and the editor stays open on it to say why. And a
 * widget that resolves to nothing — the row deleted out from under the editor —
 * simply keeps waiting; Cancel is the way out of that, and it costs the author
 * nothing but a click, where dropping their text would cost them the text.
 */
export function nextSaveState(
	pending: PendingSave | null,
	event: SaveEvent
): SaveState {
	if (!pending) return { pending: null, drop: false }
	switch (event.type) {
		case "refused":
			return { pending: null, drop: false }
		case "created":
			// Learn the id and keep holding — the pin has not landed yet.
			return { pending: { ...pending, id: event.id }, drop: false }
		case "resolved":
			return pending.id != null && event.id === pending.id
				? { pending: null, drop: true }
				: { pending, drop: false }
	}
}

/* ── the skin boundary ────────────────────────────────────────────────── */

/**
 * What a widget skin is allowed to be, stated once so it can be argued with:
 *
 *   ALLOWED
 *     • ordinary style rules, every selector re-written to sit under the
 *       widget's own container;
 *     • `@media`, `@supports`, `@container` — prelude kept, contents scoped;
 *     • `@keyframes`, with the animation name namespaced to this instance
 *       (a bare `@keyframes fade` is a global name — two skins would fight);
 *     • `url()` pointing at a `data:` URI or a same-origin relative path.
 *
 *   REMOVED
 *     • `@import` and every other at-rule not named above — including
 *       `@font-face`, `@property`, `@counter-style`, `@layer` and `@page`,
 *       which all register GLOBAL names or affect the global cascade and so
 *       cannot be confined to one widget by any amount of selector rewriting;
 *     • `url()` / `image-set()` reaching another host (absolute or
 *       protocol-relative), which is a tracking beacon in a shareable skin;
 *     • the literal `</style`, so the text can never terminate its own
 *       element. (Belt and braces: the host writes this through `textContent`,
 *       which cannot be broken out of at all.)
 *
 *   KNOWN LIMIT
 *     • `display: contents` on the scope wrapper means the container itself
 *       has no box, so a rule targeting the container paints nothing; token
 *       overrides on it still inherit, which is what `vars` and `:root` want.
 */
const ALLOWED_NESTED_AT = /^@(-\w+-)?(media|supports|container)\b/i
const KEYFRAMES_AT = /^@(-\w+-)?keyframes\b/i

/** A parsed top-level construct: a prelude, and a block unless it ended in `;`. */
interface CssNode {
	prelude: string
	block: string | null
}

/**
 * Split CSS into top-level nodes, tracking strings and parens so a `;` inside
 * `url(data:…;base64,…)` is not read as a statement end. A stray `}` discards
 * whatever prelude was accumulating — that is the classic bleed attempt
 * ("close the author's block early, then write a bare global selector"), and
 * discarding is what makes it a no-op rather than an escape.
 */
function splitTopLevel(css: string): CssNode[] {
	const out: CssNode[] = []
	let buf = ""
	let i = 0
	let quote: string | null = null
	let paren = 0
	while (i < css.length) {
		const c = css[i]
		if (quote) {
			buf += c
			if (c === "\\" && i + 1 < css.length) {
				buf += css[i + 1]
				i += 2
				continue
			}
			if (c === quote) quote = null
			i++
			continue
		}
		if (c === '"' || c === "'") {
			quote = c
			buf += c
			i++
			continue
		}
		if (c === "(") paren++
		else if (c === ")") paren = Math.max(0, paren - 1)
		else if (paren === 0 && c === ";") {
			const prelude = buf.trim()
			if (prelude) out.push({ prelude, block: null })
			buf = ""
			i++
			continue
		} else if (paren === 0 && c === "{") {
			const { body, next } = readBlock(css, i + 1)
			out.push({ prelude: buf.trim(), block: body })
			buf = ""
			i = next
			continue
		} else if (paren === 0 && c === "}") {
			buf = ""
			i++
			continue
		}
		buf += c
		i++
	}
	return out
}

/** Read a balanced `{…}` body starting just after the opening brace. */
function readBlock(css: string, start: number): { body: string; next: number } {
	let depth = 1
	let body = ""
	let i = start
	let quote: string | null = null
	while (i < css.length) {
		const c = css[i]
		if (quote) {
			body += c
			if (c === "\\" && i + 1 < css.length) {
				body += css[i + 1]
				i += 2
				continue
			}
			if (c === quote) quote = null
			i++
			continue
		}
		if (c === '"' || c === "'") {
			quote = c
			body += c
			i++
			continue
		}
		if (c === "{") depth++
		else if (c === "}") {
			depth--
			if (depth === 0) return { body, next: i + 1 }
		}
		body += c
		i++
	}
	// Unterminated: take what there is rather than throwing away the sheet.
	return { body, next: css.length }
}

/** Drop `/* … *​/` comments without touching what is inside a string. */
function stripComments(css: string): string {
	let out = ""
	let i = 0
	let quote: string | null = null
	while (i < css.length) {
		const c = css[i]
		if (quote) {
			out += c
			if (c === "\\" && i + 1 < css.length) {
				out += css[i + 1]
				i += 2
				continue
			}
			if (c === quote) quote = null
			i++
			continue
		}
		if (c === '"' || c === "'") {
			quote = c
			out += c
			i++
			continue
		}
		if (c === "/" && css[i + 1] === "*") {
			const end = css.indexOf("*/", i + 2)
			i = end === -1 ? css.length : end + 2
			out += " "
			continue
		}
		out += c
		i++
	}
	return out
}

/**
 * May a stylesheet fetch this? `data:` yes (it is inline bytes), a same-origin
 * relative path yes, anything carrying a scheme or protocol-relative no — that
 * is the beacon a shared skin would otherwise plant in someone else's browser.
 */
function urlAllowed(target: string): boolean {
	const t = target.trim()
	if (!t) return false
	if (/^data:/i.test(t)) return true
	if (t.startsWith("//")) return false
	return !/^[a-z][a-z0-9+.-]*:/i.test(t)
}

const URL_TOKEN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi

function filterUrls(css: string): string {
	return css.replace(URL_TOKEN, (whole, dq, sq, bare) => {
		const target = dq ?? sq ?? bare ?? ""
		return urlAllowed(target) ? whole : "none"
	})
}

/**
 * `image-set()` takes BARE strings as well as `url()`, so it is a second door
 * to the same host and has to be checked separately.
 */
function filterImageSets(css: string): string {
	const open = /(^|[^\w-])(-\w+-)?image-set\(/gi
	let out = ""
	let cursor = 0
	let m: RegExpExecArray | null
	while ((m = open.exec(css))) {
		const callStart = m.index + m[1].length
		const bodyStart = m.index + m[0].length
		const bodyEnd = matchParen(css, bodyStart)
		if (bodyEnd < 0) break
		const inner = css.slice(bodyStart, bodyEnd)
		const strings = inner.match(/"[^"]*"|'[^']*'/g) ?? []
		const bad = strings.some((s) => !urlAllowed(s.slice(1, -1)))
		out +=
			css.slice(cursor, callStart) +
			(bad ? "none" : css.slice(callStart, bodyEnd + 1))
		cursor = bodyEnd + 1
		open.lastIndex = cursor
	}
	return out + css.slice(cursor)
}

/** Index of the `)` closing the paren opened just before `start`, or -1. */
function matchParen(css: string, start: number): number {
	let depth = 1
	let quote: string | null = null
	for (let i = start; i < css.length; i++) {
		const c = css[i]
		if (quote) {
			if (c === "\\") i++
			else if (c === quote) quote = null
			continue
		}
		if (c === '"' || c === "'") quote = c
		else if (c === "(") depth++
		else if (c === ")" && --depth === 0) return i
	}
	return -1
}

/** Split a selector list on top-level commas (never inside `:is(a, b)`). */
function splitSelectorList(sel: string): string[] {
	const out: string[] = []
	let buf = ""
	let paren = 0
	let bracket = 0
	let quote: string | null = null
	for (let i = 0; i < sel.length; i++) {
		const c = sel[i]
		if (quote) {
			buf += c
			if (c === "\\") buf += sel[++i] ?? ""
			else if (c === quote) quote = null
			continue
		}
		if (c === '"' || c === "'") quote = c
		else if (c === "(") paren++
		else if (c === ")") paren = Math.max(0, paren - 1)
		else if (c === "[") bracket++
		else if (c === "]") bracket = Math.max(0, bracket - 1)
		else if (c === "," && !paren && !bracket) {
			out.push(buf)
			buf = ""
			continue
		}
		buf += c
	}
	out.push(buf)
	return out
}

/** A page-level selector a copy-pasted skin opens with; re-pointed at us. */
const PAGE_LEVEL = /^(:root|html|body)(?![\w-])/i

/**
 * The app's light/dark switch is `data-mode` on `<html>` — an ANCESTOR of the
 * scope wrapper, which no amount of prefixing can reach, so a dark-only rule
 * was unwritable in a skin. `WidgetHost` therefore mirrors the attribute onto
 * the wrapper itself, and a selector that OPENS with it is naming the wrapper,
 * not a descendant: it is concatenated (`scope[data-mode=…]`) rather than
 * prefixed (`scope [data-mode=…]`, which would match nothing, ever).
 *
 * Deliberately just this one attribute. Folding any leading `[attr]` onto the
 * container would break every skin that legitimately targets a descendant by
 * attribute (`[data-msg-state="selected"]`), which is most of them. The
 * `:root[data-mode=…]` / `html[data-mode=…]` spellings need no case of their
 * own — `PAGE_LEVEL` above already concatenates whatever follows.
 */
const LEADING_MODE =
	/^\[\s*data-mode\s*(?:[~|^$*]?=\s*(?:"[^"]*"|'[^']*'|[^\]\s]*)\s*)?\]/i

function scopeOneSelector(sel: string, scope: string): string {
	const s = sel.trim()
	if (!s) return ""
	if (s.startsWith("&")) return scope + s.slice(1)
	const page = PAGE_LEVEL.exec(s)
	if (page) return (scope + s.slice(page[0].length)).trim()
	if (LEADING_MODE.test(s)) return scope + s
	return `${scope} ${s}`
}

function scopeSelectorList(sel: string, scope: string): string {
	return splitSelectorList(sel)
		.map((s) => scopeOneSelector(s, scope))
		.filter(Boolean)
		.join(", ")
}

/** Every `@keyframes` name declared anywhere in the sheet. */
function keyframeNames(nodes: CssNode[]): string[] {
	const names: string[] = []
	for (const n of nodes) {
		if (n.block == null) continue
		if (KEYFRAMES_AT.test(n.prelude)) {
			const name = n.prelude
				.replace(KEYFRAMES_AT, "")
				.trim()
				.replace(/^["']|["']$/g, "")
			if (name) names.push(name)
		} else if (ALLOWED_NESTED_AT.test(n.prelude)) {
			names.push(...keyframeNames(splitTopLevel(n.block)))
		}
	}
	return names
}

/** Rewrite `animation` / `animation-name` values to the namespaced names. */
function renameAnimations(
	body: string,
	names: string[],
	prefix: string
): string {
	if (!names.length) return body
	return body.replace(
		/(^|;)(\s*)(animation(?:-name)?)(\s*:\s*)([^;]*)/gi,
		(_m, sep, ws, prop, colon, value) => {
			let v = value
			for (const n of names)
				v = v.replace(
					new RegExp(`(?<![\\w-])${escapeRe(n)}(?![\\w-])`, "g"),
					prefix + n
				)
			return `${sep}${ws}${prop}${colon}${v}`
		}
	)
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

interface EmitCtx {
	/** The scope selector, or null to sanitise without scoping. */
	scope: string | null
	names: string[]
	prefix: string
}

function emitNodes(nodes: CssNode[], ctx: EmitCtx): string {
	let out = ""
	for (const n of nodes) {
		// A statement (`@import …;`) or a stray declaration outside any rule.
		if (n.block == null) continue
		if (n.prelude.startsWith("@")) {
			if (ALLOWED_NESTED_AT.test(n.prelude)) {
				const inner = emitNodes(splitTopLevel(n.block), ctx)
				if (inner) out += `${n.prelude}{${inner}}`
				continue
			}
			if (KEYFRAMES_AT.test(n.prelude)) {
				const at = KEYFRAMES_AT.exec(n.prelude)![0]
				const name = n.prelude
					.slice(at.length)
					.trim()
					.replace(/^["']|["']$/g, "")
				if (!name) continue
				out += `${at} ${ctx.prefix}${name}{${n.block}}`
				continue
			}
			// @font-face / @property / @counter-style / @layer / @page / …
			continue
		}
		const sel = ctx.scope
			? scopeSelectorList(n.prelude, ctx.scope)
			: n.prelude.trim()
		if (!sel) continue
		out += `${sel}{${renameAnimations(n.block, ctx.names, ctx.prefix)}}`
	}
	return out
}

/** The shared pre-pass: nothing downstream ever sees the raw author text. */
function preClean(css: string): string {
	return filterImageSets(filterUrls(stripComments(stripBreakout(css))))
}

function stripBreakout(css: string): string {
	return String(css ?? "").replace(/<\/style/gi, "")
}

/** A CSS-identifier-safe form of the caller's instance key. */
function safeKey(key: string): string {
	return String(key ?? "").replace(/[^A-Za-z0-9_-]/g, "") || "widget"
}

/* The server's own check, restated character for character from
   `assertSafeThemeCss` (server/sockets/customThemes.ts, reused by
   server/sockets/widgetStyles.ts). Restated rather than approximated: the
   editor's job is to say NO to exactly what the save would say no to, in the
   same words. A looser client check ships a save that bounces; a stricter one
   refuses CSS the instance would happily have stored. */
const CSS_IMPORT_RE = /@import\b/i
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi

/**
 * The refusal the server would give for this CSS (or this var value), or null
 * if it would be accepted. Call before `create`/`update` so the message lands
 * next to the textarea instead of arriving as a socket error.
 */
export function checkWidgetCss(css: string): string | null {
	if (CSS_IMPORT_RE.test(css)) return "Theme CSS cannot contain @import."
	for (const match of css.matchAll(CSS_URL_RE)) {
		const target = match[2].trim()
		if (/^(https?:)?\/\//i.test(target))
			return "Theme CSS cannot reference external URLs in url(...) — only relative paths or data: URIs are allowed."
	}
	return null
}

/**
 * Strip everything a widget skin may not contain, WITHOUT scoping it.
 *
 * The unscoped form exists for the case where the CSS already has a document
 * of its own — a FRAME widget's skin, which is injected into the iframe and so
 * needs no selector rewriting to be confined. Every native render path goes
 * through `scopeWidgetCss`, which runs this same pipeline and then scopes.
 *
 * ⚠ This is a strict SUPERSET of `checkWidgetCss`: the server's allowlist is
 * about exfiltration, this one adds the at-rules that cannot be confined to a
 * container by any amount of selector rewriting (see the boundary note above).
 * So a `@font-face` saves fine and then does not render — deliberate, and
 * surfaced to the author in the editor rather than left as a mystery.
 */
export function sanitizeWidgetCss(css: string): string {
	const cleaned = preClean(css)
	return emitNodes(splitTopLevel(cleaned), {
		scope: null,
		names: [],
		prefix: ""
	})
}

/**
 * Sanitise AND confine a skin to one widget instance: every selector is
 * re-written to sit under `[data-widget-instance="<key>"]` and every animation
 * name is namespaced with the same key. This is the only function the host is
 * allowed to render CSS through.
 */
export function scopeWidgetCss(css: string, key: string): string {
	const k = safeKey(key)
	const cleaned = preClean(css)
	const nodes = splitTopLevel(cleaned)
	return emitNodes(nodes, {
		scope: `[data-widget-instance="${k}"]`,
		names: keyframeNames(nodes),
		prefix: `${k}-`
	})
}

/**
 * A row's `vars` as an inline `style` string of custom properties. Values are
 * put through the same url filter as the CSS — `--bg: url(https://…)` used by
 * a `var()` elsewhere fetches exactly like a literal would — and stripped of
 * the characters that would end the declaration early.
 */
export function varsToStyle(
	vars: Record<string, string> | null | undefined
): string {
	if (!vars) return ""
	let out = ""
	for (const [rawName, rawValue] of Object.entries(vars)) {
		const name = rawName.startsWith("--") ? rawName : `--${rawName}`
		if (!VAR_KEY_RE.test(name)) continue
		const value = filterImageSets(
			filterUrls(
				stripBreakout(String(rawValue ?? "")).replace(/[;{}]/g, "")
			)
		).trim()
		if (!value) continue
		out += `${name}:${value};`
	}
	return out
}

/* ── the live rows ────────────────────────────────────────────────────── */

let rows = $state<WidgetStyleRow[]>([])
let loaded = $state(false)
let lastError = $state<string | null>(null)
/**
 * The layout's per-widget style pins (`layoutSettings.widgetStyles`), kept
 * beside the rows rather than threaded as props: `WidgetHost` is mounted deep
 * inside `Panel`, which this lane does not own, and the pin is the one thing it
 * needs. The page pushes them here whenever a session's layout settings land.
 */
let pins = $state<Record<string, WidgetStyleRef>>({})
/**
 * Writing a pin needs the layout-settings blob it rides in, which only
 * SessionLayout has. It registers a writer here for the same reason the page
 * pushes the pins here: the overlay that changes a style is inside a
 * `WidgetHost`, several layers below anything either of them hands down.
 */
let pinWriter: ((next: Record<string, WidgetStyleRef>) => void) | null = null
/**
 * The widget a create/clone was started for, so the row the server mints can be
 * pinned the moment it lands. The refreshed list cannot answer "which one did I
 * ask for" — several rows may have changed — and the mutation reply is the only
 * message that can, so the pin is applied there and nowhere else.
 */
let pinOnCreate: string | null = null
/**
 * The pre-style-system pack choice the session's layout blob still carries
 * (`styles.chat`), if any — pushed here by SessionLayout, which is the only
 * thing that holds that blob.
 *
 * It is a FALLBACK under `pins`, never a migration: nothing writes it back, so
 * a layout saved before the packs became styles keeps rendering the look it was
 * saved with until the user picks one from the widget's own overlay, and the
 * moment they do, the real pin takes over. Cleared on teardown so one session's
 * legacy choice can never leak into the next.
 */
let legacyPacks = $state<LegacyStylePacks | null>(null)
/** Is the editor's Settings tab open? Gates the per-widget hover overlays. */
let styleMode = $state(false)
/** Which widget's overlay is pinned open (see `nextArmed`). */
let armed = $state<string | null>(null)
/** The unsaved draft being typed, rendered live by its widget (`skinToRender`). */
let preview = $state<StyleDraftPreview | null>(null)
/**
 * The save the preview above is being HELD for, if any (see `nextSaveState`).
 * Non-null means "this widget's editor is waiting", which is also what keeps
 * the editor open — a refused write must not take the author's text with it.
 */
let pendingSave = $state<PendingSave | null>(null)
let started = false

function socketOrNull() {
	// SSR and the moment before the client socket connects both land here; the
	// next caller starts it, so nothing is lost by declining now.
	return typedSocketOrNull()
}

/* Named handlers, one reference each: the interest registry counts subscribers
   by reference, so `start` declaring them twice would still be one listener —
   and the release it hands back is the only thing that ever removes it. */
function onList(res: Sockets.WidgetStyles.List.Response) {
	rows = mergeStyles(rows, res?.styles ?? [])
	loaded = true
	checkSaveLanded()
}
function onError(res: { error?: string } | undefined) {
	lastError = res?.error ?? "Something went wrong with that style."
	applySaveEvent({ type: "refused" })
}

/** Fold one event into the held save, and drop the preview when it says to. */
function applySaveEvent(event: SaveEvent): void {
	const next = nextSaveState(pendingSave, event)
	pendingSave = next.pending
	if (next.drop) preview = null
}

/**
 * Ask the held save whether the widget is wearing its row yet. Called from
 * every seam that can make that true: a list landing, a create reply, and the
 * pins coming back round from the page.
 */
function checkSaveLanded(): void {
	if (!pendingSave) return
	applySaveEvent({
		type: "resolved",
		id: resolveWidgetStyle(pendingSave.widgetId)?.id
	})
}

/** Stop holding, and let the draft go with it (Cancel, or leaving Style mode). */
function dropSaveHold(): void {
	pendingSave = null
}
/**
 * Wear what you just made. A `create`/`clone` reply is the only message that
 * says "this is the row YOU asked for", so the pin is written from here — the
 * refreshed list that follows cannot tell one changed row from another.
 */
function onCreated(res: { style?: WidgetStyleRow } | undefined) {
	const style = res?.style
	const widgetId = pinOnCreate
	pinOnCreate = null
	if (!style) return
	// This message is also the only one that can tell a HELD preview which row
	// it is waiting for the widget to wear (`nextSaveState`), for the same
	// reason the pin is written from here: the list cannot name the new row.
	applySaveEvent({ type: "created", id: style.id })
	if (!widgetId) return
	setWidgetStylePin(widgetId, { id: style.id, slug: style.slug })
	checkSaveLanded()
}

const CREATE_EVENTS = ["widgetStyles:create", "widgetStyles:clone"] as const

const ERROR_EVENTS = [
	"widgetStyles:list:error",
	"widgetStyles:create:error",
	"widgetStyles:update:error",
	"widgetStyles:delete:error",
	"widgetStyles:clone:error"
] as const

/** What `stopWidgetStyles` releases — one per declared interest key. */
let releases: Array<() => void> = []

/**
 * Declare what this store reads, then ask for the list.
 *
 * Still refuses to start before the socket exists, exactly as it did: the
 * registry would happily hold the interest and attach the listener on connect,
 * but the REQUEST would be dropped with nothing to retry it, and the list would
 * never arrive. The next caller starts it instead.
 */
function start(): void {
	if (started) return
	if (!socketOrNull()) return
	started = true
	releases = [
		declareInterest<"widgetStyles:list">("widgetStyles:list", onList),
		...CREATE_EVENTS.map((e) =>
			declareInterest<"widgetStyles:create">(e, onCreated)
		),
		...ERROR_EVENTS.map((e) =>
			declareInterest<"widgetStyles:list:error">(e, onError)
		)
	]
	// The reply is the request's own event, so this adds no second subscriber
	// (same `onList` reference) — what it adds is the interest sync ahead of
	// the request, which is what makes the gated reply reachable at all.
	requestWithInterest("widgetStyles:list", {}, onList)
}

/**
 * Drop the interest. Nothing in the app calls this today — the cache is
 * module-scoped and lives as long as the tab, which is the point — but each
 * release is kept so a teardown is possible at all, and so it removes THIS
 * store's listeners rather than every listener for the event.
 */
export function stopWidgetStyles(): void {
	if (!started) return
	for (const release of releases) release()
	releases = []
	started = false
}

/**
 * Replace the layout's style pins. Anything that is not a `{id, slug}` map is
 * treated as no pins at all — `layoutSettings` is a forward-compatible json
 * blob, so a shape from a future version must degrade, never throw.
 */
export function setWidgetStylePins(next: unknown): void {
	const out: Record<string, WidgetStyleRef> = {}
	if (next && typeof next === "object" && !Array.isArray(next)) {
		for (const [widgetId, ref] of Object.entries(
			next as Record<string, unknown>
		)) {
			if (!ref || typeof ref !== "object") continue
			const { id, slug } = ref as { id?: unknown; slug?: unknown }
			if (typeof id === "number" && typeof slug === "string")
				out[widgetId] = { id, slug }
		}
	}
	// The page calls this from an EFFECT, so nothing below may be read
	// tracked: asking the held save whether it landed reads `pins`, `rows`
	// and `pendingSave`, and a tracked read of the pins just written re-ran
	// that effect on its own write until Svelte killed it
	// (`effect_update_depth_exceeded`, 2026-09-28) — the new style's editor
	// stuck on "Saving…", and no pin reached the store again until a reload.
	untrack(() => {
		pins = out
		// The last thing a new style waits for: the row can be in the cache a
		// beat before the pin that points this widget at it comes back round.
		checkSaveLanded()
	})
}

/**
 * The style a widget should wear right now: its pin if it still reconciles,
 * else the widget's default — the quiet degrade `resolveStyle` is built for.
 *
 * `widgetId` is the placed id (a **widget instance id**, S1): a copy such as
 * `messages#sanctum` keeps its own pin, and resolves among its WIDGET's style
 * rows — so an unpinned copy wears what the widget itself would.
 */
export function resolveWidgetStyle(
	widgetId: string
): WidgetStyleRow | undefined {
	const widget = widgetOfInstance(widgetId)
	// The pin first, then the legacy pack choice DERIVED as one — see
	// `legacyPacks` above. Both then go through the same `resolveStyle`, so a
	// legacy id that no longer reconciles degrades exactly as a pin does.
	const pin = pins[widgetId] ?? legacyPackPin(widget, legacyPacks, rows)
	return resolveStyle(widget, pin, rows)
}

/**
 * Push (or clear) the layout blob's legacy pack choice. Pass `null` on
 * teardown; anything that is not a `{chat?}` object is treated as no choice at
 * all, since the blob is forward-compatible json. A blob written by an older
 * build carries a second key naming a composer look, which the messages widget
 * holds as a setting rather than a skin — it is read past.
 */
export function setLegacyStylePacks(next: unknown): void {
	if (!next || typeof next !== "object" || Array.isArray(next)) {
		legacyPacks = null
		return
	}
	const { chat } = next as LegacyStylePacks
	legacyPacks = { chat: typeof chat === "string" ? chat : null }
}

/**
 * Register (or drop) the thing that persists a pin change. SessionLayout owns
 * the round trip; pass `null` on teardown so a write can never land in a page
 * that has gone.
 */
export function setWidgetStylePinWriter(
	writer: ((next: Record<string, WidgetStyleRef>) => void) | null
): void {
	pinWriter = writer
}

/**
 * Pin one widget to a style (or `null` to clear it and fall back to the
 * widget's default). The pins held here are NOT updated optimistically: the
 * writer persists, the page re-reads its `layoutSettings`, and `setWidgetStylePins`
 * comes back round — one source of truth, and a refused write simply never
 * shows.
 */
export function setWidgetStylePin(
	widgetId: string,
	ref: WidgetStyleRef | null
): void {
	const next = { ...pins }
	if (ref) next[widgetId] = ref
	else delete next[widgetId]
	pinWriter?.(next)
}

/**
 * Turn the per-widget style overlays on or off. Leaving style mode also drops
 * the pin and any half-typed draft — an overlay that is not on screen must not
 * still be repainting a widget with CSS nobody can see or cancel.
 */
export function setWidgetStyleMode(on: boolean): void {
	// Called from SessionLayout's effect: untracked, or that effect would
	// depend on `armed` and re-run whenever the settings modal arms a widget
	// OUTSIDE style mode (the phone editor opens the modal with no mode) —
	// and the re-run's "exit" would disarm it and drop its live preview.
	untrack(() => {
		styleMode = on
		if (on) return
		armed = nextArmed(armed, { type: "exit" })
		preview = null
		dropSaveHold()
	})
}

/** The css/vars a widget renders now — its draft if one is open, else its row. */
export function effectiveWidgetSkin(widgetId: string): RenderedSkin {
	return skinToRender(widgetId, resolveWidgetStyle(widgetId), preview)
}

/**
 * The rows and the writes, live. Call from a component; the first caller starts
 * the fetch. Returns getters so a `$derived` in the caller re-runs when the
 * list lands, exactly as `completionTemplateOptions` does.
 */
export function widgetStylesStore() {
	start()
	const socket = () => socketOrNull()
	return {
		get rows() {
			return rows
		},
		get loaded() {
			return loaded
		},
		get error() {
			return lastError
		},
		get pins() {
			return pins
		},
		/** Is the editor's Style tab open? (Gates the hover overlays.) */
		get styleMode() {
			return styleMode
		},
		/** Which widget's overlay is pinned open, if any. */
		get armed() {
			return armed
		},
		/** The unsaved draft currently being typed, if any. */
		get preview() {
			return preview
		},
		/**
		 * The widget whose save is still in flight, if any. Its editor stays
		 * open until this clears — on a landing, because the preview is what
		 * bridges the round trip, and on a refusal, because the draft is the
		 * only copy of what the author typed.
		 */
		get saving() {
			return pendingSave?.widgetId ?? null
		},
		/** Give up on a held save (Cancel): the draft is going, so the hold is. */
		cancelSave() {
			dropSaveHold()
		},
		arm(widgetId: string) {
			armed = nextArmed(armed, { type: "arm", widgetId })
		},
		/** Release the pin — but only if this widget is the one holding it. */
		disarm(widgetId?: string) {
			armed = nextArmed(armed, { type: "disarm", widgetId })
			if (armed === null) {
				preview = null
				dropSaveHold()
			}
		},
		/** Live-apply an unsaved draft (or `null` to revert to the saved row). */
		setPreview(next: StyleDraftPreview | null) {
			preview = next
		},
		/** Pin a widget to a style; `null` clears it back to the default. */
		pin(widgetId: string, ref: WidgetStyleRef | null) {
			setWidgetStylePin(widgetId, ref)
		},
		clearError() {
			lastError = null
		},
		/**
		 * Re-ask for the whole usable set.
		 *
		 * Deliberately UNSCOPED even though the event takes a `widgetSlug`: the
		 * reply is `{ styles }` with no echo of the scope, and the server's
		 * post-mutation push is unfiltered anyway — so a scoped request would
		 * leave the reducer guessing which widget an arriving list is about,
		 * for no gain. Narrowing per widget is this module's job.
		 */
		refresh() {
			if (!socket()) return
			requestWithInterest("widgetStyles:list", {}, onList)
		},
		/**
		 * `pinTo` is the widget that should WEAR the new row the moment it
		 * lands — the whole reason anyone presses New from a widget's overlay.
		 */
		create(params: Sockets.WidgetStyles.Create.Params, pinTo?: string) {
			lastError = null
			if (!socket()) return
			pinOnCreate = pinTo ?? null
			// Hold `pinTo`'s live preview across the round trip. No id yet —
			// the create reply is what names the row (see `nextSaveState`).
			if (pinTo) pendingSave = { widgetId: pinTo, id: null }
			requestWithInterest("widgetStyles:create", params, onCreated)
		},
		/**
		 * `holdFor` is the widget whose live preview should stay up until the
		 * saved row is what it resolves to — without it, Save drops the draft
		 * and the widget shows its PRE-save CSS until the refreshed list lands.
		 */
		update(params: Sockets.WidgetStyles.Update.Params, holdFor?: string) {
			lastError = null
			const s = socket()
			if (!s) return
			if (holdFor) pendingSave = { widgetId: holdFor, id: params.id }
			// Fire-and-forget: nothing reads a `widgetStyles:update` reply —
			// the refreshed `:list` the server pushes after it is what the
			// store folds in — so there is no interest to declare, and the
			// gate skips the reply nobody was going to read.
			s.emit("widgetStyles:update", params)
		},
		remove(id: number) {
			lastError = null
			// Fire-and-forget for the same reason as `update` above.
			socket()?.emit("widgetStyles:delete", { id })
		},
		clone(id: number, pinTo?: string, title?: string) {
			lastError = null
			pinOnCreate = pinTo ?? null
			if (!socket()) return
			requestWithInterest(
				"widgetStyles:clone",
				title ? { id, title } : { id },
				onCreated
			)
		}
	}
}
