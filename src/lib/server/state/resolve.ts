/**
 * What a stat *is*, right now, for whoever is asking.
 *
 * ## The one rule
 *
 * A stat is declared once, attached where it is true by default, and valued
 * where play happens. Every read resolves down the same chain configuration
 * already does — **session → lorebook → card → declaration default** — with
 * absence meaning *inherit*, never zero. A session that never touched Health
 * reads the world's; a world that never touched it reads the card's; a card
 * that never touched it reads the declaration's default; and a slot with no
 * default is **absent**, which is not the same claim as `0`.
 *
 * ## A `current` view, and only that
 *
 * Configuration and value are both temporal in the design: a cap is 20 in act 1
 * and 40 in act 3, and a value validates against the config valid at *its own*
 * anchor. This module implements the **current** view of that and nothing else
 * — no `asOf` parameter, because the temporal registry the other view needs
 * (two clocks, story time and session time) is not built. `valid_from_message_id`
 * is stored and ordered on, so the rows are already shaped for it; what is
 * missing is the clock, not the column.
 *
 * ## Derived slots are computed, never read
 *
 * A derived slot has no row by construction — storing age guarantees staleness.
 * `derive.ts` computes them from the values resolved here, which is why they
 * are applied *after* the chain rather than inside it.
 *
 * ## Validation lives in the SDK registry, not in the database
 *
 * The schema a value is checked against is derived from the *configuration*
 * (`health` declares "integer with a max"; attaching sets 20; only then is the
 * validator 0..20), so no CHECK constraint could express it. Values are checked
 * at the write, against the declaration in `@serene-pub/sdk`'s slot registry.
 * A value whose slot this install does not declare is kept as opaque data —
 * shown, not validated — matching the standing "never refuse, fall back and say
 * so" rule for a stale binding.
 */

import { and, eq, inArray, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	getAttributeSlot,
	getGenre,
	resolveSlotConfig,
	attributeSlots,
	type AttributeSlotDecl,
	type SlotConfig,
	type SlotValue
} from "@serene-pub/sdk"
import {
	resolutionChain,
	type OwnerKind,
	type StateOwner
} from "$lib/server/state/owners"
import { deriveValue } from "$lib/server/state/derive"

/** One cast member of a session, as every read here needs them. */
export interface CastMemberLink {
	characterId: number
	name: string
	/** The `lorebook_bindings` row binding this character into the session's world. */
	castMemberId: number | null
}

/** The session facts every resolution needs, read once. */
export interface SessionLinks {
	sessionId: number
	lorebookId: number | null
	cast: CastMemberLink[]
	/** The story date, when the world has one — what `age` is measured against. */
	storyDate: { year: number; month?: number; day?: number } | null
}

/**
 * One slot this session tracks, whether or not anything has a value for it.
 *
 * ⚠ **Not derivable from the values.** A slot with no default resolves to
 * ABSENT until somebody sets it, so `world` holds no `location` key on a fresh
 * session — and a state-keeper shown only the keys with values in them is a
 * keeper that can never introduce the one thing a first turn most needs. The
 * declarations are the vocabulary; the values are what has been said in it.
 */
export interface TrackedSlot {
	id: string
	/** The bare name a template addresses and a model writes: `time-of-day`. */
	key: string
	type: AttributeSlotDecl["type"]
	appliesTo: AttributeSlotDecl["appliesTo"]
}

/** The shape `stateFor` returns and `core:query/session-state@1` publishes. */
export interface ResolvedState {
	world: Record<string, SlotValue>
	cast: Record<string, Record<string, SlotValue>>
	possessions: Record<string, PossessionLine[]>
	/** The genre's own vocabulary, in declaration order. */
	slots: TrackedSlot[]
}

export interface PossessionLine {
	entryId: number
	name: string
	quantity: number
}

// ── Keys a template reads ───────────────────────────────────────────────────

/**
 * `adventure:slot/weather@1` → `weather`.
 *
 * Templates read `state.world.weather`, not the address the row is filed under.
 * Every slot ALSO appears under its fully qualified key (`acme_rp_tension`), so
 * when two owners declare the same local name the bare key goes to whichever id
 * sorts first and neither slot becomes unreachable. One sentence, deterministic,
 * and nothing is silently lost.
 */
