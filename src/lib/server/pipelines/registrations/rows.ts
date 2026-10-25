/**
 * 🚧 **Registrations as rows** (PLAN-layering D7, §11-1; 2026-10-20) — the
 * pure half: a `registrations` row read as the SDK's shapes, and the SDK's
 * shapes written as rows. No database here; `resolve.ts` reads, `write.ts`
 * and `project.ts` write.
 *
 * One row is one of three things, told apart by its columns:
 *
 *  · a **registration** — `trigger_family` and `spec_slug` set: this trigger
 *    runs this pipeline (`RegistrationDecl`);
 *  · a **change** — neither set, `dropped` false: the fields it states
 *    change the lower layer's registration of `key` (`RegistrationChange`);
 *  · a **drop** — `dropped` true: the lower layer's registration of `key`
 *    is switched off at this layer.
 *
 * The key is never typed here: a registration's is derived from its trigger
 * and pipeline (`registrationKeyOf`, A8); a change or a drop names the key of
 * the registration it is about.
 */
import {
	registrationKeyOf,
	type CadenceRef,
	type ConditionDecl,
	type PresetRegistrationChanges,
	type RegistrationChange,
	type RegistrationDecl,
	type RoutineCaps,
	type RoutineMode,
	type SessionRegistrationRow,
	type Trigger
} from "@serene-pub/sdk"
import { and, eq, type SQL } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

export type RegistrationRow = typeof schema.registrations.$inferSelect
export type RegistrationInsert = typeof schema.registrations.$inferInsert

/** Where a row lives: the genre's defaults, a preset's changes, or a session's own rows. */
export type RegistrationScope =
	| { kind: "genre"; genreId: string }
	| { kind: "preset"; presetId: number }
	| { kind: "session"; sessionId: number }

/** The scope columns of a row at `scope`. */
export function scopeColumns(scope: RegistrationScope): Pick<
	RegistrationInsert,
	"scopeKind" | "scopeRef" | "presetId" | "sessionId"
> {
	switch (scope.kind) {
		case "genre":
			return { scopeKind: "genre", scopeRef: scope.genreId, presetId: null, sessionId: null }
		case "preset":
			return { scopeKind: "preset", scopeRef: String(scope.presetId), presetId: scope.presetId, sessionId: null }
		case "session":
			return { scopeKind: "session", scopeRef: String(scope.sessionId), presetId: null, sessionId: scope.sessionId }
	}
}

/** 🚧 The rows at one scope: `scope_kind` and `scope_ref` as `scopeColumns(scope)` derives them — the one derivation (D3). */
export function registrationScopeWhere(scope: RegistrationScope): SQL {
	const c = scopeColumns(scope)
	return and(
		eq(schema.registrations.scopeKind, c.scopeKind!),
		eq(schema.registrations.scopeRef, c.scopeRef!)
	)!
}

const MODES: ReadonlySet<string> = new Set(["off", "review", "full"])
const modeOf = (raw: unknown): RoutineMode | undefined =>
	typeof raw === "string" && MODES.has(raw) ? (raw as RoutineMode) : undefined

/** The trigger a registering row names; null for a change or a drop. */
export function triggerOfRow(row: Pick<RegistrationRow, "triggerFamily" | "triggerRef" | "cadenceOptions">): Trigger | null {
	if (!row.triggerFamily || !row.triggerRef) return null
	switch (row.triggerFamily) {
		case "event":
			return { family: "event", event: row.triggerRef }
		case "action":
			return { family: "action", action: row.triggerRef }
		case "routine":
			return {
				family: "routine",
				cadence: Object.freeze({
					id: row.triggerRef,
					options: Object.freeze({ ...((row.cadenceOptions ?? {}) as Record<string, unknown>) })
				}) as CadenceRef
			}
		default:
			// An open family (LS1) this host does not run yet: kept as data,
			// never resolved into a trigger anything fires.
			return null
	}
}

/** The fields a change may carry, as the SDK spells them. */
function changeFields(row: RegistrationRow): Omit<RegistrationChange, "key"> {
	return {
		...(row.values ? { values: row.values as RegistrationChange["values"] } : {}),
		...(modeOf(row.mode) ? { mode: modeOf(row.mode) } : {}),
		...(row.when ? { when: row.when as unknown as ConditionDecl } : {}),
		...(row.allowStacking != null ? { allowStacking: row.allowStacking } : {}),
		...(row.minAge != null ? { minAge: row.minAge } : {}),
		...(row.caps ? { caps: row.caps as RoutineCaps } : {}),
		...(row.order != null ? { order: row.order } : {}),
		...(row.label != null ? { label: row.label as RegistrationChange["label"] } : {})
	}
}

