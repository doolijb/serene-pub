/**
 * `state:*` — the playing surface's door to stats and states. What somebody
 * carries is their `inventory` stat, written through `state:set` like any
 * other list (phase 3b retired `state:give` / `state:take` / `state:transfer`
 * with the possession edges they moved).
 *
 * ## What this namespace is, and what it deliberately is not
 *
 * Everything here is **session-scoped**. A caller reads what a value *is* after
 * the resolution chain has run, and writes at the session layer. The template
 * layers — a card's starting values, a world's base ones — are edited in the
 * card editor and the lorebook workspace, because structure is authored away
 * from the playing surface. `state:configure` is the one exception and it is
 * still session-scoped: it is "she grew in *this* session", not "Health caps at
 * 40 everywhere".
 *
 * ## Every write is the user's, and immediate
 *
 * A person editing a bar is authoritative (`DESIGN-stats-and-states.md`), so
 * nothing here goes through the review gate — `state:decide` is where the gate
 * is, and what it decides was proposed by a *model*. That asymmetry is the
 * whole design: the gate exists for the writer who has no authority, and
 * putting the user behind it too would make it look like a confirmation dialog
 * rather than a refusal.
 *
 * ## Why every response carries the whole resolved state
 *
 * A value's meaning depends on layers the client cannot see — one edit can
 * change what several reads return, and a derived slot changes with no row
 * written at all. A client patching a row off a mutation reply would be
 * maintaining a second resolver, and the two would disagree the first time a
 * lorebook default moved. Same posture as `widgetStyles:*`.
 *
 * ## Whole, as the caller may hear it
 *
 * Every reply that carries values — a read, a write's own reply, the ledger,
 * the pending changes — is the CALLER's view (plan A28): a value on a slot
 * declared `earshot: 'holder'` (the Lair's whisper) reaches only its data
 * audience, the session's owner and whoever portrays the member holding it
 * (`state/earshot.ts`). `state:changed` carries no values, so each tab
 * re-reads its own view. The widgets and plugin frames are handed
 * `session_state.v1`, built from `state:get`, so they read the same view.
 * And a value the caller does not hear is not theirs to change: `state:set`
 * and `state:configure` refuse it (`unheardWrite`), `state:decide` answers
 * a pending change the caller is not shown as one that does not exist, and
 * `state:get` offers no control for it (`describeState`).
 */

import { db } from "$lib/server/db"
import { attachedOrOwnBookOf } from "$lib/server/lorebooks/ownBook"
import * as schema from "$lib/server/db/schema"
import { and, eq, inArray, isNull } from "drizzle-orm"
import {
	attributeSlots,
	getAttributeSlot,
	getRuleset,
	isHostStateSlot,
	resolveSlotConfig,
	slotAppliesTo,
	type AttributeSlotDecl,
	type SlotValue
} from "@serene-pub/sdk"
import type { Handler } from "$lib/shared/events"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { broadcastToSessionUsers } from "./utils/broadcastHelpers"
import {
	castKey,
	configFor,
	nameLoreRefs,
	onOwners,
	qualifiedSlotKey,
	trackedShape,
	sessionLinks,
	slotKey,
	stateFor,
	valueOf,
	vocabularyFor,
	defaultFor,
	type LocationLink,
	type SessionLinks,
	type TrackedSlot
} from "$lib/server/state/resolve"
import { castMemberKey, locationOwnerKey } from "$lib/server/state/keys"
import { carryableAttributes, carryKeyOf, carryRowsOf, notCarriedFor, setAttributeCarry } from "$lib/server/state/carries"
import { sessionRulesets, withoutForeignRepertoire } from "$lib/server/rulesets/settings"
import { repertoiresOnWire, withPiecesRead } from "$lib/server/rulesets/read"
import { clockLedgerRows } from "$lib/server/state/clockMoves"
import { entriesAsRead, MAIN_HEAD, placesOnReading } from "$lib/server/state/entriesOnReading"
import {
	earshotSlots,
	hearingOf,
	hears,
	stateAsHeard,
	valueHeard,
	type EarshotSlots,
	type Hearing
} from "$lib/server/state/earshot"
import {
	isOwnerKind,
	ownerFacet,
	resolutionChain,
	type StateOwner
} from "$lib/server/state/owners"
import { i18nTextIn } from "$lib/shared/i18n/i18nText"
import { mediaIdUrl } from "$lib/server/media"
import {
	configure,
	decideProposal,
	listedProposals,
	assertLoreRefsInSession,
	assertTracked,
	setValue,
	playerEditsOwnSheet,
	lockAllows,
	slotLockOf,
	StateRefusal
} from "$lib/server/state/write"

/**
 * Emit the specific error and throw, so `register()` stays quiet rather than
 * following with its generic sentence. Same shape `widgetStyles` uses.
 */
function refuse(
	emitToUser: (event: string, data: any) => void,
	event: string,
	message: string,
	about: { sessionId?: number; request?: string } = {}
): never {
	emitToUser(`${event}:error`, { error: message, ...about })
	throw new Error(message)
}

/**
 * Access, checked once per handler, in the sentence a refusal reads.
 *
 * The refusal names the session it was asked about, so a surface in the
 * asking tab that shows another session can tell it is not about the one it
 * shows. Only the id the caller sent — nothing it did not already know.
 */
async function scoped(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	event: string,
	sessionId: unknown
): Promise<number> {
	const id = Number(sessionId)
	if (!Number.isFinite(id)) refuse(emitToUser, event, "Session not found.")
	const access = await checkSessionAccess(id, socket.user!.id)
	// A session the caller may not see gets the same sentence as one that does
	// not exist — the enumeration rule the rest of this tree follows.
	if (!access.hasAccess)
		refuse(emitToUser, event, "Session not found.", { sessionId: id })
	return id
}

/**
 * `emitToUser`, stamping the writer's `requestId` on `event`'s reply and on
 * its refusal — unchanged, and only when the writer sent one.
 *
 * The reply goes to every tab of the user and the refusal to the tab that
 * asked, each in whatever order the async handlers finish, so a store
 * matching replies to writes by order settles the wrong write; the id is what
 * lets it settle the one write it names.
 *
 * The two are tracked apart, because they call for opposite answers to a
 * failure that follows. `refused` says a refusal went out, so a failure
 * nobody put into words is refused by id exactly once rather than left to
 * time out. `replied` holds the reply that went out, so a failure AFTER it
 * (the broadcast) is not reported as a refusal of a write that landed.
 */
function echoingRequestId(
	emitToUser: (event: string, data: any) => void,
	event: string,
	requestId: unknown
) {
	const id =
		typeof requestId === "string" && requestId.length <= 128
			? requestId
			: undefined
	let replied: { data: any } | null = null
	let refused = false
	return {
		/** The handler's own `emitToUser`, with the writer's id on `event`'s reply and refusal. */
		emitToUser(e: string, data: any) {
			if (e !== event && e !== `${event}:error`)
				return emitToUser(e, data)
			if (e === event) replied = { data }
			else refused = true
			return emitToUser(
				e,
				id === undefined ? data : { ...data, requestId: id }
			)
		},
		/** The reply that went out, boxed (a reply is a payload, even an empty one). */
		get replied() {
			return replied
		},
		get refused() {
			return refused
		}
	}
}

/**
 * The owner a write names, as a shape: a kind and an id.
 *
 * ⚠ Only the shape. Whether the owner is this session's — the session's own
 * book, a place of it on its line, a member of it, a card the caller owns
 * (plan B0) — and whether the caller may write its durable layer at all (a
 * guest never writes the host's book, places or members) is
 * `assertSessionOwner`'s, asked by every writer these handlers call
 * (`setValue`, `configure`, `decideProposal`) with the caller as `userId`,
 * inside the refusal `guarded` turns into a sentence.
 */
function owner(
	emitToUser: (event: string, data: any) => void,
	event: string,
	raw: unknown
): StateOwner {
	const o = raw as { kind?: unknown; id?: unknown } | undefined
	if (!isOwnerKind(o?.kind) || typeof o?.id !== "number")
		refuse(emitToUser, event, "That is not an owner.")
	return { kind: o!.kind as StateOwner["kind"], id: o!.id as number }
}

/** A refusal from the state layer is a sentence a person wrote; pass it through. */
async function guarded<T>(
	emitToUser: (event: string, data: any) => void,
	event: string,
	work: () => Promise<T>
): Promise<T> {
	try {
		return await work()
	} catch (e) {
		if (e instanceof StateRefusal) refuse(emitToUser, event, e.message)
		throw e
	}
}

/**
 * The rows the widget draws: the pending lines, and the **superseded** ones
 * (U5f) — an accept that found the slot moved, kept under its message with
 * no buttons so the ledger says why the model's ask never landed. Accepted
 * and rejected rows are not listed: an accepted one became a ledger line,
 * a rejected one changed nothing.
 *
 * As `hearing` may read them: a pending change to a whisper its caller does
 * not hear is not listed at all (A28) — its payload IS the value.
 */
const proposalRows = async (
	sessionId: number,
	hearing: Hearing,
	links: SessionLinks
): Promise<Sockets.State.ProposalRow[]> => {
	const slots = earshotSlots()
	return (await listedProposals(db, sessionId))
		.filter((row: any) => proposalHeard(hearing, slots, row.payload, links))
		.map(toProposalRow)
}

/** Whether a pending change's payload — the value it would write — is `hearing`'s to read. */
const proposalHeard = (hearing: Hearing, slots: EarshotSlots, raw: unknown, links: SessionLinks): boolean => {
	const payload = (raw ?? {}) as { owner?: { kind?: unknown; id?: unknown }; slotId?: unknown }
	return valueHeard(
		hearing,
		slots,
		{
			owner: { kind: payload.owner?.kind as StateOwner["kind"], id: Number(payload.owner?.id) },
			slotId: payload.slotId
		},
		castMemberOf(links)
	)
}

/** The character a book's cast member is, in this session — `valueHeard`'s way to its member. */
const castMemberOf =
	(links: SessionLinks) =>
	(castMemberId: number): number | undefined =>
		links.cast.find((c) => c.castMemberId === castMemberId)?.characterId

