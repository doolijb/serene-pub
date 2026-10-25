/**
 * 0112 — **The Lair, rewritten** (PLAN-lair-build D11, 2026-10-21). No shape
 * change (the anchor migration is drizzle's empty custom file); this carries
 * a Lair session started before the rewrite into the rewritten genre:
 *
 * | from | to |
 * |---|---|
 * | a Lair session that names no preset | the **Rules** preset (`core-lair-default`, the seed key the old default kept) |
 * | `genre_fields.partySpeech` (a session's; a Lair preset's `defaults.genreFields` or `settings`) | removed — every delver posts its own line (R13) |
 * | `genre_fields.trustNarrator` **true** | the keeper routine at **Full** for that session (a session change row on the keeper's registration) or preset (a preset change row); **false** — the default — is the keeper's Review; the key removed either way |
 * | a registration row (any scope) naming `core:spec/lair-respond`, by its key or its pipeline | the same row on `core:spec/lair-reply` (`RENAMED_CORE_IDS`), its node values dropped — the reply's steps are not the old graph's (logged); a row the new key already has wins |
 * | a registration row naming `core:spec/lair-advance-time` | deleted — *Time passes…* left the Lair (logged) |
 * | stored values on the old Lair's own slots — `floor`, `gold`, `stamina`, `trust` | kept, and the session keeps tracking them: one attribute pick per slot, on (the Lair allows custom attributes) |
 *
 * Not moved, on purpose: a room's contents already live on the shared
 * vocabulary's `things`, which IS the inventory slot (`rulesets.common`), so
 * room inventory values stand where they are; `roomsLayer` is on by the
 * Rules preset's defaults, so nothing is written for it. The two retired
 * specs (`lair-respond`, `lair-advance-time`) and their two retired prompt
 * rows are culled at boot (`boot/retiredGenres.ts`). Raw SQL through `tx`;
 * idempotent — a second run finds no old key, no old slug and no old field.
 */
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"
import type { DataUpgradeContext } from "./index"

const LAIR = "core:genre/lair"
const OLD_REPLY = "core:spec/lair-respond"
const NEW_REPLY = "core:spec/lair-reply"
const OLD_REPLY_STEM = "lair-respond"
const NEW_REPLY_STEM = "lair-reply"
const ADVANCE_TIME = "core:spec/lair-advance-time"
/** The old Lair's own slots, still declared so their stored values read (`registry/slots.ts`). */
const OLD_LAIR_SLOTS = ["core:slot/floor@1", "core:slot/gold@1", "core:slot/stamina@1", "core:slot/trust@1"]
/** The fields the rewrite retired. */
const RETIRED_FIELDS = ["partySpeech", "trustNarrator"]

/** What the upgrade did — for the log and the test. */
export interface LairRewriteReport {
	sessionsPreset: number
	fieldsRemoved: number
	keeperFull: number
	registrationsRenamed: number
	registrationsDropped: number
	attributePicks: number
	notCarried: string[]
}

export async function run(tx: MigrationTx, ctx: DataUpgradeContext): Promise<void> {
	const report = await lairRewriteUpgrade(tx, ctx)
	if (report.notCarried.length) console.log(`[0112] the Lair rewrite: ${report.notCarried.join("; ")}`)
}

/** A stored setting's value: a bare value, or `{ value, lock }`. */
const settingValueOf = (v: unknown): unknown =>
	v && typeof v === "object" && !Array.isArray(v) && "value" in (v as Record<string, unknown>)
		? (v as { value: unknown }).value
		: v

const bag = (v: unknown): Record<string, unknown> =>
	v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** The upgrade, with what it did — `run` for the runner, this for the test. */
