/**
 * One copy of the open book's relationships (plan places-graph §10.1, B3).
 *
 * The store owns `narrativeGraph:list` and the three relationship pushes; the
 * graph lens and the References panel both derive from it, so a link drawn on
 * one surface shows on the other as soon as the server's push arrives.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({ getSocket: () => socket }))

import {
	_resetInterestForTests,
	declareInterest,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { refLinksFrom } from "./editor/refs"
import { MAIN_LINE } from "$lib/shared/lorebooks/lineReading"
import { edgesOnLine } from "./graphs/asOf"
import { BookRelationships } from "./relationships.svelte"

type Listener = (payload: unknown) => void
const listeners = new Map<string, Listener[]>()
const emitted: { event: string; params: any }[] = []
const socket = {
	connected: true,
	on(event: string, fn: Listener) {
		listeners.set(event, [...(listeners.get(event) ?? []), fn])
	},
	off(event: string, fn?: Listener) {
		// A bare off would take every view's listener with it.
		if (!fn) throw new Error(`bare socket.off("${event}")`)
		listeners.set(
			event,
			(listeners.get(event) ?? []).filter((f) => f !== fn)
		)
	},
	emit(event: string, params: unknown) {
		emitted.push({ event, params })
	}
}
const push = (event: string, payload: unknown) => {
	for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
}

const BOOK = 12

const rel = (id: number, over: Record<string, unknown> = {}) =>
	({
		id,
		lorebookId: BOOK,
		from: { kind: "entry", entryId: 40, name: "The Guardroom", typeId: "core:entry/location" },
		to: { kind: "entry", entryId: 41, name: "The Drowned Hall", typeId: "core:entry/location" },
		fromNodeId: null,
		toNodeId: null,
		fromEntryId: 40,
		toEntryId: 41,
		historyEntryId: null,
		sceneId: null,
		branchId: null,
		relationshipType: "leads to",
		reverseRelationshipType: null,
		name: "",
		description: "",
		visibility: "acknowledged",
		status: "active",
		reason: null,
		embedding: null,
		embeddingModel: null,
		createdAt: "",
		updatedAt: "",
		...over
	}) as Sockets.NarrativeGraph.NarrativeRelationship

/** A tie between two cast members: the one kind a Rebuild deletes. */
const tie = (id: number, over: Record<string, unknown> = {}) =>
	rel(id, {
		from: { kind: "cast", bindingId: 7 },
		to: { kind: "cast", bindingId: 8 },
		fromNodeId: 7,
		toNodeId: 8,
		fromEntryId: null,
		toEntryId: null,
		relationshipType: "ally",
		...over
	})

const list = (relationships: Sockets.NarrativeGraph.NarrativeRelationship[], lorebookId = BOOK) =>
	({
		lorebookId,
		nodes: [],
		relationships,
		relationshipCounts: {
			castToCast: relationships.filter(
				(r) => r.from.kind === "cast" && r.to.kind === "cast"
			).length
		},
		ungraphedSceneCount: 0,
		unresolvedCastSceneCount: 0,
		namelessBindingCount: 0,
		ungraphedUnsummarizedCount: 0,
		totalSummarizedCount: 0,
		ungraphedHistoryEntryCount: 0,
		totalDirectHistoryEntryCount: 0,
		branchCounts: []
	}) as Sockets.NarrativeGraph.List.Response

let store: BookRelationships
let close: () => void

beforeEach(() => {
	listeners.clear()
	emitted.length = 0
	_resetInterestForTests()
	setInterestUser({ id: 1, isAdmin: false })
	store = new BookRelationships(socket as any)
	close = store.open(BOOK)
	store.load()
	push("narrativeGraph:list", list([rel(1)]))
})

afterEach(() => close())

