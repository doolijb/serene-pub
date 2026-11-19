// node dumpA.mjs <dataDir> <out.sql> [extra pg_dump args...]
// Old engine + pglite-tools 0.2.4 pgDump (forces --inserts -j 1).
// pgDump's socket-file handshake fails against a NODEFS (on-disk) instance, so the
// directory is first loaded into an in-memory instance: open dir -> dumpDataDir('none')
// -> close -> new PGlite({ loadDataDir }) -> pgDump.
// MEMDUMP=0 skips the in-memory hop (to reproduce the on-disk failure).
import { writeFileSync } from "node:fs"
import { PGlite } from "pglite-old"
import { pgDump } from "pglite-tools-old/pg_dump"

const [dir, outFile, ...args] = process.argv.slice(2)
const res = { args }
const t0 = performance.now()
let pg = new PGlite(dir)
await pg.waitReady
res.openMs = Math.round(performance.now() - t0)
if (process.env.MEMDUMP !== "0") {
	const t = performance.now()
	const tar = await pg.dumpDataDir("none")
	res.tarBytes = tar.size
	await pg.close()
	pg = new PGlite({ loadDataDir: tar })
	await pg.waitReady
	res.loadToMemoryMs = Math.round(performance.now() - t)
}
process.on("SIGTERM", async () => {
	console.error("SIGTERM received; closing instance")
	try { await pg.close() } catch (e) { console.error("close failed", e.message) }
	process.exit(143)
})
try {
	const t1 = performance.now()
	const file = await pgDump({ pg, args })
	res.dumpMs = Math.round(performance.now() - t1)
	const buf = Buffer.from(await file.arrayBuffer())
	writeFileSync(outFile, buf)
	res.bytes = buf.length
	res.probe = (await pg.query("select 1 as ok")).rows[0].ok
} catch (e) {
	res.error = String(e && e.message ? e.message : e).slice(0, 2000)
	res.errorName = e && e.name
	try { res.probeAfterError = (await pg.query("select 1 as ok")).rows[0].ok } catch (e2) { res.probeAfterError = "FAILED: " + String(e2.message).slice(0, 300) }
} finally {
	res.peakRssMB = Math.round(process.memoryUsage().rss / 1048576)
	try { await pg.close() } catch (e) { res.closeError = String(e.message).slice(0, 300) }
}
console.log(JSON.stringify(res))
