/**
 * 🚧 The inspector's Known by tab: its count, and who is offered it — the
 * owner, on a stored entry the store holds rows for; never a reader, never a
 * scene. ⚠ No DOM node is ever handed to `expect`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { success() {}, error() {}, info() {}, warning() {} }
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))
vi.mock("$lib/client/sockets/interest.svelte", async (original) => ({
	...(await original<Record<string, unknown>>()),
	getInterestContext: () => ({
		useInterest: () => {},
		declareInterest: () => () => {},
		requestWithInterest: () => {}
	})
}))
vi.mock("../sections/poolContext", () => ({
	getLorePoolCtx: () => ({
		scenesOf: () => [],
		bindingForTag: () => null,
		reading: { sessionId: null, sessionName: null }
	})
}))
const held = vi.hoisted(() => ({ store: undefined as unknown }))
vi.mock("./bookKnowledge.svelte", async (original) => ({
	...(await original<Record<string, unknown>>()),
	getBookKnowledge: () => held.store
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { bookDataContext, staticBookData } from "../bookData.svelte"
import { inspectorTabsFor } from "../editor/inspectorTabs"
import { SCENE_KIND } from "../poolFilter"
import { SECTION_DESCRIPTORS } from "../sections"
import EntryInspector from "../sections/EntryInspector.svelte"
import { BookKnowledge, type KnowledgeRow } from "./bookKnowledge.svelte"

const KNOWN_BY = { id: "known-by", label: "Known by" }

describe("inspectorTabsFor", () => {
	test("Known by carries its count once it is given", () => {
		const out = inspectorTabsFor([KNOWN_BY], {
			references: 0,
			contains: 0,
			knownBy: 3
		})
		expect(out).toEqual([{ id: "known-by", label: "Known by 3" }])
	})
	test("Known by stays plain while not loaded; the others are unchanged", () => {
		const out = inspectorTabsFor(
			[{ id: "references", label: "References" }, KNOWN_BY],
			{ references: 2, contains: 1 }
		)
		expect(out.map((t) => t.label)).toEqual([
			"References 2",
			"Contains 1",
			"Known by"
		])
	})
	test("every entries door declares the tab and the scenes door does not", () => {
		for (const door of SECTION_DESCRIPTORS)
			expect(door.inspector.some((t) => t.id === "known-by")).toBe(
				door.store === "entries"
			)
	})
})

function row(
	castMemberId: number,
	over: Partial<KnowledgeRow> = {}
): KnowledgeRow {
	return {
		castMemberId,
		name: `M${castMemberId}`,
		entryId: 5,
		known: true,
		winner: null,
		hand: null,
		overruled: null,
		placeEntry: false,
		...over
	}
}
const tie = (kind: any) => ({
	tieId: 1,
	kind,
	relationshipType: "x",
	hand: false,
	date: null
})

let app: ReturnType<typeof mount> | null = null
beforeEach(() => {
	setSocket({
		connected: true,
		id: "t",
		on() {},
		off() {},
		emit() {}
	} as never)
	setInterestUser({ id: 1, isAdmin: false })
	held.store = undefined
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

/** A store holding the rows of entry 5 (or `forEntry`), as the workspace's effect would. */
async function storeWith(
	rows: KnowledgeRow[],
	forEntry = 5,
	markedEntryIds: number[] = [5]
) {
	const store = new BookKnowledge({
		list: async (p: any) => ({
			lorebookId: p.lorebookId,
			entryId: p.entryId,
			branchId: null,
			moment: null,
			markedEntryIds,
			rows: p.entryId ? rows : []
		}),
		setCommonKnowledge: async () => {
			throw new Error("unused")
		},
		setTie: async () => {
			throw new Error("unused")
		}
	})
	store.open(3)
	store.showEntry(forEntry, { branchId: null, moment: null })
	await new Promise((r) => setTimeout(r, 0))
	return store
}

function show(over: { mayEdit?: boolean; scene?: boolean } = {}) {
	const door = SECTION_DESCRIPTORS.find((d) => d.id === "world")!
	const source = { id: 5, name: "Harbor", content: "", keys: [] }
	const item = door.toPoolItem(source as any)
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(EntryInspector, {
		target: host,
		props: {
			lorebookId: 3,
			item: over.scene ? { ...item, kind: SCENE_KIND } : item,
			source,
			door,
			pool: [],
			mayEdit: over.mayEdit ?? true,
			onOpenItem: () => {}
		},
		context: bookDataContext(
			staticBookData(() => ({ lorebookId: 3, timelineEnabled: true }))
		)
	})
	flushSync()
}
const tabs = () =>
	[...document.querySelectorAll("[data-lore-inspector-tab]")].map((t) => ({
		id: t.getAttribute("data-lore-inspector-tab"),
		text: (t.textContent ?? "").trim()
	}))

describe("the inspector's Known by tab", () => {
	test("the owner sees it, counting members who know by any tie", async () => {
		held.store = await storeWith([
			row(1),
			row(2, { winner: tie("was_told") }),
			row(3, { winner: tie(null) }),
			row(4, { known: false, winner: tie("kept_from") }),
			row(5, { known: false })
		])
		show()
		expect(tabs().find((t) => t.id === "known-by")?.text).toBe("Known by 2")
	})

	test("a common-knowledge entry shows the tab without a count", async () => {
		held.store = await storeWith([row(1)], 5, [])
		show()
		expect(tabs().find((t) => t.id === "known-by")?.text).toBe("Known by")
	})

	test("no tab while the marks read has not succeeded, whatever mayEdit says", async () => {
		const store = new BookKnowledge({
			list: async () => {
				throw new Error("Only the owner may read this.")
			},
			setCommonKnowledge: async () => {
				throw new Error("unused")
			},
			setTie: async () => {
				throw new Error("unused")
			}
		})
		store.open(3)
		store.showEntry(5, { branchId: null, moment: null })
		await new Promise((r) => setTimeout(r, 0))
		expect(store.loaded).toBe(false)
		held.store = store
		show({ mayEdit: true })
		expect(tabs().some((t) => t.id === "known-by")).toBe(false)
	})

	test("the tab does not depend on mayEdit once the marks read succeeded", async () => {
		held.store = await storeWith([row(1)])
		show({ mayEdit: false })
		expect(tabs().some((t) => t.id === "known-by")).toBe(true)
	})

	test("no tab for a scene row", async () => {
		held.store = await storeWith([row(1)])
		show({ scene: true })
		expect(tabs().some((t) => t.id === "known-by")).toBe(false)
	})

	test("no tab until the store holds this entry", async () => {
		held.store = await storeWith([row(1)], 99)
		show()
		expect(tabs().some((t) => t.id === "known-by")).toBe(false)
	})

	test("no tab with no store", () => {
		show()
		expect(tabs().some((t) => t.id === "known-by")).toBe(false)
	})
})
