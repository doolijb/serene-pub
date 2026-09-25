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
 * ## Enablement (U5e, 2026-09-17)
 *
 * The second verdict, beside the audience: is the action offered **now**?
 * Each action's **enabled-when** — the session's binding override for the
 * function, else the declaration's own, else the genre's default for the
 * function (`effectiveEnabledWhen`) — is evaluated over the session's
 * **published values** (`publishedValues.ts`), built once per listing. The
 * `item.*` predicates need a message and are handed to the client as
 * `itemPredicates`, evaluated per row with the SDK's `evaluateEnabledWhen`;
 * `enabled` and `reason` answer for the rest. The door (`fireAction`, the
 * verb handlers through `verbRefusal`) evaluates the whole set with the same
 * `enablementOf`, so a grey button and a refusal can never disagree — the
 * pattern `audienceVerdict` set with `audienceHolds`.
 *
 * ## What this is not
 *
 * Not availability — `enabledSessionFunctions` and `resolveMessageVerbs`
 * decide that, and this reads them. Not permission at the fire: the handlers
 * (`sessions:triggerFunction`, the `sessionMessages:*` verbs) check again,
 * because a list is presentation and a refusal is the law.
 */

import { and, eq, inArray, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	CORE_ACTIONS,
	LISTED_VENUE_KINDS,
	audienceHolds,
	genreEnabledWhen,
	i18nText,
	localeMapOf,
	normalizeEnabledWhen,
	parseChannel,
	parseParticipantRef,
	partitionEnabledWhen,
	renderStatusText,
	sentenceText,
	// The SDK's verdicts (01 §13), aliased because this file's
	// `audienceVerdict` and `enablementVerdict` are the app's DOORS — they
	// resolve what only the host holds, then call the judge and quote it.
	audienceVerdict as judgeAudience,
	enablementVerdict as judgeEnablement,
	type Audience,
	type EnabledWhen,
	type I18n,
	type ListedVenueKind,
	type ParticipantRef,
	type Portrayals,
	type StatusText,
	type VenueKind
} from "@serene-pub/sdk"
import {
	itemValuesFor,
	publishedValues,
	type PublishedValues
} from "$lib/server/pipelines/entities/publishedValues"
import type { RunLineage } from "$lib/server/pipelines/runtime/lineage"
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
	/** With `specSlug`, the action's identity `<spec slug>#<key>` — the one key (plans/31 V2). */
	key: string
	/** The contributing spec's slug, or `core` for a message verb. */
	specSlug: string
	name: string
	description?: string
	icon?: string
	slash: string
	quick: boolean
	audience: Audience
	venue: ListedVenueKind
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
	/**
	 * Every enabled-when predicate the listing could evaluate holds (U5e).
	 * The `item.*` ones are not among them — see `itemPredicates`. A second
	 * verdict beside `canAct`: both are shown, neither hides the action.
	 */
	enabled: boolean
	/** Why it is grey when `enabled` is false: the failing predicate's reason, resolved by the client. */
	reason?: StatusText
	/**
	 * The `item.*` predicates — over the message the action is pressed on
	 * — which the client evaluates per row with `evaluateEnabledWhen` and
	 * the row's `item` document (`shared/actions/itemValues.ts`). Present
	 * only when there are any.
	 */
	itemPredicates?: EnabledWhen[]
}

export interface VenueActions {
	primary: SessionAction[]
	overflow: SessionAction[]
}

/**
 * Every venue a listing offers — `LISTED_VENUE_KINDS`. The `form` venue is
 * not among them (U5d review, S1): an action carried by a form is pressed
 * from that block alone, so it is in no overflow and no menu; the block's
 * fire still resolves it (`fireAction`).
 */
export type SessionActionVenues = Record<ListedVenueKind, VenueActions>

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
		LISTED_VENUE_KINDS.map((k) => [k, { primary: [], overflow: [] }])
	) as unknown as SessionActionVenues

