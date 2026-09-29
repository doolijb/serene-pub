/**
 * `lorebooks:import` of a **Serene Pub 0.5.x export** (owner ruling
 * 2026-09-28: import reads 0.5 files), plus the import/overwrite fixes that
 * ride with it.
 *
 * The fixture (`fixtures/lorebook-0.5.3-export.json`) is written in the exact
 * shape v0.5.3's `lorebookExportBuilder` / `lorebookExportMapper` produced:
 * world lore with a category and a bare-key regex entry, character lore bound
 * by `bindingLocalId`, dated history with a nested scene, an embedded
 * character card, a SEPARATE `personas` list referenced by `personaLocalId`
 * (0.5 had a persona table; personas are characters with `is_persona` now), a
 * background member, a member whose card was not embedded, and a narrative
 * graph with flat `fromLocalId`/`toLocalId` edges.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	loadBookEntries
} from "$lib/server/utils/lorebookEntries"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-lb-import05-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const FIXTURE = JSON.parse(
	readFileSync(
		path.join(
			path.dirname(fileURLToPath(import.meta.url)),
			"fixtures/lorebook-0.5.3-export.json"
		),
		"utf-8"
	)
)
/** A fresh deep copy, so no test sees another's mutation. */
const fixture = () => JSON.parse(JSON.stringify(FIXTURE))

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}
const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

async function importFile(userId: number, lorebookData: object) {
	const { lorebookImportHandler } = await import("./lorebooks")
	return lorebookImportHandler.handler(
		fakeSocket(userId),
		{ lorebookData },
		noopEmit
	)
}

