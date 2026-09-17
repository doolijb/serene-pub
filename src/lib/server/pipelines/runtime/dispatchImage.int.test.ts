/**
 * Image dispatch: the adapters reached with a prompt built elsewhere.
 *
 * The adapter is a fake, because what is under test is not whether the backend draws
 * — it is the four properties that can only ever break silently:
 *
 *   1. **No connection material comes back.** A leak looks exactly like a working
 *      render, which is why this is checked rather than assumed.
 *   2. **Bytes stop here.** The graph carries references; a base64 string escaping
 *      into the result would be copied into the review payload and the receipt.
 *   3. **The image defaults are used, not the text ones.** A text connection
 *      reaching `getImageAdapter`, or a text sampling config reaching the
 *      resolver, produces a render at backend defaults and no error at all.
 *   4. **One render at a time per connection.** Progress and cancellation are
 *      global on most of these backends, so two concurrent renders on one server
 *      interleave into something neither caller can read.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { transformIdOf } from "$lib/shared/capabilities/sides"

const SECRET_KEY = "sk-do-not-leak-9f8e7d"
const SECRET_URL = "http://192.168.1.50:8888"

/**
 * The checkpoint, which lives on a MODEL row and not on the endpoint (0128).
 * `mergeEndpointModel` puts it back on `connection.model`, which is what the
 * request builder reads — so the identifier the adapter sends is the pair's.
 */
const CHECKPOINT = "juggernautXL.safetensors"

const imageConnection = {
	id: 1,
	type: "a1111",
	name: "Local A1111",
	modality: "image-gen",
	baseUrl: SECRET_URL,
	extraJson: { apiKey: SECRET_KEY }
}

const textConnection = {
	id: 2,
	type: "koboldcpp",
	name: "Local Kobold",
	modality: "text-gen",
	baseUrl: SECRET_URL,
	extraJson: {}
}

const imageSampling = {
	id: 10,
	name: "Default (Image)",
	shape: "core:shape/image-gen@1",
	values: { steps: 30, cfg: 6, width: 832, height: 1216 },
	enabled: ["steps", "cfg", "width", "height"]
}

/** What the fake adapter saw, so a test can assert on it afterwards. */
let seen: {
	req?: any
	constructedWith?: any
	/**
	 * Whether a progress callback was handed over at all.
	 *
	 * Recorded rather than inferred from the events, because the two answers
	 * differ in what they cost: an adapter given no callback runs no poll and
	 * decodes no preview, while one given a callback nobody listens to pays for
	 * both. `streaming: off` is asking for the first.
	 */
	progressCallback?: unknown
} = {}
/** Renders currently inside `generateImage`, to prove they do not overlap. */
let concurrent = 0
let maxConcurrent = 0
/** `batch` is a backend that returns more than one image for one request. */
let mode: "ok" | "abort" | "empty" | "slow" | "batch" = "ok"

class FakeAdapter {
	connection: any
	constructor(connection: any) {
		this.connection = connection
		seen.constructedWith = connection
	}
	// Named as the ACTION, not as "the thing an adapter does". A fake still
	// spelling this `generate` would keep passing here while the real dispatch
	// called a method nothing implements — the rename is only checkable end to
	// end if the fakes move with it.
	async generateImage(req: any, opts: any = {}) {
		seen.req = req
		seen.progressCallback = opts.onProgress
		preflightLog.push("render")
		concurrent++
		maxConcurrent = Math.max(maxConcurrent, concurrent)
		try {
			opts.onProgress?.({ stage: "sampling", percent: 50 })
			if (mode === "slow") await new Promise((r) => setTimeout(r, 25))
			if (mode === "abort")
				return {
					media: [],
					isAborted: true,
					applied: ["steps"],
					ignored: []
				}
			if (mode === "empty")
				return { media: [], isAborted: false, applied: [], ignored: [] }
			const one = {
				kind: "image",
				mime: "image/png",
				// A 1x1 PNG, so the media store has real bytes to sniff.
				base64: PNG_1x1,
				seed: 4242
			}
			return {
				media: mode === "batch" ? [one, { ...one, seed: 4243 }] : [one],
				isAborted: false,
				applied: ["steps", "cfg"],
				ignored: ["denoise"]
			}
		} finally {
			concurrent--
		}
	}
}

