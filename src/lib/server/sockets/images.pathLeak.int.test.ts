/**
 * `images:generate` ships a `GeneratedMedia[]` straight to the browser, and
 * until 0182 every entry carried `path: row.path` — the on-disk location of a
 * freshly written file, disclosing the data-dir layout and the owner's user id
 * to anyone who could read a socket payload.
 *
 * It stood for as long as it did because the two path-leak tests both inspect
 * `toClientMedia`, and this response never goes through it: the handler builds
 * its own object. So the property is asserted here, over the shape that
 * actually leaked, against a `createMedia` mock whose variant row DOES carry a
 * path — an assertion that nothing leaked is worth nothing if there was nothing
 * to leak.
 *
 * Everything below the handler is stubbed on purpose. The point is the response
 * this function builds, not the backend that fed it.
 *
 * The second block is a different leak on the same handler, added when
 * connections became invisible to non-admins: this is the one endpoint that
 * took a `connectionId` STRAIGHT from the client and rendered on it, so it was
 * also an enumeration oracle over every connection's name and model. It is
 * administrators only now, which is why the socket above is one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const PNG_1x1 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

/** The one fact a variant row holds that no response may ever carry. */
const STORED_PATH = "data/users/1/sessions/9/deadbeef.png"

const imageConnection = {
	id: 1,
	type: "a1111",
	name: "Local A1111",
	modality: "image-gen",
	baseUrl: "http://127.0.0.1:7860",
	extraJson: {}
}

/**
 * The MODEL half of the pair. The checkpoint is a property of this row, not of
 * the endpoint, and the handler reaches it through the registered `text->image`
 * default — the one entry point into image generation that takes a connection
 * id from the client and so has no tier chain to walk.
 */
const imageModel = {
	id: 77,
	connectionId: 1,
	model: "juggernautXL.safetensors",
	name: "Juggernaut XL",
	enabled: true,
	missingSince: null
}

class FakeAdapter {
	constructor(public connection: any) {}
	async generateImage() {
		return {
			media: [{ kind: "image", mime: "image/png", base64: PNG_1x1 }],
			isAborted: false,
			applied: ["steps"],
			ignored: []
		}
	}
}

vi.mock("$lib/server/utils/getImageAdapter", () => ({
	getImageAdapter: async () => ({ Adapter: FakeAdapter })
}))

vi.mock("$lib/server/media", () => ({
	createMedia: async (_db: any, input: any) => ({
		file: {
			id: 12,
			uuid: "3f1a2b4c-5d6e-7f80-9a1b-2c3d4e5f6071",
			rev: 4,
			kind: "image",
			// mime and bytes are variant-level facts, denormalised onto the
			// file so a payload is one row. A response reads THESE.
			displayMime: "image/png",
			displayBytes: input.bytes.length,
			width: 1,
			height: 1,
			durationMs: null,
			filename: input.filename
		},
		original: {
			id: 90,
			fileId: 12,
			variant: "original",
			mime: "image/png",
			bytes: input.bytes.length,
			path: STORED_PATH,
			hash: "deadbeef",
			isOriginal: true,
			cache: false,
			fidelity: "full"
		}
	}),
	mediaUrl: (uuid: string, rev: number, variant?: string) =>
		`/media/${uuid}?${variant ? `v=${variant}&r=${rev}` : `r=${rev}`}`
}))

vi.mock("$lib/server/db", () => ({
	db: {
		query: {
			connections: { findFirst: async () => imageConnection },
			samplingConfigs: { findFirst: async () => undefined }
		},
		// The model row the registration names. `connectionModelById` is the
		// only `select` this handler makes, so one canned answer serves it.
		select: () => ({
			from: () => ({
				where: () => ({ limit: async () => [imageModel] })
			})
		})
	}
}))

vi.mock("$lib/server/pipelines/runtime/capabilityGuard", () => ({
	capabilityRefusal: () => null
}))

// The registration this handler reads the model half from: THIS endpoint, with
// an explicit model. Anything else — no registration, another endpoint's, a
// model that is gone or switched off — refuses, because connections have no
// default model to fall back to.
vi.mock("$lib/server/connections/capabilityDefaults", () => ({
	capabilityDefault: async () => ({
		connectionId: 1,
		connectionModelId: 77,
		samplingConfigId: null
	})
}))

vi.mock("$lib/server/utils/tokenCrypto", () => ({
	decryptApiKeyField: (v: string) => v
}))