export async function lairRewriteUpgrade(tx: MigrationTx, _ctx: DataUpgradeContext): Promise<LairRewriteReport> {
	const rows = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> =>
		rawRows<T>(await tx.execute(q))
	const report: LairRewriteReport = {
		sessionsPreset: 0,
		fieldsRemoved: 0,
		keeperFull: 0,
		registrationsRenamed: 0,
		registrationsDropped: 0,
		attributePicks: 0,
		notCarried: []
	}
	const { lairRegistrations } = await import("@serene-pub/core-catalog")
	/** The keeper routine's registration key — read off the catalogue, never spelled. */
	const keeperKey = lairRegistrations().keeper.key

	/** A change row setting the keeper's mode to Full at a scope, unless that scope already says something about it. */
	const keeperOnFull = async (scope: { kind: "session"; id: number } | { kind: "preset"; id: number }) => {
		const ref = String(scope.id)
		const inserted = await rows(sql`INSERT INTO registrations
			(scope_kind, scope_ref, preset_id, session_id, key, dropped, mode, origin)
			VALUES (${scope.kind}, ${ref}, ${scope.kind === "preset" ? scope.id : null}, ${scope.kind === "session" ? scope.id : null},
			 ${keeperKey}, false, 'full', 'upgrade')
			ON CONFLICT (scope_kind, scope_ref, key) DO NOTHING
			RETURNING id`)
		if (inserted.length) report.keeperFull++
	}

	// ── Sessions: the Rules preset, the retired fields, the keeper ─────────
	const [rules] = await rows<{ id: number }>(
		sql`SELECT id FROM session_presets WHERE seed_key = 'core-lair-default' ORDER BY id LIMIT 1`
	)
	if (rules) {
		const named = await rows(
			sql`UPDATE sessions SET preset_id = ${rules.id} WHERE genre_id = ${LAIR} AND preset_id IS NULL RETURNING id`
		)
		report.sessionsPreset = named.length
	}
	const sessions = await rows<{ id: number; genre_fields: unknown }>(
		sql`SELECT id, genre_fields FROM sessions WHERE genre_id = ${LAIR} ORDER BY id`
	)
	for (const s of sessions) {
		const fields = bag(typeof s.genre_fields === "string" ? JSON.parse(s.genre_fields) : s.genre_fields)
		if (!RETIRED_FIELDS.some((k) => k in fields)) continue
		if (settingValueOf(fields.trustNarrator) === true) await keeperOnFull({ kind: "session", id: s.id })
		const kept = Object.fromEntries(Object.entries(fields).filter(([k]) => !RETIRED_FIELDS.includes(k)))
		await tx.execute(sql`UPDATE sessions SET genre_fields = ${JSON.stringify(kept)}::json WHERE id = ${s.id}`)
		report.fieldsRemoved++
	}

	// ── Lair presets: the same two fields, in their defaults and settings ──
	const presets = await rows<{ id: number; defaults: unknown; settings: unknown }>(
		sql`SELECT id, defaults, settings FROM session_presets WHERE genre_id = ${LAIR} ORDER BY id`
	)
	for (const p of presets) {
		const parse = (v: unknown) => bag(typeof v === "string" ? JSON.parse(v) : v)
		const defaults = parse(p.defaults)
		const genreFields = bag(defaults.genreFields)
		const settings = parse(p.settings)
		const said = [genreFields, settings].some((f) => RETIRED_FIELDS.some((k) => k in f))
		if (!said) continue
		if ([genreFields, settings].some((f) => settingValueOf(f.trustNarrator) === true))
			await keeperOnFull({ kind: "preset", id: p.id })
		const strip = (f: Record<string, unknown>) =>
			Object.fromEntries(Object.entries(f).filter(([k]) => !RETIRED_FIELDS.includes(k)))
		const nextDefaults = p.defaults == null ? null : { ...defaults, ...("genreFields" in defaults ? { genreFields: strip(genreFields) } : {}) }
		const nextSettings = p.settings == null ? null : strip(settings)
		await tx.execute(sql`UPDATE session_presets
			SET defaults = ${nextDefaults === null ? null : JSON.stringify(nextDefaults)}::json,
			    settings = ${nextSettings === null ? null : JSON.stringify(nextSettings)}::json
			WHERE id = ${p.id}`)
		report.fieldsRemoved++
	}

	// ── Registrations naming the old reply: onto the new one ───────────────
	const old = await rows<{ id: number; scope_kind: string; scope_ref: string; key: string; spec_slug: string | null; values: unknown }>(
		sql`SELECT id, scope_kind, scope_ref, key, spec_slug, "values" FROM registrations
			WHERE spec_slug = ${OLD_REPLY} OR key LIKE ${`%${OLD_REPLY_STEM}%`} ORDER BY id`
	)
	for (const r of old) {
		const key = r.key.split(OLD_REPLY_STEM).join(NEW_REPLY_STEM)
		const [taken] = await rows<{ id: number }>(
			sql`SELECT id FROM registrations WHERE scope_kind = ${r.scope_kind} AND scope_ref = ${r.scope_ref} AND key = ${key} AND id <> ${r.id} LIMIT 1`
		)
		if (taken) {
			await tx.execute(sql`DELETE FROM registrations WHERE id = ${r.id}`)
			report.notCarried.push(`${r.scope_kind} ${r.scope_ref}: '${r.key}' dropped — '${key}' already stands`)
			continue
		}
		if (r.values != null) report.notCarried.push(`${r.scope_kind} ${r.scope_ref}: the old reply's step values on '${r.key}' not carried`)
		await tx.execute(sql`UPDATE registrations
			SET key = ${key}, spec_slug = ${r.spec_slug === OLD_REPLY ? NEW_REPLY : r.spec_slug}, "values" = NULL
			WHERE id = ${r.id}`)
		report.registrationsRenamed++
	}
	const gone = await rows<{ id: number; scope_kind: string; scope_ref: string; key: string }>(
		sql`DELETE FROM registrations WHERE spec_slug = ${ADVANCE_TIME} OR key LIKE ${"%lair-advance-time%"}
			RETURNING id, scope_kind, scope_ref, key`
	)
	report.registrationsDropped = gone.length
	for (const g of gone) report.notCarried.push(`${g.scope_kind} ${g.scope_ref}: '${g.key}' dropped — Time passes… left the Lair`)

	// ── The old Lair's own slots: still tracked where a session holds values ─
	const held = await rows<{ session_id: number; slot_id: string }>(
		sql`SELECT DISTINCT v.session_id, v.slot_id FROM attribute_values v
			JOIN sessions s ON s.id = v.session_id
			WHERE s.genre_id = ${LAIR} AND v.slot_id IN (${sql.join(OLD_LAIR_SLOTS.map((id) => sql`${id}`), sql`, `)})
			ORDER BY v.session_id, v.slot_id`
	)
	for (const h of held) {
		const made = await rows(sql`INSERT INTO session_attribute_picks (session_id, slot_id, enabled)
			VALUES (${h.session_id}, ${h.slot_id}, true)
			ON CONFLICT (session_id, slot_id) DO NOTHING RETURNING id`)
		report.attributePicks += made.length
	}

	return report
}
