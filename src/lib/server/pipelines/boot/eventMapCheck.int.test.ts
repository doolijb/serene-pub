/**
 * B3 · the app half: the event map's laws over the booted catalog find
 * nothing — every event a core genre lists is caused or a declared root, and
 * the turn loop (respond → message-completed → turn order → auto-advance →
 * respond) has its termination policies.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { unterminatedCycles } from "@serene-pub/sdk"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { STANDARD_GENRE_ID } from "$lib/server/pipelines/entities/sessionGenres"
import { eventMap } from "$lib/server/pipelines/entities/eventMap"
import {
	eventMapFindings,
	terminationOf
} from "$lib/server/pipelines/boot/eventMapCheck"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
}, 60_000)

describe("the event map laws on the booted catalog", () => {
	it("find nothing", async () => {
		expect(await eventMapFindings(db)).toEqual([])
	})

	it("would report the chat turn loop if nothing in it declared a termination policy", async () => {
		const map = await eventMap(db, { genreId: STANDARD_GENRE_ID })
		expect(unterminatedCycles(map, () => undefined).length).toBeGreaterThan(0)
		expect(unterminatedCycles(map, (id) => terminationOf(map, id))).toEqual([])
	})
	it("a message-completed loop is capped by depth (R65); a turn-order loop with no auto-advance is not", () => {
		const completed = "core:event/message-completed@1"
		const echo = {
			nodes: [
				{ id: completed, kind: "event" as const, label: "", root: false },
				{ id: "user:spec/echo", kind: "spec" as const, label: "", root: false }
			],
			edges: [
				{ from: completed, to: "user:spec/echo", kind: "binds" as const },
				{ from: "user:spec/echo", to: completed, kind: "causes" as const }
			]
		}
		expect(unterminatedCycles(echo, (id) => terminationOf(echo, id))).toEqual([])
		const changed = "core:event/turn-order-changed@1"
		const spin = {
			nodes: [
				{ id: changed, kind: "event" as const, label: "", root: false },
				{ id: "user:spec/spin", kind: "spec" as const, label: "", root: false }
			],
			edges: [
				{ from: changed, to: "user:spec/spin", kind: "binds" as const },
				{ from: "user:spec/spin", to: changed, kind: "causes" as const }
			]
		}
		expect(unterminatedCycles(spin, (id) => terminationOf(spin, id))).toHaveLength(1)
	})
})
