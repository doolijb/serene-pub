/**
 * 0108 — **Registrations** (PLAN-layering D7, R2, R24, R33, R38; 2026-10-20).
 * Shape is drizzle's (`registrations`, the run and session columns, the cron
 * caps); this moves what bindings, configurations, action toggles and genre
 * tasks said into the rows that say it now. Nothing is dropped from the old
 * tables — they stay ⏳ unread until the RC1 squash.
 *
 * | from | to |
 * |---|---|
 * | a session's `pipeline_bindings` row on an **event** | the session's rows: the event's registrations it replaced dropped, its pipeline registered (origin `upgrade`) |
 * | a session's binding row on an **action** with an enabled-when override | a session change row carrying it as `when` (R31) |
 * | a **pub** binding row | dropped, logged — no screen ever wrote one (R33) |
 * | `session_functions` off for an action the preset offers | a session row dropping it |
 * | `session_functions` on for an action the preset leaves out | a session row registering it |
 * | an administrator's preset's `bindings` / `included_actions` | its changes on the genre's defaults (`presetChangesOf`) |
 * | a configuration a preset names (a binding's `config`, `config_selections`) | that preset's registration `values` |
 * | a configuration a **session** selected | that session's registration `values` |
 * | a configuration selected **pub-wide**, of a pipeline a genre registers | a change to the genre's defaults (`admin:` row, A15) |
 * | a configuration nobody selected (not shipped) | a **disabled** administrator's preset of its genre, named after it, carrying its values (R38 — no tuning lost) |
 * | a session's `genre_fields.tasks` (and a preset's `settings.tasks`) | routine modes, duty switches, the reply's reading switches, the voices' genre fields (`legacyTasks.ts`); the key removed |
 *
 * The genre's defaults this judges against are core's own (`coreGenreRegistrations()`,
 * which builds without the database) and, for a package genre, its specs'
 * old locks (`legacyGenreDefaults`) — the rows the boot then projects. A
 * shipped preset's changes are its declaration's. Raw SQL through `tx`, as
 * every data upgrade; idempotent (every insert is `ON CONFLICT DO NOTHING`,
 * a converted configuration is keyed `upgrade-config:<id>`).
 */
import { sql } from "drizzle-orm"
import {
	effectiveRegistrations as merge,
	presetChangesOf,
	type EffectiveRegistration,
	type PresetRegistrationChanges,
	type RegistrationDecl
} from "@serene-pub/sdk"
import { rawRows } from "../rawRows"
import type { DataUpgradeContext } from "./index"
import {
	legacyGenreDefaults,
	type LockedSpecRow
} from "$lib/server/pipelines/registrations/genreDefaults"
import {
	actionRegistration,
	actionRegistrationKey,
	eventRegistration,
	genreChangeKey,
	rowOfChange,
	rowOfDecl,
	rowOfDrop,
	rowsOfPresetChanges,
	valuesOfConfigRows,
	type RegistrationInsert,
	type RegistrationScope
} from "$lib/server/pipelines/registrations/rows"
import { tasksAsRegistrations } from "$lib/server/pipelines/registrations/legacyTasks"

const ORIGIN = "upgrade"

type Values = Record<string, Record<string, unknown>>

/** Merge two value sets: node → slot, a slot replaced whole. */
const mergeValues = (a: Values | null | undefined, b: Values | null | undefined): Values | null => {
	if (!b) return a ?? null
	if (!a) return b
	const out: Values = {}
	for (const [k, v] of Object.entries(a)) out[k] = { ...v }
	for (const [k, v] of Object.entries(b)) out[k] = { ...(out[k] ?? {}), ...v }
	return out
}

/** What one run of the upgrade did, for its log line and its test. */
export interface LayeringUpgradeReport {
	sessionRows: number
	presetRows: number
	genreRows: number
	presetsFromConfigs: number
	pubBindingsDropped: number
	notCarried: string[]
}

export async function run(tx: MigrationTx, ctx: DataUpgradeContext): Promise<void> {
	await layeringUpgrade(tx, ctx)
}

