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

const SECRET_KEY = "sk-do-not-leak-9f8e7d"
const SECRET_URL = "http://192.168.1.50:8888"

const imageConnection = {
	id: 1,
	type: "a1111",
	name: "Local A1111",
	modality: "image-gen",
	baseUrl: SECRET_URL,
	model: "juggernautXL.safetensors",
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
let seen: { req?: any; constructedWith?: any } = {}
/** Renders currently inside `generate`, to prove they do not overlap. */
let concurrent = 0
let maxConcurrent = 0
let mode: "ok" | "abort" | "empty" | "slow" = "ok"

class FakeAdapter {
	connection: any
	constructor(connection: any) {
		this.connection = connection
		seen.constructedWith = connection
	}
	async generate(req: any, opts: any = {}) {
		seen.req = req
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
			return {
				media: [
					{
						kind: "image",
						mime: "image/png",
						// A 1x1 PNG, so the media store has real bytes to sniff.
						base64: PNG_1x1,
						seed: 4242
					}
				],
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

/** Rows written by `createMedia`, so the test can read provenance back. */
let created: any[] = []
vi.mock("$lib/server/media", () => ({
	createMedia: async (_db: any, input: any) => {
		const row = {
			id: 100 + created.length,
			uuid: `uuid-${created.length}`,
			userId: input.userId,
			sessionId: input.sessionId ?? null,
			mime: "image/png",
			kind: "image",
			bytes: input.bytes.length,
			width: 1,
			height: 1,
			filename: input.filename,
			meta: input.meta,
			path: "generated/x.png"
		}
		created.push(row)
		return row
	}
}))

vi.mock("$lib/server/utils/tokenCrypto", () => ({
	decryptApiKeyField: (v: string) => `decrypted:${v}`
}))

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
 * What `resolveTarget` finds. Set per test.
 *
 * The text defaults are deliberately still here and deliberately point somewhere
 * else: the property they prove — that an image step never reaches for the text
 * default — did not change when the image half moved out of this table, so the
 * decoys stay.
 */
let systemSettings: any = {
	defaultConnectionId: 2,
	defaultSamplingConfigId: 99
}
/**
 * The instance's image default, which is now a `connection_defaults` row keyed
 * by capability rather than a pair of `system_settings` columns (0175).
 */
let capabilityDefaults: Record<string, any> = {}
/** The KoboldCPP Manager's settings — where a MANAGED instance's address lives. */
let koboldCppSettings: any = { koboldCppManagerBaseUrl: SECRET_URL }
let connectionsById: Record<number, any> = {}
let samplingById: Record<number, any> = {}

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
					if (name === "sampling_configs")
						return Object.values(samplingById).filter(
							(s) => s.id === lastWhereId
						)
					// Keyed by capability, so `lastWhereId` is a string here.
					if (name === "connection_defaults") {
						const row = capabilityDefaults[lastWhereId as any]
						return row ? [row] : []
					}
					return []
				}
			}),
			limit: async () => {
				const name = tableName(table)
				return name === "system_settings" ? [systemSettings] : []
			}
		})
	})
}

/**
 * Drizzle's `eq(col, value)` is opaque here, so the id is captured as the
 * predicate is built. Crude, and enough: this file only ever looks rows up by id.
 */
let lastWhereId: number | undefined
vi.mock("drizzle-orm", async (orig) => {
	const actual = (await orig()) as any
	return {
		...actual,
		eq: (col: any, value: any) => {
			lastWhereId = value
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
	concurrent = 0
	maxConcurrent = 0
	mode = "ok"
	lastWhereId = undefined
	preflightLog = []
	preflightFails = false
	koboldCppSettings = { koboldCppManagerBaseUrl: SECRET_URL }
	connectionsById = { 1: imageConnection, 2: textConnection }
	samplingById = { 10: imageSampling }
	capabilityDefaults = {
		"text->image": {
			capability: "text->image",
			connectionId: 1,
			samplingConfigId: 10
		}
	}
	systemSettings = {
		defaultConnectionId: 2,
		defaultSamplingConfigId: 99
	}
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

	it("refuses a connection that cannot draw, naming the capability", async () => {
		// The human name, never `text->image`: somebody who switched "Image
		// generation" off has no way to connect the id back to the toggle.
		await expect(dispatch({ connectionId: 2 })).rejects.toThrow(
			/"Local Kobold" cannot do Image generation/
		)
	})

	it("accepts a text-typed connection whose capabilities say it draws", async () => {
		// The case the whole capability model exists for. KoboldCPP writes replies
		// and draws pictures from one process, so its TYPE says `text-gen` and the
		// old `isImage(type)` check refused it — for being what it is. What it can
		// do is the set on the row, not the label on the type.
		connectionsById[2] = {
			...textConnection,
			capabilities: { resolved: { "text->image": "native" } }
		}
		await dispatch({ connectionId: 2 })
		expect(seen.constructedWith.id).toBe(2)
	})

	it("says what to do when nothing is configured", async () => {
		// No registered default for the capability — the text defaults in
		// `systemSettings` stay set, because reaching for one of those instead of
		// reporting the gap is the failure this asserts against.
		capabilityDefaults = {}
		await expect(dispatch()).rejects.toThrow(
			/no image connection is set.*default/s
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
		await Promise.all([
			dispatch({ connectionId: 1 }),
			dispatch({ connectionId: 3 })
		])
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
			capabilities: { resolved: { "text->image": "native" } }
		}
		await dispatch({ connectionId: 5 })
		expect(preflightLog).toEqual([
			"preflight:start",
			"preflight:done",
			"render"
		])
	})

	it("does not preflight a backend nobody asked this app to start", async () => {
		// An external KoboldCPP, an A1111, a Forge — starting those would be a
		// surprise, and the Manager does not own them.
		await dispatch({ connectionId: 1 })
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
			capabilities: { resolved: { "text->image": "native" } }
		}
		preflightFails = true
		await expect(dispatch({ connectionId: 5 })).rejects.toThrow(
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
		await Promise.all([
			dispatch({ connectionId: 1 }),
			dispatch({ connectionId: 4 })
		])
		expect(maxConcurrent).toBe(2)
	})
})
