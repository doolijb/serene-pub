/**
 * The stage's store (session layout v2, plan §3.3) — and the pure functions
 * around it that turn what the app already holds into the SDK's inputs and the
 * SDK's answer into what the DOM needs.
 *
 * The store is deliberately thin: a **layout document**, an optional draft the
 * editor will own (P4), a screen-size override the Screen picker will own (P4),
 * the measured session box, and `resolved` — `resolve(draft ?? doc, boxFor(…))`
 * and nothing else. Every rule about zones, tracks, folds and looks lives in
 * `@serene-pub/sdk`'s `layout.ts`; the stage is a renderer for its answer.
 *
 * ## Where the document comes from, at P2
 *
 * Storage is P3. Until then `effectiveDocument` reads the three legacy slots
 * the `SurfaceManager` already carries and projects them through the SDK's
 * `fromLegacy`, falling back to the genre's shipped v2 document and then to the
 * built-in chat document. That order is the one the plan states, and it is why
 * a session that has never been edited draws the same thing under the flag as
 * without it.
 *
 * ⚠ No persistence and no operations here. `dispatch` / `done` / `cancel`
 * arrive with the editor (P4); a `draft` field exists now only so the derived
 * chain is already the shape they need.
 */
import {
	DEFAULT_SIDE_WIDTH,
	REFERENCE_BOXES,
	fromLegacy,
	resolve,
	trackCount,
	type Box,
	type Breakpoint,
	type Extent,
	type LayoutDecls,
	type LayoutDoc,
	type LookBag,
	type LookDecl,
	type Resolved,
	type ResolvedUnit,
	type ResolvedZone,
	type WidgetDecl
} from "@serene-pub/sdk"
import { CORE_LOOKS, coreLayoutV2 } from "@serene-pub/core-catalog"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import {
	BUILT_IN_LAYOUT_DOC,
	builtInLayoutDoc
} from "$lib/shared/sessionLayout/document"
import type { PanelInstance } from "$lib/client/surfaces/types"
import type { PlacementInput } from "$lib/shared/widgets/context"
import { mediaUrl } from "$lib/client/utils/media"
import { placementOf } from "./widgetGrid"

/**
 * The built-in document: a session is a conversation, and nothing else is
 * assumed. One grow row, one grow column, the `messages` widget in it, no
 * sides. This is what a genre that ships no layout document resolves to, and
 * what `resolve`'s "the middle is never empty" rule would rebuild anyway — it
 * is written out so the floor is a document a person can edit rather than a
 * special case inside the renderer.
 *
 * Re-exported from the shared module (`$lib/shared/sessionLayout/document`) so
 * the server's resolver and this stage cannot drift — the two are the same
 * document. It is frozen; anything that stores it in reactive state or mutates
 * it takes `builtInLayoutDoc()` instead.
 */
export const BUILT_IN_DOC: LayoutDoc = BUILT_IN_LAYOUT_DOC

/** The legacy slots the `SurfaceManager` carries, plus the session's genre. */
export interface DocumentSources {
	zoneLayout?: unknown
	widgetGrid?: unknown
	arrangedGrid?: unknown
	genreId?: string | null
}

/**
 * The document in force for a session: this person's saved arrangement, else
 * the genre's shipped document, else the built-in one.
 *
 * Only slots that are actually present are handed to `fromLegacy` — it reads
 * "is any legacy key here?" off `hasOwnProperty`, so passing three `undefined`
 * values would make an empty blob look like a saved layout and shadow the
 * genre's own document with an empty middle.
 *
 * `fromLegacy` also passes a v2 document (or a `LayoutPreset` around one)
 * straight through, which is what makes this the same call site once P3 starts
 * storing documents rather than blobs.
 */
export function effectiveDocument(src: DocumentSources): LayoutDoc {
	const blob: Record<string, unknown> = {}
	if (src.zoneLayout != null) blob.zoneLayout = src.zoneLayout
	if (src.widgetGrid != null) blob.widgetGrid = src.widgetGrid
	if (src.arrangedGrid != null) blob.arrangedGrid = src.arrangedGrid
	const legacy = Object.keys(blob).length ? fromLegacy(blob) : null
	return (
		legacy?.layout ??
		coreLayoutV2(src.genreId ?? "")?.preset.layout ??
		BUILT_IN_DOC
	)
}

