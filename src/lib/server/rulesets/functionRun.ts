/**
 * 🚧 **Function handlers** — the ruleset's function modules run in the rules
 * sandbox, phase by phase (PLAN-rulesets-functions D3, 2026-10-23).
 *
 * A ruleset lists the functions it uses (`rulesetSections(decl).functions`,
 * its own or ⏳ read from the shapes before sections). Each reference
 * resolves to a module — carried by the ruleset, registered, or one of
 * core's reserved ids. A module with a **body** runs here; a **header-only**
 * one is read by the model (its prose, D1); a **reserved** id (a check
 * method's resolver, a worked-out value, a tally, typed bonuses, a casting
 * pool, core's scopes) is what the engine does natively (`engine.ts`,
 * `methods.ts`, `scopes.ts`) — its module, once registered, is read for its
 * prose and kind and never run here, so nothing is done twice; ⏳ a module
 * whose body is a seeded script row (`seedKey`) keeps the script answers of
 * `scripts.ts`.
 *
 * ## The handlers, in phase order (D3)
 *
 * `effects` and `derived` once per owner, `before` and `after` once per
 * check, `render` once per moment — then, outside the phases, `decide` (a
 * deciding function that is a check's way decides it from the check's
 * result), `invoke` (an invokable function run as an action, D6) and
 * `members` (a scope function's members, D4).
 *
 * ## What a handler is handed (`ctx`)
 *
 * Only what its function bindings reach and the moment: `{ phase,
 * function: { id, key, kind }, ruleset, rigour, options, owner, bindings:
 * { role: { to, ids, values? | entries? | zones? | members? | owners? } },
 * event, session }` (🚧 RF fix 6: a role is never handed an attribute, an
 * entry's field or a value of a kind it does not take — `bindingKindRefusal`
 * says why on the ledger's failure lines; 🚧 an attribute role an **entry field selector** fills —
 * `entryFields`, `bond.affection` — also carries `fields: { [selector]:
 * { entryType, field, type, min?, max?, entries } }`, the owner's held entries of
 * that type; ties T3) — plus `check` (before, after, decide), `answer`,
 * `actor` and `aimedAt` (invoke), `blocks` and `outcomes` (render).
 * `ctx.random()` is the call's seeded stream; `ctx.log(x)` writes the trail.
 *
 * ## What it answers (never a write, R8)
 *
 * `{ deltas, lines, outcomes, emits, asks }` — and, by phase, `values`
 * (derived: worked-out attribute values), the check fields today's script
 * answers carry (before: `against`, `edge`, `pool`, `options`, `modifies`;
 * after: `shift`, `degree`, `riders`), `outcome` (decide), `blocks`
 * (render), `members` (a scope). A delta names an attribute (`{ attribute,
 * op, value, owner? }`) or an entry in a zone (`{ op: 'move' | 'add' |
 * 'remove' | 'reveal', entry, zone?, to?, owner?, toOwner? }`); the
 * pipeline's outlet applies or proposes them under the registration's mode.
 * An emitted event must be one the function's header says it emits.
 */

import {
	attributeKindsInWords,
	CHECK_METHOD_FUNCTIONS,
	ENTRY_FIELD_BINDING_TYPES,
	FUNCTION_PHASES,
	functionBindingFieldTypes,
	functionBindingKinds,
	getAttributeSlot,
	isReservedFunctionId,
	i18nText,
	normaliseRuleset,
	NUMBER_ATTRIBUTE_KINDS,
	resolveFunctionRef,
	rulesetAttributeKinds,
	rulesetAttributeSlots,
	rulesetSections,
	type FunctionDecl,
	type FunctionPhase,
	type FunctionRef,
	type ReservedFunction,
	type RulesetSections,
	type SlotValue
} from "@serene-pub/sdk"
import { slotKey } from "$lib/server/state/keys"
import type { RulesSandbox } from "./sandbox"
import type { EngineInput, OwnerView, ProposedDelta, ZoneEntry, ZoneOp } from "./types"

// ── The uses ────────────────────────────────────────────────────────────────

/** One function a ruleset uses, as resolved for a moment. */
export interface FunctionUse {
	ref: FunctionRef
	/** The ruleset's own name for this use. */
	key: string
	index: number
	decl?: FunctionDecl
	reserved?: ReservedFunction
	kind: string
	/** The body this use runs — a module's own, or ⏳ a seeded row's (`seedKey`). */
	body?: { form: "module"; source: string } | { form: "legacy"; seedKey: string }
	phases: readonly FunctionPhase[]
	options: Record<string, unknown>
	/** Each role, as the ruleset binds it (or by tag): what it is tied to. */
	bindings: Record<string, { to: string; ids: string[]; pick?: true }>
	findings: readonly string[]
}

const USES = new WeakMap<object, FunctionUse[]>()

/** The ruleset's sections, read once per declaration object. */
const SECTIONS = new WeakMap<object, RulesetSections>()
export function sectionsOf(ruleset: object): RulesetSections {
	let s = SECTIONS.get(ruleset)
	if (!s) SECTIONS.set(ruleset, (s = rulesetSections(ruleset)))
	return s
}

/** Tag-resolved ids: every attribute, entry type or zone type the ruleset tags so. */
function byTag(s: RulesetSections, to: string, tags: readonly string[]): string[] {
	const tagged = (t?: readonly string[]) => !!t && tags.every((x) => t.includes(x))
	if (to === "attribute") return (s.attributes ?? []).filter((a) => tagged(a.tags)).map((a) => a.id)
	if (to === "entry-type") return (s.entryTypes ?? []).filter((e) => tagged(e.tags)).map((e) => e.id)
	return []
}

/**
 * 🚧 The functions a ruleset uses, in its order — each reference resolved
 * (module, reserved id, or nothing), its body found, its roles bound.
 * Pure; read once per declaration.
 */
