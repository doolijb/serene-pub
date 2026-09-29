/**
 * What a stat *is*, right now, for whoever is asking.
 *
 * ## The one rule
 *
 * A stat is declared once, attached where it is true by default, and valued
 * where play happens. Every read resolves down the same chain configuration
 * already does — **session → lorebook → card → sheet default → declaration
 * default** — with absence meaning *inherit*, never zero. A session that never
 * touched Health reads the world's; a world that never touched it reads the
 * card's; a card that never touched it reads what the session's sheet naming
 * the slot says it starts at, else the declaration's default (`defaultFor`);
 * and a slot with neither is **absent**, which is not the same claim as `0`.
 *
 * ## The vocabulary is sheets, not a registry walk
 *
 * What a session tracks is the union of its **genre's** sheets and loose slots
 * with the sheets its owners have, down the same chain a value resolves down
 * (R6): `owner_sheets` for the session, its world, and each cast member's seat,
 * binding and card. Deduped by id, **first mention fixes the position**,
 * because sheet order is what a panel draws, what the state block renders and
 * what rules run in. A retired slot stays in the vocabulary and stays resolved
 * — its values are somebody's play — and is flagged `retired` so nothing offers
 * a new write (R3).
 *
 * ## Two indexes over one set of entries
 *
 * `state.cast.byId[characterId]` is built **first** and `state.cast[slug]` is
 * derived from it, over the *same objects* (R17): a template that edits
 * `state.cast.verity` and a script that edits `state.cast.byId[12]` are editing
 * one thing, which is the only way the two can never disagree. Every entry
 * carries `id`, `key` and `name` beside its values, so a caller holding an
 * entry never has to find its way back to who it belongs to. Envoys are
 * excluded: an envoy is not a character and carries no state.
 *
 * `who` is a **sibling** of `cast`, never inside it (R16): `speaker`, `last`,
 * `previous`, `user`, `owner`, `next`, `active`. Each one points at a cast
 * entry — the same object again — and an absent role is a **missing key**
 * rather than a null, because "nobody has spoken yet" and "the speaker is
 * nothing" are different sentences and a template has to be able to tell them
 * apart. There is deliberately no `narrator` and no `addressed`.
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
 * `derive.ts` computes the ones core names (`age`); an author's Liquid
 * expression is computed **here**, after the chain, in dependency order, by
 * `expressions.ts`. It has to be here rather than in `valueOf` because an
 * expression may read any slot on any owner, and only the whole resolved state
 * is a scope it can be evaluated against.
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

import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	getAttributeSheet,
	getAttributeSlot,
	getGenre,
	genreAllowsCustomAttributes,
	genreSheets,
	slotPickable,
	slotEarshot,
	resolveSlotConfig,
	slotDerivation,
	derivations,
	isSlotLoreRef,
	slotField,
	slotStatShapeId,
	sheetSlotAppliesTo,
	type FieldDecl,
	type AttributeSheetDecl,
	type AttributeSlotDecl,
	type SheetSlotEntry,
	type SlotConfig,
	type SlotValue
} from "@serene-pub/sdk"
import {
	resolutionChain,
	type OwnerKind,
	type StateOwner
} from "$lib/server/state/owners"
import { deriveValue } from "$lib/server/state/derive"
// THE comparator for the book's calendar (one comparator per calendar): the
// shared one, which delegates to the SDK's `compareStoryTimes`.
import { storyNowOf } from "$lib/server/state/storyTime"
import { rowsOnReading, sessionReadingOf, type LineReading } from "$lib/server/state/reading"
import { MAIN_HEAD, placesOnReading } from "$lib/server/state/entriesOnReading"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
import { castKey, qualifiedSlotKey, slotKey } from "$lib/server/state/keys"
import {
	createExpressionBudget,
	evaluate,
	expressionReads,
	isRefusal,
	type ExpressionScope
} from "$lib/server/state/expressions"

/** One cast member of a session, as every read here needs them. */
export interface CastMemberLink {
	characterId: number
	name: string
	/** The `lorebook_bindings` row binding this character into the session's world. */
	castMemberId: number | null
	/**
	 * Seated as the player's voice rather than as a character the model writes.
	 *
	 * Both are in the cast, and that is the ruling rather than a convenience:
	 * personas ARE characters (§23), they hold state, the turn lock applies to
	 * their turns, and `who.user` has to point at a real entry in the same
	 * index everything else does.
	 */
	isPersona: boolean
	/** Seated and active — what `who.active` lists, in position order. */
	isActive: boolean
	position: number
}

/**
 * 🚧 One place in the session's world that can hold state (attributes phase
 * 4): a `core:entry/location` lore entry of the session's lorebook. Its
 * owners are `location` (the entry, durable) and `session_location` (this
 * run's layer), both by `entryId`.
 */
export interface LocationLink {
	entryId: number
	name: string
}

/** The session facts every resolution needs, read once. */
export interface SessionLinks {
	sessionId: number
	lorebookId: number | null
	cast: CastMemberLink[]
	/** 🚧 The world's locations (phase 4), by entry id; none without a lorebook. */
	locations: LocationLink[]
	/** The story date, when the world has one — what `age` is measured against. */
	storyDate: { year: number; month?: number; day?: number } | null
	/**
	 * 🚧 Where the session reads its book (`state/reading.ts`): its line, its
	 * moment and the fork cut — which durable rows it inherits. Absent or null
	 * reads every durable row on main's terms (no book, or a caller that
	 * built links by hand).
	 */
	reading?: LineReading | null
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
	/** 🚧 The catalogue stat shape the slot names (`core:stat-shape/list@1`), when it names one. */
	shape?: string
	/** 🚧 What the value is, as a field (`slotField`); absent for a derived slot. */
	field?: FieldDecl
	appliesTo: AttributeSlotDecl["appliesTo"]
	/**
	 * A sheet entry said a session of this shape must have a value (R7).
	 * Surfaced rather than enforced here: creation refuses, an upgrade warns.
	 */
	required?: boolean
	/**
	 * The declaration is retired: everything stored stays and still resolves,
	 * nothing new is written (R3). Present only when true, so the ordinary slot
	 * carries no key at all.
	 */
	retired?: boolean
	/**
	 * 🚧 Only the holder's own voice may read it (earshot, lair pass R1):
	 * every other prompt is built without it — see `withinEarshot` in
	 * `pipelines/prompt/adventureContext.ts`. Present only when `'holder'`,
	 * so the ordinary slot, heard by all, carries no key at all.
	 */
	earshot?: "holder"
	/** The sheet that first named it, when a sheet did. */
	sheetId?: string
}

