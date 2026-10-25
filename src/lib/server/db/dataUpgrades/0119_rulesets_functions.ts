/**
 * 0119 — **Rulesets as functions** (PLAN-rulesets-functions D2, D5, lane A1,
 * 2026-10-23). The anchor migration adds `zone_contents` (where zones keep
 * what they hold); this upgrade, in the same transaction:
 *
 * 1. **Rulesets made on the pub → the seven sections.** Each `rulesets`
 *    row's draft and published document is persisted as the SDK reads it
 *    (`rulesetInSections`): stats → attributes, repertoires → entry types,
 *    check methods and selectors → function references, scripts → carried
 *    modules, degrees → outcomes, time/actions/rest → time, compendium →
 *    library, settings/presets/conversions → options. Every other key the
 *    document holds (its `id`, its `version`) is kept. A document already in
 *    sections is left as it is.
 *
 * 2. **List-slot pieces → carried zones.** A session playing a ruleset this
 *    upgrade moved into sections may hold pieces in list slots that name one
 *    of its repertoires (`config.repertoire: '<ruleset>#<repertoire>'`, as the
 *    slot's declaration row says). Each owner's newest such list is copied
 *    into the owner's `carried` zone (`zone_contents`), each piece a **held
 *    entry** stamped from it — a lore piece's `entryId` kept and its title
 *    its name, a library row's name read from the document, an inline
 *    piece's own — so nothing it held is lost whichever way the list slot
 *    reads after. The list rows stay; a type an owner keeps in a list slot
 *    is read there wholly (`rulesets/zones.ts` `carriedOf`), so the copy
 *    never shows twice. An owner who already has a carried zone for the
 *    ruleset is skipped.
 *
 * Raw SQL through `tx`; idempotent — a second run finds every document in
 * sections and every copied owner's carried zone in place.
 */
import { sql } from "drizzle-orm"
import { declaresSections, rulesetInSections } from "@serene-pub/sdk"
import { rawRows } from "../rawRows"
import type { DataUpgradeContext } from "./index"

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v)

/** The keys of the shapes before the sections — what `rulesetInSections` reads and leaves behind. */
const LEGACY_KEYS = ["stats", "repertoires", "selectors", "scripts", "conventions", "difficultyBands", "compendium", "settings", "presets", "conversions"] as const

/** What one document's upgrade did. */
export interface SectionsUpgrade {
	doc: Json
	changed: boolean
	/** The repertoires it had, by id — the entry types they became. */
	repertoires: string[]
}

/** One stored ruleset document in the seven sections (see the module note). Pure; idempotent. */
export function rulesetDocumentInSections(input: unknown): SectionsUpgrade {
	if (!isObject(input)) return { doc: input as Json, changed: false, repertoires: [] }
	const legacy = LEGACY_KEYS.filter((k) => input[k] !== undefined)
	if (!legacy.length) return { doc: input, changed: false, repertoires: [] }
	// Mixed already (a section and a legacy key of another): the SDK reads the two together; persist the reading.
	const kept = Object.fromEntries(Object.entries(input).filter(([k]) => !(LEGACY_KEYS as readonly string[]).includes(k)))
	const sections = rulesetInSections(JSON.parse(JSON.stringify(input))) as unknown as Json
	const doc = JSON.parse(JSON.stringify({ ...kept, ...sections })) as Json
	const repertoires = Array.isArray(input.repertoires) ? (input.repertoires as unknown[]).filter(isObject).map((r) => String(r.id)) : []
	return { doc, changed: JSON.stringify(doc) !== JSON.stringify(input), repertoires }
}

/** A list item that is a piece. */
const isPiece = (v: unknown): v is Json => isObject(v) && (v.kind === "inline" || v.kind === "lore" || v.kind === "compendium")

