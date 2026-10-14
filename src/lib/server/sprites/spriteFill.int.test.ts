/**
 * 🚧 The Sprite set fill, end to end (DESIGN-image-generation §6.3; I5):
 * `core:spec/sprite-set-fill` published by the bootstrap with its two prompt
 * rows, run as a CARD ACTION (no session) through the executor against a
 * fake image server, and filed by `core:outlet/attach-sprite@1` as the card's
 * sprites — an empty sprite filled first, a redraw added as a variant, a
 * stranger refused. Plus the form preview's cost line.
 *
 * The fake server returns a picture with a transparent pixel, so the cut-out
 * step's `auto` mode passes it through untouched (no matting model is ever
 * downloaded here).
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

/** A real PNG, distinct per call, with one transparent pixel. */
let nextPicture = 1
function picture(): string {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(200)
	img.data[0] = nextPicture % 256
	img.data[1] = Math.floor(nextPicture / 256) % 256
	img.data[3] = 0
	nextPicture++
	return PNG.sync.write(img).toString("base64")
}

/** Every request the fake image server saw. */
const imageCalls: any[] = []
class FakeImageAdapter {
	constructor(public connection: any) {}
	async generateImage(req: any) {
		imageCalls.push(req)
		return {
			media: [{ kind: "image", mime: "image/png", base64: picture() }],
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
			sheet: { ...A1111_SHEET, references: { max: 4 }, perCall: 1 }
		})
	}
})

let db: TestDb
let dataDir: string
let ownerId: number
let strangerId: number
let adminId: number
let characterId: number
let setId: number

