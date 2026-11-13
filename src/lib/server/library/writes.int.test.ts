/**
 * 🚧 (M2c, path B) **Library writes**: a genre that declares `writes.library`
 * makes characters and lorebooks as the acting person, under their library
 * write mode — Off makes nothing and says why, Review holds a proposal, Full writes now — and
 * Back / Forward take the change back and put it again.
 *
 * ⚠ needs 0141 — `user_settings.library_write_mode` and the `library` kind in
 * `state_proposals`' CHECK. Written, not yet run: the migration lands with S.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, desc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {},
	autoEnqueueCharacter: async () => {}
}))

const db = () => testDb as unknown as Db
const LIBRARY_GENRE = "test.library:inlet/makes@1"
const PLAIN_GENRE = "test.library:inlet/plain@1"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-library-writes-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb.insert(schema.pipelineDefinitionRegistry).values([
		{
			definitionId: "test.library:inlet/makes",
			version: 1,
			kind: "inlet",
			status: "live",
			i18n: { name: { en: "Makes things" } },
			ports: {},
			sessionShape: { composer: "text", lorebook: "optional", writes: { library: { characters: true, lorebooks: true } } }
		},
		{
			definitionId: "test.library:inlet/plain",
			version: 1,
			kind: "inlet",
			status: "live",
			i18n: { name: { en: "Plain" } },
			ports: {},
			sessionShape: { composer: "text", lorebook: "optional" }
		}
	] as any)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0
/** A person, a session of `genreId` with one reply, and a host acting as the person. */
async function world(genreId = LIBRARY_GENRE, mode: "full" | "review" | "off" | null = "review") {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `library-writes-${++n}`)
	if (mode !== null) await testDb.insert(schema.userSettings).values({ userId: user.id, libraryWriteMode: mode } as any)
	const [session] = await testDb.insert(schema.sessions).values({ userId: user.id, isGroup: false, name: `Run ${n}`, genreId }).returning()
	const [legacy] = await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId: session!.id, userId: user.id, role: "assistant", content: "Serene replies." })
		.returning()
	await testDb.insert(schema.messages).values({ id: legacy!.id, sessionId: session!.id, role: "assistant" })
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const artifacts: any[] = []
	const host = createHost(db(), { sessionId: session!.id, userId: user.id, runId: `run-${n}`, artifacts } as any)
	return { user, session: session!, message: legacy!, host, artifacts }
}

const node = (op: string) => ({ key: op, definitionId: `core:outlet/${op}`, definitionVersion: 1 }) as any
const CARD = { name: "Wren", description: "A quiet courier.", first_mes: "Hello." }
const libraryRows = (sessionId: number) =>
	testDb
		.select()
		.from(schema.stateProposals)
		.where(and(eq(schema.stateProposals.sessionId, sessionId), eq(schema.stateProposals.kind, "library")))
const charactersOf = (userId: number) => testDb.select().from(schema.characters).where(eq(schema.characters.userId, userId))

describe("ruling b1': a plugin's pipeline or a plugin genre writes nothing to the library yet", () => {
	test("a run of a plugin's spec is refused in words, whatever its genre declares", async () => {
		const w = await world()
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const host = createHost(db(), { sessionId: w.session.id, userId: w.user.id, runId: `run-plugin-${n}`, artifacts: [], ownerPluginId: "fx.desk", specId: "fx.desk:spec/create-session" } as any)
		await expect(host.commit!({ card: CARD }, node("create-character"))).rejects.toThrow(/A plugin's pipeline cannot write to your library yet\./)
		expect(await charactersOf(w.user.id)).toEqual([])
		expect(await libraryRows(w.session.id)).toEqual([])
	})
	test("a session of an installed plugin's genre that declares writes.library is refused too", async () => {
		await testDb.insert(schema.plugins).values({ pluginId: "fx.desk", name: "fx.desk", version: "0.4.0", bundleSource: "// none", bundleHash: "hash-fx-desk", enabled: true, manifest: {} } as any).onConflictDoNothing()
		await testDb.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: "fx.desk:inlet/desk",
			version: 1,
			kind: "inlet",
			status: "live",
			i18n: { name: { en: "Desk" } },
			ports: {},
			sessionShape: { composer: "text", writes: { library: { characters: true } } }
		} as any).onConflictDoNothing()
		const w = await world("fx.desk:inlet/desk@1")
		await expect(w.host.commit!({ card: CARD }, node("create-character"))).rejects.toThrow(/A plugin's pipeline cannot write to your library yet\./)
		expect(await libraryRows(w.session.id)).toEqual([])
	})
})

