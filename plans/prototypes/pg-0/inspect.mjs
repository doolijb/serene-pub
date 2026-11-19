// node inspect.mjs <old|new> <dataDir> <out.json> [--hashes] [--no-risk] [--dirhash]
// Opens dataDir with the chosen engine (default database), records inventory,
// sequences, ledger, catalog and (optionally) content hashes. Closes cleanly.
import { writeFileSync } from "node:fs"
import { loadEngine, inventory, catalog, contentHashes, ledgerHash, dirHash, diffDirHash, now, rssMB } from "./common.mjs"

const [which, dir, outFile, ...flags] = process.argv.slice(2)
const PGlite = await loadEngine(which)
const out = { engine: which, dir: dir.split("/").slice(-1)[0] }
let before
if (flags.includes("--dirhash")) before = dirHash(dir)
const t0 = now()
const pg = new PGlite(dir)
await pg.waitReady
out.openMs = Math.round(now() - t0)
try {
const t1 = now()
out.inventory = await inventory(pg, { risk: !flags.includes("--no-risk") })
out.inventoryMs = Math.round(now() - t1)
out.catalog = await catalog(pg)
out.ledgerHash = await ledgerHash(pg)
if (flags.includes("--hashes")) {
	const t2 = now()
	out.hashes = await contentHashes(pg)
	out.hashMs = Math.round(now() - t2)
}
out.rssMB = rssMB()
} catch (e) { out.error = String(e.message); console.error("ERROR", e.message) } finally { await pg.close() }
if (before) {
	const after = dirHash(dir)
	out.dirChange = { before: before.hash, after: after.hash, files: before.files, ...diffDirHash(before, after) }
}
writeFileSync(outFile, JSON.stringify(out, null, 1))
console.log(JSON.stringify({ openMs: out.openMs, inventoryMs: out.inventoryMs, hashMs: out.hashMs, rssMB: out.rssMB, version: out.inventory.version, db: out.inventory.database, tables: out.inventory.tables.length, dirChange: out.dirChange && { same: out.dirChange.before === out.dirChange.after, changed: out.dirChange.changed.length, added: out.dirChange.added, removed: out.dirChange.removed } }))