const PNG_1x1 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

vi.mock("$lib/server/utils/getImageAdapter", () => ({
	getImageAdapter: async () => ({ Adapter: FakeAdapter })
}))

/** File rows written by `createMedia`, so the test can read provenance back. */
let created: any[] = []
/** Set by a test that wants the stored file to carry a time dimension. */
let nextDurationMs: number | null = null
vi.mock("$lib/server/media", () => ({
	createMedia: async (_db: any, input: any) => {
		const file = {
			id: 100 + created.length,
			uuid: `uuid-${created.length}`,
			rev: 0,
			userId: input.userId,
			sessionId: input.sessionId ?? null,
			kind: "image",
			// The display projection deliberately DISAGREES with the original
			// variant below. That is a real state — a PNG whose lossless WebP
			// came out smaller re-points the display pointer — and it is the
			// only fixture in which "reads the projection" and "reads the
			// stored row" give different answers.
			displayMime: "image/webp",
			displayBytes: 111,
			width: 1,
			height: 1,
			durationMs: nextDurationMs,
			filename: input.filename,
			meta: input.meta
		}
		const original = {
			id: 900 + created.length,
			fileId: file.id,
			variant: "original",
			mime: "image/png",
			bytes: input.bytes.length,
			// The only place a path exists, and it is in this mock ON PURPOSE:
			// the leak assertion below can only mean something if there was a
			// path available to leak.
			path: "generated/x.png",
			hash: "deadbeef",
			isOriginal: true,
			cache: false,
			fidelity: "full"
		}
		created.push(file)
		return { file, original }
	},
	mediaUrl: (uuid: string, rev: number, variant?: string) =>
		`/media/${uuid}?${variant ? `v=${variant}&r=${rev}` : `r=${rev}`}`
}))

vi.mock("$lib/server/utils/tokenCrypto", () => ({
	decryptApiKeyField: (v: string) => `decrypted:${v}`
}))

/**
 * Every template render, with the context it was handed.
 *
 * A pass-through wrapper rather than a stub: what is under test is what the
 * render is TOLD, not what it returns, and a stub would also have to reproduce
 * Handlebars for the prompt assertions above to keep meaning anything.
 */
let renderCtx: any[] = []
vi.mock("$lib/server/pipelines/prompt/renderers", async (orig) => {
	const actual = (await orig()) as any
	return {
		...actual,
		renderTemplate: async (engineId: string, ctx: any) => {
			renderCtx.push({ engineId, ...ctx })
			return await actual.renderTemplate(engineId, ctx)
		}
	}
})

/**
 * The loader, stubbed at the one entry point the image path calls.
 *
 * `preflightLog` records the ORDER of preflight and render, which is the
 * property worth testing — a preflight outside the queue would still be called.
 *
 * ⚠ Stub the FUNCTION the caller actually reaches, and keep it pinned to that
 * module. Two versions of this mock have already gone stale in a way that made
 * a real bug invisible: first it replaced the whole adapter class with
 * `class { constructor(_p: any) {} }`, hiding that the production call went
 * through a generation-shaped constructor and threw before preflight ran; then
 * it stubbed `preflightManagedConnection` after that export had been deleted,
 * so the mock was inert and the spy never fired while the tests still passed
 * their own assertions. A mock naming something that no longer exists is worse
 * than no mock, because vitest will happily create it.
 */
