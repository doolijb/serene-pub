/**
 * 🚧 **Zones** — where entries sit (PLAN-rulesets-functions D5, 2026-10-23).
 *
 * A ruleset declares zone types once (`zoneTypes`: a hand, a deck, an
 * inbox); each owner a type allows carries its own instance — a **zone**.
 * What a zone holds is **held entries**: copies stamped from lorebook
 * entries, the `entryId` kept so a function may read the source
 * (`stampHeldEntry`, ruled 10-22), each with an `exposed` flag its holder
 * may set (D4). Who sees what sits in a zone is the zone type's visibility
 * (`visibility.ts`); moving an entry between zones is what reveals it.
 *
 * ## Storage
 *
 * `zone_contents`: append-only snapshots, one row per change of one zone,
 * anchored to the turn's message (a retake or a deleted reply takes the
 * move back — the row before shows through). The **carried** zone (the
 * host's `CARRIED_ZONE_TYPE`, every session whatever its ruleset) is:
 *
 *  · for a ruleset before sections — its repertoires' list slots, read in
 *    place: the pieces an owner holds are its carried zone, and a move in or
 *    out of it is a list change through the state gate;
 *  · for a ruleset in sections — a zone like any other, stored here (data
 *    upgrade 0119 carries a converted ruleset's list-slot pieces into it).
 *
 * ## Changes (R8)
 *
 * A function never moves anything: it asks (`ZoneOp`), and the moment's
 * outlet plans the asks against the zone types (`planZoneOps`: who may
 * hold the zone, what it holds, its limit) and writes what holds
 * (`writeZones`), or files nothing and says why.
 */

import { and, desc, eq, sql } from "drizzle-orm"
import { CARRIED_ZONE_TYPE, i18nText, rulesetZoneTypes, tieSidesOf, ZONE_HOLDS_ANY, type FieldDecl, type RulesetEntryTypeDecl, type ZoneTypeDecl } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import type { StateOwner } from "$lib/server/state/owners"
import { attributeSlotsOf, facetOf, sectionsOf } from "./functionRun"
import { slotKey } from "$lib/server/state/keys"
import type { EngineChange, EngineInput, OwnerView, ZoneEntry, ZoneOp } from "./types"

type Db = any

/** The `carried` zone type's id. */
export const CARRIED = CARRIED_ZONE_TYPE.id

/** A ruleset's zone types as a session has them (its own, and the host's `carried`). */
const ZONE_TYPES = new WeakMap<object, readonly ZoneTypeDecl[]>()
export function zoneTypesOf(ruleset: object): readonly ZoneTypeDecl[] {
	let z = ZONE_TYPES.get(ruleset)
	if (!z) ZONE_TYPES.set(ruleset, (z = rulesetZoneTypes(ruleset)))
	return z
}

/** A ruleset's entry types by id (its sections'). */
const ENTRY_TYPES = new WeakMap<object, ReadonlyMap<string, RulesetEntryTypeDecl>>()
export function entryTypesOf(ruleset: object): ReadonlyMap<string, RulesetEntryTypeDecl> {
	let m = ENTRY_TYPES.get(ruleset)
	if (!m) ENTRY_TYPES.set(ruleset, (m = new Map((sectionsOf(ruleset).entryTypes ?? []).map((e) => [e.id, e]))))
	return m
}

/** An entry type's own fields, as declared (a ⏳ repertoire's whole piece shape when it was one). */
export const fieldsOf = (e: RulesetEntryTypeDecl): Record<string, unknown> => ({ ...(e.piece?.fields ?? {}), ...(e.fields ?? {}) })

/** The defaults an entry type's fields declare. */
export function fieldDefaults(e: RulesetEntryTypeDecl): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [k, f] of Object.entries(fieldsOf(e))) if ((f as FieldDecl).default !== undefined) out[k] = (f as FieldDecl).default
	return out
}

/**
 * 🚧 What an owner's **carried** zone holds: the pieces of its list slots
 * (each entry type an owner keeps a list of is read there, in place), and
 * the stored carried entries of every other type. A type with a list slot is
 * the list's wholly — a stored copy of it is never read beside it.
 */
