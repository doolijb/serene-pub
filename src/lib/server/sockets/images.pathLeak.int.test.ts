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
	model: "juggernautXL.safetensors",
	extraJson: {}
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
		}
	}
}))

vi.mock("$lib/server/pipelines/runtime/capabilityGuard", () => ({
	capabilityRefusal: () => null
}))

vi.mock("$lib/server/connections/capabilityDefaults", () => ({
	capabilityDefault: async () => undefined
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
		{ user: { id: 1 } } as any,
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