let preflightLog: string[] = []
let preflightFails = false
vi.mock("$lib/server/koboldcpp/managedPreflight", () => ({
	ensureManagedReady: async () => {
		preflightLog.push("preflight:start")
		await new Promise((r) => setTimeout(r, 20))
		if (preflightFails) throw new Error("KoboldCPP Manager is disabled.")
		preflightLog.push("preflight:done")
		return { baseUrl: SECRET_URL }
	}
}))
// dispatchImage dynamically imports the managed image adapter for
// `sdQuantToInt`, and that module statically imports the app's db.
vi.mock("$lib/server/db", () => ({ db: { query: {} } }))

/**
 * The instance's defaults, keyed by capability. Set per test.
 *
 * The `text->text` entry is a DECOY and points at a connection that cannot draw:
 * the property it proves — that an image step never reaches for the text default
 * — survived both the move out of `system_settings` (0175) and the deletion of
 * those columns (0181), so it stays. It used to sit in a `systemSettings` object
 * beside this one; with one store there is nowhere else for it to live, which is
 * a better test than the two-table version was.
 */
let capabilityDefaults: Record<string, any> = {}
/** The KoboldCPP Manager's settings — where a MANAGED instance's address lives. */
let koboldCppSettings: any = { koboldCppManagerBaseUrl: SECRET_URL }
let connectionsById: Record<number, any> = {}
/** The `connection_models` rows, by id — the MODEL half of every pair (0128). */
let modelsById: Record<number, any> = {}
let samplingById: Record<number, any> = {}

/**
 * Give an endpoint a model row, and answer the PAIR that names both halves.
 *
 * Connections have no default model, so naming an endpoint alone resolves as
 * unconfigured — every selection below therefore spreads this rather than a
 * bare `connectionId`. The id is derived from the connection's so a second call
 * for the same endpoint rewrites one row instead of growing a second.
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

/**
 * The database, handed in rather than imported — the same shape `dispatch.ts`
 * takes, and for the same reason: a module that imports the app's connection
 * cannot be pointed at a test one.
 */
const fakeDb = {
	// A managed connection's own `baseUrl` column is not authoritative — the
	// Manager's settings are — so the image path reads them to find the process.
	query: {
		koboldCppSettings: {
			findFirst: async () => koboldCppSettings
		}
	},
	select: () => ({
		from: (table: any) => ({
			where: (_w: any) => ({
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
						return Object.values(samplingById).filter(
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
			})
			// No bare `.from(x).limit()` path any more. It existed to serve
			// `select().from(systemSettings).limit(1)`, and the resolver reads
			// no such row: every lookup it makes is by key, through `.where()`.
		})
	})
}

/**
 * Drizzle's `eq(col, value)` is opaque here, so the id is captured as the
 * predicate is built. Crude, and enough: this file only ever looks rows up by id.
 */
let lastWhereId: number | undefined
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
	seen = {}
	created = []
	nextDurationMs = null
	concurrent = 0
	maxConcurrent = 0
	mode = "ok"
	lastWhereId = undefined
	lastWherePair = [undefined, undefined]
	preflightLog = []
	preflightFails = false
	renderCtx = []
	koboldCppSettings = { koboldCppManagerBaseUrl: SECRET_URL }
	connectionsById = { 1: imageConnection, 2: textConnection }
	modelsById = {}
	samplingById = { 10: imageSampling }
	capabilityDefaults = {
		"text->image": {
			capability: "text->image",
			...withModel(1),
			samplingConfigId: 10
		}
	}
	// The decoy's own half, so a test that points something at the text
	// connection fails the capability guard rather than the model check.
	withModel(2, "kobold-text")
})

