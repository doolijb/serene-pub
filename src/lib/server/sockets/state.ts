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
 */

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq, inArray } from "drizzle-orm"
import {
	attributeSlots,
	genreAllowsCustomAttributes,
	genreSheets,
	getAttributeSlot,
	getGenre,
	slotPickable,
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
	worldAttributesFor,
	type SessionLinks,
	type TrackedSlot
} from "$lib/server/state/resolve"
import { locationOwnerKey } from "$lib/server/state/keys"
import {
	isOwnerKind,
	ownerFacet,
	resolutionChain,
	type StateOwner
} from "$lib/server/state/owners"
import { i18nTextIn } from "$lib/shared/i18n/i18nText"
import {
	configure,
	decideProposal,
	listedProposals,
	assertLoreRefsInSession,
	assertTracked,
	setValue,
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
	about: { sessionId?: number } = {}
): never {
	emitToUser(`${event}:error`, { error: message, ...about })
	throw new Error(message)
}

/**
 * Access, checked once per handler, in the sentence a refusal reads.
 *
 * The refusal names the session it was asked about: it reaches every tab of
 * the user, and a tab looking at another session must be able to tell it is
 * not about the one it shows. Only the id the caller sent — nothing it did
 * not already know.
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
 * Both go to every tab of the user, in whatever order the async handlers
 * finish, so a store matching replies to writes by order settles the wrong
 * write; the id is what lets it settle the one write it names.
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
 */
const proposalRows = async (
	sessionId: number
): Promise<Sockets.State.ProposalRow[]> =>
	(await listedProposals(db, sessionId)).map(toProposalRow)

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
 * The one place a write ends: re-resolve, answer the caller, and tell everyone
 * else in the session that something moved.
 */