export const slotKey = (id: string): string =>
	id.replace(/^.*:slot\//, "").replace(/@\d+$/, "")

export const qualifiedSlotKey = (id: string): string =>
	id
		.replace(/@\d+$/, "")
		.replace(/:slot\//, "_")
		.replace(/[.\-]/g, "_")

/** A cast member's name as a template addresses it: `state.cast.verity`. */
export const castKey = (name: string): string =>
	name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "") || "unnamed"

// ── Rows ────────────────────────────────────────────────────────────────────

/** Enough of a row to say which of several is in force. */
type Layered = { validFromMessageId: number | null; id: number }

/**
 * The row in force among several for one owner and slot: latest anchor wins,
 * and the later row wins a tie.
 *
 * A null anchor is "from the beginning" and therefore the earliest, which is
 * what makes a template-layer row lose to a session-layer one written at
 * message 47 without either of them having to know the other exists.
 */
function inForce<T extends Layered>(rows: T[]): T | undefined {
	let best: T | undefined
	for (const row of rows) {
		if (!best) {
			best = row
			continue
		}
		const a = row.validFromMessageId ?? -1
		const b = best.validFromMessageId ?? -1
		if (a > b || (a === b && row.id > best.id)) best = row
	}
	return best
}

const ownerMatches = (
	row: { ownerKind: string; ownerId: number },
	owner: StateOwner
) => row.ownerKind === owner.kind && row.ownerId === owner.id

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Everything a session needs to resolve anything: its world, its cast, and each
 * cast member's binding into that world.
 *
 * One read rather than a lookup per owner, because `stateFor` resolves every
 * slot for every member and a per-owner query would be a join per bar drawn.
 */
export async function sessionLinks(
	db: Db,
	sessionId: number
): Promise<SessionLinks> {
	const books = await db
		.select({ lorebookId: schema.sessionLorebooks.lorebookId })
		.from(schema.sessionLorebooks)
		.where(eq(schema.sessionLorebooks.sessionId, sessionId))
	const lorebookId = books[0]?.lorebookId ?? null

	const seated = await db
		.select({
			characterId: schema.sessionCharacters.characterId,
			name: schema.characters.name
		})
		.from(schema.sessionCharacters)
		.innerJoin(
			schema.characters,
			eq(schema.characters.id, schema.sessionCharacters.characterId)
		)
		.where(
			and(
				eq(schema.sessionCharacters.sessionId, sessionId),
				isNull(schema.sessionCharacters.removedAt)
			)
		)

	const characterIds = seated
		.map((r) => r.characterId)
		.filter((id): id is number => typeof id === "number")

	const bindings =
		lorebookId && characterIds.length
			? await db
					.select({
						id: schema.lorebookBindings.id,
						characterId: schema.lorebookBindings.characterId
					})
					.from(schema.lorebookBindings)
					.where(
						and(
							eq(schema.lorebookBindings.lorebookId, lorebookId),
							inArray(
								schema.lorebookBindings.characterId,
								characterIds
							)
						)
					)
			: []
	const bindingFor = new Map(
		bindings
			.filter((b) => typeof b.characterId === "number")
			.map((b) => [b.characterId as number, b.id])
	)

	return {
		sessionId,
		lorebookId,
		storyDate: await storyDateOf(db, lorebookId),
		cast: seated
			.filter(
				(r): r is { characterId: number; name: string } =>
					typeof r.characterId === "number"
			)
			.map((r) => ({
				characterId: r.characterId,
				name: r.name ?? "",
				castMemberId: bindingFor.get(r.characterId) ?? null
			}))
	}
}

/**
 * The world's present date — the most recent dated history entry, which is what
 * `core:var/current-date@1` already means by "the story's present date".
 *
 * Null when the world has none, and that is the ordinary case: a chat has no
 * clock, so `age` is absent rather than wrong.
 */
async function storyDateOf(
	db: Db,
	lorebookId: number | null
): Promise<SessionLinks["storyDate"]> {
	if (!lorebookId) return null
	const rows = await db
		.select({ fields: schema.lorebookEntries.fields })
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, lorebookId),
				eq(schema.lorebookEntries.typeId, "core:entry/history")
			)
		)
	let best: SessionLinks["storyDate"] = null
	for (const row of rows) {
		const f = (row.fields ?? {}) as Record<string, unknown>
		const year = Number(f.year)
		if (!Number.isFinite(year)) continue
		const month = Number.isFinite(Number(f.month))
			? Number(f.month)
			: undefined
		const day = Number.isFinite(Number(f.day)) ? Number(f.day) : undefined
		const candidate = { year, month, day }
		if (!best || compareDates(candidate, best) > 0) best = candidate
	}
	return best
}

const compareDates = (
	a: NonNullable<SessionLinks["storyDate"]>,
	b: NonNullable<SessionLinks["storyDate"]>
): number =>
	a.year - b.year ||
	(a.month ?? 0) - (b.month ?? 0) ||
	(a.day ?? 0) - (b.day ?? 0)

// ── Resolution ──────────────────────────────────────────────────────────────

export interface ValueQuery {
	sessionId?: number
	owner: StateOwner
	slotId: string
}

