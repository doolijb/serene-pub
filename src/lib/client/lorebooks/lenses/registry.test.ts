/**
 * The lens registry is the one place a lens is declared (DESIGN-lorebooks-ui-
 * modularity §4). These pin what everything else now derives from it: the
 * lens row's order, which screen draws a lens, which scopes it draws, which
 * lenses a saved scope or the Loose ends queue opens, day one's bypass, the
 * canvases, the shortcuts — and that every lens's address still lands.
 */
import { describe, expect, it } from "vitest"
import {
	DEFAULT_LENS,
	fromHash,
	LORE_LENSES,
	LORE_SCOPES,
	toHash,
	type LoreLens
} from "$lib/shared/lorebooks/loreRoute"
import {
	drawingForLens,
	lensDescriptor,
	lensDrawsScope,
	lensEmptyMessage,
	lensForKey,
	lensListsPool,
	lensReason,
	LORE_LENS_REGISTRY,
	matchesShortcut,
	QUEUE_LENS,
	shortcutLabel
} from "./registry"

const ids = LORE_LENS_REGISTRY.map((d) => d.id)

describe("LORE_LENS_REGISTRY — every lens, declared once", () => {
	it("holds every lens the route knows, in the route's order (the lens row's)", () => {
		expect(ids).toEqual([...LORE_LENSES])
		expect(new Set(ids).size).toBe(ids.length)
	})

	it("gives every lens a label, an icon, a mount and a shortcut", () => {
		for (const d of LORE_LENS_REGISTRY) {
			expect(d.label.trim(), d.id).not.toBe("")
			expect(d.icon, d.id).toBeTruthy()
			expect(["pool", "drawing", "time", "lives"], d.id).toContain(d.mount)
			expect(d.shortcut, d.id).toMatch(/^Alt\+Shift\+\d$/)
		}
	})

	it("keeps the labels the lens row has always said", () => {
		expect(LORE_LENS_REGISTRY.map((d) => d.label)).toEqual([
			"List",
			"Cards",
			"Tree",
			"Graph",
			"Time",
			"Lives",
			"Places"
		])
	})

	it("shares a mount between lenses that draw one screen", () => {
		const mountOf = (id: LoreLens) => lensDescriptor(id).mount
		expect(new Set(["list", "cards", "tree"].map((id) => mountOf(id as LoreLens)))).toEqual(
			new Set(["pool"])
		)
		expect(mountOf("graph")).toBe("drawing")
		expect(mountOf("places")).toBe("drawing")
		expect(mountOf("time")).toBe("time")
		expect(mountOf("lives")).toBe("lives")
	})

	it("declares only lists BookData has", () => {
		const lists = [
			"rows",
			"rawRows",
			"cast",
			"scenes",
			"allScenes",
			"suggestions",
			"duplicates"
		]
		for (const d of LORE_LENS_REGISTRY)
			for (const read of d.reads) expect(lists, d.id).toContain(read)
	})
})

describe("drawsScope — the lens × scope matrix, explicit", () => {
	it("the pool lenses, Graph and Time draw every scope", () => {
		for (const lens of ["list", "cards", "tree", "graph", "time"] as const)
			for (const scope of LORE_SCOPES)
				expect(lensDrawsScope(lens, scope), `${lens} × ${scope}`).toBe("draws")
	})

	it("Places and Lives draw their own set whatever the scope", () => {
		for (const lens of ["places", "lives"] as const)
			for (const scope of LORE_SCOPES)
				expect(lensDrawsScope(lens, scope), `${lens} × ${scope}`).toBe("ignores")
	})

	it("the default lens draws every scope and lists the pool — the fallback is safe", () => {
		for (const scope of LORE_SCOPES)
			expect(lensDrawsScope(DEFAULT_LENS, scope)).toBe("draws")
		expect(lensListsPool(DEFAULT_LENS)).toBe(true)
	})
})

describe("listsPool / QUEUE_LENS — the lenses a saved scope and the queue open", () => {
	it("only List, Cards and Tree draw a list a saved scope narrows", () => {
		expect(ids.filter(lensListsPool)).toEqual(["list", "cards", "tree"])
	})

	it("draws the Loose ends queue on exactly one lens, List, which lists the pool", () => {
		expect(LORE_LENS_REGISTRY.filter((d) => d.holdsQueue)).toHaveLength(1)
		expect(QUEUE_LENS).toBe("list")
		expect(lensListsPool(QUEUE_LENS)).toBe(true)
	})
})

