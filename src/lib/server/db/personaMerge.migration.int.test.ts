/**
 * Folding `personas` into `characters`, against a database that already has
 * both — and every kind of row that pointed at one.
 *
 * This is the only arrangement in which 0133's data move is load-bearing: the
 * database is migrated to 0131 through a truncated journal, seeded the way a
 * real install is seeded, and then handed the real folder. A fresh test
 * database proves nothing here, because there would be no persona to move.
 *
 * The three things that can go silently wrong, each pinned below:
 *
 *  - **Overlapping id ranges.** Persona 1 and character 1 are different rows,
 *    and the remap of a KEPT column (`session_personas.persona_id`) rewrites
 *    ids into the same space it is reading from. One `UPDATE … FROM` per table
 *    is what makes that safe — it reads the pre-update snapshot — and a loop or
 *    a second pass would double-map. The seed below gives persona ids that
 *    collide with real character ids on purpose.
 *  - **The uuid collision.** `characters_uuid_idx` is unique per (user, uuid)
 *    and a persona could already share a uuid with one of that user's
 *    characters (same card imported into both panels). One row must be
 *    regenerated; the OTHER must keep the uuid it had.
 *  - **Two defaults.** `personas` had no unique index on `is_default`; the
 *    `characters_default_persona_unique` partial index added by 0132 admits
 *    exactly one, so a user with two must not take the upgrade down.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { sql, type SQL } from "drizzle-orm"
import { rawRows } from "./rawRows"

type MigrationDb = ReturnType<typeof drizzle>

const REAL_FOLDER = path.resolve(process.cwd(), "drizzle")

/** The first migration under test, found by name so its index may move. */
const TAG_SUFFIX = "character_folders_and_persona_flags"

interface JournalEntry {
	idx: number
	version: string
	when: number
	tag: string
	breakpoints: boolean
}

const tempDirs: string[] = []

/** A migrations folder holding everything up to, but not including, `tag`. */
function folderBefore(tagSuffix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-persona-merge-mig-"))
	tempDirs.push(dir)
	const journal = JSON.parse(
		fs.readFileSync(path.join(REAL_FOLDER, "meta/_journal.json"), "utf8")
	) as { entries: JournalEntry[] }
	const cut = journal.entries.findIndex((e) => e.tag.endsWith(tagSuffix))
	if (cut < 0) throw new Error(`No journal entry ending "${tagSuffix}"`)
	const entries = journal.entries.slice(0, cut)
	for (const e of entries)
		fs.copyFileSync(
			path.join(REAL_FOLDER, `${e.tag}.sql`),
			path.join(dir, `${e.tag}.sql`)
		)
	fs.mkdirSync(path.join(dir, "meta"), { recursive: true })
	fs.writeFileSync(
		path.join(dir, "meta/_journal.json"),
		JSON.stringify({ ...journal, entries })
	)
	return dir
}

async function rows<T extends Record<string, unknown>>(
	db: MigrationDb,
	query: SQL
): Promise<T[]> {
	return rawRows<T>(await db.execute(query))
}

async function one<T extends Record<string, unknown>>(
	db: MigrationDb,
	query: SQL
): Promise<T> {
	const found = await rows<T>(db, query)
	if (!found.length) throw new Error("expected exactly one row, got none")
	return found[0]
}

async function hasColumn(db: MigrationDb, table: string, column: string) {
	const found = await rows(
		db,
		sql`select 1 from information_schema.columns
			where table_schema = 'public' and table_name = ${table}
			and column_name = ${column}`
	)
	return found.length > 0
}

async function hasTable(db: MigrationDb, table: string) {
	const found = await rows(
		db,
		sql`select 1 from information_schema.tables
			where table_schema = 'public' and table_name = ${table}`
	)
	return found.length > 0
}

/** The character a given persona became — found by the name it carried over. */
async function characterNamed(
	db: MigrationDb,
	userId: number,
	name: string
): Promise<{
	id: number
	uuid: string
	is_persona: boolean
	is_default_persona: boolean
	description: string
	is_deleted: boolean
	lorebook_id: number | null
	avatar_media_id: number | null
	summary: string | null
	aliases: string[]
}> {
	return one(
		db,
		sql`select id, uuid, is_persona, is_default_persona, description,
				is_deleted, lorebook_id, avatar_media_id, summary, aliases
			from characters where user_id = ${userId} and name = ${name}`
	)
}