export function carriedOf(input: Pick<EngineInput, "zones">, owner: OwnerView): ZoneEntry[] {
	const listed = new Set(owner.repertoires.map((r) => r.repertoire.id))
	const stored = (input.zones?.[owner.key]?.[CARRIED] ?? []).filter((e) => !listed.has(e.entryType))
	return [...carriedFromPieces(owner), ...stored.map((e) => ({ ...e }))]
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** A stored entry, read defensively. */
function readEntry(raw: unknown): ZoneEntry | null {
	if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.entryType !== "string") return null
	return {
		entryId: typeof raw.entryId === "number" ? raw.entryId : null,
		entryType: raw.entryType,
		name: raw.name,
		fields: isRecord(raw.fields) ? raw.fields : {},
		...(typeof raw.count === "number" && raw.count !== 1 ? { count: raw.count } : {}),
		...(raw.exposed === true ? { exposed: true as const } : {}),
		...(typeof raw.sideOwner === "string" && raw.sideOwner ? { sideOwner: raw.sideOwner } : {})
	}
}

/**
 * 🚧 What every named owner's zones hold, by owner key then zone type —
 * each zone's newest snapshot for this session and ruleset.
 */
export async function zonesFor(
	db: Db,
	sessionId: number,
	rulesetId: string,
	owners: readonly Pick<OwnerView, "key" | "owner">[]
): Promise<Record<string, Record<string, ZoneEntry[]>>> {
	const out: Record<string, Record<string, ZoneEntry[]>> = {}
	if (!owners.length) return out
	const list = rawRows<{ owner_kind: string; owner_id: number; zone_type: string; entries: unknown }>(
		await db.execute(sql`
			SELECT DISTINCT ON (owner_kind, owner_id, zone_type) owner_kind, owner_id, zone_type, entries
			FROM ${schema.zoneContents}
			WHERE session_id = ${sessionId} AND ruleset_id = ${rulesetId}
			ORDER BY owner_kind, owner_id, zone_type, id DESC
		`)
	)
	for (const r of list) {
		const owner = owners.find((o) => o.owner.kind === r.owner_kind && o.owner.id === Number(r.owner_id))
		if (!owner) continue
		const entries = (Array.isArray(r.entries) ? r.entries : []).map(readEntry).filter((e): e is ZoneEntry => !!e)
		;(out[owner.key] ??= {})[r.zone_type] = entries
	}
	return out
}

/**
 * 🚧 **What each owner holds, as a sheet draws it** (RF fix 8, 2026-10-23;
 * `SessionStateOwnerV1.zones`): every zone type of the session's rules an
 * owner has an instance of — the host's carried zone among them — with the
 * held entries the viewer may see (`visibleTo`: the game master everything;
 * a holder their own; exposed or `everyone` to all; a scope's only exposed),
 * each by name, entry type and its words, count and exposure. A relational
 * entry type is the ties block's, never here. A zone with nothing to show is
 * left out.
 */
export async function zonesOnWire(
	db: Db,
	sessionId: number,
	ruleset: { id: string } & object,
	owners: readonly { key: string; kind: StateOwner["kind"]; id: number }[],
	viewer: { sessionOwner: boolean; plays: (owner: { kind: StateOwner["kind"]; id: number }) => boolean }
): Promise<Map<string, import("@serene-pub/sdk").SessionStateZoneV1[]>> {
	const out = new Map<string, import("@serene-pub/sdk").SessionStateZoneV1[]>()
	if (!owners.length) return out
	const held = await zonesFor(db, sessionId, ruleset.id, owners.map((o) => ({ key: o.key, owner: { kind: o.kind, id: o.id } as StateOwner })))
	const types = zoneTypesOf(ruleset)
	const entryTypes = entryTypesOf(ruleset)
	const { visibleTo } = await import("./scopes")
	for (const o of owners) {
		const zones = held[o.key]
		if (!zones) continue
		const gm = viewer.sessionOwner
		const theirs = gm || viewer.plays(o)
		const rows: import("@serene-pub/sdk").SessionStateZoneV1[] = []
		for (const z of types) {
			const entries: import("@serene-pub/sdk").SessionStateZoneV1["entries"] = []
			for (const e of zones[z.id] ?? []) {
				const type = entryTypes.get(e.entryType)
				if (type?.relational) continue
				const seen = await visibleTo(type?.visibility ?? z.visibility, gm ? "gm" : theirs ? o.key : null, o.key, { exposed: e.exposed === true })
				if (!seen) continue
				entries.push({
					name: e.name,
					entryType: e.entryType,
					...(type ? { typeLabel: i18nText(type.name) ?? e.entryType } : {}),
					...(typeof e.count === "number" && e.count > 1 ? { count: e.count } : {}),
					...(e.exposed ? { exposed: true } : {})
				})
			}
			if (entries.length) rows.push({ zoneType: z.id, label: i18nText(z.name) ?? z.id, ...(z.shownAs ? { shownAs: String(z.shownAs) } : {}), entries })
		}
		if (rows.length) out.set(o.key, rows)
	}
	return out
}