describe("bypassesDayOne / empty — who draws their own empty state", () => {
	it("day one stands in front of the pool lenses only (#82)", () => {
		expect(ids.filter((id) => lensDescriptor(id).bypassesDayOne)).toEqual([
			"graph",
			"time",
			"lives",
			"places"
		])
	})

	it("every lens that bypasses day one says something when it has nothing to draw", () => {
		for (const d of LORE_LENS_REGISTRY)
			if (d.bypassesDayOne) expect(lensEmptyMessage(d.id), d.id).not.toBe("")
			else expect(d.empty, `${d.id} says its scope's copy`).toBeUndefined()
	})
})

describe("drawingForLens — which canvas a lens asks for (was graphs.ts)", () => {
	it("maps the two canvas lenses onto the canvases", () => {
		expect(drawingForLens("graph")).toBe("relationships")
		expect(drawingForLens("places")).toBe("places")
	})

	it("leaves the pool, Time and Lives to draw themselves", () => {
		for (const lens of ["list", "cards", "tree", "time", "lives"] as const)
			expect(drawingForLens(lens)).toBeNull()
	})
})

describe("lensReason — why a lens cannot be drawn", () => {
	it("offers every lens", () => {
		for (const lens of LORE_LENSES) expect(lensReason(lens)).toBeNull()
	})
})

/** A key press as the handler reads one. */
function press(
	code: string,
	mods: Partial<Record<"altKey" | "shiftKey" | "ctrlKey" | "metaKey", boolean>> = {},
	extra: Partial<{ target: unknown; defaultPrevented: boolean; repeat: boolean }> = {}
): KeyboardEvent {
	return {
		code,
		altKey: false,
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
		defaultPrevented: false,
		repeat: false,
		target: { isContentEditable: false, closest: () => null },
		...mods,
		...extra
	} as unknown as KeyboardEvent
}

describe("shortcuts — one per lens, heard outside fields", () => {
	it("gives every lens its own", () => {
		const shortcuts = LORE_LENS_REGISTRY.map((d) => d.shortcut)
		expect(new Set(shortcuts).size).toBe(shortcuts.length)
	})

	it("matches the physical key with exactly its modifiers", () => {
		const both = { altKey: true, shiftKey: true }
		expect(matchesShortcut(press("Digit4", both), "Alt+Shift+4")).toBe(true)
		expect(matchesShortcut(press("Digit4", { altKey: true }), "Alt+Shift+4")).toBe(false)
		expect(
			matchesShortcut(press("Digit4", { ...both, ctrlKey: true }), "Alt+Shift+4")
		).toBe(false)
		expect(matchesShortcut(press("Digit5", both), "Alt+Shift+4")).toBe(false)
	})

	it("asks for each lens by its own shortcut", () => {
		for (const [i, id] of LORE_LENSES.entries())
			expect(lensForKey(press(`Digit${i + 1}`, { altKey: true, shiftKey: true }))).toBe(id)
	})

	it("leaves typing, repeats and keys already claimed alone", () => {
		const both = { altKey: true, shiftKey: true }
		const field = { isContentEditable: false, closest: () => ({}) }
		expect(lensForKey(press("Digit4", both, { target: field }))).toBeNull()
		expect(
			lensForKey(press("Digit4", both, { target: { isContentEditable: true, closest: () => null } }))
		).toBeNull()
		expect(lensForKey(press("Digit4", both, { defaultPrevented: true }))).toBeNull()
		expect(lensForKey(press("Digit4", both, { repeat: true }))).toBeNull()
		expect(lensForKey(press("Digit4"))).toBeNull()
	})

	it("reads as the platform writes it", () => {
		expect(shortcutLabel("Alt+Shift+4", false)).toBe("Alt+Shift+4")
		expect(shortcutLabel("Alt+Shift+4", true)).toBe("⌥⇧4")
	})
})

describe("deep links — every lens's address still lands on it", () => {
	it("round-trips each lens through the hash, on a scope it ignores too", () => {
		for (const lens of LORE_LENSES)
			for (const scope of ["all", "history", "cast"] as const) {
				const route = { lorebookId: 12, scope, lens }
				expect(fromHash(toHash(route))?.lens, `${scope}?lens=${lens}`).toBe(lens)
				expect(fromHash(toHash(route))?.scope).toBe(scope)
			}
	})

	it("reads the written address the way people paste it", () => {
		expect(fromHash("#lore=12/history?lens=places")).toMatchObject({
			lorebookId: 12,
			scope: "history",
			lens: "places"
		})
	})
})
