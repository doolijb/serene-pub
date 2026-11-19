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
import { isDeepStrictEqual } from "node:util"
import { isSettingDecision, type RegistrationValues } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { Decl, VariableKey } from "$lib/server/pipelines/config/panel/types"
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

/**
 * 🚧 The keys of a session's registrations in force that run this pipeline,
 * in order — the session layers its step values live on (A9: one setting,
 * however many triggers run it). Empty when none runs it: the session then
 * has no layer of its own for this pipeline.
 */
export async function sessionRegistrationKeys(db: Db, sessionId: number, specSlug: string): Promise<string[]> {
	const resolved = await effectiveRegistrations(db, sessionId)
	return [...new Set((resolved?.effective ?? []).filter((r) => r.pipeline === specSlug).map((r) => r.key))]
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

/** 🚧 A layer above the session that locks one address (`settingLocksOf`): which layer, and its value there. */
export interface SettingLock {
	layer: "genre" | "preset"
	/**
	 * The value the lock holds (a seed reference unresolved): the locking layer's
	 * value; where that is null, the first non-null value of the layers below it
	 * at that address; undefined when none states one (the caller's declared
	 * default then holds).
	 */
	value: unknown
}

/**
 * 🚧 **Which of one pipeline's addresses a layer above the session locks**
 * (A10: a layer's `{ value, lock: true }`), and at which layer — read as the
 * settings form's rows read the cascade: the genre layer (the genre's
 * defaults' registration, or the pipeline's instance values where that
 * states nothing at the address), then the preset's. The first lock from
 * the top holds: no layer below it is read at that address. Keys are
 * `addressedValues`' (`nodeKey\0slot\0path`). A lock whose own value is null
 * is locked to what lies below it (see `SettingLock.value`).
 *
 * The one rule: the run (`config/world.ts`), the panel
 * (`config/panel/read.ts`) and the settings form's prompt rows skip a lower
 * layer's value at a locked address. A session value stored there is kept,
 * never deleted, so lifting the lock brings it back.
 */
export function settingLocksOf(
	layers: Pick<RegistrationValueLayers, "instance" | "genre" | "preset">,
	decls: Parameters<typeof addressedValues>[1]
): Map<string, SettingLock> {
	const genre = addressedValues(layers.genre, decls, { keepDecisions: true })
	const instance = addressedValues(layers.instance, decls, { keepDecisions: true })
	const preset = addressedValues(layers.preset, decls, { keepDecisions: true })
	const locks = (v: unknown): v is { value: unknown; lock: true } => isSettingDecision(v) && v.lock === true
	const plainOf = (v: unknown) => (isSettingDecision(v) ? v.value : v)
	// The first value a layer states at `k` that is not null, unwrapped.
	const firstBelow = (k: string, below: Array<Map<string, unknown>>): unknown => {
		for (const m of below) {
			const v = plainOf(m.get(k))
			if (v != null) return v
		}
		return undefined
	}
	const held = (k: string, own: unknown, below: Array<Map<string, unknown>>): unknown =>
		own != null ? own : firstBelow(k, below)
	const out = new Map<string, SettingLock>()
	for (const [k, v] of instance) if (!genre.has(k) && locks(v)) out.set(k, { layer: "genre", value: held(k, v.value, []) })
	for (const [k, v] of genre) if (locks(v)) out.set(k, { layer: "genre", value: held(k, v.value, [instance]) })
	for (const [k, v] of preset)
		if (!out.has(k) && locks(v)) out.set(k, { layer: "preset", value: held(k, v.value, [genre, instance]) })
	return out
}

const SEP = "\u0000"
type Address = { nodeKey: string; slot: string; path: string }
const addressKeyOf = (at: Address) => `${at.nodeKey}${SEP}${at.slot}${SEP}${at.path}`

/**
 * 🚧 Which of one pipeline's slots hold a reference the run dereferences,
 * read from its declarations: a prompt (`prompts-ref`), a context template
 * (`context-template-ref`) or a layout (a variables-slot key). Slots by
 * `nodeKey\0slot`; the variable each layout key renders by
 * `nodeKey\0slot\0path`.
 */
export interface ReferenceSlots {
	promptSlots: ReadonlySet<string>
	templateSlots: ReadonlySet<string>
	layoutSlots: ReadonlySet<string>
	layoutVariables: ReadonlyMap<string, string>
}

/** 🚧 A pipeline's `ReferenceSlots`, from its declarations and variable keys. */
export function referenceSlotsOf(
	decls: ReadonlyArray<Pick<Decl, "nodeKey" | "slot" | "control">>,
	variableKeys: ReadonlyArray<Pick<VariableKey, "nodeKey" | "slot" | "path" | "variableId">>
): ReferenceSlots {
	const slotOf = (d: { nodeKey: string; slot: string }) => `${d.nodeKey}${SEP}${d.slot}`
	return {
		promptSlots: new Set(decls.filter((d) => d.control === "prompts-ref").map(slotOf)),
		templateSlots: new Set(decls.filter((d) => d.control === "context-template-ref").map(slotOf)),
		layoutSlots: new Set(variableKeys.map(slotOf)),
		layoutVariables: new Map(variableKeys.map((k) => [`${slotOf(k)}${SEP}${k.path}`, k.variableId]))
	}
}

/**
 * A context template value as the run reads it: an inline template (its
 * `source`, its engine or core's), or the row a reference names. Undefined
 * for anything else, or a reference to no row.
 */
export async function templateOfValue(
	db: Db,
	value: unknown
): Promise<{ source: string; engine: string } | undefined> {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const inline = value as { source?: unknown; engine?: unknown }
		if (typeof inline.source !== "string") return undefined
		const { CORE_TEMPLATE_ENGINE } = await import("$lib/server/pipelines/prompt/renderers")
		return {
			source: inline.source,
			engine: typeof inline.engine === "string" ? inline.engine : CORE_TEMPLATE_ENGINE
		}
	}
	if (typeof value !== "number") return undefined
	const { resolveContextTemplate } = await import("$lib/server/pipelines/entities/contextTemplates")
	return (await resolveContextTemplate(db, value)) ?? undefined
}

