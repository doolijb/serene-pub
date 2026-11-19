// Shared helpers for the PGlite 0.2.17 -> 0.5.15 conversion prototype.
// Every function takes an open PGlite instance; nothing here prints row content.
import { createHash } from "node:crypto"
import { readdirSync, statSync, readFileSync } from "node:fs"
import { join } from "node:path"

export async function loadEngine(which) {
	const mod = which === "old" ? await import("pglite-old") : await import("@electric-sql/pglite")
	return mod.PGlite
}

export const qi = (s) => '"' + s.replace(/"/g, '""') + '"'

export async function userTables(pg) {
	const r = await pg.query(`
		select n.nspname as schema, c.relname as name, c.oid::int as oid
		from pg_class c join pg_namespace n on n.oid = c.relnamespace
		where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema')
		  and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'
		order by 1,2`)
	return r.rows
}

export async function columnsOf(pg, schema, table) {
	const r = await pg.query(
		`select a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
		        a.attgenerated as generated, a.attidentity as identity
		 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
		 where n.nspname=$1 and c.relname=$2 and a.attnum>0 and not a.attisdropped order by a.attnum`,
		[schema, table]
	)
	return r.rows
}

/** Sizes, counts and wire-size risk for every user table. */
export async function inventory(pg, { risk = true } = {}) {
	const out = {}
	const v = await pg.query(`select version() v, current_database() db, current_setting('server_version') sv`)
	out.version = v.rows[0].sv
	out.versionFull = v.rows[0].v
	out.database = v.rows[0].db
	out.databases = (await pg.query(`select datname, pg_database_size(datname)::bigint as bytes from pg_database order by 1`)).rows
	out.schemas = (await pg.query(`select nspname from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema' order by 1`)).rows.map((r) => r.nspname)
	out.tables = []
	for (const t of await userTables(pg)) {
		const f = `${qi(t.schema)}.${qi(t.name)}`
		const c = await pg.query(`select count(*)::bigint n, pg_total_relation_size('${f}')::bigint total, pg_relation_size('${f}')::bigint heap from ${f}`)
		const row = { schema: t.schema, name: t.name, rows: Number(c.rows[0].n), totalBytes: Number(c.rows[0].total), heapBytes: Number(c.rows[0].heap) }
		out.tables.push(row)
	}
	out.tables.sort((a, b) => b.totalBytes - a.totalBytes)
	if (risk) {
		// Wire size of each row in text form (what pg_dump --inserts fetches), the largest
		// row, and the largest window of 100 consecutive rows in heap order (FETCH 100).
		for (const t of out.tables.slice(0, 10)) {
			const f = `${qi(t.schema)}.${qi(t.name)}`
			const r = await pg.query(`
				select coalesce(max(sz),0)::bigint maxrow, coalesce(max(csz),0)::bigint maxcol,
				       coalesce(max(w),0)::bigint max100, coalesce(sum(sz),0)::bigint textbytes
				from (select sz, csz, sum(sz) over (order by ctid rows between 99 preceding and current row) w
				      from (select ctid, octet_length(t::text) sz, pg_column_size(t.*) csz from ${f} t) x) y`)
			Object.assign(t, {
				maxRowTextBytes: Number(r.rows[0].maxrow),
				maxRowStoredBytes: Number(r.rows[0].maxcol),
				max100RowsTextBytes: Number(r.rows[0].max100),
				tableTextBytes: Number(r.rows[0].textbytes)
			})
		}
	}
	out.sequences = await sequences(pg)
	try {
		const l = await pg.query(`select count(*)::int n, max(id)::int maxid, max(created_at)::bigint maxcreated from drizzle.__drizzle_migrations`)
		out.ledger = l.rows[0]
	} catch (e) {
		out.ledger = { error: String(e.message) }
	}
	out.typesUsed = (await pg.query(`
		select format_type(a.atttypid, a.atttypmod) t, count(*)::int n
		from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
		where c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped
		  and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'
		group by 1 order by 2 desc`)).rows
	return out
}

export async function sequences(pg) {
	const seqs = (await pg.query(`
		select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace
		where c.relkind='S' order by 1,2`)).rows
	const res = []
	for (const s of seqs) {
		const r = await pg.query(`select last_value::bigint lv, is_called from ${qi(s.schema)}.${qi(s.name)}`)
		res.push({ schema: s.schema, name: s.name, last_value: Number(r.rows[0].lv), is_called: r.rows[0].is_called })
	}
	return res
}

/** Catalog listing normalised to text, for cross-engine comparison. */
export async function catalog(pg) {
	const ns = `n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'`
	const q = async (sql) => (await pg.query(sql)).rows
	return {
		indexes: await q(`select schemaname||'.'||indexname as k, indexdef as v from pg_indexes where schemaname not in ('pg_catalog','information_schema') order by 1`),
		constraints: await q(`select n.nspname||'.'||cl.relname||'.'||c.conname as k, c.contype::text||' '||pg_get_constraintdef(c.oid) as v
			from pg_constraint c join pg_class cl on cl.oid=c.conrelid join pg_namespace n on n.oid=cl.relnamespace where ${ns} order by 1`),
		columns: await q(`select n.nspname||'.'||c.relname||'.'||a.attname as k,
			format_type(a.atttypid,a.atttypmod)||' null='||(not a.attnotnull)||' default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'')||' gen='||a.attgenerated::text||' ident='||a.attidentity::text as v
			from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
			left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
			where c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped and ${ns} order by 1`),
		enums: await q(`select n.nspname||'.'||t.typname as k, string_agg(e.enumlabel, ',' order by e.enumsortorder) as v
			from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace group by 1 order by 1`),
		extensions: await q(`select extname as k, extversion as v from pg_extension order by 1`),
		views: await q(`select schemaname||'.'||viewname as k, md5(definition) as v from pg_views where schemaname not in ('pg_catalog','information_schema') order by 1`),
		triggers: await q(`select n.nspname||'.'||c.relname||'.'||t.tgname as k, pg_get_triggerdef(t.oid) as v
			from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal order by 1`),
		functions: await q(`select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as k, md5(p.prosrc) as v
			from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${ns} order by 1`),
		sequenceOwners: await q(`select n.nspname||'.'||s.relname as k, coalesce(t.relname||'.'||a.attname,'') as v
			from pg_class s join pg_namespace n on n.oid=s.relnamespace
			left join pg_depend d on d.objid=s.oid and d.classid='pg_class'::regclass and d.deptype in ('a','i')
			left join pg_class t on t.oid=d.refobjid left join pg_attribute a on a.attrelid=d.refobjid and a.attnum=d.refobjsubid
			where s.relkind='S' order by 1`)
	}
}

/**
 * Content hashes per table: an order-independent hash of each row's text form, and
 * per column an order-independent hash of the column's text values (diagnoses which
 * column's text form differs between engines).
 */
export async function contentHashes(pg) {
	const res = {}
	for (const t of await userTables(pg)) {
		const f = `${qi(t.schema)}.${qi(t.name)}`
		const cols = await columnsOf(pg, t.schema, t.name)
		const row = await pg.query(`select coalesce(md5(string_agg(h, '' order by h)),'') h from (select md5(t::text) h from ${f} t) x`)
		const colExprs = cols.map((c, i) => `coalesce(md5(string_agg(md5(coalesce(${qi(c.name)}::text, E'\\\\N')), '' order by md5(coalesce(${qi(c.name)}::text, E'\\\\N')))),'') as c${i}`)
		const perCol = {}
		// Batch columns to keep each statement modest.
		for (let i = 0; i < colExprs.length; i += 12) {
			const part = colExprs.slice(i, i + 12)
			const r = await pg.query(`select ${part.join(", ")} from ${f}`)
			for (let j = 0; j < part.length; j++) perCol[cols[i + j].name] = { type: cols[i + j].type, h: r.rows[0][`c${i + j}`] }
		}
		res[`${t.schema}.${t.name}`] = { row: row.rows[0].h, cols: perCol }
	}
	return res
}

export async function ledgerHash(pg) {
	const r = await pg.query(`select count(*)::int n, md5(string_agg(id::text||':'||hash||':'||created_at::text, ',' order by id)) h from drizzle.__drizzle_migrations`)
	return r.rows[0]
}

/** Hash every file under a directory (path + content), plus counts. */
export function dirHash(dir) {
	const files = []
	const walk = (d) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name)
			if (e.isDirectory()) walk(p)
			else if (e.isFile()) files.push(p)
		}
	}
	walk(dir)
	files.sort()
	const h = createHash("sha256")
	const per = {}
	let bytes = 0
	for (const f of files) {
		const buf = readFileSync(f)
		bytes += buf.length
		const fh = createHash("sha256").update(buf).digest("hex")
		per[f.slice(dir.length + 1)] = fh
		h.update(f.slice(dir.length + 1) + "\0" + fh + "\n")
	}
	return { hash: h.digest("hex"), files: files.length, bytes, per }
}

export function diffDirHash(a, b) {
	const changed = [], added = [], removed = []
	for (const k of Object.keys(a.per)) {
		if (!(k in b.per)) removed.push(k)
		else if (a.per[k] !== b.per[k]) changed.push(k)
	}
	for (const k of Object.keys(b.per)) if (!(k in a.per)) added.push(k)
	return { changed, added, removed }
}

export function rssMB() {
	return Math.round(process.memoryUsage().rss / 1048576)
}

export function now() {
	return performance.now()
}
