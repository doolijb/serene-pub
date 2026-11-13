/**
 * 🚧 Portrait, end to end (DESIGN-image-generation §6.2; I8):
 * `core:spec/character-portrait` published by the bootstrap with its two
 * prompt rows, run as a CARD ACTION (no session) against a fake image
 * server, parked at review (on by default) and approved, and its pictures
 * offered to the card's gallery by `core:outlet/offer-media@1`. Plus the
 * proofs series, the dialog preview's cost line on a batch pair and a
 * loop pair, and the Prose style switching the prompt row.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

let nextPicture = 1
function picture(): string {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(200)
	img.data[0] = nextPicture % 256
	img.data[1] = Math.floor(nextPicture / 256) % 256
	nextPicture++
	return PNG.sync.write(img).toString("base64")
}

/** Every request the fake image server saw. */
const imageCalls: any[] = []
/** The fake pair's pictures per call: 1 loops, more packs a batch. */
let perCall = 1
class FakeImageAdapter {
	constructor(public connection: any) {}
	async generateImage(req: any, opts?: any) {
		imageCalls.push(req)
		// What a queued backend says of itself (the Horde: a position, a wait).
		opts?.onProgress?.({
			stage: "queued",
			percent: 0,
			message: "In the Horde's queue at position 3"
		})
		const n = Math.max(1, Number(req.batch ?? 1))
		return {
			media: Array.from({ length: n }, () => ({
				kind: "image",
				mime: "image/png",
				base64: picture()
			})),
			isAborted: false,
			applied: ["seed"],
			ignored: []
		}
	}
}
vi.mock("$lib/server/utils/getImageAdapter", async () => {
	const { A1111_SHEET } = await import("$lib/server/imageAdapters/A1111Adapter")
	return {
		getImageAdapter: async () => ({
			Adapter: FakeImageAdapter,
			sheet: { ...A1111_SHEET, references: { max: 4 }, perCall }
		})
	}
})

let db: TestDb
let dataDir: string
let ownerId: number
let strangerId: number
let adminId: number
let characterId: number

async function gallery() {
	const { listCharacterGallery } = await import("$lib/server/utils")
	return listCharacterGallery({ characterId })
}

/** Run the portrait, approving the review card it parks on. */
async function runApproved(fields: Record<string, unknown>, overrides: any[] = []) {
	const { runCardAction } = await import("$lib/server/pipelines/runtime/cardAction")
	const { pendingReviewsFor, resolveReview } = await import(
		"$lib/server/pipelines/runtime/reviewGate"
	)
	const reviewed: any[] = []
	const running = runCardAction({
		db,
		specId: "core:spec/character-portrait",
		characterId,
		userId: ownerId,
		fields,
		overrides
	})
	const approve = (async () => {
		for (let i = 0; i < 400; i++) {
			const [card] = pendingReviewsFor(ownerId)
			if (card) {
				reviewed.push(card)
				resolveReview(card.id, ownerId, "approve")
				return
			}
			await new Promise((r) => setTimeout(r, 25))
		}
	})()
	const receipt = await running
	await approve
	return { receipt, reviewed }
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-portrait-int-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const [owner] = await db.insert(schema.users).values({ username: "portrait-owner" }).returning()
	const [stranger] = await db
		.insert(schema.users)
		.values({ username: "portrait-stranger" })
		.returning()
	const [admin] = await db
		.insert(schema.users)
		.values({ username: "portrait-admin", isAdmin: true })
		.returning()
	ownerId = owner.id
	strangerId = stranger.id
	adminId = admin.id

	const [character] = await db
		.insert(schema.characters)
		.values({
			userId: ownerId,
			name: "Verity",
			description: "",
			extensions: {
				serenepub: { likeness: { prompt: "red hair, green coat", negative: "hat" } }
			}
		} as any)
		.returning()
	characterId = character.id

	const [conn] = await db
		.insert(schema.connections)
		.values({
			name: "Image",
			type: "a1111",
			baseUrl: "http://image",
			capabilities: { overrides: { "text->image": "good" } }
		} as any)
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const model = (await ensureConnectionModel(db, conn.id, "sdxl.safetensors"))!
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Image test",
			isImmutable: false,
			shape: "core:shape/image-gen@1",
			values: { steps: 4, width: 512, height: 768, seed: -1 },
			enabled: ["steps", "width", "height", "seed"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->image", {
		connectionId: conn.id,
		connectionModelId: model.id,
		samplingConfigId: sampling.id
	})
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("proofs", () => {
	test("n identical items keyed 1…n, clamped", async () => {
		const { buildProofs } = await import("./portrait")
		expect(buildProofs(3)).toEqual([
			{ key: "1", vars: {} },
			{ key: "2", vars: {} },
			{ key: "3", vars: {} }
		])
		expect(buildProofs("nope")).toHaveLength(1)
		expect(buildProofs(0)).toHaveLength(1)
		expect(buildProofs(99)).toHaveLength(8)
	})
})