const toProposalRow = (row: any): Sockets.State.ProposalRow => ({
	id: row.id,
	sessionId: row.sessionId,
	messageId: row.messageId ?? null,
	kind: row.kind,
	payload: row.payload ?? {},
	status: row.status,
	proposedBy: row.proposedBy ?? "",
	baseVersion: row.baseVersion ?? null,
	createdAt: new Date(row.createdAt).toISOString()
})

/**
 * Which cast members' holder-only values the caller's replies carry (A28): all of
 * them for the session's owner, the members they portray for anybody else.
 */
const callerHearing = async (socket: any, sessionId: number, links: SessionLinks): Promise<Hearing> =>
	hearingOf(db, sessionId, socket.user!.id, links.cast, links.playerSeats)

/**
 * Why the caller may not change `slotId` on `target`, or `null` when they
 * may (A28): a value not everybody hears is changed only by whoever hears
 * it — a holder-only one by the session's owner and whoever plays its
 * member, an owner-only one by the session's owner. A guest who cannot read
 * a whisper never overwrites or clears it, so its player never reads a
 * guest's words as the owner's.
 */
/**
 * 🚧 Who may change it (PLAN-rulesets-functions D4, `changedBy`): a person's
 * write to an attribute of the session's ruleset whose `changedBy` leaves
 * them out is refused in words — the session's owner writes as the game
 * master, anyone else as the holder. Rules-only attributes change through
 * the rules (a function, a reply that carries changes), never by hand.
 */
async function changedByRefusal(socket: any, sessionId: number, slotId: unknown): Promise<string | null> {
	if (typeof slotId !== "string") return null
	const [row] = await db
		.select({ primaryRuleset: schema.sessions.primaryRuleset })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const { getRuleset } = await import("@serene-pub/sdk")
	const ruleset = row?.primaryRuleset ? getRuleset(row.primaryRuleset) : undefined
	if (!ruleset) return null
	const { changedByAllows } = await import("$lib/server/rulesets/scopes")
	const access = await checkSessionAccess(sessionId, socket.user!.id)
	const writer = access.isOwner ? "gm" : "holder"
	if (changedByAllows(ruleset, slotId, writer)) return null
	const decl = getAttributeSlot(slotId)
	const label = (decl && i18nTextIn(decl.label)) ?? slotKey(slotId)
	return writer === "gm"
		? `${label} changes only by the rules — a function or a reply that carries changes — never by hand.`
		: `Only the game master or the rules change ${label}.`
}

async function unheardWrite(
	socket: any,
	sessionId: number,
	target: StateOwner,
	slotId: unknown
): Promise<string | null> {
	const slots = earshotSlots()
	if (typeof slotId !== "string" || !(slots.holder.has(slotId) || slots.ownerOnly.has(slotId))) return null
	const links = await sessionLinks(db, sessionId)
	const hearing = await callerHearing(socket, sessionId, links)
	if (valueHeard(hearing, slots, { owner: target, slotId }, castMemberOf(links))) return null
	const decl = getAttributeSlot(slotId)
	const label = (decl && i18nTextIn(decl.label)) ?? slotKey(slotId)
	const characterId =
		target.kind === "cast_member"
			? castMemberOf(links)(target.id)
			: target.kind === "session_cast" || target.kind === "card"
				? target.id
				: null
	const name =
		target.kind === "session_location" || target.kind === "location"
			? links.locations.find((l) => l.entryId === target.id)?.name
			: target.kind === "player_seat"
				? links.playerSeats?.find((s) => s.playerSeatId === target.id)?.name
				: links.cast.find((c) => c.characterId === characterId)?.name
	const whose = name ? `${name}'s ${label}` : label
	return slots.holder.has(slotId)
		? `Only the session's owner and whoever plays ${name ?? "that character"} can change ${whose}.`
		: `Only the session's owner can change ${whose}.`
}

/**
 * The one place a write ends: re-resolve, answer the caller with the state as
 * they may hear it, and tell everyone else in the session that something
 * moved — with no values, so each re-reads their own view.
 */
async function settled(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	event: string,
	sessionId: number
) {
	const links = await sessionLinks(db, sessionId)
	// A referenced piece goes out read (§8): the widget carries no compendium.
	const state = await withPiecesRead(
		db,
		stateAsHeard(await stateFor(db, sessionId), await callerHearing(socket, sessionId, links))
	)
	const res = { sessionId, state }
	emitToUser(event, res)
	await broadcastToSessionUsers(socket.io, sessionId, "state:changed", {
		sessionId
	} satisfies Sockets.State.Changed.Response)
	return res
}

// ── What a surface needs beside the values ──────────────────────────────────

/**
 * Declarations in the resolver's own order, so a descriptor describes the slot
 * whose value the state bag actually holds.
 */
const declaredSlots = (): AttributeSlotDecl[] =>
	[...attributeSlots()].sort((a, b) => a.id.localeCompare(b.id))

/**
 * One slot, as a surface has to draw it.
 *
 * `qualifiedKey` is the LOOKUP key: every value is filed under it, while the
 * bare key goes to the first claimant of a contested name. So a widget reads
 * `bag[qualifiedKey]` and shows `key`, and neither has to re-derive the
 * resolver's tie-breaking rule.
 *
 * `retired` is the declaration's; `required` and `sheetId` are what THIS
 * session's vocabulary says of the slot (`tracked`, the resolver's
 * `TrackedSlot`) — each present only when it holds, so a surface can grey a
 * retired slot rather than offer a control the write would refuse.
 */
export const describeSlot = (
	decl: AttributeSlotDecl,
	tracked?: Pick<TrackedSlot, "required" | "sheetId" | "hostState" | "kind" | "shownAs">
): Sockets.State.SlotDescriptor => ({
	slotId: decl.id,
	key: slotKey(decl.id),
	qualifiedKey: qualifiedSlotKey(decl.id),
	label: i18nTextIn(decl.label) ?? slotKey(decl.id),
	description: i18nTextIn(decl.description),
	type: decl.type,
	// What the value is — the stat shape a widget draws it by (phase 2).
	...trackedShape(decl),
	appliesTo: [...decl.appliesTo],
	...(tracked?.required ? { required: true } : {}),
	...(decl.retired ? { retired: true } : {}),
	...(tracked?.sheetId !== undefined ? { sheetId: tracked.sheetId } : {}),
	// 🚧 How it reads at a table that keeps no numbers (Q2-3, ★3).
	...(Array.isArray((decl as { words?: unknown }).words)
		? {
				words: ((decl as unknown as { words: ReadonlyArray<{ upTo: number; label: unknown }> }).words).map((b) => ({
					upTo: b.upTo,
					label: i18nTextIn(b.label as never) ?? ""
				}))
			}
		: {}),
	// 🚧 Drawn only while it holds something (Q3-8: a crawl's death saves).
	...((decl as { shownWhenSet?: unknown }).shownWhenSet === true ? { shownWhenSet: true as const } : {}),
	// 🚧 RF fix 8: the rules' kind and hint, or what the host keeps it as — never both.
	...(tracked?.hostState ? { hostState: tracked.hostState } : {}),
	...(tracked?.kind ? { kind: tracked.kind } : {}),
	...(tracked?.shownAs ? { shownAs: tracked.shownAs } : {})
})

/**
 * Which `(owner, slot)` pairs any layer has configured at all.
 *
 * The configuration in force is `configFor`'s answer and nothing here computes
 * one — this only says where asking is worth a query. A session nobody has
 * configured would otherwise cost a resolution per bar drawn, all of them
 * returning the declaration's own config.
 *
 * Over-matching is safe and under-matching is impossible: the id lists are
 * matched against every kind, so a stray pair costs one extra resolution and no
 * real deviation can be missed.
 */
async function configuredPairs(layers: StateOwner[]): Promise<Set<string>> {
	if (!layers.length) return new Set()
	const rows = await db
		.select({
			ownerKind: schema.attributeConfigs.ownerKind,
			ownerId: schema.attributeConfigs.ownerId,
			slotId: schema.attributeConfigs.slotId
		})
		.from(schema.attributeConfigs)
		.where(
			and(
				inArray(
					schema.attributeConfigs.ownerKind,
					layers.map((l) => l.kind)
				),
				inArray(
					schema.attributeConfigs.ownerId,
					layers.map((l) => l.id)
				)
			)
		)
	return new Set(rows.map((r) => `${r.ownerKind}:${r.ownerId}:${r.slotId}`))
}

/** The chain a session-layer owner resolves down. */
const chainOf = (
	owner: { kind: Sockets.State.StateOwnerRow["kind"]; id: number },
	links: SessionLinks
): StateOwner[] =>
	resolutionChain(owner, {
		castMemberId:
			owner.kind === "session_cast"
				? (links.cast.find((c) => c.characterId === owner.id)?.castMemberId ?? null)
				: null,
		characterId: owner.kind === "session_cast" ? owner.id : null,
		lorebookId: links.lorebookId
	})

/**
 * The slots THIS SESSION tracks — its vocabulary, which its genre enables
 * (ruled 2026-09-25) — and the owners its values belong to, each with the
 * configuration in force for it. A slot the install declares but the session
 * does not track is not offered: a value written to it would never be read.
 *
 * Sent with every read rather than fetched once and cached client-side: a
 * genre, a plugin or an admin can change what is declared, and a cached
 * vocabulary is how a bar keeps drawing a ceiling that moved. `tracked` is
 * the session's vocabulary as the resolver read it (`state.slots`), which
 * says what a sheet made of each slot here.
 */
/**
 * 🚧 The viewer's own player seats in a session: each seat's id, and the
 * card each seated one voices. A seat is its `user_id`'s, else (a row from
 * before that column) the voiced card's owner's. Removed seats are nobody's.
 */