/** What the view is looking at: the real box, or a size's reference box. */
export interface LayoutView {
	/** P4's Screen picker. `null` is Actual — the measured box. */
	breakpointOverride: Breakpoint | null
}

/**
 * The box `resolve` is called with. Actual is the measured session box; a
 * chosen size is that size's reference box, so "what the phone will do" is one
 * answer rather than two.
 */
export function boxFor(view: LayoutView, measured: Box): Box {
	const bp = view.breakpointOverride
	if (!bp) return measured
	const ref = REFERENCE_BOXES[bp]
	return { width: ref.width, height: ref.height }
}

/**
 * One of the session's mode panels as a **widget declaration**.
 *
 * A mode panel is a widget — it always was — so the parts that mean the same
 * thing are copied across and nothing is invented: there is no honest cells
 * floor to derive from `layout.minInline` (pixels, not cells), so a panel
 * declares none and `resolve` treats it as unbounded, which is what it does
 * today. `prefer: 'drawer'` is the one deprecated hint with an exact v2
 * spelling, and the SDK names that mapping itself.
 */
export function widgetDeclFromPanel(p: PanelInstance): WidgetDecl {
	return {
		id: p.id,
		title: p.title,
		...(p.icon ? { icon: p.icon } : {}),
		role: p.role,
		surface: p.surface,
		...(p.channels?.length ? { channels: p.channels } : {}),
		...(p.settings ? { settings: p.settings } : {}),
		...(p.layout?.prefer === "drawer"
			? { placement: { pinned: false } }
			: {})
	}
}

/**
 * The declarations `resolve` reads: core's widgets and looks, plus any mode
 * panel core does not already declare.
 *
 * Core wins a collision on purpose — its declaration carries `fold`,
 * `priority` and `cells`, which the panel contract has no way to say — so a
 * mode that re-declares `messages` cannot cost the conversation its anchor
 * guarantee.
 */
export function declsFor(panels: readonly PanelInstance[] = []): LayoutDecls {
	const byId = new Map<string, WidgetDecl>(CORE_WIDGETS.map((w) => [w.id, w]))
	for (const p of panels)
		if (!byId.has(p.id)) byId.set(p.id, widgetDeclFromPanel(p))
	return { widgets: [...byId.values()], looks: CORE_LOOKS }
}

/* ── the answer, as the DOM needs it ──────────────────────────────────── */

export interface AreaLines {
	rowStart: number
	colStart: number
	rowEnd: number
	colEnd: number
}

/**
 * A `grid-area` line string back into its four numbers.
 *
 * `resolve` writes the string and the stage writes it straight back out as an
 * inline style — but the widget data contract wants the cells as numbers, and
 * re-deriving them from the document would be a second layout pass that could
 * disagree with the one the browser is drawing. Total: anything that is not
 * four finite numbers is `null`, and the caller falls back to one cell.
 */
export function parseArea(area: string): AreaLines | null {
	const parts = String(area ?? "")
		.split("/")
		.map((s) => Number(s.trim()))
	if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
	const [rowStart, colStart, rowEnd, colEnd] = parts as [
		number,
		number,
		number,
		number
	]
	return {
		rowStart,
		colStart,
		rowEnd: Math.max(rowEnd, rowStart + 1),
		colEnd: Math.max(colEnd, colStart + 1)
	}
}

/**
 * A resolved unit's `PlacementInput` — the `layout.v1` section every widget,
 * native or frame, reads its own geometry from.
 *
 * The zone's track counts come from the templates `resolve` emitted rather than
 * from the document, because a folded zone's tracks are derived and the
 * document's are not: counting the template is counting what is on screen.
 * `trackCount` is paren-aware, so `calc(4 * var(--sp-cell))` counts as one.
 */
