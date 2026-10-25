/**
 * 🚧 **A preset's changes, edited** (PLAN-layering §4, R2, A5, A8; lane 7,
 * 2026-10-21) — the plain half of the admin preset editor. A preset is one
 * set of changes on its genre's defaults: registrations it adds (`register`),
 * the keys it drops (`drop`), and changes to the rest (`change`). Every
 * edit here returns a new changes object; the editor saves it whole
 * (`sessionPresets:update.registrations`), and the server re-derives each
 * key and runs the registration door.
 *
 *  · A registration's **key** is derived from its trigger and pipeline
 *    (A8: `registrationKeyOf`), never typed.
 *  · A genre default's **mode, Allow stacking, caps, when** are a `change`.
 *  · Its **cadence options** cannot be a change (A8: options keep the
 *    identity, but a change row carries none) — the preset registers the
 *    whole routine again under the same key, which replaces the default
 *    (`effectiveRegistrations`: a preset's `register` wins over the genre's).
 *  · **Drop** a genre default, **restore** it, **remove** one the preset added.
 *  · A **when** is built from a derived condition property (A5) — the path
 *    comes from the server's list, never from a person's typing.
 */
import { effectiveRegistrations, registrationKeyOf, type RegistrationDecl } from "@serene-pub/sdk"

export type Changes = Sockets.SessionAdmin.PresetRegistrations
export type Reg = Sockets.SessionAdmin.PresetEditor.Registration
type Prop = Sockets.Sessions.ConditionProps.Prop

type Entry = Record<string, unknown>

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) as T

/** The changes with empty parts left out — `{}` and absent are one fact. */
export function tidy(c: Changes): Changes {
	const out: Changes = {}
	if (c.register?.length) out.register = c.register
	if (c.drop?.length) out.drop = c.drop
	if (c.change?.length) out.change = c.change
	return out
}

/** A registration as the SDK's merge reads it. */
const declOf = (r: Reg | Entry): RegistrationDecl => r as unknown as RegistrationDecl

/**
 * What a session on the preset would run — the genre's defaults with these
 * changes — each marked where it stands: `genre` (untouched), `changed` (a
 * genre default this preset changes or registers again), `preset` (added).
 */
export function effectiveOf(defaults: readonly Reg[], changes: Changes): Array<Reg & { standing: "genre" | "changed" | "preset" }> {
	const changed = new Set((changes.change ?? []).map((c) => String((c as Entry).key)))
	const registered = new Set((changes.register ?? []).map((r) => String((r as Entry).key)))
	const defaultKeys = new Set(defaults.map((d) => d.key))
	const names = new Map(defaults.map((d) => [d.pipeline, d.pipelineName]))
	for (const r of changes.register ?? []) {
		const e = r as Entry
		if (typeof e.pipelineName === "string") names.set(String(e.pipeline), e.pipelineName)
	}
	return effectiveRegistrations(defaults.map(declOf), clone(changes) as never).map((r) => {
		const key = r.key
		// A default the preset registers again (its cadence's options moved) is changed, not added.
		const standing = registered.has(key) ? (defaultKeys.has(key) ? "changed" : "preset") : changed.has(key) ? "changed" : "genre"
		return {
			...(r as unknown as Reg),
			pipelineName: names.get(r.pipeline) ?? r.pipeline,
			standing
		}
	})
}

/** The genre's defaults this preset drops. */
export const droppedOf = (defaults: readonly Reg[], changes: Changes): Reg[] =>
	defaults.filter((d) => (changes.drop ?? []).includes(d.key))

/** Is this key one of the genre's defaults? */
export const isDefault = (defaults: readonly Reg[], key: string): boolean => defaults.some((d) => d.key === key)

/** The fields a change may carry (the SDK's `RegistrationChange`). */
export type ChangeField = "mode" | "allowStacking" | "caps" | "when" | "values" | "order" | "label"