async function ownSeatsOf(
	sessionId: number,
	viewerUserId: number | null
): Promise<{ seatIds: Set<number>; cardIds: Set<number> }> {
	const seatIds = new Set<number>()
	const cardIds = new Set<number>()
	if (viewerUserId == null) return { seatIds, cardIds }
	const rows = await db
		.select({
			id: schema.sessionPersonas.id,
			personaId: schema.sessionPersonas.personaId,
			userId: schema.sessionPersonas.userId,
			cardOwner: schema.characters.userId
		})
		.from(schema.sessionPersonas)
		.leftJoin(schema.characters, eq(schema.characters.id, schema.sessionPersonas.personaId))
		.where(and(eq(schema.sessionPersonas.sessionId, sessionId), isNull(schema.sessionPersonas.removedAt)))
	for (const r of rows) {
		if ((r.userId ?? r.cardOwner) !== viewerUserId) continue
		seatIds.add(r.id)
		if (r.personaId != null) cardIds.add(r.personaId)
	}
	return { seatIds, cardIds }
}

/**
 * 🚧 Whether the viewer may change an owner's values by hand (audit A14) —
 * the same answer the write gives (`assertSessionOwner`, `state/write.ts`),
 * so a widget never offers an edit the host refuses:
 *
 *  · the world, a cast member, a place — play, any player's to change
 *    (what they cannot hear is filtered slot by slot, as the write does);
 *  · a player seat, card-less (`player_seat`) or carded (its card's
 *    `session_cast`, 2026-10-17) — the session's owner always; its own
 *    player only while Honour mode is on; anybody else never.
 *
 * A slot's `lock` (PLAN-sheet §10) is per slot, in `configs[slot].lock`;
 * an owner whose every slot is locked to the viewer reads `editable: false`
 * too (`lockAllows`, the write's own rule).
 */
const ownerEditable =
	(viewer: { sessionOwner: boolean; mySeats: ReadonlySet<number>; myCards: ReadonlySet<number>; seatCards: ReadonlySet<number>; playerHand: boolean }) =>
	(owner: { kind: Sockets.State.StateOwnerRow["kind"]; id: number }): boolean => {
		if (owner.kind === "player_seat") return viewer.sessionOwner || (viewer.mySeats.has(owner.id) && viewer.playerHand)
		if (owner.kind === "session_cast" && viewer.seatCards.has(owner.id))
			return viewer.sessionOwner || (viewer.myCards.has(owner.id) && viewer.playerHand)
		return true
	}

/** 🚧 The cards voiced by a live player seat of the session — the carded seats, written as their cards. */
async function seatCardsOf(sessionId: number): Promise<Set<number>> {
	const rows = await db
		.select({ personaId: schema.sessionPersonas.personaId })
		.from(schema.sessionPersonas)
		.where(and(eq(schema.sessionPersonas.sessionId, sessionId), isNull(schema.sessionPersonas.removedAt)))
	return new Set(rows.map((r) => r.personaId).filter((id): id is number => id != null))
}

/**
 * 🚧 Each owner's **face** (PLAN-sheet §12): a cast member's card avatar
 * (`characters.avatar_media_id`, the by-id `/media/{id}` form every avatar
 * read builds); a player seat's seat portrait (`session_personas.
 * portrait_media_id`), which on a carded seat wins over its card's avatar.
 * `mediaRef` is the file's id as text — `set-owner-face` takes it back.
 */
async function facesOf(
	sessionId: number,
	castIds: readonly number[],
	seatIds: readonly number[]
): Promise<{ cast: Map<number, Face>; seats: Map<number, Face> }> {
	const cast = new Map<number, Face>()
	const seats = new Map<number, Face>()
	const face = (id: number | null | undefined): Face => (id != null ? { src: mediaIdUrl(id), mediaRef: String(id) } : null)
	if (castIds.length) {
		const cards = await db
			.select({ id: schema.characters.id, avatarMediaId: schema.characters.avatarMediaId })
			.from(schema.characters)
			.where(inArray(schema.characters.id, [...castIds]))
		for (const c of cards) cast.set(c.id, face(c.avatarMediaId))
	}
	const portraits = await db
		.select({
			id: schema.sessionPersonas.id,
			personaId: schema.sessionPersonas.personaId,
			portraitMediaId: schema.sessionPersonas.portraitMediaId
		})
		.from(schema.sessionPersonas)
		.where(and(eq(schema.sessionPersonas.sessionId, sessionId), isNull(schema.sessionPersonas.removedAt)))
	for (const p of portraits) {
		if (p.portraitMediaId == null) continue
		if (p.personaId != null) cast.set(p.personaId, face(p.portraitMediaId))
		if (seatIds.includes(p.id)) seats.set(p.id, face(p.portraitMediaId))
	}
	return { cast, seats }
}

type Face = { src: string; mediaRef: string | null } | null

async function describeState(
	sessionId: number,
	links: SessionLinks,
	tracked: readonly TrackedSlot[],
	hearing: Hearing,
	/** 🚧 Who is asking: their own seat's owner rows carry `mine` (the stats widget's `owners: 'mine'`). */
	viewerUserId: number | null = null
): Promise<{
	slots: Sockets.State.SlotDescriptor[]
	owners: Sockets.State.StateOwnerRow[]
}> {
	const trackedById = new Map(tracked.map((t) => [t.id, t]))
	// 🚧 In the session's own order (2026-10-18, the 100-turn walk #40): the
	// vocabulary's — the genre's sheet first, as it lists them (Health
	// first) — never the registry's, which read alphabetically.
	const order = new Map(tracked.map((t, i) => [t.id, i]))
	// On the owners the session's sheet put each one on (a premade stat
	// such as `location` may be the world's in one genre, the cast's in
	// another): a card never offers a slot the write would refuse.
	const declared = declaredSlots()
		.filter((decl) => trackedById.has(decl.id))
		.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
		.map((decl) => onOwners(decl, trackedById.get(decl.id)?.appliesTo))
	const [session] = await db
		.select({ name: schema.sessions.name, userId: schema.sessions.userId, primaryRuleset: schema.sessions.primaryRuleset })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	const plays = sessionRulesets(session)
	// The session's owner hears everything; a player's hand on their own
	// sheet waits on Honour mode. Read once, only when there is a seat to ask about.
	const seatCards = await seatCardsOf(sessionId)
	const playerHand =
		!hearing.all && ((links.playerSeats ?? []).length || seatCards.size)
			? await playerEditsOwnSheet(db, sessionId)
			: false

	const { seatIds: mySeats, cardIds: myCards } = await ownSeatsOf(sessionId, viewerUserId)
	const sessionOwner = viewerUserId != null ? session?.userId === viewerUserId : hearing.all
	const editable = ownerEditable({ sessionOwner, mySeats, myCards, seatCards, playerHand })
	const faces = await facesOf(
		sessionId,
		links.cast.map((m) => m.characterId),
		(links.playerSeats ?? []).map((p) => p.playerSeatId)
	)

	const owners: Sockets.State.StateOwnerRow[] = [
		{
			key: "world",
			kind: "session",
			id: sessionId,
			label: session?.name ?? "World",
			editable: editable({ kind: "session", id: sessionId }),
			face: null,
			configs: {}
		},
		...links.cast.map((member) => ({
			key: castKey(member.name),
			kind: "session_cast" as const,
			id: member.characterId,
			label: member.name,
			editable: editable({ kind: "session_cast", id: member.characterId }),
			face: faces.cast.get(member.characterId) ?? null,
			// 🚧 The viewer's own card, seated as their player seat.
			...(myCards.has(member.characterId) ? { mine: true } : {}),
			// 🚧 A card seated as a player seat (2026-10-18): `owners: seats`.
			...(seatCards.has(member.characterId) ? { seat: true } : {}),
			configs: {}
		})),
		// 🚧 Each card-less player seat: a cast member with no card, keyed
		// `player_seat:<id>` as `stateFor` files it in `cast.byId` (`castMemberKey`)
		// — never by its name's slug, which a card's could share. A seat
		// with a card is already above, as that card's member.
		...(links.playerSeats ?? []).map((seat) => ({
			key: castMemberKey(seat),
			kind: "player_seat" as const,
			id: seat.playerSeatId,
			label: seat.name,
			// 🚧 The session's owner writes any seat's sheet; its player
			// only while Honour mode is on (`assertSessionOwner`,
			// 2026-10-16) — so a player's own sheet draws read-only until then.
			editable: editable({ kind: "player_seat", id: seat.playerSeatId }),
			face: faces.seats.get(seat.playerSeatId) ?? null,
			...(mySeats.has(seat.playerSeatId) ? { mine: true } : {}),
			seat: true,
			configs: {}
		})),
		// 🚧 Each place of the world (phase 4) — listed only when the session
		// tracks a slot a location carries, so a world with forty places and
		// nothing to say of them sends forty owners with nothing on them to
		// nobody. Keyed `location:<slug>`, apart from the cast's keys.
		...(declared.some((d) => slotAppliesTo(d, "location"))
			? links.locations.map((place) => ({
					key: locationOwnerKey(place.name),
					kind: "session_location" as const,
					id: place.entryId,
					label: place.name,
					editable: editable({ kind: "session_location", id: place.entryId }),
					face: null,
					configs: {}
				}))
			: [])
	]

	// Paired with their owner rather than keyed by it: two cast members whose
	// names normalise to one key are two owners with two chains, and a map
	// would hand both of them the second one's.
	const chains = owners.map((o) => ({
		owner: o,
		chain: chainOf({ kind: o.kind, id: o.id }, links)
	}))
	const configured = await configuredPairs(chains.flatMap((c) => c.chain))
	// 🚧 What each holder carries (attribute carries, RF fix 2 item 3).
	const notCarried = await notCarriedFor(db, sessionId, plays)

	const slots = earshotSlots(tracked)
	for (const { owner, chain } of chains) {
		const facet = ownerFacet(owner.kind)
		const off = notCarried.get(carryKeyOf(owner))
		for (const decl of declared) {
			// A slot the owner may not carry is not an empty control on its
			// card: it is not that owner's slot at all.
			if (!slotAppliesTo(decl, facet)) continue
			// 🚧 Nor one switched off for this holder: not shown.
			if (off?.has(decl.id)) continue
			// Nor is one the caller does not hear there (A28): a guest is
			// offered no Whisper box on a character they do not play.
			if (!valueHeard(hearing, slots, { owner: { kind: owner.kind, id: owner.id }, slotId: decl.id })) continue
			const deviates = chain.some((layer) =>
				configured.has(`${layer.kind}:${layer.id}:${decl.id}`)
			)
			// A foreign ruleset's repertoire is struck (PLAN §15 B); `configFor`
			// strikes it on its own path.
			owner.configs[decl.id] = deviates
				? await configFor(db, {
						sessionId,
						owner: { kind: owner.kind, id: owner.id },
						slotId: decl.id
					})
				: withoutForeignRepertoire(resolveSlotConfig(decl), plays)
		}
		// 🚧 Each repertoire its list stats hold: name and piece shape, so a
		// widget labels a piece and draws its form without the declaration (§8).
		const repertoires = repertoiresOnWire(owner.configs)
		if (repertoires) owner.repertoires = repertoires
		// 🚧 Every slot locked to the viewer's hand (PLAN-sheet §10): nothing
		// here is theirs to edit, whoever the owner is.
		const configs = Object.values(owner.configs)
		if (owner.editable && configs.length && configs.every((c) => !lockAllows(slotLockOf(c), { hand: true, sessionOwner })))
			owner.editable = false
	}

	// 🚧 What the ruleset works out from each character's sheet and puts on
	// it (2026-10-18, `derived`): armour class, read-only on the widget. Only
	// the cast and the seats carry a sheet the ruleset reads.
	const sheeted = owners.filter((o) => o.kind === "session_cast" || o.kind === "player_seat")
	if (sheeted.length && plays.length) {
		const { sheetDerivedOf } = await import("$lib/server/rulesets/resolve")
		const derived = await sheetDerivedOf(db, sessionId, sheeted)
		for (const o of sheeted) {
			const rows = derived.get(`${o.kind}:${o.id}`)
			if (rows?.length) o.derived = rows
		}
	}
	// 🚧 Each character's tie sides (ties on the graph, screen 2): towards
	// whom, the words, the numbers this viewer may see, the other side.
	if (sheeted.length && plays.length) {
		try {
			const { tiesOnWire } = await import("$lib/server/rulesets/ties")
			const ties = await tiesOnWire(db, sessionId, sheeted, { sessionOwner })
			for (const o of sheeted) {
				const rows = ties.get(`${o.kind}:${o.id}`)
				if (rows?.length) o.ties = rows
			}
		} catch (e) {
			console.warn(`[state] the ties of session ${sessionId} could not be read:`, e)
		}
	}

	// 🚧 What each owner holds, zone by zone (RF fix 8): the rules' zone
	// types, the host's carried zone among them, as this viewer may see them.
	const rulesetId = plays[0]
	const ruleset = rulesetId ? getRuleset(rulesetId) : undefined
	if (ruleset) {
		try {
			const { zonesOnWire } = await import("$lib/server/rulesets/zones")
			const playsHolder = (o: { kind: string; id: number }) => !!(hearing.all || hears(hearing, carryKeyOf(o)))
			const zones = await zonesOnWire(db, sessionId, ruleset, owners, { sessionOwner, plays: playsHolder })
			for (const o of owners) {
				const rows = zones.get(o.key)
				if (rows?.length) o.zones = rows
			}
		} catch (e) {
			console.warn(`[state] the zones of session ${sessionId} could not be read:`, e)
		}
	}
	// 🚧 Each holder's switches for the rules' optional attributes (RF fix 8):
	// the sheet offers an attribute back once it is off — whoever plays the
	// holder, or the session's owner.
	if (plays.length && viewerUserId != null) {
		const rows = (await carriesOnWire(sessionId, viewerUserId, plays, links, sessionOwner)).filter((r) => !r.required && !isHostStateSlot(r.slotId))
		for (const o of owners)
			for (const row of rows) {
				const h = row.holders.find((x) => x.owner.kind === o.kind && x.owner.id === o.id)
				if (h) (o.carries ??= []).push({ slotId: row.slotId, label: row.label, carries: h.carries, mayChange: h.mayChange })
			}
	}

	return {
		slots: declared.map((decl) =>
			describeSlot(decl, trackedById.get(decl.id))
		),
		owners
	}
}

