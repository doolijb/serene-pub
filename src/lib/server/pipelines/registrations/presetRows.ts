/**
 * 🚧 A preset's registration rows, as an administrator writes them
 * (PLAN-layering D4, D7, R2): its changes on its genre's defaults — what
 * `sessionPresets:create` copies (clone = copy the changes, R2) and
 * `sessionPresets:update` saves, and what ⏳ an old client's `bindings`,
 * `includedActions` and `configSelections` are read as.
 */
import { inArray } from "drizzle-orm"
import {
	effectiveRegistrations as mergeRegistrations,
	presetChangesOf,
	registrationKeyOf,
	type PresetRegistrationChanges,
	type RegistrationChange,
	type RegistrationDecl,
	type Trigger
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { genreRegistrations } from "$lib/server/pipelines/registrations/resolve"
import {
	declOfRow,
	presetChangesOfRows,
	rowOfChange,
	rowsOfPresetChanges,
	scopeColumns,
	valuesOfConfigRows,
	type RegistrationInsert
} from "$lib/server/pipelines/registrations/rows"
import { replaceRows, rowsAt } from "$lib/server/pipelines/registrations/write"

/** The origins an administrator's preset rows carry — what a save replaces. */
export const ADMIN_PRESET_ORIGINS = ["admin", "upgrade"] as const

/** A preset's changes as stored — what the wire carries (`PresetRow.registrations`). */
export async function presetChangesOfPreset(db: Db, presetId: number): Promise<PresetRegistrationChanges> {
	return presetChangesOfRows(await rowsAt(db, { kind: "preset", presetId }))
}

const isTrigger = (t: unknown): t is Trigger => {
	const x = t as { family?: unknown; event?: unknown; action?: unknown; cadence?: { id?: unknown } } | null
	if (!x || typeof x !== "object") return false
	if (x.family === "event") return typeof x.event === "string"
	if (x.family === "action") return typeof x.action === "string" && (x.action as string).includes("#")
	if (x.family === "routine") return typeof x.cadence?.id === "string"
	return false
}

const CHANGE_FIELDS = ["values", "mode", "when", "allowStacking", "minAge", "caps", "order", "label"] as const

/**
 * The wire's changes, checked and keyed: a registration's key is re-derived
 * from its trigger and pipeline (A8 — never trusted from the client); a
 * malformed entry is refused by name.
 */
export function normalizePresetChanges(
	raw: { register?: unknown[]; drop?: unknown[]; change?: unknown[] } | null | undefined
): { ok: true; changes: PresetRegistrationChanges } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") return { ok: true, changes: {} }
	const register: RegistrationDecl[] = []
	for (const [i, r] of (raw.register ?? []).entries()) {
		const x = r as Record<string, unknown> | null
		if (!x || !isTrigger(x.trigger) || typeof x.pipeline !== "string" || !x.pipeline)
			return { ok: false, error: `registration ${i + 1} needs a trigger (an event, an action or a cadence) and a pipeline.` }
		const fields = Object.fromEntries(CHANGE_FIELDS.filter((k) => x[k] !== undefined).map((k) => [k, x[k]]))
		register.push({
			key: registrationKeyOf(x.trigger, x.pipeline),
			trigger: x.trigger,
			pipeline: x.pipeline,
			...fields
		} as RegistrationDecl)
	}
	const drop: string[] = []
	for (const k of raw.drop ?? []) {
		if (typeof k !== "string" || !k) return { ok: false, error: "a dropped registration is named by its key." }
		drop.push(k)
	}
	const change: RegistrationChange[] = []
	for (const [i, c] of (raw.change ?? []).entries()) {
		const x = c as Record<string, unknown> | null
		if (!x || typeof x.key !== "string" || !x.key)
			return { ok: false, error: `change ${i + 1} names no registration key.` }
		const fields = Object.fromEntries(CHANGE_FIELDS.filter((k) => x[k] !== undefined).map((k) => [k, x[k]]))
		change.push({ key: x.key, ...fields } as RegistrationChange)
	}
	return {
		ok: true,
		changes: {
			...(register.length ? { register } : {}),
			...(drop.length ? { drop } : {}),
			...(change.length ? { change } : {})
		}
	}
}

/** Save a preset's changes whole — the administrator's rows replaced; a projection's left alone. */
export async function writePresetChanges(
	db: Db,
	presetId: number,
	changes: PresetRegistrationChanges,
	origin: string = "admin"
): Promise<void> {
	const scope = { kind: "preset" as const, presetId }
	await replaceRows(db, scope, rowsOfPresetChanges(changes, scope, origin), [...ADMIN_PRESET_ORIGINS])
}

/** Clone (R2): the source preset's changes copied, as the administrator's own. */
export async function copyPresetChanges(db: Db, fromPresetId: number, toPresetId: number): Promise<void> {
	await writePresetChanges(db, toPresetId, await presetChangesOfPreset(db, fromPresetId), "admin")
}

/**
 * ⏳ An old client's preset form read as changes (D7): `bindings` (event →
 * spec, a binding replacing the event's one pipeline) and `includedActions`
 * (the whole set) over the genre's defaults (`presetChangesOf`), and the
 * configurations they and `configSelections` name becoming the values of
 * the registrations that run those pipelines (R38).
 */