async function settled(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	event: string,
	sessionId: number
) {
	const state = await stateFor(db, sessionId)
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
const describeSlot = (
	decl: AttributeSlotDecl,
	tracked?: Pick<TrackedSlot, "required" | "sheetId">
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
	...(tracked?.sheetId !== undefined ? { sheetId: tracked.sheetId } : {})
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
	owner: { kind: "session" | "session_cast" | "session_location"; id: number },
	links: SessionLinks
): StateOwner[] =>
	resolutionChain(owner, {
		castMemberId:
			links.cast.find((c) => c.characterId === owner.id)?.castMemberId ??
			null,
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
async function describeState(
	sessionId: number,
	links: SessionLinks,
	tracked: readonly TrackedSlot[] = []
): Promise<{
	slots: Sockets.State.SlotDescriptor[]
	owners: Sockets.State.StateOwnerRow[]
}> {
	const trackedById = new Map(tracked.map((t) => [t.id, t]))
	// On the owners the session's sheet put each one on (a premade stat
	// such as `location` may be the world's in one genre, the cast's in
	// another): a card never offers a slot the write would refuse.
	const declared = declaredSlots()
		.filter((decl) => trackedById.has(decl.id))
		.map((decl) => onOwners(decl, trackedById.get(decl.id)?.appliesTo))
	const [session] = await db
		.select({ name: schema.sessions.name })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))

	const owners: Sockets.State.StateOwnerRow[] = [
		{
			key: "world",
			kind: "session",
			id: sessionId,
			label: session?.name ?? "World",
			configs: {}
		},
		...links.cast.map((member) => ({
			key: castKey(member.name),
			kind: "session_cast" as const,
			id: member.characterId,
			label: member.name,
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

	for (const { owner, chain } of chains) {
		const facet = ownerFacet(owner.kind)
		for (const decl of declared) {
			// A slot the owner may not carry is not an empty control on its
			// card: it is not that owner's slot at all.
			if (!slotAppliesTo(decl, facet)) continue
			const deviates = chain.some((layer) =>
				configured.has(`${layer.kind}:${layer.id}:${decl.id}`)
			)
			owner.configs[decl.id] = deviates
				? await configFor(db, {
						sessionId,
						owner: { kind: owner.kind, id: owner.id },
						slotId: decl.id
					})
				: resolveSlotConfig(decl)
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
 */
async function ledgerFor(
	sessionId: number,
	links: SessionLinks
): Promise<Sockets.State.Ledger.Response> {
	const [session] = await db
		.select({ name: schema.sessions.name })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	const worldLabel = session?.name ?? "World"
	const memberOf = new Map(links.cast.map((c) => [c.characterId, c]))

	const values = await db
		.select()
		.from(schema.attributeValues)
		.where(eq(schema.attributeValues.sessionId, sessionId))

	const placeOf = new Map(links.locations.map((l) => [l.entryId, l]))
	const named = (ownerKind: string, ownerId: number) =>
		ownerKind === "session"
			? { key: "world", label: worldLabel }
			: ownerKind === "session_location"
				? {
						key: locationOwnerKey(placeOf.get(ownerId)?.name ?? String(ownerId)),
						label: placeOf.get(ownerId)?.name ?? ""
					}
				: {
						key: castKey(memberOf.get(ownerId)?.name ?? ""),
						label: memberOf.get(ownerId)?.name ?? ""
					}

	const rows: Sockets.State.LedgerRow[] = [
		...values.map((row) => {
			const who = named(row.ownerKind, row.ownerId)
			const decl = getAttributeSlot(row.slotId)
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
				value: (row.value?.v ?? null) as SlotValue
			}
		})
	]
		.map((row) => ({ row, at: new Date(row.createdAt).getTime() }))
		.sort((a, b) =>
			byAnchor({ ...a.row, at: a.at }, { ...b.row, at: b.at })
		)
		.map((r) => r.row)

	const baselines = await baselinesFor(rows, links)
	// A lore reference reads by its title, as `stateFor` names them — the
	// row stores the id (and held count) alone, and a ledger line saying
	// `entry 12` names nothing a person wrote (phase 3a). Read-time only.
	await nameLoreRefs(db, [
		...rows.filter((r) => r.kind === "value"),
		...baselines
	] as unknown as Record<string, unknown>[])
	return { sessionId, rows, baselines }
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
	links: SessionLinks
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
		links.locations.map((l) => [locationOwnerKey(l.name), l] as const)
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
		const res = {
			sessionId,
			state,
			...(await describeState(sessionId, links, state.slots))
		}
		emitToUser("state:get", res)
		return res
	}
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
		const res = await ledgerFor(
			sessionId,
			await sessionLinks(db, sessionId)
		)
		emitToUser("state:ledger", res)
		return res
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
				// A lore reference names an entry of this session's lorebook (3a).
				await assertLoreRefsInSession(db, sessionId, { value: params.value, slotId: params.slotId })
				return setValue(
					db,
					{ sessionId, updatedBy: "user" },
					{
						owner: target,
						slotId: params.slotId,
						value: params.value
					}
				)
			})
			landed = sessionId
			return await settled(socket, reply.emitToUser, "state:set", sessionId)
		} catch (e) {
			// The write landed and its writer was told so; what failed after
			// the reply (telling the session's other tabs) is not a refusal
			// of it. Logged, and NOT rethrown: `register()` answers a throw
			// with its own id-less refusal to every tab of the user, which a
			// store reads as a failure of its own — for a write that landed.
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
		await guarded(emitToUser, "state:configure", () =>
			configure(
				db,
				{ sessionId, updatedBy: "user" },
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
		const res = { sessionId, proposals: await proposalRows(sessionId) }
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
			.select({ sessionId: schema.stateProposals.sessionId })
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.id, Number(params?.proposalId)))
		if (!row) refuse(emitToUser, "state:decide", "Proposal not found.")
		const sessionId = await scoped(
			socket,
			emitToUser,
			"state:decide",
			row!.sessionId
		)

		const outcome = await guarded(emitToUser, "state:decide", () =>
			decideProposal(db, Number(params.proposalId), !!params.accept)
		)
		// `superseded` (U5f) is an accept that applied nothing: the slot
		// moved since the proposal's base. `movedSlots` names it, and the
		// row comes back in `proposals` collapsed for the list to draw.
		const res: Sockets.State.Decide.Response = {
			sessionId,
			proposalId: Number(params.proposalId),
			status: outcome.status,
			...(outcome.movedSlots ? { movedSlots: outcome.movedSlots } : {}),
			proposals: await proposalRows(sessionId),
			state: await stateFor(db, sessionId)
		}
		emitToUser("state:decide", res)
		await broadcastToSessionUsers(socket.io, sessionId, "state:changed", {
			sessionId
		} satisfies Sockets.State.Changed.Response)
		return res
	}
}

// ── What a session tracks (ruled 2026-09-25) ────────────────────────────────

/**
 * 🚧 What this session tracks and where each attribute came from: the genre's
 * baseline, the world's attributes, the session's own, and everything else it
 * could add. `tracked` is the session's vocabulary as every write and read
 * sees it (`vocabularyFor`), so the picker never disagrees with the widgets.
 */
async function attributesFor(sessionId: number, userId: number): Promise<Sockets.State.Attributes.Response> {
	const [session] = await db
		.select({
			genreId: schema.sessions.genreId,
			worldAttributes: schema.sessions.worldAttributes,
			userId: schema.sessions.userId
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	const genreId = session?.genreId ?? ""
	const genre = getGenre(genreId)
	// A genre this process does not hold offers nothing to add (fail closed,
	// like `vocabularyFor`): its vocabulary is unknown, not "everything".
	const customAttributes = genre ? genreAllowsCustomAttributes(genre) : false
	const links = await sessionLinks(db, sessionId)
	const tracked = new Set((await vocabularyFor(db, sessionId, links)).entries.map((e) => e.decl.id))

	const row = (slotId: string, required?: boolean): Sockets.State.Attributes.Row => {
		const decl = getAttributeSlot(slotId)
		return {
			slotId,
			label: (decl && i18nTextIn(decl.label)) ?? slotKey(slotId),
			tracked: tracked.has(slotId),
			...(required ? { required: true } : {})
		}
	}
	const seen = new Set<string>()
	const once = (slotId: string) => !seen.has(slotId) && !!seen.add(slotId)

	const baseline: Sockets.State.Attributes.Row[] = []
	for (const sheet of genreSheets(genreId))
		for (const entry of sheet.slots) if (once(entry.id)) baseline.push(row(entry.id, entry.required))
	for (const decl of genre?.slots ?? []) if (once(decl.id)) baseline.push(row(decl.id))

	// Listed whether or not the session reads them, so the picker can offer
	// them back after they were switched off.
	const world: Sockets.State.Attributes.Row[] = []
	const brought = await worldAttributesFor(db, links, sessionId, customAttributes)
	for (const sheet of brought.sheets)
		for (const entry of sheet.slots) if (once(entry.id)) world.push(row(entry.id))
	for (const slotId of brought.recorded) if (once(slotId)) world.push(row(slotId))

	const own: Sockets.State.Attributes.Row[] = []
	for (const slotId of tracked) if (once(slotId)) own.push(row(slotId))

	// A disabled plugin's slots stay declared — sessions already tracking them
	// keep resolving and writing (owner ruling 2026-09-26) — but a listing
	// never offers them (R67).
	const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
	const off = await disabledPlugins(db)
	const addable = declaredSlots()
		.filter((d) => !d.retired && slotPickable(d) && !off.ownsId(d.id) && once(d.id))
		.map((d) => row(d.id))

	return {
		sessionId,
		customAttributes,
		worldAttributes: session?.worldAttributes !== false,
		canEdit: session?.userId === userId,
		baseline,
		world,
		own,
		addable: customAttributes ? addable : []
	}
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

export const stateSetAttributePicks: Handler<
	Sockets.State.SetAttributePicks.Params,
	Sockets.State.SetAttributePicks.Response
> = {
	event: "state:setAttributePicks",
	handler: async (socket, params, emitToUser) => {
		const event = "state:setAttributePicks"
		const sessionId = await scoped(socket, emitToUser, event, params?.sessionId)
		const access = await checkSessionAccess(sessionId, socket.user!.id)
		if (!access.isOwner)
			refuse(emitToUser, event, "Only the session's owner can change what it tracks.", { sessionId })
		const before = await attributesFor(sessionId, socket.user!.id)
		if (!before.customAttributes)
			refuse(emitToUser, event, "This session's genre tracks only its own attributes.", { sessionId })
		const required = new Set(before.baseline.map((r) => r.slotId))
		for (const pick of params.picks ?? []) {
			const decl = typeof pick?.slotId === "string" ? getAttributeSlot(pick.slotId) : undefined
			if (!decl)
				refuse(emitToUser, event, `'${String(pick?.slotId)}' is not an attribute this install declares.`, { sessionId })
			if (pick.enabled === true && !slotPickable(decl))
				refuse(emitToUser, event, `${i18nTextIn(decl.label) ?? pick.slotId} is kept by Serene Pub itself, not an attribute a session picks.`, { sessionId })
			if (pick.enabled === false && required.has(pick.slotId))
				refuse(emitToUser, event, `${before.baseline.find((r) => r.slotId === pick.slotId)!.label} is part of this genre and cannot be dropped.`, { sessionId })
		}
		await db.transaction(async (tx) => {
			if (typeof params.worldAttributes === "boolean")
				await tx
					.update(schema.sessions)
					.set({ worldAttributes: params.worldAttributes })
					.where(eq(schema.sessions.id, sessionId))
			for (const pick of params.picks ?? []) {
				const same = and(
					eq(schema.sessionAttributePicks.sessionId, sessionId),
					eq(schema.sessionAttributePicks.slotId, pick.slotId)
				)
				if (pick.enabled === null) await tx.delete(schema.sessionAttributePicks).where(same)
				else
					await tx
						.insert(schema.sessionAttributePicks)
						.values({ sessionId, slotId: pick.slotId, enabled: pick.enabled })
						.onConflictDoUpdate({
							target: [schema.sessionAttributePicks.sessionId, schema.sessionAttributePicks.slotId],
							set: { enabled: pick.enabled, createdAt: new Date() }
						})
			}
		})
		const res = await attributesFor(sessionId, socket.user!.id)
		emitToUser(event, res)
		// What the session tracks moved: every tab reads its state afresh.
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
	register(socket, stateSet, emitToUser)
	register(socket, stateConfigure, emitToUser)
	register(socket, stateProposals, emitToUser)
	register(socket, stateDecide, emitToUser)
}