async function sprites() {
	return db
		.select()
		.from(schema.sprites)
		.where(eq(schema.sprites.spriteSetId, setId))
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-sprite-fill-int-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const [owner] = await db.insert(schema.users).values({ username: "fill-owner" }).returning()
	const [stranger] = await db.insert(schema.users).values({ username: "fill-stranger" }).returning()
	const [admin] = await db
		.insert(schema.users)
		.values({ username: "fill-admin", isAdmin: true })
		.returning()
	ownerId = owner.id
	strangerId = stranger.id
	adminId = admin.id

	// The likeness image: an ordinary file of the owner's, used as the avatar.
	const { createMedia } = await import("$lib/server/media")
	const { file: avatar } = await createMedia(db, {
		userId: ownerId,
		bytes: Buffer.from(picture(), "base64"),
		filename: "avatar.png"
	})
	const [character] = await db
		.insert(schema.characters)
		.values({
			userId: ownerId,
			name: "Verity",
			description: "",
			avatarMediaId: avatar.id,
			extensions: {
				serenepub: { likeness: { prompt: "red hair, green coat", negative: "hat" } }
			}
		} as any)
		.returning()
	characterId = character.id

	const { ensureDefaultSpriteSet, addEmptySprites } = await import("$lib/server/sprites")
	const set = await ensureDefaultSpriteSet(db, characterId)
	setId = set.id
	await addEmptySprites(db, characterId, setId, ["joy", "anger"])

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
			values: { steps: 4, width: 512, height: 512, seed: -1 },
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

describe("the Sprite set fill is published", () => {
	test("the spec and its two prompt rows are seeded", async () => {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/sprite-set-fill"))
		expect(spec).toBeTruthy()
		const rows = await db.select().from(schema.pipelinePrompts)
		const keys = rows.map((r: any) => r.seedKey)
		expect(keys).toContain(
			"pipeline-prompt:core:task/build-sprite-series:prompts:sprite-label-phrases"
		)
		expect(keys).toContain("pipeline-prompt:core:oracle/generate-image:prompts:sprite-tags")
	})
})

describe("filling sprites as a card action", () => {
	test("each label is drawn from the likeness and filed under its label", async () => {
		const { runCardAction } = await import("$lib/server/pipelines/runtime/cardAction")
		imageCalls.length = 0
		const receipt = await runCardAction({
			db,
			specId: "core:spec/sprite-set-fill",
			characterId,
			userId: ownerId,
			fields: { setName: "default", labels: ["joy", "Big Smile"] }
		})
		expect(receipt.outcome, JSON.stringify(receipt.haltReason)).toBe("ok")

		// One call per label on a loop-packed sheet, the likeness and the
		// phrase in each prompt, the avatar as the reference, one seed.
		expect(imageCalls).toHaveLength(2)
		expect(imageCalls[0].prompt).toContain("red hair, green coat")
		expect(imageCalls[0].prompt).toContain("joyful expression")
		expect(imageCalls[1].prompt).toContain("big smile")
		expect(imageCalls[0].seed).toBeGreaterThanOrEqual(0)
		expect(imageCalls[1].seed).toBe(imageCalls[0].seed)

		const rows = await sprites()
		const joy = rows.filter((r) => r.label === "joy")
		expect(joy).toHaveLength(1) // the empty sprite was filled, not added beside
		expect(joy[0].fileId).not.toBeNull()
		expect(joy[0].source).toBe("generated")
		const smile = rows.find((r) => r.label === "big smile")
		expect(smile?.source).toBe("generated")
		// The anger slot was not asked for and stays empty.
		expect(rows.find((r) => r.label === "anger")?.fileId).toBeNull()

		// The pictures became the card's files.
		const [file] = await db
			.select()
			.from(schema.files)
			.where(eq(schema.files.id, joy[0].fileId!))
		expect(file.characterId).toBe(characterId)

		expect(receipt.emitted.map((e) => e.event)).toContain(
			"core:event/sprites-attached@1"
		)
		const attach = receipt.nodes.find((n) => n.nodeKey === "attach")
		expect((attach?.output as any)?.attached).toHaveLength(2)
		expect((attach?.output as any)?.missing).toEqual([])
	})

	test("a redraw becomes a variant, never a replacement", async () => {
		const { runCardAction } = await import("$lib/server/pipelines/runtime/cardAction")
		const before = (await sprites()).filter((r) => r.label === "joy")
		const receipt = await runCardAction({
			db,
			specId: "core:spec/sprite-set-fill",
			characterId,
			userId: ownerId,
			fields: { setName: "default", labels: ["joy"] }
		})
		expect(receipt.outcome).toBe("ok")
		const joy = (await sprites())
			.filter((r) => r.label === "joy")
			.sort((a, b) => a.position - b.position)
		expect(joy).toHaveLength(2)
		expect(joy[0].id).toBe(before[0].id)
		expect(joy[0].fileId).toBe(before[0].fileId)
		expect(joy[1].position).toBe(1)
	})

	test("someone who neither owns the card nor is an admin is refused at the write", async () => {
		const { runCardAction } = await import("$lib/server/pipelines/runtime/cardAction")
		const count = (await sprites()).length
		const receipt = await runCardAction({
			db,
			specId: "core:spec/sprite-set-fill",
			characterId,
			userId: strangerId,
			fields: { setName: "default", labels: ["anger"] }
		})
		expect(receipt.outcome).not.toBe("ok")
		expect((await sprites()).length).toBe(count)
	})
})

describe("attach-sprite's rules", () => {
	test("unkeyed pictures are ignored and missing labels reported", async () => {
		const { attachGeneratedSprites } = await import("./attach")
		const { createMedia } = await import("$lib/server/media")
		const { file } = await createMedia(db, {
			userId: adminId,
			bytes: Buffer.from(picture(), "base64"),
			filename: "x.png"
		})
		const ref = { uuid: file.uuid, kind: "image", mime: "image/png", bytes: 1 }
		const out = await attachGeneratedSprites(db, {
			characterId,
			setName: "default",
			userId: adminId, // an admin may fill another person's card
			media: [{ ...ref }, { ...ref, key: "pride" }],
			series: [
				{ key: "pride", vars: { label: "pride" } },
				{ key: "fear", vars: { label: "fear" } }
			]
		})
		expect(out.attached.map((a) => a.label)).toEqual(["pride"])
		expect(out.missing).toEqual(["fear"])
		const pride = (await sprites()).filter((r) => r.label === "pride")
		expect(pride).toHaveLength(1)
	})

	test("a picture that is neither the person's nor the card's is refused", async () => {
		const { attachGeneratedSprites, AttachSpriteRefusal } = await import("./attach")
		const { createMedia } = await import("$lib/server/media")
		const { file } = await createMedia(db, {
			userId: strangerId,
			bytes: Buffer.from(picture(), "base64"),
			filename: "y.png"
		})
		await expect(
			attachGeneratedSprites(db, {
				characterId,
				setName: "default",
				userId: ownerId,
				media: [{ uuid: file.uuid, kind: "image", key: "relief" }],
				series: [{ key: "relief", vars: { label: "relief" } }]
			})
		).rejects.toBeInstanceOf(AttachSpriteRefusal)
	})
})

describe("the fill form's preview", () => {
	test("a member sees the count and the calls, never the pair", async () => {
		const { previewSpriteFill } = await import("./fillAction")
		const out = await previewSpriteFill(db, {
			characterId,
			userId: ownerId,
			isAdmin: false
		})
		// `anger` is the one empty sprite left.
		expect(out.labels).toEqual(["anger"])
		expect(out.emptyLabels).toEqual(["anger"])
		expect(out.line).toBe("1 picture · 1 call")
		expect(out.refusal).toBeUndefined()
	})

	test("an admin sees the pair it draws on", async () => {
		const { previewSpriteFill } = await import("./fillAction")
		const out = await previewSpriteFill(db, {
			characterId,
			labels: ["joy", "anger", "fear"],
			userId: adminId,
			isAdmin: true
		})
		expect(out.pictures).toBe(3)
		expect(out.line).toMatch(/^3 pictures · 3 calls on Image · sdxl\.safetensors/)
	})

	test("an unset Images default is refused with the admin's sentence", async () => {
		const { previewSpriteFill } = await import("./fillAction")
		const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
		await setCapabilityDefault(db, "text->image", { connectionId: null })
		const out = await previewSpriteFill(db, {
			characterId,
			userId: ownerId,
			isAdmin: false
		})
		expect(out.refusal).toMatch(/No model is set for Images.*An admin chooses it/)
	})
})