/** The name a library row of a document says, by entry type and row id. */
function libraryRowName(doc: Json, entryType: string, rowId: string): string | null {
	const lib = (isObject(doc.library) ? doc.library : isObject(doc.compendium) ? doc.compendium : null) as Json | null
	const rows = lib && isObject(lib.rows) ? (lib.rows as Record<string, unknown>)[entryType] : null
	const row = Array.isArray(rows) ? (rows as unknown[]).find((r) => isObject(r) && r.id === rowId) : null
	return isObject(row) && typeof row.name === "string" ? row.name : isObject(row) && isObject(row.props) && typeof (row.props as Json).name === "string" ? String((row.props as Json).name) : null
}

/** A piece as a held entry (D5): a copy stamped from it, its entry id kept. */
function heldOf(piece: Json, entryType: string, titles: ReadonlyMap<number, string>, doc: Json): Json | null {
	const overrides = isObject(piece.overrides) ? piece.overrides : {}
	const count = typeof piece.count === "number" && piece.count > 1 ? { count: Math.trunc(piece.count) } : {}
	if (piece.kind === "inline") {
		const { kind: _k, name, count: _c, ...fields } = piece
		if (typeof name !== "string" || !name) return null
		return { entryId: null, entryType, name, fields, ...count }
	}
	if (piece.kind === "lore" && typeof piece.entryId === "number") {
		const name = (typeof overrides.name === "string" && overrides.name) || titles.get(piece.entryId) || `Entry ${piece.entryId}`
		return { entryId: piece.entryId, entryType, name, fields: { ...overrides }, ...count }
	}
	if (piece.kind === "compendium" && typeof piece.pieceId === "string") {
		const name = (typeof overrides.name === "string" && overrides.name) || libraryRowName(doc, entryType, piece.pieceId) || piece.pieceId
		return { entryId: null, entryType, name, fields: { ...overrides, libraryRow: piece.pieceId }, ...count }
	}
	return null
}

/** What the upgrade did — for the log and the test. */
export interface RulesetsFunctionsReport {
	rows: number
	inSections: string[]
	carried: { sessionId: number; ownerKind: string; ownerId: number; rulesetId: string; entries: number }[]
}

