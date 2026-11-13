/**
 * `lorebooks:bindingsForCharacter` — the `memberName` each row carries is the
 * name the member is shown by in its book (`memberShownName`): its own name or
 * nickname over the card's, never the binding's synced `name` copy.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-memberName-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const uniq = (label: string) => `${label}-${++n}`

async function setup(
	cardValues: Partial<typeof schema.characters.$inferInsert>,
	memberValues: Partial<typeof schema.lorebookBindings.$inferInsert>
) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, uniq("member-name"))
	const [card] = await testDb
		.insert(schema.characters)
		.values({
			userId: user.id,
			name: "Maren",
			description: "Maren card description.",
			...cardValues
		})
		.returning()
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: uniq("Book") })
		.returning()
	const [binding] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook!.id,
			binding: uniq("{{char:x}}"),
			characterId: card!.id,
			name: "",
			...memberValues
		})
		.returning()
	return { user, card: card!, binding: binding! }
}

async function memberNameOf(
	userId: number,
	characterId: number,
	castId: number
): Promise<string> {
	const { lorebookBindingsForCharacterHandler } = await import(
		"$lib/server/sockets/lorebooks"
	)
	const socket = {
		id: `s-${userId}`,
		user: { id: userId, isAdmin: false }
	} as never
	const res = await (lorebookBindingsForCharacterHandler as any).handler(
		socket,
		{ characterId },
		async () => {}
	)
	return res.members.find((m: any) => m.castId === castId).memberName
}

describe("lorebooks:bindingsForCharacter memberName", () => {
	test("a member's own name shows, and its own nickname wins over it", async () => {
		const named = await setup(
			{},
			{ name: "Maren (synced)", ownName: "Marenne" }
		)
		expect(
			await memberNameOf(named.user.id, named.card.id, named.binding.id)
		).toBe("Marenne")

		const nicknamed = await setup(
			{},
			{ ownName: "Marenne", ownNickname: "Mari" }
		)
		expect(
			await memberNameOf(
				nicknamed.user.id,
				nicknamed.card.id,
				nicknamed.binding.id
			)
		).toBe("Mari")
	})

	test("a blank synced name falls back to the card's shown name", async () => {
		const byName = await setup({}, { name: "" })
		expect(
			await memberNameOf(
				byName.user.id,
				byName.card.id,
				byName.binding.id
			)
		).toBe("Maren")

		const byNickname = await setup({ nickname: "Mare" }, { name: "" })
		expect(
			await memberNameOf(
				byNickname.user.id,
				byNickname.card.id,
				byNickname.binding.id
			)
		).toBe("Mare")
	})
})