/**
 * One cast member, as `state.cast` holds them: their values, plus the three
 * facts that say who they are.
 *
 * ⚠ `id`, `key` and `name` share the namespace with the slot keys, which is a
 * collision only a slot literally slugged `name` could cause. It is worth it:
 * every caller that holds an entry — a rule's `owner`, a `who` role, a ledger
 * line — would otherwise have to carry the identity beside it, and the first
 * one to forget is a change written against the wrong character.
 */
export interface CastEntry {
	/** `characters.id` — the same id a `session_cast` owner names. */
	id: number
	/** The slug this entry is indexed under: `state.cast.verity`. */
	key: string
	name: string
	/**
	 * The seat is switched on in the cast list (2026-09-27). Every seated
	 * member is in `state.cast`, switched off or not; this is how a pipeline
	 * or a widget tells them apart. A persona is always `true`.
	 */
	enabled: boolean
	[slot: string]: SlotValue
}

/**
 * The cast, twice over, from one set of objects.
 *
 * `byId` is a sibling key rather than a second top-level index because a
 * template reaching for a character has one place to look, and because the id
 * index is what the slug index is *derived from* — a character renamed
 * mid-session moves in `cast`, and `byId` never moves at all.
 */
export interface CastIndex {
	/** Every entry by `characters.id`. Built first; the slugs are derived from it. */
	byId: Record<string, CastEntry>
	[slug: string]: CastEntry | Record<string, CastEntry>
}

/**
 * The roles, beside the cast rather than inside it (R16).
 *
 * An absent role is an absent **key**. There is no `narrator` — an envoy is not
 * a character and carries no state — and no `addressed`, which nothing can
 * derive without asking a model.
 */
export interface WhoKeys {
	/** Who is speaking in the run this was resolved for. */
	speaker?: CastEntry
	/** Who spoke most recently. */
	last?: CastEntry
	/** Who spoke before them — the most recent *different* speaker. */
	previous?: CastEntry
	/** The asking user's persona in this session. */
	user?: CastEntry
	/** The session owner's persona. */
	owner?: CastEntry
	/** Whose turn is next, when the session has a turn order. */
	next?: CastEntry
	/** Seated, active cast in position order. Always present, possibly empty. */
	active: CastEntry[]
}

/**
 * 🚧 One location, as `state.locations` holds it (phase 4): its values, plus
 * who it is — the same three identity keys a cast entry carries.
 */
export interface LocationEntry {
	/** `lorebook_entries.id` — the id a `session_location` owner names. */
	id: number
	/** The slug this entry is indexed under: `state.locations.harbor`. */
	key: string
	name: string
	[slot: string]: SlotValue
}

/** 🚧 The locations, by entry id and by slug, over one set of objects (as `CastIndex`). */
export interface LocationIndex {
	byId: Record<string, LocationEntry>
	[slug: string]: LocationEntry | Record<string, LocationEntry>
}

/** The shape `stateFor` returns and `core:query/session-state@1` publishes. */
export interface ResolvedState {
	world: Record<string, SlotValue>
	cast: CastIndex
	/**
	 * 🚧 Each location of the session's world and its values (phase 4).
	 * Empty (`{ byId: {} }`) when the session tracks nothing a location
	 * carries: a place is listed only where it could hold something.
	 */
	locations: LocationIndex
	/** This session's vocabulary, in sheet order. */
	slots: TrackedSlot[]
	/** The roles, as a sibling of the cast. */
	who: WhoKeys
	/**
	 * The session's **state version** (plans/29 R-15 *Staleness and order*;
	 * U5f): `sessions.state_version`, moved by one under a lock by every
	 * applied change. A run hands it back as `base` so a delta against a
	 * state that has since moved is rebased or superseded, never applied
	 * blind; an enabled-when can name it as `state.version`. Zero on a
	 * session nothing has changed yet.
	 */
	version: number
}

/** The session's state version alone — the counter the state writers move. */
export async function stateVersionOf(
	db: Db,
	sessionId: number
): Promise<number> {
	const [row] = await db
		.select({ version: schema.sessions.stateVersion })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return row?.version ?? 0
}

// ── Keys a template reads ───────────────────────────────────────────────────
//
// Re-exported rather than re-declared: they moved to `keys.ts` so the
// expression evaluator can key a slot without importing this module, and every
// existing caller imports them from here.