let client: PGlite
let db: MigrationDb

/** Two users: the fold is per-owner and must not leak across them. */
let userA: number
let userB: number

let lorebookA: number
let sessionA: number
let sharedUuid: string
let tagId: number
let fileId: number
let avatarFileId: number
let entryId: number
let messageId: number
let sessionMessageId: number

/** The persona ids we seed, which collide with real character ids. */
const personaIds: Record<string, number> = {}
const characterIds: Record<string, number> = {}

beforeAll(async () => {
	client = new PGlite()
	db = drizzle(client)
	await migrate(db, { migrationsFolder: folderBefore(TAG_SUFFIX) })

	userA = (await one<{ id: number }>(db, sql`select id from users limit 1`)).id
	// Explicit id: the seeded admin was written at a fixed id, so the identity
	// sequence has never moved and a bare insert would collide with it.
	userB = (
		await one<{ id: number }>(
			db,
			sql`insert into users (id, username)
				select coalesce(max(id), 0) + 1, 'second' from users
				returning id`
		)
	).id

	// ── Characters first, so the persona ids seeded after them land INSIDE the
	// character id range. That is the overlap the single-statement remap has to
	// survive.
	const character = async (
		userId: number,
		name: string,
		extra: { uuid?: string } = {}
	) => {
		const row = extra.uuid
			? await one<{ id: number; uuid: string }>(
					db,
					sql`insert into characters (user_id, name, description, uuid)
						values (${userId}, ${name}, ${`${name} the character`}, ${extra.uuid}::uuid)
						returning id, uuid`
				)
			: await one<{ id: number; uuid: string }>(
					db,
					sql`insert into characters (user_id, name, description)
						values (${userId}, ${name}, ${`${name} the character`})
						returning id, uuid`
				)
		characterIds[name] = row.id
		return row
	}

	// Five so the identity sequence is well past 1 — every persona id below is
	// therefore also a live character id.
	const twin = await character(userA, "Twin")
	sharedUuid = twin.uuid
	await character(userA, "Ada")
	await character(userA, "Bram")
	await character(userB, "Cleo")
	await character(userB, "Dov")

	const persona = async (
		id: number,
		userId: number,
		name: string,
		opts: {
			isDefault?: boolean
			uuid?: string
			lorebookId?: number | null
			avatarMediaId?: number | null
			summary?: string | null
			deleted?: boolean
		} = {}
	) => {
		// Explicit ids: the whole point is that they overlap `characters.id`.
		await db.execute(
			sql`insert into personas
					(id, user_id, name, description, is_default, uuid, lorebook_id,
					 avatar_media_id, summary, is_deleted, aliases)
				values (${id}, ${userId}, ${name}, ${`${name} the persona`},
					${opts.isDefault ?? false},
					coalesce(${opts.uuid ?? null}::uuid, gen_random_uuid()),
					${opts.lorebookId ?? null}, ${opts.avatarMediaId ?? null},
					${opts.summary ?? null}, ${opts.deleted ?? false},
					${JSON.stringify([`${name}ie`])}::json)`
		)
		personaIds[name] = id
		return id
	}

	const book = await one<{ id: number }>(
		db,
		sql`insert into lorebooks (name, user_id) values ('Roads', ${userA})
			returning id`
	)
	lorebookA = book.id

	const avatar = await one<{ id: number }>(
		db,
		sql`insert into files (user_id, kind, hash, persona_id)
			values (${userA}, 'image', 'hash-avatar', 1) returning id`
	)
	avatarFileId = avatar.id

	// persona 1 shares userA's "Twin" uuid — a collision the INSERT must break.
	await persona(1, userA, "Warren", {
		isDefault: true,
		uuid: sharedUuid,
		lorebookId: lorebookA,
		avatarMediaId: avatarFileId,
		summary: "the one you play"
	})
	// A SECOND default for the same user: 0132's partial index admits one.
	await persona(2, userA, "Vex", { isDefault: true })
	await persona(3, userA, "Ghost", { deleted: true })
	// userB's own default — per-owner, so it must survive alongside userA's.
	await persona(4, userB, "Ines", { isDefault: true })

	// A gallery file, stamped with the persona it belongs to (no FK by ruling).
	const gallery = await one<{ id: number }>(
		db,
		sql`insert into files (user_id, kind, hash, persona_id, position)
			values (${userA}, 'image', 'hash-gallery', ${personaIds.Warren}, 3)
			returning id`
	)
	fileId = gallery.id
	// Re-stamp the avatar now that Warren exists (it had to exist first to be
	// pointed at).
	await db.execute(
		sql`update files set persona_id = ${personaIds.Warren} where id = ${avatarFileId}`
	)

	// Tags: one shared with a character, so the fold has a conflict to survive.
	tagId = (
		await one<{ id: number }>(
			db,
			sql`insert into tags (name, user_id) values ('mine', ${userA}) returning id`
		)
	).id
	await db.execute(
		sql`insert into persona_tags (persona_id, tag_id)
			values (${personaIds.Warren}, ${tagId})`
	)
	await db.execute(
		sql`insert into character_tags (character_id, tag_id)
			values (${characterIds.Ada}, ${tagId})`
	)

	// A lorebook binding bound to the persona.
	await db.execute(
		sql`insert into lorebook_bindings (lorebook_id, binding, name, persona_id)
			values (${lorebookA}, '{{persona:1}}', 'Warren', ${personaIds.Warren})`
	)

	// A session with the persona attached, and its two message rows.
	sessionA = (
		await one<{ id: number }>(
			db,
			sql`insert into sessions (is_group, user_id, name)
				values (false, ${userA}, 'A walk') returning id`
		)
	).id
	await db.execute(
		sql`insert into session_personas (session_id, persona_id, position)
			values (${sessionA}, ${personaIds.Warren}, 0)`
	)
	// A removed participant, kept so the soft-delete arc is exercised too.
	await db.execute(
		sql`insert into session_personas (session_id, persona_id, removed_at, removed_name)
			values (${sessionA}, ${personaIds.Vex}, now(), 'Vex')`
	)
	sessionMessageId = (
		await one<{ id: number }>(
			db,
			sql`insert into session_messages (session_id, role, content, persona_id)
				values (${sessionA}, 'user', 'hello', ${personaIds.Warren})
				returning id`
		)
	).id
	messageId = (
		await one<{ id: number }>(
			db,
			sql`insert into messages (session_id, role, persona_id)
				values (${sessionA}, 'user', ${personaIds.Warren}) returning id`
		)
	).id

	// Annotations over an entry and over that message, both resolved to the
	// persona — in both spellings the row carries (the column and the key).
	await db.execute(
		sql`insert into pipeline_type_registry (type_id, version, kind)
			values ('core:entry/world-lore', 1, 'entry')
			on conflict do nothing`
	)
	entryId = (
		await one<{ id: number }>(
			db,
			sql`insert into lorebook_entries
					(lorebook_id, type_id, type_version, position, title, content)
				values (${lorebookA}, 'core:entry/world-lore', 1, 1, 'The Tunnel', 'Warren went in')
				returning id`
		)
	).id
	await db.execute(
		sql`insert into entry_annotations
				(entry_id, entity_key, tier, persona_id, extractor_version,
				 source_hash, gazetteer_hash, surface, mentions)
			values (${entryId}, ${`persona:${personaIds.Warren}`}, 'gazetteer',
				${personaIds.Warren}, 'v1', 'sh', 'gh', 'Warren', 1)`
	)
	await db.execute(
		sql`insert into message_annotations
				(message_id, entity_key, tier, persona_id, extractor_version,
				 source_hash, gazetteer_hash, surface, mentions)
			values (${messageId}, ${`persona:${personaIds.Warren}`}, 'gazetteer',
				${personaIds.Warren}, 'v1', 'sh', 'gh', 'Warren', 1)`
	)
}, 60_000)