describe("BookRelationships — one read, every surface", () => {
	test("asks for the book it opened, and fills from that book's list only", () => {
		expect(emitted).toContainEqual({
			event: "narrativeGraph:list",
			params: { lorebookId: BOOK }
		})
		push("narrativeGraph:list", list([tie(2), tie(3)], 13))
		expect(store.all.map((r) => r.id)).toEqual([1])
		expect(store.loaded).toBe(true)
		expect(store.counts).toEqual({ castToCast: 0 })
	})

	test("a push updates both consumers: the References panel and the canvas", () => {
		const seen = { refs: [] as string[], canvas: [] as string[] }
		const stop = $effect.root(() => {
			// The References panel's feed and the graph lens's, as they derive.
			const refs = $derived(refLinksFrom(store.all, new Map()))
			const canvas = $derived(edgesOnLine(store.all, MAIN_LINE, []))
			$effect(() => {
				seen.refs = refs.map((r) => `${r.id}:${r.relationshipType}`)
			})
			$effect(() => {
				seen.canvas = canvas.map((r) => `${r.id}:${r.relationshipType}`)
			})
		})
		flushSync()
		expect(seen).toEqual({ refs: ["1:leads to"], canvas: ["1:leads to"] })

		push("narrativeGraph:createRelationship", { relationship: rel(2, { relationshipType: "is inside" }) })
		flushSync()
		expect(seen.refs).toEqual(["1:leads to", "2:is inside"])
		expect(seen.canvas).toEqual(["1:leads to", "2:is inside"])

		push("narrativeGraph:updateRelationship", { relationship: rel(1, { relationshipType: "leads north to" }) })
		flushSync()
		expect(seen.refs).toEqual(["1:leads north to", "2:is inside"])
		expect(seen.canvas).toEqual(["1:leads north to", "2:is inside"])

		push("narrativeGraph:deleteRelationship", { success: "ok", id: 2, lorebookId: BOOK })
		flushSync()
		expect(seen.refs).toEqual(["1:leads north to"])
		expect(seen.canvas).toEqual(["1:leads north to"])
		stop()
	})

	test("ignores another book's writes", () => {
		push("narrativeGraph:createRelationship", { relationship: rel(9, { lorebookId: 13 }) })
		push("narrativeGraph:updateRelationship", { relationship: rel(1, { lorebookId: 13, relationshipType: "x" }) })
		push("narrativeGraph:deleteRelationship", { success: "ok", id: 1, lorebookId: 13 })
		expect(store.all.map((r) => `${r.id}:${r.relationshipType}`)).toEqual(["1:leads to"])
	})

	test("keeps the Rebuild counts with the pushes: cast ties only (places plan L1)", () => {
		push("narrativeGraph:createRelationship", { relationship: tie(2) })
		expect(store.counts).toEqual({ castToCast: 1 })
		// A road is never a Rebuild's to delete.
		push("narrativeGraph:createRelationship", { relationship: rel(3) })
		expect(store.counts).toEqual({ castToCast: 1 })
		// An end moved onto a place takes the tie out of a Rebuild's reach…
		push("narrativeGraph:updateRelationship", { relationship: rel(2) })
		expect(store.counts).toEqual({ castToCast: 0 })
		// …and moved back puts it in again.
		push("narrativeGraph:updateRelationship", { relationship: tie(2) })
		expect(store.counts).toEqual({ castToCast: 1 })
		push("narrativeGraph:deleteRelationship", { success: "ok", id: 2, lorebookId: BOOK })
		expect(store.counts).toEqual({ castToCast: 0 })
		push("narrativeGraph:deleteRelationship", { success: "ok", id: 1, lorebookId: BOOK })
		expect(store.counts).toEqual({ castToCast: 0 })
	})

	test("tells a surface what arrived and what went, after its own rows moved", () => {
		const heard: string[] = []
		const stop = store.listen({
			created: (r) => heard.push(`+${r.id}:${store.get(r.id) ? "held" : "missing"}`),
			deleted: (r) => heard.push(`-${r.id}:${store.get(r.id) ? "held" : "gone"}`),
			listed: (msg) => heard.push(`list:${msg.relationships.length}`)
		})
		push("narrativeGraph:createRelationship", { relationship: rel(2) })
		push("narrativeGraph:deleteRelationship", { success: "ok", id: 2, lorebookId: BOOK })
		push("narrativeGraph:list", list([rel(1)]))
		stop()
		push("narrativeGraph:createRelationship", { relationship: rel(3) })
		expect(heard).toEqual(["+2:held", "-2:gone", "list:1"])
	})
})

