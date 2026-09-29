/**
 * Core's default session widgets, from one table: every one core's remote
 * (R79), served at `/core-ui/<slug>`, carrying its declaration's settings,
 * reads and section scopes. The conversation mounts with its declared reads
 * (K12).
 */
import { describe, expect, test } from "vitest"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import { CORE_CONVERSATION, coreDefaultWidgets } from "./coreWidgets"

const byId = (widgets: ReturnType<typeof coreDefaultWidgets>) => new Map(widgets.map((p) => [p.id, p]))

describe("coreDefaultWidgets", () => {
	// Four, not five: R79 removed the Inventory widget for now.
	test("the four widgets the page offers, every one core's remote by default — none native (R79)", () => {
		const panels = coreDefaultWidgets()
		expect(
			panels.map(({ id, title, icon, role, surface, src, layout, defaultActive }) => ({
				id,
				title,
				icon,
				role,
				surface,
				src,
				layout,
				defaultActive
			}))
		).toEqual([
			{
				id: "scene-portraits",
				title: "Scene Portraits",
				icon: "Users",
				role: "secondary",
				surface: { kind: "remote", owner: "core", component: "scene-portraits" },
				src: "/core-ui/scene-portraits",
				layout: { span: { ideal: 1 }, minInline: 200 },
				defaultActive: true
			},
			{
				id: "stats",
				title: "Stats",
				icon: "HeartPulse",
				role: "secondary",
				surface: { kind: "remote", owner: "core", component: "stats" },
				src: "/core-ui/stats",
				layout: { span: { ideal: 1 }, minInline: 220 },
				defaultActive: false
			},
			{
				id: "world-state",
				title: "World State",
				icon: "CloudSun",
				role: "secondary",
				surface: { kind: "remote", owner: "core", component: "world-state" },
				src: "/core-ui/world-state",
				layout: { span: { ideal: 2 }, minInline: 240, minBlock: 60 },
				defaultActive: false
			},
			{
				id: "lore-entries",
				title: "Lore entries",
				icon: "BookOpen",
				role: "secondary",
				surface: { kind: "remote", owner: "core", component: "lore-entries" },
				src: "/core-ui/lore-entries",
				layout: { span: { ideal: 1 }, minInline: 260 },
				defaultActive: false
			}
		])
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
	})

	test("the conversation mounts core's own module with the reads it declares (K12)", () => {
		const decl = CORE_WIDGETS.find((w) => w.id === "messages")!
		expect(CORE_CONVERSATION.src).toBe("/core-ui/messages")
		expect(CORE_CONVERSATION.reads).toEqual(decl.reads)
		// Its session and props are no section it reads: the dossier tells it the rest.
		expect(CORE_CONVERSATION.reads).not.toContain("session")
	})

	test("the side widgets read no log", () => {
		for (const p of coreDefaultWidgets()) expect(p.reads ?? [], p.id).not.toContain("messages")
	})
})