describe("dispatchImage — what comes back", () => {
	it("returns references, never bytes", async () => {
		const out = await dispatch()

		expect(out.media).toHaveLength(1)
		expect(out.media[0].uuid).toBe("uuid-0")
		expect(out.image?.uuid).toBe("uuid-0")

		// The property that matters: nothing anywhere in the result carries the
		// image itself. A base64 string escaping here would be copied into the
		// review payload and the receipt, megabytes at a time.
		const serialized = JSON.stringify(out)
		expect(serialized).not.toContain(PNG_1x1)
		expect(serialized).not.toContain("base64")
		// Nor the on-disk location. A MediaRef is built from the FILE row and a
		// path only exists on a variant, so this is structural now — asserted
		// because "structural" lasts exactly until someone spreads a row.
		expect(serialized).not.toContain("generated/x.png")
	})

	it("takes mime and bytes off the display projection, not the stored original", async () => {
		const out = await dispatch()

		// A MediaRef's `mime`/`bytes` describe what a bare `/media/{uuid}` will
		// actually answer with, which is the display variant — not the bytes
		// that were handed to `createMedia`. Reading the variant row here would
		// label WebP bytes as `image/png`, and adapters branch on `mime`.
		expect(out.media[0].mime).toBe("image/webp")
		expect(out.media[0].bytes).toBe(111)
	})

	it("reports a time dimension in seconds, and omits it when there is none", async () => {
		expect((await dispatch()).media[0].duration).toBeUndefined()

		nextDurationMs = 2500
		// Milliseconds in the column, seconds in a MediaRef. PRESENCE is the
		// signal that converting to a still format would lose something, so an
		// absent time dimension has to be absent rather than zero.
		expect((await dispatch()).media[0].duration).toBe(2.5)
	})

	it("leaks no connection material", async () => {
		// A leak looks exactly like a working render, which is why this is
		// asserted rather than assumed.
		const out = await dispatch()
		const serialized = JSON.stringify(out)
		expect(serialized).not.toContain(SECRET_KEY)
		expect(serialized).not.toContain(SECRET_URL)
		expect(serialized).not.toContain("decrypted:")
	})

	it("hands the adapter a decrypted key without persisting one", async () => {
		await dispatch()
		expect(seen.constructedWith.extraJson.apiKey).toBe(
			`decrypted:${SECRET_KEY}`
		)
		// The stored row is untouched — decryption happens into a copy.
		expect(imageConnection.extraJson.apiKey).toBe(SECRET_KEY)
	})

	it("stores provenance on every image it writes", async () => {
		await dispatch()
		expect(created).toHaveLength(1)
		expect(created[0].meta).toMatchObject({
			prompt: "a knight at dusk",
			seed: 4242,
			backend: "a1111",
			connectionName: "Local A1111",
			samplingConfig: "Default (Image)",
			applied: ["steps", "cfg"],
			ignored: ["denoise"]
		})
	})

	it("reports what the backend could not honour", async () => {
		const out = await dispatch()
		expect(out.applied).toEqual(["steps", "cfg"])
		expect(out.ignored).toEqual(["denoise"])
	})

	it("scopes stored media to the session when there is one", async () => {
		await dispatch({ sessionId: 42 })
		expect(created[0].sessionId).toBe(42)
	})
})

describe("dispatchImage — the request", () => {
	it("builds the request from the IMAGE sampling config", async () => {
		await dispatch()
		expect(seen.req).toMatchObject({
			prompt: "a knight at dusk",
			steps: 30,
			cfg: 6,
			width: 832,
			height: 1216
		})
	})

	it("sends only what the config has switched on", async () => {
		// `seed` is in the vocabulary and absent from `enabled`, so it must not
		// be sent — the backend keeps its own.
		await dispatch()
		expect("seed" in seen.req).toBe(false)
	})

	it("takes the checkpoint from the connection, not the config", async () => {
		// A checkpoint filename exists on one server; a sampling config is meant
		// to be pointed at any of them.
		await dispatch()
		expect(seen.req.model).toBe("juggernautXL.safetensors")
	})

	it("renders the prompts slot's templates over the incoming text", async () => {
		await dispatch({
			prompts: {
				positive: "{{prompt}}, cinematic lighting",
				negative: "blurry, {{negative}}"
			},
			negative: "watermark"
		})
		expect(seen.req.prompt).toBe("a knight at dusk, cinematic lighting")
		expect(seen.req.negativePrompt).toBe("blurry, watermark")
	})

	it("passes the text through when the node has no templates", async () => {
		// An unconfigured node must render the prompt, not an empty string —
		// which is the failure that looks like the backend misbehaving.
		await dispatch({ prompts: null })
		expect(seen.req.prompt).toBe("a knight at dusk")
	})

	it("treats a template that renders to nothing as absent", async () => {
		await dispatch({ prompts: { positive: "{{missingVariable}}" } })
		expect(seen.req.prompt).toBe("a knight at dusk")
	})

	it("refuses an empty prompt rather than rendering nothing", async () => {
		await expect(dispatch({ prompt: "   " })).rejects.toThrow(
			/nothing to render/
		)
	})
})

