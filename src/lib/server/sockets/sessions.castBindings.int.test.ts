/**
 * The cast arrives from the session on its own (ruling 2026-09-12).
 *
 * "Pull the cast from this session" was a button, and a button is a thing a
 * person can press twice: it emitted one `lorebooks:createBinding` per member
 * with no existence check, and the handler inserted bare. So the book that read
 * a session ended up holding each of its people once per press, with lore split
 * across the copies. The button is gone, and its job belongs to the events that
 * already exist.
 *
 * Every path that puts a lorebook and a session together, or adds a member to a
 * session that already reads one, is exercised here — creating with a book,
 * attaching one afterwards, adding a member afterwards — because the rule is
 * "on its own", and a rule that holds on only one of the three ways in is not
 * that rule. Removal is here too, asserting the opposite: a binding OUTLIVES
 * the membership that created it, because lore, relationships and scene
 * appearances may be anchored to it.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

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
		path.join(os.tmpdir(), "serene-pub-vitest-cast-bindings-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) =>
	({
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

const noEmit = () => {}

let seq = 0
const uniq = (label: string) => `${label}-${++seq}`

async function makeUser() {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: uniq("cast-binding-user") })
		.returning()
	return user!
}

async function makeLorebook(userId: number) {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: uniq("Book") })
		.returning()
	return lorebook!
}

async function makeCharacter(userId: number, name = uniq("Maren")) {
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "" })
		.returning()
	return character!
}

async function makePersona(userId: number, name = uniq("Reader")) {
	const [persona] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "", isPersona: true })
		.returning()
	return persona!
}

async function bindingsOf(lorebookId: number) {
	return testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
}

async function bindingsFor(lorebookId: number, characterId: number) {
	return testDb
		.select()
		.from(schema.lorebookBindings)
		.where(
			and(
				eq(schema.lorebookBindings.lorebookId, lorebookId),
				eq(schema.lorebookBindings.characterId, characterId)
			)
		)
}

describe("a session's cast reaches its lorebook without being asked", () => {
	test("creating a session with a lorebook binds its characters and personas", async () => {
		const { sessionsCreateHandler } = await import("./sessions")
		const user = await makeUser()
		const lorebook = await makeLorebook(user.id)
		const character = await makeCharacter(user.id)
		const persona = await makePersona(user.id)

		await sessionsCreateHandler.handler(
			fakeSocket(user.id),
			{
				session: { name: "First night", lorebookId: lorebook.id },
				characterIds: [character.id],
				personaIds: [persona.id]
			} as any,
			noEmit
		)

		const bindings = await bindingsOf(lorebook.id)
		// A bound persona is a bound character now (0133) — both land on
		// `characterId`, so there's no separate `personaId` column to check.
		expect(
			bindings
				.map((b) => b.characterId)
				.filter(Boolean)
				.sort()
		).toEqual([character.id, persona.id].sort())
		// The name is the bound entity's, pulled through by the attach-time
		// sync — a binding showing its raw {{char:N}} token is one nothing
		// synced.
		const bound = bindings.find((b) => b.characterId === character.id)!
		expect(bound.name).toBe(character.name)
	}, 60_000)

	test("attaching a lorebook afterwards binds the members already there", async () => {
		const { sessionsCreateHandler } = await import("./sessions")
		const { sessionsSetLorebookHandler } = await import("./summarize")
		const user = await makeUser()
		const lorebook = await makeLorebook(user.id)
		const character = await makeCharacter(user.id)
		const persona = await makePersona(user.id)

		const created = await sessionsCreateHandler.handler(
			fakeSocket(user.id),
			{
				session: { name: "No book yet" },
				characterIds: [character.id],
				personaIds: [persona.id]
			} as any,
			noEmit
		)
		expect(await bindingsOf(lorebook.id)).toHaveLength(0)

		await sessionsSetLorebookHandler.handler(
			fakeSocket(user.id),
			{ sessionId: created.session!.id, lorebookId: lorebook.id } as any,
			noEmit
		)

		const bindings = await bindingsOf(lorebook.id)
		// A bound persona is a bound character now (0133) — both land on
		// `characterId`, so there's no separate `personaId` column to check.
		expect(
			bindings
				.map((b) => b.characterId)
				.filter(Boolean)
				.sort()
		).toEqual([character.id, persona.id].sort())
	}, 60_000)

	test("a member added after the book is attached is bound too", async () => {
		const { sessionsCreateHandler, sessionsUpdateHandler } = await import(
			"./sessions"
		)
		const user = await makeUser()
		const lorebook = await makeLorebook(user.id)
		const first = await makeCharacter(user.id)
		const late = await makeCharacter(user.id)

		const created = await sessionsCreateHandler.handler(
			fakeSocket(user.id),
			{
				session: { name: "The long road", lorebookId: lorebook.id },
				characterIds: [first.id]
			} as any,
			noEmit
		)
		expect(await bindingsOf(lorebook.id)).toHaveLength(1)

		await sessionsUpdateHandler.handler(
			fakeSocket(user.id),
			{
				session: { id: created.session!.id },
				characterIds: [first.id, late.id]
			} as any,
			noEmit
		)

		const bindings = await bindingsOf(lorebook.id)
		expect(
			bindings
				.map((b) => b.characterId)
				.filter(Boolean)
				.sort()
		).toEqual([first.id, late.id].sort())
	}, 60_000)

	test("a persona added through sessions:addPersona is bound too", async () => {
		const { sessionsCreateHandler, sessionsAddPersonaHandler } =
			await import("./sessions")
		const user = await makeUser()
		const lorebook = await makeLorebook(user.id)
		const persona = await makePersona(user.id)

		const created = await sessionsCreateHandler.handler(
			fakeSocket(user.id),
			{
				session: { name: "Late arrival", lorebookId: lorebook.id }
			} as any,
			noEmit
		)
		expect(await bindingsOf(lorebook.id)).toHaveLength(0)

		await sessionsAddPersonaHandler.handler(
			fakeSocket(user.id),
			{ sessionId: created.session!.id, personaId: persona.id } as any,
			noEmit
		)

		const bindings = await bindingsOf(lorebook.id)
		// A bound persona is a bound character now (0133) — it lands on
		// `characterId`, not a separate `personaId` column.
		expect(bindings.map((b) => b.characterId).filter(Boolean)).toEqual([
			persona.id
		])
	}, 60_000)

	test("removing a member keeps the binding — lore may be anchored to it", async () => {
		const { sessionsCreateHandler, sessionsUpdateHandler } = await import(
			"./sessions"
		)
		const user = await makeUser()
		const lorebook = await makeLorebook(user.id)
		const character = await makeCharacter(user.id)

		const created = await sessionsCreateHandler.handler(
			fakeSocket(user.id),
			{
				session: { name: "Then gone", lorebookId: lorebook.id },
				characterIds: [character.id]
			} as any,
			noEmit
		)
		const [bound] = await bindingsFor(lorebook.id, character.id)
		expect(bound).toBeTruthy()

		await sessionsUpdateHandler.handler(
			fakeSocket(user.id),
			{ session: { id: created.session!.id }, characterIds: [] } as any,
			noEmit
		)

		const after = await bindingsFor(lorebook.id, character.id)
		expect(after.map((b) => b.id)).toEqual([bound.id])
	}, 60_000)

	test("attaching the same book twice binds each member once", async () => {
		const { sessionsCreateHandler } = await import("./sessions")
		const { sessionsSetLorebookHandler } = await import("./summarize")
		const user = await makeUser()
		const lorebook = await makeLorebook(user.id)
		const character = await makeCharacter(user.id)

		const created = await sessionsCreateHandler.handler(
			fakeSocket(user.id),
			{
				session: { name: "Twice over", lorebookId: lorebook.id },
				characterIds: [character.id]
			} as any,
			noEmit
		)
		await sessionsSetLorebookHandler.handler(
			fakeSocket(user.id),
			{ sessionId: created.session!.id, lorebookId: lorebook.id } as any,
			noEmit
		)

		expect(await bindingsFor(lorebook.id, character.id)).toHaveLength(1)
	}, 60_000)
})

describe("lorebooks:createBinding is a resolve, not an insert", () => {
	test("a second create for the same character answers with the first row", async () => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		const user = await makeUser()
		const lorebook = await makeLorebook(user.id)
		const character = await makeCharacter(user.id)

		const first = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebook.id,
					characterId: character.id,
					binding: ""
				}
			} as any,
			noEmit
		)
		const second = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebook.id,
					characterId: character.id,
					binding: ""
				}
			} as any,
			noEmit
		)

		expect(first.existing).toBe(false)
		expect(second.existing).toBe(true)
		expect(second.lorebookBinding.id).toBe(first.lorebookBinding.id)
		expect(await bindingsFor(lorebook.id, character.id)).toHaveLength(1)
	}, 60_000)

	test("a second create for the same persona answers with the first row", async () => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		const user = await makeUser()
		const lorebook = await makeLorebook(user.id)
		const persona = await makePersona(user.id)

		const params = {
			lorebookBinding: {
				lorebookId: lorebook.id,
				characterId: persona.id,
				binding: ""
			}
		} as any
		const first = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			params,
			noEmit
		)
		const second = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			params,
			noEmit
		)

		expect(second.existing).toBe(true)
		expect(second.lorebookBinding.id).toBe(first.lorebookBinding.id)
		expect(await bindingsOf(lorebook.id)).toHaveLength(1)
	}, 60_000)

	test("background rows are still minted each time — they are named, not bound", async () => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		const user = await makeUser()
		const lorebook = await makeLorebook(user.id)

		const first = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebook.id,
					characterId: null,
					binding: "",
					name: "A voice in the hall"
				}
			} as any,
			noEmit
		)
		const second = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebook.id,
					characterId: null,
					binding: "",
					name: "Another voice"
				}
			} as any,
			noEmit
		)

		expect(first.existing).toBe(false)
		expect(second.existing).toBe(false)
		expect(second.lorebookBinding.id).not.toBe(first.lorebookBinding.id)
		expect(await bindingsOf(lorebook.id)).toHaveLength(2)
	}, 60_000)
})
