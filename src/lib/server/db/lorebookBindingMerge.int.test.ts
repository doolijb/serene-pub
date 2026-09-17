/**
 * Migration 0125, over a database that already holds the duplicates.
 *
 * ⚠ This is the one arrangement in which a migration's own effect is
 * observable: migrate ONCE from a copy of `drizzle/` with 0125 struck from the
 * journal, seed the state 0125 exists to repair, then migrate again from the
 * real folder. A `createTestDb` applies every file at once against an empty
 * database, so the rows 0125 merges would never have existed for it to merge.
 *
 * What is under test is the two halves of the migration together: the duplicate
 * bindings merge onto the oldest row with every reference repointed, and the
 * partial unique indexes that replace `lorebook_bindings_unique` then refuse
 * the second row outright — which the index they replace never could, because
 * one of its three columns is always NULL.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

const REAL_DRIZZLE = path.resolve(process.cwd(), "drizzle")
/** Everything at or above this index is the migration under test. */
const UNDER_TEST_IDX = 125

let db: ReturnType<typeof drizzle<typeof schema, PGlite>>
let beforeFolder: string

/** ids seeded before the migration, read back after it. */
let survivorId: number
let duplicateId: number
let personaSurvivorId: number
let personaDuplicateId: number
let anchoredEntryId: number
let keptEdgeId: number
let selfLoopEdgeId: number
let sceneId: number
let suggestionId: number
let lorebookId: number
let characterId: number
let bothBookId: number
let bothCharacterId: number
let bothPersonaId: number
let bothPersonaOnlyId: number
let bothBothIdsId: number
let bothCharacterOnlyId: number
let userId: number
/** The character 0133 folds the "Reader" persona into, resolved after the full migration. */
let personaCharacterId: number
/** Same, for the "Listener" persona used by the both-ends scenario. */
let otherPersonaCharacterId: number

/**
 * `schema.personas` no longer exists — 0133 dropped the table — but the
 * "before" folder here stops at 124, where it's still physically present.
 * Raw SQL is the only way left to seed the pre-merge shape it once had.
 */
async function insertLegacyPersona(opts: {
	userId: number
	name: string
	description?: string
	isDefault?: boolean
}) {
	const result = await db.execute(sql`
		INSERT INTO "personas" ("user_id", "is_default", "name", "description")
		VALUES (${opts.userId}, ${opts.isDefault ?? false}, ${opts.name}, ${opts.description ?? ""})
		RETURNING "id"
	`)
	const rows = (result as any).rows ?? result
	return rows[0] as { id: number }
}

/**
 * `schema.characters` (the CURRENT, head-of-branch schema) declares
 * `is_persona`/`is_default_persona`/`folder_id`, added by 0132 — a migration
 * that, like 0125, is above `UNDER_TEST_IDX` and so hasn't run yet at seed
 * time. Drizzle's insert always enumerates every column the TS schema
 * declares (`DEFAULT` for the ones a caller didn't set), so a typed
 * `db.insert(schema.characters)` fails outright against this snapshot's
 * physical table — not with a wrong value, but with "column does not exist".
 * Raw SQL, naming only the columns that exist at 124, sidesteps it.
 */
async function insertLegacyCharacter(opts: {
	userId: number
	name: string
	description?: string
}) {
	const result = await db.execute(sql`
		INSERT INTO "characters" ("user_id", "name", "description")
		VALUES (${opts.userId}, ${opts.name}, ${opts.description ?? ""})
		RETURNING "id"
	`)
	const rows = (result as any).rows ?? result
	return rows[0] as { id: number }
}

/**
 * Same reason: `schema.lorebookBindings` no longer has `persona_id` — 0133
 * dropped it too — but at this snapshot in migration history the physical
 * column is still there for a binding to carry.
 */
async function insertLegacyPersonaBinding(opts: {
	lorebookId: number
	personaId: number
	characterId?: number | null
	binding: string
	name: string
}) {
	const result = await db.execute(sql`
		INSERT INTO "lorebook_bindings" ("lorebook_id", "persona_id", "character_id", "binding", "name")
		VALUES (${opts.lorebookId}, ${opts.personaId}, ${opts.characterId ?? null}, ${opts.binding}, ${opts.name})
		RETURNING "id"
	`)
	const rows = (result as any).rows ?? result
	return rows[0] as { id: number }
}

/** A copy of `drizzle/` with the migration under test struck from the journal. */
async function folderWithoutMigrationUnderTest(): Promise<string> {
	const dir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-binding-merge-")
	)
	await fs.cp(REAL_DRIZZLE, dir, { recursive: true })
	const journalPath = path.join(dir, "meta", "_journal.json")
	const journal = JSON.parse(await fs.readFile(journalPath, "utf-8"))
	journal.entries = journal.entries.filter(
		(e: { idx: number }) => e.idx < UNDER_TEST_IDX
	)
	await fs.writeFile(journalPath, JSON.stringify(journal, null, 2))
	return dir
}

