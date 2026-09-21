/**
 * The stage's store and the pure translations around it (session layout v2, P2).
 *
 * Everything the stage decides that is not `resolve`'s answer lives in
 * `layoutStore` and is tested here away from the DOM: which document is in
 * force, which box it is resolved at, and how the answer becomes the two things
 * the DOM needs — a `PlacementInput` and an inline style.
 */
import { describe, expect, test } from "vitest"
import {
	ADVENTURE_LAYOUT,
	ADVENTURE_LAYOUT_V2,
	CORE_LOOKS,
	CORE_WIDGETS
} from "@serene-pub/core-catalog"
import { REFERENCE_BOXES, resolve, type LayoutDoc } from "@serene-pub/sdk"
import type { PanelInstance } from "$lib/client/surfaces/types"
import {
	BUILT_IN_DOC,
	LayoutStore,
	backdropStyle,
	boxFor,
	chromeOf,
	declsFor,
	effectiveDocument,
	glassOf,
	parseArea,
	placementFromResolved,
	sideWidthStyle,
	varsStyle,
	widgetDeclFromPanel
} from "./layoutStore.svelte"

const DECLS = { widgets: CORE_WIDGETS, looks: CORE_LOOKS }

describe("effectiveDocument", () => {
	test("projects the legacy Adventure blob, right column and all", () => {
		const doc = effectiveDocument({
			zoneLayout: ADVENTURE_LAYOUT.zoneLayout,
			widgetGrid: ADVENTURE_LAYOUT.widgetGrid,
			arrangedGrid: ADVENTURE_LAYOUT.arrangedGrid,
			genreId: "core:genre/adventure"
		})
		expect(doc.version).toBe(2)
		expect(doc.zones.right?.units.map((u) => u.key)).toEqual([
			"scene-portraits",
			"stats",
			"inventory"
		])
		// The strip above the conversation survives as two row EXTENTS rather
		// than as an anchor bitmap — that is the whole difference from the
		// arrangement it replaces.
		expect(doc.zones.middle.rows).toEqual(["fit", "grow"])
		expect(doc.zones.middle.units.map((u) => u.key)).toEqual([
			"world-state",
			"messages"
		])
	})

	test("nothing saved and no genre document: the built-in one", () => {
		expect(effectiveDocument({})).toBe(BUILT_IN_DOC)
		expect(
			effectiveDocument({ genreId: "core:genre/chat" })
		).toBe(BUILT_IN_DOC)
	})

	test("three absent slots are not an empty saved layout", () => {
		// `fromLegacy` reads "is any legacy key here?" off `hasOwnProperty`, so
		// passing three `undefined` values would make an empty blob shadow the
		// genre's own document with an empty middle. This is that guard.
		const doc = effectiveDocument({
			zoneLayout: undefined,
			widgetGrid: undefined,
			arrangedGrid: undefined,
			genreId: "core:genre/adventure"
		})
		expect(doc).toBe(ADVENTURE_LAYOUT_V2.layout)
	})

	test("the genre's v2 document passes straight through", () => {
		expect(effectiveDocument({ genreId: "core:genre/adventure" })).toBe(
			ADVENTURE_LAYOUT_V2.layout
		)
	})
})

describe("boxFor", () => {
	const measured = { width: 1600, height: 900 }
	test("Actual is the measured box", () => {
		expect(boxFor({ breakpointOverride: null }, measured)).toBe(measured)
	})
	test("a chosen size is that size's reference box", () => {
		expect(boxFor({ breakpointOverride: "compact" }, measured)).toEqual(
			REFERENCE_BOXES.compact
		)
	})
})