export function functionUsesOf(ruleset: object): FunctionUse[] {
	const hit = USES.get(ruleset)
	if (hit) return hit
	const s = sectionsOf(ruleset)
	const out: FunctionUse[] = []
	;(s.functions ?? []).forEach((ref, index) => {
		const r = resolveFunctionRef(ref)
		const decl = r.decl
		// A body whose pinned hash moved never runs: the ruleset pinned another (`function-hash-moved`).
		const moved = r.findings.some((f) => f.includes("function-hash-moved"))
		// Core's reserved ids are what the engine already does natively (a check
		// method's resolver, a worked-out value, a tally, typed bonuses, a casting
		// pool, a scope): their modules are read (prose, kind), never run here —
		// the native mechanism is the one authority until it moves into a body.
		const native = isReservedFunctionId(ref.ref)
		const body: FunctionUse["body"] = moved || native
			? undefined
			: typeof decl?.body === "string" && decl.body.trim()
				? { form: "module", source: decl.body }
				: typeof decl?.seedKey === "string" && decl.seedKey
					? { form: "legacy", seedKey: decl.seedKey }
					: undefined
		const bindings: FunctionUse["bindings"] = {}
		for (const [role, b] of Object.entries(decl?.bindings ?? {})) {
			const bound = ref.bindings?.[role]
			const ids = bound === undefined ? (b.tags?.length ? byTag(s, b.to, b.tags) : []) : typeof bound === "string" ? [bound] : [...bound]
			bindings[role] = { to: b.to, ids, ...(b.pick ? { pick: true as const } : {}) }
		}
		out.push({
			ref,
			key: r.key,
			index,
			...(decl ? { decl } : {}),
			...(r.reserved ? { reserved: r.reserved } : {}),
			kind: String(decl?.kind ?? r.reserved?.kind ?? ""),
			...(body ? { body } : {}),
			phases: body ? (decl?.phases ?? []) : [],
			options: { ...((ref.options as Record<string, unknown>) ?? {}) },
			bindings,
			findings: r.findings
		})
	})
	USES.set(ruleset, out)
	return out
}

/** The uses whose module body runs at a phase, in the ruleset's order. */
export const modulesAt = (ruleset: object, phase: FunctionPhase): FunctionUse[] =>
	functionUsesOf(ruleset).filter((u) => u.body?.form === "module" && u.phases.includes(phase))

/** Whether any module body of the ruleset exports work at all — what opens a sandbox for a moment. */
export const runsModules = (ruleset: object): boolean => functionUsesOf(ruleset).some((u) => u.body?.form === "module")

/** ⏳ The legacy scripts a ruleset in sections carries, as `scripts.ts` reads `RulesetProps.scripts`. */
export function legacyScriptsOf(ruleset: object): { phase: string; priority: number; seedKey: string }[] {
	const back: Record<FunctionPhase, string> = { effects: "effects", derived: "derived", before: "pre-roll", after: "post-roll", render: "render" }
	const out: { phase: string; priority: number; seedKey: string }[] = []
	for (const u of functionUsesOf(ruleset))
		if (u.body?.form === "legacy") for (const p of u.phases) out.push({ phase: back[p], priority: u.index, seedKey: u.body.seedKey })
	return out
}

// ── Attributes by id ────────────────────────────────────────────────────────

/** The slot each of the ruleset's attributes is filed under, and back. */
const SLOTS = new WeakMap<object, { slotOf: Map<string, string>; attributeOf: Map<string, string> }>()
export function attributeSlotsOf(ruleset: { id: string } & object): { slotOf: Map<string, string>; attributeOf: Map<string, string> } {
	let hit = SLOTS.get(ruleset)
	if (!hit) {
		const s = sectionsOf(ruleset)
		// A ruleset id that is no ruleset id (a test's stand-in) files nothing.
		let slotOf = new Map<string, string>()
		try {
			slotOf = new Map(rulesetAttributeSlots({ id: ruleset.id, attributes: s.attributes ?? [] }))
		} catch {
			/* no slots to say */
		}
		hit = { slotOf, attributeOf: new Map([...slotOf].map(([a, slot]) => [slot, a])) }
		SLOTS.set(ruleset, hit)
	}
	return hit
}

// ── Entry fields (ties T3) ──────────────────────────────────────────────────

/**
 * 🚧 An **entry field selector** — `<entry type>.<field>` of one of the
 * ruleset's entry types' fields (`bond.affection`) — read: its type, field
 * and field type (🚧 RF fix 6: any field a role may take, `ENTRY_FIELD_BINDING_TYPES`)
 * with a number field's bounds, or null for anything else (an attribute's id
 * never has a dot).
 */
export function entryFieldOf(ruleset: object, selector: string): { entryType: string; field: string; type: string; min?: number; max?: number } | null {
	const m = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(String(selector))
	if (!m) return null
	const e = (sectionsOf(ruleset).entryTypes ?? []).find((x) => x.id === m[1])
	const f = (e ? { ...(e.piece?.fields ?? {}), ...(e.fields ?? {}) }[m[2]!] : undefined) as { type?: string; min?: unknown; max?: unknown } | undefined
	if (!f || !(ENTRY_FIELD_BINDING_TYPES as readonly unknown[]).includes(f.type)) return null
	return { entryType: m[1]!, field: m[2]!, type: f.type!, ...(isNumber(f.min) ? { min: f.min } : {}), ...(isNumber(f.max) ? { max: f.max } : {}) }
}

/**
 * 🚧 Why a use's role is not handed `id` (RF fix 6, 2026-10-23) — the run's
 * twin of the `bad-binding-kind` finding, for what slipped past it (a role
 * bound by tag, a borrowed slot, a stored value of the wrong type): an
 * attribute of a kind the role does not take, an entry's field of a type it
 * does not take, or — a role that takes numbers only — a value that is no
 * number. `null` when it is handed as it is. The sentence goes on the run's
 * failure line under the use's key (the function row's line).
 */