export { castKey, qualifiedSlotKey, slotKey }

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
export function inForce<T extends Layered>(rows: T[]): T | undefined {
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
 * The session's lorebook, as the ids every state read scopes to — none or one.
 *
 * ⚠ **`sessions.lorebook_id`, never `session_lorebooks`.** A session's lorebook
 * is one binding on the session row; the junction is unused legacy that
 * nothing writes (sockets/sessions.ts). State read the junction, so for every
 * session created the real way the lorebook layer, a list's lore references
 * and item supply found no lorebook at all (found 2026-09-26 by the phase 3c
 * live check). An array so the callers that scope by "the session's
 * lorebooks" read the same answer, and so a second binding would be one line.
 */
export async function sessionLorebookIds(
	db: Db,
	sessionId: number
): Promise<number[]> {
	const [row] = await db
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return row?.lorebookId != null ? [row.lorebookId] : []
}

/**
 * Everything a session needs to resolve anything: its world, its cast, and each
 * cast member's binding into that world.
 *
 * One read rather than a lookup per owner, because `stateFor` resolves every
 * slot for every member and a per-owner query would be a join per bar drawn.
 *
 * ⚠ The cast includes **seated personas**. A persona is a character (§23), it
 * carries state, the turn lock governs the player's turns exactly as it governs
 * anybody else's, and `who.user` has to point into the same index the rest of
 * the cast lives in. A seat with an envoy and no character is excluded, because
 * an envoy is not a character and has nothing to resolve.
 */
export async function sessionLinks(
	db: Db,
	sessionId: number
): Promise<SessionLinks> {
	const lorebookId = (await sessionLorebookIds(db, sessionId))[0] ?? null

	const seated = await db
		.select({
			characterId: schema.sessionCharacters.characterId,
			name: schema.characters.name,
			isActive: schema.sessionCharacters.isActive,
			position: schema.sessionCharacters.position
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

	const voiced = await db
		.select({
			characterId: schema.sessionPersonas.personaId,
			name: schema.characters.name,
			position: schema.sessionPersonas.position
		})
		.from(schema.sessionPersonas)
		.innerJoin(
			schema.characters,
			eq(schema.characters.id, schema.sessionPersonas.personaId)
		)
		.where(
			and(
				eq(schema.sessionPersonas.sessionId, sessionId),
				isNull(schema.sessionPersonas.removedAt)
			)
		)

	const cast: CastMemberLink[] = []
	const seen = new Set<number>()
	const take = (link: CastMemberLink) => {
		if (seen.has(link.characterId)) return
		seen.add(link.characterId)
		cast.push(link)
	}
	seated
		.filter((r): r is typeof r & { characterId: number } =>
			typeof r.characterId === "number"
		)
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
		.forEach((r, index) =>
			take({
				characterId: r.characterId,
				name: r.name ?? "",
				castMemberId: null,
				isPersona: false,
				isActive: r.isActive !== false,
				position: r.position ?? index
			})
		)
	voiced
		.filter((r): r is typeof r & { characterId: number } =>
			typeof r.characterId === "number"
		)
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
		.forEach((r, index) =>
			take({
				characterId: r.characterId,
				name: r.name ?? "",
				castMemberId: null,
				isPersona: true,
				isActive: true,
				position: r.position ?? index
			})
		)

	const characterIds = cast.map((c) => c.characterId)
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
	for (const member of cast)
		member.castMemberId = bindingFor.get(member.characterId) ?? null

	// The session's line and story clock (ruling 15, story-time P3): which
	// durable rows it inherits, and where its story's now stands.
	const reading = lorebookId ? await sessionReadingOf(db, sessionId) : null
	return {
		sessionId,
		lorebookId,
		storyDate: await storyDateOf(db, lorebookId, reading?.branchId ?? null, {
			sessionStoryClock: reading?.moment ?? null,
			forkedAt: reading?.forkedAt ?? null,
			line: reading?.line ?? null
		}),
		reading,
		cast,
		locations: await locationsOf(db, lorebookId, reading)
	}
}

/**
 * 🚧 The world's locations (phase 4): every live `core:entry/location` entry
 * of the lorebook on the session's line, titled as amended by its moment, in
 * entry order (finding #41 — one reader with `lorebookState.lorebookLinks`).
 * An archived one is not a place in the story any more; its stored values
 * stay and are simply not read. A sibling fork's own place is not a place in
 * this session's story at all.
 */
async function locationsOf(
	db: Db,
	lorebookId: number | null,
	reading: LineReading | null
): Promise<LocationLink[]> {
	if (!lorebookId) return []
	return await placesOnReading(db, lorebookId, reading ?? MAIN_HEAD)
}

/**
 * The world's present date — what `core:var/current-date@1` means by "the
 * story's present date", and what `age` is measured against.
 *
 * The line's stored clock when it has one; otherwise the newest history entry
 * the line can see (`storyNowOf`, DESIGN-story-time §3). Branch-aware: a
 * session on a branch reads that branch's present, never main's.
 *
 * Null when the world has none, and that is the ordinary case: a chat has no
 * clock, so `age` is absent rather than wrong.
 */
export async function storyDateOf(
	db: Db,
	lorebookId: number | null,
	branchId: number | null = null,
	opts: {
		sessionStoryClock?: StoryDate | null
		forkedAt?: StoryDate | null
		line?: import("$lib/shared/lorebooks/lineReading").Line | null
	} = {}
): Promise<SessionLinks["storyDate"]> {
	const now = await storyNowOf(db, lorebookId, branchId, opts)
	if (!now) return null
	return {
		year: now.year,
		...(now.month != null ? { month: now.month } : {}),
		...(now.day != null ? { day: now.day } : {})
	}
}

// ── Resolution ──────────────────────────────────────────────────────────────

export interface ValueQuery {
	sessionId?: number
	owner: StateOwner
	slotId: string
}

/**
 * One owner's value for one slot, resolved down the chain.
 *
 * `undefined` means **absent** — no layer has one, and neither the session's
 * sheet entry for the slot nor the declaration has a default (`defaultFor`). Distinct from `null`, which is a layer saying "cleared"; that read
 * falls through to the layer below it, which is what makes clearing a session
 * value mean "go back to inheriting" rather than "this is now nothing".
 *
 * ⚠ A slot derived by an **expression** reads absent here. Its scope is the
 * whole resolved state — any slot on any owner — and building one per single-
 * value read would mean a full resolution behind every bar drawn. `stateFor`
 * computes them, which is the read every surface that shows a derived slot
 * already makes.
 */
export async function valueOf(
	db: Db,
	query: ValueQuery,
	/**
	 * What the caller already read for THIS session, so a read per slot per
	 * owner (`stateFor`) does not re-read the links and the vocabulary each
	 * time. Omitted, both are read here — the vocabulary only when no layer
	 * answers.
	 */
	known: { links?: SessionLinks | null; vocabulary?: Vocabulary } = {}
): Promise<SlotValue | undefined> {
	const decl = getAttributeSlot(query.slotId)
	const links =
		known.links !== undefined
			? known.links
			: query.sessionId
				? await sessionLinks(db, query.sessionId)
				: null
	const chain = chainFor(query.owner, links)
	const rows = await valueRows(db, chain, [query.slotId], query.sessionId, links?.reading)

	if (decl?.type === "derived")
		return deriveValue(decl, {
			storyDate: links?.storyDate ?? null,
			read: async (slotId) => valueOf(db, { ...query, slotId }, { ...known, links })
		})

	const found = fromLayers(rows, chain, query.slotId)
	if (found !== undefined) return found
	const vocabulary =
		known.vocabulary ??
		(query.sessionId && links
			? await vocabularyFor(db, query.sessionId, links)
			: undefined)
	return defaultFor(decl, vocabulary)
}

/**
 * The bottom of the chain, once no owner layer answers: the **sheet entry's**
 * `default` (the session's vocabulary entry for the slot — the first sheet
 * that names it, as `configFor` takes that sheet's `config`), then the
 * declaration's own. A sheet default is the sheet's deviation from the
 * declaration's (SDK `SheetSlotEntry.default`), so it sits where the sheet's
 * config sits: furthest of the layers, above the declaration. Outside a
 * session there is no vocabulary, so only the declaration answers.
 */
export function defaultFor(
	decl: AttributeSlotDecl | undefined,
	vocabulary: Vocabulary | undefined
): SlotValue | undefined {
	if (!decl) return undefined
	const fromSheet = vocabulary?.entryFor(decl.id)?.default
	return fromSheet !== undefined ? fromSheet : decl.default
}

/**
 * The first layer down the chain that holds a value for the slot, or
 * `undefined` when none does (the caller falls back to the default).
 */
function fromLayers(
	rows: Array<Layered & { ownerKind: string; ownerId: number; slotId: string; value: { v: unknown } | null }>,
	chain: StateOwner[],
	slotId: string
): SlotValue | undefined {
	for (const layer of chain) {
		const row = inForce(
			rows.filter((r) => ownerMatches(r, layer) && r.slotId === slotId)
		)
		if (!row) continue
		const v = row.value?.v as SlotValue
		// `null` is "this layer clears it" — keep falling through.
		if (v === null || v === undefined) continue
		return v
	}
	return undefined
}

/**
 * The configuration in force for one owner and slot: the declaration's own
 * config with every layer's deviations laid over it, furthest layer first.
 *
 * Furthest first because a session raising a cap must not drop the enum options
 * the lorebook declared beside it — every layer stores what it changed, and
 * merging keys is what makes "deviations only" mean anything.
 *
 * ⚠ Sheets are a layer too, and the **furthest** one: a sheet entry's `config`
 * is the deviation naming the slot on that sheet decided, and an owner's own
 * row has to win over it.
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
	const rows = await configRows(db, chain, [query.slotId], query.sessionId)
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
	const fromSheet = query.sessionId
		? (await vocabularyFor(db, query.sessionId, links)).entryFor(
				query.slotId
			)?.config
		: undefined
	return resolveSlotConfig(decl, fromSheet ?? null, ...layers)
}

function chainFor(owner: StateOwner, links: SessionLinks | null): StateOwner[] {
	const member = links?.cast.find((c) => c.characterId === owner.id)
	return resolutionChain(owner, {
		castMemberId: member?.castMemberId ?? null,
		characterId: owner.kind === "cast_member" ? null : owner.id,
		lorebookId: links?.lorebookId ?? null
	})
}

/**
 * Rows this session may read: its own, plus every layer that belongs to no
 * session at all.
 *
 * ⚠ **Without this a branch reads its parent's numbers, and its parent reads
 * the branch's.** `owner_kind`/`owner_id` do not identify a session — a
 * `session_cast` owner is a `characters.id`, which is the same character in
 * every session they are in — so a query that matched only those would collect
 * every session's rows for that character and hand the highest anchor to all of
 * them. It went unnoticed until something copied rows between sessions (R10);
 * it was always wrong.
 *
 * A null `session_id` is the template layers and the timeline rows, which are
 * true of the character everywhere and are meant to be read here.
 */
const ownedBySession = (
	column:
		| typeof schema.attributeValues.sessionId
		| typeof schema.attributeConfigs.sessionId,
	sessionId: number | undefined
) =>
	typeof sessionId === "number"
		? or(isNull(column), eq(column, sessionId))
		: isNull(column)

async function valueRows(
	db: Db,
	owners: StateOwner[],
	slotIds: string[],
	sessionId?: number,
	/**
	 * 🚧 The session's reading: the durable rows it inherits are those on its
	 * line, main's cut at the fork, and none dated after its moment
	 * (`rowsOnReading`, rulings 15 and 16). Its own rows pass untouched.
	 */
	reading?: LineReading | null
) {
	if (!owners.length || !slotIds.length) return []
	const rows = await db
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
				inArray(schema.attributeValues.slotId, slotIds),
				ownedBySession(schema.attributeValues.sessionId, sessionId)
			)
		)
	return reading ? await rowsOnReading(db, rows, reading) : rows
}

async function configRows(
	db: Db,
	owners: StateOwner[],
	slotIds: string[],
	sessionId?: number
) {
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
				inArray(schema.attributeConfigs.slotId, slotIds),
				ownedBySession(schema.attributeConfigs.sessionId, sessionId)
			)
		)
}