beforeAll(async () => {
	beforeFolder = await folderWithoutMigrationUnderTest()
	const client = new PGlite()
	db = drizzle(client, { schema })
	await migrate(db, { migrationsFolder: beforeFolder })

	// Identity sequences, resynced for the same reason createTestDb does it:
	// a migration seeds the default admin user at an explicit id 1, and
	// Postgres never advances an identity sequence for a value it was handed,
	// so the next default-generated insert collides on that id.
	await db.execute(`
		DO $$
		DECLARE
			rec RECORD;
		BEGIN
			FOR rec IN
				SELECT seq.relname AS seq_name, tab.relname AS table_name, attr.attname AS col_name
				FROM pg_class seq
				JOIN pg_namespace ns ON ns.oid = seq.relnamespace
				JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype IN ('a', 'i')
				JOIN pg_class tab ON dep.refobjid = tab.oid
				JOIN pg_attribute attr ON attr.attrelid = tab.oid AND attr.attnum = dep.refobjsubid
				WHERE seq.relkind = 'S' AND ns.nspname = 'public'
			LOOP
				EXECUTE format(
					'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM public.%I), 1))',
					rec.seq_name, rec.col_name, rec.table_name
				);
			END LOOP;
		END $$;
	`)

	// lorebook_entries.type_id is a real foreign key into the definition
	// registry, so the entries seeded below need their types published first —
	// the same precondition createTestDb states. Written as raw rows against
	// the table's name AT THIS JOURNAL CUT (`pipeline_type_registry`, before
	// 0134 renamed it): the current sync targets the renamed table, which does
	// not exist yet on a database migrated only this far.
	const { allEntryTypes } = await import("@serene-pub/sdk")
	await import("@serene-pub/core-catalog")
	for (const t of allEntryTypes()) {
		const bare = t.id.replace(/@\d+$/, "")
		const version = Number(/@(\d+)$/.exec(t.id)?.[1] ?? 1)
		await db.execute(
			sql`insert into pipeline_type_registry (type_id, version, kind, ports, slots)
				values (${bare}, ${version}, 'entry', '{}'::json, '{}'::json)
				on conflict do nothing`
		)
	}

	const [user] = await db
		.insert(schema.users)
		.values({ username: "binding-merge-user" })
		.returning()
	userId = user.id
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: "Book" })
		.returning()
	lorebookId = lorebook.id
	const character = await insertLegacyCharacter({
		userId: user.id,
		name: "Maren",
		description: ""
	})
	characterId = character.id
	const persona = await insertLegacyPersona({
		userId: user.id,
		name: "Reader",
		description: "",
		isDefault: false
	})

	// The duplicates the removed "Pull the cast from this session" produced:
	// one lorebooks:createBinding per member, no existence check, pressed
	// twice.
	const [survivor, duplicate] = await db
		.insert(schema.lorebookBindings)
		.values([
			{
				lorebookId,
				characterId: character.id,
				binding: "{{char:1}}",
				name: "Maren"
			},
			{
				lorebookId,
				characterId: character.id,
				binding: "{{char:2}}",
				name: "Maren",
				aliases: ["Commander Thorne"],
				absorbedAliases: ["The Commander"],
				sceneId: null
			}
		])
		.returning()
	survivorId = survivor.id
	duplicateId = duplicate.id

	const personaSurvivor = await insertLegacyPersonaBinding({
		lorebookId,
		personaId: persona.id,
		binding: "{{char:3}}",
		name: "Reader"
	})
	const personaDuplicate = await insertLegacyPersonaBinding({
		lorebookId,
		personaId: persona.id,
		binding: "{{char:4}}",
		name: "Reader"
	})
	personaSurvivorId = personaSurvivor.id
	personaDuplicateId = personaDuplicate.id

	// A third, unrelated cast member so the edges below have a far end that is
	// nobody's duplicate.
	const [other] = await db
		.insert(schema.lorebookBindings)
		.values({ lorebookId, binding: "{{char:5}}", name: "The Innkeeper" })
		.returning()

	const { CHARACTER_LORE_TYPE_ID, HISTORY_TYPE_ID } = await import(
		"$lib/shared/entries/types"
	)
	const [historyEntry] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: HISTORY_TYPE_ID,
			typeVersion: 1,
			title: "The siege",
			position: 1
		})
		.returning()
	// Character lore anchored to the DUPLICATE — the row that is about to be
	// deleted, and whose anchor is ON DELETE SET NULL.
	const [anchored] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: CHARACTER_LORE_TYPE_ID,
			typeVersion: 1,
			title: "What Maren never says",
			position: 1,
			anchorBindingId: duplicateId
		})
		.returning()
	anchoredEntryId = anchored.id

	const [scene] = await db
		.insert(schema.scenes)
		.values({
			lorebookId,
			historyEntryId: historyEntry.id,
			name: "The gate"
		})
		.returning()
	sceneId = scene.id
	// Both rows appear in one scene under the same role, so the survivor
	// already holds the key the duplicate's row would be repointed onto.
	await db.insert(schema.sceneCharacters).values([
		{ sceneId, bindingId: survivorId, role: "participant" },
		{ sceneId, bindingId: duplicateId, role: "participant" },
		{ sceneId, bindingId: duplicateId, role: "mentioned" }
	])

	const [keptEdge] = await db
		.insert(schema.narrativeRelationships)
		.values({
			lorebookId,
			fromNodeId: duplicateId,
			toNodeId: other.id,
			relationshipType: "ally",
			description: "drinks there"
		})
		.returning()
	keptEdgeId = keptEdge.id
	// An edge between the two rows: once both ends are the survivor it is a
	// relationship from someone to themselves.
	const [selfLoop] = await db
		.insert(schema.narrativeRelationships)
		.values({
			lorebookId,
			fromNodeId: survivorId,
			toNodeId: duplicateId,
			relationshipType: "rival",
			description: "same person, twice"
		})
		.returning()
	selfLoopEdgeId = selfLoop.id

	await db
		.update(schema.lorebookBindings)
		.set({ parentNodeId: duplicateId })
		.where(eq(schema.lorebookBindings.id, other.id))

	const [suggestion] = await db
		.insert(schema.bindingSuggestions)
		.values({
			lorebookId,
			entityKey: "open:maren",
			surface: "Maren",
			status: "added",
			resolvedBindingId: duplicateId
		})
		.returning()
	suggestionId = suggestion.id

	// A second book, for the one shape that can put a row in two duplicate
	// groups at once: `character_id` and `persona_id` are both nullable and
	// nothing forbids setting both, so a row can be the oldest of its
	// character group and a duplicate of its persona group. Ordered so the
	// persona merge comes first, which is what deletes the row the character
	// group was about to be merged onto.
	const [bookTwo] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: "Both ends" })
		.returning()
	bothBookId = bookTwo.id
	const otherCharacter = await insertLegacyCharacter({
		userId: user.id,
		name: "Kael",
		description: ""
	})
	bothCharacterId = otherCharacter.id
	const otherPersona = await insertLegacyPersona({
		userId: user.id,
		name: "Listener",
		description: "",
		isDefault: false
	})
	bothPersonaId = otherPersona.id
	// Sequential, not a batch `.values([...])`: two of these three rows carry
	// a legacy `persona_id` that only raw SQL can write, and the merge logic
	// under test picks its survivor by id, so insertion order still has to
	// produce personaOnly < bothIds < characterOnly.
	const personaOnly = await insertLegacyPersonaBinding({
		lorebookId: bothBookId,
		personaId: otherPersona.id,
		binding: "{{char:1}}",
		name: "Listener"
	})
	const bothIds = await insertLegacyPersonaBinding({
		lorebookId: bothBookId,
		characterId: otherCharacter.id,
		personaId: otherPersona.id,
		binding: "{{char:2}}",
		name: "Both"
	})
	const [characterOnly] = await db
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: bothBookId,
			characterId: otherCharacter.id,
			binding: "{{char:3}}",
			name: "Kael"
		})
		.returning()
	bothPersonaOnlyId = personaOnly.id
	bothBothIdsId = bothIds.id
	bothCharacterOnlyId = characterOnly.id

	// Now the migration under test.
	await migrate(db, { migrationsFolder: REAL_DRIZZLE })

	// 0133 rides along in this same migrate() call (it's later in the real
	// folder) and folds each seeded persona into a `characters` row with
	// `isPersona: true`, repointing any binding that named it by `persona_id`
	// onto that row's `character_id` before dropping the column outright.
	const readerCharacter = await db.query.characters.findFirst({
		where: (c, { and, eq }) =>
			and(eq(c.userId, userId), eq(c.name, "Reader"), eq(c.isPersona, true))
	})
	personaCharacterId = readerCharacter!.id
	const listenerCharacter = await db.query.characters.findFirst({
		where: (c, { and, eq }) =>
			and(
				eq(c.userId, userId),
				eq(c.name, "Listener"),
				eq(c.isPersona, true)
			)
	})
	otherPersonaCharacterId = listenerCharacter!.id
}, 120_000)