export function bindingKindRefusal(ruleset: object, use: Pick<FunctionUse, "key" | "decl">, role: string, id: string, value?: unknown): string | null {
	const b = use.decl?.bindings?.[role]
	if (!b || b.to !== "attribute") return null
	const kinds = functionBindingKinds(b)
	const takes = `${i18nText(b.label) || role} takes ${attributeKindsInWords(kinds)}`
	const ef = entryFieldOf(ruleset, id)
	if (ef) {
		const types = functionBindingFieldTypes(b)
		return types.includes(ef.type as never) ? null : `'${id}' is a ${ef.type} field, and ${takes}${types.length ? ` or an entry's ${types.join(" or ")} field` : ""}: it was not handed to ${use.key}`
	}
	const has = rulesetAttributeKinds((sectionsOf(ruleset).attributes ?? []).find((a) => a?.id === id))
	if (has?.length && !has.some((k) => kinds.includes(k))) return `'${id}' is ${attributeKindsInWords(has)}, and ${takes}: it was not handed to ${use.key}`
	const numbersOnly = kinds.every((k) => (NUMBER_ATTRIBUTE_KINDS as readonly string[]).includes(k))
	if (numbersOnly && value !== null && value !== undefined && !isNumber(value))
		return `'${id}' holds ${JSON.stringify(value)}, which is no number, and ${takes}: it was not handed to ${use.key}`
	return null
}

/**
 * 🚧 Whether a use reads an entry's field — an attribute role filled by an
 * entry field selector: its `derived` runs on the held entries as the
 * moment's asks left them (`runEntryFieldFunctions`), never in phase 3.
 */
export const readsEntryFields = (ruleset: object, use: FunctionUse): boolean =>
	Object.values(use.bindings).some((b) => b.to === "attribute" && b.ids.some((id) => entryFieldOf(ruleset, id) !== null))

/** The `derived` modules that read an entry's field, in the ruleset's order. */
export const entryFieldUses = (ruleset: object): FunctionUse[] => modulesAt(ruleset, "derived").filter((u) => readsEntryFields(ruleset, u))

// ── What a moment collects ─────────────────────────────────────────────────

export interface FunctionLedger {
	deltas: ProposedDelta[]
	zoneOps: ZoneOp[]
	lines: { owner?: string; text: string; key: string }[]
	outcomes: { owner?: string; id: string; label: string; key: string }[]
	emits: { event: string; payload?: unknown; key: string; owner?: string }[]
	asks: { key: string; owner?: string; ask: unknown }[]
	failed: { phase: string; seedKey: string; why: string; owner?: string }[]
	explain: { phase: string; seedKey: string; text: string; owner?: string }[]
	ran: string[]
}

export const newLedger = (): FunctionLedger => ({ deltas: [], zoneOps: [], lines: [], outcomes: [], emits: [], asks: [], failed: [], explain: [], ran: [] })