export async function rulesetsFunctionsUpgrade(tx: MigrationTx): Promise<RulesetsFunctionsReport> {
	const report: RulesetsFunctionsReport = { rows: 0, inSections: [], carried: [] }
	const rulesets = rawRows<{ id: number; ruleset_id: string; draft: unknown; published: unknown }>(
		await tx.execute(sql`SELECT id, ruleset_id, draft, published FROM rulesets ORDER BY id`)
	)
	report.rows = rulesets.length
	/** The rulesets moved into sections, each with the repertoires it had and the document its rows are named in. */
	const moved: { rulesetId: string; repertoires: string[]; doc: Json }[] = []
	for (const row of rulesets) {
		const draft = rulesetDocumentInSections(row.draft)
		const published = row.published == null ? null : rulesetDocumentInSections(row.published)
		if (!draft.changed && !published?.changed) continue
		await tx.execute(
			sql`UPDATE rulesets SET draft = ${JSON.stringify(draft.doc)}::jsonb, published = ${published ? JSON.stringify(published.doc) : null}::jsonb WHERE id = ${row.id}`
		)
		report.inSections.push(row.ruleset_id)
		const source = (published?.changed ? row.published : row.draft) as Json
		const repertoires = [...new Set([...(published?.repertoires ?? []), ...draft.repertoires])]
		if (repertoires.length && !declaresSections(source)) moved.push({ rulesetId: row.ruleset_id, repertoires, doc: source })
	}
	for (const m of moved) {
		// The list slots that hold this ruleset's repertoires, as their declaration rows say.
		const slots = rawRows<{ id: string; repertoire: string }>(
			await tx.execute(sql`
				SELECT id, props->'config'->>'repertoire' AS repertoire FROM attribute_declarations
				WHERE props->'config'->>'repertoire' LIKE ${`${m.rulesetId}#%`}
			`)
		).filter((s) => m.repertoires.includes(s.repertoire.slice(s.repertoire.indexOf("#") + 1)))
		if (!slots.length) continue
		const typeOf = new Map(slots.map((s) => [s.id, s.repertoire.slice(s.repertoire.indexOf("#") + 1)]))
		// Each owner's newest list of each slot, in the sessions that play the ruleset.
		const values = rawRows<{ session_id: number; owner_kind: string; owner_id: number; slot_id: string; value: unknown; valid_from_message_id: number | null }>(
			await tx.execute(sql`
				SELECT DISTINCT ON (v.session_id, v.owner_kind, v.owner_id, v.slot_id)
					v.session_id, v.owner_kind, v.owner_id, v.slot_id, v.value, v.valid_from_message_id
				FROM attribute_values v JOIN sessions s ON s.id = v.session_id
				WHERE s.primary_ruleset = ${m.rulesetId} AND v.branch_id IS NULL
					AND v.slot_id IN (${sql.join([...typeOf.keys()].map((id) => sql`${id}`), sql`, `)})
				ORDER BY v.session_id, v.owner_kind, v.owner_id, v.slot_id, v.id DESC
			`)
		)
		const loreIds = new Set<number>()
		for (const v of values) {
			const items = isObject(v.value) && Array.isArray(v.value.v) ? (v.value.v as unknown[]) : []
			for (const i of items) if (isPiece(i) && i.kind === "lore" && typeof i.entryId === "number") loreIds.add(i.entryId)
		}
		const titles = new Map<number, string>()
		if (loreIds.size)
			for (const t of rawRows<{ id: number; title: string | null }>(
				await tx.execute(sql`SELECT id, title FROM lorebook_entries WHERE id IN (${sql.join([...loreIds].map((id) => sql`${id}`), sql`, `)})`)
			))
				if (t.title) titles.set(Number(t.id), t.title)
		const byOwner = new Map<string, { sessionId: number; ownerKind: string; ownerId: number; entries: Json[]; anchor: number | null }>()
		for (const v of values) {
			const items = isObject(v.value) && Array.isArray(v.value.v) ? (v.value.v as unknown[]) : []
			const k = `${v.session_id}|${v.owner_kind}|${v.owner_id}`
			const o = byOwner.get(k) ?? { sessionId: Number(v.session_id), ownerKind: v.owner_kind, ownerId: Number(v.owner_id), entries: [], anchor: null }
			for (const i of items) {
				if (!isPiece(i)) continue
				const held = heldOf(i, typeOf.get(v.slot_id)!, titles, m.doc)
				if (held) o.entries.push(held)
			}
			if (v.valid_from_message_id != null) o.anchor = Math.max(o.anchor ?? 0, Number(v.valid_from_message_id))
			byOwner.set(k, o)
		}
		for (const o of byOwner.values()) {
			if (!o.entries.length) continue
			const [had] = rawRows<{ n: number }>(
				await tx.execute(sql`
					SELECT count(*)::int AS n FROM zone_contents
					WHERE session_id = ${o.sessionId} AND owner_kind = ${o.ownerKind} AND owner_id = ${o.ownerId}
						AND ruleset_id = ${m.rulesetId} AND zone_type = 'carried'
				`)
			)
			if (Number(had?.n ?? 0) > 0) continue
			await tx.execute(sql`
				INSERT INTO zone_contents (session_id, owner_kind, owner_id, ruleset_id, zone_type, entries, valid_from_message_id, updated_by, note)
				VALUES (${o.sessionId}, ${o.ownerKind}, ${o.ownerId}, ${m.rulesetId}, 'carried', ${JSON.stringify(o.entries)}::jsonb, ${o.anchor}, 'upgrade:0119', 'carried over from the list slots')
			`)
			report.carried.push({ sessionId: o.sessionId, ownerKind: o.ownerKind, ownerId: o.ownerId, rulesetId: m.rulesetId, entries: o.entries.length })
		}
	}
	return report
}

export async function run(tx: MigrationTx, _ctx: DataUpgradeContext): Promise<void> {
	const report = await rulesetsFunctionsUpgrade(tx)
	for (const id of report.inSections) console.log(`[0119] ${id}: into the seven sections`)
	for (const c of report.carried) console.log(`[0119] session ${c.sessionId} ${c.ownerKind}:${c.ownerId}: ${c.entries} carried into ${c.rulesetId}'s carried zone`)
}
