/**
 * Getting a managed KoboldCPP to hold the IMAGE model before the render starts.
 *
 * A connection names exactly one model. A `koboldcpp_managed` row names a text
 * GGUF; a `koboldcpp_managed_image` row names an image one. Which of them is
 * RESIDENT is neither row's business — the model manager decides that, and while
 * its answer is "one at a time" a render evicts the chat model on the way in.
 *
 * Everything here is a property that fails SILENTLY if it breaks:
 *
 *   1. **The request is built from named fields.** A row upgraded from the
 *      design where one connection carried two models can still be holding an
 *      `sdModelFile`; spread into the load request it would re-create exactly
 *      what this replaced, and the render would succeed with the wrong model.
 *   2. **The load is announced.** With one model resident, a picture costs a
 *      multi-gigabyte swap. A progress stream that jumps straight to "sampling"
 *      is indistinguishable from a hang.
 *   3. **The load is inside the queue.** Outside it, a chat message can swap the
 *      model in the window between the load and the render.
 *   4. **A managed TEXT row never loads an image model**, whatever else it says
 *      about itself.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { transformIdOf } from "$lib/shared/capabilities/sides"

const PNG_1x1 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

/** The Manager's real address — never the row's own column. */
const MANAGER_URL = "http://192.168.1.50:5001"

/** The order preflight and render actually happened in. */
let log: string[] = []
/** The request `ensureManagedReady` was handed. */
let request: any = null
let preflightFails = false
let onDisk: string[] = ["sdxl-turbo-q8.gguf"]

class FakeAdapter {
	connection: any
	constructor(connection: any) {
		this.connection = connection
	}
	async generateImage() {
		log.push("render")
		return {
			media: [{ kind: "image", mime: "image/png", base64: PNG_1x1 }],
			isAborted: false,
			applied: [],
			ignored: []
		}
	}
}

vi.mock("$lib/server/utils/getImageAdapter", () => ({
	getImageAdapter: async () => ({ Adapter: FakeAdapter })
}))

vi.mock("$lib/server/media", () => ({
	// `{ file, original }` since 0182 — mime and bytes come off the file's
	// display projection, so a mock that only sets them on the variant would
	// pass while the ref it produced carried `undefined`.
	createMedia: async (_db: any, input: any) => ({
		file: {
			id: 1,
			uuid: "uuid-1",
			rev: 0,
			kind: "image",
			displayMime: "image/png",
			displayBytes: input.bytes.length,
			width: 1,
			height: 1,
			durationMs: null,
			filename: input.filename
		},
		original: {
			id: 9,
			fileId: 1,
			variant: "original",
			mime: "image/png",
			bytes: input.bytes.length,
			path: "generated/x.png",
			hash: "deadbeef",
			isOriginal: true,
			cache: false,
			fidelity: "full"
		}
	}),
	mediaUrl: (uuid: string, rev: number, variant?: string) =>
		`/media/${uuid}?${variant ? `v=${variant}&r=${rev}` : `r=${rev}`}`
}))

vi.mock("$lib/server/utils/tokenCrypto", () => ({
	decryptApiKeyField: (v: string) => v
}))

/**
 * The loader, stubbed at the seam this milestone introduced.
 *
 * `ensureManagedReady` is the ONE entry point for "make the Manager hold this" —
 * the same function the text path calls with a text spec. Stubbing it here
 * records what was ASKED FOR without deciding anything about residency, which is
 * the split the whole design rests on: a connection says which model it needs,
 * and what is resident is settled behind this call.
 *
 * It takes a SPEC with no filesystem path — resolving a bare filename across the
 * two model directories is its job, not the caller's — so the stub also stands in
 * for that resolution, and a spec carrying a `path` would be a caller doing work
 * it has no business doing.
 */
vi.mock("$lib/server/koboldcpp/managedPreflight", () => ({
	ensureManagedReady: async (spec: any) => {
		log.push("preflight:start")
		request = spec
		if (!onDisk.includes(spec.file))
			throw new Error(`Model file not found: ${spec.file}`)
		await new Promise((r) => setTimeout(r, 20))
		if (preflightFails) throw new Error("KoboldCPP Manager is disabled.")
		log.push("preflight:done")
		return { baseUrl: MANAGER_URL }
	}
}))

/**
 * A stand-in for the app's database connection, so the REAL
 * KoboldCppManagedImageAdapter can be imported for its `sdQuantToInt` without
 * dragging PGlite in. dispatchImage takes its own db as a parameter; this one is
 * only reached by modules it imports.
 */