export interface FunctionRunDeps {
	sandbox: RulesSandbox
	seed: string
	session?: Readonly<Record<string, unknown>>
	settings?: Readonly<Record<string, string>>
	/** A scope's members (`scopes.ts`), for a binding of `to: 'scope'`. */
	members?: (scope: string, subject: string | null, extra?: { aimedAt?: string | null }) => Promise<string[]>
	/** The event the moment answers, when there is one. */
	event?: { id: string; payload?: unknown } | null
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

const ZONE_OPS = new Set(["move", "add", "remove", "reveal", "hide", "set"])

/** An owner's facet: the world, a place, or one of the cast. */
export const facetOf = (owner: Pick<OwnerView, "key">): "world" | "location" | "cast" =>
	owner.key === "world" ? "world" : owner.key.startsWith("location:") ? "location" : "cast"

/**
 * Where an owner is, as a word every owner's can be compared by: a place's
 * own key, a place entry's id, or the place in words, lower-cased — null for
 * nowhere said. What a scope's `members` handler reads as each owner's
 * `location` (`same-place`), and what core's own scopes compare (`scopes.ts`).
 */
export function ownerPlace(owner: Pick<OwnerView, "bag" | "key">): string | null {
	if (owner.key.startsWith("location:")) return `owner:${owner.key}`
	const v = owner.bag?.location ?? owner.bag?.["core:slot/location@1"]
	if (v && typeof v === "object" && !Array.isArray(v) && Number.isInteger((v as { entryId?: unknown }).entryId)) return `entry:${(v as { entryId: number }).entryId}`
	if (typeof v === "string" && v.trim()) return `words:${v.trim().toLowerCase()}`
	return null
}

/**
 * An attribute's bounds and start as a handler reads them (`restore`, `rest`,
 * a refilling pool): its own, else its slot's.
 */
function boundsOf(ruleset: object, attributeId: string, slot: string | undefined): { min?: number; max?: number; start?: unknown } {
	const a = (sectionsOf(ruleset).attributes ?? []).find((x) => x.id === attributeId)
	const decl = slot ? getAttributeSlot(slot) : undefined
	const cfg = (decl?.config ?? {}) as { min?: unknown; max?: unknown }
	const min = a?.bounds?.min ?? (isNumber(cfg.min) ? cfg.min : undefined)
	const max = a?.bounds?.max ?? (isNumber(cfg.max) ? cfg.max : undefined)
	const start = a?.start ?? decl?.default
	return { ...(isNumber(min) ? { min } : {}), ...(isNumber(max) ? { max } : {}), ...(start !== undefined ? { start } : {}) }
}

/** One held entry as a handler reads it. */
function entryView(e: ZoneEntry, zone: string) {
	return { name: e.name, entryId: e.entryId, entryType: e.entryType, fields: e.fields, ...(e.count !== undefined ? { count: e.count } : {}), zone, ...(e.exposed ? { exposed: true } : {}) }
}

/**
 * The entries an owner holds of some entry types: the pieces of its
 * repertoires (the `carried` zone of a ruleset before sections) and what
 * its zones hold.
 */
function entriesOf(input: EngineInput, owner: OwnerView, types: readonly string[]) {
	const out: ReturnType<typeof entryView>[] = []
	for (const rep of owner.repertoires)
		if (types.includes(rep.repertoire.id))
			for (const p of rep.pieces)
				out.push({ name: String(p.props.name ?? p.key), entryId: p.item.kind === "lore" ? p.item.entryId : null, entryType: rep.repertoire.id, fields: { ...p.props }, ...(p.count !== 1 ? { count: p.count } : {}), zone: "carried" })
	const listed = new Set(owner.repertoires.map((r) => r.repertoire.id))
	for (const [zone, entries] of Object.entries(input.zones?.[owner.key] ?? {}))
		for (const e of entries)
			// A type kept in a list slot is carried there wholly (`zones.ts` `carriedOf`).
			if (types.includes(e.entryType) && !(zone === "carried" && listed.has(e.entryType))) out.push(entryView(e, zone))
	return out
}

/** What each of a use's roles reaches for one owner. */
async function bindingValues(
	input: EngineInput,
	use: FunctionUse,
	owner: OwnerView | null,
	values: Record<string, SlotValue>,
	deps: FunctionRunDeps,
	extra: { aimedAt?: string | null },
	refuse: (why: string) => void = () => {}
): Promise<Record<string, unknown>> {
	const out: Record<string, unknown> = {}
	const { slotOf } = attributeSlotsOf(input.ruleset)
	for (const [role, b] of Object.entries(use.bindings)) {
		const base = { to: b.to, ids: b.ids }
		if (b.to === "attribute") {
			const got: Record<string, SlotValue | null> = {}
			// 🚧 Each attribute's bounds and start (2026-10-23): what restoring, resting or refilling reads.
			const bounds: Record<string, { min?: number; max?: number; start?: unknown }> = {}
			// 🚧 An entry's field (ties T3): the owner's held entries of its type, read per entry.
			const fields: Record<string, { entryType: string; field: string; type: string; min?: number; max?: number; entries: unknown[] }> = {}
			for (const id of b.ids) {
				const ef = entryFieldOf(input.ruleset, id)
				if (ef) {
					// 🚧 A field of a type the role does not take is not handed (RF fix 6).
					const no = bindingKindRefusal(input.ruleset, use, role, id)
					if (no) {
						refuse(no)
						continue
					}
					fields[id] = { ...ef, entries: owner ? entriesOf(input, owner, [ef.entryType]) : [] }
					continue
				}
				const slot = slotOf.get(id)
				const sel = slot ? slotKey(slot) : id
				const stat = owner?.stats.find((s) => s.slotId === slot || s.selector === sel)
				const value = values[sel] ?? stat?.value ?? null
				// 🚧 Never a word where the role takes a number (RF fix 6): the value is withheld, and the run says why.
				const no = bindingKindRefusal(input.ruleset, use, role, id, value)
				if (no) {
					refuse(no)
					got[id] = null
					continue
				}
				got[id] = value
				// 🚧 The owner's own most, where a stat configuration sets one (lane G3,
				// 2026-10-23): a rest restores a seat to its full health, never the slot's ceiling.
				bounds[id] = { ...boundsOf(input.ruleset, id, slot), ...(isNumber(stat?.max) ? { max: stat.max } : {}) }
			}
			out[role] = { ...base, values: got, bounds, ...(Object.keys(fields).length ? { fields } : {}) }
		} else if (b.to === "entry-type") out[role] = { ...base, entries: owner ? entriesOf(input, owner, b.ids) : [] }
		else if (b.to === "zone-type") {
			const zones: Record<string, unknown[]> = {}
			for (const id of b.ids) {
				const held = owner ? (input.zones?.[owner.key]?.[id] ?? []) : []
				zones[id] = held.map((e) => entryView(e, id))
			}
			out[role] = { ...base, zones }
		} else if (b.to === "scope") {
			const members: string[] = []
			if (deps.members) for (const id of b.ids) members.push(...(await deps.members(id, owner?.key ?? null, extra)))
			out[role] = { ...base, members: [...new Set(members)].sort() }
		} else if (b.to === "owner") out[role] = { ...base, owners: input.owners.filter((o) => b.ids.includes(facetOf(o))).map((o) => o.key) }
		else out[role] = base
	}
	return out
}

/** Whether a use runs for an owner: one bound `to: 'owner'` runs for those kinds alone. */
const runsFor = (use: FunctionUse, owner: OwnerView): boolean => {
	const kinds = Object.values(use.bindings).filter((b) => b.to === "owner").flatMap((b) => b.ids)
	return !kinds.length || kinds.includes(facetOf(owner))
}

/**
 * A handler's envelope (see the module note). 🚧 What a role was not handed
 * (RF fix 6) is said on the ledger's failure lines under the use's key.
 */
async function envelopeOf(
	input: EngineInput,
	use: FunctionUse,
	phase: string,
	owner: OwnerView | null,
	values: Record<string, SlotValue>,
	deps: FunctionRunDeps,
	extra: Record<string, unknown> = {},
	ledger?: FunctionLedger
): Promise<Record<string, unknown>> {
	const refuse = (why: string) => {
		if (!ledger || ledger.failed.some((f) => f.seedKey === use.key && f.why === why && f.owner === owner?.key)) return
		ledger.failed.push({ phase, seedKey: use.key, why, ...(owner ? { owner: owner.key } : {}) })
	}
	return {
		phase,
		function: { id: use.ref.ref, key: use.key, kind: use.kind },
		ruleset: input.ruleset.id,
		rigour: input.rigour,
		options: use.options,
		owner: owner ? { key: owner.key, name: owner.name, kind: facetOf(owner) } : null,
		bindings: await bindingValues(input, use, owner, values, deps, { aimedAt: (extra.aimedAt as string | undefined) ?? null }, refuse),
		event: deps.event ?? null,
		session: deps.session ? JSON.parse(JSON.stringify(deps.session)) : null,
		settings: { ...(deps.settings ?? {}) },
		...extra
	}
}

/** Load a use's module into the moment's context; null (and a failure line) when it will not load. */
async function loaded(use: FunctionUse, phase: string, deps: FunctionRunDeps, ledger: FunctionLedger, owner?: string): Promise<string | null> {
	if (use.body?.form !== "module") return null
	const l = await deps.sandbox.load("module", use.body.source)
	if (!l.ok) {
		ledger.failed.push({ phase, seedKey: use.key, why: `does not load: ${l.reason}`, ...(owner ? { owner } : {}) })
		return null
	}
	return l.key
}

/**
 * Read one handler's answer into the ledger: deltas (attributes → the
 * engine's deltas, entries → zone operations), lines, outcome words, emits
 * (only those the header declares), asks. Returns the answer for the
 * phase's own fields.
 */
export function takeAnswer(
	input: EngineInput,
	use: FunctionUse,
	phase: string,
	owner: OwnerView | null,
	raw: unknown,
	ledger: FunctionLedger
): Record<string, unknown> | null {
	if (raw === undefined || raw === null) return null
	const fail = (why: string) => ledger.failed.push({ phase, seedKey: use.key, why, ...(owner ? { owner: owner.key } : {}) })
	if (!isRecord(raw)) {
		fail("a function answers { deltas, lines, outcomes, emits, asks }, or nothing")
		return null
	}
	const { slotOf } = attributeSlotsOf(input.ruleset)
	const ownerKey = (o: unknown): string | undefined => (typeof o === "string" && o ? o : owner?.key)
	if (Array.isArray(raw.deltas))
		for (const d of raw.deltas) {
			if (!isRecord(d) || typeof d.op !== "string") {
				fail("a delta is { attribute, op, value } or { op, entry, zone, to }")
				continue
			}
			const who = ownerKey(d.owner)
			if (typeof d.attribute === "string") {
				const slot = slotOf.get(d.attribute)
				if (!slot) {
					fail(`changes '${d.attribute}', which ${input.ruleset.id} declares no attribute of — dropped`)
					continue
				}
				if (!who) {
					fail(`changes '${d.attribute}' and names no owner — dropped`)
					continue
				}
				ledger.deltas.push({
					owner: who,
					slot,
					op: d.op,
					...(d.value !== undefined ? { value: d.value } : {}),
					reason: typeof d.reason === "string" && d.reason ? d.reason : use.key,
					origin: "rules"
				})
			} else if (typeof d.slot === "string" || typeof d.repertoire === "string") {
				// ⏳ A delta in the engine's own words (a repertoire piece, a slot by id).
				if (!who) continue
				ledger.deltas.push({ ...(d as unknown as ProposedDelta), owner: who, reason: typeof d.reason === "string" ? d.reason : use.key, origin: "rules" })
			} else if (ZONE_OPS.has(d.op) && d.entry !== undefined) {
				if (!who) {
					fail(`${d.op}s an entry and names no owner — dropped`)
					continue
				}
				ledger.zoneOps.push({
					op: d.op as ZoneOp["op"],
					owner: who,
					entry: d.entry,
					...(typeof d.zone === "string" ? { zone: d.zone } : {}),
					...(typeof d.to === "string" ? { to: d.to } : {}),
					...(typeof d.toOwner === "string" ? { toOwner: d.toOwner } : {}),
					// 🚧 `set` (T2): one field of a held entry.
					...(typeof d.field === "string" ? { field: d.field } : {}),
					...(d.value !== undefined && d.op === "set" ? { value: d.value } : {}),
					...(typeof d.by === "number" ? { by: d.by } : {}),
					key: use.key
				})
			} else fail(`a '${d.op}' delta names no attribute and no entry — dropped`)
		}
	if (Array.isArray(raw.lines))
		for (const t of raw.lines) if (typeof t === "string" && t.trim()) ledger.lines.push({ text: t.trim(), key: use.key, ...(owner ? { owner: owner.key } : {}) })
	if (Array.isArray(raw.outcomes)) {
		const words = sectionsOf(input.ruleset).outcomes ?? []
		for (const o of raw.outcomes) {
			const id = typeof o === "string" ? o : isRecord(o) && typeof o.id === "string" ? o.id : isRecord(o) && typeof o.word === "string" ? o.word : null
			if (!id) continue
			const declared = words.find((w) => w.id === id)
			ledger.outcomes.push({
				id,
				label: declared ? (i18nText(declared.label) ?? id) : isRecord(o) && typeof o.label === "string" ? o.label : id,
				key: use.key,
				...(ownerKey(isRecord(o) ? o.owner : undefined) ? { owner: ownerKey(isRecord(o) ? o.owner : undefined) } : {})
			})
		}
	}
	if (Array.isArray(raw.emits)) {
		const may = new Set(use.decl?.emits ?? [])
		for (const e of raw.emits) {
			const id = typeof e === "string" ? e : isRecord(e) && typeof e.event === "string" ? e.event : null
			if (!id) continue
			if (!may.has(id)) {
				fail(`emits '${id}', which its header does not say it emits — dropped`)
				continue
			}
			ledger.emits.push({ event: id, key: use.key, ...(isRecord(e) && e.payload !== undefined ? { payload: e.payload } : {}), ...(owner ? { owner: owner.key } : {}) })
		}
	}
	if (Array.isArray(raw.asks)) for (const a of raw.asks) ledger.asks.push({ key: use.key, ask: a, ...(owner ? { owner: owner.key } : {}) })
	if (typeof raw.explain === "string" && raw.explain.trim()) ledger.explain.push({ phase, seedKey: use.key, text: raw.explain.trim(), ...(owner ? { owner: owner.key } : {}) })
	return raw
}

/** Call one handler of one use; its answer read into the ledger. */
async function callUse(
	input: EngineInput,
	use: FunctionUse,
	handler: "effects" | "derived" | "before" | "after" | "render" | "decide" | "invoke" | "members",
	owner: OwnerView | null,
	envelope: Record<string, unknown>,
	label: string,
	deps: FunctionRunDeps,
	ledger: FunctionLedger
): Promise<Record<string, unknown> | null> {
	const key = await loaded(use, handler, deps, ledger, owner?.key)
	if (!key) return null
	const res = await deps.sandbox.call(key, handler, envelope, `${deps.seed}:function:${use.key}:${label}`)
	if (!res.ok) {
		ledger.failed.push({ phase: handler, seedKey: use.key, why: res.reason, ...(owner ? { owner: owner.key } : {}) })
		return null
	}
	if (res.missing) return null
	if (!ledger.ran.includes(use.key)) ledger.ran.push(use.key)
	return takeAnswer(input, use, handler, owner, res.value, ledger)
}

// ── The phases ──────────────────────────────────────────────────────────────

/**
 * `effects` — each module's handler once per owner it runs for, on the
 * values phases 1–2 left. Deltas, lines and the rest go to the ledger.
 */
export async function runEffectsFunctions(
	input: EngineInput,
	deps: FunctionRunDeps,
	ledger: FunctionLedger,
	valuesOf: (owner: OwnerView) => Record<string, SlotValue>
): Promise<void> {
	const uses = modulesAt(input.ruleset, "effects")
	if (!uses.length || input.rigour === "prose") return
	for (const owner of [...input.owners].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)))
		for (const use of uses) {
			if (!runsFor(use, owner)) continue
			const env = await envelopeOf(input, use, "effects", owner, valuesOf(owner), deps, {}, ledger)
			await callUse(input, use, "effects", owner, env, `effects:${owner.key}`, deps, ledger)
		}
}

