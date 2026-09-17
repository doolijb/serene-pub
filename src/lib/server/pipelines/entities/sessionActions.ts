/**
 * A session's actions, per venue and channel, for one viewer (plans/29 R-15
 * *venue* · *audience* · *quick* · *slash name*; 09-B B9, F38; plans/30 U5c,
 * built 2026-09-16).
 *
 * One projection answers "what may this person press, and where": the
 * genre's contributed actions in force on this session (`enabledSessionFunctions`
 * — session row → preset's included set → companion rule), plus core's
 * message verbs the genre offers (`CORE_ACTIONS` through the genre's
 * `messageVerbs`; the floors always), each placed into its venues and
 * filtered by the viewer's standing in the action's **audience**.
 *
 * ## The guarantees this makes (F38)
 *
 * - Every venue is a **primary set** (`quick`) plus an **overflow**, and the
 *   overflow lists every enabled action — nothing is hidden by prominence.
 * - Composer actions are always reachable by `/`: every entry carries its
 *   slash name, and the client's palette lists the composer's and the extra
 *   tab's venues.
 * - A newly installed action lands in the overflow with a **new** mark for a
 *   person who has not met it (`seen_actions`), and the mark clears when they
 *   open the list that shows it (`markActionsSeen`).
 *
 * ## Audience
 *
 * Evaluated against the viewer with the portrayal resolver's own rules
 * (`resolvePortrayals`): a reference the viewer *is* (a `person` portrayal
 * naming them) grants it. `item` — the per-message ownership rule — is never
 * resolvable ahead of a message, so an action whose `act` names it is listed
 * `itemGated` and the client asks per message (`canControlMessage`), exactly
 * as the verbs were gated before this unit. An action the viewer may see but
 * not act on is listed with `canAct: false`, so the surface can say why a
 * button is grey rather than making it vanish.
 *
 * ## What this is not
 *
 * Not availability — `enabledSessionFunctions` and `resolveMessageVerbs`
 * decide that, and this reads them. Not permission at the fire: the handlers
 * (`sessions:triggerFunction`, the `sessionMessages:*` verbs) check again,
 * because a list is presentation and a refusal is the law.
 */

import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	CORE_ACTIONS,
	VENUE_KINDS,
	parseChannel,
	parseParticipantRef,
	type Audience,
	type ParticipantRef,
	type Portrayals,
	type VenueKind
} from "@serene-pub/sdk"
import { resolveMessageVerbs } from "$lib/server/messages/verbs"
import { resolvePortrayals } from "$lib/server/pipelines/runtime/portrayals"
import {
	enabledSessionFunctions,
	getSessionGenre,
	STANDARD_GENRE_ID,
	type GenreAction,
	type SessionFunction
} from "$lib/server/pipelines/entities/sessionGenres"
import {
	CORE_ACTION_SPEC,
	actionIdentity
} from "$lib/shared/actions/identity"

export { CORE_ACTION_SPEC }

/** One action as a venue lists it. */
export interface SessionAction {
	key: string
	function: string
	/** The contributing spec's slug, or `core` for a message verb. */
	specSlug: string
	name: string
	description?: string
	icon?: string
	slash: string
	quick: boolean
	audience: Audience
	venue: VenueKind
	/** The channel this listing is for, when the venue named one. */
	channel?: string
	origin: "core" | "companion" | "attachment"
	/** A floor — stop · branch · edit — present in every genre. */
	floor: boolean
	/** The viewer holds a reference in `audience.act`, or the action is item-gated. */
	canAct: boolean
	/** `audience.act` names `item`: the client decides per message. */
	itemGated: boolean
	/** The viewer has not met this action yet (contributed actions only). */
	isNew: boolean
}

export interface VenueActions {
	primary: SessionAction[]
	overflow: SessionAction[]
}

export type SessionActionVenues = Record<VenueKind, VenueActions>

/**
 * The person the list is for. Only who they are: an administrator holds no
 * audience reference of their own (`admin` is a portrayal the resolver
 * answers from the session), so nothing here reads a flag.
 */
export interface ActionViewer {
	userId: number
}

/** `<spec slug>#<action key>` — the identity the *new* marker is kept against. */
export const seenActionKey = (specSlug: string, key: string): string =>
	actionIdentity({ specSlug, key })

const emptyVenues = (): SessionActionVenues =>
	Object.fromEntries(
		VENUE_KINDS.map((k) => [k, { primary: [], overflow: [] }])
	) as unknown as SessionActionVenues

