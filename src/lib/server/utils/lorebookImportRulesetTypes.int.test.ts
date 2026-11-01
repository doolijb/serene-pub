/**
 * 🚧 (M2c) A lorebook file whose entries use a ruleset's own entry types:
 * the importer restores them under the full type id when the registry declares
 * it, coerces their fields by that declaration, and what lands is readable by
 * `core:query/cast-presences@1` (`placementsAt`). An id nothing declares still
 * imports as world lore.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { defineRuleset } from "@serene-pub/sdk"
import { deriveEntryTypes } from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import { entryTypeIdOf, mapImportedEntry } from "./lorebookImportMapper"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { eq as eqOf } from "drizzle-orm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const RULESET = "test:ruleset/townlife@1"
const GENRE = "test:genre/townlife"
const HOUSEHOLD = "test:entry/townlife.household"
const ROUTINE = { weekday: [[7, "work"], [18, "home"]], weekend: [[9, "market"]] }

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-import-ruleset-types-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const decl = defineRuleset(RULESET, {
		name: { en: "Town life" },
		attributes: [],
		entryTypes: [{ id: "household", name: { en: "Household" }, holders: ["cast"], fields: { routine: { type: "schedule" } }, prose: "A household." }]
	} as never)
	// The row the entries' foreign key points at: a published ruleset's types are synced like any descriptor.
	const { syncDefinitionRegistry } = await import("$lib/server/pipelines/boot/registrySync")
	await syncDefinitionRegistry(db as never, deriveEntryTypes(decl as never) as never, { release: "dev" })
	genreKeeping(GENRE, { name: { en: "Town life" }, family: "test", slots: [], events: {} })
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fileEntry = (entryType: string, extra: Record<string, unknown> = {}) => ({
	keys: ["Wren"],
	content: "Wren's household.",
	name: "Wren's household",
	enabled: true,
	extensions: { serenepub: { entryType, ...extra } }
})

describe("importing a ruleset's entry types", () => {
	test("the full id restores when the registry declares it; an unknown id is world lore", () => {
		expect(entryTypeIdOf(fileEntry(`${HOUSEHOLD}@1`) as never)).toBe(HOUSEHOLD)
		expect(entryTypeIdOf(fileEntry(HOUSEHOLD) as never)).toBe(HOUSEHOLD)
		expect(entryTypeIdOf(fileEntry("test:entry/townlife.nothing@1") as never)).toBe(WORLD_LORE_TYPE_ID)
		expect(entryTypeIdOf(fileEntry("character") as never)).not.toBe(WORLD_LORE_TYPE_ID)
	})

	test("through the real import door: a ruleset entry lands typed, with its own position count", async () => {
		const { importLorebookDocument } = await import("$lib/server/sockets/lorebooks")
		const [user] = await db.insert(schema.users).values({ username: "importer-m2c" } as never).returning()
		const file = {
			name: "Town",
			entries: [
				fileEntry(`${HOUSEHOLD}@1`, { routine: ROUTINE }),
				{ ...fileEntry(`${HOUSEHOLD}@1`, { routine: ROUTINE }), name: "Second household", keys: ["Ash"] },
				fileEntry("world")
			]
		}
		const { book } = await importLorebookDocument(user!.id, JSON.stringify(file))
		const rows = await db.select().from(schema.lorebookEntries).where(eqOf(schema.lorebookEntries.lorebookId, book.id))
		const households = rows.filter((r) => r.typeId === HOUSEHOLD)
		expect(households).toHaveLength(2)
		expect(households.map((r) => r.position).sort()).toEqual([0, 1])
		expect((households[0]!.fields as any).routine).toEqual(ROUTINE)
		expect(rows.filter((r) => r.typeId === WORLD_LORE_TYPE_ID)).toHaveLength(1)
	})

	test("a held household's schedule is read by the presences query", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(db, "import-ruleset-types")
		const [wren] = await db.insert(schema.characters).values({ userId: user.id, name: "Wren", description: "Wren." }).returning()
		const [book] = await db
			.insert(schema.lorebooks)
			.values({
				userId: user.id,
				name: "Town",
				storyCalendar: { months: [{ name: "Thaw", days: 30 }], weekdays: ["a", "b", "c", "d", "e", "f", "g"], firstWeekday: 0 }
			} as never)
			.returning()

		// What the import handler does per entry.
		const entry = fileEntry(`${HOUSEHOLD}@1`, { routine: ROUTINE })
		const typeId = entryTypeIdOf(entry as never)
		const mapped = mapImportedEntry(entry as never, typeId, 0)
		const [row] = await db
			.insert(schema.lorebookEntries)
			.values(entryInsert({ ...(mapped as any), typeId, lorebookId: book!.id }) as never)
			.returning()
		expect(row!.typeId).toBe(HOUSEHOLD)
		expect((row!.fields as any).routine).toEqual(ROUTINE)

		const [binding] = await db
			.insert(schema.lorebookBindings)
			.values({ lorebookId: book!.id, characterId: wren!.id, binding: `{{char:${wren!.id}}}`, name: "Wren" })
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: true,
				name: "Town",
				genreId: GENRE,
				primaryRuleset: RULESET,
				lorebookId: book!.id,
				storyClockYear: 1,
				storyClockMonth: 1,
				storyClockDay: 3,
				storyClockHour: 10,
				storyClockMinute: 0
			})
			.returning()
		await db.insert(schema.sessionCharacters).values({ sessionId: session!.id, characterId: wren!.id })
		// The character holds the imported entry: its fields ride the held entry.
		await db.insert(schema.zoneContents).values({
			sessionId: session!.id,
			ownerKind: "session_cast",
			ownerId: wren!.id,
			rulesetId: RULESET,
			zoneType: "carried",
			entries: [{ entryId: row!.id, entryType: "household", name: row!.title, fields: row!.fields }],
			updatedBy: "test"
		})
		const { placementsAt } = await import("$lib/server/state/presencesOnReading")
		expect(await placementsAt(db as never, session!.id)).toEqual([{ bindingId: binding!.id, where: "work" }])
	})
})
