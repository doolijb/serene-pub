/**
 * What an image uploaded before cropping existed resolves to.
 *
 * A file's `frame` is nullable and NULL is the stored default — the thumbnail
 * rule in `$lib/shared/media/frame` decides what an unframed image is cut to.
 * So the migration adds a column and writes nothing, and that is the assertion:
 * every existing row reads null and is cut by the rule rather than by a value
 * frozen at migration time.
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
import { defaultFrame } from "$lib/shared/media/frame"

type MigrationDb = ReturnType<typeof drizzle>

const REAL_FOLDER = path.resolve(process.cwd(), "drizzle")

/** The migration under test, found by name so its index may move. */
const TAG_SUFFIX = "media_frame"

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
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-media-frame-mig-"))
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

async function hasColumn(db: MigrationDb, table: string, column: string) {
	const found = await rows(
		db,
		sql`select 1 from information_schema.columns
			where table_schema = 'public' and table_name = ${table}
			and column_name = ${column}`
	)
	return found.length > 0
}

/** A file needs an owner; the migrations seed one. */
async function anyUserId(db: MigrationDb): Promise<number> {
	const [user] = await rows<{ id: number }>(
		db,
		sql`select id from users order by id limit 1`
	)
	if (!user) throw new Error("No user to own a file")
	return user.id
}

async function insertFile(db: MigrationDb, hash: string): Promise<number> {
	const [file] = await rows<{ id: number }>(
		db,
		sql`insert into files (user_id, kind, hash, width, height)
			values (${await anyUserId(db)}, 'image', ${hash}, 900, 1600)
			returning id`
	)
	return file.id
}

let client: PGlite
let db: MigrationDb
let existingId: number

beforeAll(async () => {
	client = new PGlite()
	db = drizzle(client)
	await migrate(db, { migrationsFolder: folderBefore(TAG_SUFFIX) })
	existingId = await insertFile(db, "hash-before-the-frame-column")
}, 60_000)

afterAll(async () => {
	await client?.close()
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

describe("the frame column", () => {
	it("is not there before the migration that adds it", async () => {
		expect(await hasColumn(db, "files", "frame")).toBe(false)
	})

	it("leaves an image that predates it on the default rule", async () => {
		await migrate(db, { migrationsFolder: REAL_FOLDER })
		expect(await hasColumn(db, "files", "frame")).toBe(true)

		const [file] = await rows<{
			frame: unknown
			width: number
			height: number
		}>(
			db,
			sql`select frame, width, height from files where id = ${existingId}`
		)
		// Null, not the rule's output: the rule may change, and a written-down
		// answer would keep today's.
		expect(file.frame).toBeNull()
		expect(defaultFrame(file.width, file.height)).toEqual({
			x: 0,
			y: 0,
			w: 900,
			h: 900
		})
	})

	it("stores a frame as an object, not a string", async () => {
		const id = await insertFile(db, "hash-with-a-frame")
		await db.execute(
			sql`update files set frame = ${sql.raw(
				`'{"x":10,"y":0,"w":800,"h":800}'::jsonb`
			)} where id = ${id}`
		)
		const [file] = await rows<{ frame: { x: number; w: number } }>(
			db,
			sql`select frame from files where id = ${id}`
		)
		expect(file.frame).toEqual({ x: 10, y: 0, w: 800, h: 800 })
	})
})