/**
 * `derived` — each module's handler once per owner; `values` it returns
 * (by attribute id) are worked-out values the engine lays over in phase 3,
 * returned by owner key as selector → value.
 */
export async function runDerivedFunctions(
	input: EngineInput,
	deps: FunctionRunDeps,
	ledger: FunctionLedger,
	valuesOf: (owner: OwnerView) => Record<string, SlotValue>
): Promise<Record<string, Record<string, SlotValue>>> {
	const out: Record<string, Record<string, SlotValue>> = {}
	// An entry's field is worked out on what the moment's asks left (`runEntryFieldFunctions`), not here.
	const uses = modulesAt(input.ruleset, "derived").filter((u) => !readsEntryFields(input.ruleset, u))
	if (!uses.length || input.rigour === "prose") return out
	const { slotOf } = attributeSlotsOf(input.ruleset)
	for (const owner of [...input.owners].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)))
		for (const use of uses) {
			if (!runsFor(use, owner)) continue
			const env = await envelopeOf(input, use, "derived", owner, { ...valuesOf(owner), ...(out[owner.key] ?? {}) }, deps, {}, ledger)
			const a = await callUse(input, use, "derived", owner, env, `derived:${owner.key}`, deps, ledger)
			if (!a || !isRecord(a.values)) continue
			for (const [attr, v] of Object.entries(a.values)) {
				const slot = slotOf.get(attr)
				if (!slot) {
					ledger.failed.push({ phase: "derived", seedKey: use.key, owner: owner.key, why: `works out '${attr}', which ${input.ruleset.id} declares no attribute of — dropped` })
					continue
				}
				if (v === null || v === undefined) continue
				;(out[owner.key] ??= {})[slotKey(slot)] = v as SlotValue
			}
		}
	return out
}