/**
 * Does the viewer hold any of these references, under the resolver's rules?
 *
 * `item` is answered `true` here and reported separately by the caller as
 * `itemGated` — it is not a refusal, it is a question for a message.
 */
export function audienceHolds(
	refs: ReadonlyArray<ParticipantRef>,
	portrayals: Portrayals,
	viewer: ActionViewer
): boolean {
	for (const ref of refs) {
		if (ref === "item") return true
		const p = portrayals[ref]
		if (p?.by === "person" && p.userId === String(viewer.userId)) return true
	}
	return false
}

/**
 * Resolve every reference the given audiences name, once, for one viewer.
 * `runOwnerUserId` is the viewer: the resolver's `participant`, `admin` and
 * `run-owner` rules all read "the person acting", which here is the person
 * looking.
 */
export async function resolveAudiences(
	db: Db,
	sessionId: number,
	viewer: ActionViewer,
	audiences: ReadonlyArray<Audience>
): Promise<Portrayals> {
	const refs = new Set<ParticipantRef>()
	for (const a of audiences) {
		for (const r of a.see) refs.add(r)
		for (const r of a.act) refs.add(r)
	}
	refs.delete("item")
	// A malformed reference in a stored declaration must not take the whole
	// list down: it holds for nobody.
	const wellFormed = [...refs].filter((r) => {
		try {
			parseParticipantRef(r)
			return true
		} catch {
			return false
		}
	})
	if (!wellFormed.length) return {}
	return resolvePortrayals(db, {
		sessionId,
		runOwnerUserId: viewer.userId,
		refs: wellFormed
	})
}

/** The seen set for one viewer, narrowed to the keys asked about. */
async function seenSetFor(
	db: Db,
	userId: number,
	keys: string[]
): Promise<Set<string>> {
	if (!keys.length) return new Set()
	const rows = await db
		.select({ actionKey: schema.seenActions.actionKey })
		.from(schema.seenActions)
		.where(
			and(
				eq(schema.seenActions.userId, userId),
				inArray(schema.seenActions.actionKey, keys)
			)
		)
	return new Set(rows.map((r) => r.actionKey))
}

/** Does a venue declared with `channel` (or none) apply to the channel asked about? */
const venueOnChannel = (
	declared: string | undefined,
	channel: string
): boolean => {
	if (!declared) return true
	// A declaration names a slug (ruling 2026-09-09): every lane of it.
	return parseChannel(declared).slug === parseChannel(channel).slug
}

/**
 * Every action this session offers the viewer, per venue, on one channel.
 *
 * `channel` defaults to `main`. The contributed set is read once and placed
 * into each of its venues; core's verbs come from `CORE_ACTIONS`, filtered by
 * the genre's `messageVerbs` (the floors are not in that map and always
 * pass). Placement is `quick` → primary, else overflow; the *new* mark is the
 * viewer's `seen_actions`.
 *
 * `offered` is the session's function list when the caller has already
 * computed it (`listSessionFunctions`; U5c review S4) — the fire has, for its
 * enablement check — so it is not projected twice; only the enabled entries
 * are listed either way.
 */