describe("Portrait is published", () => {
	test("the spec and its two prompt rows are seeded; review is on", async () => {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/character-portrait"))
		expect(spec).toBeTruthy()
		const keys = (await db.select().from(schema.pipelinePrompts)).map((r: any) => r.seedKey)
		expect(keys).toContain("pipeline-prompt:core:oracle/generate-image:prompts:portrait-tags")
		expect(keys).toContain("pipeline-prompt:core:oracle/generate-image:prompts:portrait-prose")
		const { previewPortrait } = await import("./portrait")
		const out = await previewPortrait(db, { characterId, userId: ownerId, isAdmin: false })
		expect(out.review).toBe(true)
	})
})

describe("generating a portrait as a card action", () => {
	test("parks at review, then offers each picture to the gallery", async () => {
		perCall = 1
		imageCalls.length = 0
		const before = (await gallery()).length
		const { receipt, reviewed } = await runApproved({ count: 2, style: "tags" })
		expect(receipt.outcome, JSON.stringify(receipt.haltReason)).toBe("ok")

		// The review card showed the likeness as the prompt.
		expect(reviewed).toHaveLength(1)
		expect(reviewed[0].definitionId).toMatch(/^core:oracle\/generate-image/)
		expect(reviewed[0].values.prompt).toBe("red hair, green coat")

		// A loop pair: one call per picture, the tags row, upright — and NO
		// seed fixed for the run: proofs share a prompt, so one seed drew
		// `count` identical pictures (2026-11-08). The sampling's random seed
		// (-1) goes through as set and each backend draws its own per call.
		expect(imageCalls).toHaveLength(2)
		expect(imageCalls[0].prompt).toContain("red hair, green coat, portrait, head and shoulders")
		expect(imageCalls[0].height).toBeGreaterThan(imageCalls[0].width)
		for (const c of imageCalls)
			expect(typeof c.seed === "number" && c.seed >= 0).toBe(false)

		const after = await gallery()
		expect(after.length).toBe(before + 2)
		const offer = receipt.nodes.find((n) => n.nodeKey === "offer")
		const offered = (offer?.output as any)?.offered
		expect(offered.map((o: any) => o.key)).toEqual(["1", "2"])
		expect(after.map((m) => m.id)).toEqual(
			expect.arrayContaining(offered.map((o: any) => o.mediaId))
		)
		expect(receipt.emitted.map((e) => e.event)).toContain("core:event/media-offered@1")

		// Nothing was chosen for the person.
		const [row] = await db
			.select()
			.from(schema.characters)
			.where(eq(schema.characters.id, characterId))
		expect(row.avatarMediaId).toBeNull()
	})

	test("Prose picks the prose prompt row", async () => {
		perCall = 1
		imageCalls.length = 0
		const { styleOverrides } = await import("./portrait")
		const { receipt } = await runApproved(
			{ count: 1, style: "prose" },
			await styleOverrides(db, "prose")
		)
		expect(receipt.outcome).toBe("ok")
		expect(imageCalls).toHaveLength(1)
		expect(imageCalls[0].prompt).toMatch(/^A head-and-shoulders portrait/)
		expect(imageCalls[0].prompt).toContain("red hair, green coat")
	})
})

describe("offer-media's rules", () => {
	test("a stranger is refused; a picture neither theirs nor the card's is refused", async () => {
		const { offerMediaToGallery, OfferMediaRefusal } = await import("./portrait")
		const { createMedia } = await import("$lib/server/media")
		const { file } = await createMedia(db, {
			userId: strangerId,
			bytes: Buffer.from(picture(), "base64"),
			filename: "s.png"
		})
		const ref = { uuid: file.uuid, kind: "image", key: "1" }
		await expect(
			offerMediaToGallery(db, { characterId, userId: strangerId, media: [ref] })
		).rejects.toBeInstanceOf(OfferMediaRefusal)
		await expect(
			offerMediaToGallery(db, { characterId, userId: ownerId, media: [ref] })
		).rejects.toBeInstanceOf(OfferMediaRefusal)
	})

	test("an admin may offer their own picture; it lands last in the gallery", async () => {
		const { offerMediaToGallery } = await import("./portrait")
		const { createMedia } = await import("$lib/server/media")
		const { file } = await createMedia(db, {
			userId: adminId,
			bytes: Buffer.from(picture(), "base64"),
			filename: "a.png"
		})
		const out = await offerMediaToGallery(db, {
			characterId,
			userId: adminId,
			media: [{ uuid: file.uuid, kind: "image" }]
		})
		expect(out.offered).toEqual([{ mediaId: file.id, key: null }])
		const ids = (await gallery()).map((m) => m.id)
		expect(ids[ids.length - 1]).toBe(file.id)
	})
})

