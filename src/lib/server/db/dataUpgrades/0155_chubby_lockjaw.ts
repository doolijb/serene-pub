/**
 * 0155 — **core's runtime values leave the `core` annex document; the change
 * records become session imprints** (ST3, owner 2026-11-11: "Move to
 * columns", "a turn owns what it wrote"). The migration adds
 * `sessions.turn_order`, `turn_tally`, `lane_reads` and `ruleset_decks`,
 * creates `session_imprints` and drops `annex_deltas`. Here:
 *
 *  - `before` (inside the anchor's transaction, ahead of the migration's SQL)
 *    copies `annex_deltas` into a temp table that lives to the end of that
 *    transaction, because the migration drops the table;
 *  - `run` moves each session's `annex.core` runtime keys: `turnOrder`,
 *    `turnTally`, `laneReads`, `rulesetDecks` onto their columns (verbatim,
 *    only where the column is still NULL); `rulesetConversions` and
 *    `seatBenches` entries into `session_imprints` rows (`ruleset-conversion`,
 *    `seat-bench`, key `<kind>:<seatId>`), `settled` with `before` NULL when
 *    at or below the session's settle line (the rule of `settledLineOf`:
 *    the greater of `settled_message_id` and the newest message of any applied
 *    scene summary), skipped when the message is not the session's; then
 *    the six keys leave `annex.core`, and an emptied `core` goes;
 *  - each saved annex delta becomes one `annex` row per key whose value or
 *    audience differs between its two sides, in delta-id then key order (the
 *    `core` owner's six runtime keys and the legacy owner
 *    `core:revision-points` are skipped).
 *
 * A second run finds no runtime key left and no temp table: it changes
 * nothing. Raw SQL through `tx`; no app modules.
 */
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"

const RUNTIME_KEYS = [
	"turnOrder",
	"turnTally",
	"laneReads",
	"rulesetDecks",
	"rulesetConversions",
	"seatBenches"
] as const
const COLUMN_OF: Record<string, string> = {
	turnOrder: "turn_order",
	turnTally: "turn_tally",
	laneReads: "lane_reads",
	rulesetDecks: "ruleset_decks"
}
const LEGACY_OWNER = "core:revision-points"
const TEMP = "st3_annex_deltas"

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)
const isInt = (v: unknown): v is number =>
	typeof v === "number" && Number.isInteger(v)

