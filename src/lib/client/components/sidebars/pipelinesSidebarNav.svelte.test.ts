import { describe, it, expect } from "vitest"
import {
	PipelinesSidebarNav,
	genreRows,
	presetConfigFor,
	presetPipelineGroups,
	presetPipelines,
	presetsOfGenre
} from "./pipelinesSidebarNav.svelte"

/**
 * The Pipelines view's drill-in (owner request 2026-09-28): Genre → Preset →
 * Edit, with the flat list of every pipeline kept one level down as "All
 * pipelines". These pin the grouping (which presets belong under which genre,
 * which pipelines a preset reaches) and the navigation state (what Back does
 * from each level, and what a vanished row does to where you are).
 */

type Preset = Sockets.SessionAdmin.PresetRow

function preset(p: Partial<Preset> & { id: number; genreId: string }): Preset {
	return {
		name: `Preset ${p.id}`,
		description: null,
		bindings: {},
		primarySlug: null,
		configSelections: {},
		includedActions: null,
		defaults: null,
		enabled: true,
		isDefault: false,
		isImmutable: false,
		...p
	}
}

const genres = [
	{ genreId: "core:genre/chat", name: "Chat", description: "Roleplay", shape: {} },
	{ genreId: "core:genre/lair", name: "Lair", description: "", shape: {} },
	{ genreId: "core:genre/guide", name: "Guide", description: "", shape: {} }
]

const presets = [
	preset({ id: 1, genreId: "core:genre/chat", name: "Zed", isImmutable: true }),
	preset({ id: 2, genreId: "core:genre/lair", name: "Lair", isDefault: true }),
	preset({ id: 3, genreId: "core:genre/chat", name: "Alpha" }),
	preset({ id: 4, genreId: "core:genre/chat", name: "Beta", isDefault: true }),
	// A preset whose genre this instance does not offer (a disabled plugin's).
	preset({ id: 5, genreId: "plug:genre/gone", name: "Orphan" })
]

describe("genreRows", () => {
	it("lists every offered genre, in the order offered, with its preset count", () => {
		expect(genreRows(genres, presets)).toEqual([
			{ genreId: "core:genre/chat", name: "Chat", description: "Roleplay", presetCount: 3 },
			{ genreId: "core:genre/lair", name: "Lair", description: "", presetCount: 1 },
			{ genreId: "core:genre/guide", name: "Guide", description: "", presetCount: 0 }
		])
	})

	it("never invents a genre for a preset whose genre is not offered", () => {
		expect(genreRows(genres, presets).map((g) => g.genreId)).not.toContain(
			"plug:genre/gone"
		)
	})
})

describe("presetsOfGenre", () => {
	it("keeps only the genre's presets, the default first and the rest by name", () => {
		expect(presetsOfGenre("core:genre/chat", presets).map((p) => p.id)).toEqual([
			4, 3, 1
		])
	})

	it("is empty for a genre with none", () => {
		expect(presetsOfGenre("core:genre/guide", presets)).toEqual([])
	})
})

describe("presetConfigFor", () => {
	it("prefers a binding's own config, then configSelections, then nothing", () => {
		const p = preset({
			id: 9,
			genreId: "core:genre/chat",
			bindings: {
				"core:event/message-respond@1": { spec: "respond", config: 7 },
				"core:event/session-created@1": { spec: "create-chat" }
			},
			configSelections: { respond: 99, "create-chat": 12 }
		})
		expect(presetConfigFor(p, "respond")).toBe(7)
		expect(presetConfigFor(p, "create-chat")).toBe(12)
		expect(presetConfigFor(p, "narrate")).toBeNull()
	})
})

