/**
 * B1 · the event-map registry query (PLAN-turn-order §B1).
 *
 * What is pinned: the chat map draws the one cycle B1 names, read from rows
 * (`bootstrapPipelines` publishes the catalog), and the two core listeners
 * appear as listener nodes with the edges §4.6/§4.7 state. Roots are
 * computed — an event with no `causes` edge in — so `session-created` is a
 * root and `message-respond` is not: the auto-advance listener causes it.
 * That last reading is the one B3's C21 must not import (it announces its
 * own declared roots).
 */

import { describe, it, expect, beforeAll } from "vitest"
import { sessionEvents } from "@serene-pub/sdk"
import { CHAT_RESPOND_SPEC_ID, CHAT_TURN_ORDER_SPEC_ID as TURN_ORDER_SPEC_ID } from "@serene-pub/core-catalog"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { STANDARD_GENRE_ID } from "$lib/server/pipelines/entities/sessionGenres"
import {
	AUTO_ADVANCE_LISTENER_ID,
	TURN_ORDER_PUSH_LISTENER_ID,
	eventMap,
	type EventMap,
	type EventMapEdgeKind
} from "$lib/server/pipelines/entities/eventMap"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
}, 60_000)

const hasEdge = (
	map: EventMap,
	from: string,
	to: string,
	kind: EventMapEdgeKind
): boolean => map.edges.some((e) => e.from === from && e.to === to && e.kind === kind)

describe("the chat event map", () => {
	let map: EventMap
	beforeAll(async () => {
		map = await eventMap(db, { genreId: STANDARD_GENRE_ID })
	})

	it("draws the turn cycle B1 names", () => {
		expect(
			hasEdge(map, sessionEvents.messageCompleted, TURN_ORDER_SPEC_ID, "binds")
		).toBe(true)
		expect(
			hasEdge(map, TURN_ORDER_SPEC_ID, sessionEvents.turnOrderChanged, "causes")
		).toBe(true)
		expect(
			hasEdge(map, sessionEvents.turnOrderChanged, AUTO_ADVANCE_LISTENER_ID, "listens")
		).toBe(true)
		expect(
			hasEdge(map, AUTO_ADVANCE_LISTENER_ID, sessionEvents.messageRespond, "causes")
		).toBe(true)
		expect(
			hasEdge(map, sessionEvents.messageRespond, CHAT_RESPOND_SPEC_ID, "binds")
		).toBe(true)
		expect(
			hasEdge(map, CHAT_RESPOND_SPEC_ID, sessionEvents.messageCompleted, "causes")
		).toBe(true)
	})

	it("draws the two core listeners as listener nodes, wired to turn-order-changed", () => {
		const node = (id: string) => map.nodes.find((n) => n.id === id)
		expect(node(AUTO_ADVANCE_LISTENER_ID)?.kind).toBe("listener")
		expect(node(TURN_ORDER_PUSH_LISTENER_ID)?.kind).toBe("listener")
		expect(
			hasEdge(map, sessionEvents.turnOrderChanged, TURN_ORDER_PUSH_LISTENER_ID, "listens")
		).toBe(true)
	})

	it("marks every event a node, and session-created a root", () => {
		const created = map.nodes.find((n) => n.id === sessionEvents.sessionCreated)
		expect(created?.kind).toBe("event")
		expect(created?.root).toBe(true)
	})

	it("does not mark message-respond a root — the auto-advance listener causes it", () => {
		const respond = map.nodes.find((n) => n.id === sessionEvents.messageRespond)
		expect(respond?.kind).toBe("event")
		expect(respond?.root).toBe(false)
	})

	it("labels a spec and an event with display text", () => {
		expect(
			map.nodes.find((n) => n.id === TURN_ORDER_SPEC_ID)?.label
		).toBe("Turn order · Chat") // its name with its genre beside it (NOMENCLATURE §2)
		expect(
			map.nodes.find((n) => n.id === sessionEvents.messageCompleted)?.label
		).toBe("Message completed")
	})
})
describe("a preset's event map (B2 review)", () => {
	it("keeps, per event, only the spec the preset binds", async () => {
		const schema = await import("$lib/server/db/schema")
		const { eq } = await import("drizzle-orm")
		const all = await eventMap(db, { genreId: STANDARD_GENRE_ID })
		const completedSpecs = all.edges.filter(
			(e) => e.from === sessionEvents.messageCompleted && e.kind === "binds"
		)
		// A preset that binds message-completed to one spec of several
		// candidates is what narrowing is for; with one candidate, bind that.
		const target = completedSpecs[0].to
		const [preset] = await db
			.insert(schema.sessionPresets)
			.values({
				name: "Narrowing test",
				genreId: STANDARD_GENRE_ID,
				bindings: { [sessionEvents.messageCompleted]: { spec: target } }
			})
			.returning({ id: schema.sessionPresets.id })
		try {
			const narrowed = await eventMap(db, { presetId: preset.id })
			const bound = narrowed.edges.filter(
				(e) => e.from === sessionEvents.messageCompleted && e.kind === "binds"
			)
			expect(bound.map((e) => e.to)).toEqual([target])
			// An event the preset leaves unbound keeps every candidate.
			const respondAll = all.edges.filter(
				(e) => e.from === sessionEvents.sessionAction && e.kind === "binds"
			).length
			const respondNarrowed = narrowed.edges.filter(
				(e) => e.from === sessionEvents.sessionAction && e.kind === "binds"
			).length
			expect(respondNarrowed).toBe(respondAll)
		} finally {
			await db
				.delete(schema.sessionPresets)
				.where(eq(schema.sessionPresets.id, preset.id))
		}
	})
})