// ── The ledger ──────────────────────────────────────────────────────────────

/** Oldest first: by anchor, then by when the row was written. */
const byAnchor = (
	a: { messageId: number | null; at: number; kind: string; id: number },
	b: { messageId: number | null; at: number; kind: string; id: number }
): number =>
	(a.messageId ?? -1) - (b.messageId ?? -1) ||
	a.at - b.at ||
	a.kind.localeCompare(b.kind) ||
	a.id - b.id

/**
 * This session's anchored rows, and what each changed slot read before the
 * session touched it.
 *
 * Session-layer rows only. The template layers are what the session inherited,
 * not what it changed, and a ledger that listed them would attribute a world's
 * standing weather to whichever message happened to be first.
 *
 * As `hearing` may read them: a line on a holder-only slot (the Lair's whisper) is
 * listed only for its data audience (A28), and a baseline follows its lines.
 */
async function ledgerFor(
	sessionId: number,
	links: SessionLinks,
	hearing: Hearing
): Promise<Sockets.State.Ledger.Response> {
	const [session] = await db
		.select({ name: schema.sessions.name, rigour: schema.sessions.rigour })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	// 🚧 The world is the scene: its lines need no name over them (PLAN-dc-after-walk2
	// Q3-2, the walk's N14: "P2 Solo VI points Time Day 1, 08:00 → 08:05").
	const worldLabel = ""
	const memberOf = new Map(links.cast.map((c) => [c.characterId, c]))

	const slots = earshotSlots()
	const values = (
		await db
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.sessionId, sessionId))
	).filter((row) =>
		valueHeard(hearing, slots, {
			owner: { kind: row.ownerKind as StateOwner["kind"], id: row.ownerId },
			slotId: row.slotId
		})
	)

	// Named by the places the BOOK sees (plan A27): the session's values on
	// a room switched Off since are still its rows, and a row with no name
	// names nobody. The session's own sight would drop them.
	const places = await ledgerPlaces(links)
	const placeOf = new Map(places.map((l) => [l.entryId, l]))
	// 🚧 A `player_seat` owner is a player's seat by `session_personas.id`: named by
	// its seat name, else the card it voices — never through the cast map,
	// whose keys are character ids.
	const seatRows = values.some((r) => r.ownerKind === "player_seat")
		? await db
				.select({
					id: schema.sessionPersonas.id,
					seatName: schema.sessionPersonas.seatName,
					cardName: schema.characters.name
				})
				.from(schema.sessionPersonas)
				.leftJoin(
					schema.characters,
					eq(schema.characters.id, schema.sessionPersonas.personaId)
				)
				.where(eq(schema.sessionPersonas.sessionId, sessionId))
		: []
	const seatOf = new Map(
		seatRows.map((r) => [r.id, r.seatName?.trim() || r.cardName || ""])
	)
	const named = (ownerKind: string, ownerId: number) =>
		ownerKind === "session"
			? { key: "world", label: worldLabel }
			: ownerKind === "player_seat"
				? {
						key: castMemberKey({ playerSeatId: ownerId }),
						label: seatOf.get(ownerId) ?? ""
					}
			: ownerKind === "session_location"
				? {
						key: locationOwnerKey(placeOf.get(ownerId)?.name ?? String(ownerId)),
						label: placeOf.get(ownerId)?.name ?? ""
					}
				: {
						key: castKey(memberOf.get(ownerId)?.name ?? ""),
						label: memberOf.get(ownerId)?.name ?? ""
					}

	// 🚧 Each bounded number's maximum as this session configured it, by owner
	// and slot, oldest first (Q3-1: a new character's health reads "10
	// (full)", never "20 → 10" over the declared default).
	const maxima = values.some((r) => typeof r.value?.v === "number")
		? (
				await db
					.select({
						ownerKind: schema.attributeConfigs.ownerKind,
						ownerId: schema.attributeConfigs.ownerId,
						slotId: schema.attributeConfigs.slotId,
						config: schema.attributeConfigs.config,
						at: schema.attributeConfigs.validFromMessageId,
						id: schema.attributeConfigs.id
					})
					.from(schema.attributeConfigs)
					.where(eq(schema.attributeConfigs.sessionId, sessionId))
			)
				.filter((c) => typeof (c.config as { max?: unknown } | null)?.max === "number")
				.sort((a, b) => (a.at ?? -1) - (b.at ?? -1) || a.id - b.id)
		: []
	const maxAt = (ownerKind: string, ownerId: number, slotId: string, at: number | null): number | undefined => {
		let found: number | undefined
		for (const c of maxima)
			if (c.ownerKind === ownerKind && c.ownerId === ownerId && c.slotId === slotId && (c.at ?? -1) <= (at ?? -1))
				found = (c.config as { max: number }).max
		return found
	}

	const rows: Sockets.State.LedgerRow[] = [
		...values.map((row) => {
			const who = named(row.ownerKind, row.ownerId)
			const decl = getAttributeSlot(row.slotId)
			const max = typeof row.value?.v === "number" ? maxAt(row.ownerKind, row.ownerId, row.slotId, row.validFromMessageId) : undefined
			return {
				id: row.id,
				kind: "value" as const,
				messageId: row.validFromMessageId,
				ownerKey: who.key,
				ownerLabel: who.label,
				updatedBy: row.updatedBy,
				createdAt: new Date(row.createdAt).toISOString(),
				slotId: row.slotId,
				slotLabel: decl
					? (i18nTextIn(decl.label) ?? slotKey(decl.id))
					: slotKey(row.slotId),
				value: (row.value?.v ?? null) as SlotValue,
				...(max !== undefined ? { max } : {})
			}
		}),
		// 🚧 The clock's moves (live scenes §15 G5): the world's lines, heard
		// by everyone — the clock is the session's own, never a holder's.
		...(await clockLedgerRows(db, sessionId, links.lorebookId ?? (await attachedOrOwnBookOf(db, sessionId)))).map((move) => ({
			id: move.id,
			kind: "clock" as const,
			messageId: move.messageId,
			ownerKey: "world",
			ownerLabel: worldLabel,
			updatedBy: move.updatedBy,
			createdAt: move.createdAt,
			clock: {
				by: move.by,
				unit: move.unit,
				cause: move.cause,
				fromLabel: move.fromLabel,
				toLabel: move.toLabel,
				from: move.from,
				to: move.to,
				skipped: move.skipped
			}
		}))
	]
		.map((row) => ({ row, at: new Date(row.createdAt).getTime() }))
		.sort((a, b) =>
			byAnchor({ ...a.row, at: a.at }, { ...b.row, at: b.at })
		)
		.map((r) => r.row)

	const baselines = await baselinesFor(rows, links, places)
	// A lore reference reads by its title, as `stateFor` names them — the
	// row stores the id (and held count) alone, and a ledger line saying
	// `entry 12` names nothing a person wrote (phase 3a). Read-time only.
	await nameLoreRefs(
		db,
		[...rows.filter((r) => r.kind === "value"), ...baselines] as unknown as Record<
			string,
			unknown
		>[],
		links.reading ?? null,
		"session",
		places
	)
	// 🚧 A table that keeps no numbers (the `prose` rigour — Story's Words
	// only) reads its change lines in words (P2-6, the walk's B13: "Health
	// 10 → 8" under "no numbers").
	return { sessionId, rows, baselines, ...(session?.rigour === "prose" ? { words: true } : {}) }
}