/** The upgrade, with what it did — `run` for the runner, this for the test. */
export async function layeringUpgrade(tx: MigrationTx, _ctx: DataUpgradeContext): Promise<LayeringUpgradeReport> {
	const q = (s: string) => tx.execute(sql.raw(s))
	const rows = async <T extends Record<string, unknown>>(s: string): Promise<T[]> => rawRows<T>(await q(s))
	const j = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v))
	const report: LayeringUpgradeReport = {
		sessionRows: 0,
		presetRows: 0,
		genreRows: 0,
		presetsFromConfigs: 0,
		pubBindingsDropped: 0,
		notCarried: []
	}
	const insert = async (r: RegistrationInsert): Promise<boolean> => {
		const res = rawRows(
			await tx.execute(sql`INSERT INTO registrations
				(scope_kind, scope_ref, preset_id, session_id, key, trigger_family, trigger_ref, cadence_options,
				 spec_slug, "when", "values", "order", mode, allow_stacking, caps, dropped, origin, label)
				VALUES (${r.scopeKind}, ${r.scopeRef}, ${r.presetId ?? null}, ${r.sessionId ?? null}, ${r.key},
				 ${r.triggerFamily ?? null}, ${r.triggerRef ?? null}, ${j(r.cadenceOptions)}::jsonb, ${r.specSlug ?? null},
				 ${j(r.when)}::jsonb, ${j(r.values)}::jsonb, ${r.order ?? null}, ${r.mode ?? null}, ${r.allowStacking ?? null},
				 ${j(r.caps)}::jsonb, ${!!r.dropped}, ${r.origin}, ${j(r.label)}::jsonb)
				ON CONFLICT (scope_kind, scope_ref, key) DO NOTHING
				RETURNING id`)
		)
		return res.length > 0
	}

	// ── The genre's defaults this judges against ──────────────────────────
	const { coreGenreRegistrations, corePresetSeeds } = await import("@serene-pub/core-catalog")
	const core = coreGenreRegistrations()
	const locked = (
		await rows<{ slug: string; input_genre: string | null; input_event: string | null; input_events: unknown; contributes: unknown }>(
			`SELECT s.slug, v.input_genre, v.input_event, v.input_events, v.contributes
			 FROM pipeline_specs s JOIN pipeline_spec_versions v ON v.id = s.active_version_id
			 WHERE v.status = 'published' ORDER BY s.id`
		)
	).map(
		(r): LockedSpecRow => ({
			slug: r.slug,
			inputGenre: r.input_genre,
			inputEvent: r.input_event,
			inputEvents: Array.isArray(r.input_events) ? (r.input_events as string[]) : null,
			contributes: r.contributes
		})
	)
	const defaultsCache = new Map<string, readonly RegistrationDecl[]>()
	const defaultsOf = (genreId: string): readonly RegistrationDecl[] => {
		if (!defaultsCache.has(genreId))
			defaultsCache.set(genreId, core[genreId] ?? legacyGenreDefaults(genreId, locked))
		return defaultsCache.get(genreId)!
	}
	const genreIds = [
		...new Set([...Object.keys(core), ...locked.map((s) => s.inputGenre).filter((g): g is string => !!g && !g.includes("@"))])
	]

	// ── Presets ───────────────────────────────────────────────────────────
	type PresetRow = {
		id: number
		seed_key: string | null
		name: string
		genre_id: string
		bindings: Record<string, { spec?: string; config?: number }> | null
		included_actions: string[] | null
		config_selections: Record<string, number> | null
		settings: Record<string, unknown> | null
		is_immutable: boolean
	}
	const presets = await rows<PresetRow>(
		`SELECT id, seed_key, name, genre_id, bindings, included_actions, config_selections, settings, is_immutable
		 FROM session_presets ORDER BY id`
	)
	const seeds = new Map(corePresetSeeds().map((s) => [s.seedKey, s.registrations ?? {}]))
	const bindingsOf = (p: PresetRow) => {
		const out: Record<string, { spec: string; config?: string }> = {}
		for (const [event, b] of Object.entries(p.bindings ?? {}))
			if (b?.spec) out[event] = { spec: b.spec, ...(b.config != null ? { config: String(b.config) } : {}) }
		return out
	}
	const changesOf = (p: PresetRow): PresetRegistrationChanges & { aliasConfigs?: Readonly<Record<string, string>> } => {
		if (p.is_immutable && p.seed_key && seeds.has(p.seed_key)) return seeds.get(p.seed_key)!
		return presetChangesOf(
			{
				bindings: bindingsOf(p) as never,
				...(Array.isArray(p.included_actions)
					? { actions: { include: p.included_actions.filter((k) => String(k).includes("#")) } as never }
					: {})
			},
			defaultsOf(p.genre_id)
		)
	}
	const offeredByPreset = new Map<number, EffectiveRegistration[]>()
	for (const p of presets) offeredByPreset.set(p.id, merge(defaultsOf(p.genre_id), changesOf(p)))
	const offeredOf = (presetId: number | null, genreId: string): EffectiveRegistration[] =>
		(presetId != null ? offeredByPreset.get(presetId) : undefined) ?? merge(defaultsOf(genreId))

	// Configuration values, by id, once.
	const configValues = new Map<number, Values | null>()
	const valuesOfConfig = async (id: number): Promise<Values | null> => {
		if (!configValues.has(id))
			configValues.set(
				id,
				valuesOfConfigRows(
					await rows<{ node_key: string; slot: string; path: string | null; value: unknown }>(
						`SELECT node_key, slot, path, value FROM pipeline_config_values WHERE config_id = ${Number(id)} ORDER BY id`
					).then((rs) => rs.map((r) => ({ nodeKey: r.node_key, slot: r.slot, path: r.path, value: r.value })))
				)
			)
		return configValues.get(id) ?? null
	}
	const configs = await rows<{ id: number; name: string; seed_key: string | null; is_immutable: boolean; slug: string }>(
		`SELECT c.id, c.name, c.seed_key, c.is_immutable, s.slug FROM pipeline_configs c
		 JOIN pipeline_specs s ON s.id = c.spec_id ORDER BY c.id`
	)
	const configById = new Map(configs.map((c) => [c.id, c]))
	/** A configuration that IS the declared defaults reads nothing new. */
	const shipped = (id: number) => {
		const c = configById.get(id)
		return !c || c.seed_key === `pipeline-default:${c.slug}`
	}
	const selected = new Set<number>()

	for (const p of presets) {
		for (const b of Object.values(p.bindings ?? {})) if (b?.config != null) selected.add(Number(b.config))
		for (const id of Object.values(p.config_selections ?? {})) if (id != null) selected.add(Number(id))
		if (p.is_immutable) continue
		// An administrator's preset: its changes, and the configurations it names as values.
		const scope: RegistrationScope = { kind: "preset", presetId: p.id }
		const changes = changesOf(p)
		const out = new Map<string, RegistrationInsert>(rowsOfPresetChanges(changes, scope, ORIGIN).map((r) => [r.key, r]))
		const offered = offeredByPreset.get(p.id) ?? []
		const configFor = new Map<string, number>()
		for (const [key, id] of Object.entries(changes.aliasConfigs ?? {})) configFor.set(key, Number(id))
		for (const [spec, id] of Object.entries(p.config_selections ?? {}))
			for (const r of offered) if (r.pipeline === spec && !configFor.has(r.key)) configFor.set(r.key, Number(id))
		for (const [key, id] of configFor) {
			if (!Number.isInteger(id) || shipped(id)) continue
			const values = await valuesOfConfig(id)
			if (!values) continue
			const had = out.get(key)
			out.set(key, had ? { ...had, values: mergeValues(had.values as Values, values) } : rowOfChange({ key, values: values as never }, scope, ORIGIN))
		}
		// A copy of a shipped preset may pin the retired tasks.
		const pinned = p.settings?.tasks
		if (pinned !== undefined) {
			const t = tasksAsRegistrations(pinned, offered, scope, ORIGIN)
			for (const r of t.rows) {
				const had = out.get(r.key)
				out.set(r.key, had ? { ...had, mode: r.mode ?? had.mode, values: mergeValues(had.values as Values, r.values as Values) } : r)
			}
			report.notCarried.push(...t.notCarried.map((k) => `preset #${p.id} tasks.${k}`))
			const settings = { ...(p.settings ?? {}) } as Record<string, unknown>
			delete settings.tasks
			for (const [f, v] of Object.entries(t.fields)) settings[f] = v
			await tx.execute(sql`UPDATE session_presets SET settings = ${JSON.stringify(settings)}::json WHERE id = ${p.id}`)
		}
		for (const r of out.values()) if (await insert(r)) report.presetRows++
	}

	// ── Sessions ──────────────────────────────────────────────────────────
	const sessions = await rows<{ id: number; genre_id: string; preset_id: number | null; genre_fields: Record<string, unknown> | null }>(
		`SELECT id, genre_id, preset_id, genre_fields FROM sessions ORDER BY id`
	)
	const bindings = await rows<{ scope_kind: string; scope_id: number; genre_id: string; subject: string; spec: string; enabled_when: unknown }>(
		`SELECT b.scope_kind, b.scope_id, b.genre_id, b.subject, s.slug AS spec, b.enabled_when
		 FROM pipeline_bindings b JOIN pipeline_specs s ON s.id = b.spec_id ORDER BY b.id`
	)
	const pubBindings = bindings.filter((b) => b.scope_kind !== "session")
	report.pubBindingsDropped = pubBindings.length
	for (const b of pubBindings)
		console.log(`[data-upgrade 0108] pub binding ${b.genre_id} ${b.subject} → ${b.spec} dropped (R33: pub-level bindings retired)`)
	const functions = await rows<{ session_id: number; genre_id: string; function_key: string; enabled: boolean }>(
		`SELECT session_id, genre_id, function_key, enabled FROM session_functions ORDER BY id`
	)
	const selections = await rows<{ scope_kind: string; scope_id: number; config_id: number | null; slug: string }>(
		`SELECT sel.scope_kind, sel.scope_id, sel.config_id, s.slug FROM pipeline_config_selections sel
		 JOIN pipeline_specs s ON s.id = sel.spec_id ORDER BY sel.id`
	)
	for (const sel of selections) if (sel.config_id != null) selected.add(Number(sel.config_id))

	for (const s of sessions) {
		const scope: RegistrationScope = { kind: "session", sessionId: s.id }
		const offered = offeredOf(s.preset_id, s.genre_id)
		const out = new Map<string, RegistrationInsert>()
		const put = (r: RegistrationInsert) => {
			const had = out.get(r.key)
			out.set(
				r.key,
				had
					? {
							...had,
							...(r.mode ? { mode: r.mode } : {}),
							...(r.when ? { when: r.when } : {}),
							values: mergeValues(had.values as Values, r.values as Values)
						}
					: r
			)
		}
		const offeredOnEvent = (event: string) =>
			offered.filter((r) => r.trigger.family === "event" && r.trigger.event === event)
		const offersAction = (identity: string) =>
			identity.includes(":annex#") ||
			offered.some((r) => r.trigger.family === "action" && r.trigger.action === identity)

		// The session's own bindings (R-6): an event's replaces its pipeline; an action's carries its enabled-when.
		for (const b of bindings) {
			if (b.scope_kind !== "session" || b.scope_id !== s.id || b.genre_id !== s.genre_id) continue
			if (b.subject.startsWith("core:event/") || !b.subject.includes("#")) {
				const reg = eventRegistration(b.subject, b.spec)
				if (offeredOnEvent(b.subject).some((r) => r.key === reg.key)) continue
				for (const r of offeredOnEvent(b.subject)) put({ ...rowOfDrop(r.key, scope, ORIGIN), triggerRef: b.subject })
				put(rowOfDecl(reg, scope, ORIGIN))
				continue
			}
			if (Array.isArray(b.enabled_when))
				put({
					...rowOfChange({ key: actionRegistrationKey(b.subject), when: { all: b.enabled_when } as never }, scope, ORIGIN),
					triggerRef: b.subject
				})
		}

		// The session's action toggles.
		for (const f of functions) {
			if (f.session_id !== s.id || f.genre_id !== s.genre_id || !f.function_key.includes("#")) continue
			const included = offersAction(f.function_key)
			const key =
				offered.find((r) => r.trigger.family === "action" && r.trigger.action === f.function_key)?.key ??
				actionRegistrationKey(f.function_key)
			if (!f.enabled && included) put({ ...rowOfDrop(key, scope, ORIGIN), triggerRef: f.function_key })
			else if (f.enabled && !included) put(rowOfDecl(actionRegistration(f.function_key), scope, ORIGIN))
		}

		// The configurations this session selected.
		for (const sel of selections) {
			if (sel.scope_kind !== "session" || sel.scope_id !== s.id || sel.config_id == null || shipped(sel.config_id)) continue
			const reg = offered.find((r) => r.pipeline === sel.slug)
			if (!reg) {
				report.notCarried.push(`session #${s.id} configuration #${sel.config_id} (${sel.slug} is not registered here)`)
				continue
			}
			const values = await valuesOfConfig(sel.config_id)
			if (values) put(rowOfChange({ key: reg.key, values: values as never }, scope, ORIGIN))
		}

		// The retired tasks.
		const fields = s.genre_fields
		if (fields && typeof fields === "object" && "tasks" in fields) {
			const t = tasksAsRegistrations(fields.tasks, offered, scope, ORIGIN)
			for (const r of t.rows) put(r)
			report.notCarried.push(...t.notCarried.map((k) => `session #${s.id} tasks.${k}`))
			const next = { ...fields } as Record<string, unknown>
			delete next.tasks
			for (const [f, v] of Object.entries(t.fields)) next[f] = v
			await tx.execute(sql`UPDATE sessions SET genre_fields = ${JSON.stringify(next)}::json WHERE id = ${s.id}`)
		}

		for (const r of out.values()) if (await insert(r)) report.sessionRows++
	}

	// ── A configuration selected pub-wide → the genre's defaults (A15) ────
	for (const sel of selections) {
		if (sel.scope_kind !== "pub" || sel.config_id == null || shipped(sel.config_id)) continue
		const values = await valuesOfConfig(sel.config_id)
		if (!values) continue
		let landed = false
		for (const genreId of genreIds)
			for (const reg of defaultsOf(genreId))
				if (reg.pipeline === sel.slug) {
					landed = true
					if (
						await insert(
							rowOfChange({ key: genreChangeKey(reg.key), values: values as never }, { kind: "genre", genreId }, ORIGIN)
						)
					)
						report.genreRows++
				}
		// ⏳ A pipeline no genre registers keeps its pub-wide configuration,
		// read at the genre layer as before (`registrations/values.ts`).
		if (!landed) report.notCarried.push(`pub configuration #${sel.config_id} of ${sel.slug} (read as before)`)
	}

	// ── Nobody's configuration → a disabled administrator's preset (R38) ──
	for (const c of configs) {
		if (c.is_immutable || selected.has(c.id) || shipped(c.id)) continue
		const home = genreIds
			.map((genreId) => ({ genreId, reg: defaultsOf(genreId).find((r) => r.pipeline === c.slug) }))
			.find((h) => !!h.reg)
		if (!home) {
			report.notCarried.push(`configuration #${c.id} '${c.name}' (${c.slug} is in no genre's defaults)`)
			continue
		}
		const values = await valuesOfConfig(c.id)
		const [preset] = rawRows<{ id: number }>(
			await tx.execute(sql`INSERT INTO session_presets
				(seed_key, name, description, genre_id, bindings, config_selections, enabled, is_default, is_immutable)
				VALUES (${`upgrade-config:${c.id}`}, ${c.name},
				 ${`From the configuration '${c.name}' of ${c.slug}, kept when configurations were retired.`},
				 ${home.genreId}, '{}'::json, '{}'::json, false, false, false)
				ON CONFLICT (seed_key) DO NOTHING
				RETURNING id`)
		)
		if (!preset) continue
		report.presetsFromConfigs++
		if (values && (await insert(rowOfChange({ key: home.reg!.key, values: values as never }, { kind: "preset", presetId: preset.id }, ORIGIN))))
			report.presetRows++
	}

	console.log(
		`[data-upgrade 0108] registrations: ${report.sessionRows} session, ${report.presetRows} preset, ` +
			`${report.genreRows} genre row(s); ${report.presetsFromConfigs} configuration(s) kept as disabled presets; ` +
			`${report.pubBindingsDropped} pub binding(s) dropped` +
			(report.notCarried.length ? `; not carried: ${report.notCarried.join("; ")}` : "")
	)
	return report
}
