/**
 * The 0130 data upgrade (M0 P2, `plugin-files-to-disk`): every `db` row
 * over 64 KB moves to `<dataDir>/plugins/<id>/<version>/<path>`. Scratch tables
 * with the columns the upgrade touches, so the SQL is what is under test.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rawRows } from "../rawRows"
import { pluginFilesToDisk } from "./0130_m0_sdk_gaps"

let client: PGlite
let db: any
let dataDir: string

const q = (s: string) => db.execute(sql.raw(s))
const rows = async (s: string): Promise<any[]> => rawRows<any>(await q(s))
const upgrade = () => db.transaction(async (tx: any) => pluginFilesToDisk(tx, dataDir))
const exists = (p: string) => stat(p).then(() => true, () => false)

beforeAll(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "sp-0130-"))
}, 60_000)

afterAll(async () => {
	await rm(dataDir, { recursive: true, force: true })
}, 60_000)

beforeEach(async () => {
	client = new PGlite()
	db = drizzle(client)
	await q(`CREATE TABLE plugins (plugin_id text, version text)`)
	await q(
		`CREATE TABLE plugin_files (id serial PRIMARY KEY, plugin_id text, path text, mime text, content text NULL, hash text, bytes int, stored_at text NOT NULL DEFAULT 'db', disk_path text, kind text NOT NULL DEFAULT 'ui')`
	)
	await q(`INSERT INTO plugins VALUES ('acme.x', '2.0.0')`)
}, 60_000)

afterEach(async () => {
	await client.close()
})

const insert = (path: string, bytes: Buffer) =>
	q(
		`INSERT INTO plugin_files (plugin_id, path, mime, content, hash, bytes) VALUES ('acme.x', '${path}', 'application/octet-stream', '${bytes.toString("base64")}', 'h', ${bytes.byteLength})`
	)

describe("0130 plugin files to disk", () => {
	it("moves a 100 KB row to disk and flips it", async () => {
		const data = Buffer.alloc(100 * 1024, 5)
		await insert("assets/a.bin", data)
		expect(await upgrade()).toBe(1)
		const [row] = await rows(`SELECT * FROM plugin_files`)
		expect(row.stored_at).toBe("disk")
		expect(row.content).toBeNull()
		expect(row.disk_path).toBe("plugins/acme.x/2.0.0/assets/a.bin")
		expect((await readFile(join(dataDir, row.disk_path))).equals(data)).toBe(true)
	}, 60_000)

	it("leaves a 1 KB row in the db", async () => {
		await insert("ui/a.html", Buffer.alloc(1024, 1))
		expect(await upgrade()).toBe(0)
		const [row] = await rows(`SELECT * FROM plugin_files`)
		expect(row.stored_at).toBe("db")
		expect(row.content).not.toBeNull()
		expect(await exists(join(dataDir, "plugins/acme.x/2.0.0/ui/a.html"))).toBe(false)
	}, 60_000)

	it("a second run moves nothing", async () => {
		await insert("assets/b.bin", Buffer.alloc(70 * 1024, 2))
		expect(await upgrade()).toBe(1)
		const once = await rows(`SELECT * FROM plugin_files`)
		expect(await upgrade()).toBe(0)
		expect(await rows(`SELECT * FROM plugin_files`)).toEqual(once)
	}, 60_000)
})