/**
 * The places the ledger names a row by: every place the book sees on the
 * session's reading, switched Off ones included (`placesOnReading(…,
 * "book")`). A ledger is the session's own history, and a value it set on a
 * room since switched off is part of it.
 */
async function ledgerPlaces(links: SessionLinks): Promise<LocationLink[]> {
	const out: LocationLink[] = links.lorebookId
		? await placesOnReading(db, links.lorebookId, links.reading ?? MAIN_HEAD, "book")
		: []
	// 🚧 The session's own notes' rooms too (PLAN-rulesets §26): a crawl with
	// no lorebook names its rooms from them, at the notes' head.
	const { ownBookOf } = await import("$lib/server/lorebooks/ownBook")
	const ownBook = await ownBookOf(db, links.sessionId)
	if (ownBook && ownBook.id !== links.lorebookId)
		for (const place of await placesOnReading(db, ownBook.id, MAIN_HEAD, "book"))
			out.push({ ...place, sessionOnly: true })
	return out
}

/**
 * What each changed slot read before this session touched it — the left-hand
 * side of the run's first line.
 *
 * Which layer answers is a question about rows; WHAT it answers is the
 * resolver's, so the layer is chosen here and the value is still `valueOf`'s.
 * A slot no template layer has is the session's sheet default, else the
 * declaration's own (`defaultFor`), which is what every read of it returned.
 */
async function baselinesFor(
	rows: Sockets.State.LedgerRow[],
	links: SessionLinks,
	/** The places the ledger names its rows by (`ledgerPlaces`). */
	places: readonly LocationLink[]
): Promise<Sockets.State.LedgerBaseline[]> {
	const wanted = new Map<string, { ownerKey: string; slotId: string }>()
	for (const row of rows)
		if (row.kind === "value" && row.slotId)
			wanted.set(`${row.ownerKey}:${row.slotId}`, {
				ownerKey: row.ownerKey,
				slotId: row.slotId
			})
	if (!wanted.size) return []

	const memberByKey = new Map(
		links.cast.map((c) => [castKey(c.name), c] as const)
	)
	const placeByKey = new Map(
		places.map((l) => [locationOwnerKey(l.name), l] as const)
	)
	const layers: StateOwner[] = [
		...(links.lorebookId
			? [{ kind: "lorebook" as const, id: links.lorebookId }]
			: []),
		...links.cast.flatMap((c) => [
			...(c.castMemberId
				? [{ kind: "cast_member" as const, id: c.castMemberId }]
				: []),
			{ kind: "card" as const, id: c.characterId }
		])
	]
	const rowsAt = await valuedPairs(layers)
	// The bottom of the chain is the session's sheet default, then the
	// declaration's (`defaultFor`) — read once for every baseline.
	const vocabulary = await vocabularyFor(db, links.sessionId, links)

	const out: Sockets.State.LedgerBaseline[] = []
	for (const { ownerKey, slotId } of wanted.values()) {
		const member = memberByKey.get(ownerKey)
		const place = placeByKey.get(ownerKey)
		const owner: StateOwner | null =
			ownerKey === "world"
				? links.lorebookId
					? { kind: "lorebook" as const, id: links.lorebookId }
					: null
				: place
					? // A place's layer below the session is its own entry (phase 4).
						{ kind: "location" as const, id: place.entryId }
				: member
					? member.castMemberId &&
						rowsAt.has(
							`cast_member:${member.castMemberId}:${slotId}`
						)
						? {
								kind: "cast_member" as const,
								id: member.castMemberId
							}
						: { kind: "card" as const, id: member.characterId }
					: null
		const value = owner
			? await valueOf(
					db,
					{
						sessionId: links.sessionId,
						owner,
						slotId
					},
					{ links, vocabulary }
				)
			: defaultFor(getAttributeSlot(slotId), vocabulary)
		if (value === undefined) continue
		out.push({ ownerKey, slotId, value })
	}
	return out
}

/** Which `(owner, slot)` pairs a template layer has a value row for. */
async function valuedPairs(layers: StateOwner[]): Promise<Set<string>> {
	if (!layers.length) return new Set()
	const rows = await db
		.select({
			ownerKind: schema.attributeValues.ownerKind,
			ownerId: schema.attributeValues.ownerId,
			slotId: schema.attributeValues.slotId
		})
		.from(schema.attributeValues)
		.where(
			and(
				inArray(
					schema.attributeValues.ownerKind,
					layers.map((l) => l.kind)
				),
				inArray(
					schema.attributeValues.ownerId,
					layers.map((l) => l.id)
				)
			)
		)
	return new Set(rows.map((r) => `${r.ownerKind}:${r.ownerId}:${r.slotId}`))
}

export const stateGet: Handler<
	Sockets.State.Get.Params,
	Sockets.State.Get.Response
> = {
	event: "state:get",
	handler: async (socket, params, emitToUser) => {
		const sessionId = await scoped(
			socket,
			emitToUser,
			"state:get",
			params?.sessionId
		)
		const links = await sessionLinks(db, sessionId)
		const state = await stateFor(db, sessionId)
		const hearing = await callerHearing(socket, sessionId, links)
		const res = {
			sessionId,
			// The caller's view: a whisper only for whoever may hear it (A28).
			state: await withPiecesRead(db, stateAsHeard(state, hearing)),
			...(await describeState(sessionId, links, state.slots, hearing, socket.user?.id ?? null)),
			// 🚧 A table that keeps no numbers (Q2-3, ★3): its widgets draw words.
			...((await keepsNoNumbers(sessionId)) ? { wordsOnly: true as const } : {}),
			// 🚧 The people its story has met (Q3-5): Scene Portraits' faces.
			metPeople: await metPeopleOf(sessionId),
			// 🚧 The story clock in words (RF fix 8): the world's _when_ on a sheet.
			...(await storyTimeWords(sessionId, links))
		}
		emitToUser("state:get", res)
		return res
	}
}

/**
 * 🚧 The session's story clock in words (RF fix 8, 2026-10-23): where its
 * story's now stands on its book's calendar — the _when_ of a sheet's
 * _Where and when_ row. Nothing when the session keeps no clock.
 */
async function storyTimeWords(sessionId: number, links: SessionLinks): Promise<{ storyTime?: string }> {
	try {
		const { sessionStoryNowOf, bookCalendarOf, clockOfNow } = await import("$lib/server/state/storyTime")
		const now = await sessionStoryNowOf(db, sessionId)
		if (!now) return {}
		const { formatDate } = await import("$lib/shared/lorebooks/storyDate")
		const calendar = links.lorebookId ? await bookCalendarOf(db, links.lorebookId) : null
		const words = formatDate(clockOfNow(now) as never, calendar)
		return words ? { storyTime: words } : {}
	} catch (e) {
		console.warn(`[state] the story clock of session ${sessionId} could not be read:`, e)
		return {}
	}
}

/**
 * 🚧 The people this session's story has met (PLAN-dc-after-walk2 Q3-5, the
 * walk's #29): the `core:entry/character-lore` entries of the session's OWN
 * notes (its own book — where a story that writes people, a dungeon
 * crawl's, puts each one it meets), as the session sees them, entry order.
 * ⏳ A session with a lorebook of its own lists none: that book holds people
 * the story never met, and nothing yet marks the ones it did.
 */
async function metPeopleOf(sessionId: number): Promise<{ entryId: number; name: string }[]> {
	const { ownBookOf } = await import("$lib/server/lorebooks/ownBook")
	const ownBook = await ownBookOf(db, sessionId)
	if (!ownBook) return []
	const [row] = await db
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (row?.lorebookId && row.lorebookId !== ownBook.id) return []
	const people = (await entriesAsRead(db, ownBook.id, MAIN_HEAD, "session", ["core:entry/character-lore"]))
		.filter((p) => !p.unseen && p.name.trim())
		.map(({ entryId, name }) => ({ entryId, name: name.trim() }))
	if (!people.length) return []
	/**
	 * 🚧 …once the story has met them (PLAN-dc-after-walk3 R3-3, the walk's
	 * NEW-13: a world's people, written when it was built, showed as met
	 * before anyone had seen them): a person is met when the story — a
	 * visible line on `main` — has named them, by their whole name or their
	 * first (a capitalised word of three letters or more).
	 */
	const told = await db
		.select({ content: schema.sessionMessages.content })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.channel, "main"),
				eq(schema.sessionMessages.isHidden, false)
			)
		)
	const story = told.map((m) => m.content ?? "").join("\n")
	const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const named = (name: string): boolean => {
		if (new RegExp(`\\b${escape(name)}\\b`, "i").test(story)) return true
		const first = name.split(/\s+/)[0] ?? ""
		return first.length >= 3 && first !== name && /^\p{Lu}/u.test(first) && new RegExp(`\\b${escape(first)}\\b`).test(story)
	}
	return people.filter((p) => named(p.name))
}