describe("presetPipelines", () => {
	const namespaces = [
		{ slug: "respond", name: "Respond" },
		{ slug: "create-chat", name: "Create chat" },
		{ slug: "narrate", name: "Narrate" }
	] as Sockets.Pipelines.Namespace[]

	it("names each pipeline the preset reaches once, with the events that bind it", () => {
		const p = preset({
			id: 9,
			genreId: "core:genre/chat",
			bindings: {
				"core:event/session-created@1": { spec: "create-chat" },
				"core:event/message-respond@1": { spec: "respond", config: 7 },
				"core:event/message-continue@1": { spec: "respond" }
			},
			includedActions: ["narrate#narrate"]
		})
		expect(presetPipelines(p, namespaces)).toEqual([
			{
				slug: "create-chat",
				name: "Create chat",
				events: ["core:event/session-created@1"],
				actions: [],
				configId: null
			},
			{
				slug: "respond",
				name: "Respond",
				events: [
					"core:event/message-respond@1",
					"core:event/message-continue@1"
				],
				actions: [],
				configId: 7
			},
			{
				slug: "narrate",
				name: "Narrate",
				events: [],
				actions: ["narrate"],
				configId: null
			}
		])
	})

	it("includes a pipeline named only by configSelections, and falls back to the slug for a name", () => {
		const p = preset({
			id: 9,
			genreId: "core:genre/chat",
			configSelections: { "plug-thing": 4 }
		})
		expect(presetPipelines(p, namespaces)).toEqual([
			{ slug: "plug-thing", name: "plug-thing", events: [], actions: [], configId: 4 }
		])
	})

	it("ignores a bare action key with no spec half", () => {
		const p = preset({ id: 9, genreId: "core:genre/chat", includedActions: ["narrate"] })
		expect(presetPipelines(p, namespaces)).toEqual([])
	})
})

/**
 * The actions a preset includes by the DEFAULT rule (`includedActions:
 * null`, every shipped preset) arrive resolved by the server as
 * `effectiveIncludedActions` — the client never re-derives the companion
 * rule. The Edit view lists them under an "Actions" subheading.
 */
describe("a preset's actions (effective included set)", () => {
	const action = (specSlug: string, key: string, name: string) => ({
		identity: `${specSlug}#${key}`,
		key,
		name,
		specSlug
	})
	const namespaces = [
		{ slug: "core:respond", name: "Respond" },
		{ slug: "core:narrate", name: "Narrate" },
		{ slug: "core:lair-nudge", name: "Lair nudge" },
		{ slug: "core:lair-whisper", name: "Lair whisper" },
		{ slug: "core:lair-trap", name: "Lair trap" }
	] as Sockets.Pipelines.Namespace[]

	it("lists a shipped Chat preset's default action (narrate) under Actions", () => {
		const chat = preset({
			id: 1,
			genreId: "core:genre/chat",
			includedActions: null,
			bindings: { "core:event/message-respond@1": { spec: "core:respond" } },
			effectiveIncludedActions: [action("core:narrate", "narrate", "Narrate")]
		})
		expect(presetPipelines(chat, namespaces).map((p) => p.slug)).toEqual([
			"core:respond",
			"core:narrate"
		])
		const groups = presetPipelineGroups(chat, namespaces)
		expect(groups.pipelines.map((p) => p.slug)).toEqual(["core:respond"])
		expect(groups.actions).toEqual([
			{
				slug: "core:narrate",
				name: "Narrate",
				events: [],
				actions: ["Narrate"],
				configId: null
			}
		])
	})

	it("lists every one of a shipped Lair preset's default actions", () => {
		const lair = preset({
			id: 2,
			genreId: "core:genre/lair",
			includedActions: null,
			effectiveIncludedActions: [
				action("core:lair-nudge", "nudge", "Nudge"),
				action("core:lair-whisper", "whisper", "Whisper"),
				action("core:lair-trap", "trap", "Trap")
			]
		})
		expect(presetPipelineGroups(lair, namespaces).actions.map((p) => p.slug)).toEqual([
			"core:lair-nudge",
			"core:lair-whisper",
			"core:lair-trap"
		])
	})

	it("an explicit included set shows exactly those actions", () => {
		const p = preset({
			id: 3,
			genreId: "core:genre/lair",
			includedActions: ["core:lair-trap#trap"],
			effectiveIncludedActions: [action("core:lair-trap", "trap", "Trap")]
		})
		const groups = presetPipelineGroups(p, namespaces)
		expect(groups.actions.map((a) => [a.slug, a.actions])).toEqual([
			["core:lair-trap", ["Trap"]]
		])
		expect(groups.pipelines).toEqual([])
	})

	it("an empty effective set shows no actions, whatever else the row says", () => {
		const p = preset({
			id: 4,
			genreId: "core:genre/lair",
			includedActions: [],
			effectiveIncludedActions: []
		})
		expect(presetPipelineGroups(p, namespaces).actions).toEqual([])
	})

	it("an action whose pipeline an event also binds stays on that pipeline's row", () => {
		const p = preset({
			id: 5,
			genreId: "core:genre/chat",
			bindings: { "core:event/message-respond@1": { spec: "core:respond" } },
			effectiveIncludedActions: [action("core:respond", "retell", "Retell")]
		})
		const groups = presetPipelineGroups(p, namespaces)
		expect(groups.pipelines.map((x) => [x.slug, x.actions])).toEqual([
			["core:respond", ["Retell"]]
		])
		expect(groups.actions).toEqual([])
	})
})