afterAll(async () => {
	await client?.close()
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

describe("0132 + 0133, personas folding into characters", () => {
	it("starts with a personas table and no persona flags", async () => {
		expect(await hasTable(db, "personas")).toBe(true)
		expect(await hasColumn(db, "characters", "is_persona")).toBe(false)
		// The overlap this test exists for: every persona id is also a
		// character id.
		const overlap = await rows<{ id: number }>(
			db,
			sql`select id from characters where id in (
					select id from personas)`
		)
		expect(overlap.length).toBe(Object.keys(personaIds).length)
	})

	it("applies over an install that has personas", async () => {
		await migrate(db, { migrationsFolder: REAL_FOLDER })
	}, 60_000)

	it("leaves no personas or persona_tags table behind", async () => {
		expect(await hasTable(db, "personas")).toBe(false)
		expect(await hasTable(db, "persona_tags")).toBe(false)
	})

	it("drops the scaffolding column it added", async () => {
		expect(await hasColumn(db, "characters", "migrated_persona_id")).toBe(
			false
		)
	})

	it("drops every folded persona_id column and keeps the three kept ones", async () => {
		for (const [table, column] of [
			["lorebook_bindings", "persona_id"],
			["entry_annotations", "persona_id"],
			["message_annotations", "persona_id"],
			["files", "persona_id"],
			["user_settings", "enable_easy_persona_creation"]
		] as const)
			expect([table, await hasColumn(db, table, column)]).toEqual([
				table,
				false
			])

		for (const table of [
			"session_personas",
			"session_messages",
			"messages"
		] as const)
			expect([table, await hasColumn(db, table, "persona_id")]).toEqual([
				table,
				true
			])
	})

	it("makes one flagged character per persona, per owner", async () => {
		const flagged = await rows<{ name: string; user_id: number }>(
			db,
			sql`select name, user_id from characters where is_persona
				order by user_id, name`
		)
		expect(flagged).toEqual([
			{ name: "Ghost", user_id: userA },
			{ name: "Vex", user_id: userA },
			{ name: "Warren", user_id: userA },
			{ name: "Ines", user_id: userB }
		])
		// Nothing that was already a character was flagged.
		const unflagged = await rows<{ name: string }>(
			db,
			sql`select name from characters where not is_persona order by name`
		)
		expect(unflagged.map((r) => r.name)).toEqual([
			"Ada",
			"Bram",
			"Cleo",
			"Dov",
			"Twin"
		])
	})

	it("carries the persona's own columns across", async () => {
		const warren = await characterNamed(db, userA, "Warren")
		expect(warren.description).toBe("Warren the persona")
		expect(warren.lorebook_id).toBe(lorebookA)
		expect(warren.avatar_media_id).toBe(avatarFileId)
		expect(warren.summary).toBe("the one you play")
		expect(warren.aliases).toEqual(["Warrenie"])
		// A soft-deleted persona stays soft-deleted, not resurrected.
		expect((await characterNamed(db, userA, "Ghost")).is_deleted).toBe(true)
	})

	it("regenerates only the colliding uuid", async () => {
		const warren = await characterNamed(db, userA, "Warren")
		const twin = await characterNamed(db, userA, "Twin")
		expect(twin.uuid).toBe(sharedUuid)
		expect(warren.uuid).not.toBe(sharedUuid)
		// Non-colliding personas keep the uuid they were stamped with.
		const dupes = await rows<{ total: number }>(
			db,
			sql`select count(*)::int as total from (
					select user_id, uuid from characters
					group by user_id, uuid having count(*) > 1) d`
		)
		expect(dupes[0].total).toBe(0)
	})

	it("leaves exactly one default persona per user", async () => {
		const defaults = await rows<{ user_id: number; name: string }>(
			db,
			sql`select user_id, name from characters where is_default_persona
				order by user_id`
		)
		expect(defaults).toEqual([
			{ user_id: userA, name: "Warren" },
			{ user_id: userB, name: "Ines" }
		])
	})

	it("refuses a second default for the same user afterwards", async () => {
		await expect(
			db.execute(
				sql`update characters set is_default_persona = true
					where id = ${characterIds.Ada}`
			)
		).rejects.toThrow(/characters_default_persona_unique/)
	})

	it("folds persona tags onto the character, conflict and all", async () => {
		const warren = await characterNamed(db, userA, "Warren")
		const tagged = await rows<{ character_id: number }>(
			db,
			sql`select character_id from character_tags where tag_id = ${tagId}
				order by character_id`
		)
		expect(tagged.map((r) => r.character_id).sort((a, b) => a - b)).toEqual(
			[characterIds.Ada, warren.id].sort((a, b) => a - b)
		)
	})

	it("re-points the lorebook binding at the new character", async () => {
		const warren = await characterNamed(db, userA, "Warren")
		const binding = await one<{ character_id: number; name: string }>(
			db,
			sql`select character_id, name from lorebook_bindings
				where lorebook_id = ${lorebookA}`
		)
		expect(binding.character_id).toBe(warren.id)
	})

	it("re-points the file provenance at the new character", async () => {
		const warren = await characterNamed(db, userA, "Warren")
		const files = await rows<{ id: number; character_id: number }>(
			db,
			sql`select id, character_id from files order by id`
		)
		expect(files.map((f) => f.character_id)).toEqual([warren.id, warren.id])
		expect(files.map((f) => f.id)).toEqual(
			[avatarFileId, fileId].sort((a, b) => a - b)
		)
	})

	it("re-points both annotation stores, column and key together", async () => {
		const warren = await characterNamed(db, userA, "Warren")
		const entry = await one<{ character_id: number; entity_key: string }>(
			db,
			sql`select character_id, entity_key from entry_annotations
				where entry_id = ${entryId}`
		)
		expect(entry.character_id).toBe(warren.id)
		expect(entry.entity_key).toBe(`character:${warren.id}`)

		const message = await one<{ character_id: number; entity_key: string }>(
			db,
			sql`select character_id, entity_key from message_annotations
				where message_id = ${messageId}`
		)
		expect(message.character_id).toBe(warren.id)
		expect(message.entity_key).toBe(`character:${warren.id}`)
	})

	it("remaps the kept columns across the overlapping id range", async () => {
		const warren = await characterNamed(db, userA, "Warren")
		const vex = await characterNamed(db, userA, "Vex")

		const cast = await rows<{
			persona_id: number
			removed_name: string | null
		}>(
			db,
			sql`select persona_id, removed_name from session_personas
				where session_id = ${sessionA} order by persona_id`
		)
		expect(cast).toEqual(
			[
				{ persona_id: warren.id, removed_name: null },
				{ persona_id: vex.id, removed_name: "Vex" }
			].sort((a, b) => a.persona_id - b.persona_id)
		)

		const legacy = await one<{ persona_id: number }>(
			db,
			sql`select persona_id from session_messages where id = ${sessionMessageId}`
		)
		expect(legacy.persona_id).toBe(warren.id)

		const message = await one<{ persona_id: number }>(
			db,
			sql`select persona_id from messages where id = ${messageId}`
		)
		expect(message.persona_id).toBe(warren.id)

		// The hazard stated in this file's header: a value that was a persona
		// id must NOT still be pointing at whatever character happens to hold
		// that number now.
		expect(warren.id).not.toBe(personaIds.Warren)
		expect(legacy.persona_id).not.toBe(characterIds.Twin)
	})

	it("re-points the kept columns' foreign keys at characters", async () => {
		const fks = await rows<{ table_name: string; constraint_name: string }>(
			db,
			sql`select tc.table_name, tc.constraint_name
				from information_schema.table_constraints tc
				join information_schema.constraint_column_usage ccu
					on ccu.constraint_name = tc.constraint_name
				where tc.constraint_type = 'FOREIGN KEY'
					and ccu.table_name = 'characters'
					and ccu.column_name = 'id'
					and tc.table_name in
						('session_personas','session_messages','messages')
					and tc.constraint_name like '%persona_id%'
				order by tc.table_name`
		)
		expect(fks.map((f) => f.table_name)).toEqual([
			"messages",
			"session_messages",
			"session_personas"
		])

		// And it bites: the id of a persona that no longer exists is refused.
		await expect(
			db.execute(
				sql`insert into session_personas (session_id, persona_id)
					values (${sessionA}, 999999)`
			)
		).rejects.toThrow(/session_personas_persona_id_characters_id_fk/)
	})

	it("returns a folder's characters to the top level when it goes", async () => {
		const folder = await one<{ id: number }>(
			db,
			sql`insert into character_folders (user_id, name)
				values (${userA}, 'Villains') returning id`
		)
		await db.execute(
			sql`update characters set folder_id = ${folder.id}
				where id = ${characterIds.Bram}`
		)
		await db.execute(
			sql`delete from character_folders where id = ${folder.id}`
		)
		const bram = await one<{ folder_id: number | null }>(
			db,
			sql`select folder_id from characters where id = ${characterIds.Bram}`
		)
		expect(bram.folder_id).toBeNull()
	})

	it("keeps folder names unique per owner, not globally", async () => {
		await db.execute(
			sql`insert into character_folders (user_id, name)
				values (${userA}, 'Heroes')`
		)
		// Another user may have one by the same name.
		await db.execute(
			sql`insert into character_folders (user_id, name)
				values (${userB}, 'Heroes')`
		)
		await expect(
			db.execute(
				sql`insert into character_folders (user_id, name)
					values (${userA}, 'Heroes')`
			)
		).rejects.toThrow(/character_folders_user_name_unique/)
	})
})