/**
 * Set (or with `undefined` clear) one field of a registration: on the
 * preset's own `register` entry when it has one, else as a `change` of the
 * genre's default. A change left with nothing to say is removed.
 */
export function setField(changes: Changes, key: string, field: ChangeField, value: unknown): Changes {
	const next = clone(changes)
	const reg = (next.register ?? []).find((r) => (r as Entry).key === key) as Entry | undefined
	if (reg) {
		if (value === undefined) delete reg[field]
		else reg[field] = value
		return tidy(next)
	}
	const list = (next.change ?? []) as Entry[]
	let c = list.find((x) => x.key === key)
	if (!c) {
		c = { key }
		list.push(c)
	}
	if (value === undefined) delete c[field]
	else c[field] = value
	next.change = list.filter((x) => Object.keys(x).length > 1)
	return tidy(next)
}

/**
 * Change a routine's cadence options. A genre default is registered again
 * under the same key (its change folded in); one the preset added has its
 * trigger's options replaced.
 */
export function setCadenceOptions(changes: Changes, defaults: readonly Reg[], key: string, options: Record<string, unknown>): Changes {
	const next = clone(changes)
	const register = (next.register ?? []) as Entry[]
	const own = register.find((r) => r.key === key)
	if (own) {
		const t = own.trigger as { family: string; cadence: { id: string; options?: Record<string, unknown> } }
		own.trigger = { ...t, cadence: { id: t.cadence.id, options: { ...options } } }
		next.register = register
		return tidy(next)
	}
	const base = defaults.find((d) => d.key === key)
	if (!base || (base.trigger as { family?: string }).family !== "routine") return changes
	const change = ((next.change ?? []) as Entry[]).find((c) => c.key === key) ?? {}
	const t = base.trigger as { family: string; cadence: { id: string } }
	const { origin: _o, pipelineName: _n, standing: _s, ...decl } = base as Reg & { standing?: unknown }
	const { key: _k, ...changed } = change
	register.push({
		...decl,
		...changed,
		key,
		trigger: { family: "routine", cadence: { id: t.cadence.id, options: { ...options } } }
	})
	next.register = register
	next.change = ((next.change ?? []) as Entry[]).filter((c) => c.key !== key)
	return tidy(next)
}

/** Drop a genre default, or remove a registration this preset added. */
export function dropKey(changes: Changes, defaults: readonly Reg[], key: string): Changes {
	const next = clone(changes)
	next.register = ((next.register ?? []) as Entry[]).filter((r) => r.key !== key)
	next.change = ((next.change ?? []) as Entry[]).filter((c) => c.key !== key)
	if (isDefault(defaults, key) && !(next.drop ?? []).includes(key)) next.drop = [...(next.drop ?? []), key]
	return tidy(next)
}

/** Bring a dropped genre default back. */
export function restoreKey(changes: Changes, key: string): Changes {
	const next = clone(changes)
	next.drop = (next.drop ?? []).filter((k) => k !== key)
	return tidy(next)
}

/** Add a registration — its key derived from what it runs on and what runs (A8). */
export function addRegistration(
	changes: Changes,
	trigger: Record<string, unknown>,
	pipeline: string,
	extra: { mode?: "off" | "review" | "full"; pipelineName?: string } = {}
): { changes: Changes; key: string } {
	const key = registrationKeyOf(trigger as never, pipeline)
	const next = clone(changes)
	next.drop = (next.drop ?? []).filter((k) => k !== key)
	next.register = [
		...((next.register ?? []) as Entry[]).filter((r) => r.key !== key),
		{
			key,
			trigger: clone(trigger),
			pipeline,
			...(extra.mode ? { mode: extra.mode } : {}),
			...(extra.pipelineName ? { pipelineName: extra.pipelineName } : {})
		}
	]
	return { changes: tidy(next), key }
}

/** What the wire carries: `pipelineName` is the editor's, never stored. */
export function forSave(changes: Changes): Changes {
	const next = clone(changes)
	next.register = ((next.register ?? []) as Entry[]).map(({ pipelineName: _n, origin: _o, standing: _s, ...r }) => r)
	return tidy(next)
}

