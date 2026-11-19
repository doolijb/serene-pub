// node importB.mjs <exportDir> <newDataDir> <result.json>
// NEW engine only (0.5.15). Restores a Path B export into a NEW directory:
//   pre-data statements -> COPY FROM '/dev/blob' per page (one transaction per table)
//   -> setval for every sequence -> post-data statements. Errors are recorded per statement.
// Never prints row content.
import { readFileSync, openSync, readSync, closeSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { splitSql } from "./splitSql.mjs"
import { qi } from "./common.mjs"

const [expDir, newDir, resultFile] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(join(expDir, "manifest.json"), "utf8"))
const res = { existedBefore: existsSync(newDir), timings: {}, errors: [] }
let peak = 0
const sample = () => (peak = Math.max(peak, process.memoryUsage().rss))
const iv = setInterval(sample, 100)

let t = performance.now()
const pg = new PGlite(newDir)
await pg.waitReady
res.timings.openMs = Math.round(performance.now() - t)

async function runScript(name) {
	// pglite-tools 0.2.4 fakes the startup reply without client_encoding /
	// standard_conforming_strings, so pg_dump writes SQL_ASCII + scs=off headers while
	// copying server expressions (generated columns, defaults) verbatim in scs=on form.
	// Its own literals use E'' when they hold backslashes, so forcing scs=on is safe.
	const text = readFileSync(join(expDir, name), "utf8")
		.replace(/^SET standard_conforming_strings = off;$/m, "SET standard_conforming_strings = on;")
		.replace(/^SET client_encoding = 'SQL_ASCII';$/m, "SET client_encoding = 'UTF8';")
	const stmts = splitSql(text)
	let ok = 0
	for (const s of stmts) {
		try { await pg.exec(s); ok++ }
		catch (e) {
			// statement head only (DDL), never data
			res.errors.push({ phase: name, stmt: s.replace(/\s+/g, " ").slice(0, 120), error: String(e.message).slice(0, 200) })
		}
	}
	return { statements: stmts.length, ok }
}

try {
	t = performance.now()
	res.pre = await runScript("pre.sql")
	res.timings.preMs = Math.round(performance.now() - t)

	t = performance.now()
	let rows = 0
	for (const tb of manifest.tables) {
		const f = `${qi(tb.schema)}.${qi(tb.name)}`
		const cols = tb.columns.map(qi).join(", ")
		const fd = openSync(join(expDir, "data", tb.file), "r")
		try {
			await pg.transaction(async (tx) => {
				for (const p of tb.pages) {
					const buf = Buffer.alloc(p.length)
					readSync(fd, buf, 0, p.length, p.offset)
					const r = await tx.query(`COPY ${f} (${cols}) FROM '/dev/blob'`, [], { blob: new Blob([buf]) })
					if (r.affectedRows !== p.rows) throw new Error(`rows ${r.affectedRows} != ${p.rows}`)
					rows += r.affectedRows
					sample()
				}
			})
		} catch (e) {
			res.errors.push({ phase: "data", table: `${tb.schema}.${tb.name}`, error: String(e.message).slice(0, 200) })
		} finally { closeSync(fd) }
	}
	res.rowsLoaded = rows
	res.timings.dataMs = Math.round(performance.now() - t)

	t = performance.now()
	for (const s of manifest.sequences) {
		try {
			await pg.query(`select pg_catalog.setval($1, $2, $3)`, [`${qi(s.schema)}.${qi(s.name)}`, s.last_value, s.is_called])
		} catch (e) {
			res.errors.push({ phase: "sequences", seq: `${s.schema}.${s.name}`, error: String(e.message).slice(0, 200) })
		}
	}
	res.timings.seqMs = Math.round(performance.now() - t)

	t = performance.now()
	res.post = await runScript("post.sql")
	res.timings.postMs = Math.round(performance.now() - t)
	// pg_dump's SETs (search_path '', SQL_ASCII, scs off) live only in this session; reset anyway
	await pg.exec("RESET ALL")
	t = performance.now()
	await pg.exec("ANALYZE")
	res.timings.analyzeMs = Math.round(performance.now() - t)
} catch (e) {
	res.fatal = String(e.message).slice(0, 300)
} finally {
	t = performance.now()
	await pg.close()
	res.timings.closeMs = Math.round(performance.now() - t)
	clearInterval(iv)
	sample()
	res.peakRssMB = Math.round(peak / 1048576)
}
writeFileSync(resultFile, JSON.stringify(res, null, 1))
console.log(JSON.stringify({ ...res, errors: res.errors.length, firstErrors: res.errors.slice(0, 8) }))
