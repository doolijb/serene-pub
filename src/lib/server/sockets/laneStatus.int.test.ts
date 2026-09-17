/**
 * What the two lanes report about their own residency, and what Unload does.
 *
 * ⚠ The load-bearing assertion is the one about the QUEUE: unloading frees a
 * model and stops nothing. A queue never owns model lifecycle, nothing may
 * assume a model is resident, and the next item loads on demand exactly as it
 * does after an idle timeout — so an unload that "helpfully" stopped the lane
 * would turn a memory control into an off switch.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.mock("$lib/server/db", async (orig) => {
	const actual = (await orig()) as any
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

/** The queue, observed rather than run — see the header. */
const queueCalls: string[] = []
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	startVectorizationQueue: async () => {
		queueCalls.push("start")
	},
	stopVectorization: () => {
		queueCalls.push("stop")
	},
	isVectorizationRunning: () => false,
	registerProgressEmitter: () => {},
	unregisterProgressEmitter: () => {},
	// A fixed number, so `pending` is asserted rather than described.
	countUnembedded: async () => 7,
	getPriorityQueue: () => [],
	getCompletedHistory: () => [],
	enqueueSessionGroup: async () => ({}),
	enqueueLorebookGroup: async () => ({}),
	enqueueCharacterGroup: async () => ({}),
	moveQueueGroup: () => {},
	removeQueueGroup: () => {},
	clearVectorizationFailureTracking: () => {},
	clearInlineEmbedCooldown: () => {}
}))

let testDb: TestDb

beforeAll(async () => {
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

beforeEach(async () => {
	queueCalls.length = 0
	await testDb.delete(schema.connectionDefaults)
})

const admin = () => ({ user: { id: 1, isAdmin: true } }) as any
const plebeian = () => ({ user: { id: 2, isAdmin: false } }) as any

function recorder() {
	const emitted: Array<{ event: string; data: any }> = []
	return {
		emitted,
		emit: (event: string, data: any) => {
			emitted.push({ event, data })
		}
	}
}

describe("vectorization:status", () => {
	it("answers the whole residency shape with nothing starred", async () => {
		const { vectorizationStatus } = await import("./vectorization")
		const { emitted, emit } = recorder()
		const res = await vectorizationStatus.handler(admin(), {}, emit)
		expect(res).toEqual({
			starred: false,
			modelId: null,
			loaded: false,
			loadError: null,
			lastUsedAt: null,
			// The default idle window, unchanged by anything here.
			ttlMinutes: 5,
			pending: 7
		})
		expect(emitted.map((e) => e.event)).toContain("vectorization:status")
	}, 60_000)

	it("is refused for a non-admin", async () => {
		const { vectorizationStatus } = await import("./vectorization")
		await expect(
			vectorizationStatus.handler(plebeian(), {}, () => {})
		).rejects.toThrow("Unauthorized")
	}, 60_000)
})

describe("vectorization:unloadModel", () => {
	it("answers the status shape and leaves the queue alone", async () => {
		const { vectorizationUnloadModel } = await import("./vectorization")
		const { emitted, emit } = recorder()
		const res = await vectorizationUnloadModel.handler(admin(), {}, emit)
		expect(res.loaded).toBe(false)
		expect(res.pending).toBe(7)
		expect(res).toHaveProperty("ttlMinutes")
		expect(emitted.map((e) => e.event)).toContain(
			"vectorization:unloadModel"
		)
		// ⚠ The point of the whole handler.
		expect(queueCalls).toEqual([])
	}, 60_000)

	it("is refused for a non-admin", async () => {
		const { vectorizationUnloadModel } = await import("./vectorization")
		await expect(
			vectorizationUnloadModel.handler(plebeian(), {}, () => {})
		).rejects.toThrow("Unauthorized")
	}, 60_000)
})

describe("ner:status", () => {
	it("carries residency beside the star-compared readiness", async () => {
		const { nerStatus } = await import("./ner")
		const { emitted, emit } = recorder()
		const res = await nerStatus.handler(admin(), {}, emit)
		expect(res).toEqual({
			starred: false,
			modelId: null,
			modelReady: false,
			loadError: null,
			annotatedRows: 0,
			loaded: false,
			lastUsedAt: null,
			ttlMinutes: 5
		})
		expect(emitted.map((e) => e.event)).toContain("ner:status")
	}, 60_000)
})

describe("ner:unloadModel", () => {
	it("answers the same shape ner:status does", async () => {
		const { nerStatus, nerUnloadModel } = await import("./ner")
		const status = await nerStatus.handler(admin(), {}, () => {})
		const { emitted, emit } = recorder()
		const unloaded = await nerUnloadModel.handler(admin(), {}, emit)
		expect(Object.keys(unloaded).sort()).toEqual(Object.keys(status).sort())
		expect(unloaded.loaded).toBe(false)
		expect(emitted.map((e) => e.event)).toContain("ner:unloadModel")
	}, 60_000)

	it("is refused for a non-admin", async () => {
		const { nerUnloadModel } = await import("./ner")
		await expect(
			nerUnloadModel.handler(plebeian(), {}, () => {})
		).rejects.toThrow("Unauthorized")
	}, 60_000)
})
