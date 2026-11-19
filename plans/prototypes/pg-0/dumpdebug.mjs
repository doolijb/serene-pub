// Debug pgDump protocol exchange against an in-memory old-engine instance (no real data).
import { PGlite } from "pglite-old"
import { pgDump } from "pglite-tools-old/pg_dump"

const pg = new PGlite(process.env.DIR)
await pg.waitReady
if (!process.env.DIR) await pg.exec("create table t (id serial primary key, v text); insert into t (v) values ('a'),('b');")
const orig = pg.execProtocolRawSync.bind(pg)
let n = 0
const FS = pg.Module.FS
let m = 0
for (const k of ["writeFile", "readFile", "unlink", "analyzePath", "open", "close", "read", "write", "stat", "truncate"]) {
	const o = FS[k].bind(FS)
	FS[k] = (...a) => {
		const p = typeof a[0] === "string" ? a[0] : a[0] && a[0].path
		let r, err
		try { r = o(...a) } catch (e) { err = e }
		if (p && String(p).includes("PGSQL") && m++ < 200) console.error("FS", k, p, k === "analyzePath" ? r && r.exists : "", k === "readFile" && r ? r.length : "", k === "writeFile" ? a[1].length + " first=" + a[1][0] : "", err ? "ERR " + (err.code || err.message) : "")
		if (err) throw err
		return r
	}
}
pg.execProtocolRawSync = (h) => {
	const r = orig(h)
	if (n++ < 6) console.error("in", String.fromCharCode(h[0]), h.length, "out", Array.from(r.slice(0, 1)).map((c) => String.fromCharCode(c)).join(""), r.length)
	return r
}
try {
	const f = await pgDump({ pg, args: process.argv.slice(2) })
	console.error("ok bytes", (await f.text()).length)
} catch (e) {
	console.error("ERR", e.message)
}
await pg.close()
