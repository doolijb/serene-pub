// node copyWhole.mjs <old|new> <dataDir> <schema.table>
// Does a whole-table COPY TO '/dev/blob' survive a result far past 16 MB? Prints sizes only.
import { loadEngine } from "./common.mjs"
const [which, dir, table] = process.argv.slice(2)
const PGlite = await loadEngine(which)
const pg = new PGlite(dir)
await pg.waitReady
const t = performance.now()
try {
  const r = await pg.query(`COPY ${table} TO '/dev/blob'`)
  console.log(JSON.stringify({ ok: true, rows: r.affectedRows, bytes: r.blob.size, ms: Math.round(performance.now() - t), rssMB: Math.round(process.memoryUsage().rss / 1048576) }))
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e.message).slice(0, 300), ms: Math.round(performance.now() - t) }))
  try { await pg.query("select 1"); console.log("engine still answers") } catch (e2) { console.log("engine dead:", String(e2.message).slice(0, 200)) }
}
await pg.close()