/**
 * A layout reference as the run reads it: the row it names, unless that row
 * was written for another variable than the key renders (a stale pick, owner
 * ruling 2026-10-13). Undefined for anything else, or a reference to no row.
 */
export async function layoutOfValue(db: Db, value: unknown, variableId?: string) {
	const { resolveVariableTemplate } = await import("$lib/server/pipelines/entities/variableTemplates")
	const layout =
		typeof value === "number" ? await resolveVariableTemplate(db, value) : null
	return layoutOfValueRow(value, layout, variableId)
}

/**
 * `layoutOfValue` over the layout already resolved from the value
 * (`layoutOfRow`; null or undefined when no row has that id): the layout only
 * for a numeric value, and, when a variable is given, only if it was written
 * for that variable.
 */
export function layoutOfValueRow<L extends { variableId: string }>(
	value: unknown,
	layout: L | null | undefined,
	variableId?: string
): L | undefined {
	if (typeof value !== "number") return undefined
	if (!layout) return undefined
	if (variableId && layout.variableId !== variableId) return undefined
	return layout
}

/** 🚧 What the run reads from one stored value (`readStoredValue`). */
export type StoredValueReading =
	| { kind: "prompt"; fields: Record<string, string> }
	| { kind: "template"; template: { source: string; engine: string } }
	| { kind: "layout"; layout: NonNullable<Awaited<ReturnType<typeof layoutOfValue>>> }
	| { kind: "value"; value: unknown }