/**
 * One owner's value for one slot, resolved down the chain.
 *
 * `undefined` means **absent** — no layer has one and the declaration has no
 * default. Distinct from `null`, which is a layer saying "cleared"; that read
 * falls through to the layer below it, which is what makes clearing a session
 * value mean "go back to inheriting" rather than "this is now nothing".
 */
export async function valueOf(
	db: Db,
	query: ValueQuery
): Promise<SlotValue | undefined> {
	const decl = getAttributeSlot(query.slotId)
	const links = query.sessionId
		? await sessionLinks(db, query.sessionId)
		: null
	const chain = chainFor(query.owner, links)
	const rows = await valueRows(db, chain, [query.slotId])

	if (decl?.type === "derived")
		return deriveValue(decl, {
			storyDate: links?.storyDate ?? null,
			read: async (slotId) => valueOf(db, { ...query, slotId })
		})

	for (const layer of chain) {
		const row = inForce(
			rows.filter(
				(r) => ownerMatches(r, layer) && r.slotId === query.slotId
			)
		)
		if (!row) continue
		const v = row.value?.v as SlotValue
		// `null` is "this layer clears it" — keep falling through.
		if (v === null || v === undefined) continue
		return v
	}
	return decl?.default
}

/**
 * The configuration in force for one owner and slot: the declaration's own
 * config with every layer's deviations laid over it, furthest layer first.
 *
 * Furthest first because a session raising a cap must not drop the enum options
 * the lorebook declared beside it — every layer stores what it changed, and
 * merging keys is what makes "deviations only" mean anything.
 */
export async function configFor(
	db: Db,
	query: ValueQuery
): Promise<SlotConfig> {
	const decl = getAttributeSlot(query.slotId)
	if (!decl) return {}
	const links = query.sessionId
		? await sessionLinks(db, query.sessionId)
		: null
	const chain = chainFor(query.owner, links)
	const rows = await configRows(db, chain, [query.slotId])
	const layers = [...chain]
		.reverse()
		.map((layer) =>
			inForce(
				rows.filter(
					(r) => ownerMatches(r, layer) && r.slotId === query.slotId
				)
			)
		)
		.map((row) => (row?.config ?? null) as SlotConfig | null)
	return resolveSlotConfig(decl, ...layers)
}

function chainFor(owner: StateOwner, links: SessionLinks | null): StateOwner[] {
	const member = links?.cast.find((c) => c.characterId === owner.id)
	return resolutionChain(owner, {
		castMemberId: member?.castMemberId ?? null,
		characterId: owner.kind === "cast_member" ? null : owner.id,
		lorebookId: links?.lorebookId ?? null
	})
}

async function valueRows(db: Db, owners: StateOwner[], slotIds: string[]) {
	if (!owners.length || !slotIds.length) return []
	return await db
		.select()
		.from(schema.attributeValues)
		.where(
			and(
				inArray(
					schema.attributeValues.ownerKind,
					owners.map((o) => o.kind)
				),
				inArray(
					schema.attributeValues.ownerId,
					owners.map((o) => o.id)
				),
				inArray(schema.attributeValues.slotId, slotIds)
			)
		)
}

async function configRows(db: Db, owners: StateOwner[], slotIds: string[]) {
	if (!owners.length || !slotIds.length) return []
	return await db
		.select()
		.from(schema.attributeConfigs)
		.where(
			and(
				inArray(
					schema.attributeConfigs.ownerKind,
					owners.map((o) => o.kind)
				),
				inArray(
					schema.attributeConfigs.ownerId,
					owners.map((o) => o.id)
				),
				inArray(schema.attributeConfigs.slotId, slotIds)
			)
		)
}

// ── The session's whole state ───────────────────────────────────────────────

/**
 * Everything a session's surfaces and templates read: `{ world, cast,
 * possessions }`.
 *
 * Keyed for a template rather than for the database — `state.world.weather`,
 * `state.cast.verity.hp` — because that is the vocabulary the conditions design
 * exposes and the only layer a template author is allowed to see. Which layer a
 * number came from is a question for the Cast member page, not for a prompt.
 */