// `audienceHolds` — does the viewer hold any of these references — is the
// SDK's (plans/31 V4): the judge of `core:verdict/audience`, so the listing's
// `canAct` below and the fire's refusal read one function.

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
	// A disabled plugin's actions are neither listed nor fired (R67): its
	// handlers are not loaded, so the press would fail mid-run anyway.
	const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
	const off = await disabledPlugins(db)
	const contributed: GenreAction[] = (
		opts.offered
			? opts.offered.filter((f) => f.enabled)
			: await enabledSessionFunctions(db, sessionId, genreId, viewer.userId)
	).filter((a) => !off.ownsId(a.specSlug))
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

	// 4. Enablement (U5e): the published values once, the session's overrides
	//    once, then each action's effective predicate set against them. The
	//    `item.*` half rides to the client.
	const values = await publishedValues(db, sessionId)
	const overrides = await sessionEnabledWhenOverrides(db, sessionId, genreId)
	const enablement = (
		identity: string,
		own: ReadonlyArray<EnabledWhen> | undefined
	): Pick<SessionAction, "enabled" | "reason" | "itemPredicates"> => {
		const verdict = enablementOf(
			effectiveEnabledWhen(
				own,
				genreEnabledWhen(genreId, identity),
				overrides.get(identity)
			),
			values
		)
		return {
			enabled: verdict.enabled,
			...(verdict.reason ? { reason: verdict.reason } : {}),
			...(verdict.itemPredicates.length
				? { itemPredicates: verdict.itemPredicates }
				: {})
		}
	}

	const place = (
		entry: Omit<SessionAction, "venue" | "channel">,
		declared: ReadonlyArray<{ kind: VenueKind; channel?: string }>
	) => {
		for (const v of declared) {
			if (!venueOnChannel(v.channel, channel)) continue
			// A venue no listing offers — `form` (S1) — has no bucket here,
			// and an action declaring only that is listed nowhere.
			const bucket = venues[v.kind as ListedVenueKind]
			if (!bucket) continue
			const listed: SessionAction = {
				...entry,
				venue: v.kind as ListedVenueKind,
				...(v.channel ? { channel: v.channel } : {})
			}
			;(entry.quick ? bucket.primary : bucket.overflow).push(listed)
		}
	}

	for (const a of contributed) {
		if (!audienceHolds(a.audience.see, portrayals, viewer)) continue
		const itemGated = a.audience.act.includes("item")
		place(
			{
				key: a.key,
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
				isNew: !seen.has(seenActionKey(a.specSlug, a.key)),
				...enablement(actionIdentity(a), a.enabledWhen)
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
				isNew: false,
				...enablement(actionIdentity({ specSlug: CORE_ACTION_SPEC, key: a.key }), a.enabledWhen)
			},
			a.venue
		)
	}

	return venues
}

/** Display text in `en` through the SDK's one resolver (R-20); blank for a value publish never let in. */
const en = (v: unknown): string => i18nText(v as I18n | undefined) ?? ""

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

/**
 * What one declaration's audience says about one viewer. `canAct: false`
 * always carries a `refusal` — a door that cannot act has a sentence to
 * refuse with, never a default empty string standing in for one.
 */
export type AudienceVerdict =
	| {
			/** The viewer holds a reference in `see`. */
			canSee: boolean
			/**
			 * The press is the viewer's: they hold a reference in `act`, or `act`
			 * names `item` and the item rule the caller settled on the message
			 * (`item`) admits them. With no `item` given, `item` is deferred as the
			 * listing defers it — see `audienceHolds`.
			 */
			canAct: true
			/** `act` names `item`: decided per message, by the caller. */
			itemGated: boolean
			refusal: null
	  }
	| {
			canSee: boolean
			canAct: false
			itemGated: boolean
			/** The verdict's sentence — what the fire refuses with. */
			refusal: string
	  }

/**
 * One declaration's audience, evaluated for one viewer with the resolver's
 * rules and nothing else — no venue, no channel (U5c review, W1/W2). The
 * fire's door for the action that was pressed (01 §13): the portrayals are
 * resolved here, the item rule's answer is handed in by the caller — who
 * holds the message — and `core:verdict/audience` judges the whole `act`
 * and says the sentence. `listSessionActions` computes the same bits per
 * listing through the same judge (`audienceHolds`), so a grey chip and a
 * refusal at the door can never disagree.
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
	action: { name: string; audience: Audience },
	item?: boolean
): Promise<AudienceVerdict> {
	const { audience } = action
	const portrayals = await resolveAudiences(db, sessionId, viewer, [audience])
	const heard = judgeAudience.judge({
		name: action.name,
		refs: audience.act,
		portrayals,
		viewer,
		item
	})
	const canSee = audienceHolds(audience.see, portrayals, viewer)
	const itemGated = audience.act.includes("item")
	if (heard.ok) return { canSee, canAct: true, itemGated, refusal: null }
	return { canSee, canAct: false, itemGated, refusal: sentenceText(heard) }
}

/* ── Enablement (U5e) ─────────────────────────────────────────────────── */

/**
 * The predicate set in force for one action: the session's override for
 * the function, else the declaration's own, else the genre's default for
 * the function. Precedence ruled with the unit (plans/30 U5e). A layer that
 * is *declared* — even as an empty list — replaces the layers beneath it:
 * an override set to `[]` lifts every predicate, and an action declaring
 * `enabledWhen: []` opts out of its genre's default; only an undeclared
 * layer (`undefined` / `null`) falls through.
 */
export function effectiveEnabledWhen(
	own: ReadonlyArray<EnabledWhen> | undefined | null,
	genreDefault: ReadonlyArray<EnabledWhen>,
	override: ReadonlyArray<EnabledWhen> | null | undefined
): EnabledWhen[] {
	if (override) return normalizeEnabledWhen(override)
	if (own) return normalizeEnabledWhen(own)
	return normalizeEnabledWhen(genreDefault)
}

/**
 * The session-scope overrides, by action identity — the `enabled_when`
 * column of `pipeline_bindings` rows this session holds for its genre
 * (plans/31 V2: the row's `subject` is the identity). Read once per
 * listing; the door reads the one it needs.
 */
