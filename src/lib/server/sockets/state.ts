/**
 * `state:*` — the playing surface's door to stats, states and possessions.
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
	getAttributeSlot,
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
	qualifiedSlotKey,
	sessionLinks,
	slotKey,
	stateFor,
	valueOf,
	type SessionLinks
} from "$lib/server/state/resolve"
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
	movePossession,
	pendingProposals,
	setValue,
	StateRefusal,
	transferPossession
} from "$lib/server/state/write"

/**
 * Emit the specific error and throw, so `register()` stays quiet rather than
 * following with its generic sentence. Same shape `widgetStyles` uses.
 */
function refuse(
	emitToUser: (event: string, data: any) => void,
	event: string,
	message: string
): never {
	emitToUser(`${event}:error`, { error: message })
	throw new Error(message)
}

/** Access, checked once per handler, in the sentence a refusal reads. */
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
	if (!access.hasAccess) refuse(emitToUser, event, "Session not found.")
	return id
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

const proposalRows = async (
	sessionId: number
): Promise<Sockets.State.ProposalRow[]> =>
	(await pendingProposals(db, sessionId)).map(toProposalRow)

const toProposalRow = (row: any): Sockets.State.ProposalRow => ({
	id: row.id,
	sessionId: row.sessionId,
	messageId: row.messageId ?? null,
	kind: row.kind,
	payload: row.payload ?? {},
	status: row.status,
	proposedBy: row.proposedBy ?? "",
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
 */
const describeSlot = (
	decl: AttributeSlotDecl
): Sockets.State.SlotDescriptor => ({
	slotId: decl.id,
	key: slotKey(decl.id),
	qualifiedKey: qualifiedSlotKey(decl.id),
	label: i18nTextIn(decl.label) ?? slotKey(decl.id),
	description: i18nTextIn(decl.description),
	type: decl.type,
	appliesTo: [...decl.appliesTo]
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
	owner: { kind: "session" | "session_cast"; id: number },
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
 * The slots this install declares and the owners this session's values belong
 * to, each with the configuration in force for it.
 *
 * Sent with every read rather than fetched once and cached client-side: a
 * genre, a plugin or an admin can change what is declared, and a cached
 * vocabulary is how a bar keeps drawing a ceiling that moved.
 */
async function describeState(
	sessionId: number,
	links: SessionLinks
): Promise<{
	slots: Sockets.State.SlotDescriptor[]
	owners: Sockets.State.StateOwnerRow[]
}> {
	const declared = declaredSlots()
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
		}))
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

	return { slots: declared.map(describeSlot), owners }
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
	const possessions = await db
		.select({
			id: schema.sessionPossessions.id,
			ownerKind: schema.sessionPossessions.ownerKind,
			ownerId: schema.sessionPossessions.ownerId,
			entryId: schema.sessionPossessions.entryId,
			quantity: schema.sessionPossessions.quantity,
			validFromMessageId: schema.sessionPossessions.validFromMessageId,
			updatedBy: schema.sessionPossessions.updatedBy,
			createdAt: schema.sessionPossessions.createdAt,
			itemName: schema.lorebookEntries.title
		})
		.from(schema.sessionPossessions)
		.leftJoin(
			schema.lorebookEntries,
			eq(schema.lorebookEntries.id, schema.sessionPossessions.entryId)
		)
		.where(eq(schema.sessionPossessions.sessionId, sessionId))

	const named = (ownerKind: string, ownerId: number) =>
		ownerKind === "session"
			? { key: "world", label: worldLabel }
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
		}),
		...possessions.map((row) => {
			const who = named(row.ownerKind, row.ownerId)
			return {
				id: row.id,
				kind: "possession" as const,
				messageId: row.validFromMessageId,
				ownerKey: who.key,
				ownerLabel: who.label,
				updatedBy: row.updatedBy,
				createdAt: new Date(row.createdAt).toISOString(),
				entryId: row.entryId,
				itemName: row.itemName ?? "",
				quantity: row.quantity
			}
		})
	]
		.map((row) => ({ row, at: new Date(row.createdAt).getTime() }))
		.sort((a, b) =>
			byAnchor({ ...a.row, at: a.at }, { ...b.row, at: b.at })
		)
		.map((r) => r.row)

	return { sessionId, rows, baselines: await baselinesFor(rows, links) }
}