vi.mock("$lib/server/db", () => ({ db: { query: {} } }))

/**
 * The checkpoint, on a MODEL row rather than on the endpoint (0128).
 * `mergeEndpointModel` writes it back onto `connection.model`, which is the
 * field the loader spec's `file` is built from.
 */
const CHECKPOINT = "sdxl-turbo-q8.gguf"

const imageConnection = {
	id: 5,
	type: "koboldcpp_managed_image",
	name: "SDXL Turbo",
	modality: "image-gen",
	// Stale on purpose: the port was changed in the Manager after this row was
	// created, which is the case resolveBaseUrl exists for.
	baseUrl: "http://localhost:5001",
	extraJson: {}
	// No `capabilities`: this type declares `text->image` natively and by
	// default, so the guard passes on the manifest alone. A hand-written
	// `resolved` would be recomputed away by the merge in any case.
}

const imageSampling = {
	id: 10,
	name: "Default (Image)",
	shape: "core:shape/image-gen@1",
	values: { steps: 30, cfg: 6 },
	enabled: ["steps", "cfg"]
}

let connectionsById: Record<number, any> = {}
/** The `connection_models` rows, by id — the MODEL half of every pair (0128). */
let modelsById: Record<number, any> = {}
let capabilityDefaults: Record<string, any> = {}
let koboldCppSettings: any = {}

/**
 * Give an endpoint a model row, and answer the PAIR that names both halves.
 *
 * Connections have no default model, so a selection naming only the endpoint
 * resolves as unconfigured — every dispatch below therefore spreads this.
 */
function withModel(connectionId: number, model: string = CHECKPOINT) {
	const id = 900 + connectionId
	modelsById[id] = {
		id,
		connectionId,
		model,
		name: model,
		enabled: true,
		missingSince: null
	}
	return { connectionId, connectionModelId: id }
}

let lastWhereId: any
/** The last two, as a sliding window — see the `connection_defaults` branch. */
let lastWherePair: [unknown, unknown] = [undefined, undefined]
vi.mock("drizzle-orm", async (orig) => {
	const actual = (await orig()) as any
	return {
		...actual,
		eq: (col: any, value: any) => {
			lastWhereId = value
			lastWherePair = [lastWherePair[1], value]
			return actual.eq(col, value)
		}
	}
})

const tableName = (t: any): string =>
	t?.[Symbol.for("drizzle:Name")] ?? t?._?.name ?? ""

const fakeDb = {
	query: {
		koboldCppSettings: { findFirst: async () => koboldCppSettings }
	},
	select: () => ({
		from: (table: any) => ({
			where: () => ({
				limit: async () => {
					const name = tableName(table)
					if (name === "connections")
						return Object.values(connectionsById).filter(
							(c) => c.id === lastWhereId
						)
					if (name === "connection_models")
						return Object.values(modelsById).filter(
							(m) => m.id === lastWhereId
						)
					if (name === "sampling_configs")
						return [imageSampling].filter(
							(s) => s.id === lastWhereId
						)
					// Keyed by the transform's two SIDES since 0183, so this
					// lookup builds TWO equalities where every other read here
					// builds one. The fixture map is still keyed by the id.
					if (name === "connection_defaults") {
						const [input, output] = lastWherePair as [
							string,
							string
						]
						const row =
							capabilityDefaults[transformIdOf({ input, output })]
						return row ? [row] : []
					}
					return []
				}
			}),
			limit: async () => []
		})
	})
}

async function dispatch(call: any = {}) {
	const { dispatchImage } = await import("./dispatchImage")
	return dispatchImage(fakeDb as any, {
		prompt: "a knight at dusk",
		userId: 7,
		...call
	})
}

beforeEach(() => {
	vi.resetModules()
	log = []
	request = null
	preflightFails = false
	lastWhereId = undefined
	lastWherePair = [undefined, undefined]
	onDisk = ["sdxl-turbo-q8.gguf"]
	koboldCppSettings = {
		koboldCppManagerBaseUrl: MANAGER_URL,
		koboldCppManagerModelsDir: "/models/llm",
		koboldCppImageModelsDir: "/models/image"
	}
	connectionsById = { 5: imageConnection }
	modelsById = {}
	capabilityDefaults = {
		"text->image": {
			capability: "text->image",
			...withModel(5),
			samplingConfigId: 10
		}
	}
})

