/**
 * 🚧 **The value cascade's registration layers** (R38, R50, PLAN-layering
 * D5; 2026-10-20/21) — which values one pipeline's run reads above its
 * declared defaults, per layer, as stored:
 *
 *  · `instance` — the pipeline's instance values (`instanceValues.ts`): the
 *    administrator's values on this pub, under every other layer (R50);
 *  · `genre` — the genre's defaults' registration of it (its `values`, with
 *    an administrator's change at genre scope over them, A15);
 *  · `preset` — the session's preset's change to that registration, or the
 *    preset's own registration of it;
 *  · `session` — the session's own row for it (the data upgrade's home for a
 *    configuration a session had selected).
 *
 * The registration is the one that started the run when the caller knows it
 * (`registrationKey`), else the first in force that runs this pipeline (a
 * turn-order pipeline registered on nine events has one set of values in
 * practice). A pipeline nothing registers — a session-less card action
 * (portrait, likeness) — reads its declared defaults and its instance
 * values, and nothing else (R50). No configuration is read: configurations
 * are retired (0110).
 *
 * `config/world.ts` pushes these as `OverrideRow`s; the panel reads the same
 * function, so the screen and the run agree.
 */
import { and, eq } from "drizzle-orm"
import { isSettingDecision, type RegistrationValues } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { effectiveRegistrations } from "$lib/server/pipelines/registrations/resolve"
import { baseKeyOf, registers } from "$lib/server/pipelines/registrations/rows"

export interface RegistrationValueLayers {
	/** The registration these are the values of; null when none in force runs the pipeline. */
	key: string | null
	/** 🚧 The pipeline's instance values (R50) — under the genre layer, every pipeline. */
	instance: RegistrationValues | null
	genre: RegistrationValues | null
	preset: RegistrationValues | null
	session: RegistrationValues | null
}

/** Merge two layers' values: node → slot, a slot's value replaced whole. */
function merge(base: RegistrationValues | null, over: RegistrationValues | null): RegistrationValues | null {
	if (!over) return base
	if (!base) return over
	const out: Record<string, Record<string, unknown>> = {}
	for (const [k, v] of Object.entries(base)) out[k] = { ...v }
	for (const [k, v] of Object.entries(over)) out[k] = { ...(out[k] ?? {}), ...v }
	return out
}

const valuesOf = (v: unknown): RegistrationValues | null =>
	v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length
		? (v as RegistrationValues)
		: null