describe("importing a Serene Pub 0.5.3 export (PGlite integration)", () => {
	test("maps the whole 0.5 file into today's model", async () => {
		const user = await makeUser("import05-user")
		const res = await importFile(user.id, fixture())
		expect(res.status).toBe("created")
		const bookId = res.lorebook!.id

		const book = await testDb.query.lorebooks.findFirst({
			where: (l, { eq }) => eq(l.id, bookId)
		})
		expect(book!.name).toBe("Emberfall")
		expect(book!.uuid).toBe(FIXTURE.extensions.serenepub.uuid)
		expect(book!.extraJson).toEqual({
			scanDepth: 5,
			tokenBudget: 800,
			recursiveScanning: false
		})
		// Tokens travel verbatim and the counter is past all of them.
		expect(book!.nextBindingNumber).toBe(5)

		// ── Cast: an embedded card, a persona (now a character with
		// is_persona), a background member, and a member whose card the file
		// did not carry.
		const bindings = await testDb.query.lorebookBindings.findMany({
			where: (b, { eq }) => eq(b.lorebookId, bookId),
			with: { character: true }
		})
		const byToken = new Map(bindings.map((b) => [b.binding, b]))
		expect([...byToken.keys()].sort()).toEqual([
			"{{char:1}}",
			"{{char:2}}",
			"{{char:3}}",
			"{{char:4}}"
		])
		const maren = byToken.get("{{char:1}}")!
		expect(maren.character?.name).toBe("Maren")
		expect(maren.character?.isPersona).toBe(false)
		expect(maren.character?.userId).toBe(user.id)
		expect(maren.name).toBe("Maren")

		const traveller = byToken.get("{{char:2}}")!
		expect(traveller.character?.name).toBe("Traveller")
		expect(traveller.character?.isPersona).toBe(true)
		expect(traveller.character?.aliases).toEqual(["the wanderer"])

		const innkeeper = byToken.get("{{char:3}}")!
		expect(innkeeper.characterId).toBeNull()
		expect(innkeeper.name).toBe("The innkeeper")
		expect(innkeeper.aliases).toEqual(["barkeep"])
		expect(innkeeper.absorbedAliases).toEqual(["old Tam"])

		const stranger = byToken.get("{{char:4}}")!
		expect(stranger.characterId).toBeNull()
		expect(stranger.nodeState).toBe("dormant")
		// 2-level alias structure from parentLocalId.
		expect(stranger.parentNodeId).toBe(maren.id)

		// ── Entries.
		const entries = await loadBookEntries(testDb, bookId)
		const byName = new Map(entries.map((e) => [e.name, e as any]))
		const world = byName.get("Emberfall")
		expect(world.typeId).toBe(WORLD_LORE_TYPE_ID)
		expect(world.category).toBe("place")
		expect(world.priority).toBe(2)
		expect(world.extraJson).toEqual({ position: 0, depth: 4 })

		// A 0.5 regex entry: bare keys + an honest use_regex.
		const dragon = byName.get("The dragon")
		expect(dragon.useRegex).toBe(true)
		const [dragonRow] = await testDb
			.select({ keys: schema.lorebookEntries.keys })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, dragon.id))
		expect(dragonRow.keys).toEqual(["dragon(s)?", "wyrm"])

		// Character lore, privacy-bound by bindingLocalId.
		const lore = entries.filter((e) => e.typeId === CHARACTER_LORE_TYPE_ID)
		expect(lore).toHaveLength(4)
		expect(byName.get("Maren's secret").lorebookBindingId).toBe(maren.id)
		expect(byName.get("Traveller's past").lorebookBindingId).toBe(
			traveller.id
		)
		expect(byName.get("Traveller's past").caseSensitive).toBe(true)
		expect(byName.get("Innkeeper's habit").lorebookBindingId).toBe(
			innkeeper.id
		)
		expect(byName.get("Innkeeper's habit").enabled).toBe(false)
		expect(byName.get("Unbound rumour").lorebookBindingId).toBeNull()
		expect(byName.get("Unbound rumour").constant).toBe(true)

		// History with its date and flags.
		const history = entries
			.filter((e) => e.typeId === HISTORY_TYPE_ID)
			.map((e: any) => e)
			.sort((a, b) => a.year - b.year)
		expect(history).toHaveLength(2)
		expect(history[0]).toMatchObject({
			year: 1203,
			month: 4,
			day: 12,
			isCompleted: true,
			graphed: true
		})
		expect(history[1]).toMatchObject({ year: 1204, month: null })

		// ── The scene and its cast.
		const scenes = await testDb.query.scenes.findMany({
			where: (s, { eq }) => eq(s.lorebookId, bookId),
			with: { characters: true }
		})
		expect(scenes).toHaveLength(1)
		expect(scenes[0].historyEntryId).toBe(history[0].id)
		expect(scenes[0].name).toBe("The new hearth")
		const cast = scenes[0].characters
			.map((c: any) => `${c.role}:${c.bindingId}`)
			.sort()
		expect(cast).toEqual(
			[
				`participant:${maren.id}`,
				`participant:${innkeeper.id}`,
				`mentioned:${traveller.id}`
			].sort()
		)
		// The graph node's history/scene anchor.
		expect(innkeeper.historyEntryId).toBe(history[0].id)
		expect(innkeeper.sceneId).toBe(scenes[0].id)

		// ── Graph links: flat 0.5 endpoints land as typed CAST endpoints.
		const links = await testDb.query.narrativeRelationships.findMany({
			where: (r, { eq }) => eq(r.lorebookId, bookId)
		})
		expect(links).toHaveLength(2)
		const ally = links.find((l) => l.relationshipType === "ally")!
		expect(ally).toMatchObject({
			fromNodeId: maren.id,
			toNodeId: traveller.id,
			fromEntryId: null,
			toEntryId: null
		})
		const owes = links.find((l) => l.relationshipType === "owes")!
		expect(owes).toMatchObject({
			fromNodeId: innkeeper.id,
			toNodeId: maren.id,
			visibility: "secret",
			reason: "the hearth",
			historyEntryId: history[0].id,
			sceneId: scenes[0].id
		})
	}, 60_000)

	test("the next cast member after a 0.5 import takes the next free token", async () => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		const user = await makeUser("import05-token-user")
		const res = await importFile(user.id, fixture())
		const { lorebookBinding } = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: { lorebookId: res.lorebook!.id, name: "New" }
			} as any,
			noopEmit
		)
		expect(lorebookBinding.binding).toBe("{{char:5}}")
	}, 60_000)

	test("a binding with no token of its own gets a fresh one, not {{char:1}}", async () => {
		const user = await makeUser("import05-notoken-user")
		const file = fixture()
		delete file.extensions.serenepub.uuid
		file.extensions.serenepub.bindings[2].bindingText = ""
		const res = await importFile(user.id, file)
		const tokens = (
			await testDb.query.lorebookBindings.findMany({
				where: (b, { eq }) => eq(b.lorebookId, res.lorebook!.id)
			})
		)
			.map((b) => b.binding)
			.sort()
		expect(new Set(tokens).size).toBe(4)
		expect(tokens).toContain("{{char:5}}")
	}, 60_000)
})

