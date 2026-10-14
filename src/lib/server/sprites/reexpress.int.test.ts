/**
 * 🚧 **Re-express from neutral** (DESIGN-image-generation §6.3): the
 * `characters:expressSprite` socket redraws a set's neutral sprite as another
 * label with the Sprites loadout's pair, through a mocked adapter whose sheet
 * says (or does not say) `expressions`. The picture is filed by the shared
 * placement rule (an empty sprite first), `sprites-attached` is raised, and
 * the two refusals — no neutral picture, a pair without expressions — are one
 * sentence each. `images:drawingSheet` answers a member owner `expressions`.
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

const expressCalls: Array<{ uuid: string; label: string; bytes: number }> = []
const sheetState = { expressions: true }
class FakeExpressAdapter {
	constructor(public connection: any) {}
	async generateImage() {
		throw new Error("not used")
	}
	async expressImage(ref: any, label: string, opts: any) {
		const { bytes } = await opts.loadMedia(ref)
		expressCalls.push({ uuid: ref.uuid, label, bytes: bytes.length })
		return {
			media: [{ kind: "image", mime: "image/png", base64: picture() }],
			isAborted: false,
			applied: ["expression"],
			ignored: []
		}
	}
}
vi.mock("$lib/server/utils/getImageAdapter", async () => {
	const { NOVELAI_SHEET } = await import("$lib/server/imageAdapters/NovelAIImageAdapter")
	return {
		getImageAdapter: async () => ({
			Adapter: FakeExpressAdapter,
			get sheet() {
				return { ...NOVELAI_SHEET, expressions: sheetState.expressions }
			}
		})
	}
})

let db: TestDb
let dataDir: string
let ownerId: number
let strangerId: number
let characterId: number
let setId: number

const socket = (userId: number, isAdmin = false) => ({ user: { id: userId, isAdmin } }) as any
function collector() {
	const emitted: { event: string; data: any }[] = []
	return { emitted, emit: (event: string, data: any) => emitted.push({ event, data }) }
}

async function rows() {
	return db.select().from(schema.sprites).where(eq(schema.sprites.spriteSetId, setId))
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-reexpress-int-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const [owner] = await db.insert(schema.users).values({ username: "rx-owner" }).returning()
	const [stranger] = await db.insert(schema.users).values({ username: "rx-stranger" }).returning()
	ownerId = owner.id
	strangerId = stranger.id
	const [character] = await db
		.insert(schema.characters)
		.values({ userId: ownerId, name: "Verity", description: "" } as any)
		.returning()
	characterId = character.id

	const { ensureDefaultSpriteSet, addEmptySprites } = await import("$lib/server/sprites")
	const set = await ensureDefaultSpriteSet(db, characterId)
	setId = set.id
	await addEmptySprites(db, characterId, setId, ["joy", "neutral"])

	const [conn] = await db
		.insert(schema.connections)
		.values({
			name: "NAI",
			type: "novelai",
			baseUrl: "https://image.novelai.net",
			capabilities: { overrides: { "text->image": "good" } }
		} as any)
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const model = (await ensureConnectionModel(db, conn.id, "nai-diffusion-5-full"))!
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->image", {
		connectionId: conn.id,
		connectionModelId: model.id,
		samplingConfigId: null
	})
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("characters:expressSprite", () => {
	test("refuses with one sentence when the set has no neutral picture", async () => {
		const { charactersExpressSprite } = await import("$lib/server/sockets/sprites")
		const out = collector()
		await expect(
			charactersExpressSprite.handler(socket(ownerId), { characterId, label: "joy" }, out.emit)
		).rejects.toThrow(/no neutral sprite with a picture/)
		const err = out.emitted.find((e) => e.event === "characters:expressSprite:error")
		expect(err?.data).toMatchObject({ characterId })
		expect(expressCalls).toHaveLength(0)
	})

	test("redraws the neutral sprite under the label, fills the empty sprite, raises sprites-attached", async () => {
		const { addSprite } = await import("$lib/server/sprites")
		const neutral = await addSprite(db, {
			userId: ownerId,
			characterId,
			setId,
			label: "neutral",
			bytes: Buffer.from(picture(), "base64"),
			source: "upload"
		})
		const { pluginEvents } = await import("$lib/server/plugins/eventHost")
		const notify = vi.spyOn(pluginEvents(), "notify")

		const { charactersExpressSprite } = await import("$lib/server/sockets/sprites")
		const out = collector()
		const res = await charactersExpressSprite.handler(
			socket(ownerId),
			{ characterId, setId, label: "Joy" },
			out.emit
		)

		expect(expressCalls).toHaveLength(1)
		expect(expressCalls[0].label).toBe("joy")
		const [neutralFile] = await db
			.select()
			.from(schema.files)
			.where(eq(schema.files.id, neutral.fileId!))
		expect(expressCalls[0].uuid).toBe(neutralFile.uuid)

		const joy = (await rows()).filter((r) => r.label === "joy")
		expect(joy).toHaveLength(1) // the empty sprite was filled
		expect(joy[0].fileId).not.toBeNull()
		expect(joy[0].source).toBe("generated")
		expect(res.spriteId).toBe(joy[0].id)
		expect(res.sets.length).toBeGreaterThan(0)
		expect(out.emitted.map((e) => e.event)).toContain("characters:expressSprite")

		const [file] = await db.select().from(schema.files).where(eq(schema.files.id, joy[0].fileId!))
		expect(file.characterId).toBe(characterId)

		expect(notify).toHaveBeenCalledWith(
			expect.anything(),
			"core:event/sprites-attached@1",
			expect.objectContaining({
				characterId,
				setId,
				attached: [{ label: "joy", spriteId: joy[0].id }]
			}),
			expect.anything()
		)

		// Again: a variant beside it, never a replacement.
		await charactersExpressSprite.handler(socket(ownerId), { characterId, setId, label: "joy" }, out.emit)
		expect((await rows()).filter((r) => r.label === "joy")).toHaveLength(2)
	})

	test("refuses, naming the pair to an admin, when its sheet has no expressions", async () => {
		sheetState.expressions = false
		try {
			const { charactersExpressSprite } = await import("$lib/server/sockets/sprites")
			const before = expressCalls.length
			await expect(
				charactersExpressSprite.handler(socket(ownerId), { characterId, label: "anger" }, collector().emit)
			).rejects.toThrow(/^The model set for sprites cannot redraw a picture with another expression\.$/)
			const [admin] = await db
				.insert(schema.users)
				.values({ username: "rx-admin", isAdmin: true })
				.returning()
			await expect(
				charactersExpressSprite.handler(socket(admin.id, true), { characterId, label: "anger" }, collector().emit)
			).rejects.toThrow(/^NAI · nai-diffusion-5-full cannot redraw/)
			expect(expressCalls.length).toBe(before)
		} finally {
			sheetState.expressions = true
		}
	})

	test("a stranger is refused", async () => {
		const { charactersExpressSprite } = await import("$lib/server/sockets/sprites")
		await expect(
			charactersExpressSprite.handler(socket(strangerId), { characterId, label: "joy" }, collector().emit)
		).rejects.toThrow(/owner or an admin/)
	})
})

describe("images:drawingSheet for a card", () => {
	test("a member owner hears expressions, never the sheet", async () => {
		const { imagesDrawingSheet } = await import("$lib/server/sockets/images")
		const res = await imagesDrawingSheet.handler(socket(ownerId), { characterId }, collector().emit)
		expect(res).toMatchObject({ characterId, expressions: true, sheet: null })
		sheetState.expressions = false
		try {
			const off = await imagesDrawingSheet.handler(socket(ownerId), { characterId }, collector().emit)
			expect(off.expressions).toBe(false)
		} finally {
			sheetState.expressions = true
		}
		const stranger = await imagesDrawingSheet.handler(socket(strangerId), { characterId }, collector().emit)
		expect(stranger.expressions).toBe(false)
	})
})
