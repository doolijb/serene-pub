// node dumpTrace.mjs <dataDir> [pg_dump args...]
// Like dumpA (via in-memory instance) but records each query pg_dump sends (first 160
// chars of the SQL text: catalog queries, COPY/FETCH statements, table names only;
// never response bodies) and each response size. Prints the last queries on failure.
import { PGlite } from "pglite-old"
import { pgDump } from "pglite-tools-old/pg_dump"

const [dir, ...args] = process.argv.slice(2)
let pg = new PGlite(dir)
await pg.waitReady
const tar = await pg.dumpDataDir("none")
await pg.close()
pg = new PGlite({ loadDataDir: tar })
await pg.waitReady
const orig = pg.execProtocolRawSync.bind(pg)
const log = []
let maxResp = 0, maxRespQ = ""
pg.execProtocolRawSync = (h) => {
	const q = h[0] === 81 ? Buffer.from(h.slice(5, Math.min(h.length - 1, 165))).toString("utf8").replace(/\s+/g, " ") : String.fromCharCode(h[0])
	const entry = { q, inBytes: h.length }
	log.push(entry)
	const r = orig(h)
	entry.outBytes = r.length
	if (r.length > maxResp) { maxResp = r.length; maxRespQ = q }
	return r
}
const t = performance.now()
try {
	const f = await pgDump({ pg, args })
	console.log(JSON.stringify({ ok: true, bytes: f.size, ms: Math.round(performance.now() - t), queries: log.length, maxResp, maxRespQ }))
} catch (e) {
	console.log(JSON.stringify({ ok: false, error: String(e.message).slice(0, 800), ms: Math.round(performance.now() - t), queries: log.length, maxResp, maxRespQ, last: log.slice(-6) }, null, 1))
}
await pg.close()