vi.mock("$lib/server/utils/sessionAccess", () => ({
	checkSessionAccess: async () => ({ hasAccess: true })
}))

vi.mock("$lib/server/imageGen/buildRequest", () => ({
	buildImageRequest: ({ prompt }: any) => ({ prompt })
}))

/** Everything the handler emitted, so the broadcast is inspected too — a leak
 *  in the emitted copy is the same leak. */
let emitted: { event: string; data: any }[] = []

beforeEach(() => {
	emitted = []
})

async function generate() {
	const { imagesGenerate } = await import("./images")
	return imagesGenerate.handler(
		// An administrator, because `images:generate` is now one: it takes a
		// `connectionId` straight from the client and renders on it, and its
		// only caller is the connection editor's Test Generation button. What
		// this file is about is unchanged — an on-disk path must not reach the
		// browser in the reply or the broadcast — and it can only be reached
		// at all by somebody the handler will still answer.
		{ user: { id: 1, isAdmin: true } } as any,
		{ connectionId: 1, prompt: "a knight at dusk" },
		(event, data) => emitted.push({ event, data })
	)
}

describe("images:generate — what reaches the browser", () => {
	it("carries no on-disk path, in the return or in the broadcast", async () => {
		const res = await generate()
		expect(res.ok).toBe(true)
		expect(res.media).toHaveLength(1)

		// Field-level, so the failure names the field rather than the blob.
		expect(res.media![0]).not.toHaveProperty("path")

		// And over the whole payload, because the leak that happened was a
		// field nobody was looking at rather than one somebody misread.
		expect(JSON.stringify(res)).not.toContain(STORED_PATH)
		expect(JSON.stringify(res)).not.toContain("data/users/")
		expect(JSON.stringify(emitted)).not.toContain(STORED_PATH)
	})

	it("hands back a ready URL carrying the file's rev", async () => {
		const res = await generate()
		const item = res.media![0]

		// The uuid is stable for the file and shared by every variant, so the
		// URL alone cannot say "these bytes changed" — `rev` is what does, and
		// a consumer that had to assemble it itself would be the one place the
		// cache guarantee could silently be dropped.
		expect(item.url).toBe("/media/3f1a2b4c-5d6e-7f80-9a1b-2c3d4e5f6071?r=4")
		expect(item.rev).toBe(4)
		// Already has a query string: anything appending must use `&`.
		expect(item.url).toContain("?")
	})

	it("describes the display variant, not the stored original", async () => {
		const res = await generate()
		// `mime` comes off the file's denormalised projection. Reading it off a
		// variant row would put a second query on a path whose whole design is
		// one row, and would report a fact about bytes the URL may not serve.
		expect(res.media![0].mime).toBe("image/png")
		expect(res.media![0].kind).toBe("image")
	})
})

describe("images:generate — who may choose the connection", () => {
	it("refuses a non-admin, before the id is looked up", async () => {
		const { imagesGenerate } = await import("./images")
		const { CONNECTION_REFUSAL } = await import(
			"$lib/server/connections/visibility"
		)

		const refused = await imagesGenerate.handler(
			{ user: { id: 1, isAdmin: false } } as any,
			// A real connection id — the one the admin case above renders on.
			{ connectionId: 1, prompt: "a knight at dusk" },
			(event, data) => emitted.push({ event, data })
		)

		expect(refused.ok).toBe(false)
		expect(refused.error).toBe(CONNECTION_REFUSAL)
		expect(refused.media).toBeUndefined()

		// Nothing was rendered, so no compute was spent on the
		// administrator's backend at a stranger's request.
		expect(
			emitted.filter((e) => e.event === "images:progress")
		).toHaveLength(0)
	})

	it("answers the same for an id that does not exist", async () => {
		const { imagesGenerate } = await import("./images")

		const real = await imagesGenerate.handler(
			{ user: { id: 1, isAdmin: false } } as any,
			{ connectionId: 1, prompt: "x" },
			() => {}
		)
		const invented = await imagesGenerate.handler(
			{ user: { id: 1, isAdmin: false } } as any,
			{ connectionId: 999_999, prompt: "x" },
			() => {}
		)

		// The old handler said "Connection not found." for one and named the
		// connection in a capability refusal for the other — walk the ids and
		// the whole table falls out. Both answers are now one sentence.
		expect(invented.error).toBe(real.error)
		expect(invented.error).not.toMatch(/not found/i)
		expect(JSON.stringify(invented)).not.toContain("Local A1111")
	})
})
