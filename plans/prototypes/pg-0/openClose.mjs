// node openClose.mjs <old|new> <dataDir> [sql...]
// Open, optionally run statements, close; report which files changed (names only).
import { loadEngine, dirHash, diffDirHash } from "./common.mjs"
const [which, dir, ...sqls] = process.argv.slice(2)
const PGlite = await loadEngine(which)
const before = dirHash(dir)
const t = performance.now()
const pg = new PGlite(dir)
await pg.waitReady
const openMs = Math.round(performance.now() - t)
for (const s of sqls) await pg.exec(s)
await pg.close()
const after = dirHash(dir)
const d = diffDirHash(before, after)
const groups = {}
for (const f of [...d.changed, ...d.added.map((x) => "+" + x), ...d.removed.map((x) => "-" + x)]) {
  const g = f.replace(/^([+-]?)(base\/\d+|pg_wal|global|pg_xact|pg_multixact|pg_subtrans)\/.*/, "$1$2/*")
  groups[g] = (groups[g] || 0) + 1
}
console.log(JSON.stringify({ openMs, same: before.hash === after.hash, bytesBefore: before.bytes, bytesAfter: after.bytes, changed: d.changed.length, added: d.added.length, removed: d.removed.length, groups }))