const canonical = (v: unknown): string => {
	if (v === undefined) return "\u0000absent"
	if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`
	if (isPlainObject(v))
		return `{${Object.keys(v)
			.filter((k) => v[k] !== undefined)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
			.join(",")}}`
	return JSON.stringify(v)
}

/** One annex delta's side → the keys that differ between its two sides, as imprint rows' parts. Pure. */
export function annexDeltaKeys(
	owner: string,
	before: unknown,
	after: unknown
): {
	key: string
	before: unknown
	after: unknown
	audienceBefore: string[] | null
	audienceAfter: string[] | null
}[] {
	if (
		owner === LEGACY_OWNER ||
		!isPlainObject(before) ||
		!isPlainObject(after)
	)
		return []
	const side = (s: Record<string, unknown>) => ({
		doc: isPlainObject(s.document) ? s.document : {},
		aud: isPlainObject(s.audiences) ? s.audiences : {}
	})
	const b = side(before)
	const a = side(after)
	const skip =
		owner === "core" ? new Set<string>(RUNTIME_KEYS) : new Set<string>()
	const list = (m: Record<string, unknown>, k: string): string[] | null =>
		Array.isArray(m[k]) ? (m[k] as string[]) : null
	return [
		...new Set([
			...Object.keys(b.doc),
			...Object.keys(a.doc),
			...Object.keys(b.aud),
			...Object.keys(a.aud)
		])
	]
		.filter((k) => !skip.has(k))
		.sort()
		.flatMap((key) => {
			const audienceBefore = list(b.aud, key)
			const audienceAfter = list(a.aud, key)
			if (
				canonical(b.doc[key]) === canonical(a.doc[key]) &&
				canonical(audienceBefore) === canonical(audienceAfter)
			)
				return []
			return [
				{
					key,
					before: b.doc[key],
					after: a.doc[key],
					audienceBefore,
					audienceAfter
				}
			]
		})
}

/** Copy what the migration is about to drop. */
export async function before(tx: MigrationTx): Promise<void> {
	await tx.execute(
		sql.raw(
			`CREATE TEMP TABLE ${TEMP} ON COMMIT DROP AS SELECT * FROM annex_deltas`
		)
	)
}

const wrapped = (v: unknown): string | null =>
	v === undefined ? null : JSON.stringify({ v })

async function upgrade(tx: MigrationTx): Promise<{
	sessions: number
	columns: number
	rows: Record<string, number>
}> {
	const counts = {
		sessions: 0,
		columns: 0,
		rows: { "seat-bench": 0, "ruleset-conversion": 0, annex: 0 } as Record<
			string,
			number
		>
	}

	/** The settle line of every session (the rule of `settledLineOf`), by id. */
	const lines = new Map<number, number | null>()
	const lineRows = rawRows<{ id: number; line: number | null }>(
		await tx.execute(sql`
			SELECT s.id, (
				SELECT max(n) FROM (
					SELECT s.settled_message_id AS n
					UNION ALL
					SELECT sc.closed_at_message_id FROM scenes sc
						WHERE sc.session_id = s.id AND sc.summary_status = 'done'
					UNION ALL
					SELECT e::int FROM scenes sc,
						json_array_elements_text(CASE WHEN json_typeof(sc.selected_message_ids) = 'array' THEN sc.selected_message_ids ELSE '[]'::json END) e
						WHERE sc.session_id = s.id AND sc.summary_status = 'done' AND e ~ '^[0-9]+$'
				) x
			) AS line
			FROM sessions s
		`)
	)
	for (const r of lineRows)
		lines.set(r.id, r.line == null ? null : Number(r.line))

	const insertRow = async (
		sessionId: number,
		messageId: number | null,
		runId: string | null,
		kind: string,
		key: string,
		beforeV: unknown,
		afterV: unknown,
		settled: boolean,
		extra?: {
			ownerVersion: string | null
			audienceBefore: string[] | null
			audienceAfter: string[] | null
			createdAt: string | null
		}
	) => {
		const b = settled ? null : wrapped(beforeV)
		const ab =
			settled || !extra?.audienceBefore
				? null
				: JSON.stringify(extra.audienceBefore)
		const aa = extra?.audienceAfter
			? JSON.stringify(extra.audienceAfter)
			: null
		await tx.execute(sql`
			INSERT INTO session_imprints
				(session_id, message_id, run_id, subject_kind, subject_key, before, after, owner_version,
				 audience_before, audience_after, status, created_at)
			VALUES (${sessionId}, ${messageId}, ${runId}, ${kind}, ${key}, ${b}::jsonb, ${wrapped(afterV)}::jsonb,
				${extra?.ownerVersion ?? null}, ${ab}::jsonb, ${aa}::jsonb,
				${settled ? "settled" : "standing"}, coalesce(${extra?.createdAt ?? null}::timestamp, now()))
		`)
		counts.rows[kind] = (counts.rows[kind] ?? 0) + 1
	}

	// ── 1. The runtime keys of `annex.core` ───────────────────────────────────
	const sessions = rawRows<{ id: number; core: unknown }>(
		await tx.execute(sql`
			SELECT id, annex -> 'core' AS core FROM sessions
			WHERE jsonb_typeof(annex -> 'core') = 'object'
			ORDER BY id
		`)
	).filter(
		(s) =>
			isPlainObject(s.core) &&
			RUNTIME_KEYS.some((k) => k in (s.core as object))
	)

	for (const s of sessions) {
		const core = s.core as Record<string, unknown>
		counts.sessions++
		for (const [key, column] of Object.entries(COLUMN_OF)) {
			if (core[key] == null) continue
			const done = rawRows<{ id: number }>(
				await tx.execute(sql`
					UPDATE sessions SET ${sql.identifier(column)} = ${JSON.stringify(core[key])}::jsonb
					WHERE id = ${s.id} AND ${sql.identifier(column)} IS NULL
					RETURNING id
				`)
			)
			counts.columns += done.length
		}
		const line = lines.get(s.id) ?? null
		const entries: {
			kind: string
			key: string
			e: Record<string, unknown>
		}[] = []
		if (Array.isArray(core.rulesetConversions))
			for (const e of core.rulesetConversions)
				if (
					isPlainObject(e) &&
					isInt(e.messageId) &&
					typeof e.rulesetId === "string"
				)
					entries.push({
						kind: "ruleset-conversion",
						key: e.rulesetId,
						e
					})
		if (Array.isArray(core.seatBenches))
			for (const e of core.seatBenches)
				if (
					isPlainObject(e) &&
					isInt(e.messageId) &&
					isInt(e.seatId) &&
					(e.kind === "character" || e.kind === "player")
				)
					entries.push({
						kind: "seat-bench",
						key: `${e.kind}:${e.seatId}`,
						e
					})
		const ids = [...new Set(entries.map((x) => x.e.messageId as number))]
		const present = new Set(
			ids.length
				? rawRows<{ id: number }>(
						await tx.execute(sql`
							SELECT id FROM session_messages
							WHERE session_id = ${s.id} AND id IN (${sql.join(
								ids.map((i) => sql`${i}`),
								sql`, `
							)})
						`)
					).map((r) => Number(r.id))
				: []
		)
		for (const { kind, key, e } of entries) {
			const messageId = e.messageId as number
			if (!present.has(messageId)) continue
			const from =
				kind === "seat-bench"
					? e.from
					: typeof e.from === "string"
						? e.from
						: undefined
			const to =
				kind === "seat-bench"
					? e.to
					: typeof e.to === "string"
						? e.to
						: undefined
			await insertRow(
				s.id,
				messageId,
				null,
				kind,
				key,
				from,
				to,
				line != null && messageId <= line
			)
		}
		const held = RUNTIME_KEYS.map((k) => sql`- ${k}::text`)
		await tx.execute(sql`
			UPDATE sessions SET annex = CASE
				WHEN (annex -> 'core') ${sql.join(held, sql` `)} = '{}'::jsonb THEN annex - 'core'
				ELSE jsonb_set(annex, '{core}', (annex -> 'core') ${sql.join(held, sql` `)})
			END
			WHERE id = ${s.id}
		`)
	}

	// ── 2. The saved annex deltas ─────────────────────────────────────────────
	const have = rawRows<{ t: string | null }>(
		await tx.execute(
			sql.raw(`SELECT to_regclass('pg_temp.${TEMP}')::text AS t`)
		)
	)
	if (have[0]?.t) {
		const deltas = rawRows<Record<string, unknown>>(
			await tx.execute(
				sql.raw(`
				SELECT d.id, d.session_id, d.message_id, d.owner, d.owner_version, d."before", d."after", d.run_id,
					d.created_at::timestamp::text AS created_at
				FROM ${TEMP} d WHERE EXISTS (SELECT 1 FROM sessions s WHERE s.id = d.session_id)
				ORDER BY d.id
			`)
			)
		)
		for (const d of deltas) {
			const sessionId = Number(d.session_id)
			const messageId = d.message_id == null ? null : Number(d.message_id)
			const line = lines.get(sessionId) ?? null
			for (const k of annexDeltaKeys(String(d.owner), d.before, d.after))
				await insertRow(
					sessionId,
					messageId,
					typeof d.run_id === "string" ? d.run_id : null,
					"annex",
					`${d.owner}/${k.key}`,
					k.before,
					k.after,
					line != null && messageId != null && messageId <= line,
					{
						ownerVersion:
							typeof d.owner_version === "string"
								? d.owner_version
								: null,
						audienceBefore: k.audienceBefore,
						audienceAfter: k.audienceAfter,
						createdAt:
							typeof d.created_at === "string"
								? d.created_at
								: null
					}
				)
		}
		await tx.execute(sql.raw(`DELETE FROM ${TEMP}`))
	}

	if (counts.sessions || Object.values(counts.rows).some(Boolean))
		console.log(
			`[upgrade 0155] moved the runtime keys of ${counts.sessions} session(s) (${counts.columns} column value(s)); filed ${counts.rows["seat-bench"]} seat-bench, ${counts.rows["ruleset-conversion"]} ruleset-conversion and ${counts.rows.annex} annex session imprint(s)`
		)
	return counts
}

export async function run(tx: MigrationTx): Promise<void> {
	await upgrade(tx)
}