export function placementFromResolved(
	zone: ResolvedZone,
	unit: ResolvedUnit,
	opts: {
		widthPx: number
		/**
		 * The measured block size, where the renderer binds one. Both axes or
		 * neither reach the contract's `box.px` — see `PlacementOpts.heightPx`.
		 */
		heightPx?: number
		pinned: boolean
		chrome?: PlacementInput["chrome"]
	}
): PlacementInput {
	const a = parseArea(unit.area) ?? {
		rowStart: 1,
		colStart: 1,
		rowEnd: 2,
		colEnd: 2
	}
	return placementOf({
		zone: {
			cols: Math.max(1, trackCount(zone.gridTemplateColumns)),
			rows: Math.max(1, trackCount(zone.gridTemplateRows))
		},
		box: {
			x: a.colStart - 1,
			y: a.rowStart - 1,
			w: a.colEnd - a.colStart,
			h: a.rowEnd - a.rowStart
		},
		widthPx: opts.widthPx,
		heightPx: opts.heightPx,
		pinned: opts.pinned,
		collapsed: false,
		drawered: false,
		...(opts.chrome ? { chrome: opts.chrome } : {})
	})
}

/**
 * A docked side's inline size, as flex.
 *
 * The **track extent** says what the column means; flex is where that has to
 * land, and `1fr` is not a flex basis — so each extent gets the flex spelling
 * that means the same thing. The cell module is a CSS variable, so a `cells`
 * extent stays a `calc()` and follows the reader's zoom like every other track.
 */
export function sideWidthStyle(width?: Extent): string {
	const e = width ?? DEFAULT_SIDE_WIDTH
	if (e === "grow") return "flex:1 1 0;min-inline-size:0;"
	if (e === "fit") return "flex:0 0 auto;"
	if (typeof e === "object" && "grow" in e)
		return `flex:${e.grow} 1 0;min-inline-size:0;`
	if (typeof e === "object" && "cells" in e) {
		const px = `calc(${e.cells} * var(--sp-cell))`
		return `flex:0 0 ${px};inline-size:${px};`
	}
	const min =
		typeof e.min === "number" ? `calc(${e.min} * var(--sp-cell))` : "0"
	const max =
		typeof e.max === "number" ? `calc(${e.max} * var(--sp-cell))` : "none"
	return `flex:1 1 auto;min-inline-size:${min};max-inline-size:${max};`
}

/* ── looks ────────────────────────────────────────────────────────────── */

/**
 * A look's value at one scope, falling back to its declaration's default.
 *
 * `resolve` emits pass-through looks as CSS variables, which is enough for
 * anything CSS can consume — but `backdrop` is a record and `chrome` decides
 * which component tree is drawn, so the stage reads those two from the bags
 * themselves. Same precedence, read twice for two different consumers.
 */
export function lookOf(
	bag: LookBag | undefined,
	key: string,
	looks: LookDecl[] = CORE_LOOKS
): unknown {
	if (bag && Object.prototype.hasOwnProperty.call(bag, key)) return bag[key]
	return looks.find((l) => l.key === key)?.field.default
}

/**
 * The nearest scope that says anything about a look, outermost last.
 *
 * `glass` and `chrome` cascade — a zone set to `bare` means every unit in it,
 * unless a unit says otherwise — while a backdrop does not: each scope paints
 * its own. So only the cascading ones go through here.
 */
export function pickLook(
	bags: Array<LookBag | undefined>,
	key: string,
	looks: LookDecl[] = CORE_LOOKS
): unknown {
	for (const bag of bags)
		if (bag && Object.prototype.hasOwnProperty.call(bag, key))
			return bag[key]
	return looks.find((l) => l.key === key)?.field.default
}

/** `card` (the host paints) or `bare` (the widget's own style paints). */
export function chromeOf(bags: Array<LookBag | undefined>): "card" | "bare" {
	return pickLook(bags, "chrome") === "bare" ? "bare" : "card"
}

/** A translucent, blurred surface. Worth it over a backdrop, not otherwise. */
export function glassOf(bags: Array<LookBag | undefined>): boolean {
	return pickLook(bags, "glass") === true
}

/**
 * A colour value that is safe to put in an inline style.
 *
 * A document is data, and an inline style is a place a semicolon ends one
 * declaration and starts another. The allowed set is what a colour is written
 * in — names, hex, the functional notations — and nothing that could close the
 * attribute or open a second property.
 */