// ── The vocabulary ──────────────────────────────────────────────────────────

/** A slot in a session's vocabulary, with what naming it on a sheet decided. */
export interface VocabularyEntry {
	decl: AttributeSlotDecl
	required?: boolean
	default?: SlotValue
	config?: SlotConfig
	sheetId?: string
}

export interface Vocabulary {
	entries: VocabularyEntry[]
	entryFor(slotId: string): VocabularyEntry | undefined
	slots: TrackedSlot[]
}

/** A slot's stat shape as the vocabulary carries it: the catalogue id it names, and its field. */
export function trackedShape(decl: AttributeSlotDecl): { shape?: string; field?: FieldDecl } {
	const shape = slotStatShapeId(decl)
	const field = slotField(decl)
	return {
		...(shape === undefined ? {} : { shape }),
		...(field === undefined ? {} : { field })
	}
}

/**
 * Which sheets these owners have, in chain order then `position` order.
 *
 * A sheet id nothing declares is skipped rather than refused: a sheet withdrawn
 * with its plugin must cost that bundle and not the session it was on, which is
 * the same "never refuse, fall back and say so" posture a stale binding gets.
 */
export async function sheetsForOwners(
	db: Db,
	owners: StateOwner[],
	sessionId?: number
): Promise<AttributeSheetDecl[]> {
	if (!owners.length) return []
	const rows = await db
		.select({
			ownerKind: schema.ownerSheets.ownerKind,
			ownerId: schema.ownerSheets.ownerId,
			sheetId: schema.ownerSheets.sheetId,
			sessionId: schema.ownerSheets.sessionId,
			position: schema.ownerSheets.position
		})
		.from(schema.ownerSheets)
		.where(
			and(
				inArray(
					schema.ownerSheets.ownerKind,
					owners.map((o) => o.kind)
				),
				inArray(
					schema.ownerSheets.ownerId,
					owners.map((o) => o.id)
				)
			)
		)
		.orderBy(asc(schema.ownerSheets.position), asc(schema.ownerSheets.id))
	const out: AttributeSheetDecl[] = []
	// A sheet is taken at the first owner in the list that has it, so the order
	// of the chain given is the order of the vocabulary. The session filter is
	// applied here rather than in the query because it is per-KIND: a
	// `session_cast` row belongs to one session (its `owner_id` is a
	// `characters.id`, so without that it would be true of every session that
	// character is in), and a `card` row belongs to none.
	for (const owner of owners)
		for (const row of rows.filter(
			(r) =>
				ownerMatches(r, owner) &&
				r.sessionId ===
					(isSessionScoped(owner.kind) ? (sessionId ?? null) : null)
		)) {
			const decl = getAttributeSheet(row.sheetId)
			if (decl && !out.some((s) => s.id === decl.id)) out.push(decl)
		}
	return out
}

/**
 * 🚧 The session's **world attributes** (ruled 2026-09-25): what its world
 * brings — the sheets on its lorebook and on its cast members, and every slot
 * the world's timeline holds a value for ("historical sheets"). Empty when the
 * session reads none (its genre denies custom attributes, or it switched them
 * off) or has no world. Character cards bring nothing: a card is the same in
 * every story, and what one story tracks of a character is its cast member's.
 */
