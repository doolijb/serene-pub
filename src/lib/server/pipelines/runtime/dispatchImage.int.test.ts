/**
 * Image dispatch: the adapters reached with a prompt built elsewhere.
 *
 * The adapter is a fake, because what is under test is not whether Fooocus draws
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
	type: "image_fooocus",
	name: "Local Fooocus",
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

/** What `resolveTarget` finds. Set per test. */
let systemSettings: any = {
	defaultImageConnectionId: 1,
	defaultImageSamplingConfigId: 10,
	// Deliberately different, so a test can prove the text defaults are not used.
	defaultConnectionId: 2,
	defaultSamplingConfigId: 99
}
let connectionsById: Record<number, any> = {}
let samplingById: Record<number, any> = {}

/**
 * The database, handed in rather than imported — the same shape `dispatch.ts`
 * takes, and for the same reason: a module that imports the app's connection
 * cannot be pointed at a test one.
 */
const fakeDb = {
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
	connectionsById = { 1: imageConnection, 2: textConnection }
	samplingById = { 10: imageSampling }
	systemSettings = {
		defaultImageConnectionId: 1,
		defaultImageSamplingConfigId: 10,
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
			backend: "image_fooocus",
			connectionName: "Local Fooocus",
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

	it("refuses a connection that does not generate images", async () => {
		await expect(dispatch({ connectionId: 2 })).rejects.toThrow(
			/does not generate images/
		)
	})

	it("says what to do when nothing is configured", async () => {
		systemSettings = {}
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
})