/**
 * 🚧 **A tie's far end the moment does not read** (★7, ties T3, 2026-10-23):
 * the person an added two-sided tie side is towards, and the owner a `set`
 * names by key, when neither is among the moment's owners — each resolved
 * from its key (`character:N` a cast member, `location:N` a place) as an
 * owner with no sheet, its zones read beside the moment's, so the other
 * side is stamped and a side's field moved wherever its holder is.
 */
export async function farEndsOf(
	db: Db,
	sessionId: number,
	input: Pick<EngineInput, "ruleset" | "owners">,
	ops: readonly ZoneOp[]
): Promise<{ owners: OwnerView[]; zones: Record<string, Record<string, ZoneEntry[]>> }> {
	const ties = new Set([...entryTypesOf(input.ruleset)].filter(([, e]) => tieSidesOf(e) === 2).map(([id]) => id))
	const known = (k: string) => input.owners.some((o) => o.key === k || o.name.toLowerCase() === k.trim().toLowerCase())
	const keys = new Set<string>()
	for (const op of ops) {
		if (op.op === "add" && isRecord(op.entry) && typeof op.entry.entryType === "string" && ties.has(op.entry.entryType)) {
			const towards = isRecord(op.entry.fields) ? op.entry.fields.towards : undefined
			if (typeof towards === "string" && !known(towards)) keys.add(towards)
		}
		if (op.op === "set" && typeof op.owner === "string" && !known(op.owner)) keys.add(op.owner)
	}
	const owners: OwnerView[] = []
	for (const key of keys) {
		const m = /^(character|location):(\d+)$/.exec(key)
		if (!m) continue
		const id = Number(m[2])
		const [row] =
			m[1] === "character"
				? await db.select({ name: schema.characters.name }).from(schema.characters).where(eq(schema.characters.id, id)).limit(1)
				: await db.select({ name: schema.lorebookEntries.title }).from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, id)).limit(1)
		if (typeof row?.name !== "string") continue
		owners.push({ key, owner: { kind: m[1] === "character" ? "session_cast" : "session_location", id } as StateOwner, name: row.name, stats: [], repertoires: [], custom: [], bag: {} })
	}
	return { owners, zones: owners.length ? await zonesFor(db, sessionId, input.ruleset.id, owners) : {} }
}

/** 🚧 The owners' zones as a plan leaves them — what a field worked out after the moment's asks reads (ties T3). */
export function zonesAfter(
	zones: EngineInput["zones"],
	plan: ZonePlan | null
): Record<string, Record<string, ZoneEntry[]>> {
	const out: Record<string, Record<string, ZoneEntry[]>> = {}
	for (const [k, z] of Object.entries(zones ?? {})) out[k] = Object.fromEntries(Object.entries(z).map(([t, es]) => [t, [...es]]))
	for (const w of plan?.writes ?? []) (out[w.ownerKey] ??= {})[w.zoneType] = [...w.entries]
	return out
}

/** One zone's new contents, as the outlet writes them. */
export interface ZoneWrite {
	owner: StateOwner
	ownerKey: string
	zoneType: string
	entries: ZoneEntry[]
	note?: string
}

/** What a moment's zone asks came to. */
export interface ZonePlan {
	writes: ZoneWrite[]
	/** Moves in or out of a carried zone kept in list slots — list changes through the state gate. */
	changes: EngineChange[]
	lines: { owner: string; text: string }[]
	refused: { op: ZoneOp; why: string }[]
}

