/**
 * **Earshot** — who meets a value a slot declares `earshot: 'holder'` (the
 * Lair's whisper; lair pass R1, 2026-09-28), and the one filter that takes
 * it away from everybody else.
 *
 * Two kinds of reader meet session state, and each has its own rule:
 *
 *  · a **prompt** hears a holder-only value only in its holder's own voice
 *    (`withinEarshot`, `pipelines/prompt/adventureContext.ts`);
 *  · a **person** reads it through its **data audience** (NOMENCLATURE §9
 *    *audience*): `owner` — the session's owner, who runs the table and
 *    whispers — and `character:<holder>`, whoever portrays the holder (a
 *    member's own presence). A cast member the model voices is portrayed by
 *    no person, so only the owner reads theirs. `hearingOf` resolves it with
 *    the audience resolver (`resolvePortrayals` · `audienceHolds`), once per
 *    read.
 *
 * Both take the value off the members the reader does not hear with ONE
 * filter, `heardOnly`, so a prompt and a person can never disagree about
 * which keys a holder-only slot occupies. A slot declared `'all'` (the default) is
 * everybody's and is never touched.
 *
 * ⚠ **Every read that hands state to a person is a view** (plan A28): the
 * `state:*` replies — `state:get` (and so `session_state.v1`, the section
 * every widget and plugin frame is handed), `state:ledger`,
 * `state:proposals`, and the state a write's own reply carries. Pipelines
 * read the whole state (`session-state@1`): a run's voices share one read,
 * and the prompt filter is theirs. A person CHANGES a holder-only value only
 * where they hear it (`sockets/state.ts`, `state:set` · `state:configure` ·
 * `state:decide`).
 *
 * **A value computed from a holder-only one is heard as it is**
 * (`earshotSlots`): a derived slot, or a slot whose rules read one, is
 * holder-only when it reads the value through its own member (`owner.`,
 * the `slot` filter, a named derivation's `from`), and **owner-only** when
 * it reads it any other way (`state.`, `who.`) — its value may be another
 * member's, so only the session's owner hears it, on every owner it lands
 * on (the world and the places included).
 *
 * Fails closed: a slot the registry declares `'holder'` is withheld even
 * from a state whose vocabulary rows do not say so; a contested bare key
 * goes with it (the qualified key of the other slot still carries that
 * one's value); an expression that so much as names a holder-only key
 * outside `owner.` is owner-only; and a stored value on a cast member whose
 * slot no declaration names is read as holder-only (`valueHeard`).
 */

import {
	attributeSlots,
	audienceHolds,
	getAttributeSlot,
	slotEarshot,
	type AttributeSlotDecl,
	type ParticipantRef
} from "@serene-pub/sdk"
import { qualifiedSlotKey, slotKey } from "$lib/server/state/keys"
import type { StateOwner } from "$lib/server/state/owners"

/** What a state has to carry for the filter to find the holder-only values. */
interface EarshotStateLike {
	slots?: Array<{ id?: unknown; earshot?: unknown }>
	world?: unknown
	cast?: Record<string, unknown>
	locations?: Record<string, unknown>
	who?: unknown
}

const bag = (v: unknown): Record<string, unknown> =>
	v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: {}

/**
 * The slots whose values not everybody hears.
 *
 * - `holder` — heard by the member carrying the value, and the session's owner;
 * - `ownerOnly` — heard by the session's owner alone.
 *
 * Disjoint: a slot in `ownerOnly` is not also in `holder`.
 */
export interface EarshotSlots {
	holder: ReadonlySet<string>
	ownerOnly: ReadonlySet<string>
}

/** The names an expression can reach a slot's value by: its id, bare key and qualified key. */
const namesOf = (id: string): string[] => [id, slotKey(id), qualifiedSlotKey(id)]

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")

/** A key standing alone in an expression — not a piece of a longer name. */
const standing = (key: string): RegExp =>
	new RegExp(`(?<![A-Za-z0-9_-])${escaped(key)}(?![A-Za-z0-9_-])`)

/**
 * The expressions a slot's value is computed by: a derived slot's `derive`
 * (a named derivation's `from` read as the `slot` filter it amounts to), and
 * every expression of its rules.
 */
function computedBy(decl: AttributeSlotDecl): string[] {
	const out: string[] = []
	if (decl.type === "derived") {
		if (typeof decl.derive === "string") out.push(decl.derive)
		const from = (decl.config as { from?: unknown } | undefined)?.from
		if (typeof from === "string") out.push(`"${from}" | slot`)
	}
	for (const rule of decl.rules ?? [])
		for (const expr of [rule.when, rule.set, rule.add, rule.remove])
			if (typeof expr === "string") out.push(expr)
	return out
}

/** `readOf`'s answers, by slot id and expression — both immutable strings. */
const reads = new Map<string, "none" | "owner" | "other">()