describe("dispatchImage — resolving the target", () => {
	it("falls back to the IMAGE defaults, never the text ones", async () => {
		await dispatch()
		// Connection 1 and sampling 10, not the text defaults 2 and 99. Getting
		// this wrong hands a text connection to getImageAdapter and a text
		// sampling config to the resolver, and neither says anything.
		expect(seen.constructedWith.id).toBe(1)
		expect(seen.req.steps).toBe(30)
	})

	it("refuses a connection that cannot draw, naming the capability and not the connection", async () => {
		// The human name of the CAPABILITY, never `text->image`: somebody who
		// switched "Image generation" off has no way to connect the id back to
		// the toggle they touched.
		// Caught rather than asserted through `rejects.toThrow`, because the
		// interesting half is what the message does NOT say and a matcher that
		// is handed the Error rather than the string passes whatever it is
		// given.
		const err: any = await dispatch(withModel(2, "kobold-text")).then(
			() => {
				throw new Error("expected a refusal")
			},
			(e) => e
		)
		expect(err.message).toMatch(/cannot do Image generation/)
		// And never the name of the CONNECTION. Connections are invisible to
		// non-admins, and this sentence becomes `Receipt.haltReason` — a plain
		// string nothing downstream can redact. The row it was about rides on
		// the thrown error's `connection` field, which the projection removes.
		expect(err.message).not.toContain("Local Kobold")
		expect(err.connection).toMatchObject({ name: "Local Kobold" })
	})

	it("accepts a text-typed connection whose capabilities say it draws", async () => {
		// The case the whole capability model exists for. KoboldCPP writes replies
		// and draws pictures from one process, so its TYPE says `text-gen` and the
		// old `isImage(type)` check refused it — for being what it is. What it can
		// do is the set on the row, not the label on the type.
		// Stated as the PROBE answer rather than as `resolved`: resolving a
		// pair rebuilds the cache from the endpoint's and the model's durable
		// layers (`mergeEndpointModel`), so a hand-written `resolved` is
		// recomputed away. The probe is where "we asked this instance and it
		// draws" actually lives.
		connectionsById[2] = {
			...textConnection,
			capabilities: { probe: { found: { "text->image": 1 } } }
		}
		await dispatch(withModel(2, "kobold-text"))
		expect(seen.constructedWith.id).toBe(2)
	})

	it("says what to do when nothing is registered", async () => {
		// The text default stays registered and stays pointed at a connection
		// that cannot draw, because reaching for one of those instead of
		// reporting the gap is the failure this asserts against.
		capabilityDefaults = {
			"text->text": {
				capability: "text->text",
				connectionId: 2,
				samplingConfigId: 99
			}
		}
		await expect(dispatch()).rejects.toThrow(
			/Nothing is set to handle .*Admin → Defaults/s
		)
	})

	it("reports a backend that finished with no image", async () => {
		mode = "empty"
		await expect(dispatch()).rejects.toThrow(/without returning an image/)
	})
})