describe("declsFor", () => {
	const panel: PanelInstance = {
		id: "party",
		title: "Party",
		icon: "Users",
		role: "secondary",
		surface: { kind: "native", component: "party" },
		channels: ["main"],
		layout: {
			span: { ideal: 1, min: 1, max: 2 },
			minInline: 220,
			minBlock: 120,
			collapsible: true,
			closable: true,
			prefer: "drawer"
		},
		active: true,
		collapsed: false,
		drawered: false,
		order: 0
	}

	test("a mode panel becomes a widget declaration", () => {
		const decl = widgetDeclFromPanel(panel)
		expect(decl.id).toBe("party")
		expect(decl.title).toBe("Party")
		expect(decl.channels).toEqual(["main"])
		// The one deprecated hint with an exact v2 spelling.
		expect(decl.placement).toEqual({ pinned: false })
		// Nothing invented: `minInline` is pixels, and `cells` is cells.
		expect(decl.cells).toBeUndefined()
	})

	test("core wins a collision, so `messages` keeps its anchor guarantee", () => {
		const impostor = { ...panel, id: "messages", title: "Nope" }
		const decls = declsFor([impostor])
		const messages = decls.widgets?.find((w) => w.id === "messages")
		expect(messages?.role).toBe("primary")
		expect(messages?.priority).toBe(0)
		expect(messages?.fold).toBe("shrink")
		expect(decls.looks).toBe(CORE_LOOKS)
	})
})

describe("parseArea", () => {
	test("reads the four lines back", () => {
		expect(parseArea("2 / 1 / 3 / 4")).toEqual({
			rowStart: 2,
			colStart: 1,
			rowEnd: 3,
			colEnd: 4
		})
	})
	test("total: anything that is not four numbers is null", () => {
		expect(parseArea("auto")).toBeNull()
		expect(parseArea("1 / 2 / 3")).toBeNull()
		expect(parseArea("")).toBeNull()
	})
	test("an end line never precedes its start", () => {
		expect(parseArea("3 / 3 / 1 / 1")).toEqual({
			rowStart: 3,
			colStart: 3,
			rowEnd: 4,
			colEnd: 4
		})
	})
})

describe("placementFromResolved", () => {
	const r = resolve(
		ADVENTURE_LAYOUT_V2.layout,
		{ width: 1600, height: 900 },
		DECLS
	)

	test("the cells a unit is actually in, and the edges they touch", () => {
		const middle = r.zones.middle!
		const messages = middle.units.find((u) => u.key === "messages")!
		const p = placementFromResolved(middle, messages, {
			widthPx: 900,
			pinned: true
		})
		expect(p.zone).toEqual({ columns: 1, column: 1, rows: 2, row: 2 })
		expect(p.box.cols).toBe(1)
		expect(p.box.rows).toBe(1)
		expect(p.box.edges).toEqual({
			top: false,
			left: true,
			right: true,
			bottom: true
		})
		// A widget in its own box, not the window's.
		expect(p.tier).toBe("cozy")
		expect(p.pinned).toBe(true)
	})

	test("the track counts come from the templates, paren-aware", () => {
		const right = r.zones.right!
		const stats = right.units.find((u) => u.key === "stats")!
		const p = placementFromResolved(right, stats, {
			widthPx: 264,
			pinned: true
		})
		expect(p.zone.rows).toBe(3)
		expect(p.zone.columns).toBe(1)
		expect(p.zone.row).toBe(2)
		expect(p.tier).toBe("compact")
	})

	test("an unreadable area falls back to one cell rather than throwing", () => {
		const middle = r.zones.middle!
		const p = placementFromResolved(
			middle,
			{ key: "x", area: "nonsense" },
			{ widthPx: 0, pinned: false }
		)
		expect(p.zone.row).toBe(1)
		expect(p.box.cols).toBe(1)
	})
})

