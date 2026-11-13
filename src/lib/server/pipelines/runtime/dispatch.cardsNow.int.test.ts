/**
 * 🚧 The adapter's session reads each seat's card as its current card version
 * has it (`cardsNow`), never from the `characters` row's content columns
 * (cv-sweep w3; owner ruling 2026-11-05: "Everything in session is cast ->
 * active card"). The stale text is written straight into the row to prove it
 * is not read. Its book's bindings carry no frozen column and no `character`.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	cardProfileOf,
	insertCastMember,
	newCardVersion
} from "$lib/server/characters/versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-dispatch-cardsnow-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const db = () => testDb as unknown as Db

/** A card whose current version says one thing and whose row says another. */
async function staleCard(userId: number, isPersona: boolean) {
	const k = ++n
	const [row] = await testDb
		.insert(schema.characters)
		.values({
			userId,
			name: `Old name ${k}`,
			description: "Old description.",
			isPersona
		} as any)
		.returning()
	await newCardVersion(db(), row!.id, {
		...cardProfileOf(row as any),
		name: `Fresh name ${k}`,
		description: "Fresh description."
	})
	await testDb
		.update(schema.characters)
		.set({
			name: `Stale name ${k}`,
			description: "Stale description."
		} as any)
		.where(eq(schema.characters.id, row!.id))
	return { id: row!.id, fresh: `Fresh name ${k}` }
}

describe("loadAdapterSession: cards as their current card version has them", () => {
	test("a seat with no cast member reads the new version; bindings carry no frozen column and no card", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
		const owner = await createTestUser(testDb, `adapter-session-${++n}`)
		const char = await staleCard(owner.id, false)
		const persona = await staleCard(owner.id, true)
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: owner.id,
				isGroup: false,
				name: `Run ${++n}`
			} as any)
			.returning()
		const book = await insertOwnBook(db(), {
			sessionId: s!.id,
			userId: owner.id,
			name: null,
			overlayOf: null,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
		await testDb
			.update(schema.sessions)
			.set({ lorebookId: book.id })
			.where(eq(schema.sessions.id, s!.id))
		await insertCastMember(db(), {
			lorebookId: book.id,
			characterId: char.id,
			binding: `{{char:${++n}}}`,
			name: "member"
		} as any)
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s!.id,
			characterId: char.id,
			castMemberId: null,
			position: 0
		} as any)
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s!.id,
			personaId: persona.id,
			position: 0
		} as any)

		const { loadAdapterSession } = await import(
			"$lib/server/pipelines/runtime/dispatch"
		)
		const session = await loadAdapterSession(db(), s!.id)

		const c = session.sessionCharacters[0].character
		expect(c.name).toBe(char.fresh)
		expect(c.description).toBe("Fresh description.")
		expect(session.sessionPersonas[0].persona.name).toBe(persona.fresh)
		const bindings = session.lorebook.lorebookBindings
		expect(bindings.length).toBeGreaterThan(0)
		for (const b of bindings) {
			for (const col of [
				"description",
				"personality",
				"scenario",
				"firstMessage",
				"alternateGreetings",
				"exampleDialogues",
				"faceMediaId",
				"retold",
				"ownName",
				"ownNickname",
				"timbre",
				"spriteSet",
				"nodeState",
				"nodeVisibility",
				"character"
			])
				expect(b).not.toHaveProperty(col)
		}
	})
})