describe("library writes (needs 0141)", () => {
	test("Off makes nothing and says why in a skipped line beside the reply (not a halt: the reply has settled)", async () => {
		const w = await world(LIBRARY_GENRE, "off")
		const r: any = await w.host.commit!({ card: CARD }, node("create-character"))
		expect(r.halt).toBeUndefined()
		expect(r.skipped).toMatch(/library write mode is Off.*Settings › User/)
		expect(await charactersOf(w.user.id)).toEqual([])
		const rows = await libraryRows(w.session.id)
		expect(rows.map((x) => x.status)).toEqual(["skipped"])
		expect((rows[0]!.payload as any).skipped).toMatch(/library write mode is Off/)
	})

	test("Review leaves a pending row; Accept makes the card, owned by the person", async () => {
		const w = await world()
		const r: any = await w.host.commit!({ card: CARD }, node("create-character"))
		expect(r.proposed).toEqual(expect.any(Number))
		expect(await charactersOf(w.user.id)).toEqual([])
		const [row] = await libraryRows(w.session.id)
		expect(row).toMatchObject({ status: "pending", messageId: w.message.id })
		const { decideProposal } = await import("$lib/server/state/write")
		expect(await decideProposal(db(), row!.id, true, w.user.id)).toMatchObject({ status: "accepted" })
		const made = await charactersOf(w.user.id)
		expect(made).toHaveLength(1)
		expect(made[0]).toMatchObject({ name: "Wren", userId: w.user.id })
		const [after] = await libraryRows(w.session.id)
		expect(after!.status).toBe("accepted")
		expect((after!.payload as any).result.characterId).toBe(made[0]!.id)
	})

	test("Reject makes nothing", async () => {
		const w = await world()
		const r: any = await w.host.commit!({ card: CARD }, node("create-character"))
		const { decideProposal } = await import("$lib/server/state/write")
		expect(await decideProposal(db(), r.proposed, false, w.user.id)).toEqual({ status: "rejected" })
		expect(await charactersOf(w.user.id)).toEqual([])
		expect((await libraryRows(w.session.id))[0]!.status).toBe("rejected")
	})

	test("Full makes it at once: an applied row and an artifact", async () => {
		const w = await world(LIBRARY_GENRE, "full")
		const r: any = await w.host.commit!({ card: CARD }, node("create-character"))
		expect(r).toMatchObject({ written: true, characterId: expect.any(Number) })
		expect(await charactersOf(w.user.id)).toHaveLength(1)
		const [row] = await libraryRows(w.session.id)
		expect(row).toMatchObject({ status: "applied", messageId: w.message.id })
		expect(w.artifacts).toContainEqual(
			expect.objectContaining({ kind: "character", entityId: r.characterId, action: "created" })
		)
	})

	test("an unset mode reads Full: the card is made at once", async () => {
		const w = await world(LIBRARY_GENRE, null)
		const r: any = await w.host.commit!({ card: CARD }, node("create-character"))
		expect(r.proposed).toBeUndefined()
		expect(r.characterId).toEqual(expect.any(Number))
		const [row] = await libraryRows(w.session.id)
		expect(row).toMatchObject({ status: "applied" })
	})

	test("Back hides the made card; Forward brings it back", async () => {
		const w = await world(LIBRARY_GENRE, "full")
		const r: any = await w.host.commit!({ card: CARD }, node("create-character"))
		const { retractStateAnchoredTo, restoreRetractedState } = await import("$lib/server/state/write")
		const back = await retractStateAnchoredTo(db(), w.message.id, "leaves")
		expect(back.changed).toBe(true)
		const [hidden] = await testDb.select().from(schema.characters).where(eq(schema.characters.id, r.characterId))
		expect(hidden!.isDeleted).toBe(true)
		expect(await libraryRows(w.session.id)).toEqual([])
		await restoreRetractedState(db(), back.taken)
		const [shown] = await testDb.select().from(schema.characters).where(eq(schema.characters.id, r.characterId))
		expect(shown!.isDeleted).toBe(false)
		expect((await libraryRows(w.session.id))[0]!.status).toBe("applied")
	})

	test("Back deletes a made lorebook and Forward re-imports it under a new id", async () => {
		const w = await world(LIBRARY_GENRE, "full")
		const lorebook = { name: "The Salt Roads", description: "Trade routes.", entries: [] }
		const r: any = await w.host.commit!({ lorebook }, node("create-lorebook"))
		expect(r.lorebookId).toEqual(expect.any(Number))
		const { retractStateAnchoredTo, restoreRetractedState } = await import("$lib/server/state/write")
		const back = await retractStateAnchoredTo(db(), w.message.id, "leaves")
		expect(await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, r.lorebookId))).toEqual([])
		expect((back.taken.proposals[0]!.payload as any).document).toBeTruthy()
		await restoreRetractedState(db(), back.taken)
		const [row] = await libraryRows(w.session.id)
		const newId = (row!.payload as any).result.lorebookId
		const [book] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, newId))
		expect(book).toMatchObject({ name: "The Salt Roads", userId: w.user.id })
	})

	test("a genre without writes.library is refused in words", async () => {
		const w = await world(PLAIN_GENRE, "full")
		await expect(w.host.commit!({ card: CARD }, node("create-character"))).rejects.toThrow(
			/genre \('Plain'\) does not make or change characters/
		)
		await expect(w.host.commit!({ lorebook: { name: "X", entries: [] } }, node("create-lorebook"))).rejects.toThrow(
			/does not make lorebooks/
		)
		expect(await charactersOf(w.user.id)).toEqual([])
	})

	test("update-character on someone else's card is refused by personMay", async () => {
		const w = await world(LIBRARY_GENRE, "full")
		const other = await world(LIBRARY_GENRE, "full")
		const [theirs] = await testDb
			.insert(schema.characters)
			.values({ userId: other.user.id, name: "Theirs", description: "Not yours." })
			.returning()
		const r: any = await w.host.commit!({ characterId: theirs!.id, changes: { name: "Mine now" } }, node("update-character"))
		expect(r.halt).toMatch(/Only the character's owner may do that/)
		const [still] = await testDb.select().from(schema.characters).where(eq(schema.characters.id, theirs!.id))
		expect(still!.name).toBe("Theirs")
		expect(await libraryRows(w.session.id)).toEqual([])
	})

	test("update-character on the person's own card changes it, and Back restores the fields", async () => {
		const w = await world(LIBRARY_GENRE, "full")
		const [mine] = await testDb
			.insert(schema.characters)
			.values({ userId: w.user.id, name: "Old", description: "Before." })
			.returning()
		await w.host.commit!({ characterId: mine!.id, changes: { name: "New", description: "After." } }, node("update-character"))
		// the version holds the change; the row's name and description are its ⏳ copies
		expect(await currentProfile(mine!.id)).toMatchObject({
			name: "New",
			description: "After."
		})
		const [changed] = await testDb
			.select()
			.from(schema.characters)
			.where(eq(schema.characters.id, mine!.id))
		expect(changed).toMatchObject({ name: "New", description: "After." })
		const { retractStateAnchoredTo } = await import("$lib/server/state/write")
		await retractStateAnchoredTo(db(), w.message.id, "leaves")
		expect(await currentProfile(mine!.id)).toMatchObject({
			name: "Old",
			description: "Before."
		})
		const [restored] = await testDb
			.select()
			.from(schema.characters)
			.where(eq(schema.characters.id, mine!.id))
		expect(restored).toMatchObject({ name: "Old", description: "Before." })
	})
})