/** A registering row as the SDK's declaration; null for a change, a drop, or an unknown family. */
export function declOfRow(row: RegistrationRow): RegistrationDecl | null {
	if (row.dropped || !row.specSlug) return null
	const trigger = triggerOfRow(row)
	if (!trigger) return null
	return Object.freeze({
		key: row.key,
		trigger,
		pipeline: row.specSlug,
		...changeFields(row)
	}) as RegistrationDecl
}

/** Is this row a registration (rather than a change or a drop)? */
export const registers = (row: RegistrationRow): boolean =>
	!row.dropped && !!row.triggerFamily && !!row.specSlug

/** A preset's rows as its changes on the genre's defaults (R2). */
export function presetChangesOfRows(rows: readonly RegistrationRow[]): PresetRegistrationChanges {
	const register: RegistrationDecl[] = []
	const drop: string[] = []
	const change: RegistrationChange[] = []
	for (const row of rows) {
		if (row.dropped) {
			drop.push(row.key)
			continue
		}
		const decl = declOfRow(row)
		if (decl) {
			register.push(decl)
			continue
		}
		if (!row.triggerFamily) change.push({ key: row.key, ...changeFields(row) })
	}
	return {
		...(register.length ? { register } : {}),
		...(drop.length ? { drop } : {}),
		...(change.length ? { change } : {})
	}
}

/** A session's rows as the SDK's session layer (§11-1). */
export function sessionRowsOf(rows: readonly RegistrationRow[]): SessionRegistrationRow[] {
	return rows.map((row) => {
		if (row.dropped) return { key: row.key, dropped: true }
		const decl = declOfRow(row)
		if (decl) return { key: row.key, registration: decl, origin: row.origin }
		return { key: row.key, ...changeFields(row) }
	})
}

/** The columns a declaration's own fields fill. */
function fieldColumns(
	d: Partial<Omit<RegistrationChange, "key">>
): Pick<RegistrationInsert, "values" | "mode" | "when" | "allowStacking" | "minAge" | "caps" | "order" | "label"> {
	return {
		values: (d.values as RegistrationInsert["values"]) ?? null,
		mode: d.mode ?? null,
		when: (d.when as unknown as RegistrationInsert["when"]) ?? null,
		allowStacking: d.allowStacking ?? null,
		minAge: d.minAge ?? null,
		caps: (d.caps as RegistrationInsert["caps"]) ?? null,
		order: d.order ?? null,
		label: d.label ?? null
	}
}

/** The trigger's columns. */
function triggerColumns(t: Trigger): Pick<RegistrationInsert, "triggerFamily" | "triggerRef" | "cadenceOptions"> {
	switch (t.family) {
		case "event":
			return { triggerFamily: "event", triggerRef: t.event, cadenceOptions: null }
		case "action":
			return { triggerFamily: "action", triggerRef: t.action, cadenceOptions: null }
		case "routine":
			return {
				triggerFamily: "routine",
				triggerRef: t.cadence.id,
				cadenceOptions: { ...(t.cadence.options ?? {}) }
			}
	}
}

/** A registration, as a row at `scope`. The key is the declaration's (derived by `register()`). */
export function rowOfDecl(decl: RegistrationDecl, scope: RegistrationScope, origin: string): RegistrationInsert {
	return {
		...scopeColumns(scope),
		key: decl.key,
		...triggerColumns(decl.trigger),
		specSlug: decl.pipeline,
		...fieldColumns(decl),
		dropped: false,
		origin
	}
}

/** A change to the lower layer's registration of `change.key`, as a row at `scope`. */
export function rowOfChange(change: RegistrationChange, scope: RegistrationScope, origin: string): RegistrationInsert {
	return {
		...scopeColumns(scope),
		key: change.key,
		triggerFamily: null,
		triggerRef: null,
		cadenceOptions: null,
		specSlug: null,
		...fieldColumns(change),
		dropped: false,
		origin
	}
}

/** The lower layer's registration of `key`, dropped at `scope`. */
export function rowOfDrop(key: string, scope: RegistrationScope, origin: string): RegistrationInsert {
	return {
		...scopeColumns(scope),
		key,
		triggerFamily: null,
		triggerRef: null,
		cadenceOptions: null,
		specSlug: null,
		...fieldColumns({}),
		dropped: true,
		origin
	}
}