describe("loading a managed KoboldCPP's image model before the render", () => {
	it("asks for an IMAGE model, named by the connection", async () => {
		// The spec is a discriminated union on `kind`, so "load this text model"
		// and "load this image model" cannot be confused for one another and
		// neither can carry the other's knobs.
		await dispatch(withModel(5))
		expect(request).toMatchObject({
			kind: "image",
			file: "sdxl-turbo-q8.gguf"
		})
	})

	it("names the file and leaves the directory to the loader", async () => {
		// A bare filename lives in one of two directories, with a fallback for an
		// install that predates the second — one question, answered once, in
		// managedPreflight. A caller that resolved its own path would be a second
		// answer, and the two would drift the first time the fallback mattered.
		await dispatch(withModel(5))
		expect(request).not.toHaveProperty("path")
	})

	it("never carries a text model, however the row got one", async () => {
		// The Ruling-1 violation, as a regression test. An upgraded row can still
		// have `managedConfig.sdModelFile` (and a text `modelFile`) sitting in
		// extraJson from the design where one connection held two models; a
		// request built by spreading extraJson would hand them straight back to
		// the loader.
		connectionsById[5] = {
			...imageConnection,
			extraJson: {
				managedConfig: {
					modelFile: "MN-12B-Lyra-v4.gguf",
					sdModelFile: "some-other-model.gguf",
					gpuLayers: 33
				}
			}
		}
		await dispatch(withModel(5))
		expect(request.file).toBe("sdxl-turbo-q8.gguf")
		expect(request).not.toHaveProperty("sdModelFile")
		expect(request).not.toHaveProperty("modelFile")
		expect(request).not.toHaveProperty("gpuLayers")
	})

	it("carries the load knobs from the profile, as the numbers KoboldCPP wants", async () => {
		// SchemaForm stores every control back as a STRING — its number input
		// hands over `e.currentTarget.value` uncoerced — and "7" written into the
		// .kcpps reaches koboldcpp's ctypes int, which fails inside the loader
		// rather than where it was set.
		connectionsById[5] = {
			...imageConnection,
			extraJson: { profile: { sdThreads: "7", sdQuant: "q8" } }
		}
		await dispatch(withModel(5))
		expect(request.threads).toBe(7)
		expect(request.quant).toBe(1)
	})

	it("leaves a knob it cannot read off the request entirely", async () => {
		// Absent means "koboldcpp decides", which is a safe answer. A guessed one
		// is a number nobody chose, applied silently.
		connectionsById[5] = {
			...imageConnection,
			extraJson: { profile: { sdThreads: "", sdQuant: "q6" } }
		}
		await dispatch(withModel(5))
		expect(request).not.toHaveProperty("threads")
		expect(request).not.toHaveProperty("quant")
	})

	it("announces the load before it starts, not after", async () => {
		// A model swap is minutes on a large file. The `loading` stage exists to
		// say so; emitted after the load it would only ever be seen by someone
		// already convinced the app had hung.
		const stages: string[] = []
		await dispatch({
			...withModel(5),
			onProgress: (p: any) => stages.push(p.stage)
		})
		expect(stages[0]).toBe("loading")
	})

	it("says which model to an administrator and nothing to anybody else", async () => {
		// The model is a PATH on the administrator's disk, and this event fans
		// out to everyone watching the session — so it cannot be in the
		// sentence, where no projection could reach it. It travels as a field
		// under `connection` instead, and the redaction that already runs at
		// every egress decides who is told.
		const events: any[] = []
		await dispatch({
			...withModel(5),
			onProgress: (p: any) => p.message && events.push(p)
		})

		// Still explicable: a person who cannot be told WHICH model is at least
		// told that a model is loading, which is the whole point of the stage.
		expect(events[0].message).toMatch(/loading the image model/i)
		expect(events[0].message).not.toContain("sdxl-turbo-q8.gguf")
		expect(events[0].connection.model).toBe("sdxl-turbo-q8.gguf")

		const { redactConnections } = await import(
			"$lib/server/connections/visibility"
		)
		expect(
			JSON.stringify(redactConnections(events[0], { isAdmin: false }))
		).not.toContain("sdxl-turbo-q8.gguf")
		expect(
			redactConnections(events[0], { isAdmin: true }).connection.model
		).toBe("sdxl-turbo-q8.gguf")
	})

	it("loads inside the render queue, so nothing can swap the model in between", async () => {
		// The ORDER is the assertion. A load outside the queue would still be
		// "called"; what matters is that it completes before the render and that
		// both sit in one critical section.
		await dispatch(withModel(5))
		expect(log).toEqual(["preflight:start", "preflight:done", "render"])
	})

	it("sends the render at the MANAGER's address, not the row's stale one", async () => {
		// The row's baseUrl is a display value. A port changed after the
		// connection was created lives only in koboldcpp_settings, and the queue
		// key is derived from this too — a stale value would split one process
		// into two queues and let two renders overlap on it.
		let sawBaseUrl: string | undefined
		const spy = {
			Adapter: class extends FakeAdapter {
				constructor(connection: any) {
					super(connection)
					sawBaseUrl = connection.baseUrl
				}
			}
		}
		const mod = await import("$lib/server/utils/getImageAdapter")
		vi.spyOn(mod, "getImageAdapter").mockResolvedValue(spy as any)
		await dispatch(withModel(5))
		expect(sawBaseUrl).toBe(MANAGER_URL)
	})

	it("lets a missing model file surface as a refusal, not as a render", async () => {
		// The row can outlive the file — a manual delete, a half-finished
		// download. `managedPreflight` stats it and names it, and the point here
		// is that the sentence reaches the caller intact instead of being
		// swallowed into a render that draws with whatever happens to be loaded.
		onDisk = []
		await expect(dispatch(withModel(5))).rejects.toThrow(
			/sdxl-turbo-q8\.gguf/
		)
		expect(log).not.toContain("render")
	})

	it("refuses when the pair names no model at all", async () => {
		// Reachable, capable, and pointing at nothing. The empty request would
		// otherwise mean "load an empty config", which koboldcpp accepts.
		//
		// Since 0128 the refusal arrives one layer earlier: a registration
		// naming only the endpoint is incomplete, so resolution never merges a
		// model and the loader is never asked for one. What matters either way
		// is that nothing reaches the Manager.
		capabilityDefaults = {
			"text->image": {
				capability: "text->image",
				connectionId: 5,
				samplingConfigId: 10
			}
		}
		// The endpoint alone, at BOTH tiers — a pipeline option naming a pair
		// would simply win and resolve.
		await expect(dispatch({ connectionId: 5 })).rejects.toThrow(
			/No model is chosen for Image generation/i
		)
		expect(log).toEqual([])
	})

	it("reports a failed load instead of a render that cannot work", async () => {
		preflightFails = true
		await expect(dispatch(withModel(5))).rejects.toThrow(
			/Manager is disabled/
		)
		expect(log).not.toContain("render")
	})

	it("does not load anything for a backend nobody asked this app to start", async () => {
		// An external KoboldCPP started with --sdmodel is a genuine
		// one-process-does-both case whose models this app does not manage.
		// Its `text->image` is stated as the PROBE answer, because that is where
		// "we asked this instance and it draws" lives: resolving a pair rebuilds
		// the cache from the durable layers, so a hand-written `resolved` would
		// be recomputed away.
		connectionsById[6] = {
			...imageConnection,
			id: 6,
			type: "koboldcpp",
			name: "Someone else's Kobold",
			capabilities: { probe: { found: { "text->image": 1 } } }
		}
		Object.assign(capabilityDefaults["text->image"], withModel(6))
		await dispatch(withModel(6))
		expect(log).toEqual(["render"])
	})

	it("refuses a managed TEXT connection whose resolved cache went stale", async () => {
		// The reported bug, and the row that used to get past everything. Such a
		// row names a text GGUF, so an image load built from `connection.model`
		// would hand the image loader an LLM.
		//
		// This test used to force the row PAST the guard and assert the deeper
		// defence — that nothing downstream said "load an image model" — because
		// a stale `resolved` cache genuinely could do that: the manifest stopped
		// GRANTING `text->image` for this type, and the guard read the cache, so
		// a set written before the declaration changed sailed through.
		//
		// `storedCapabilities` now intersects that cache with what the type still
		// declares, so the stale half is inert at the point it is read and the
		// refusal happens at the guard — with a sentence naming the capability,
		// rather than as a mystery three layers down. The deeper defence is no
		// longer reachable for this type at all, which is the improvement; the
		// external-KoboldCPP case above still exercises the render path for a row
		// whose `text->image` is real.
		connectionsById[7] = {
			...imageConnection,
			id: 7,
			type: "koboldcpp_managed",
			name: "Managed Kobold (text)",
			capabilities: { resolved: { "text->image": 1 } }
		}
		const textPair = withModel(7, "MN-12B-Lyra-v4.gguf")
		Object.assign(capabilityDefaults["text->image"], textPair)
		await expect(dispatch(textPair)).rejects.toThrow(
			/cannot do Image generation/i
		)
		expect(request).toBeNull()
		expect(log).toEqual([])
	})
})
