/**
 * 🚧 `images:drawingSheet` with `{ castMemberId }` (ruling ★7, 2026-11-08):
 * whoever can edit the member's lorebook hears `expressions`, echoing the
 * member; anyone else is offered nothing. Only an admin sees the sheet.
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

describe("images:drawingSheet on a cast member", () => {
	test("an editor hears expressions with the member echoed; others are offered nothing", async () => {
		const owner = await user("ds-owner")
		const reader = await user("ds-reader")
		const stranger = await user("ds-stranger")
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
		const { member } = await insertCastMember(
			db as any,
			{
				lorebookId: book!.id,
				binding: "{{char:ds}}",
				name: "Verity"
			} as any
		)
		const { imagesDrawingSheet } = await import(
			"$lib/server/sockets/images"
		)
		const ask = (who: { id: number; isAdmin?: boolean }) =>
			imagesDrawingSheet.handler(
				socket(who.id, !!who.isAdmin),
				{ castMemberId: member!.id },
				() => {}
			) as Promise<any>

		const mine = await ask(owner)
		expect(mine).toMatchObject({
			castMemberId: member!.id,
			expressions: true,
			sheet: null,
			drops: []
		})
		for (const who of [reader, stranger]) {
			expect(await ask(who)).toEqual({
				sheet: null,
				drops: [],
				castMemberId: member!.id,
				expressions: false
			})
		}
	})
})