/** A preset's changes as rows — registrations, drops, changes, one row per key (the first of two wins, R34). */
export function rowsOfPresetChanges(
	changes: PresetRegistrationChanges,
	scope: RegistrationScope,
	origin: string
): RegistrationInsert[] {
	const out = new Map<string, RegistrationInsert>()
	for (const key of changes.drop ?? []) if (!out.has(key)) out.set(key, rowOfDrop(key, scope, origin))
	for (const c of changes.change ?? []) if (!out.has(c.key)) out.set(c.key, rowOfChange(c, scope, origin))
	for (const d of changes.register ?? []) if (!out.has(d.key)) out.set(d.key, rowOfDecl(d, scope, origin))
	return [...out.values()]
}

/** The key of the registration of an action on its declaring pipeline — `story-narrate#narrate→story-narrate`. */
export function actionRegistrationKey(identity: string): string {
	const hash = identity.lastIndexOf("#")
	return registrationKeyOf({ family: "action", action: identity }, identity.slice(0, hash))
}

/** An action's registration on its declaring pipeline — what a session row that switches it on stores. */
export function actionRegistration(identity: string): RegistrationDecl {
	const hash = identity.lastIndexOf("#")
	const pipeline = identity.slice(0, hash)
	return Object.freeze({
		key: registrationKeyOf({ family: "action", action: identity }, pipeline),
		trigger: { family: "action", action: identity },
		pipeline
	}) as RegistrationDecl
}

/** An event's registration of `pipeline`. */
export function eventRegistration(event: string, pipeline: string): RegistrationDecl {
	return Object.freeze({
		key: registrationKeyOf({ family: "event", event }, pipeline),
		trigger: { family: "event", event },
		pipeline
	}) as RegistrationDecl
}

/** The trigger's event id, when it is an event. */
export const eventOf = (r: { trigger: Trigger }): string | null =>
	r.trigger.family === "event" ? r.trigger.event : null

/** The trigger's action identity, when it is an action. */
export const actionOf = (r: { trigger: Trigger }): string | null =>
	r.trigger.family === "action" ? r.trigger.action : null

/**
 * A retired named configuration's value rows as a registration's `values`
 * (R38): `{ [nodeKey]: { [slot]: value } }`. A slot stated only at its own
 * address (`''`) holds its value whole; a slot stated at paths holds an
 * object of path → value (`{ reading: { params: { scene: false } } }`), its
 * own address under the key `''` when it has both (a step's scripts: the
 * port's chain and a point's). Pure — the data upgrade and the projection
 * of a package preset's configuration share it; `values.ts` reads it back.
 */
export function valuesOfConfigRows(
	rows: ReadonlyArray<{ nodeKey: string; slot: string; path?: string | null; value: unknown }>
): Record<string, Record<string, unknown>> | null {
	const byAddress = new Map<string, Map<string, unknown>>()
	for (const r of rows) {
		const at = `${r.nodeKey}\u0000${r.slot}`
		const paths = byAddress.get(at) ?? new Map<string, unknown>()
		paths.set(r.path ?? "", r.value)
		byAddress.set(at, paths)
	}
	const out: Record<string, Record<string, unknown>> = {}
	for (const [at, paths] of byAddress) {
		const [nodeKey, slot] = at.split("\u0000") as [string, string]
		const node = (out[nodeKey] ??= {})
		node[slot] = paths.size === 1 && paths.has("") ? paths.get("") : Object.fromEntries(paths)
	}
	return Object.keys(out).length ? out : null
}

/**
 * 🚧 An administrator's change to **the genre's defaults** (A15) lives at
 * genre scope beside the projection's own row for the same registration —
 * and a scope holds one row per key — so its key is the registration's with
 * this prefix. The resolver folds it back onto the registration
 * (`baseKeyOf`); nothing else spells it.
 */
export const GENRE_CHANGE_PREFIX = "admin:"

/** The key an administrator's genre-scope change of `key` is stored under. */
export const genreChangeKey = (key: string): string => `${GENRE_CHANGE_PREFIX}${key}`

/** The registration a stored key is about — a genre-scope change's prefix removed. */
export const baseKeyOf = (key: string): string =>
	key.startsWith(GENRE_CHANGE_PREFIX) ? key.slice(GENRE_CHANGE_PREFIX.length) : key