describe("the dialog's preview", () => {
	test("a loop pair: one call per picture; a member never sees the pair", async () => {
		perCall = 1
		const { previewPortrait } = await import("./portrait")
		const out = await previewPortrait(db, {
			characterId,
			count: 2,
			userId: ownerId,
			isAdmin: false
		})
		expect(out.line).toBe("2 pictures · 2 calls")
		expect(out.refusal).toBeUndefined()
	})

	test("a batch pair packs the proofs as one call; an admin sees the pair", async () => {
		perCall = 4
		const { previewPortrait } = await import("./portrait")
		const out = await previewPortrait(db, {
			characterId,
			count: 3,
			userId: adminId,
			isAdmin: true
		})
		expect(out.line).toMatch(/^3 pictures · 1 call on Image · sdxl\.safetensors/)
		perCall = 1
	})

	test("the count is held to 1–4", async () => {
		const { previewPortrait } = await import("./portrait")
		const out = await previewPortrait(db, {
			characterId,
			count: 9,
			userId: ownerId,
			isAdmin: false
		})
		expect(out.count).toBe(4)
	})

	test("a backend's own sentence — the Horde's queue position — reaches the gallery's progress line", async () => {
		// Seen 2026-11-10 on the real Horde: the adapter said "In the Horde's
		// queue at position N" and the gallery showed "Drawing 2 pictures · 0%"
		// for a minute, with no sign the wait was a queue.
		const { runPortrait } = await import("./portrait")
		const { pendingReviewsFor, resolveReview } = await import(
			"$lib/server/pipelines/runtime/reviewGate"
		)
		const reports: any[] = []
		const running = runPortrait(db, {
			characterId,
			count: 1,
			userId: ownerId,
			runId: "portrait-queued",
			report: (p) => reports.push(p)
		})
		for (let i = 0; i < 400; i++) {
			const [card] = pendingReviewsFor(ownerId)
			if (card) {
				resolveReview(card.id, ownerId, "approve")
				break
			}
			await new Promise((r) => setTimeout(r, 25))
		}
		await running
		expect(reports.some((r) => r.message === "In the Horde's queue at position 3")).toBe(true)
		expect(reports.at(-1)).toMatchObject({ phase: "done" })
	})

	test("a card with no likeness is refused — preview and run — not drawn from the tail alone", async () => {
		// Owner ruling 2026-11-08: "Add a likeness first". Until then it was
		// a notice, and the portrait came out as a generic face.
		const [bare] = await db
			.insert(schema.characters)
			.values({ userId: ownerId, name: "Blank", description: "A face with no likeness." } as any)
			.returning()
		const { previewPortrait, runPortrait } = await import("./portrait")
		const out = await previewPortrait(db, { characterId: bare.id, count: 1, userId: ownerId, isAdmin: false })
		expect(out.refusal).toMatch(/^Add a likeness first/)
		expect(out.calls).toBeNull()

		const reports: any[] = []
		const before = imageCalls.length
		await runPortrait(db, {
			characterId: bare.id,
			count: 1,
			userId: ownerId,
			runId: "portrait-no-likeness",
			report: (p) => reports.push(p)
		})
		expect(reports.at(-1)).toMatchObject({ phase: "failed" })
		expect(reports.at(-1).error).toMatch(/^Add a likeness first/)
		expect(imageCalls.length).toBe(before)
	})
})

describe("setting the likeness image (cv-writers)", () => {
	test("lands on the card's current version, keeping the prompt and negative; the row's extensions stay as they were", async () => {
		const { offerMediaToGallery } = await import("./portrait")
		const { createMedia } = await import("$lib/server/media")
		const { charactersSetLikenessImage } = await import(
			"$lib/server/sockets/portrait"
		)
		const { file } = await createMedia(db, {
			userId: ownerId,
			bytes: Buffer.from(picture(), "base64"),
			filename: "likeness.png"
		})
		await offerMediaToGallery(db, {
			characterId,
			userId: ownerId,
			media: [{ uuid: file.uuid, kind: "image" }]
		})
		const events: [string, any][] = []
		const res = await charactersSetLikenessImage.handler(
			{ user: { id: ownerId } } as any,
			{ characterId, mediaId: file.id },
			(event: string, data: any) => events.push([event, data])
		)
		expect(res).toEqual({ characterId, imageMediaId: file.id })
		expect(events.map((e) => e[0])).toEqual(["characters:setLikenessImage"])

		const versions = await db
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.cardId, characterId))
		expect(versions).toHaveLength(1)
		expect(versions[0].likeness).toEqual({
			prompt: "red hair, green coat",
			negative: "hat",
			imageMediaId: file.id
		})
		const [row] = await db
			.select()
			.from(schema.characters)
			.where(eq(schema.characters.id, characterId))
		expect((row.extensions as any).serenepub.likeness).toEqual({
			prompt: "red hair, green coat",
			negative: "hat"
		})

		// another person's card is refused, and writes nothing
		await expect(
			charactersSetLikenessImage.handler(
				{ user: { id: strangerId } } as any,
				{ characterId, mediaId: file.id },
				() => {}
			)
		).rejects.toThrow(/not found or access denied/)
	})
})