export async function presetChangesFromLegacy(
	db: Db,
	genreId: string,
	legacy: {
		bindings?: Record<string, { spec: string; config?: number | string }> | null
		includedActions?: string[] | null
		configSelections?: Record<string, number> | null
	},
	origin: string = "admin"
): Promise<RegistrationInsert[]> {
	const defaults = (await genreRegistrations(db, genreId)) as RegistrationDecl[]
	const bindings: Record<string, { spec: string; config?: string }> = {}
	for (const [event, b] of Object.entries(legacy.bindings ?? {}))
		if (b?.spec) bindings[event] = { spec: b.spec, ...(b.config != null ? { config: String(b.config) } : {}) }
	const changes = presetChangesOf(
		{
			bindings: bindings as never,
			...(Array.isArray(legacy.includedActions)
				? { actions: { include: legacy.includedActions.filter((k) => k.includes("#")) } as never }
				: {})
		},
		defaults
	)
	const scope = { kind: "preset" as const, presetId: 0 }
	const rows = rowsOfPresetChanges(changes, scope, origin)
	// Configurations named by a binding, then by `configSelections` per spec.
	const configFor = new Map<string, number>()
	for (const [key, id] of Object.entries(changes.aliasConfigs ?? {})) {
		const n = Number(id)
		if (Number.isInteger(n)) configFor.set(key, n)
	}
	const effective = [
		...defaults.filter((d) => !(changes.drop ?? []).includes(d.key)),
		...(changes.register ?? [])
	]
	for (const [spec, id] of Object.entries(legacy.configSelections ?? {}))
		for (const r of effective) if (r.pipeline === spec && !configFor.has(r.key)) configFor.set(r.key, Number(id))
	if (configFor.size) {
		const valueRows = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(inArray(schema.pipelineConfigValues.configId, [...new Set(configFor.values())]))
		for (const [key, configId] of configFor) {
			const values = valuesOfConfigRows((valueRows as any[]).filter((v) => v.configId === configId))
			if (!values) continue
			const at = rows.findIndex((r) => r.key === key)
			if (at >= 0) rows[at] = { ...rows[at]!, values }
			else rows.push(rowOfChange({ key, values }, scope, origin))
		}
	}
	return rows
}

/** ⏳ Write an old client's form as the preset's changes, whole. */
export async function writeLegacyPresetChanges(
	db: Db,
	preset: { id: number; genreId: string },
	legacy: Parameters<typeof presetChangesFromLegacy>[2]
): Promise<void> {
	const rows = await presetChangesFromLegacy(db, preset.genreId, legacy)
	const scope = { kind: "preset" as const, presetId: preset.id }
	await replaceRows(
		db,
		scope,
		rows.map((r) => ({ ...r, ...scopeColumns(scope) })),
		[...ADMIN_PRESET_ORIGINS]
	)
}

/** The registrations a preset's own rows register, as declarations (for a reader that lists them). */
export async function presetOwnRegistrations(db: Db, presetId: number): Promise<RegistrationDecl[]> {
	const rows = await rowsAt(db, { kind: "preset", presetId })
	return rows.map(declOfRow).filter((d): d is RegistrationDecl => !!d)
}

/** Every preset's changes at once, for a list (one query). */
export async function presetChangesByPreset(db: Db, presetIds: number[]): Promise<Map<number, PresetRegistrationChanges>> {
	const out = new Map<number, PresetRegistrationChanges>()
	if (!presetIds.length) return out
	const rows = await db
		.select()
		.from(schema.registrations)
		.where(inArray(schema.registrations.presetId, presetIds))
		.orderBy(schema.registrations.id)
	for (const id of presetIds)
		out.set(id, presetChangesOfRows((rows as any[]).filter((r) => r.presetId === id && r.scopeKind === "preset")))
	return out
}


/**
 * 🚧 **The door for a preset's changes** (§11-2; lane 5b): every
 * registration the preset adds or changes, as it would stand over its
 * genre's defaults, through `registrationDoor` — the pipeline installed and
 * fitting, values on its steps, cadence options and caps in bounds, the
 * genre's envoys. A sentence naming the first error, or null.
 */
export async function presetChangesRefusal(
	db: Db,
	preset: { genreId: string; name: string },
	changes: PresetRegistrationChanges
): Promise<string | null> {
	const touched = new Set([...(changes.register ?? []).map((r) => r.key), ...(changes.change ?? []).map((c) => c.key)])
	if (!touched.size) return null
	const defaults = (await genreRegistrations(db, preset.genreId)) as RegistrationDecl[]
	const standing = mergeRegistrations(defaults, changes)
		.filter((r) => touched.has(r.key))
		.map(({ origin: _o, changedBy: _c, ...d }) => d as RegistrationDecl)
	if (!standing.length) return null
	const { registrationDoor, doorSentence } = await import("$lib/server/pipelines/registrations/door")
	const verdict = await registrationDoor(db, standing, { layer: `preset '${preset.name}'`, genreId: preset.genreId })
	return verdict.errors.length ? doorSentence(verdict.errors) : null
}