/**
 * 🚧 **Would the run use this value?** What the run reads from one stored
 * value at one address of a pipeline, or undefined when it skips it, so the
 * layer below answers there. The one rule: `config/world.ts` reads every
 * layer by it, and the panel, the session-override fold and the attic ask it
 * before they treat a value as set. Skipped:
 *
 *  · `null` (or no value);
 *  · at a prompt slot: a value that is not a row id, or an id naming no
 *    prompt (or a prompt with no fields);
 *  · at a context-template slot: a reference to no template, or an inline
 *    one with no `source`;
 *  · at a layout slot: a reference to no layout, or to one written for
 *    another variable than the key renders.
 *
 * Anything else is read as stored.
 */
export async function readStoredValue(
	db: Db,
	kinds: ReferenceSlots,
	at: Address,
	value: unknown
): Promise<StoredValueReading | undefined> {
	if (value === undefined || value === null) return undefined
	const slotAt = `${at.nodeKey}${SEP}${at.slot}`
	if (kinds.promptSlots.has(slotAt)) {
		if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return undefined
		const { resolvePromptFields } = await import("$lib/server/pipelines/entities/prompts")
		const fields = await resolvePromptFields(db, Number(value))
		return Object.keys(fields).length ? { kind: "prompt", fields } : undefined
	}
	if (kinds.templateSlots.has(slotAt)) {
		const template = await templateOfValue(db, value)
		return template ? { kind: "template", template } : undefined
	}
	if (kinds.layoutSlots.has(slotAt)) {
		const layout = await layoutOfValue(db, value, kinds.layoutVariables.get(`${slotAt}${SEP}${at.path}`))
		return layout ? { kind: "layout", layout } : undefined
	}
	return { kind: "value", value }
}

/**
 * 🚧 One registration key's own session layer at one address: its stored
 * values, and what the run reads there (`readStoredValue`, a seed reference
 * resolved first, as `config/world.ts` reads a layer). `reading` undefined:
 * the run reads nothing of the session's at that address on this key.
 */
export async function sessionLayerAt(
	db: Db,
	opts: {
		specId: number
		specSlug: string
		sessionId: number
		key: string
		decls: Decl[]
		kinds: ReferenceSlots
		at: Address
	}
): Promise<{ values: RegistrationValues | null; reading: StoredValueReading | undefined }> {
	const layers = await registrationValueLayers(db, {
		specSlug: opts.specSlug,
		specId: opts.specId,
		sessionId: opts.sessionId,
		registrationKey: opts.key
	})
	const stated = addressedValues(layers.session, opts.decls)
	const k = addressKeyOf(opts.at)
	if (!stated.has(k)) return { values: layers.session, reading: undefined }
	const { shippedConfigValues } = await import("$lib/server/pipelines/config/named")
	const resolved = await shippedConfigValues(db, opts.specId, opts.specSlug, opts.decls, stated)
	const value = resolved.has(k) ? resolved.get(k) : stated.get(k)
	return { values: layers.session, reading: await readStoredValue(db, opts.kinds, opts.at, value) }
}

/**
 * 🚧 Do `after`'s values read, address by address (`addressedValues`, layer
 * decisions kept), as `before`'s with exactly one change: `at` holding
 * `value`? Asked before a write of one address lands, so it never changes
 * another (a whole-slot write over values held by path would).
 */
export function addsOnlyAt(
	before: RegistrationValues | null,
	after: RegistrationValues | null,
	decls: Parameters<typeof addressedValues>[1],
	at: Address,
	value: unknown
): boolean {
	const was = addressedValues(before, decls, { keepDecisions: true })
	const now = addressedValues(after, decls, { keepDecisions: true })
	const k = addressKeyOf(at)
	if (!now.has(k) || !isDeepStrictEqual(now.get(k), value)) return false
	const others = new Set([...was.keys(), ...now.keys()])
	others.delete(k)
	for (const o of others)
		if (!was.has(o) || !now.has(o) || !isDeepStrictEqual(was.get(o), now.get(o))) return false
	return true
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