export async function sessionEnabledWhenOverrides(
	db: Db,
	sessionId: number,
	genreId: string
): Promise<Map<string, EnabledWhen[]>> {
	const rows = await db
		.select({
			subject: schema.pipelineBindings.subject,
			enabledWhen: schema.pipelineBindings.enabledWhen
		})
		.from(schema.pipelineBindings)
		.where(
			and(
				eq(schema.pipelineBindings.scopeKind, "session"),
				eq(schema.pipelineBindings.scopeId, sessionId),
				eq(schema.pipelineBindings.genreId, genreId),
				isNotNull(schema.pipelineBindings.enabledWhen)
			)
		)
	const out = new Map<string, EnabledWhen[]>()
	for (const r of rows)
		if (r.enabledWhen) out.set(r.subject, normalizeEnabledWhen(r.enabledWhen))
	return out
}

/** What one predicate set says over one published-values document. */
export interface EnablementVerdict {
	/** Every predicate that could be evaluated holds. */
	enabled: boolean
	/** The first failing predicate's reason, when one failed. */
	reason?: StatusText
	/**
	 * The `item.*` predicates left unevaluated because the document carried
	 * no `item` — a listing's. Empty at the door, where the row is at hand.
	 */
	itemPredicates: EnabledWhen[]
}

/**
 * One predicate set over one document — the listing's and the door's one
 * reading (the `audienceHolds` pattern). With no `item` in the document the
 * `item.*` predicates are set aside for the client; with one, every
 * predicate is judged, the first failure naming the reason.
 */
export function enablementOf(
	preds: ReadonlyArray<EnabledWhen>,
	doc: PublishedValues
): EnablementVerdict {
	const { under, rest } = doc.item
		? { under: [] as EnabledWhen[], rest: [...preds] }
		: partitionEnabledWhen(preds, "item")
	// `core:verdict/enablement` judges the half a document can answer; the
	// sentence is the author's reason on the first predicate that fails.
	const heard = judgeEnablement.judge({ preds: rest, doc })
	return {
		enabled: heard.ok,
		...(heard.ok ? {} : { reason: { i18n: localeMapOf(heard.sentence) } }),
		itemPredicates: under
	}
}

/**
 * An app door sentence, not the verdict's: a press that names a message
 * names one of THIS session's, which is a fact about the session and not a
 * predicate over its values. `core:verdict/enablement` never says it.
 */
const NOT_THIS_SESSION = "That message is not part of this session."

/**
 * The door's reading for one action (U5e): the effective predicate set for
 * its identity, over the session's published values with the named
 * message's `item` — the whole set, nothing set aside. `fireAction` asks
 * this after the audience and before routing; the core verb handlers ask
 * it through `verbRefusal`.
 */
export async function enablementVerdict(
	db: Db,
	sessionId: number,
	genreId: string,
	actor: { userId: number },
	/** The action by identity — `specSlug` + `key` — with its own predicates, if it declared any. */
	action: { specSlug: string; key: string; enabledWhen?: ReadonlyArray<EnabledWhen> | null },
	messageId?: number,
	opts: { lineage?: RunLineage } = {}
): Promise<EnablementVerdict> {
	const refusal = (en: string): EnablementVerdict => ({
		enabled: false,
		reason: { i18n: { en } },
		itemPredicates: []
	})
	// A press that names a message names one of THIS session's (review
	// W4): a row of another session is not an item to judge, whatever the
	// predicates say — and a verb with none is still refused here.
	const item =
		messageId != null ? await itemValuesFor(db, sessionId, messageId, actor) : null
	if (messageId != null && !item) return refusal(NOT_THIS_SESSION)

	const overrides = await sessionEnabledWhenOverrides(db, sessionId, genreId)
	const identity = actionIdentity(action)
	const preds = effectiveEnabledWhen(
		action.enabledWhen,
		genreEnabledWhen(genreId, identity),
		overrides.get(identity)
	)
	if (!preds.length) return { enabled: true, itemPredicates: [] }
	const values = await publishedValues(db, sessionId, opts)
	const verdict = enablementOf(preds, item ? { ...values, item } : values)
	// A predicate over `item.*` with no row to read it from (review W4): the
	// door has nothing to judge, so it does not admit — the first such
	// predicate's reason is the sentence, as it is for the client's palette
	// on a session with no row. An app door reading, said here by name (01
	// §13): the sentence is still the verdict's — the author's reason — but
	// which predicate it is comes from the door having no row, not from the
	// judge.
	if (verdict.enabled && verdict.itemPredicates.length) {
		const first = verdict.itemPredicates[0]!
		return {
			enabled: false,
			reason: { i18n: localeMapOf(first.reason) },
			itemPredicates: []
		}
	}
	return verdict
}


/**
 * A refusal's sentence from a reason, in the actor's language — resolved
 * here because a refusal is one string on the wire, where a status is a
 * locale map the client resolves. Falls back to `en` like `renderStatusText`.
 */
export async function reasonSentence(
	reason: StatusText,
	actor: { userId: number }
): Promise<string> {
	let language = "en"
	try {
		const { resolveUserLanguage } = await import("$lib/server/i18n")
		language = (await resolveUserLanguage(actor.userId)).code
	} catch {
		// The sentence is still the sentence: `en` is always there (R-20).
	}
	return renderStatusText(reason, language)
}