/**
 * How one expression reads one slot: through its own member
 * (`owner.<key>`, `owner["<key>"]`, the quoted id — the `slot` filter reads
 * the owner), some other way (the key anywhere else, quoted or not), or
 * not at all.
 */
function readOf(expr: string, id: string): "none" | "owner" | "other" {
	const memo = `${id}\n${expr}`
	const known = reads.get(memo)
	if (known) return known
	let rest = expr
	for (const name of namesOf(id)) {
		const key = escaped(name)
		const own = new RegExp(
			`owner\\s*(?:\\.\\s*${key}(?![A-Za-z0-9_-])|\\[\\s*(["'])${key}\\1\\s*\\])|(["'])${key}\\2`,
			"g"
		)
		rest = rest.replace(own, (match) => (match.startsWith("owner") || name === id ? " " : match))
	}
	const answer = namesOf(id).some((name) => standing(name).test(rest))
		? "other"
		: rest !== expr
			? "owner"
			: "none"
	if (reads.size > 10_000) reads.clear()
	reads.set(memo, answer)
	return answer
}

/** How one expression reads any of the slots `ids` names — the widest of `readOf`'s answers. */
function readsThrough(expr: string, ids: Iterable<string>): "none" | "owner" | "other" {
	let widest: "none" | "owner" = "none"
	for (const id of ids) {
		const read = readOf(expr, id)
		if (read === "other") return "other"
		if (read === "owner") widest = "owner"
	}
	return widest
}

/**
 * The slots only their holder hears, and the ones only the session's owner
 * hears (see the file header): those a state's vocabulary rows mark
 * `earshot: 'holder'`, every one the registry declares so (fail closed), and
 * every slot computed from one — to a fixed point, since a derivation may
 * read another.
 */
export function earshotSlots(rows?: ReadonlyArray<{ id?: unknown; earshot?: unknown }>): EarshotSlots {
	const holder = new Set<string>()
	const ownerOnly = new Set<string>()
	for (const row of Array.isArray(rows) ? rows : [])
		if (row?.earshot === "holder" && typeof row.id === "string") holder.add(row.id)
	const declared = attributeSlots()
	for (const decl of declared) if (slotEarshot(decl) === "holder") holder.add(decl.id)
	if (!holder.size) return { holder, ownerOnly }

	const computed = declared
		.map((decl) => ({ id: decl.id, exprs: computedBy(decl) }))
		.filter((c) => c.exprs.length)
	for (let moved = true; moved; ) {
		moved = false
		for (const { id, exprs } of computed) {
			if (ownerOnly.has(id)) continue
			const other =
				exprs.some((e) => readsThrough(e, ownerOnly) !== "none") ||
				exprs.some((e) => readsThrough(e, holder) === "other")
			if (other) {
				holder.delete(id)
				ownerOnly.add(id)
				moved = true
			} else if (!holder.has(id) && exprs.some((e) => readsThrough(e, holder) === "owner")) {
				holder.add(id)
				moved = true
			}
		}
	}
	return { holder, ownerOnly }
}

/**
 * The state with every holder-only value taken off each cast member
 * `hears` says no to, and every owner-only value taken off every owner —
 * under both keys, wherever the owner is reachable: `world`, `cast[slug]`,
 * `cast.byId`, `locations`, and the `who` roles.
 *
 * The view of a reader who does not hear everything: the session's owner
 * reads the state itself (`stateAsHeard`), and no prompt's voice is theirs.
 *
 * Never mutates: the state it was handed may be a run's, and the next voice
 * reads it too. Entries are copied, once each, so `cast.byId`, the slug
 * index and the `who` roles still share one object per member as
 * `stateFor` built them.
 */
export function heardOnly<S>(state: S, hears: (characterId: string) => boolean): S {
	if (!state || typeof state !== "object" || Array.isArray(state)) return state
	const s = state as EarshotStateLike
	const { holder, ownerOnly } = earshotSlots(s.slots)
	if (!holder.size && !ownerOnly.size) return state
	const keysOf = (ids: ReadonlySet<string>) =>
		new Set([...ids].flatMap((id) => [slotKey(id), qualifiedSlotKey(id)]))
	const holderKeys = keysOf(holder)
	const ownerOnlyKeys = keysOf(ownerOnly)

	const copies = new Map<object, unknown>()
	const without = (entry: unknown, member: boolean): unknown => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry
		if (copies.has(entry)) return copies.get(entry)
		const values = entry as Record<string, unknown>
		const gone = [...ownerOnlyKeys, ...(member && !hears(String(values.id)) ? holderKeys : [])]
		let out: Record<string, unknown> = values
		if (gone.some((k) => k in values)) {
			out = { ...values }
			for (const k of gone) delete out[k]
		}
		copies.set(entry, out)
		return out
	}
	const index = (raw: unknown, member: boolean): Record<string, unknown> =>
		Object.fromEntries(
			Object.entries(bag(raw)).map(([key, value]) => [
				key,
				key === "byId"
					? Object.fromEntries(Object.entries(bag(value)).map(([id, e]) => [id, without(e, member)]))
					: without(value, member)
			])
		)

	return {
		...(state as object),
		...(s.world === undefined ? {} : { world: without(s.world, false) }),
		...(s.cast === undefined ? {} : { cast: index(s.cast, true) }),
		...(s.locations === undefined ? {} : { locations: index(s.locations, false) }),
		...(s.who === undefined
			? {}
			: {
					who: Object.fromEntries(
						Object.entries(bag(s.who)).map(([role, v]) => [
							role,
							Array.isArray(v) ? v.map((e) => without(e, true)) : without(v, true)
						])
					)
				})
	} as S
}