export async function listSessionActions(
	db: Db,
	sessionId: number,
	viewer: ActionViewer,
	opts: { channel?: string; offered?: ReadonlyArray<SessionFunction> } = {}
): Promise<SessionActionVenues> {
	const channel = opts.channel ?? "main"
	const venues = emptyVenues()

	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return venues
	const genreId = session.genreId ?? STANDARD_GENRE_ID

	// 1. Availability: the contributed actions in force (session → preset →
	//    companion rule) and the verbs the genre offers.
	const contributed: GenreAction[] = opts.offered
		? opts.offered.filter((f) => f.enabled)
		: await enabledSessionFunctions(db, sessionId, genreId, viewer.userId)
	const genre = await getSessionGenre(db, genreId)
	const verbs = resolveMessageVerbs(genre?.shape)
	const core = CORE_ACTIONS.filter(
		(a) => a.floor || (verbs as Record<string, boolean>)[a.key] !== false
	)

	// 2. Audience, resolved once for every reference any of them names.
	const portrayals = await resolveAudiences(db, sessionId, viewer, [
		...contributed.map((a) => a.audience),
		...core.map((a) => a.audience!)
	])

	// 3. The *new* mark — contributed actions only; core's were always there.
	const seen = await seenSetFor(
		db,
		viewer.userId,
		contributed.map((a) => seenActionKey(a.specSlug, a.key))
	)

	const place = (
		entry: Omit<SessionAction, "venue" | "channel">,
		declared: ReadonlyArray<{ kind: VenueKind; channel?: string }>
	) => {
		for (const v of declared) {
			if (!venueOnChannel(v.channel, channel)) continue
			const listed: SessionAction = {
				...entry,
				venue: v.kind,
				...(v.channel ? { channel: v.channel } : {})
			}
			const bucket = venues[v.kind]
			if (!bucket) continue
			;(entry.quick ? bucket.primary : bucket.overflow).push(listed)
		}
	}

	for (const a of contributed) {
		if (!audienceHolds(a.audience.see, portrayals, viewer)) continue
		const itemGated = a.audience.act.includes("item")
		place(
			{
				key: a.key,
				function: a.function,
				specSlug: a.specSlug,
				name: a.name,
				...(a.description ? { description: a.description } : {}),
				...(a.icon ? { icon: a.icon } : {}),
				slash: a.slash,
				quick: a.quick,
				audience: a.audience,
				origin: a.origin,
				floor: false,
				canAct: audienceHolds(a.audience.act, portrayals, viewer),
				itemGated,
				isNew: !seen.has(seenActionKey(a.specSlug, a.key))
			},
			a.venues
		)
	}

	for (const a of core) {
		const audience = a.audience!
		if (!audienceHolds(audience.see, portrayals, viewer)) continue
		place(
			{
				key: a.key,
				function: a.function,
				specSlug: CORE_ACTION_SPEC,
				name: en(a.label) || a.key,
				...(a.icon ? { icon: a.icon } : {}),
				slash: a.slash ?? a.key,
				quick: a.quick === true,
				audience,
				origin: "core",
				floor: a.floor,
				canAct: audienceHolds(audience.act, portrayals, viewer),
				itemGated: audience.act.includes("item"),
				isNew: false
			},
			a.venue
		)
	}

	return venues
}

const en = (v: unknown): string =>
	typeof v === "string" ? v : ((v as any)?.en ?? "")

/**
 * Record that a person has met these actions. Idempotent — a key already
 * seen is left as it was — and keys that name nothing are stored anyway: the
 * set is "what this person has seen", and a spec installed later under a key
 * they once saw is, honestly, not new to them.
 */
export async function markActionsSeen(
	db: Db,
	userId: number,
	keys: ReadonlyArray<string>
): Promise<number> {
	const distinct = [...new Set(keys.filter((k) => typeof k === "string" && k))]
	if (!distinct.length) return 0
	const rows = await db
		.insert(schema.seenActions)
		.values(distinct.map((actionKey) => ({ userId, actionKey })))
		.onConflictDoNothing()
		.returning({ id: schema.seenActions.id })
	return rows.length
}

/** What one declaration's audience says about one viewer. */
export interface AudienceVerdict {
	/** The viewer holds a reference in `see`. */
	canSee: boolean
	/**
	 * The viewer holds a reference in `act` **other than `item`** — the
	 * half a fire can settle without a message. Unlike the listing's
	 * `canAct`, `item` answers nothing here: it is reported as `itemGated`
	 * and the caller decides it against the message the fire names.
	 */
	canAct: boolean
	/** `act` names `item`: decided per message, by the caller. */
	itemGated: boolean
}

/**
 * One declaration's audience, evaluated for one viewer with the resolver's
 * rules and nothing else — no venue, no channel (U5c review, W1/W2). The
 * fire reads this for the action that was pressed; `listSessionActions`
 * computes the same bits per listing, through the same `audienceHolds`,
 * so a grey chip and a refusal at the door can never disagree.
 *
 * A **mixed** audience — `act: ['owner', 'item']` — admits either way
 * (U5c review, S-A): a reference the viewer holds, OR the item rule
 * satisfied on the message. Reading `itemGated` as "only the message
 * decides" refused the owner of a session for pressing a composer action
 * that also named `item`, which is the union the declaration wrote.
 */
export async function audienceVerdict(
	db: Db,
	sessionId: number,
	viewer: ActionViewer,
	audience: Audience
): Promise<AudienceVerdict> {
	const portrayals = await resolveAudiences(db, sessionId, viewer, [audience])
	return {
		canSee: audienceHolds(audience.see, portrayals, viewer),
		canAct: audienceHolds(
			audience.act.filter((r) => r !== "item"),
			portrayals,
			viewer
		),
		itemGated: audience.act.includes("item")
	}
}