export async function worldAttributesFor(
	db: Db,
	links: SessionLinks,
	/** Undefined for a lorebook read with no session (`lorebookState.ts`). */
	sessionId: number | undefined,
	on: boolean
): Promise<{ sheets: AttributeSheetDecl[]; recorded: string[] }> {
	if (!on || !links.lorebookId) return { sheets: [], recorded: [] }
	const owners: StateOwner[] = [{ kind: "lorebook", id: links.lorebookId }]
	for (const member of links.cast)
		if (member.castMemberId) owners.push({ kind: "cast_member", id: member.castMemberId })
	// Its places too (phase 4): a sheet on a location entry, and what the
	// timeline recorded of one, are the world's as much as its cast's are.
	for (const place of links.locations) owners.push({ kind: "location", id: place.entryId })
	const sheets = await sheetsForOwners(db, owners, sessionId)
	const castMemberIds = owners.filter((o) => o.kind === "cast_member").map((o) => o.id)
	const locationIds = owners.filter((o) => o.kind === "location").map((o) => o.id)
	const rows = await db
		.selectDistinct({ slotId: schema.attributeValues.slotId })
		.from(schema.attributeValues)
		.where(
			and(
				isNull(schema.attributeValues.sessionId),
				or(
					and(
						eq(schema.attributeValues.ownerKind, "lorebook"),
						eq(schema.attributeValues.ownerId, links.lorebookId)
					),
					castMemberIds.length
						? and(
								eq(schema.attributeValues.ownerKind, "cast_member"),
								inArray(schema.attributeValues.ownerId, castMemberIds)
							)
						: undefined,
					locationIds.length
						? and(
								eq(schema.attributeValues.ownerKind, "location"),
								inArray(schema.attributeValues.ownerId, locationIds)
							)
						: undefined
				)
			)
		)
		.orderBy(asc(schema.attributeValues.slotId))
	return {
		sheets,
		recorded: rows.map((r) => r.slotId).filter((id) => {
			const decl = getAttributeSlot(id)
			return !decl || slotPickable(decl)
		})
	}
}

/** The session's own owners — itself, its cast seats and its places — nearest last. */
const ownOwnersOf = (links: SessionLinks, sessionId: number): StateOwner[] => [
	...links.cast.map((m) => ({ kind: "session_cast" as const, id: m.characterId })),
	...links.locations.map((l) => ({ kind: "session_location" as const, id: l.entryId })),
	{ kind: "session", id: sessionId }
]

/** 🚧 The session's attribute picks, by slot: `false` drops, `true` adds. */
export async function attributePicksFor(db: Db, sessionId: number): Promise<Map<string, boolean>> {
	const rows = await db
		.select({ slotId: schema.sessionAttributePicks.slotId, enabled: schema.sessionAttributePicks.enabled })
		.from(schema.sessionAttributePicks)
		.where(eq(schema.sessionAttributePicks.sessionId, sessionId))
	return new Map(rows.map((r) => [r.slotId, r.enabled]))
}

/** Which owner kinds live inside a session, and therefore carry its id. */
export const isSessionScoped = (kind: OwnerKind): boolean =>
	kind === "session" || kind === "session_cast" || kind === "session_location"

/**
 * The slots THIS session tracks (ruled 2026-09-25): its genre's **baseline**
 * (sheets and loose slots, always), and — only when the genre allows custom
 * attributes — its **world attributes** (`worldAttributesFor`, on unless the
 * session switched them off) and its **own** (sheets on its own owners, and
 * picks), less every slot a pick dropped. The genre decides whether anything
 * beyond its baseline may come in; the session decides which.
 *
 * ⚠ **Not every declaration, and the difference is the whole of "a newcomer in
 * a chat session never sees a bar."** The declaration registry is global — a
 * genre declaring health registers it for the process, not for its own sessions
 * — and every resolution falls back to a declaration's default. So a reader
 * that walked the whole registry would answer "health 20, weather clear" for a
 * standard Chat session on an instance that merely HAS an adventure genre
 * installed, and the Stats widget would draw it.
 *
 * A genre this process does not hold — a plugin genre whose package is
 * disabled, uninstalled or failed to load — resolves to **no vocabulary**, and
 * that is the direction to be wrong in (fail closed): falling back to every
 * declaration put core's case, gold, floor and hp on a Twenty Questions
 * session. Values already stored are untouched and come back the moment the
 * genre is registered again (`plugins/pluginGenres.ts`).
 */
/**
 * 🚧 A declaration as one session carries it: the same slot, on the owners
 * its sheet put it on. Returned as-is when nothing narrows it, so the
 * ordinary slot is still the registry's own object.
 */
export function onOwners(
	decl: AttributeSlotDecl,
	appliesTo: AttributeSlotDecl["appliesTo"] | undefined
): AttributeSlotDecl {
	if (!appliesTo || appliesTo.length === decl.appliesTo.length) return decl
	return Object.freeze({ ...decl, appliesTo: Object.freeze([...appliesTo]) })
}

/** What a session of a genre this process does not hold tracks: nothing. */
const emptyVocabulary = (): Vocabulary => ({
	entries: [],
	entryFor: () => undefined,
	slots: []
})

