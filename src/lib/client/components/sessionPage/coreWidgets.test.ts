/**
 * Core's default session widgets, projected from core's one declaration
 * (`CORE_WIDGETS`, C2): every one core's remote (R79), served at
 * `/core-ui/<slug>`, carrying its declaration's title, icon, packing hints,
 * settings, reads and section scopes. The conversation mounts with its
 * declared reads (K12).
 */
import { describe, expect, test } from "vitest"
import { WIDGET_ID_ALIASES } from "@serene-pub/sdk"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import { CORE_CONVERSATION, coreDefaultWidgets } from "./coreWidgets"

const byId = (widgets: ReturnType<typeof coreDefaultWidgets>) => new Map(widgets.map((p) => [p.id, p]))
/** The side widgets core offers: not the conversation, not an ⏳ alias (`world-state`, W7). */
const sideDecls = () => CORE_WIDGETS.filter((w) => w.role !== "primary" && !Object.hasOwn(WIDGET_ID_ALIASES, w.id))

describe("coreDefaultWidgets", () => {
	test("every widget core declares but the conversation, in the catalogue's order", () => {
		expect(coreDefaultWidgets().map((p) => p.id)).toEqual(sideDecls().map((w) => w.id))
		// Eleven: R79 removed the Inventory widget for now; the author's note
		// (AN1), the turn order (W1), the actions (W8), the annex (W9), the
		// album (W2), the chronicle (W3), the places (W4) and Who's here
		// (W10, `attendance`) joined; World State became Stats (W7). Twelve
		// with the backdrop (DESIGN-image-generation §6.4, 2026-10-12);
		// thirteen with the routine log (PLAN-layering lane 7).
		expect(coreDefaultWidgets().map((p) => p.id).sort()).toEqual(
			["actions", "album", "annex", "attendance", "authors-note", "backdrop", "chronicle", "lore-entries", "places", "routine-log", "scene-portraits", "stats", "turn-order"]
		)
	})

	// ⏳ W7 (REMOVE in 0.7.0): World State is an alias of Stats. It stays
	// DECLARED for one release — its style rows are not pruned, its module
	// still serves — but is never offered: a placed `world-state` draws as a
	// copy of Stats, and a second World State in the tray would be a widget
	// the id no longer means.
	test("world-state stays declared while ⏳, and is not offered", () => {
		expect(CORE_WIDGETS.some((w) => w.id === "world-state")).toBe(true)
		expect(WIDGET_ID_ALIASES["world-state"]?.id).toBe("stats")
		expect(coreDefaultWidgets().some((p) => p.id === "world-state")).toBe(false)
	})

	// The law (C2): a core widget is declared once. Title, icon and packing
	// hints are the declaration's, never retyped beside it.
	test("each row's title, icon and layout deep-equal its declaration's", () => {
		const panels = byId(coreDefaultWidgets())
		for (const decl of sideDecls()) {
			const p = panels.get(decl.id)!
			expect(p.title, decl.id).toEqual(decl.title)
			expect(p.icon, decl.id).toEqual(decl.icon)
			expect(p.layout, decl.id).toEqual(decl.layout)
			// Every core side widget declares the three, so none is projected empty.
			expect(decl.icon, decl.id).toBeTruthy()
			expect(decl.layout, decl.id).toBeTruthy()
		}
	})

	test("every one core's remote by default — none native (R79)", () => {
		for (const p of coreDefaultWidgets()) {
			expect(p.role).toBe("secondary")
			expect(p.surface).toEqual({ kind: "remote", owner: "core", component: p.surface.component })
			expect(p.src).toBe(`/core-ui/${p.surface.component}`)
		}
	})

	// Whether a widget starts on is the layout's (C2): the row says nothing about it.
	test("no row carries an active-by-default flag", () => {
		for (const p of coreDefaultWidgets()) expect(Object.hasOwn(p, "defaultActive"), p.id).toBe(false)
	})

	test("each carries its declaration's settings, reads and section scopes — read, never retyped", () => {
		const panels = byId(coreDefaultWidgets())
		for (const decl of CORE_WIDGETS.filter((w) => panels.has(w.id))) {
			const p = panels.get(decl.id)!
			expect(p.settings).toEqual(decl.settings)
			expect(p.reads).toEqual(decl.reads)
		}
		expect(panels.get("stats")!.grants).toEqual(["session:state"])
		expect(panels.get("scene-portraits")!.grants).toEqual(["characters", "session:state"])
		expect(panels.get("lore-entries")!.grants).toEqual(["lore"])
		// The author's note asks for everything: no section, no scope.
		expect(panels.get("authors-note")!.reads).toEqual([])
		expect(panels.get("authors-note")!.grants).toBeUndefined()
	})

	test("the conversation mounts core's own module with the reads it declares (K12)", () => {
		const decl = CORE_WIDGETS.find((w) => w.id === "messages")!
		expect(CORE_CONVERSATION.src).toBe("/core-ui/messages")
		expect(CORE_CONVERSATION.reads).toEqual(decl.reads)
		// Its session and props are no section it reads: the dossier tells it the rest.
		expect(CORE_CONVERSATION.reads).not.toContain("session")
	})

	// The album (W2) is the one exception, by its plan: its pictures are the
	// lines' own parts, so it is handed the log as the conversation is.
	test("the side widgets read no log — but the album", () => {
		for (const p of coreDefaultWidgets())
			if (p.id === "album") expect(p.reads, p.id).toContain("messages")
			else expect(p.reads ?? [], p.id).not.toContain("messages")
	})
})