/**
 * 🚧 Does this session's table keep no numbers (PLAN-dc-after-walk2 Q2-3,
 * owner ruling ★3)? When the ruleset it plays is one of words — it decides
 * nothing by its rules (the Story ruleset; 🚧 2026-10-22, `rulesetDecides`:
 * a check method other than `none`, dice or not — never "declares no
 * dice"). 🚧 RF fix 8: and declares no number of its own — rules that
 * track numbers without deciding by them still draw them. A ruleset this
 * install does not hold says no.
 */
async function keepsNoNumbers(sessionId: number): Promise<boolean> {
	const [row] = await db
		.select({ primaryRuleset: schema.sessions.primaryRuleset })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const { getRuleset, rulesetSections, rulesetAttributeKinds, NUMBER_ATTRIBUTE_KINDS } = await import("@serene-pub/sdk")
	const ruleset = row?.primaryRuleset ? getRuleset(row.primaryRuleset) : undefined
	const { rulesetDecides } = await import("$lib/server/rulesets/methods")
	if (!ruleset || rulesetDecides(ruleset)) return false
	// 🚧 RF fix 8: attributes are the rules' — rules that declare a number of
	// their own (a number, a pool, a tally) keep it, deciding or not; only
	// rules that count nothing at all are a table of words.
	const numbers: readonly string[] = NUMBER_ATTRIBUTE_KINDS
	return !(rulesetSections(ruleset).attributes ?? []).some((a) => (rulesetAttributeKinds(a) ?? []).some((k) => numbers.includes(k)))
}

export const stateLedger: Handler<
	Sockets.State.Ledger.Params,
	Sockets.State.Ledger.Response
> = {
	event: "state:ledger",
	handler: async (socket, params, emitToUser) => {
		const sessionId = await scoped(
			socket,
			emitToUser,
			"state:ledger",
			params?.sessionId
		)
		const links = await sessionLinks(db, sessionId)
		const res = await ledgerFor(
			sessionId,
			links,
			await callerHearing(socket, sessionId, links)
		)
		emitToUser("state:ledger", res)
		return res
	}
}

/**
 * 🚧 `state:setOwnerFace` (PLAN-sheet §12): the `set-owner-face` widget
 * request's door — a player seat's portrait set or cleared
 * (`sessions/seatPortrait.ts` holds the rules: own seat, or the session's
 * owner for anyone). Reply and refusal carry the ask's `request` token; a
 * write that landed tells every member `state:changed`, so the new `face`
 * arrives on the next `session_state` read.
 */
export const stateSetOwnerFace: Handler<
	Sockets.State.SetOwnerFace.Params,
	Sockets.State.SetOwnerFace.Response
> = {
	event: "state:setOwnerFace",
	handler: async (socket, params, emitToUser) => {
		const token = typeof params?.request === "string" ? { request: params.request } : {}
		const sessionId = params?.sessionId
		const refuseFace = (error: string) => {
			const res = { ...(typeof sessionId === "number" ? { sessionId } : {}), ...token, error }
			emitToUser("state:setOwnerFace:error", res)
			return res
		}
		try {
			if (typeof sessionId !== "number" || !Number.isInteger(sessionId))
				return refuseFace("Which session? None was named.")
			const access = await checkSessionAccess(sessionId, socket.user!.id)
			if (!access.hasAccess) return refuseFace("Session not found.")
			const o = params.owner as { kind?: unknown; id?: unknown } | undefined
			if (!o || typeof o.kind !== "string" || typeof o.id !== "number" || !Number.isInteger(o.id))
				return refuseFace("Whose face? No owner was named.")
			const { writeSeatPortrait } = await import("$lib/server/sessions/seatPortrait")
			const written = await writeSeatPortrait(db, {
				sessionId,
				userId: socket.user!.id,
				isOwner: !!access.isOwner,
				owner: { kind: o.kind as Sockets.State.SetOwnerFace.Params["owner"]["kind"], id: o.id },
				mediaRef: params.mediaRef ?? null
			})
			const res = { sessionId, ...token, ...written }
			emitToUser("state:setOwnerFace", res)
			try {
				await broadcastToSessionUsers(socket.io, sessionId, "state:changed", {
					sessionId
				} satisfies Sockets.State.Changed.Response)
			} catch (e) {
				console.warn("[state] setOwnerFace: telling the session failed:", e)
			}
			return res
		} catch (e) {
			const { SeatPortraitRefusal } = await import("$lib/server/sessions/seatPortrait")
			if (!(e instanceof SeatPortraitRefusal)) console.warn("[state] setOwnerFace failed:", e)
			return refuseFace(e instanceof SeatPortraitRefusal ? e.message : "The portrait could not be changed.")
		}
	}
}

export const stateSet: Handler<
	Sockets.State.Set.Params,
	Sockets.State.Set.Response
> = {
	event: "state:set",
	handler: async (socket, params, emitToUser) => {
		// The reply and the refusal both carry the writer's `requestId`.
		const reply = echoingRequestId(
			emitToUser,
			"state:set",
			params?.requestId
		)
		// The session whose write committed: from here on, nothing that fails
		// is a refusal of it.
		let landed: number | null = null
		try {
			const sessionId = await scoped(
				socket,
				reply.emitToUser,
				"state:set",
				params?.sessionId
			)
			const target = owner(reply.emitToUser, "state:set", params?.owner)
			await guarded(reply.emitToUser, "state:set", async () => {
				// Only what this session's genre enables (ruled 2026-09-25).
				await assertTracked(db, sessionId, params.slotId)
				// Only a value the writer hears (A28): a guest never changes a whisper they cannot read.
				const unheard = await unheardWrite(socket, sessionId, target, params.slotId)
				if (unheard) throw new StateRefusal(unheard)
				// 🚧 Who may change it (D4): the ruleset's `changedBy` for its own attributes.
				const notYours = await changedByRefusal(socket, sessionId, params.slotId)
				if (notYours) throw new StateRefusal(notYours)
				// A lore reference names an entry of this session's lorebook (3a).
				await assertLoreRefsInSession(db, sessionId, { value: params.value, slotId: params.slotId })
				return setValue(
					db,
					// The caller, so a `card` owner is checked as theirs.
					{ sessionId, updatedBy: "user", userId: socket.user!.id },
					{
						owner: target,
						slotId: params.slotId,
						value: params.value
					}
				)
			})
			landed = sessionId
			// 🚧 The line the write asked the table to hear (Give to…,
			// 2026-10-18) — after the write, never instead of it; a failure to
			// say it is logged, the write stands.
			if (typeof params?.say === "string" && params.say.trim()) {
				try {
					const { sayOnTable } = await import("$lib/server/sessions/tableLine")
					await sayOnTable(db, socket.io, sessionId, params.say)
				} catch (e) {
					console.warn("state:set: the table line could not be written:", e)
				}
			}
			return await settled(socket, reply.emitToUser, "state:set", sessionId)
		} catch (e) {
			// The write landed and its writer was told so; what failed after
			// the reply (telling the session's other tabs) is not a refusal
			// of it. Logged, and NOT rethrown: `register()` answers a throw
			// with its own id-less refusal to the writer's tab, which a store
			// reads as a failure of its own — for a write that landed.
			if (reply.replied) {
				console.error("state:set: failed after the write was answered:", e)
				return reply.replied.data
			}
			// The write landed, but re-reading the state for the reply failed.
			// Still not a refusal: the writer is answered without the state it
			// could not read, and the session is told something moved, so
			// every tab reads it afresh.
			if (landed !== null) {
				console.error("state:set: the write landed; re-reading it failed:", e)
				const res: Sockets.State.Set.Response = { sessionId: landed }
				reply.emitToUser("state:set", res)
				await broadcastToSessionUsers(socket.io, landed, "state:changed", {
					sessionId: landed
				} satisfies Sockets.State.Changed.Response).catch((err) =>
					console.error("state:set: telling the session failed too:", err)
				)
				return res
			}
			// A failure nobody put into words (a database error) still answers
			// the writer by its id — `register()`'s generic refusal would carry
			// none, and the write would wait out its timeout. Its sentence, and
			// said once: `register()` sees this emit and stays quiet.
			if (!reply.refused)
				reply.emitToUser("state:set:error", {
					error: "An error occurred while processing your request."
				})
			throw e
		}
	}
}

export const stateConfigure: Handler<
	Sockets.State.Configure.Params,
	Sockets.State.Configure.Response
> = {
	event: "state:configure",
	handler: async (socket, params, emitToUser) => {
		const sessionId = await scoped(
			socket,
			emitToUser,
			"state:configure",
			params?.sessionId
		)
		const target = owner(emitToUser, "state:configure", params?.owner)
		// Only a slot the writer hears on that owner (A28), as `state:set`.
		const unheard = await unheardWrite(socket, sessionId, target, params?.slotId)
		if (unheard) refuse(emitToUser, "state:configure", unheard)
		await guarded(emitToUser, "state:configure", () =>
			configure(
				db,
				{ sessionId, updatedBy: "user", userId: socket.user!.id },
				{
					owner: target,
					slotId: params.slotId,
					config: params.config ?? {}
				}
			)
		)
		return await settled(socket, emitToUser, "state:configure", sessionId)
	}
}

export const stateProposals: Handler<
	Sockets.State.Proposals.Params,
	Sockets.State.Proposals.Response
> = {
	event: "state:proposals",
	handler: async (socket, params, emitToUser) => {
		const sessionId = await scoped(
			socket,
			emitToUser,
			"state:proposals",
			params?.sessionId
		)
		const links = await sessionLinks(db, sessionId)
		const res = {
			sessionId,
			proposals: await proposalRows(sessionId, await callerHearing(socket, sessionId, links), links)
		}
		emitToUser("state:proposals", res)
		return res
	}
}

export const stateDecide: Handler<
	Sockets.State.Decide.Params,
	Sockets.State.Decide.Response