/**
 * **Hearing** — which cast members' holder-only values one person reads in
 * one session: every member's (`all`), or the members they portray. ⚠ Not
 * _heardBy_ (an event's listeners on the admin events map).
 */
export type Hearing =
	| { all: true }
	| { all: false; characterIds: ReadonlySet<string> }

const EVERYTHING: Hearing = Object.freeze({ all: true })

/** Whether `hearing` reads the holder-only values on the member `characterId` names. */
export const hears = (hearing: Hearing, characterId: number | string): boolean =>
	hearing.all || hearing.characterIds.has(String(characterId))

/** A holder-only value's data audience: the session's owner, and whoever portrays its holder. */
export const holderAudience = (characterId: number | string): ParticipantRef[] => [
	"owner",
	`character:${characterId}`
]

/**
 * One person's hearing in one session, for the cast `cast` lists (the
 * session's seated members and presences — `sessionLinks(...).cast`).
 *
 * Resolved with the audience resolver, as the annex views are
 * (`annexViewFor`): `owner` holds for the session's owner, a `character:`
 * reference for the member whose own presence it is.
 */
export async function hearingOf(
	db: Db,
	sessionId: number,
	userId: number,
	cast: ReadonlyArray<{ characterId: number }>
): Promise<Hearing> {
	const { resolvePortrayals } = await import("$lib/server/pipelines/runtime/portrayals")
	const portrayals = await resolvePortrayals(db, {
		sessionId,
		runOwnerUserId: userId,
		refs: ["owner", ...cast.map((c) => `character:${c.characterId}` as const)]
	})
	const viewer = { userId }
	if (audienceHolds(["owner"], portrayals, viewer)) return EVERYTHING
	return {
		all: false,
		characterIds: new Set(
			cast
				.filter((c) => audienceHolds(holderAudience(c.characterId), portrayals, viewer))
				.map((c) => String(c.characterId))
		)
	}
}

/** The state as `hearing` reads it. Unchanged (the same object) for someone who hears everything. */
export const stateAsHeard = <S>(state: S, hearing: Hearing): S =>
	hearing.all ? state : heardOnly(state, (id) => hears(hearing, id))

/** The owner kinds a cast member's values are filed under, at each layer. */
const CAST_OWNER_KINDS: ReadonlySet<string> = new Set(["session_cast", "card", "cast_member"])

/**
 * Whether one stored value — a session-layer row, a pending change's payload
 * — is `hearing`'s to read. Everything everybody hears is; an owner-only one
 * is the session's owner's alone. On a holder-only slot, the owner names the
 * member: `session_cast` and `card` by the character id, `cast_member`
 * through the member's binding (`castMemberOf`). Any other owner cannot
 * carry a holder-only slot (the SDK refuses `'holder'` off the cast), and is
 * withheld rather than guessed at.
 *
 * A value on a cast member whose slot no declaration names any more (its
 * plugin uninstalled, its id moved on) is read as holder-only: its earshot
 * is unknown, and its own member and the owner are the readers either
 * earshot admits.
 */
export function valueHeard(
	hearing: Hearing,
	slots: EarshotSlots,
	value: { owner: Pick<StateOwner, "kind" | "id">; slotId: unknown },
	castMemberOf: (castMemberId: number) => number | null | undefined = () => null
): boolean {
	if (hearing.all || typeof value.slotId !== "string") return true
	if (slots.ownerOnly.has(value.slotId)) return false
	const { kind, id } = value.owner
	const holderOnly =
		slots.holder.has(value.slotId) ||
		(CAST_OWNER_KINDS.has(kind) && !getAttributeSlot(value.slotId))
	if (!holderOnly) return true
	const characterId =
		kind === "session_cast" || kind === "card"
			? id
			: kind === "cast_member"
				? castMemberOf(id)
				: null
	return characterId != null && hears(hearing, characterId)
}
