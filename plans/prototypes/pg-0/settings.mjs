// node settings.mjs <old|new> [dataDir]  -- encoding, locale, and a few server settings
import { loadEngine } from "./common.mjs"
const [which, dir] = process.argv.slice(2)
const PGlite = await loadEngine(which)
const pg = new PGlite(dir)
await pg.waitReady
const r = await pg.query(`select datname, pg_encoding_to_char(encoding) enc, datcollate, datctype, datlocprovider::text prov from pg_database order by 1`)
console.log(JSON.stringify(r.rows))
const s = await pg.query(`select name, setting from pg_settings where name in ('server_encoding','client_encoding','lc_collate','lc_ctype','TimeZone','DateStyle','IntervalStyle','extra_float_digits','standard_conforming_strings','max_wal_size','fsync','full_page_writes','synchronous_commit','shared_buffers','wal_level','checkpoint_timeout','bytea_output','default_toast_compression') order by 1`)
console.log(JSON.stringify(Object.fromEntries(s.rows.map(x => [x.name, x.setting]))))
console.log(JSON.stringify((await pg.query("select current_user u, current_database() d")).rows[0]))
await pg.close()