describe("BookRelationships — handlers come off by reference", () => {
	test("closing the book stops the store hearing, and leaves every other view's listener in place", () => {
		const other: number[] = []
		const release = declareInterest<"narrativeGraph:createRelationship">(
			"narrativeGraph:createRelationship",
			(msg) => other.push(msg.relationship.id)
		)
		close()
		push("narrativeGraph:createRelationship", { relationship: rel(5) })
		expect(store.all.map((r) => r.id)).toEqual([1])
		expect(other).toEqual([5])
		release()
		for (const event of [
			"narrativeGraph:list",
			"narrativeGraph:list:error",
			"narrativeGraph:createRelationship",
			"narrativeGraph:updateRelationship",
			"narrativeGraph:deleteRelationship"
		])
			expect(listeners.get(event) ?? []).toEqual([])
	})

	test("opening another book forgets the first book's rows", () => {
		close()
		close = store.open(13)
		expect(store.all).toEqual([])
		expect(store.loaded).toBe(false)
		push("narrativeGraph:createRelationship", { relationship: rel(4) })
		expect(store.all).toEqual([])
	})

	/**
	 * Review round: an effect that re-runs on the same book (a node click, a
	 * cast member opened, a moment moved) must not empty the store — a store
	 * marked not loaded swaps the graph lens's canvas for its spinner and
	 * rebuilds it, layout, pan and zoom lost (#123).
	 */
	test("reopening the book it holds keeps its rows, stays loaded, and hears again", () => {
		close()
		close = store.open(BOOK)
		expect(store.all.map((r) => r.id)).toEqual([1])
		expect(store.loaded).toBe(true)
		push("narrativeGraph:createRelationship", { relationship: rel(2) })
		expect(store.all.map((r) => r.id)).toEqual([1, 2])
		expect(listeners.get("narrativeGraph:createRelationship")).toHaveLength(1)
	})

	test("the workspace's book-scoped effect opens it once across navigations in one book", () => {
		// `LorebooksWorkspace`'s shape: the route is replaced whole on every
		// navigation, and the effect is keyed on the book id derived from it.
		close()
		let opens = 0
		const route = $state({ current: { lorebookId: BOOK as number | null, entryId: null as number | null } })
		const stop = $effect.root(() => {
			const bookId = $derived(route.current.lorebookId)
			$effect(() => {
				const id = bookId
				if (id === null) return
				opens++
				return store.open(id)
			})
		})
		flushSync()
		route.current = { lorebookId: BOOK, entryId: 5 }
		flushSync()
		route.current = { lorebookId: BOOK, entryId: 6 }
		flushSync()
		expect(opens).toBe(1)
		expect(store.loaded).toBe(true)
		route.current = { lorebookId: 13, entryId: null }
		flushSync()
		expect(opens).toBe(2)
		expect(store.loaded).toBe(false)
		stop()
		close = () => {}
	})
})

describe("BookRelationships — writes carry the line (plan B0)", () => {
	test("an update sends the line being read, main as null", async () => {
		const saved = store.update({ id: 1, name: "the rusted iron door" }, 7)
		expect(emitted.at(-1)).toEqual({
			event: "narrativeGraph:updateRelationship",
			params: { relationship: { id: 1, name: "the rusted iron door" }, branchId: 7 }
		})
		push("narrativeGraph:updateRelationship", { relationship: rel(1, { name: "the rusted iron door" }) })
		await expect(saved).resolves.toMatchObject({ id: 1, name: "the rusted iron door" })
		expect(store.get(1)?.name).toBe("the rusted iron door")

		void store.update({ id: 1, status: "broken" }, null).catch(() => {})
		expect(emitted.at(-1)?.params.branchId).toBeNull()
	})

	test("a remove sends the line being read, main as null", () => {
		void store.remove(1, 4).catch(() => {})
		expect(emitted.at(-1)).toEqual({
			event: "narrativeGraph:deleteRelationship",
			params: { id: 1, branchId: 4 }
		})
		void store.remove(1, null).catch(() => {})
		expect(emitted.at(-1)).toEqual({
			event: "narrativeGraph:deleteRelationship",
			params: { id: 1, branchId: null }
		})
	})

	test("a remove waits for its own reply, and a refusal says why", async () => {
		const gone = store.remove(1, null)
		push("narrativeGraph:deleteRelationship", { id: 9, lorebookId: BOOK })
		push("narrativeGraph:deleteRelationship", { id: 1, lorebookId: BOOK })
		await expect(gone).resolves.toBeUndefined()

		const refused = store.remove(1, null)
		push("narrativeGraph:deleteRelationship:error", {
			error: "This relationship belongs to main. Open that line to change it."
		})
		await expect(refused).rejects.toThrow(
			"This relationship belongs to main. Open that line to change it."
		)
	})

	test("a refused update rejects with the server's sentence", async () => {
		const saved = store.update({ id: 1, relationshipType: "x" }, null)
		push("narrativeGraph:updateRelationship:error", {
			error: "This relationship belongs to main. Open that line to change it."
		})
		await expect(saved).rejects.toThrow(
			"This relationship belongs to main. Open that line to change it."
		)
	})
})

describe("BookRelationships — a read that fails says so", () => {
	test("a list error while a read is out is the store's error", () => {
		store.load()
		push("narrativeGraph:list:error", { error: "Access denied." })
		expect(store.error).toBe("Access denied.")
		store.load()
		expect(store.error).toBeNull()
	})

	test("a list error nobody here asked for is not", () => {
		push("narrativeGraph:list:error", { error: "Somebody else's." })
		expect(store.error).toBeNull()
	})
})