/**
 * An entry named by a function: by entry id, by name, or written out — and
 * 🚧 a tie side by what it is towards (`{ entryType?, towards }`, T1).
 */
export function entryMatches(e: ZoneEntry, ref: unknown): boolean {
	if (typeof ref === "number") return e.entryId === ref
	if (typeof ref === "string") return e.name.toLowerCase() === ref.trim().toLowerCase()
	if (isRecord(ref)) {
		if (typeof ref.towards === "string" && ref.towards)
			return e.fields.towards === ref.towards && (typeof ref.entryType !== "string" || e.entryType === ref.entryType)
		if (typeof ref.entryId === "number" && e.entryId === ref.entryId) return true
		// 🚧 By name, of one entry type when it says one (a reply's `set` of a tie field, ties T3).
		if (typeof ref.name === "string")
			return e.name.toLowerCase() === ref.name.trim().toLowerCase() && (typeof ref.entryType !== "string" || !ref.entryType || e.entryType === ref.entryType)
	}
	return false
}

/** An entry a function wrote out, stamped as a held copy (D5). */
function entryWritten(ref: unknown, zone: ZoneTypeDecl): ZoneEntry | null {
	if (typeof ref === "string" && ref.trim()) {
		const only = zone.holds !== ZONE_HOLDS_ANY && zone.holds.length === 1 ? zone.holds[0]! : null
		return only ? { entryId: null, entryType: only, name: ref.trim(), fields: {} } : null
	}
	if (!isRecord(ref) || typeof ref.name !== "string" || !ref.name.trim()) return null
	const entryType =
		typeof ref.entryType === "string" ? ref.entryType : zone.holds !== ZONE_HOLDS_ANY && zone.holds.length === 1 ? zone.holds[0]! : null
	if (!entryType) return null
	return {
		entryId: typeof ref.entryId === "number" ? ref.entryId : null,
		entryType,
		name: ref.name.trim(),
		fields: isRecord(ref.fields) ? JSON.parse(JSON.stringify(ref.fields)) : {},
		...(typeof ref.count === "number" && ref.count > 1 ? { count: Math.trunc(ref.count) } : {})
	}
}

/** The carried zone of a ruleset kept in list slots: its pieces, as held entries. */
function carriedFromPieces(owner: OwnerView): ZoneEntry[] {
	const out: ZoneEntry[] = []
	for (const rep of owner.repertoires)
		for (const p of rep.pieces)
			out.push({
				entryId: p.item.kind === "lore" ? p.item.entryId : null,
				entryType: rep.repertoire.id,
				name: String(p.props.name ?? p.key),
				fields: Object.fromEntries(Object.entries(p.props).filter(([k]) => k !== "name")),
				...(p.count !== 1 ? { count: p.count } : {})
			})
	return out
}

/**
 * 🚧 Plan a moment's zone asks (pure): each checked against its zone types —
 * the zone exists, the owner may carry one, it holds the entry's type, its
 * limit (a number, or an attribute of its owner) — and applied in order to
 * a working copy, so a later ask sees an earlier one's move. What holds is
 * a write per changed zone; what does not is refused with why.
 */