describe("dispatchImage — progress and cancellation", () => {
	it("forwards progress to the caller's callback", async () => {
		const events: any[] = []
		await dispatch({ onProgress: (e: any) => events.push(e) })
		expect(events).toContainEqual({ stage: "sampling", percent: 50 })
	})

	/**
	 * The node's `streaming` parameter on a render.
	 *
	 * There is no token stream here, so what `off` turns off is the PROGRESS:
	 * the poll an adapter runs beside the render and the preview frames it
	 * decodes. Withheld rather than ignored — an adapter handed a callback it
	 * must not call still pays for both and throws the answers away.
	 */
	it("hands no progress callback over when the node says off", async () => {
		const events: any[] = []
		await dispatch({
			streaming: "off",
			onProgress: (e: any) => events.push(e)
		})
		expect(seen.progressCallback).toBeUndefined()
		expect(events).toEqual([])
	})

	it("hands it over at auto, which is what a render has always done", async () => {
		const events: any[] = []
		await dispatch({
			streaming: "auto",
			onProgress: (e: any) => events.push(e)
		})
		expect(typeof seen.progressCallback).toBe("function")
		expect(events).toContainEqual({ stage: "sampling", percent: 50 })
	})

	it("an aborted render returns isAborted and writes nothing", async () => {
		mode = "abort"
		const out = await dispatch()
		expect(out.isAborted).toBe(true)
		expect(out.media).toEqual([])
		// No half-finished row: a cancelled render leaves nothing behind.
		expect(created).toEqual([])
	})

	it("a signal aborted before the call never reaches the adapter", async () => {
		const controller = new AbortController()
		controller.abort()
		await expect(dispatch({ signal: controller.signal })).rejects.toThrow()
		expect(seen.req).toBeUndefined()
	})
})

describe("dispatchImage — one render at a time per connection", () => {
	it("serializes concurrent renders on the same connection", async () => {
		// Progress and cancellation are GLOBAL on most of these backends, so two
		// renders at once on one server interleave into progress neither caller
		// can interpret, and a cancel hits whichever happened to be running.
		mode = "slow"
		await Promise.all([dispatch(), dispatch(), dispatch()])
		expect(maxConcurrent).toBe(1)
		expect(created).toHaveLength(3)
	})

	it("a failed render does not block the next one", async () => {
		mode = "empty"
		await expect(dispatch()).rejects.toThrow()
		mode = "ok"
		const out = await dispatch()
		expect(out.media).toHaveLength(1)
	})

	it("serializes two CONNECTIONS that point at one server", async () => {
		// The queue guards the backend, not the row that named it — "global" is
		// a property of the process at the other end. A KoboldCPP reached as a
		// text connection and as an image connection is two rows and one
		// process, and it is the configuration this milestone targets. Keyed by
		// row id, these two would each get a slot and render at once on the same
		// server: interleaved progress, and a cancel landing on the wrong one.
		connectionsById[3] = {
			...imageConnection,
			id: 3,
			name: "Same box, second row",
			baseUrl: `${SECRET_URL}/` // trailing slash — same server
		}
		mode = "slow"
		await Promise.all([dispatch(withModel(1)), dispatch(withModel(3))])
		expect(maxConcurrent).toBe(1)
		expect(created).toHaveLength(2)
	})

	it("preflights a managed KoboldCPP before rendering, inside the queue", async () => {
		// Cold managed instance: the subprocess may not be running and the model
		// may not be loaded, and the image path had no equivalent of the text
		// path's preflight — so the render failed with a bare connection error
		// pointing at the image adapter, which is the wrong file to open.
		//
		// The ORDER is the assertion. A preflight outside the queue would still
		// be "called"; what matters is that it completes before the render and
		// that both sit in one critical section, so a text generation cannot
		// swap the model in the window between them.
		connectionsById[5] = {
			...imageConnection,
			id: 5,
			type: "koboldcpp_managed_image",
			name: "Managed Kobold",
			// Probed and found to draw — the milestone's actual setup. Without
			// this the guard refuses it first and the preflight never runs,
			// which is correct: an unprobed managed instance has not shown it
			// can render.
			capabilities: { resolved: { "text->image": 1 } }
		}
		await dispatch(withModel(5))
		expect(preflightLog).toEqual([
			"preflight:start",
			"preflight:done",
			"render"
		])
	})

	it("does not preflight a backend nobody asked this app to start", async () => {
		// An external KoboldCPP, an A1111, a Forge — starting those would be a
		// surprise, and the Manager does not own them.
		await dispatch(withModel(1))
		expect(preflightLog).toEqual(["render"])
	})

	it("a failed preflight is reported instead of a render that cannot work", async () => {
		connectionsById[5] = {
			...imageConnection,
			id: 5,
			type: "koboldcpp_managed_image",
			name: "Managed Kobold",
			// Probed and found to draw — the milestone's actual setup. Without
			// this the guard refuses it first and the preflight never runs,
			// which is correct: an unprobed managed instance has not shown it
			// can render.
			capabilities: { resolved: { "text->image": 1 } }
		}
		preflightFails = true
		await expect(dispatch(withModel(5))).rejects.toThrow(
			/Manager is disabled/
		)
		// And the render never ran — the queue slot is released, not consumed by
		// a request that was always going to fail at the socket.
		expect(preflightLog).not.toContain("render")
	})

	it("does not serialize connections on DIFFERENT servers", async () => {
		// The other half: one queue for everything would make a second backend
		// wait on the first for no reason.
		connectionsById[4] = {
			...imageConnection,
			id: 4,
			name: "A different box",
			baseUrl: "http://192.168.1.99:7860"
		}
		mode = "slow"
		await Promise.all([dispatch(withModel(1)), dispatch(withModel(4))])
		expect(maxConcurrent).toBe(2)
	})
})