describe("sideWidthStyle", () => {
	test("the default docked width is six cells", () => {
		expect(sideWidthStyle()).toContain("calc(6 * var(--sp-cell))")
	})
	test("each extent gets the flex spelling that means the same thing", () => {
		expect(sideWidthStyle("grow")).toContain("flex:1 1 0")
		expect(sideWidthStyle("fit")).toBe("flex:0 0 auto;")
		expect(sideWidthStyle({ grow: 4 })).toContain("flex:4 1 0")
		expect(sideWidthStyle({ cells: 8 })).toContain(
			"flex:0 0 calc(8 * var(--sp-cell))"
		)
		const range = sideWidthStyle({ min: 4, max: 10 })
		expect(range).toContain("min-inline-size:calc(4 * var(--sp-cell))")
		expect(range).toContain("max-inline-size:calc(10 * var(--sp-cell))")
	})
})

describe("looks", () => {
	test("chrome and glass cascade, nearest scope first", () => {
		expect(chromeOf([undefined, { chrome: "bare" }, undefined])).toBe(
			"bare"
		)
		expect(chromeOf([{ chrome: "card" }, { chrome: "bare" }])).toBe("card")
		// The declaration's default, when nobody deviates.
		expect(chromeOf([undefined, undefined])).toBe("card")
		expect(glassOf([undefined, { glass: true }])).toBe(true)
		expect(glassOf([{ glass: false }, { glass: true }])).toBe(false)
		expect(glassOf([undefined])).toBe(false)
	})

	test("a backdrop names an image by media row id, never a URL", () => {
		expect(backdropStyle({ backdrop: { kind: "media", media: 7 } })).toBe(
			'background-image:url("/media/7");background-size:cover;background-position:center;'
		)
		// Not a row id, so nothing is fetched.
		expect(
			backdropStyle({
				backdrop: { kind: "media", media: "https://elsewhere/x.png" }
			})
		).toBe("")
	})

	test("a colour that could break out of the inline style is refused", () => {
		expect(backdropStyle({ backdrop: { kind: "color", color: "#204" } })).toBe(
			"background-color:#204;"
		)
		expect(
			backdropStyle({
				backdrop: { kind: "color", color: "red;position:fixed" }
			})
		).toBe("")
	})

	test("no backdrop is no declaration", () => {
		expect(backdropStyle(undefined)).toBe("")
		expect(backdropStyle({ backdrop: { kind: "none" } })).toBe("")
	})

	test("vars become one inline-style string", () => {
		expect(varsStyle({ "--sp-cell": "2.75rem", "--sp-gap": "12px" })).toBe(
			"--sp-cell:2.75rem;--sp-gap:12px;"
		)
		expect(varsStyle(undefined)).toBe("")
	})
})

describe("LayoutStore", () => {
	test("resolves the document at the measured box", () => {
		const store = new LayoutStore()
		store.setDocument(ADVENTURE_LAYOUT_V2.layout)
		store.setDecls(DECLS)
		store.setBox(1600, 900)
		expect(store.resolved.breakpoint).toBe("wide")
		expect(store.resolved.zones.right?.state).toBe("docked")
		expect(store.resolved.vars["--sp-cell"]).toBe("2.75rem")

		// Below roomy the sides are sheets and the middle is the page.
		store.setBox(390, 844)
		expect(store.resolved.breakpoint).toBe("compact")
		expect(store.resolved.zones.right?.state).toBe("sheet")
	})

	test("the draft wins while one exists, and the screen picker never writes", () => {
		const store = new LayoutStore()
		store.setDocument(ADVENTURE_LAYOUT_V2.layout)
		store.setDecls(DECLS)
		store.setBox(1600, 900)
		const draft: LayoutDoc = BUILT_IN_DOC
		store.draft = draft
		expect(store.active).toBe(draft)
		expect(store.resolved.zones.right).toBeNull()

		store.setBreakpointOverride("compact")
		expect(store.resolved.breakpoint).toBe("compact")
		// The override is a view, not an edit.
		expect(store.doc).toBe(ADVENTURE_LAYOUT_V2.layout)
		expect(store.draft).toBe(draft)
	})

	test("a box that has not really changed is not a change", () => {
		const store = new LayoutStore()
		store.setBox(1000, 800)
		const box = store.box
		store.setBox(1000.4, 799.8)
		expect(store.box).toBe(box)
	})
})