/**
 * 🚧 `derived` on an **entry's field** (ties T3, 2026-10-23) — each module
 * whose role an entry field selector fills (`rungs` over `bond.affection`),
 * once per owner, on the held entries as `input.zones` has them: in a write
 * moment the zones as the moment's asks left them (the outlet hands it the
 * planned zones), in a reading as stored. What it asks (a field worked out
 * and `set` — Romance's _Standing_) joins the moment's zone asks.
 */
export async function runEntryFieldFunctions(input: EngineInput, deps: FunctionRunDeps, ledger: FunctionLedger): Promise<void> {
	const uses = entryFieldUses(input.ruleset)
	if (!uses.length || input.rigour === "prose") return
	for (const owner of [...input.owners].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)))
		for (const use of uses) {
			if (!runsFor(use, owner)) continue
			const env = await envelopeOf(input, use, "derived", owner, {}, deps, {}, ledger)
			await callUse(input, use, "derived", owner, env, `fields:${owner.key}`, deps, ledger)
		}
}

/**
 * `before` / `after` — each module's handler for one check, its check
 * fields merged in the ruleset's order as `scripts.ts` merges a script's.
 */
export async function runCheckFunctions(
	input: EngineInput,
	phase: "before" | "after",
	owner: OwnerView | null,
	check: Record<string, unknown>,
	values: Record<string, SlotValue>,
	n: number,
	deps: FunctionRunDeps,
	ledger: FunctionLedger
): Promise<Record<string, unknown> | null> {
	const uses = modulesAt(input.ruleset, phase)
	if (!uses.length) return null
	const merged: Record<string, unknown> = {}
	for (const use of uses) {
		if (owner && !runsFor(use, owner)) continue
		const env = await envelopeOf(input, use, phase, owner, values, deps, { check, aimedAt: check.aimedAt ?? null }, ledger)
		const a = await callUse(input, use, phase, owner, env, `${phase}:${owner?.key ?? "session"}:${n}`, deps, ledger)
		if (!a) continue
		if (phase === "before") {
			for (const k of ["against", "edge", "method"] as const) if (a[k] !== undefined) merged[k] = a[k]
			if (isRecord(a.options)) merged.options = { ...((merged.options as object) ?? {}), ...a.options }
			if (isNumber(a.pool)) merged.pool = ((merged.pool as number) ?? 0) + a.pool
			if (Array.isArray(a.modifies)) merged.modifies = [...((merged.modifies as unknown[]) ?? []), ...a.modifies]
		} else {
			if (isNumber(a.shift)) merged.shift = ((merged.shift as number) ?? 0) + Math.trunc(a.shift)
			if (typeof a.degree === "string") merged.degree = a.degree
			if (Array.isArray(a.riders)) merged.riders = [...((merged.riders as unknown[]) ?? []), ...a.riders]
		}
	}
	return Object.keys(merged).length ? merged : null
}