/**
 * The same dispatch, reached the way a run reaches it.
 *
 * Here rather than beside the host's other tests because the property is only
 * visible at the far end: the run has to survive the scope, the call payload
 * and the adapter's own progress callback, and asserting it on the object the
 * host builds would pass just as happily with an id nothing carried through.
 */
describe("dispatchImage — reached through the host", () => {
	const node = {
		key: "render",
		definitionId: "core:oracle/generate-image",
		definitionVersion: 1,
		kind: "oracle"
	}

	const callHost = async (scope: any, payload: any = {}) => {
		const { createHost } = await import("./host")
		const host = createHost(fakeDb as any, scope)
		return await host.call!(
			{ prompt: "a knight at dusk", ...payload },
			node as any,
			{ dry: false }
		)
	}

	it("stamps the run its progress came from on the event the sink gets", async () => {
		const events: any[] = []
		await callHost({
			runId: "run-9f2",
			sessionId: 3,
			userId: 7,
			sink: { onProgress: (e: any) => events.push(e) }
		})

		// The value the SINK received, not the one the host assembled. This was
		// `runId: ""` until the scope carried a run, and a progress event a
		// client cannot name is one it cannot cancel and cannot clear — which
		// went unnoticed because the one socket listening today overwrites
		// `runId` with its own after spreading the event through.
		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({
			runId: "run-9f2",
			nodeKey: "render",
			stage: "sampling"
		})
	})

	it("carries the node's `streaming: off` through to the render", async () => {
		// The host is where the parameter and the sink meet: a run with a
		// listening sink AND a nameable run is exactly the case `off` has to
		// override, because everything else already withholds the callback for
		// reasons of its own.
		const events: any[] = []
		await callHost(
			{
				runId: "run-9f2",
				sessionId: 3,
				userId: 7,
				sink: { onProgress: (e: any) => events.push(e) }
			},
			{ streaming: "off" }
		)
		expect(seen.progressCallback).toBeUndefined()
		expect(events).toEqual([])
	})

	it("reads `off` off the node's own params slot", async () => {
		// The binding half of the same road. The host takes `p.streaming`, and
		// `p` is `resolveInput`'s output — so without this line the panel's
		// picker stores a value that reaches the render as `undefined`.
		const { coreBindings } = await import("./bindings")
		const { createHost } = await import("./host")
		const events: any[] = []
		const host = createHost(
			fakeDb as any,
			{
				runId: "run-9f2",
				sessionId: 3,
				userId: 7,
				sink: { onProgress: (e: any) => events.push(e) }
			} as any
		)
		const result = await coreBindings()["core:oracle/generate-image@1"]!(
			{
				prompt: "a knight at dusk",
				params: { streaming: "off" }
			} as any,
			{
				call: (payload: unknown) =>
					host.call!(payload, node as any, { dry: false }),
				signal: new AbortController().signal,
				progress: () => {},
				log: () => {}
			} as any
		)
		expect((result as any).kind).toBe("ok")
		expect(seen.progressCallback).toBeUndefined()
		expect(events).toEqual([])
	})

	it("sends no progress at all when the host cannot name the run", async () => {
		// The deliberate other half. `runSpec` always names the run, so this is
		// a host wired by hand — and for one of those, silence is better than an
		// event stamped with an id that identifies nothing, which would open a
		// progress card nobody can stop and nobody can dismiss.
		const events: any[] = []
		await callHost({
			sessionId: 3,
			userId: 7,
			sink: { onProgress: (e: any) => events.push(e) }
		})
		expect(events).toEqual([])
	})

	it("writes the rows it made into the run's artifact collector", async () => {
		/**
		 * ⚠ **The only place these ids exist.** The node publishes `MediaRef`s
		 * — uuid, mime, dimensions — because bytes and row ids both stop at
		 * this dispatcher by design, so a run's `files` and `variants` were
		 * recorded NOWHERE: `pipeline_runs.message_id` had no room for them and
		 * the receipt has no id to read. `createMedia`'s loop pushes them now.
		 */
		const artifacts: any[] = []
		await callHost({
			runId: "run-9f2",
			sessionId: 3,
			userId: 7,
			artifacts
		})

		expect(artifacts).toEqual([
			{
				kind: "file",
				entityId: 100,
				action: "created",
				nodeKey: "render"
			},
			{
				kind: "variant",
				entityId: 900,
				action: "created",
				nodeKey: "render"
			}
		])
	})

	it("records every image of a batch, not just the first", async () => {
		// The shape of the defect the relation exists to fix, on the image
		// path: one request, two images, and a single-valued column could only
		// ever have named one of them.
		mode = "batch"
		const artifacts: any[] = []
		await callHost({
			runId: "run-9f2",
			sessionId: 3,
			userId: 7,
			artifacts
		})

		expect(artifacts.map((a) => [a.kind, a.entityId])).toEqual([
			["file", 100],
			["variant", 900],
			["file", 101],
			["variant", 901]
		])
	})

	it("collects nothing when the host has no collector to write into", async () => {
		// The deliberate other half, same rule as the progress event above: a
		// host wired by hand has no run to attribute anything to, and this must
		// not throw trying to push into an array that is not there.
		const out: any = await callHost({ sessionId: 3, userId: 7 })
		expect(out.media).toHaveLength(1)
	})

	it("hands the prompts-slot render the run, so a plugin engine stays cancellable", async () => {
		// Inert today: the slot is pinned to core's engine, which ignores both
		// `RenderRun` fields. It stops being inert the moment a prompts slot
		// names a plugin's engine — that render is a sandboxed hook call, and
		// cancellation only reaches it through the id its hooks are grouped
		// under.
		await callHost(
			{ runId: "run-9f2", sessionId: 3, userId: 7 },
			{ prompts: { positive: "{{prompt}}, cinematic lighting" } }
		)

		expect(seen.req.prompt).toBe("a knight at dusk, cinematic lighting")
		expect(renderCtx).toHaveLength(1)
		expect(renderCtx[0]).toMatchObject({
			runId: "run-9f2",
			user: "7",
			template: "{{prompt}}, cinematic lighting"
		})
	})
})