export async function stateFor(
	db: Db,
	sessionId: number
): Promise<ResolvedState> {
	const links = await sessionLinks(db, sessionId)
	const declared = await declaredFor(db, sessionId)

	const world: Record<string, SlotValue> = {}
	for (const decl of declared.filter((d) => d.appliesTo.includes("world")))
		await writeKeys(world, decl, declared, () =>
			valueOf(db, {
				sessionId,
				owner: { kind: "session", id: sessionId },
				slotId: decl.id
			})
		)

	const cast: Record<string, Record<string, SlotValue>> = {}
	for (const member of links.cast) {
		const bag: Record<string, SlotValue> = {}
		for (const decl of declared.filter((d) => d.appliesTo.includes("cast")))
			await writeKeys(bag, decl, declared, () =>
				valueOf(db, {
					sessionId,
					owner: { kind: "session_cast", id: member.characterId },
					slotId: decl.id
				})
			)
		cast[castKey(member.name)] = bag
	}

	return {
		world,
		cast,
		possessions: await possessionsFor(db, links),
		slots: declared.map((d) => ({
			id: d.id,
			key: slotKey(d.id),
			type: d.type,
			appliesTo: d.appliesTo
		}))
	}
}

/** Declarations in a stable order, so a contested bare key always goes the same way. */
const declaredSlots = (): AttributeSlotDecl[] =>
	[...attributeSlots()].sort((a, b) => a.id.localeCompare(b.id))

/**
 * The slots THIS session has, which is the ones its genre brings.
 *
 * ⚠ **Not every declaration, and the difference is the whole of "a newcomer in
 * a chat session never sees a bar."** The declaration registry is global — a
 * genre declaring health registers it for the process, not for its own sessions
 * — and every resolution falls back to a declaration's default. So a reader
 * that walked the whole registry would answer "health 20, weather clear" for a
 * standard Chat session on an instance that merely HAS an adventure genre
 * installed, and the Stats widget would draw it.
 *
 * A genre this build does not declare resolves to every declaration rather than
 * to none, and that is the deliberate direction to be wrong in: a plugin genre
 * whose package failed to load should show a player the values they already
 * have, not silently empty their session. The chat genre declares no slots, so
 * the case this protects is exactly the case it is for.
 */
async function declaredFor(
	db: Db,
	sessionId: number
): Promise<AttributeSlotDecl[]> {
	const [row] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const declared = getGenre(row?.genreId ?? "")
	if (!declared) return declaredSlots()
	const ids = new Set((declared.slots ?? []).map((d) => d.id))
	return declaredSlots().filter((d) => ids.has(d.id))
}

/**
 * One value under both its keys: the qualified one always, the bare one when
 * this declaration is the first claimant of it.
 */
async function writeKeys(
	bag: Record<string, SlotValue>,
	decl: AttributeSlotDecl,
	all: AttributeSlotDecl[],
	read: () => Promise<SlotValue | undefined>
): Promise<void> {
	const value = await read()
	if (value === undefined) return
	bag[qualifiedSlotKey(decl.id)] = value
	const bare = slotKey(decl.id)
	const firstClaimant = all.find((d) => slotKey(d.id) === bare)
	if (firstClaimant?.id === decl.id) bag[bare] = value
}

/**
 * Who is carrying what, grouped by owner, with the entry's own name.
 *
 * An item is an entry, so the name comes from the lorebook rather than from the
 * edge — which is the point of storing possession as an edge at all: rename the
 * entry and every inventory that holds it renames with it.
 */
async function possessionsFor(
	db: Db,
	links: SessionLinks
): Promise<Record<string, PossessionLine[]>> {
	const rows = await db
		.select({
			ownerKind: schema.sessionPossessions.ownerKind,
			ownerId: schema.sessionPossessions.ownerId,
			entryId: schema.sessionPossessions.entryId,
			quantity: schema.sessionPossessions.quantity,
			validFromMessageId: schema.sessionPossessions.validFromMessageId,
			id: schema.sessionPossessions.id,
			name: schema.lorebookEntries.title
		})
		.from(schema.sessionPossessions)
		.leftJoin(
			schema.lorebookEntries,
			eq(schema.lorebookEntries.id, schema.sessionPossessions.entryId)
		)
		.where(eq(schema.sessionPossessions.sessionId, links.sessionId))

	const nameOf = new Map(links.cast.map((c) => [c.characterId, c.name]))
	const out: Record<string, PossessionLine[]> = {}
	// One edge per (owner, entry): the row in force, exactly as a value is.
	const byEdge = new Map<string, typeof rows>()
	for (const row of rows) {
		const key = `${row.ownerKind}:${row.ownerId}:${row.entryId}`
		byEdge.set(key, [...(byEdge.get(key) ?? []), row])
	}
	for (const group of byEdge.values()) {
		const row = inForce(group)
		if (!row || row.quantity <= 0) continue
		const key =
			row.ownerKind === "session"
				? "world"
				: castKey(nameOf.get(row.ownerId) ?? "")
		out[key] = [
			...(out[key] ?? []),
			{
				entryId: row.entryId,
				name: row.name ?? "",
				quantity: row.quantity
			}
		]
	}
	return out
}

export type { OwnerKind, StateOwner }
