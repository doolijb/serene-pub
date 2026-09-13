/**
 * The annotation lane's model seam: **model-free without a star, the starred
 * model with one.**
 *
 * The lane's whole claim used to be that it needs no model, and that claim is
 * now conditional rather than gone. What must not change is which way round the
 * conditional runs: the gazetteer and the capitalisation heuristic are the
 * zero-setup path, so *no star* has to mean the broker answers `none` and the
 * loop indexes exactly as it always did — never `unconfigured`, which is what
 * the loop reads as "stop, there is nothing to work with".
 *
 * The third case is the one that keeps that guarantee true in the bad weather: a
 * star whose model CANNOT load. Without the degrade below, a broken star would
 * stop annotation altogether, taking the lexical tier down with the model it has
 * nothing to do with.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

/** What `resolveNerTarget` answers next. */
let target: any = null
/** Which model ids `loadNerModel` was asked for, and which of them throw. */
let loads: string[] = []
let failLoad: string | null = null
let resident: string | null = null

vi.mock("$lib/server/db", () => ({ db: {} }))

vi.mock("./target", () => ({
	resolveNerTarget: async () => target
}))

vi.mock("./index", () => ({
	loadNerModel: async (id: string) => {
		loads.push(id)
		if (failLoad) throw new Error(failLoad)
		resident = id
	},
	unloadNerModel: () => {
		resident = null
	},
	setNerTtlMinutes: () => {},
	getLoadedNerModelId: () => resident,
	isNerModelReady: () => resident !== null,
	isNerModelLoading: () => false
}))

beforeEach(() => {
	target = null
	loads = []
	failLoad = null
	resident = null
	vi.resetModules()
})

const broker = async () => (await import("./broker")).nerBroker

describe("with no star", () => {
	it("peeks none, which is a normal state and not a stop", async () => {
		expect(await (await broker()).peek()).toEqual({ kind: "none" })
	})

	it("never asks for a model", async () => {
		const lease = await (await broker()).request({ wait: true })
		expect(lease).toEqual({ kind: "none", modelId: null })
		expect(loads).toEqual([])
	})
})

describe("with a star", () => {
	beforeEach(() => {
		target = {
			connectionId: 3,
			connectionName: "entities",
			type: "local-onnx-ner",
			mode: "local",
			modelId: "Xenova/bert-base-NER",
			ttlMinutes: 7,
			connection: {}
		}
	})

	it("peeks the identity the model would load under, without loading it", async () => {
		expect(await (await broker()).peek()).toEqual({
			kind: "configured",
			modelId: "Xenova/bert-base-NER"
		})
		expect(loads).toEqual([])
	})

	it("loads it when the loop waits, and reports it resident", async () => {
		const lease = await (await broker()).request({ wait: true })
		expect(loads).toEqual(["Xenova/bert-base-NER"])
		expect(lease).toEqual({
			kind: "resident",
			modelId: "Xenova/bert-base-NER"
		})
	})

	it("starts the load and answers pending when the caller cannot wait", async () => {
		// A promotion runs inside a turn and a first-ever load is a download.
		const lease = await (await broker()).request({ wait: false })
		expect(lease.kind).toBe("pending")
		expect(lease.modelId).toBeNull()
	})

	it("carries the connection's TTL into the declaration once it has read one", async () => {
		const b = await broker()
		await b.peek()
		expect(b.spec).toEqual({ role: "ner", ttlMinutes: 7 })
	})
})

describe("a star whose model cannot load", () => {
	it("degrades to model-free rather than stopping the lane", async () => {
		target = {
			modelId: "Xenova/broken",
			ttlMinutes: 5,
			mode: "local",
			connection: {}
		}
		failLoad = "onnxruntime-node is not available"
		const b = await broker()

		const lease = await b.request({ wait: true })
		expect(lease.kind).toBe("unavailable")

		// The next pass runs the lexical tiers instead of stopping: `none`, not
		// `unconfigured`.
		expect(await b.peek()).toEqual({ kind: "none" })
		// And it does not retry the same broken model on every tick.
		await b.request({ wait: true })
		expect(loads).toEqual(["Xenova/broken"])
	})

	it("tries again once the star names a different model", async () => {
		target = { modelId: "Xenova/broken", ttlMinutes: 5, mode: "local" }
		failLoad = "nope"
		const b = await broker()
		await b.request({ wait: true })
		expect(await b.peek()).toEqual({ kind: "none" })

		target = {
			modelId: "Xenova/bert-base-NER",
			ttlMinutes: 5,
			mode: "local"
		}
		failLoad = null
		expect(await b.peek()).toEqual({
			kind: "configured",
			modelId: "Xenova/bert-base-NER"
		})
	})
})