function safeColor(value: unknown): string | null {
	if (typeof value !== "string") return null
	const v = value.trim()
	if (!v || v.length > 64) return null
	return /^[#A-Za-z0-9(),.%\s/-]+$/.test(v) ? v : null
}

/**
 * The `backdrop` look as inline style for the scope element.
 *
 * An image is named by **media row id, never a URL** — the one is a reference
 * the media table owns and can revoke, the other an unbounded fetch out of a
 * layout document — so the id goes through the app's own media route.
 */
export function backdropStyle(bag: LookBag | undefined): string {
	const v = lookOf(bag, "backdrop")
	if (!v || typeof v !== "object") return ""
	const { kind, media, color } = v as {
		kind?: unknown
		media?: unknown
		color?: unknown
	}
	if (kind === "color") {
		const c = safeColor(color)
		return c ? `background-color:${c};` : ""
	}
	if (kind === "media") {
		const id = typeof media === "number" && media > 0 ? media : null
		const url = mediaUrl(id)
		return url
			? `background-image:url("${url}");background-size:cover;background-position:center;`
			: ""
	}
	return ""
}

/** A `Record<string,string>` of CSS variables as one inline-style string. */
export function varsStyle(vars: Record<string, string> | undefined): string {
	if (!vars) return ""
	let out = ""
	for (const [k, v] of Object.entries(vars)) out += `${k}:${v};`
	return out
}

/* ── the store ────────────────────────────────────────────────────────── */

/**
 * Where the two inputs the host owns come from, when the host owns them.
 *
 * A component holds its document and its declarations as `$derived` values off
 * props, and handing them over as getters rather than writing them in through
 * an `$effect` is what makes the store correct on the FIRST render — server or
 * client. An effect runs after the render that needed it, and never at all
 * during SSR, which would leave the stage drawing the built-in document for a
 * frame (or a whole server render) before the real one arrived.
 */
export interface LayoutSources {
	document?: () => LayoutDoc
	decls?: () => LayoutDecls
}

/**
 * `doc`, `draft`, `view`, `box` in; `resolved` out. Nothing else — no snapshot,
 * no dirty flag, no gesture guard. A resize changes `box` and therefore
 * `resolved`, and that is the whole of what a resize means here.
 */
export class LayoutStore {
	#source: LayoutSources
	#doc = $state<LayoutDoc>(builtInLayoutDoc())
	#decls = $state<LayoutDecls>({ widgets: CORE_WIDGETS, looks: CORE_LOOKS })

	constructor(source: LayoutSources = {}) {
		this.#source = source
	}

	/** The editor's working copy (P4). `null` means nothing is being edited. */
	draft = $state<LayoutDoc | null>(null)
	view = $state<LayoutView>({ breakpointOverride: null })
	/** The measured session box. Seeded roomy so the first paint is not compact. */
	box = $state<Box>({ width: 1024, height: 768 })

	/** The effective document, from the page. */
	get doc(): LayoutDoc {
		return this.#source.document?.() ?? this.#doc
	}
	set doc(next: LayoutDoc) {
		this.#doc = next
	}
	/** The declarations `resolve` reads: widgets and looks. */
	get decls(): LayoutDecls {
		return this.#source.decls?.() ?? this.#decls
	}
	set decls(next: LayoutDecls) {
		this.#decls = next
	}

	resolved: Resolved = $derived(
		resolve(this.draft ?? this.doc, boxFor(this.view, this.box), this.decls)
	)

	/** The document in force, draft first — what the editor and the stage share. */
	get active(): LayoutDoc {
		return this.draft ?? this.doc
	}

	/**
	 * Replace the document, for a holder that has no source getter. A document
	 * that is the same object is not a change.
	 */
	setDocument(next: LayoutDoc) {
		if (next !== this.#doc) this.#doc = next
	}

	setDecls(next: LayoutDecls) {
		this.#decls = next
	}

	/**
	 * The session box, measured. Rounded and compared before it is written: a
	 * `ResizeObserver` fires on sub-pixel changes, and every one of them would
	 * otherwise re-run `resolve` and re-write every inline style on the stage.
	 */
	setBox(width: number, height: number) {
		const w = Math.max(0, Math.round(width))
		const h = Math.max(0, Math.round(height))
		if (this.box.width === w && this.box.height === h) return
		this.box = { width: w, height: h }
	}

	/** P4's Screen picker. `null` is Actual. */
	setBreakpointOverride(bp: Breakpoint | null) {
		if (this.view.breakpointOverride !== bp)
			this.view = { breakpointOverride: bp }
	}
}