> = {
	event: "state:decide",
	handler: async (socket, params, emitToUser) => {
		// Scoped through the proposal's own session rather than a supplied one:
		// a proposal id is the whole of what the client knows, and asking it to
		// also name the session would be asking it to name the fact this check
		// is testing.
		const [row] = await db
			.select({
				sessionId: schema.stateProposals.sessionId,
				payload: schema.stateProposals.payload
			})
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.id, Number(params?.proposalId)))
		if (!row) refuse(emitToUser, "state:decide", "Proposal not found.")
		const sessionId = await scoped(
			socket,
			emitToUser,
			"state:decide",
			row!.sessionId
		)
		// A pending change `state:proposals` does not list for the caller is
		// not theirs to accept or reject (A28) — and is answered as one that
		// does not exist, so guessing ids learns nothing.
		const judging = await sessionLinks(db, sessionId)
		if (!proposalHeard(await callerHearing(socket, sessionId, judging), earshotSlots(), row!.payload, judging))
			refuse(emitToUser, "state:decide", "Proposal not found.")

		const outcome = await guarded(emitToUser, "state:decide", () =>
			// Judged as the person deciding: a guest's Accept is a guest's write.
			decideProposal(db, Number(params.proposalId), !!params.accept, socket.user!.id)
		)
		// `superseded` (U5f) is an accept that applied nothing: the slot
		// moved since the proposal's base. `movedSlots` names it, and the
		// row comes back in `proposals` collapsed for the list to draw.
		const links = await sessionLinks(db, sessionId)
		const hearing = await callerHearing(socket, sessionId, links)
		const res: Sockets.State.Decide.Response = {
			sessionId,
			proposalId: Number(params.proposalId),
			status: outcome.status,
			...(outcome.movedSlots ? { movedSlots: outcome.movedSlots } : {}),
			proposals: await proposalRows(sessionId, hearing, links),
			state: await withPiecesRead(db, stateAsHeard(await stateFor(db, sessionId), hearing))
		}
		emitToUser("state:decide", res)
		await broadcastToSessionUsers(socket.io, sessionId, "state:changed", {
			sessionId
		} satisfies Sockets.State.Changed.Response)
		if (outcome.clock) await announceClockAccepted(socket, sessionId, socket.user!.id, outcome.clock)
		// 🚧 An offer answered (Give to…, ★4): the table hears how it went.
		if (outcome.line) await sayTableLine(socket, sessionId, outcome.line)
		return res
	}
}

/** 🚧 One line on the session's table channel, after a write that landed; a failure is logged, never a refusal. */
async function sayTableLine(socket: any, sessionId: number, line: string): Promise<void> {
	try {
		const { sayOnTable } = await import("$lib/server/sessions/tableLine")
		await sayOnTable(db, socket.io, sessionId, line)
	} catch (e) {
		console.warn("[state] the table line could not be written:", e)
	}
}

/**
 * 🚧 `state:givePiece` — _Give to…_ (PLAN-dc-after-walk2 Q0-4, owner ruling ★4):
 * the `give-piece` widget request's door. ONE decision on the host
 * (`state/give.ts`): given at once where the caller may write both sheets,
 * offered to a player's seat where they may not, refused in words
 * otherwise. Reply and refusal carry the ask's `request` token; what landed
 * — a give or an offer — tells every member `state:changed`, and the table
 * hears it.
 */
export const stateGivePiece: Handler<Sockets.State.GivePiece.Params, Sockets.State.GivePiece.Response> = {
	event: "state:givePiece",
	handler: async (socket, params, emitToUser) => {
		const token = typeof params?.request === "string" ? { request: params.request } : {}
		const sessionId = params?.sessionId
		const refuseGive = (error: string) => {
			const res = { ...(typeof sessionId === "number" ? { sessionId } : {}), ...token, error }
			emitToUser("state:givePiece:error", res)
			return res
		}
		try {
			if (typeof sessionId !== "number" || !Number.isInteger(sessionId))
				return refuseGive("Which session? None was named.")
			const access = await checkSessionAccess(sessionId, socket.user!.id)
			if (!access.hasAccess) return refuseGive("Session not found.")
			const ownerOf = (raw: unknown): StateOwner | null => {
				const o = raw as { kind?: unknown; id?: unknown } | undefined
				return o && isOwnerKind(o.kind) && typeof o.id === "number" && Number.isInteger(o.id)
					? { kind: o.kind as StateOwner["kind"], id: o.id }
					: null
			}
			const from = ownerOf(params.from)
			const to = ownerOf(params.to)
			if (!from || !to) return refuseGive("Who gives it, and to whom? Both are named.")
			if (typeof params.slotId !== "string" || !params.slotId) return refuseGive("Which list? None was named.")
			if (typeof params.index !== "number" || !Number.isInteger(params.index) || params.index < 0)
				return refuseGive("Which thing? None was named.")
			const { givePiece } = await import("$lib/server/state/give")
			const given = await givePiece(db, {
				sessionId,
				userId: socket.user!.id,
				from,
				to,
				slotId: params.slotId,
				index: params.index,
				...(typeof params.count === "number" ? { count: params.count } : {})
			})
			const res = { sessionId, ...token, given: given.given }
			emitToUser("state:givePiece", res)
			await sayTableLine(socket, sessionId, given.line)
			try {
				await broadcastToSessionUsers(socket.io, sessionId, "state:changed", {
					sessionId
				} satisfies Sockets.State.Changed.Response)
			} catch (e) {
				console.warn("[state] give: telling the session failed:", e)
			}
			return res
		} catch (e) {
			if (e instanceof StateRefusal) return refuseGive(e.message)
			console.warn("[state] give failed:", e)
			return refuseGive("That could not be given.")
		}
	}
}

/**
 * 🚧 `state:showTieSide` — a tie side shown to others, or hidden again
 * (ties on the graph, screen 2's switch; `set-tie-shown`): its holder's, or
 * the session owner's. Refused in words; the session hears the change.
 */
export const stateShowTieSide: Handler<Sockets.State.ShowTieSide.Params, Sockets.State.ShowTieSide.Response> = {
	event: "state:showTieSide",
	handler: async (socket, params, emitToUser) => {
		const token = typeof params?.request === "string" ? { request: params.request } : {}
		const sessionId = params?.sessionId
		const refuse = (error: string) => {
			const res = { ...(typeof sessionId === "number" ? { sessionId } : {}), ...token, error }
			emitToUser("state:showTieSide:error", res)
			return res
		}
		try {
			if (typeof sessionId !== "number" || !Number.isInteger(sessionId)) return refuse("Which session? None was named.")
			const userId = socket.user!.id
			const access = await checkSessionAccess(sessionId, userId)
			if (!access.hasAccess) return refuse("Session not found.")
			const o = params.owner as { kind?: unknown; id?: unknown } | undefined
			if (!o || (o.kind !== "session_cast" && o.kind !== "player_seat") || typeof o.id !== "number" || !Number.isInteger(o.id))
				return refuse("Whose side? None was named.")
			if (typeof params.entryType !== "string" || !params.entryType || typeof params.towards !== "string" || !params.towards)
				return refuse("Which tie? None was named.")
			// The holder's to show, or the game master's.
			const [session] = await db.select({ userId: schema.sessions.userId }).from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1)
			const { seatIds, cardIds } = await ownSeatsOf(sessionId, userId)
			const mine = o.kind === "session_cast" ? cardIds.has(o.id) : seatIds.has(o.id)
			if (session?.userId !== userId && !mine) return refuse("Only its holder can show that side.")
			const { setTieSideShown } = await import("$lib/server/rulesets/ties")
			const done = await setTieSideShown(db, {
				sessionId,
				owner: { kind: o.kind, id: o.id },
				entryType: params.entryType,
				towards: params.towards,
				shown: params.shown === true,
				updatedBy: `user:${userId}`
			})
			const res = { sessionId, ...token, shown: done.shown }
			emitToUser("state:showTieSide", res)
			try {
				await broadcastToSessionUsers(socket.io, sessionId, "state:changed", { sessionId } satisfies Sockets.State.Changed.Response)
			} catch (e) {
				console.warn("[state] showing a tie side: telling the session failed:", e)
			}
			return res
		} catch (e) {
			return refuse(e instanceof Error && e.message ? e.message : "That side could not be shown.")
		}
	}
}

/**
 * 🚧 An accepted **clock proposal** moved the session's story clock (live
 * scenes ★3): said the way *Advance story clock* says a move — the session's
 * row to every tab, and `session-updated` naming the clock, under the
 * person's `edit` cause, which never fires a turn — and noted as a **time
 * action** for the boundary watcher, since a person pressed Accept (live
 * scenes §4). Best-effort: the clock moved either way. `state:changed` has
 * already gone out with the decision.
 */
async function announceClockAccepted(
	socket: any,
	sessionId: number,
	userId: number,
	move: { from?: unknown; to?: unknown } = {}
) {
	try {
		const { broadcastSessionRow } = await import("$lib/server/sessions/rowPush")
		broadcastSessionRow(socket.io, sessionId)
		const { noteTimeAction } = await import("$lib/server/scenes/boundaryWatcher")
		// The keeper's move, accepted (live scenes §15 G4).
		await noteTimeAction(db, { sessionId, cause: "keeper" })
		const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
		const { sessionEvents } = await import("@serene-pub/sdk")
		await emitSessionEvent(db, {
			sessionId,
			userId,
			event: sessionEvents.sessionUpdated,
			payload: { sessionId, changed: ["storyClock"], cause: { kind: "edit", userId } },
			io: socket.io
		})
		// 🚧 The session moment (PLAN-layering D7, lane 6): once per move.
		const { noteStoryClockMoved } = await import("$lib/server/pipelines/routines/moments")
		await noteStoryClockMoved(db, {
			sessionId,
			userId,
			cause: { kind: "edit", userId },
			from: move.from,
			to: move.to,
			io: socket.io
		})
	} catch (err) {
		console.warn("[state] an accepted clock move was not announced:", err)
	}
}

// ── What a session tracks (ruled 2026-09-25) ────────────────────────────────

/**
 * 🚧 What this session's rules bring (RF fix 8, owner ruling 2026-10-23):
 * attributes are the rules' alone — a genre brings none and a session adds
 * none — so Session settings › Attributes is who carries each of their
 * optional attributes, or the sentence that the rules declare none.
 */