describe("SillyTavern native World Info through lorebooks:import", () => {
	test("honours native `disable` and `caseSensitive`, and keeps a regex quantifier whole", async () => {
		const user = await makeUser("import-native-user")
		const res = await importFile(user.id, {
			name: "Native",
			entries: {
				"0": {
					uid: 0,
					key: ["gate"],
					keysecondary: [],
					comment: "Disabled gate",
					content: "The gate is shut.",
					disable: true,
					caseSensitive: true
				},
				"1": {
					uid: 1,
					key: ["/(ab){1,2}/i"],
					keysecondary: [],
					comment: "Regex",
					content: "Quantified.",
					disable: false
				}
			}
		})
		expect(res.status).toBe("created")
		const rows = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, res.lorebook!.id))
		const gate = rows.find((r) => r.title === "Disabled gate")!
		expect(gate.enabled).toBe(false)
		expect(gate.caseSensitive).toBe(true)
		const regex = rows.find((r) => r.title === "Regex")!
		expect(regex.useRegex).toBe(true)
		expect(regex.keys).toEqual(["(ab){1,2}"])
	}, 60_000)
})

describe("overwrite import", () => {
	test("reports what Overwrite would delete, then deletes the book's branches", async () => {
		const { lorebookImportResolveHandler } = await import("./lorebooks")
		const user = await makeUser("overwrite-losses-user")
		const first = await importFile(user.id, fixture())
		const bookId = first.lorebook!.id
		const [entry] = await testDb
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, bookId))
			.limit(1)
		const [member] = await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, bookId))
			.limit(1)
		const [branch] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: bookId, name: "What if" })
			.returning()
		await testDb.insert(schema.entryAmendments).values({
			lorebookId: bookId,
			entryId: entry.id,
			year: 1205,
			fields: { content: "Later." }
		})
		await testDb.insert(schema.castPresences).values({
			lorebookId: bookId,
			lorebookBindingId: member.id,
			personalPosition: 1,
			fromYear: 1203
		})

		// The same uuid, different content → a conflict carrying the counts.
		const changed = fixture()
		changed.description = "Changed."
		const conflict = await importFile(user.id, changed)
		expect(conflict.status).toBe("conflict")
		expect(conflict.conflict!.losses).toEqual({
			amendments: 1,
			presences: 1,
			branches: 1,
			sceneLinks: 0
		})

		await lorebookImportResolveHandler.handler(
			fakeSocket(user.id),
			{
				action: "overwrite",
				lorebookData: changed,
				existingId: bookId
			},
			noopEmit
		)
		const branches = await testDb
			.select()
			.from(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.lorebookId, bookId))
		expect(branches).toHaveLength(0)
		expect(branch.id).toBeGreaterThan(0)
	}, 60_000)

	test("an overwrite takes the file's story time, so a re-import then reads as unchanged", async () => {
		const { lorebookImportResolveHandler } = await import("./lorebooks")
		const { buildLorebookExportData } = await import(
			"$lib/server/utils/lorebookExportBuilder"
		)
		const user = await makeUser("overwrite-storytime-user")
		const created = await importFile(user.id, {
			...fixture(),
			extensions: {
				serenepub: {
					...fixture().extensions.serenepub,
					storyTime: {
						calendar: null,
						clock: { year: 1203, month: 4, day: 12 }
					}
				}
			}
		})
		const bookId = created.lorebook!.id
		const { specBookWithGraph: file } = await buildLorebookExportData(
			bookId,
			user.id
		)

		// The book's clock moves on; the file still says 1203.
		await testDb
			.update(schema.lorebooks)
			.set({ storyClockYear: 1210 })
			.where(eq(schema.lorebooks.id, bookId))
		const conflict = await importFile(user.id, file)
		expect(conflict.status).toBe("conflict")

		await lorebookImportResolveHandler.handler(
			fakeSocket(user.id),
			{ action: "overwrite", lorebookData: file, existingId: bookId },
			noopEmit
		)
		const book = await testDb.query.lorebooks.findFirst({
			where: (l, { eq }) => eq(l.id, bookId)
		})
		expect(book!.storyClockYear).toBe(1203)
		expect((await importFile(user.id, file)).status).toBe("unchanged")
	}, 60_000)
})