describe("PipelinesSidebarNav", () => {
	it("starts at the genres", () => {
		expect(new PipelinesSidebarNav().location).toEqual({ level: "genres" })
	})

	it("drills Genre → Preset → Edit and backs out one level at a time", () => {
		const nav = new PipelinesSidebarNav()
		nav.openGenre("core:genre/chat")
		expect(nav.location).toEqual({ level: "presets", genreId: "core:genre/chat" })
		nav.openPreset(4)
		expect(nav.location).toEqual({
			level: "edit",
			genreId: "core:genre/chat",
			presetId: 4
		})
		nav.back()
		expect(nav.location).toEqual({ level: "presets", genreId: "core:genre/chat" })
		nav.back()
		expect(nav.location).toEqual({ level: "genres" })
		nav.back()
		expect(nav.location).toEqual({ level: "genres" })
	})

	it("opening a preset outside a genre is a no-op", () => {
		const nav = new PipelinesSidebarNav()
		nav.openPreset(4)
		expect(nav.location).toEqual({ level: "genres" })
	})

	it("reaches every pipeline through the library, and backs out to it", () => {
		const nav = new PipelinesSidebarNav()
		nav.openLibrary()
		expect(nav.location).toEqual({ level: "library" })
		nav.openPipeline("respond")
		expect(nav.location).toEqual({ level: "pipeline", slug: "respond" })
		nav.back()
		expect(nav.location).toEqual({ level: "library" })
		nav.back()
		expect(nav.location).toEqual({ level: "genres" })
	})

	it("repair steps back past a preset or genre that no longer exists", () => {
		const nav = new PipelinesSidebarNav()
		nav.openGenre("core:genre/chat")
		nav.openPreset(42)
		nav.repair({ genreIds: ["core:genre/chat"], presetIds: [1, 3, 4] })
		expect(nav.location).toEqual({ level: "presets", genreId: "core:genre/chat" })

		nav.openGenre("plug:genre/gone")
		nav.repair({ genreIds: ["core:genre/chat"], presetIds: [1, 3, 4] })
		expect(nav.location).toEqual({ level: "genres" })
	})

	it("repair leaves a location it cannot judge alone", () => {
		const nav = new PipelinesSidebarNav()
		nav.openGenre("core:genre/chat")
		nav.openPreset(4)
		// Presets not loaded yet: nothing to judge against.
		nav.repair({ genreIds: ["core:genre/chat"], presetIds: null })
		expect(nav.location).toEqual({
			level: "edit",
			genreId: "core:genre/chat",
			presetId: 4
		})
	})

	it("reports the genre a location sits under, for the desk list's selection", () => {
		const nav = new PipelinesSidebarNav()
		expect(nav.genreId).toBeNull()
		nav.openGenre("core:genre/lair")
		nav.openPreset(2)
		expect(nav.genreId).toBe("core:genre/lair")
		nav.back()
		nav.back()
		nav.openLibrary()
		expect(nav.genreId).toBeNull()
		expect(nav.inLibrary).toBe(true)
	})
})