async function attributesFor(sessionId: number, userId: number): Promise<Sockets.State.Attributes.Response> {
	const [session] = await db
		.select({
			userId: schema.sessions.userId,
			primaryRuleset: schema.sessions.primaryRuleset,
			rulesetSettings: schema.sessions.rulesetSettings
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	const plays = sessionRulesets(session)
	const links = await sessionLinks(db, sessionId)
	const declared = carryableAttributes(plays)
	// Optional ones only: one the rules require is no one's to switch; the host's place is never an attribute.
	const carries = (await carriesOnWire(sessionId, userId, plays, links, session?.userId === userId)).filter((row) => !row.required && !isHostStateSlot(row.slotId))
	return {
		sessionId,
		declaresAttributes: declared.size > 0,
		canEdit: session?.userId === userId,
		rulesets: plays,
		...(carries.length ? { carries } : {})
	}
}

/**
 * 🚧 Who carries each of the rules' attributes (attribute carries, RF fix
 * 2 item 3): every holder its `carriedBy` names — the world, each character
 * and player seat, each place — with their switch, and whether the caller
 * may change it (whoever plays the holder; the session's owner, anyone).
 */
async function carriesOnWire(
	sessionId: number,
	userId: number,
	plays: readonly string[],
	links: Awaited<ReturnType<typeof sessionLinks>>,
	sessionOwner: boolean
): Promise<Sockets.State.Attributes.CarryRow[]> {
	const attributes = [...carryableAttributes(plays).values()]
	if (!attributes.length) return []
	const rows = await carryRowsOf(db, sessionId)
	const hearing = sessionOwner ? null : await hearingOf(db, sessionId, userId, links.cast, links.playerSeats)
	type Holder = Sockets.State.Attributes.CarryHolder
	const mayChange = (owner: Holder["owner"]) =>
		sessionOwner || (!!hearing && (owner.kind === "session_cast" || owner.kind === "player_seat") && hears(hearing, carryKeyOf(owner)))
	const holder = (owner: Holder["owner"], name: string, slotId: string): Holder => ({
		owner,
		name,
		carries: rows.get(carryKeyOf(owner))?.get(slotId) !== false,
		mayChange: mayChange(owner)
	})
	return attributes.map((a) => {
		const holders: Holder[] = []
		if (a.carriedBy.includes("world")) holders.push(holder({ kind: "session", id: sessionId }, "The world", a.slotId))
		if (a.carriedBy.includes("cast")) {
			for (const m of links.cast) holders.push(holder({ kind: "session_cast", id: m.characterId }, m.name, a.slotId))
			for (const seat of links.playerSeats ?? []) holders.push(holder({ kind: "player_seat", id: seat.playerSeatId }, seat.name, a.slotId))
		}
		if (a.carriedBy.includes("location"))
			for (const place of links.locations) holders.push(holder({ kind: "session_location", id: place.entryId }, place.name, a.slotId))
		return {
			slotId: a.slotId,
			label: a.label,
			required: a.required,
			holders: a.required ? holders.map((h) => ({ ...h, carries: true, mayChange: false })) : holders
		}
	})
}

export const stateAttributes: Handler<
	Sockets.State.Attributes.Params,
	Sockets.State.Attributes.Response
> = {
	event: "state:attributes",
	handler: async (socket, params, emitToUser) => {
		const sessionId = await scoped(socket, emitToUser, "state:attributes", params?.sessionId)
		const res = await attributesFor(sessionId, socket.user!.id)
		emitToUser("state:attributes", res)
		return res
	}
}

/**
 * ⏳ Retired (RF fix 8, owner ruling 2026-10-23): a session adds no
 * attributes and drops none — they are its rules'. Refused in words, always;
 * a holder opts out of an optional one with `state:setCarry`.
 */
export const stateSetAttributePicks: Handler<
	Sockets.State.SetAttributePicks.Params,
	Sockets.State.SetAttributePicks.Response
> = {
	event: "state:setAttributePicks",
	handler: async (socket, params, emitToUser) => {
		const event = "state:setAttributePicks"
		const sessionId = await scoped(socket, emitToUser, event, params?.sessionId)
		return refuse(emitToUser, event, "This session's attributes are its rules' own: a session adds none. Whoever carries one the rules leave optional can switch it off for themselves.", { sessionId })
	}
}

export const stateSetCarry: Handler<Sockets.State.SetCarry.Params, Sockets.State.SetCarry.Response> = {
	event: "state:setCarry",
	handler: async (socket, params, emitToUser) => {
		const event = "state:setCarry"
		// 🚧 RF fix 8: the sheet's `set-attribute-carry` names its ask; its reply and refusal carry it back.
		const request = typeof params?.request === "string" && params.request ? params.request : undefined
		const sessionId = await scoped(socket, emitToUser, event, params?.sessionId)
		const about = { sessionId, ...(request ? { request } : {}) }
		const target = owner(emitToUser, event, params?.owner)
		if (typeof params?.slotId !== "string" || typeof params?.carries !== "boolean")
			refuse(emitToUser, event, "Say which attribute, and whether it is carried.", about)
		const [session] = await db
			.select({ userId: schema.sessions.userId, primaryRuleset: schema.sessions.primaryRuleset, rulesetSettings: schema.sessions.rulesetSettings })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
		const plays = sessionRulesets(session)
		const rows = await carriesOnWire(sessionId, socket.user!.id, plays, await sessionLinks(db, sessionId), session?.userId === socket.user!.id)
		const row = rows.find((r) => r.slotId === params.slotId)
		const holder = row?.holders.find((h) => h.owner.kind === target.kind && h.owner.id === target.id)
		if (!row || !holder) refuse(emitToUser, event, "That is not an attribute these rules give them to carry.", about)
		if (row!.required) refuse(emitToUser, event, `Everyone carries ${row!.label}: the rules require it.`, about)
		if (!holder!.mayChange)
			refuse(
				emitToUser,
				event,
				target.kind === "session_cast" || target.kind === "player_seat"
					? `Only whoever plays ${holder!.name}, or the session's owner, can change what ${holder!.name} carries.`
					: "Only the session's owner can change what the world and its places carry.",
				about
			)
		const done = await setAttributeCarry(db, {
			sessionId,
			owner: target,
			slotId: params.slotId,
			carries: params.carries,
			plays,
			by: `user:${socket.user!.id}`
		})
		if ("refused" in done) refuse(emitToUser, event, done.refused, about)
		const res = { ...(await attributesFor(sessionId, socket.user!.id)), ...(request ? { request } : {}) }
		emitToUser(event, res)
		// What a holder carries moved: every tab reads its state afresh.
		await broadcastToSessionUsers(socket.io, sessionId, "state:changed", {
			sessionId
		} satisfies Sockets.State.Changed.Response)
		return res
	}
}

/**
 * 🚧 `sessions:setRulesetSettings` — a session's _Rules options_ (W3-A,
 * PLAN-rulesets §8). With `sessionId` alone it reads them (any member);
 * with `values` and/or `preset` the owner changes them: checked against the
 * ruleset's declared settings (`rulesets/settings.ts`), stored on the
 * session for its ruleset, and the session pushed to every member.
 */
export const sessionsSetRulesetSettings: Handler<
	Sockets.Sessions.SetRulesetSettings.Params,
	Sockets.Sessions.SetRulesetSettings.Response
> = {
	event: "sessions:setRulesetSettings",
	handler: async (socket, params, emitToUser) => {
		const event = "sessions:setRulesetSettings"
		const sessionId = await scoped(socket, emitToUser, event, params?.sessionId)
		const access = await checkSessionAccess(sessionId, socket.user!.id)
		const { rulesOptionsFor, sessionRulesetSettingsOf, setSessionRulesetSettings, RulesetSettingsRefusal } = await import(
			"$lib/server/rulesets/settings"
		)
		const changes = params?.values !== undefined || params?.preset !== undefined
		if (!changes) {
			const found = await sessionRulesetSettingsOf(db, sessionId)
			if (!found) refuse(emitToUser, event, "Session not found.", { sessionId })
			const rulesetId = typeof params?.rulesetId === "string" && params.rulesetId ? params.rulesetId : found.primaryRuleset
			const res = { sessionId, canEdit: access.isOwner, rulesOptions: rulesOptionsFor(rulesetId, found.stored[rulesetId] ?? {}) }
			emitToUser(event, res)
			return res
		}
		if (!access.isOwner)
			refuse(emitToUser, event, "Only the session's owner can change its rules options.", { sessionId })
		let rulesOptions
		try {
			rulesOptions = await setSessionRulesetSettings(db, sessionId, {
				rulesetId: params.rulesetId,
				preset: params.preset,
				values: params.values
			})
		} catch (e) {
			if (e instanceof RulesetSettingsRefusal) refuse(emitToUser, event, e.message, { sessionId })
			throw e
		}
		const res = { sessionId, canEdit: true, rulesOptions }
		emitToUser(event, res)
		// Every member's page reads the session afresh (its row carries the
		// stored values); a later turn plays by them.
		const { pushSessionToParticipants } = await import("./sessions")
		await pushSessionToParticipants(socket.io, sessionId, socket.user!.id)
		// 🚧 And its sheets (2026-10-18): a setting may take a stat off them or
		// put one back (`whenRulesetSetting` — spell points or spell slots).
		await broadcastToSessionUsers(socket.io, sessionId, "state:changed", {
			sessionId
		} satisfies Sockets.State.Changed.Response)
		return res
	}
}

export function registerStateHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, stateGet, emitToUser)
	register(socket, stateLedger, emitToUser)
	register(socket, stateAttributes, emitToUser)
	register(socket, stateSetAttributePicks, emitToUser)
	register(socket, stateSetCarry, emitToUser)
	register(socket, stateSet, emitToUser)
	register(socket, stateSetOwnerFace, emitToUser)
	register(socket, stateConfigure, emitToUser)
	register(socket, stateProposals, emitToUser)
	register(socket, stateDecide, emitToUser)
	register(socket, stateGivePiece, emitToUser)
	register(socket, stateShowTieSide, emitToUser)
	register(socket, sessionsSetRulesetSettings, emitToUser)
}
