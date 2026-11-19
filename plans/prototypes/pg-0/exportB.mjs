// node exportB.mjs <dataDir> <outDir> [pageBytes=4194304]
// OLD engine only. Path B export:
//  1. schema: pgDump --section=pre-data and --section=post-data (in-memory instance; see dumpA.mjs)
//  2. data: per table, COPY (SELECT <non-generated cols> FROM t WHERE ctid range) TO '/dev/blob',
//     ctid ranges grouped by heap block so each page stays under pageBytes of row text.
//  3. sequences (last_value, is_called), ledger, inventory and content hashes -> manifest.json
// Writes <outDir>/pre.sql, post.sql, data/<n>.copy (one file per table, pages appended),
// manifest.json. Never prints row content.
import { mkdirSync, writeFileSync, openSync, writeSync, closeSync } from "node:fs"
import { join } from "node:path"
import { PGlite } from "pglite-old"
import { pgDump } from "pglite-tools-old/pg_dump"
import { userTables, columnsOf, sequences, inventory, catalog, contentHashes, ledgerHash, qi } from "./common.mjs"

const [dir, outDir, pageArg] = process.argv.slice(2)
const PAGE = Number(pageArg || 4 * 1024 * 1024)
mkdirSync(join(outDir, "data"), { recursive: true })
const timings = {}
let peak = 0
const sample = () => (peak = Math.max(peak, process.memoryUsage().rss))
const iv = setInterval(sample, 100)
let pg
let stopping = false
process.on("SIGTERM", async () => {
	stopping = true
	console.error("SIGTERM: closing instance")
	try { await pg?.close() } catch (e) { console.error("close failed", e.message) }
	process.exit(143)
})

let t = performance.now()
pg = new PGlite(dir)
await pg.waitReady
timings.openMs = Math.round(performance.now() - t)

// --- data first, straight from the on-disk instance -------------------------
const manifest = { pageBytes: PAGE, tables: [] }
t = performance.now()
let fileNo = 0
for (const tb of await userTables(pg)) {
	if (stopping) break
	const f = `${qi(tb.schema)}.${qi(tb.name)}`
	const cols = (await columnsOf(pg, tb.schema, tb.name)).filter((c) => !c.generated)
	const colList = cols.map((c) => qi(c.name)).join(", ")
	// bytes of row text per row, in ctid order; group consecutive rows into pages
	const rows = (await pg.query(
		`select (ctid::text::point)[0]::bigint as b, (ctid::text::point)[1]::int as o, octet_length(t::text)::bigint as bytes
		 from ${f} t order by ctid`
	)).rows
	const pages = []
	let cur = null
	for (const r of rows) {
		const bytes = Number(r.bytes)
		if (cur && cur.bytes + bytes > PAGE) { pages.push(cur); cur = null }
		if (!cur) cur = { from: `(${r.b},${r.o})`, to: null, bytes: 0, n: 0 }
		cur.to = `(${r.b},${r.o})`; cur.bytes += bytes; cur.n++
	}
	if (cur) pages.push(cur)
	const file = `${fileNo++}.copy`
	const fd = openSync(join(outDir, "data", file), "w")
	let offset = 0
	const out = { schema: tb.schema, name: tb.name, columns: cols.map((c) => c.name), file, pages: [], rows: 0 }
	for (const p of pages) {
		const sql = `COPY (SELECT ${colList} FROM ${f} WHERE ctid >= '${p.from}'::tid AND ctid <= '${p.to}'::tid) TO '/dev/blob'`
		const r = await pg.query(sql)
		const buf = Buffer.from(await r.blob.arrayBuffer())
		writeSync(fd, buf)
		out.pages.push({ offset, length: buf.length, rows: r.affectedRows, expectRows: p.n, estBytes: p.bytes })
		if (r.affectedRows !== p.n) throw new Error(`page row mismatch in ${f}: ${r.affectedRows} != ${p.n}`)
		offset += buf.length
		out.rows += r.affectedRows
		sample()
	}
	closeSync(fd)
	out.bytes = offset
	manifest.tables.push(out)
}
timings.dataMs = Math.round(performance.now() - t)

t = performance.now()
manifest.sequences = await sequences(pg)
manifest.ledger = await ledgerHash(pg)
manifest.inventory = await inventory(pg, { risk: false })
manifest.catalog = await catalog(pg)
timings.metaMs = Math.round(performance.now() - t)
t = performance.now()
if (process.env.HASH !== "0") manifest.hashes = await contentHashes(pg)
timings.hashMs = Math.round(performance.now() - t)

// --- schema via pg_dump on an in-memory clone -------------------------------
if (process.env.SCHEMA !== "0") {
t = performance.now()
const tar = await pg.dumpDataDir("none")
await pg.close()
pg = new PGlite({ loadDataDir: tar })
await pg.waitReady
timings.memCloneMs = Math.round(performance.now() - t)
t = performance.now()
for (const section of ["pre-data", "post-data"]) {
	const file = await pgDump({ pg, args: [`--section=${section}`] })
	writeFileSync(join(outDir, section === "pre-data" ? "pre.sql" : "post.sql"), Buffer.from(await file.arrayBuffer()))
}
timings.schemaMs = Math.round(performance.now() - t)
}
await pg.close()
pg = null
clearInterval(iv)
sample()
manifest.timings = timings
manifest.peakRssMB = Math.round(peak / 1048576)
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest))
console.log(JSON.stringify({ timings, peakRssMB: manifest.peakRssMB, tables: manifest.tables.length, rows: manifest.tables.reduce((a, x) => a + x.rows, 0), copyBytes: manifest.tables.reduce((a, x) => a + x.bytes, 0), pages: manifest.tables.reduce((a, x) => a + x.pages.length, 0), maxPage: Math.max(...manifest.tables.flatMap((x) => x.pages.map((p) => p.length))) }))