export function planZoneOps(input: EngineInput, ops: readonly ZoneOp[], opts: { farEnds?: readonly OwnerView[] } = {}): ZonePlan {
	const plan: ZonePlan = { writes: [], changes: [], lines: [], refused: [] }
	if (!ops.length) return plan
	const types = new Map(zoneTypesOf(input.ruleset).map((z) => [z.id, z]))
	const tieTypes = new Map([...entryTypesOf(input.ruleset)].filter(([, e]) => tieSidesOf(e) !== undefined))
	const work = new Map<string, ZoneEntry[]>()
	const touched = new Map<string, { owner: OwnerView; zone: string; notes: string[] }>()
	// By key, else by name (a reply's change names its owner as the story does) —
	// 🚧 else a tie's far end the moment does not read, resolved by its key (★7, `farEndsOf`).
	const all = [...input.owners, ...(opts.farEnds ?? []).filter((f) => !input.owners.some((o) => o.key === f.key))]
	const ownerOf = (key: string) => all.find((o) => o.key === key) ?? all.find((o) => o.name.toLowerCase() === String(key).trim().toLowerCase())
	const contents = (owner: OwnerView, zone: string): ZoneEntry[] => {
		const k = `${owner.key}|${zone}`
		let c = work.get(k)
		if (!c) {
			c = zone === CARRIED ? carriedOf(input, owner) : [...(input.zones?.[owner.key]?.[zone] ?? [])].map((e) => ({ ...e }))
			work.set(k, c)
		}
		return c
	}
	const touch = (owner: OwnerView, zone: string, note: string) => {
		const k = `${owner.key}|${zone}`
		const t = touched.get(k) ?? { owner, zone, notes: [] }
		t.notes.push(note)
		touched.set(k, t)
	}
	const label = (z: ZoneTypeDecl) => (i18nText(z.name) ?? z.id).toLowerCase()
	const { slotOf } = attributeSlotsOf(input.ruleset)
	/** Why an owner cannot hold one more entry of a type in a zone, or null. */
	const cannotHold = (owner: OwnerView, z: ZoneTypeDecl, entry: ZoneEntry, now: ZoneEntry[]): string | null => {
		if (!z.owners.includes(facetOf(owner))) return `${owner.name} carries no ${label(z)} — it belongs to ${z.owners.join(", ")}`
		if (z.holds !== ZONE_HOLDS_ANY && !z.holds.includes(entry.entryType)) return `a ${label(z)} holds ${z.holds.join(", ")}, not ${entry.entryType}`
		const by = z.limit
		const limit =
			typeof by === "number"
				? by
				: by && typeof by === "object"
					? (() => {
							const slot = slotOf.get(by.attribute)
							const v = owner.stats.find((s) => s.slotId === slot || s.selector === (slot ? slotKey(slot) : by.attribute))?.value
							return typeof v === "number" ? v : undefined
						})()
					: undefined
		if (limit !== undefined && now.length >= limit) return `${owner.name}'s ${label(z)} holds at most ${limit}`
		return null
	}
	for (const op of ops) {
		const refuse = (why: string) => plan.refused.push({ op, why })
		const owner = ownerOf(op.owner)
		if (!owner) {
			refuse(`'${op.owner}' is not one of the owners this turn resolves`)
			continue
		}
		// A zone left unsaid is the carried one — or, for an entry already held, the zone that holds it (🚧 a tie side in its own zone).
		const fromId =
			op.zone ??
			(op.op === "add"
				? CARRIED
				: ([...types.keys()].find((z) => contents(owner, z).some((e) => entryMatches(e, op.entry))) ?? CARRIED))
		const from = types.get(fromId)
		if (!from) {
			refuse(`${input.ruleset.id} declares no zone '${fromId}'`)
			continue
		}
		const here = contents(owner, fromId)
		if (op.op === "add") {
			const entry = entryWritten(op.entry, from)
			if (!entry) {
				refuse(`an added entry is { name, entryType } — ${JSON.stringify(op.entry)} is not one ${label(from)} takes`)
				continue
			}
			// 🚧 A tie side (T1): its side's owner is who holds it on a two-sided tie.
			const tie = tieTypes.get(entry.entryType)
			if (tie) entry.fields = { ...fieldDefaults(tie), ...entry.fields }
			if (tie && tieSidesOf(tie) === 2) entry.sideOwner = owner.key
			const why = cannotHold(owner, from, entry, here)
			if (why) {
				refuse(why)
				continue
			}
			here.push(entry)
			touch(owner, fromId, `${entry.name} added`)
			plan.lines.push({ owner: owner.key, text: `${owner.name}: ${entry.name} into the ${label(from)}` })
			// 🚧 Its other side (T1): stamped for the person it is towards when they hold none — 🚧 ★7, in the moment or not (their key resolved, `farEndsOf`).
			const towards = typeof entry.fields.towards === "string" ? ownerOf(entry.fields.towards) : undefined
			if (tie && tieSidesOf(tie) === 2 && towards && towards !== owner) {
				const zoneId = [...types.values()].find((z) => z.holds !== ZONE_HOLDS_ANY && z.holds.includes(tie.id) && z.owners.includes(facetOf(towards)))?.id ?? CARRIED
				const zone = types.get(zoneId)!
				const there = contents(towards, zoneId)
				if (!there.some((e) => e.entryType === tie.id && e.fields.towards === owner.key)) {
					const other: ZoneEntry = { entryId: entry.entryId, entryType: tie.id, name: owner.name, fields: { ...fieldDefaults(tie), towards: owner.key }, sideOwner: towards.key }
					if (!cannotHold(towards, zone, other, there)) {
						there.push(other)
						touch(towards, zoneId, `${other.name} added`)
					}
				}
			}
			continue
		}
		const at = here.findIndex((e) => entryMatches(e, op.entry))
		if (at < 0) {
			refuse(`${owner.name}'s ${label(from)} holds nothing called ${JSON.stringify(op.entry)}`)
			continue
		}
		const entry = here[at]!
		if (op.op === "set") {
			// 🚧 One field of a held entry (T2): held to its declared bounds or words.
			const decl = entryTypesOf(input.ruleset).get(entry.entryType)
			const field = typeof op.field === "string" ? op.field : ""
			const f = decl ? (fieldsOf(decl)[field] as FieldDecl | undefined) : undefined
			if (!field || !f || field === "towards" || field === "edge") {
				refuse(`${entry.name} has no field '${field}' to set`)
				continue
			}
			const was = entry.fields[field]
			let next: unknown = op.value
			if (f.type === "integer" || f.type === "number") {
				const base = typeof was === "number" ? was : typeof f.default === "number" ? f.default : 0
				next = typeof op.by === "number" ? base + op.by : typeof op.value === "number" ? op.value : Number.NaN
				if (!Number.isFinite(next)) {
					refuse(`${entry.name}'s ${field} is a number — ${JSON.stringify(op.value)} is not one`)
					continue
				}
				const b = f as { min?: number; max?: number }
				if (f.type === "integer") next = Math.round(next as number)
				if (typeof b.min === "number") next = Math.max(b.min, next as number)
				if (typeof b.max === "number") next = Math.min(b.max, next as number)
			} else if (f.type === "enum") {
				const of = (f as { of?: readonly string[] }).of ?? []
				if (typeof next !== "string" || !of.includes(next)) {
					refuse(`${entry.name}'s ${field} is one of ${of.join(", ")} — not ${JSON.stringify(op.value)}`)
					continue
				}
			} else if (typeof next !== "string" && typeof next !== "boolean") {
				refuse(`${entry.name}'s ${field} takes words — not ${JSON.stringify(op.value)}`)
				continue
			}
			if (next === was) continue
			here[at] = { ...entry, fields: { ...entry.fields, [field]: next } }
			const word = i18nText(f.label) ?? field
			touch(owner, fromId, `${entry.name}: ${word} ${was ?? "—"} → ${next}`)
			plan.lines.push({ owner: owner.key, text: `${owner.name} → ${entry.name}: ${word.toLowerCase()} ${was ?? "—"} → ${String(next)}` })
			continue
		}
		if (op.op === "remove") {
			here.splice(at, 1)
			touch(owner, fromId, `${entry.name} removed`)
			plan.lines.push({ owner: owner.key, text: `${owner.name}: ${entry.name} gone from the ${label(from)}` })
		} else if (op.op === "reveal" || op.op === "hide") {
			here[at] = op.op === "reveal" ? { ...entry, exposed: true } : (({ exposed: _x, ...rest }) => rest)(entry)
			touch(owner, fromId, `${entry.name} ${op.op === "reveal" ? "shown" : "hidden"}`)
			plan.lines.push({ owner: owner.key, text: `${owner.name} ${op.op === "reveal" ? "shows" : "hides"} ${entry.name}` })
		} else if (op.op === "move") {
			const toId = op.to ?? CARRIED
			const to = types.get(toId)
			const target = op.toOwner ? ownerOf(op.toOwner) : owner
			if (!to || !target) {
				refuse(!to ? `${input.ruleset.id} declares no zone '${toId}'` : `'${op.toOwner}' is not one of the owners this turn resolves`)
				continue
			}
			const there = contents(target, toId)
			// A move reveals by where the entry lands: its exposure stays with the old zone.
			const moved: ZoneEntry = (({ exposed: _x, ...rest }) => rest)(entry)
			const why = cannotHold(target, to, moved, there)
			if (why) {
				refuse(why)
				continue
			}
			here.splice(at, 1)
			there.push(moved)
			touch(owner, fromId, `${entry.name} moved out`)
			touch(target, toId, `${entry.name} moved in`)
			plan.lines.push({
				owner: owner.key,
				text: target === owner ? `${owner.name}: ${entry.name} from the ${label(from)} to the ${label(to)}` : `${owner.name} passes ${entry.name} to ${target.name}'s ${label(to)}`
			})
		}
	}
	for (const { owner, zone, notes } of touched.values()) {
		const now = work.get(`${owner.key}|${zone}`) ?? []
		if (zone === CARRIED) {
			// The carried zone: a type the owner keeps a list of changes as a list
			// change on its slot (what left, a removal; what came, an add); every
			// other type is a stored snapshot.
			const listed = new Set(owner.repertoires.map((r) => r.repertoire.id))
			const before = carriedFromPieces(owner)
			for (const rep of owner.repertoires)
				for (const p of rep.pieces) {
					const name = String(p.props.name ?? p.key)
					if (!now.some((e) => e.entryType === rep.repertoire.id && e.name === name))
						plan.changes.push({ owner: owner.owner, slotId: rep.slotId, op: "remove", items: [p.item], note: notes.join("; ") })
				}
			const storedNow = now.filter((e) => !listed.has(e.entryType))
			const storedBefore = (input.zones?.[owner.key]?.[CARRIED] ?? []).filter((e) => !listed.has(e.entryType))
			if (JSON.stringify(storedNow) !== JSON.stringify(storedBefore))
				plan.writes.push({ owner: owner.owner, ownerKey: owner.key, zoneType: zone, entries: storedNow, note: notes.join("; ") })
			for (const e of now) {
				if (!listed.has(e.entryType)) continue
				if (before.some((b) => b.entryType === e.entryType && b.name === e.name)) continue
				const rep = owner.repertoires.find((r) => r.repertoire.id === e.entryType)!
				plan.changes.push({
					owner: owner.owner,
					slotId: rep.slotId,
					op: "add",
					items: [{ kind: "inline", name: e.name, description: String(e.fields.description ?? e.name), ...e.fields, ...(e.count ? { count: e.count } : {}) } as never],
					note: notes.join("; ")
				})
			}
			continue
		}
		plan.writes.push({ owner: owner.owner, ownerKey: owner.key, zoneType: zone, entries: now, note: notes.join("; ") })
	}
	return plan
}

