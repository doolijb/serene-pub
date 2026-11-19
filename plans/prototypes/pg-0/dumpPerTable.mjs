// node dumpPerTable.mjs <dataDir> <out.json> [extra pg_dump args...]
// Old engine via in-memory instance; pgDump data-only for one table at a time, to find
// which tables pg_dump 16 (WASI, pglite-tools 0.2.4) can and cannot dump.
import { writeFileSync } from "node:fs"
import { PGlite } from "pglite-old"
import { pgDump } from "pglite-tools-old/pg_dump"
import { userTables } from "./common.mjs"

const [dir, outFile, ...extra] = process.argv.slice(2)
let pg = new PGlite(dir)
await pg.waitReady
const tar = await pg.dumpDataDir("none")
await pg.close()
pg = new PGlite({ loadDataDir: tar })
await pg.waitReady
const orig = pg.execProtocolRawSync.bind(pg)
let fetched = 0, maxResp = 0, fetches = 0
pg.execProtocolRawSync = (h) => {
	const r = orig(h)
	fetched += r.length
	fetches++
	if (r.length > maxResp) maxResp = r.length
	return r
}
const results = []
const skip = (process.env.SKIP || "").split(",").filter(Boolean)
for (const t of (await userTables(pg)).filter((t) => !skip.includes(`${t.schema}.${t.name}`))) {
	fetched = 0; maxResp = 0; fetches = 0
	const t0 = performance.now()
	const r = { table: `${t.schema}.${t.name}` }
	try {
		const f = await pgDump({ pg, args: [...extra, "-a", "-t", `"${t.schema}"."${t.name}"`] })
		r.ok = true
		r.bytes = f.size
	} catch (e) {
		r.ok = false
		r.error = String(e.message).replace(/DETAIL:.*$/s, "").slice(0, 300)
		try { await pg.exec("ROLLBACK; DEALLOCATE ALL; RESET search_path;") } catch (e2) { r.cleanup = String(e2.message).slice(0, 200) }
	}
	r.ms = Math.round(performance.now() - t0)
	r.respBytes = fetched; r.maxResp = maxResp; r.roundTrips = fetches
	results.push(r)
	console.error(JSON.stringify(r))
}
writeFileSync(outFile, JSON.stringify(results, null, 1))
await pg.close()