/* ── when (A5) ───────────────────────────────────────────────────────── */

/** The comparisons a condition property's type allows, as the picker says them. */
export type Comparison = "on" | "off" | "is" | "isNot" | "gt" | "gte" | "lt" | "lte"

export const COMPARISONS_BY_TYPE: Record<Prop["type"], ReadonlyArray<{ key: Comparison; label: string }>> = {
	boolean: [
		{ key: "on", label: "is on" },
		{ key: "off", label: "is off" }
	],
	number: [
		{ key: "gt", label: "is more than" },
		{ key: "gte", label: "is at least" },
		{ key: "lt", label: "is less than" },
		{ key: "lte", label: "is at most" },
		{ key: "is", label: "is" }
	],
	enum: [
		{ key: "is", label: "is" },
		{ key: "isNot", label: "is not" }
	],
	string: [
		{ key: "is", label: "is" },
		{ key: "isNot", label: "is not" }
	],
	unknown: [
		{ key: "on", label: "is set" },
		{ key: "is", label: "is" }
	]
}

/** One picked condition: a derived property, how it compares, and to what. */
export interface Picked {
	prop: Prop
	comparison: Comparison
	value?: string | number | boolean | null
}

/** The stored predicate for a picked condition — the property's path, never typed (A5). */
export function conditionOf(p: Picked): Record<string, unknown> {
	const on = p.prop.path
	switch (p.comparison) {
		case "on":
			return { on, truthy: true }
		case "off":
			return { not: { on, truthy: true } }
		case "gt":
		case "gte":
		case "lt":
		case "lte":
			return { on, [p.comparison]: Number(p.value ?? 0) }
		case "isNot":
			return { not: { on, equals: p.value ?? null } }
		case "is":
		default:
			return { on, equals: p.prop.type === "number" ? Number(p.value ?? 0) : (p.value ?? null) }
	}
}

/**
 * A stored `when` read back as one picked condition — or null when it is
 * more than this picker writes (an `all`, an `any`, a path no property of
 * the genre derives), which the editor then shows as it stands.
 */
export function pickedOf(when: unknown, props: readonly Prop[]): Picked | null {
	if (!when || typeof when !== "object") return null
	const w = when as Record<string, unknown>
	const negated = w.not && typeof w.not === "object" ? (w.not as Record<string, unknown>) : null
	const leaf = negated ?? w
	const prop = props.find((p) => p.path === leaf.on)
	if (!prop) return null
	if (leaf.truthy === true) return { prop, comparison: negated ? "off" : "on" }
	if ("equals" in leaf) return { prop, comparison: negated ? "isNot" : "is", value: leaf.equals as Picked["value"] }
	if (negated) return null
	for (const k of ["gt", "gte", "lt", "lte"] as const) if (k in leaf) return { prop, comparison: k, value: leaf[k] as number }
	return null
}

/** A condition in words — _world · weather is Storm_ — for the editor's list. */
export function conditionWords(when: unknown, props: readonly Prop[]): string {
	if (!when) return "Always"
	const p = pickedOf(when, props)
	if (!p) return "A condition this editor cannot show"
	const label = COMPARISONS_BY_TYPE[p.prop.type].find((c) => c.key === p.comparison)?.label ?? p.comparison
	const name = propWords(p.prop.name)
	return p.value === undefined ? `${name} ${label}` : `${name} ${label} ${String(p.value)}`
}

/** A derived property's name as a person reads it: `cast.any.hp` → _any cast member · hp_. */
export function propWords(name: string): string {
	return name
		.replace(/^cast\.any\./, "any cast member · ")
		.replace(/^locations\.any\./, "any place · ")
		.replace(/^world\./, "the world · ")
		.replace(/^fields\./, "setting · ")
		.replace(/\./g, " · ")
}