/**
 * 🚧 Write a moment's zone snapshots — one row per changed zone, anchored to
 * the turn's message (the run's live row, else the session's newest).
 */
export async function writeZones(
	db: Db,
	ctx: { sessionId: number; rulesetId: string; messageId?: number | null; updatedBy: string },
	writes: readonly ZoneWrite[]
): Promise<number> {
	if (!writes.length) return 0
	let anchor = ctx.messageId ?? null
	if (anchor === null) {
		// 🚧 The newest LIVE message (RF fix 5): a snapshot anchored to a
		// rewound row would go with the forward stack.
		const { newestMessageId } = await import("$lib/server/state/write")
		anchor = await newestMessageId(db, ctx.sessionId)
	}
	await db.insert(schema.zoneContents).values(
		writes.map((w) => ({
			sessionId: ctx.sessionId,
			ownerKind: w.owner.kind,
			ownerId: w.owner.id,
			rulesetId: ctx.rulesetId,
			zoneType: w.zoneType,
			entries: w.entries as unknown as Array<Record<string, unknown>>,
			validFromMessageId: anchor,
			updatedBy: ctx.updatedBy,
			...(w.note ? { note: w.note } : {})
		}))
	)
	return writes.length
}

/** Every zone row of a session (newest first) — for a ledger or a test. */
export async function zoneHistory(db: Db, sessionId: number, zoneType?: string) {
	return db
		.select()
		.from(schema.zoneContents)
		.where(zoneType ? and(eq(schema.zoneContents.sessionId, sessionId), eq(schema.zoneContents.zoneType, zoneType)) : eq(schema.zoneContents.sessionId, sessionId))
		.orderBy(desc(schema.zoneContents.id))
}
