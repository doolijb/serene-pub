// node bench.mjs <old|new> <dataDir>
// Representative read queries (counts with joins) and per-statement timing of 1,000
// primary-key reads. Prints counts and timings only.
import { loadEngine } from "./common.mjs"
const [which, dir] = process.argv.slice(2)
const PGlite = await loadEngine(which)
let t = performance.now()
const pg = new PGlite(dir)
await pg.waitReady
const res = { engine: which, openMs: Math.round(performance.now() - t), joins: [] }
const joins = [
	["session_messages x sessions", `select count(*)::int n from session_messages m join sessions s on s.id = m.session_id`],
	["pipeline_run_nodes x pipeline_runs", `select count(*)::int n from pipeline_run_nodes rn join pipeline_runs r on r.id = rn.run_id`],
	["pipeline_edges x pipeline_nodes x2", `select count(*)::int n from pipeline_edges e join pipeline_nodes a on a.id = e.from_node_id join pipeline_nodes b on b.id = e.to_node_id`],
	["message_parts x messages", `select count(*)::int n from message_parts p join messages m on m.id = p.message_id`],
	["pipeline_runs sum(length(text))", `select count(*)::int n, sum(octet_length(r::text))::bigint b from pipeline_runs r`]
]
for (const [name, sql] of joins) {
	t = performance.now()
	try {
		const r = await pg.query(sql)
		res.joins.push({ name, rows: r.rows[0].n, ms: +(performance.now() - t).toFixed(1) })
	} catch (e) { res.joins.push({ name, error: String(e.message).slice(0, 150) }) }
}
async function perStmt(label, sql, params) {
	for (let i = 0; i < 100; i++) await pg.query(sql, params(i)) // warm-up
	const t0 = performance.now()
	for (let i = 0; i < 1000; i++) await pg.query(sql, params(i))
	return { label, msPerStmt: +((performance.now() - t0) / 1000).toFixed(3) }
}
const ids = (await pg.query(`select id from pipeline_run_nodes order by id`)).rows.map((r) => r.id)
const sids = (await pg.query(`select id from session_messages order by id`)).rows.map((r) => r.id)
res.perStatement = []
for (let round = 0; round < 3; round++) {
	res.perStatement.push(await perStmt("select 1", `select 1 as one`, () => []))
	res.perStatement.push(await perStmt("pk read pipeline_run_nodes (id only)", `select id from pipeline_run_nodes where id = $1`, (i) => [ids[(i * 7919) % ids.length]]))
	res.perStatement.push(await perStmt("pk read pipeline_run_nodes (all cols)", `select * from pipeline_run_nodes where id = $1`, (i) => [ids[(i * 7919) % ids.length]]))
	res.perStatement.push(await perStmt("pk read session_messages (id, session_id)", `select id, session_id from session_messages where id = $1`, (i) => [sids[(i * 31) % sids.length]]))
}
res.rssMB = Math.round(process.memoryUsage().rss / 1048576)
await pg.close()
console.log(JSON.stringify(res))
