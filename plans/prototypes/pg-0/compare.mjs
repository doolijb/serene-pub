// node compare.mjs <old.json (inspect or manifest)> <new.json (inspect)>
// Compares row counts, content hashes (row and per column), sequences, ledger, catalog.
// Prints only names, counts and kinds of differences.
import { readFileSync } from "node:fs"
const A = JSON.parse(readFileSync(process.argv[2], "utf8"))
const B = JSON.parse(readFileSync(process.argv[3], "utf8"))
const out = {}
const ta = new Map(A.inventory.tables.map((t) => [`${t.schema}.${t.name}`, t]))
const tb = new Map(B.inventory.tables.map((t) => [`${t.schema}.${t.name}`, t]))
out.tables = { old: ta.size, new: tb.size, missing: [...ta.keys()].filter((k) => !tb.has(k)), extra: [...tb.keys()].filter((k) => !ta.has(k)) }
out.rowCountDiffs = [...ta.keys()].filter((k) => tb.has(k) && ta.get(k).rows !== tb.get(k).rows).map((k) => [k, ta.get(k).rows, tb.get(k).rows])
out.totalRows = { old: [...ta.values()].reduce((a, t) => a + t.rows, 0), new: [...tb.values()].reduce((a, t) => a + t.rows, 0) }
out.totalBytes = { old: [...ta.values()].reduce((a, t) => a + t.totalBytes, 0), new: [...tb.values()].reduce((a, t) => a + t.totalBytes, 0) }
const rowHashDiff = [], colDiff = []
for (const [k, h] of Object.entries(A.hashes || {})) {
	const g = B.hashes?.[k]
	if (!g) continue
	if (h.row !== g.row) rowHashDiff.push(k)
	for (const [c, v] of Object.entries(h.cols)) if (g.cols[c]?.h !== v.h) colDiff.push({ table: k, column: c, type: v.type, newType: g.cols[c]?.type })
}
out.rowHashDiffs = rowHashDiff
out.columnHashDiffs = colDiff
out.tablesHashed = Object.keys(A.hashes || {}).length
const sa = new Map(A.inventory.sequences.map((s) => [`${s.schema}.${s.name}`, s]))
const sb = new Map(B.inventory.sequences.map((s) => [`${s.schema}.${s.name}`, s]))
out.sequences = { old: sa.size, new: sb.size, diffs: [...sa.keys()].filter((k) => !sb.has(k) || sa.get(k).last_value !== sb.get(k).last_value || sa.get(k).is_called !== sb.get(k).is_called) }
out.ledger = { old: A.ledgerHash || A.ledger, new: B.ledgerHash, equal: JSON.stringify(A.ledgerHash || A.ledger) === JSON.stringify(B.ledgerHash) }
out.catalog = {}
for (const kind of Object.keys(A.catalog)) {
	const ma = new Map(A.catalog[kind].map((r) => [r.k, r.v]))
	const mb = new Map((B.catalog[kind] || []).map((r) => [r.k, r.v]))
	out.catalog[kind] = {
		old: ma.size, new: mb.size,
		missing: [...ma.keys()].filter((k) => !mb.has(k)),
		extra: [...mb.keys()].filter((k) => !ma.has(k)),
		changed: [...ma.keys()].filter((k) => mb.has(k) && ma.get(k) !== mb.get(k))
	}
}
out.typesUsed = { old: A.inventory.typesUsed?.length, new: B.inventory.typesUsed?.length, equal: JSON.stringify(A.inventory.typesUsed) === JSON.stringify(B.inventory.typesUsed) }
console.log(JSON.stringify(out, null, 1))