/**
 * The deciding uses whose body decides a check. Core's own resolvers (the
 * reserved ids a check method reads as — `die-target`, `dice-pool`, …) stay
 * native (`methods.ts`) even once their modules register: the dice stay one
 * stream, the engine's, until the roll itself moves into the sandbox.
 */
export const deciderUses = (ruleset: object): FunctionUse[] =>
	functionUsesOf(ruleset).filter((u) => u.kind === "deciding" && u.body?.form === "module" && !CORE_RESOLVERS.has(u.ref.ref))

const CORE_RESOLVERS: ReadonlySet<string> = new Set(Object.values(CHECK_METHOD_FUNCTIONS))

/**
 * 🚧 `decide` — the deciding function a check's way names, when its module
 * has a body that exports `decide`: handed the check as it came out
 * natively, it answers the outcome — `{ degree }` (one of the ruleset's
 * degrees by id) or `{ outcome }` (an outcome word), with lines and
 * riders. Null when no module decides it (the native resolver's answer
 * stands — `methods.ts`, the fallback until A2's modules land).
 */
export async function runDecideFunction(
	input: EngineInput,
	methodKey: string | null,
	owner: OwnerView | null,
	check: Record<string, unknown>,
	values: Record<string, SlotValue>,
	n: number,
	deps: FunctionRunDeps,
	ledger: FunctionLedger
): Promise<Record<string, unknown> | null> {
	const uses = deciderUses(input.ruleset)
	const use = uses.find((u) => u.key === methodKey) ?? (methodKey === null ? uses[0] : undefined)
	if (!use) return null
	// 🚧 The outcome words in force as a crosswalk (`degrees`) — what a way reads its outcome through.
	const degrees = normaliseRuleset(input.conventions ? { conventions: input.conventions } : input.ruleset).conventions.degrees
	const env = await envelopeOf(input, use, "decide", owner, values, deps, { check, degrees, aimedAt: check.aimedAt ?? null }, ledger)
	const a = await callUse(input, use, "decide", owner, env, `decide:${owner?.key ?? "session"}:${n}`, deps, ledger)
	if (!a) return null
	const out: Record<string, unknown> = {}
	if (typeof a.degree === "string") out.degree = a.degree
	else if (typeof a.outcome === "string") out.degree = a.outcome
	if (Array.isArray(a.riders)) out.riders = a.riders
	return Object.keys(out).length ? out : null
}

/** `render` — each module's handler once a moment, on the blocks' texts; may replace a block's text. */
export async function runRenderFunctions(
	input: EngineInput,
	texts: Record<string, string>,
	outcomes: readonly string[],
	deps: FunctionRunDeps,
	ledger: FunctionLedger
): Promise<Record<string, string>> {
	const uses = modulesAt(input.ruleset, "render")
	const now = { ...texts }
	if (!uses.length || input.rigour === "prose") return now
	for (const use of uses) {
		const env = await envelopeOf(input, use, "render", null, {}, deps, { blocks: { ...now }, outcomes: [...outcomes], viewer: input.viewer ?? null }, ledger)
		const a = await callUse(input, use, "render", null, env, "render", deps, ledger)
		if (!a || !isRecord(a.blocks)) continue
		for (const [k, t] of Object.entries(a.blocks)) {
			if (typeof t !== "string") continue
			if (!(k in now)) {
				ledger.failed.push({ phase: "render", seedKey: use.key, why: `replaces '${k}', which is no block this moment renders — dropped` })
				continue
			}
			now[k] = t
		}
	}
	return now
}

/**
 * 🚧 `invoke` — an invokable function run as an action (D6): handed the
 * answer to its form, who acts and at whom. A module without `invoke` is
 * run at `effects` with the answer; a header-only one is told in words for
 * the model to judge. Null when the function is not one the ruleset uses
 * or is not invokable (`why`).
 */
export async function runInvokeFunction(
	input: EngineInput,
	fn: string,
	call: { actor: OwnerView | null; answer: unknown; aimedAt?: string | null },
	deps: FunctionRunDeps,
	ledger: FunctionLedger
): Promise<{ ok: true; use: FunctionUse } | { ok: false; why: string }> {
	const use = functionUsesOf(input.ruleset).find((u) => u.key === fn || u.ref.ref === fn)
	if (!use) return { ok: false, why: `${input.ruleset.id} uses no function '${fn}'` }
	if (!use.decl?.invokable) return { ok: false, why: `'${use.key}' is not a function a person may invoke` }
	const label = i18nText(use.decl.invokable.label) ?? use.key
	const actorName = call.actor?.name ?? "Someone"
	if (use.body?.form !== "module") {
		const answer = call.answer === undefined || call.answer === null ? "" : typeof call.answer === "string" ? call.answer : JSON.stringify(call.answer)
		ledger.lines.push({ text: `${actorName} — ${label}${answer ? `: ${answer}` : ""}`, key: use.key, ...(call.actor ? { owner: call.actor.key } : {}) })
		ledger.ran.push(use.key)
		return { ok: true, use }
	}
	const values = call.actor ? Object.fromEntries(call.actor.stats.map((s) => [s.selector, s.value as SlotValue])) : {}
	const extra = { answer: call.answer ?? null, actor: call.actor?.key ?? null, aimedAt: call.aimedAt ?? null }
	const env = await envelopeOf(input, use, "invoke", call.actor, values, deps, extra, ledger)
	const key = await loaded(use, "invoke", deps, ledger, call.actor?.key)
	if (!key) return { ok: false, why: `'${use.key}' did not load` }
	let res = await deps.sandbox.call(key, "invoke", env, `${deps.seed}:function:${use.key}:invoke`)
	if (res.ok && res.missing) res = await deps.sandbox.call(key, "effects", { ...env, phase: "effects" }, `${deps.seed}:function:${use.key}:invoke`)
	if (!res.ok) {
		ledger.failed.push({ phase: "invoke", seedKey: use.key, why: res.reason, ...(call.actor ? { owner: call.actor.key } : {}) })
		return { ok: false, why: `'${use.key}' failed: ${res.reason}` }
	}
	ledger.ran.push(use.key)
	takeAnswer(input, use, "invoke", call.actor, res.value, ledger)
	return { ok: true, use }
}