/** The profile of a card's current (highest-numbered) version. */
async function currentProfile(cardId: number) {
	const { profileOf } = await import("$lib/shared/characters/profile")
	const [row] = await testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.cardId, cardId))
		.orderBy(desc(schema.characterVersions.number))
		.limit(1)
	return profileOf(row!)
}
const versionsOf = (cardId: number) =>
	testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.cardId, cardId))

describe("update-character writes the card's current version (cv-writers)", () => {
	const cardOf = async (userId: number) => {
		const [card] = await testDb
			.insert(schema.characters)
			.values({
				userId,
				name: "Old",
				description: "Before.",
				personality: "Calm",
				scenario: "A road.",
				firstMessage: "Hi",
				alternateGreetings: ["Hello"],
				groupOnlyGreetings: ["All"],
				exampleDialogues: ["A", "B"]
			})
			.returning()
		return card!
	}

	test("the change lands on the current version, not on the row's frozen columns, and Back restores it", async () => {
		const w = await world(LIBRARY_GENRE, "full")
		const mine = await cardOf(w.user.id)
		const greetings = [
			{ text: "Well met" },
			{ text: "Ho" },
			{ text: "Folks", groupOnly: true }
		]
		await w.host.commit!(
			{
				characterId: mine.id,
				changes: {
					personality: "Sharp",
					greetings,
					exampleDialogues: ["X"]
				}
			},
			node("update-character")
		)
		const now = await currentProfile(mine.id)
		expect(now).toMatchObject({
			personality: "Sharp",
			greetings,
			exampleDialogues: ["X"]
		})
		// no new version: the current one is written in place
		expect(await versionsOf(mine.id)).toHaveLength(1)
		// the row's content columns are frozen
		const [row] = await testDb
			.select()
			.from(schema.characters)
			.where(eq(schema.characters.id, mine.id))
		expect(row).toMatchObject({
			personality: "Calm",
			firstMessage: "Hi",
			exampleDialogues: ["A", "B"]
		})

		const { retractStateAnchoredTo, restoreRetractedState } = await import(
			"$lib/server/state/write"
		)
		const back = await retractStateAnchoredTo(db(), w.message.id, "leaves")
		expect(await currentProfile(mine.id)).toMatchObject({
			personality: "Calm",
			greetings: [
				{ text: "Hi" },
				{ text: "Hello" },
				{ text: "All", groupOnly: true }
			],
			exampleDialogues: ["A", "B"]
		})
		await restoreRetractedState(db(), back.taken)
		expect(await currentProfile(mine.id)).toMatchObject({
			personality: "Sharp",
			greetings,
			exampleDialogues: ["X"]
		})
	})

	test("a write after a newer version lands on the newer one, the older untouched", async () => {
		const w = await world(LIBRARY_GENRE, "full")
		const mine = await cardOf(w.user.id)
		const { ensureCardVersion, newCardVersion } = await import(
			"$lib/server/characters/versions"
		)
		const { profileOf } = await import("$lib/shared/characters/profile")
		const v1 = await ensureCardVersion(db(), mine.id)
		await newCardVersion(db(), mine.id, {
			...profileOf(v1!),
			description: "Second."
		})
		await w.host.commit!(
			{ characterId: mine.id, changes: { scenario: "A harbour." } },
			node("update-character")
		)
		const [first, second] = (await versionsOf(mine.id)).sort(
			(a, b) => a.number! - b.number!
		)
		expect(first).toMatchObject({ scenario: "A road." })
		expect(second).toMatchObject({
			scenario: "A harbour.",
			description: "Second."
		})
	})

	test("a stored row with first_mes and mes_example still undoes and redoes (⏳ the old names map)", async () => {
		const w = await world(LIBRARY_GENRE, "full")
		const mine = await cardOf(w.user.id)
		const { fileLibraryChange, undoLibraryChange, redoLibraryChange } =
			await import("$lib/server/library/writes")
		const { ensureCardVersion, updateCardVersion } = await import(
			"$lib/server/characters/versions"
		)
		const v1 = await ensureCardVersion(db(), mine.id)
		// what the old writer left: the new text on the card, the old on the row
		await updateCardVersion(db(), v1!.id, {
			greetings: [
				{ text: "Brand new" },
				{ text: "Hello" },
				{ text: "All", groupOnly: true }
			],
			exampleDialogues: ["N1", "N2", "N3"]
		})
		await fileLibraryChange(
			db(),
			{ sessionId: w.session.id, updatedBy: "run:old" },
			{
				kind: "library",
				op: "update-character",
				input: {
					characterId: mine.id,
					changes: {
						first_mes: "Brand new",
						mes_example: "N1<START>N2<START>N3"
					}
				},
				by: w.user.id,
				label: "Old",
				result: { characterId: mine.id },
				before: {
					fields: { first_mes: "Hi", mes_example: "A<START>B" }
				}
			},
			"applied"
		)
		const [row] = await libraryRows(w.session.id)
		await undoLibraryChange(db(), row!)
		expect(await currentProfile(mine.id)).toMatchObject({
			greetings: [
				{ text: "Hi" },
				{ text: "Hello" },
				{ text: "All", groupOnly: true }
			],
			exampleDialogues: ["A", "B"]
		})
		await redoLibraryChange(db(), row!)
		expect(await currentProfile(mine.id)).toMatchObject({
			greetings: [
				{ text: "Brand new" },
				{ text: "Hello" },
				{ text: "All", groupOnly: true }
			],
			exampleDialogues: ["N1", "N2", "N3"]
		})
	})

	test("an opener from a stored row is put first when the card has none", async () => {
		const { greetingsWithOpener } = await import(
			"$lib/server/characters/cardIO"
		)
		expect(
			greetingsWithOpener([{ text: "G", groupOnly: true }], "Hi")
		).toEqual([{ text: "Hi" }, { text: "G", groupOnly: true }])
		expect(
			greetingsWithOpener([{ text: "Hi" }, { text: "Yo" }], null)
		).toEqual([{ text: "Yo" }])
		expect(
			greetingsWithOpener([{ text: "Hi" }, { text: "Yo" }], "Hey")
		).toEqual([{ text: "Hey" }, { text: "Yo" }])
	})

	test("a new request with the old names is refused: first_mes and mes_example are not fields", async () => {
		const w = await world(LIBRARY_GENRE, "full")
		const mine = await cardOf(w.user.id)
		const r1: any = await w.host.commit!(
			{ characterId: mine.id, changes: { first_mes: "x" } },
			node("update-character")
		)
		expect(r1.halt).toMatch(
			/'first_mes' is not a field that can be changed on a character here\./
		)
		const r2: any = await w.host.commit!(
			{ characterId: mine.id, changes: { mes_example: "x" } },
			node("update-character")
		)
		expect(r2.halt).toMatch(/'mes_example' is not a field/)
		expect(await versionsOf(mine.id)).toEqual([])
		expect(await libraryRows(w.session.id)).toEqual([])
	})

	test("greetings and exampleDialogues are judged by their kinds", async () => {
		const w = await world(LIBRARY_GENRE, "full")
		const mine = await cardOf(w.user.id)
		const refusal = async (changes: unknown) =>
			(
				(await w.host.commit!(
					{ characterId: mine.id, changes },
					node("update-character")
				)) as any
			).halt
		expect(await refusal({ greetings: "Hi" })).toMatch(
			/'greetings' is a list of greetings, each with its text\./
		)
		expect(await refusal({ greetings: [{ groupOnly: true }] })).toMatch(
			/'greetings' is a list of greetings/
		)
		expect(await refusal({ exampleDialogues: "A<START>B" })).toMatch(
			/'exampleDialogues' is a list of text\./
		)
		expect(await refusal({ exampleDialogues: [1] })).toMatch(
			/'exampleDialogues' is a list of text\./
		)
		expect(await refusal({ description: 4 })).toMatch(
			/'description' is text\./
		)
		expect(await refusal({ name: "  " })).toMatch(
			/A character needs a name\./
		)
		expect(await libraryRows(w.session.id)).toEqual([])
	})
})
