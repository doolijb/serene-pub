/**
 * CHARX export → import keeps a character's sprites: its sets, labels and
 * variants (DESIGN-sprites §4).
 */
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { unzipSync, strFromU8 } from "fflate"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-sprites-charx-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

function png(seed: number): Buffer {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(0)
	img.data[0] = seed % 256
	img.data[1] = Math.floor(seed / 256) % 256
	img.data[3] = 255
	return PNG.sync.write(img)
}

const socket = (userId: number) => ({ user: { id: userId } }) as any
const shape = (sets: { name: string; isDefault: boolean; sprites: { label: string; position: number }[] }[]) =>
	sets.map((s) => ({
		name: s.name,
		isDefault: s.isDefault,
		sprites: s.sprites.map((p) => `${p.label}#${p.position}`).sort()
	}))

test("a CHARX round-trips sets, labels and variants", async () => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { importSprites, listSpriteSets, renameSpriteSet } = await import("$lib/server/sprites")
	const { charactersExportCard, charactersImportCard } = await import(
		"$lib/server/sockets/characters"
	)
	const user = await createTestUser(testDb, "sprites-charx-roundtrip")
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Verity", description: "A knight" })
		.returning()
	await importSprites(
		testDb as any,
		user.id,
		character.id,
		[
			{ label: "joy", bytes: png(1) },
			{ label: "joy", bytes: png(2) },
			{ label: "neutral", bytes: png(3) },
			{ set: "armour", label: "stern", bytes: png(4) }
		],
		"upload"
	)
	// A default set that is not called "default" must come back as the default.
	const before = await listSpriteSets(testDb as any, character.id)
	await renameSpriteSet(testDb as any, character.id, before[0].id, "everyday")

	const exported = await charactersExportCard.handler(
		socket(user.id),
		{ id: character.id, format: "charx" },
		() => {}
	)
	expect(exported.filename).toBe("verity.charx")
	const zip = unzipSync(new Uint8Array(exported.blob))
	const card = JSON.parse(strFromU8(zip["card.json"]))
	const types = card.data.assets.map((a: any) => `${a.type}:${a.name}`).sort()
	expect(types).toEqual([
		"emotion:joy",
		"emotion:neutral",
		"x_sp_sprite:armour/stern",
		"x_sp_sprite:everyday/joy"
	])
	expect(card.data.extensions.serenepub.defaultSpriteSet).toBe("everyday")

	const importer = await createTestUser(testDb, "sprites-charx-importer")
	const imported = await charactersImportCard.handler(
		socket(importer.id),
		{ file: Buffer.from(exported.blob).toString("base64") },
		() => {}
	)
	expect(imported.status).toBe("created")
	expect(imported.warnings).toBeUndefined()
	const after = await listSpriteSets(testDb as any, imported.character!.id)
	expect(shape(after)).toEqual(shape(await listSpriteSets(testDb as any, character.id)))
}, 120_000)