/** The registration layers of one pipeline's values in one session. */
export async function registrationValueLayers(
	db: Db,
	opts: { specSlug: string; specId?: number; sessionId?: number | null; registrationKey?: string | null }
): Promise<RegistrationValueLayers> {
	const { instanceValuesOf } = await import("$lib/server/pipelines/registrations/instanceValues")
	const instance = await instanceValuesOf(db, opts.specSlug)
	let sessionGenre: string | null = null
	if (opts.sessionId != null) {
		const resolved = await effectiveRegistrations(db, opts.sessionId)
		sessionGenre = resolved?.genreId ?? null
		const reg =
			(opts.registrationKey
				? resolved?.effective.find((r) => r.key === opts.registrationKey && r.pipeline === opts.specSlug)
				: undefined) ?? resolved?.effective.find((r) => r.pipeline === opts.specSlug)
		if (resolved && reg) {
			let genre: RegistrationValues | null = null
			for (const row of resolved.rows.genre)
				if (baseKeyOf(row.key) === reg.key && !row.dropped)
					genre = registers(row) ? merge(valuesOf(row.values), genre) : merge(genre, valuesOf(row.values))
			let preset: RegistrationValues | null = null
			for (const row of resolved.rows.preset)
				if (row.key === reg.key && !row.dropped) preset = merge(preset, valuesOf(row.values))
			let session: RegistrationValues | null = null
			for (const row of resolved.rows.session)
				if (row.key === reg.key && !row.dropped) session = merge(session, valuesOf(row.values))
			return { key: reg.key, instance, genre, preset, session }
		}
	}
	// A pipeline the genres' defaults register, run with no session (a
	// panel outside one, a preview) or by a session that does not register
	// it: the genre layer of the genre's own registration of it — the
	// session's genre's when it has one, else the first genre's.
	const { genreValueTargets } = await import("$lib/server/pipelines/registrations/genreValues")
	const targets = await genreValueTargets(db, opts.specSlug)
	if (targets.length) {
		const t = targets.find((x) => x.genreId === sessionGenre) ?? targets[0]!
		const { genreRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
		const reg = (await genreRegistrations(db, t.genreId)).find((r) => r.key === t.key)
		return { key: t.key, instance, genre: reg?.values ?? null, preset: null, session: null }
	}
	// A pipeline nothing registers (R50): its instance values alone.
	return { key: null, instance, genre: null, preset: null, session: null }
}

/** Is this pipeline run by any genre's defaults (and so read through registrations)? */
export async function isRegisteredPipeline(db: Db, specSlug: string): Promise<boolean> {
	const [row] = await db
		.select({ id: schema.registrations.id })
		.from(schema.registrations)
		.where(and(eq(schema.registrations.specSlug, specSlug), eq(schema.registrations.dropped, false)))
		.limit(1)
	return !!row
}

/**
 * A registration's values read per address, against the pipeline's
 * declarations (the inverse of `valuesOfConfigRows`). A slot holding one
 * reference (a prompt, a template, a sampling config, a loadout — a `-ref`
 * control declared once) takes its value whole at that declaration's own
 * address, unless the value is keyed by that address; every other slot's
 * object is path → value (`''` the slot's own address), and anything else
 * is the slot's own address.
 */
export function addressedValues(
	values: RegistrationValues | null,
	decls: ReadonlyArray<{ nodeKey: string; slot: string; path: string; control?: string }>,
	opts: { keepDecisions?: boolean } = {}
): Map<string, unknown> {
	const out = new Map<string, unknown>()
	if (!values) return out
	if (!opts.keepDecisions) {
		// 🚧 A10: a layer may state a value with its decision about the layers
		// below — `{ value, lock?, askAtStart? }`; what a run reads is the
		// value. (The settings form keeps the decision: `keepDecisions`.)
		const kept = addressedValues(values, decls, { keepDecisions: true })
		for (const [k, v] of kept) out.set(k, isSettingDecision(v) ? v.value : v)
		return out
	}
	const plain = (v: unknown): v is Record<string, unknown> =>
		!!v && typeof v === "object" && !Array.isArray(v)
	for (const [nodeKey, slots] of Object.entries(values)) {
		if (!plain(slots)) continue
		for (const [slot, value] of Object.entries(slots)) {
			const at = decls.filter((d) => d.nodeKey === nodeKey && d.slot === slot)
			const single = at.length === 1 ? at[0]! : null
			const reference = !!single && /-ref$/.test(single.control ?? "")
			const keyedByPath =
				plain(value) &&
				(!reference || Object.keys(value).every((k) => k === single!.path || k === ""))
			if (keyedByPath) {
				for (const [path, v] of Object.entries(value)) out.set(`${nodeKey}\u0000${slot}\u0000${path}`, v)
				continue
			}
			out.set(`${nodeKey}\u0000${slot}\u0000${single?.path ?? ""}`, value)
		}
	}
	return out
}

/** One stored value on a registration row, at one address. */
export interface RegistrationValueRef {
	rowId: number
	scopeKind: string
	scopeRef: string
	key: string
	nodeKey: string
	slot: string
	path: string
	value: unknown
}

/** A ref's identity — what a guard is told to ignore. */
export const refKeyOf = (r: Pick<RegistrationValueRef, "rowId" | "nodeKey" | "slot" | "path">): string =>
	`${r.rowId}\u0000${r.nodeKey}\u0000${r.slot}\u0000${r.path}`

/**
 * Every value a registration row stores at one of `slots` — genre, preset and
 * session rows alike, in the shapes `valuesOfConfigRows` writes (a slot whole,
 * or path → value). What the delete guards of shared rows (prompts, context
 * templates, layouts) scan beside the configuration values and overrides: a
 * selection carried into a registration is a reference too (R38), and so is
 * a pipeline's instance value (R50, scope `instance`).
 */
export async function registrationValueRefs(db: Db, slots: readonly string[]): Promise<RegistrationValueRef[]> {
	if (!slots.length) return []
	const want = new Set(slots)
	const rows = await db
		.select({
			id: schema.registrations.id,
			scopeKind: schema.registrations.scopeKind,
			scopeRef: schema.registrations.scopeRef,
			key: schema.registrations.key,
			values: schema.registrations.values
		})
		.from(schema.registrations)
	const out: RegistrationValueRef[] = []
	for (const row of rows) {
		const values = row.values as Record<string, Record<string, unknown>> | null
		if (!values) continue
		for (const [nodeKey, bySlot] of Object.entries(values))
			for (const [slot, cur] of Object.entries(bySlot ?? {})) {
				if (!want.has(slot)) continue
				const base = { rowId: row.id, scopeKind: row.scopeKind, scopeRef: row.scopeRef, key: row.key, nodeKey, slot }
				if (cur && typeof cur === "object" && !Array.isArray(cur))
					for (const [path, value] of Object.entries(cur as Record<string, unknown>))
						out.push({ ...base, path, value })
				else out.push({ ...base, path: "", value: cur })
			}
	}
	// 🚧 R50: a pipeline's instance values hold references too (scope `instance`).
	const { instanceValueRefs } = await import("$lib/server/pipelines/registrations/instanceValues")
	out.push(...(await instanceValueRefs(db, slots)))
	return out
}
