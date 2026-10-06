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
/** The idle window the runtime was last armed with. */
let ttlSet: number | null = null

vi.mock("$lib/server/db", () => ({ db: {} }))

/**
 * NER modules a test serves by type, ahead of the real registry — which every
 * other type still goes through. Stands in for a registry entry without this
 * file importing the registry (`importBoundary.test.ts` enumerates who does).
 */
const fakes = vi.hoisted(() => new Map<string, unknown>())
vi.mock("$lib/server/utils/getNerAdapter", async (importOriginal) => {
	const real =
		await importOriginal<typeof import("$lib/server/utils/getNerAdapter")>()
	return {
		getNerAdapter: async (type: string) =>
			(fakes.get(type) as any) ?? (await real.getNerAdapter(type))
	}
})

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
	setNerTtlMinutes: (minutes: number) => {
		ttlSet = minutes
	},
	getLoadedNerModelId: () => resident,
	isNerModelReady: () => resident !== null,
	isNerModelLoading: () => false
}))

beforeEach(() => {
	target = null
	loads = []
	failLoad = null
	resident = null
	ttlSet = null
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
			modelId: "Xenova/bert-base-NER",
			ttlMinutes: 7,
			connection: { model: "Xenova/bert-base-NER" }
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
		// Armed with the connection's own window, through the adapter's
		// residency rather than a loader the broker names.
		expect(ttlSet).toBe(7)
	})

	it("does not load again a model that is already resident", async () => {
		resident = "Xenova/bert-base-NER"
		const lease = await (await broker()).request({ wait: true })
		expect(lease).toEqual({
			kind: "resident",
			modelId: "Xenova/bert-base-NER"
		})
		expect(loads).toEqual([])
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
			type: "local-onnx-ner",
			modelId: "Xenova/broken",
			ttlMinutes: 5,
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
		target = {
			type: "local-onnx-ner",
			modelId: "Xenova/broken",
			ttlMinutes: 5
		}
		failLoad = "nope"
		const b = await broker()
		await b.request({ wait: true })
		expect(await b.peek()).toEqual({ kind: "none" })

		target = {
			type: "local-onnx-ner",
			modelId: "Xenova/bert-base-NER",
			ttlMinutes: 5
		}
		failLoad = null
		expect(await b.peek()).toEqual({
			kind: "configured",
			modelId: "Xenova/bert-base-NER"
		})
	})
})

describe("a type no NER module serves", () => {
	it("degrades to model-free the way a model that cannot load does", async () => {
		target = {
			type: "not-a-ner-type",
			modelId: "some-model",
			ttlMinutes: 5,
			connection: {}
		}
		const b = await broker()
		const lease = await b.request({ wait: true })
		expect(lease.kind).toBe("unavailable")
		expect(lease.kind === "unavailable" && lease.reason).toMatch(
			/No NER adapter/
		)
		expect(await b.peek()).toEqual({ kind: "none" })
		expect(loads).toEqual([])
	})
})

/**
 * A NER type that does not run in this process — the shape LLM-prompted NER
 * will have. Served by type and nothing else (a module with no `residency`), to
 * show the broker and the lane need no change for it.
 */
describe("a backend with nothing to load", () => {
	const FAKE = "c0-test-hosted-ner"
	const calls: Array<{ text: string; model?: string }> = []

	const register = async () => {
		fakes.set(FAKE, {
			Adapter: class {
				constructor(public connection: any) {}
				async extractEntities(req: { text: string; model?: string }) {
					calls.push(req)
					return [
						{
							text: "Vell",
							label: "PER",
							start: 0,
							end: 4,
							score: 0.6
						}
					]
				}
			},
			listModels: async () => ({ models: [] }),
			testConnection: async () => ({ ok: true })
		})
		return () => fakes.delete(FAKE)
	}

	beforeEach(() => {
		calls.length = 0
		target = {
			connectionId: 9,
			connectionName: "hosted entities",
			type: FAKE,
			modelId: "hosted-ner-1",
			ttlMinutes: 5,
			connection: { id: 9, model: "hosted-ner-1" }
		}
	})

	it("is leased resident at once, without waiting and without a load", async () => {
		const b = await broker()
		const unregister = await register()
		try {
			// A promotion cannot wait, and does not have to: there is nothing
			// to warm.
			expect(await b.request({ wait: false })).toEqual({
				kind: "resident",
				modelId: "hosted-ner-1"
			})
			expect(loads).toEqual([])
		} finally {
			unregister()
		}
	})

	it("hands the lane that type's adapter, built on the leased connection", async () => {
		const b = await broker()
		const { leasedNerAdapter } = await import("./broker")
		const unregister = await register()
		try {
			await b.request({ wait: true })
			const adapter = await leasedNerAdapter("hosted-ner-1")
			expect(adapter).not.toBeNull()
			expect((adapter as any).connection).toEqual({
				id: 9,
				model: "hosted-ner-1"
			})
			const spans = await adapter!.extractEntities({
				text: "Vell spoke.",
				model: "hosted-ner-1"
			})
			expect(spans.map((s) => s.text)).toEqual(["Vell"])
			expect(calls).toEqual([
				{ text: "Vell spoke.", model: "hosted-ner-1" }
			])
		} finally {
			unregister()
		}
	})
})

describe("leasedNerAdapter", () => {
	beforeEach(() => {
		target = {
			connectionId: 3,
			connectionName: "entities",
			type: "local-onnx-ner",
			modelId: "Xenova/bert-base-NER",
			ttlMinutes: 5,
			connection: { model: "Xenova/bert-base-NER" }
		}
	})

	it("answers nothing before a lease has been taken", async () => {
		await broker()
		const { leasedNerAdapter } = await import("./broker")
		expect(await leasedNerAdapter("Xenova/bert-base-NER")).toBeNull()
	})

	it("answers the starred type's adapter while the leased model is resident", async () => {
		const b = await broker()
		const { leasedNerAdapter } = await import("./broker")
		await b.request({ wait: true })
		const { LocalOnnxNerAdapter } = await import(
			"$lib/server/nerAdapters/LocalOnnxNerAdapter"
		)
		expect(await leasedNerAdapter("Xenova/bert-base-NER")).toBeInstanceOf(
			LocalOnnxNerAdapter
		)
	})

	it("answers nothing for an identity the lease does not name", async () => {
		const b = await broker()
		const { leasedNerAdapter } = await import("./broker")
		await b.request({ wait: true })
		expect(await leasedNerAdapter("Xenova/another-model")).toBeNull()
	})

	it("answers nothing once the leased model has gone, rather than loading it", async () => {
		// The idle timer unloaded it between the lease and the row. Letting the
		// adapter load on demand here would put a download inside a pass.
		const b = await broker()
		const { leasedNerAdapter } = await import("./broker")
		await b.request({ wait: true })
		resident = null
		expect(await leasedNerAdapter("Xenova/bert-base-NER")).toBeNull()
		expect(loads).toEqual(["Xenova/bert-base-NER"])
	})
})
