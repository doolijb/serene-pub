/**
 * 🚧 **Re-express from neutral** on a cast member (ruling ★7, 2026-11-08):
 * `characters:expressSprite` with `{ castMemberId }` redraws the member's own
 * neutral sprite into the member's set; the new picture is the book owner's
 * file with the book as provenance, and the fan-out names the member.
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

class FakeExpressAdapter {
	constructor(public connection: any) {}
	async generateImage() {
		throw new Error("not used")
	}
	async expressImage() {
		return {
			media: [{ kind: "image", mime: "image/png", base64: picture() }],
			isAborted: false,
			applied: ["expression"],
			ignored: []
		}
	}
}
vi.mock("$lib/server/utils/getImageAdapter", async () => {
	const { NOVELAI_SHEET } = await import(
		"$lib/server/imageAdapters/NovelAIImageAdapter"
	)
	return {
		getImageAdapter: async () => ({
			Adapter: FakeExpressAdapter,
			sheet: { ...NOVELAI_SHEET, expressions: true }
		})
	}
})

let db: TestDb
let dataDir: string
let n = 0
const socket = (userId: number, isAdmin = false) =>
	({ user: { id: userId, isAdmin } }) as any

async function user(label: string, isAdmin = false) {
	const [u] = await db
		.insert(schema.users)
		.values({ username: `${label}-${++n}`, isAdmin })
		.returning()
	return u!
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-memberReexpress-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const [conn] = await db
		.insert(schema.connections)
		.values({
			name: "NAI",
			type: "novelai",
			baseUrl: "https://image.novelai.net",
			capabilities: { overrides: { "text->image": "good" } }
		} as any)
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const model = (await ensureConnectionModel(
		db,
		conn!.id,
		"nai-diffusion-5-full"
	))!
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->image", {
		connectionId: conn!.id,
		connectionModelId: model.id,
		samplingConfigId: null
	})
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("characters:expressSprite on a cast member", () => {
	test("lands in the member's set as the book owner's file; editors only", async () => {
		const owner = await user("rx-owner")
		const reader = await user("rx-reader")
		const admin = await user("rx-admin", true)
		const stranger = await user("rx-stranger")
		const [book] = await db
			.insert(schema.lorebooks)
			.values({ userId: owner.id, name: "Book" })
			.returning()
		await db
			.insert(schema.lorebookShares)
			.values({ lorebookId: book!.id, userId: reader.id })
		const { insertCastMember } = await import(
			"$lib/server/characters/versions"
		)
		const { member: m } = await insertCastMember(
			db as any,
			{
				lorebookId: book!.id,
				binding: "{{char:rx}}",
				name: "Verity"
			} as any
		)
		const member = m
		const { addSprite, addEmptySprites, ensureDefaultSpriteSet } =
			await import("$lib/server/sprites")
		const owner_ = { castMemberId: member!.id }
		const set = await ensureDefaultSpriteSet(db, owner_)
		await addEmptySprites(db, owner_, set.id, ["joy"])
		await addSprite(db, {
			userId: owner.id,
			castMemberId: member!.id,
			setId: set.id,
			label: "neutral",
			bytes: Buffer.from(picture(), "base64"),
			source: "upload"
		} as any)

		const { charactersExpressSprite } = await import(
			"$lib/server/sockets/sprites"
		)
		const { pluginEvents } = await import("$lib/server/plugins/eventHost")
		const notify = vi.spyOn(pluginEvents(), "notify")
		const emitted: [string, any][] = []

		const READ_ONLY =
			"Only someone who can edit this cast member's lorebook can change its sprites."
		for (const who of [reader, admin]) {
			await expect(
				charactersExpressSprite.handler(
					socket(who.id, !!who.isAdmin),
					{ castMemberId: member!.id, label: "joy" },
					(e: string, d: any) => emitted.push([e, d])
				)
			).rejects.toThrow(
				who === reader
					? READ_ONLY
					: /Cast member not found|can edit this cast member/
			)
		}
		expect(emitted[0]).toEqual([
			"characters:expressSprite:error",
			{ error: READ_ONLY, castMemberId: member!.id }
		])
		await expect(
			charactersExpressSprite.handler(
				socket(stranger.id),
				{ castMemberId: member!.id, label: "joy" },
				() => {}
			)
		).rejects.toThrow("Cast member not found.")

		const res = await charactersExpressSprite.handler(
			socket(owner.id),
			{ castMemberId: member!.id, setId: set.id, label: "Joy" },
			() => {}
		)
		expect(res).toMatchObject({ castMemberId: member!.id, label: "joy" })
		expect("characterId" in res).toBe(false)
		const rows = await db
			.select()
			.from(schema.sprites)
			.where(eq(schema.sprites.spriteSetId, set.id))
		const joy = rows.filter((r) => r.label === "joy")
		expect(joy).toHaveLength(1)
		expect(joy[0]!.fileId).not.toBeNull()
		const [file] = await db
			.select()
			.from(schema.files)
			.where(eq(schema.files.id, joy[0]!.fileId!))
		expect(file).toMatchObject({
			userId: owner.id,
			lorebookId: book!.id,
			characterId: null
		})
		const call = notify.mock.calls.find(
			(c) => c[1] === "core:event/sprites-attached@1"
		)!
		expect(call[2]).toMatchObject({
			castMemberId: member!.id,
			characterId: null
		})
	})
})