export async function vocabularyFor(
	db: Db,
	sessionId: number,
	links?: SessionLinks | null
): Promise<Vocabulary> {
	const [row] = await db
		.select({
			genreId: schema.sessions.genreId,
			worldAttributes: schema.sessions.worldAttributes
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const resolved = links ?? (await sessionLinks(db, sessionId))
	const genreId = row?.genreId ?? ""
	const genre = getGenre(genreId)
	// A genre this process does not hold states no vocabulary: see above.
	if (!genre) return emptyVocabulary()
	const custom = genreAllowsCustomAttributes(genre)
	const world = await worldAttributesFor(db, resolved, sessionId, custom && row?.worldAttributes !== false)
	const picks = custom ? await attributePicksFor(db, sessionId) : new Map<string, boolean>()
	const dropped = (slotId: string) => picks.get(slotId) === false

	const entries: VocabularyEntry[] = []
	const byId = new Map<string, VocabularyEntry>()
	const take = (
		decl: AttributeSlotDecl | undefined,
		entry?: SheetSlotEntry,
		sheetId?: string
	) => {
		if (!decl || byId.has(decl.id)) return
		const v: VocabularyEntry = {
			// 🚧 The owners THIS sheet puts it on (2026-09-26): a premade stat
			// that fits the world and the cast — `location` — is carried
			// where the genre's sheet says, and every reader downstream (the
			// state bag, the keeper's guide, the write gate, write-back) sees
			// the narrowed declaration rather than the catalogue's.
			decl: onOwners(decl, entry && sheetSlotAppliesTo(entry, decl)),
			...(entry?.required === undefined
				? {}
				: { required: entry.required }),
			...(entry?.default === undefined ? {} : { default: entry.default }),
			...(entry?.config === undefined ? {} : { config: entry.config }),
			...(sheetId === undefined ? {} : { sheetId })
		}
		byId.set(decl.id, v)
		entries.push(v)
	}
	// The baseline — the genre's sheets and loose slots — always, and first:
	// a pick never drops it.
	for (const sheet of genreSheets(genreId))
		for (const entry of sheet.slots)
			take(getAttributeSlot(entry.id), entry, sheet.id)
	for (const decl of genre.slots ?? []) take(getAttributeSlot(decl.id))
	if (custom) {
		// The world's (on unless switched off), then the session's own; a
		// pick drops either, slot by slot, and a pick adds a slot of its own.
		// A slot a mechanism keeps (`pickable: false`) comes in with the
		// baseline or not at all.
		const pickableSlot = (slotId: string) => {
			const decl = getAttributeSlot(slotId)
			return decl && slotPickable(decl) ? decl : undefined
		}
		for (const sheet of [...world.sheets, ...(await sheetsForOwners(db, ownOwnersOf(resolved, sessionId), sessionId))])
			for (const entry of sheet.slots)
				if (!dropped(entry.id)) take(pickableSlot(entry.id), entry, sheet.id)
		for (const slotId of world.recorded) if (!dropped(slotId)) take(pickableSlot(slotId))
		for (const [slotId, enabled] of picks) if (enabled) take(pickableSlot(slotId))
	}

	return {
		entries,
		entryFor: (slotId: string) => byId.get(slotId),
		slots: entries.map((e) => ({
			id: e.decl.id,
			key: slotKey(e.decl.id),
			type: e.decl.type,
			...trackedShape(e.decl),
			appliesTo: e.decl.appliesTo,
			...(e.required === undefined ? {} : { required: e.required }),
			...(e.decl.retired ? { retired: true as const } : {}),
			...(slotEarshot(e.decl) === "holder" ? { earshot: "holder" as const } : {}),
			...(e.sheetId === undefined ? {} : { sheetId: e.sheetId })
		}))
	}
}

// ── The session's whole state ───────────────────────────────────────────────

export interface StateForOptions {
	/**
	 * Who is speaking in the run this is being resolved for — `who.speaker`.
	 * Absent outside a run, and the key is then absent too.
	 */
	speakerId?: number
	/** Who is asking. `who.user` is that account's persona in this session. */
	userId?: number
	/** What the `roll` filter is a function of, when a run has a seed. */
	seed?: string
}

/**
 * Everything a session's surfaces and templates read: `{ world, cast,
 * slots, who, version }`. What somebody carries is their `inventory` stat
 * (phase 3b retired the possession edges), resolved like any other value.
 *
 * Keyed for a template rather than for the database — `state.world.weather`,
 * `state.cast.verity.hp` — because that is the vocabulary the conditions design
 * exposes and the only layer a template author is allowed to see. Which layer a
 * number came from is a question for the Cast member page, not for a prompt.
 */
export async function stateFor(
	db: Db,
	sessionId: number,
	opts: StateForOptions = {}
): Promise<ResolvedState> {
	// The version FIRST, before any value (U5f review): the reads below are
	// not one snapshot, and a write landing between the values and a version
	// read after them would hand the run a base NEWER than the state it saw —
	// `base >= now` then waves the stale delta through. Read first, the base
	// can only be older than what was seen, and an older base on a slot that
	// moved is refused: the safe side. (Not one REPEATABLE READ transaction:
	// on PGlite a transaction holds the single connection for every query
	// this makes, and a spurious refusal costs one turn where that costs the
	// whole instance.)
	const version = await stateVersionOf(db, sessionId)
	const links = await sessionLinks(db, sessionId)
	const vocabulary = await vocabularyFor(db, sessionId, links)
	const declared = vocabulary.entries.map((e) => e.decl)

	const known = { links, vocabulary }
	const world: Record<string, SlotValue> = {}
	for (const decl of declared.filter((d) => d.appliesTo.includes("world")))
		await writeKeys(world, decl, declared, () =>
			valueOf(
				db,
				{
					sessionId,
					owner: { kind: "session", id: sessionId },
					slotId: decl.id
				},
				known
			)
		)

	// The id index first, and the slugs from it (R17) — one set of objects.
	const byId: Record<string, CastEntry> = {}
	for (const member of links.cast) {
		const entry: CastEntry = {
			id: member.characterId,
			key: castKey(member.name),
			name: member.name,
			enabled: member.isActive
		}
		for (const decl of declared.filter((d) => d.appliesTo.includes("cast")))
			await writeKeys(entry, decl, declared, () =>
				valueOf(
					db,
					{
						sessionId,
						owner: { kind: "session_cast", id: member.characterId },
						slotId: decl.id
					},
					known
				)
			)
		byId[String(member.characterId)] = entry
	}
	const cast: CastIndex = { byId }
	for (const entry of Object.values(byId))
		// First claimant keeps the slug, exactly as a contested bare slot key
		// does: two characters named "The Stranger" are two entries in `byId`
		// and one reachable slug, rather than one of them silently vanishing.
		if (!(entry.key in cast)) cast[entry.key] = entry

	const locations = await locationsFor(db, sessionId, links, vocabulary)

	const who = await whoFor(db, sessionId, links, byId, opts)
	await nameLoreRefs(db, [world, ...Object.values(byId), ...Object.values(locations.byId)])

	const state: ResolvedState = {
		world,
		cast,
		locations,
		slots: vocabulary.slots,
		who,
		version
	}

	// After the chain and after `who`, because an expression may read either.
	deriveExpressions(state, vocabulary, links, opts)
	return state
}

/**
 * 🚧 `state.locations` (phase 4): every location of the session's world with
 * its values for the slots a location carries, down `session_location` →
 * `location` → sheet default → declaration default. One read of the rows for every place, rather than a
 * `valueOf` per place per slot — a world may name dozens of places. None at
 * all when the session tracks no slot a location carries.
 *
 * ⚠ An expression-derived slot reads absent on a location: expressions are
 * evaluated over the cast and the world (`deriveExpressions`), and a place
 * has no scope there yet. A core derivation (`deriveValue`) still computes.
 */
async function locationsFor(
	db: Db,
	sessionId: number,
	links: SessionLinks,
	vocabulary: Vocabulary
): Promise<LocationIndex> {
	const declared = vocabulary.entries.map((e) => e.decl)
	const byId: Record<string, LocationEntry> = {}
	const index: LocationIndex = { byId }
	const carried = declared.filter((d) => d.appliesTo.includes("location"))
	if (!carried.length || !links.locations.length) return index
	const stored = carried.filter((d) => d.type !== "derived")
	const owners: StateOwner[] = links.locations.flatMap((l) => [
		{ kind: "session_location" as const, id: l.entryId },
		{ kind: "location" as const, id: l.entryId }
	])
	const rows = await valueRows(db, owners, stored.map((d) => d.id), sessionId, links.reading)
	for (const place of links.locations) {
		const entry: LocationEntry = { id: place.entryId, key: castKey(place.name), name: place.name }
		const owner: StateOwner = { kind: "session_location", id: place.entryId }
		const chain = resolutionChain(owner, {})
		for (const decl of carried)
			await writeKeys(entry, decl, declared, async () =>
				decl.type === "derived"
					? valueOf(db, { sessionId, owner, slotId: decl.id }, { links, vocabulary })
					: (fromLayers(rows, chain, decl.id) ?? defaultFor(decl, vocabulary))
			)
		byId[String(place.entryId)] = entry
	}
	// First claimant keeps the slug, as the cast's do.
	for (const entry of Object.values(byId)) if (!(entry.key in index)) index[entry.key] = entry
	return index
}

/**
 * 🚧 Fill in the title of every lore reference a list holds (`{ entryId }` →
 * `{ entryId, name }`), so a template and a widget can say it. One query for
 * the whole state, and only when a list holds a reference at all. The title is
 * READ, never stored (`slotValueForStorage` drops it on the way back in) — a
 * copied title is a second answer that goes stale on the first rename. An
 * entry that does not exist keeps its bare id: shown, never dropped.
 */
export async function nameLoreRefs(
	db: Db,
	bags: Record<string, unknown>[]
): Promise<void> {
	const ids = new Set<number>()
	for (const bag of bags)
		for (const value of Object.values(bag)) {
			if (Array.isArray(value)) {
				for (const item of value) if (isSlotLoreRef(item)) ids.add(item.entryId)
			}
			// 🚧 One reference on its own: a location that is a place entry.
			else if (isSlotLoreRef(value)) ids.add(value.entryId)
		}
	if (!ids.size) return
	const rows = await db
		.select({ id: schema.lorebookEntries.id, title: schema.lorebookEntries.title })
		.from(schema.lorebookEntries)
		.where(inArray(schema.lorebookEntries.id, [...ids]))
	const titles = new Map(rows.map((r) => [r.id, r.title]))
	// A new array per value: a declaration's default may be frozen, and the
	// bare and qualified keys of one value are rewritten alike.
	for (const bag of bags)
		for (const [key, value] of Object.entries(bag))
			if (Array.isArray(value) && value.some(isSlotLoreRef))
				// `{ ...item }` keeps the held count (phase 3a); only the name is added.
				bag[key] = value.map((item) =>
					isSlotLoreRef(item) && titles.get(item.entryId)
						? { ...item, name: titles.get(item.entryId)! }
						: item
				)
			else if (isSlotLoreRef(value) && titles.get(value.entryId))
				bag[key] = { ...value, name: titles.get(value.entryId)! }
}

/**
 * One value under both its keys: the qualified one always, the bare one when
 * this declaration is the first claimant of it.
 */
export async function writeKeys(
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

// ── Derivations written as expressions ──────────────────────────────────────

/**
 * Compute every expression-derived slot, in dependency order, over the state
 * that has just been resolved.
 *
 * Synchronous and in place because the scope IS the object being filled: a
 * derivation that reads another derivation has to see the computed value, and
 * an ordering that promised that while handing out a copy would be an ordering
 * that silently did not.
 *
 * ⚠ A cycle does not hang and does not throw. `checkDerivationGraph` refuses
 * one at save, which is where a person can fix it; here the slots in the cycle
 * are evaluated last, once each, against whatever their inputs read — one wrong
 * number rather than a turn that never ends.
 */
function deriveExpressions(
	state: ResolvedState,
	vocabulary: Vocabulary,
	links: SessionLinks,
	opts: StateForOptions
): void {
	const derived = vocabulary.entries
		.map((e) => e.decl)
		.filter(
			(d) =>
				d.type === "derived" &&
				slotDerivation(d) === derivations.liquid.id &&
				typeof d.derive === "string"
		)
	if (!derived.length) return
	const budget = createExpressionBudget()
	const order = derivationOrder(derived)
	const seed = opts.seed ?? `state:${links.sessionId}`

	const into = (bag: Record<string, SlotValue>, ownerKey: string) => {
		for (const decl of order) {
			const scope: ExpressionScope = {
				state: state as unknown as Record<string, unknown>,
				owner: bag,
				who: state.who as unknown as Record<string, unknown>
			}
			const result = evaluate(decl.derive!, scope, {
				seedLabel: `${seed}:derive:${ownerKey}:${decl.id}`,
				budget
			})
			// A refusal reads as absent, which is the derived-slot rule
			// everywhere else in this codebase: a birthdate nobody wrote is not
			// an age of zero, and an expression that would not evaluate is not
			// a value of zero either.
			if (isRefusal(result)) continue
			const value = result.value
			if (value === undefined || value === null) continue
			bag[qualifiedSlotKey(decl.id)] = value as SlotValue
			const bare = slotKey(decl.id)
			if (!(bare in bag) || bag[bare] === undefined)
				bag[bare] = value as SlotValue
		}
	}

	for (const decl of order)
		if (decl.appliesTo.includes("world")) {
			into(state.world, "world")
			break
		}
	for (const entry of Object.values(state.cast.byId))
		if (order.some((d) => d.appliesTo.includes("cast")))
			into(entry as Record<string, SlotValue>, String(entry.id))
}

/**
 * The derived slots in an order where a slot's inputs are computed before it
 * is — a depth-first topological sort over what each expression reads.
 *
 * Slots in a cycle come out last, in declaration order. That is deliberate and
 * is explained at `deriveExpressions`: refusing belongs at save time, where the
 * person who wrote the cycle is standing.
 */
function derivationOrder(derived: AttributeSlotDecl[]): AttributeSlotDecl[] {
	const byKey = new Map<string, AttributeSlotDecl>()
	for (const decl of derived) {
		byKey.set(decl.id, decl)
		byKey.set(slotKey(decl.id), decl)
		byKey.set(qualifiedSlotKey(decl.id), decl)
	}
	const out: AttributeSlotDecl[] = []
	const settled = new Set<string>()
	const open = new Set<string>()
	const visit = (decl: AttributeSlotDecl) => {
		if (settled.has(decl.id) || open.has(decl.id)) return
		open.add(decl.id)
		const reads = expressionReads(decl.derive ?? "")
		for (const name of [...reads.ownerKeys, ...reads.slotIds]) {
			const next = byKey.get(name)
			if (next && next.id !== decl.id) visit(next)
		}
		open.delete(decl.id)
		settled.add(decl.id)
		out.push(decl)
	}
	for (const decl of derived) visit(decl)
	// A cycle leaves its members unsettled at the point they were re-entered;
	// everything is pushed exactly once, so this is a completeness guard rather
	// than an expectation.
	for (const decl of derived) if (!out.includes(decl)) out.push(decl)
	return out
}

/**
 * Why this set of declarations cannot be saved together, or `null`.
 *
 * A cycle is refused at **save**, not at read: "age derives from age" is a
 * sentence somebody wrote and can fix, and the moment to say so is while they
 * are looking at it. Called by `declarations.ts` on every declare and update.
 */
export function checkDerivationGraph(
	declarations: readonly AttributeSlotDecl[]
): string | null {
	const derived = declarations.filter(
		(d) =>
			d.type === "derived" &&
			slotDerivation(d) === derivations.liquid.id &&
			typeof d.derive === "string"
	)
	const byKey = new Map<string, AttributeSlotDecl>()
	for (const decl of derived) {
		byKey.set(decl.id, decl)
		byKey.set(slotKey(decl.id), decl)
		byKey.set(qualifiedSlotKey(decl.id), decl)
	}
	const state = new Map<string, "open" | "done">()
	let cycle: string[] | null = null
	const visit = (decl: AttributeSlotDecl, path: string[]) => {
		if (cycle) return
		if (state.get(decl.id) === "done") return
		if (state.get(decl.id) === "open") {
			cycle = [...path.slice(path.indexOf(decl.id)), decl.id]
			return
		}
		state.set(decl.id, "open")
		const reads = expressionReads(decl.derive ?? "")
		for (const name of [...reads.ownerKeys, ...reads.slotIds]) {
			const next = byKey.get(name)
			if (next) visit(next, [...path, decl.id])
		}
		state.set(decl.id, "done")
	}
	for (const decl of derived) visit(decl, [])
	if (!cycle) return null
	return (
		`these derived slots read each other in a circle: ${(cycle as string[]).join(" → ")}. ` +
		`A derivation computes its value from facts that are already settled, so a ` +
		`ring of them has no first one to compute — break the loop by storing one of ` +
		`them instead.`
	)
}

// ── Who ─────────────────────────────────────────────────────────────────────

/** How far back `who.last` and `who.previous` look for a speaker. */
const SPEAKER_WINDOW = 50

/**
 * The roles, resolved against the cast entries that already exist.
 *
 * Every role points at an entry in `byId` — the same object the slug index
 * holds — so `who.speaker.hp` and `state.cast.verity.hp` are one number and
 * not two reads that might disagree. A role that resolves to somebody who is
 * not in the cast (a character who has left, a persona seated on another
 * session) leaves its key **absent**: half an entry, with an identity and no
 * values, would be worse than no answer at all.
 */
async function whoFor(
	db: Db,
	sessionId: number,
	links: SessionLinks,
	byId: Record<string, CastEntry>,
	opts: StateForOptions
): Promise<WhoKeys> {
	const entry = (id: number | null | undefined): CastEntry | undefined =>
		typeof id === "number" ? byId[String(id)] : undefined

	const who: WhoKeys = {
		active: links.cast
			.filter((c) => !c.isPersona && c.isActive)
			.sort((a, b) => a.position - b.position)
			.map((c) => entry(c.characterId))
			.filter((e): e is CastEntry => !!e)
	}

	const speaker = entry(opts.speakerId)
	if (speaker) who.speaker = speaker

	// The tail rather than the whole transcript: `last` and `previous` are the
	// two most recent speakers, and a session with fifty silent messages in a
	// row has no third answer a longer read would find.
	const tail = await db
		.select({
			characterId: schema.messages.characterId,
			personaId: schema.messages.personaId
		})
		.from(schema.messages)
		.where(eq(schema.messages.sessionId, sessionId))
		.orderBy(desc(schema.messages.id))
		.limit(SPEAKER_WINDOW)
	for (const message of tail) {
		const spoke = entry(message.characterId ?? message.personaId)
		if (!spoke) continue
		if (!who.last) {
			who.last = spoke
			continue
		}
		// The most recent *different* speaker: a character answering themselves
		// twice has not made themselves their own predecessor.
		if (spoke !== who.last) {
			who.previous = spoke
			break
		}
	}

	const [session] = await db
		.select({
			userId: schema.sessions.userId,
			isGroup: schema.sessions.isGroup
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)

	const personas = links.cast
		.filter((c) => c.isPersona)
		.sort((a, b) => a.position - b.position)
	// The session owner voices the first persona seated; a guest's own persona
	// is `who.user`, which is why the two are separate keys rather than one.
	const owner = entry(personas[0]?.characterId)
	if (owner) who.owner = owner
	const asking = opts.userId
		? await personaOf(db, sessionId, opts.userId, personas)
		: undefined
	const user = entry(asking)
	if (user) who.user = user
	else if (owner && opts.userId && opts.userId === session?.userId)
		who.user = owner

	const next = entry(await nextTurn(db, sessionId, session?.isGroup ?? false))
	if (next) who.next = next

	return who
}

/**
 * Which persona an asking user is voicing in this session.
 *
 * A persona belongs to an account (`characters.user_id`), so "the guest's own
 * persona" is a join and not a guess. Absent when they have none seated, which
 * is the ordinary case for a spectator.
 */
async function personaOf(
	db: Db,
	sessionId: number,
	userId: number,
	personas: CastMemberLink[]
): Promise<number | undefined> {
	if (!personas.length) return undefined
	const rows = await db
		.select({ id: schema.characters.id })
		.from(schema.characters)
		.where(
			and(
				eq(schema.characters.userId, userId),
				inArray(
					schema.characters.id,
					personas.map((p) => p.characterId)
				)
			)
		)
	const owned = new Set(rows.map((r) => r.id))
	return personas.find((p) => owned.has(p.characterId))?.characterId
}

/**
 * Whose turn is next: the head of the session's stored turn order
 * (PLAN-turn-order §4.7, A7).
 *
 * Read, not computed. The preview this replaced resolved the session's
 * strategy and re-ran the rotation, which meant two answers to one question
 * and an honest `known: false` whenever the strategy was random or
 * scripted. Turn order is state now — `core:spec/<genre>-turn-order` wrote it down
 * — so this is a row read, it is right for every strategy including the
 * ones a preview could not know, and it cannot disagree with who actually
 * replies because it IS what will be fired.
 *
 * Null when nothing is prepared, when the head is not a character's (a
 * narrator entry names nobody, and this key is a character id), and for a
 * session that is not a group, which is the shape this key has always had.
 */
async function nextTurn(
	db: Db,
	sessionId: number,
	isGroup: boolean
): Promise<number | null> {
	if (!isGroup) return null
	const { headTurnEntry } = await import("$lib/server/sessions/fireTurn")
	const head = await headTurnEntry(db, sessionId)
	const ref = head?.ref
	if (typeof ref !== "string" || !ref.startsWith("character:")) return null
	const id = Number(ref.slice("character:".length))
	return Number.isInteger(id) ? id : null
}

export type { OwnerKind, StateOwner }