/**
 * What each changed slot read before this session touched it — the left-hand
 * side of the run's first line.
 *
 * Which layer answers is a question about rows; WHAT it answers is the
 * resolver's, so the layer is chosen here and the value is still `valueOf`'s.
 * A slot no template layer has is the declaration's own default, which is what
 * every read of it returned.
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

	const out: Sockets.State.LedgerBaseline[] = []
	for (const { ownerKey, slotId } of wanted.values()) {
		const member = memberByKey.get(ownerKey)
		const owner =
			ownerKey === "world"
				? links.lorebookId
					? { kind: "lorebook" as const, id: links.lorebookId }
					: null
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
			? await valueOf(db, {
					sessionId: links.sessionId,
					owner,
					slotId
				})
			: getAttributeSlot(slotId)?.default
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
		const res = {
			sessionId,
			state: await stateFor(db, sessionId),
			...(await describeState(sessionId, links))
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
		const sessionId = await scoped(
			socket,
			emitToUser,
			"state:set",
			params?.sessionId
		)
		const target = owner(emitToUser, "state:set", params?.owner)
		await guarded(emitToUser, "state:set", () =>
			setValue(
				db,
				{ sessionId, updatedBy: "user" },
				{ owner: target, slotId: params.slotId, value: params.value }
			)
		)
		return await settled(socket, emitToUser, "state:set", sessionId)
	}
}

export const stateGive: Handler<
	Sockets.State.Give.Params,
	Sockets.State.Give.Response
> = {
	event: "state:give",
	handler: async (socket, params, emitToUser) => {
		const sessionId = await scoped(
			socket,
			emitToUser,
			"state:give",
			params?.sessionId
		)
		const target = owner(emitToUser, "state:give", params?.owner)
		await guarded(emitToUser, "state:give", () =>
			movePossession(
				db,
				{ sessionId, updatedBy: "user" },
				{
					owner: target,
					entryId: params.entryId,
					delta: Math.max(1, Math.trunc(params.quantity ?? 1))
				}
			)
		)
		return await settled(socket, emitToUser, "state:give", sessionId)
	}
}

export const stateTake: Handler<
	Sockets.State.Take.Params,
	Sockets.State.Take.Response
> = {
	event: "state:take",
	handler: async (socket, params, emitToUser) => {
		const sessionId = await scoped(
			socket,
			emitToUser,
			"state:take",
			params?.sessionId
		)
		const target = owner(emitToUser, "state:take", params?.owner)
		await guarded(emitToUser, "state:take", () =>
			movePossession(
				db,
				{ sessionId, updatedBy: "user" },
				{
					owner: target,
					entryId: params.entryId,
					delta: -Math.max(1, Math.trunc(params.quantity ?? 1))
				}
			)
		)
		return await settled(socket, emitToUser, "state:take", sessionId)
	}
}

export const stateTransfer: Handler<
	Sockets.State.Transfer.Params,
	Sockets.State.Transfer.Response
> = {
	event: "state:transfer",
	handler: async (socket, params, emitToUser) => {
		const sessionId = await scoped(
			socket,
			emitToUser,
			"state:transfer",
			params?.sessionId
		)
		const from = owner(emitToUser, "state:transfer", params?.from)
		const to = owner(emitToUser, "state:transfer", params?.to)
		await guarded(emitToUser, "state:transfer", () =>
			transferPossession(
				db,
				{ sessionId, updatedBy: "user" },
				{
					from,
					to,
					entryId: params.entryId,
					quantity: params.quantity
				}
			)
		)
		return await settled(socket, emitToUser, "state:transfer", sessionId)
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
		const res = {
			sessionId,
			proposalId: Number(params.proposalId),
			status: outcome.status,
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
	register(socket, stateSet, emitToUser)
	register(socket, stateGive, emitToUser)
	register(socket, stateTake, emitToUser)
	register(socket, stateTransfer, emitToUser)
	register(socket, stateConfigure, emitToUser)
	register(socket, stateProposals, emitToUser)
	register(socket, stateDecide, emitToUser)
}