/**
 * `members` — a scope function's body (D4), asked who is in reach of a
 * subject. Owner keys among the moment's owners; null when the scope's
 * module has no body (the host's core scopes answer natively).
 */
export async function runScopeFunction(
	input: EngineInput,
	scope: string,
	subject: string | null,
	extra: { aimedAt?: string | null },
	deps: FunctionRunDeps,
	ledger: FunctionLedger
): Promise<string[] | null> {
	const use = functionUsesOf(input.ruleset).find((u) => (u.ref.ref === scope || u.key === scope) && u.kind === "scope")
	if (!use || use.body?.form !== "module") return null
	const env = {
		phase: "members",
		function: { id: use.ref.ref, key: use.key, kind: use.kind },
		ruleset: input.ruleset.id,
		options: use.options,
		subject,
		aimedAt: extra.aimedAt ?? null,
		// Each owner's place (`ownerPlace`), so a scope may reach by where people are.
		owners: input.owners.map((o) => ({ key: o.key, name: o.name, kind: facetOf(o), location: ownerPlace(o) })),
		ties: input.ties.map((t) => ({ from: t.from, to: t.to, type: t.type }))
	}
	const key = await loaded(use, "members", deps, ledger)
	if (!key) return []
	const res = await deps.sandbox.call(key, "members", env, `${deps.seed}:function:${use.key}:members:${subject ?? "session"}`)
	if (!res.ok) {
		ledger.failed.push({ phase: "members", seedKey: use.key, why: res.reason })
		return []
	}
	const raw = isRecord(res.value) ? res.value.members : res.value
	const known = new Set(input.owners.map((o) => o.key))
	return Array.isArray(raw) ? [...new Set(raw.filter((k): k is string => typeof k === "string" && known.has(k)))].sort() : []
}

// ── What the model reads ────────────────────────────────────────────────────

/**
 * The prose of the functions a ruleset uses (D1: what the model reads when
 * a function is present), `{{role}}` holes filled with what each role is
 * bound to (an attribute's name). Header-only and bodied alike; a reserved
 * id not yet registered has no prose.
 */
export function functionProse(ruleset: { id: string } & object): string[] {
	const s = sectionsOf(ruleset)
	const names = new Map<string, string>()
	for (const a of s.attributes ?? []) names.set(a.id, i18nText(a.name) ?? a.id)
	for (const e of s.entryTypes ?? []) names.set(e.id, i18nText(e.name) ?? e.id)
	for (const z of s.zoneTypes ?? []) names.set(z.id, i18nText(z.name) ?? z.id)
	// 🚧 An entry's number field reads as its field on its entry — _Affection on a bond_ (ties T3).
	for (const e of s.entryTypes ?? [])
		for (const [k, f] of Object.entries({ ...(e.piece?.fields ?? {}), ...(e.fields ?? {}) }) as [string, { type?: string; label?: never }][])
			if (f?.type === "integer" || f?.type === "number") names.set(`${e.id}.${k}`, `${i18nText(f.label) ?? k} on a ${(i18nText(e.name) ?? e.id).toLowerCase()}`)
	const out: string[] = []
	for (const use of functionUsesOf(ruleset)) {
		const prose = use.decl?.prose?.trim()
		if (!prose) continue
		out.push(
			prose.replace(/\{\{\s*([a-zA-Z][\w-]*)\s*\}\}/g, (_m, role: string) => {
				const ids = use.bindings[role]?.ids ?? []
				if (ids.length) return ids.map((id) => names.get(id) ?? id).join(", ")
				// 🚧 An option's hole (`{{when}}`, 2026-10-23): the value the reference sets, else its form's default.
				const set = (use.options as Record<string, unknown> | undefined)?.[role]
				const value = set ?? (use.decl?.form as Record<string, { default?: unknown }> | undefined)?.[role]?.default
				if (typeof value === "string" || typeof value === "number") return String(value)
				const words = value && typeof value === "object" ? i18nText(value as never) : undefined
				return words ?? role
			})
		)
	}
	return out
}

/**
 * 🚧 The voice a ruleset that declares none reads with (R6, R9: voice is
 * optional and derived): each attribute's sentence, then each function's
 * prose. Empty for a ruleset from scratch — a session on it reads exactly
 * as one with no rules.
 */
export function derivedVoice(ruleset: { id: string } & object): string {
	const s = sectionsOf(ruleset)
	const lines: string[] = []
	for (const a of s.attributes ?? []) {
		const prose = typeof a.prose === "string" ? a.prose.trim() : ""
		if (prose) lines.push(`${i18nText(a.name) ?? a.id}: ${prose}`)
	}
	lines.push(...functionProse(ruleset))
	return lines.join("\n")
}

/** The phases a module may run at — re-exported so callers say one list. */
export const PHASES: readonly FunctionPhase[] = FUNCTION_PHASES