afterAll(async () => {
	await fs.rm(beforeFolder, { recursive: true, force: true })
})

describe("0125 — duplicate lorebook bindings merge onto the oldest row", () => {
	test("one binding per character survives, and it is the lowest id", async () => {
		const rows = await db.query.lorebookBindings.findMany({
			where: (b, { and, eq }) =>
				and(
					eq(b.lorebookId, lorebookId),
					eq(b.characterId, characterId)
				)
		})
		expect(rows.map((r) => r.id)).toEqual([survivorId])
	})

	test("the persona's duplicate merges too", async () => {
		// `persona_id` is gone by the time this reads back — 0133 folded it
		// into `character_id` — so the merged group is now found the same way
		// any character-bound group is: by the character it landed on.
		const rows = await db.query.lorebookBindings.findMany({
			where: (b, { and, eq }) =>
				and(eq(b.lorebookId, lorebookId), eq(b.characterId, personaCharacterId))
		})
		expect(rows.map((r) => r.id)).toEqual([personaSurvivorId])
		expect(personaDuplicateId).not.toBe(personaSurvivorId)
	})

	test("the anchored entry follows the survivor rather than going unbound", async () => {
		const entry = await db.query.lorebookEntries.findFirst({
			where: (e, { eq }) => eq(e.id, anchoredEntryId)
		})
		expect(entry?.anchorBindingId).toBe(survivorId)
	})

	test("an edge to a third party is repointed; the edge between the two is gone", async () => {
		const edges = await db.query.narrativeRelationships.findMany({
			where: (r, { eq }) => eq(r.lorebookId, lorebookId)
		})
		expect(edges.map((e) => e.id)).toEqual([keptEdgeId])
		expect(edges[0].fromNodeId).toBe(survivorId)
		expect(selfLoopEdgeId).toBeGreaterThan(0)
	})

	test("scene appearances move, and the role the survivor already held is not doubled", async () => {
		const cast = await db.query.sceneCharacters.findMany({
			where: (sc, { eq }) => eq(sc.sceneId, sceneId)
		})
		expect(cast.every((c) => c.bindingId === survivorId)).toBe(true)
		expect(cast.map((c) => c.role).sort()).toEqual([
			"mentioned",
			"participant"
		])
	})

	test("the child node and the resolved suggestion point at the survivor", async () => {
		const child = await db.query.lorebookBindings.findFirst({
			where: (b, { and, eq }) =>
				and(eq(b.lorebookId, lorebookId), eq(b.name, "The Innkeeper"))
		})
		expect(child?.parentNodeId).toBe(survivorId)
		const suggestion = await db.query.bindingSuggestions.findFirst({
			where: (s, { eq }) => eq(s.id, suggestionId)
		})
		expect(suggestion?.resolvedBindingId).toBe(survivorId)
	})

	test("the duplicate's identities land in absorbedAliases, not aliases", async () => {
		const survivor = await db.query.lorebookBindings.findFirst({
			where: (b, { eq }) => eq(b.id, survivorId)
		})
		expect(survivor?.absorbedAliases).toEqual(
			expect.arrayContaining(["Commander Thorne", "The Commander"])
		)
		// `aliases` is replaced wholesale by every entity sync, so an absorbed
		// identity written there would vanish at the next character edit.
		expect(survivor?.aliases).toEqual([])
	})

	test("a row bound to both a character and a persona merges without dangling", async () => {
		const rows = await db.query.lorebookBindings.findMany({
			where: (b, { eq }) => eq(b.lorebookId, bothBookId),
			orderBy: (b, { asc }) => asc(b.id)
		})
		// The row carrying both ids is absorbed by the older persona row; the
		// character it also named is then held by one row, so that group is
		// no longer a duplicate and its member stays where it is.
		expect(rows.map((r) => r.id)).toEqual([
			bothPersonaOnlyId,
			bothCharacterOnlyId
		])
		expect(bothBothIdsId).not.toBe(bothPersonaOnlyId)
		// `persona_id` is gone; the surviving persona row now carries the
		// folded persona's `character_id` instead (see bothPersonaId, which
		// is still that persona's *legacy* id, kept only for the assertions
		// above).
		expect(
			rows
				.filter((r) => r.characterId === otherPersonaCharacterId)
				.map((r) => r.id)
		).toEqual([bothPersonaOnlyId])
		expect(
			rows
				.filter((r) => r.characterId === bothCharacterId)
				.map((r) => r.id)
		).toEqual([bothCharacterOnlyId])
	})

	test("a second binding for the same character is refused afterwards", async () => {
		await expect(
			db.insert(schema.lorebookBindings).values({
				lorebookId,
				characterId,
				binding: "{{char:9}}",
				name: "Maren"
			})
		).rejects.toThrow(/lorebook_bindings_character_unique/)
	})

	test("background rows stay unconstrained — two may share a book", async () => {
		const inserted = await db
			.insert(schema.lorebookBindings)
			.values([
				{ lorebookId, binding: "{{char:10}}", name: "A voice" },
				{ lorebookId, binding: "{{char:11}}", name: "Another voice" }
			])
			.returning()
		expect(inserted).toHaveLength(2)
	})
})
