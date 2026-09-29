/**
 * Message verbs (20 §4; R-15, ruled 2026-09-15): core owns the mechanics;
 * the genre declares availability; the check happens server-side at the
 * verb — the `sessions:fireAction` doctrine, applied to messages: hiding a
 * button is presentation, refusing the fire is what makes "removed" mean
 * removed.
 *
 * **The floors are not in this file's vocabulary on purpose.** Stop, branch
 * and edit are present in every genre: `SessionShape.messageVerbs` cannot
 * express forbidding them (the SDK refuses a declaration that tries, at
 * registration), and no code path consults anything before honouring them
 * beyond ownership. What this module resolves is the forbiddable set — the
 * genre-declared content actions (`retry`, `extend`, `stepBack`) and the
 * opt-in built-ins (`delete`, `hide`, `swipe`), which a genre may switch off
 * and never re-implement.
 */

import { CORE_ACTION_SPEC } from "$lib/shared/actions/identity"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	coreAction,
	formBlocksOf,
	MESSAGE_VERBS,
	resolveTurnControls,
	turnControlPresent,
	type MessageVerb,
	type TurnControl
} from "@serene-pub/sdk"
import { parseChannel } from "$lib/server/messages/channels"

/** Availability of every forbiddable verb. The floors are not here. */
export type MessageVerbPolicy = Record<MessageVerb, boolean>

const ALL_ON: MessageVerbPolicy = Object.freeze(
	Object.fromEntries(MESSAGE_VERBS.map((v) => [v, true]))
) as MessageVerbPolicy

export function resolveMessageVerbs(shape: unknown): MessageVerbPolicy {
	const declared =
		shape && typeof shape === "object"
			? ((shape as any).messageVerbs ?? null)
			: null
	if (!declared || typeof declared !== "object") return { ...ALL_ON }
	return Object.fromEntries(
		MESSAGE_VERBS.map((v) => [v, declared[v] !== false])
	) as MessageVerbPolicy
}

/**
 * Per-channel verb overrides (R-C, 2026-09-17), by slug — or `null` when no
 * channel declares any, which is every genre written before the long form.
 *
 * Read off the **raw** declaration rather than off a normalised list, because
 * what matters here is whether a channel said anything of its own: a genre
 * that declares only bare slugs must cost nothing, and `null` is what makes
 * that structural — the caller then never reads the message's row at all.
 */
function channelVerbOverrides(
	shape: unknown
): Map<string, Record<string, boolean>> | null {
	const channels = (shape as { channels?: unknown } | undefined)?.channels
	if (!Array.isArray(channels)) return null
	const out = new Map<string, Record<string, boolean>>()
	for (const raw of channels) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
		const decl = raw as { slug?: unknown; messageVerbs?: unknown }
		if (typeof decl.slug !== "string" || !decl.slug.trim()) continue
		if (!decl.messageVerbs || typeof decl.messageVerbs !== "object") continue
		out.set(
			parseChannel(decl.slug).slug,
			decl.messageVerbs as Record<string, boolean>
		)
	}
	return out.size ? out : null
}

/**
 * The shape as it applies to ONE message: the genre's, with its channel's
 * declared verbs over the top (R-C). Declared keys win and the rest keep the
 * genre's answer, so switching `delete` off on the manuscript does not switch
 * `swipe` back on.
 *
 * The message's row is read only when some channel actually declares verbs —
 * see `channelVerbOverrides`.
 */
async function shapeForMessage(
	db: Db,
	shape: unknown,
	messageId: number | undefined
): Promise<unknown> {
	if (messageId === undefined) return shape
	const overrides = channelVerbOverrides(shape)
	if (!overrides) return shape
	const [row] = await db
		.select({ channel: schema.sessionMessages.channel })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, messageId))
		.limit(1)
	if (!row?.channel) return shape
	const declared = overrides.get(parseChannel(row.channel).slug)
	if (!declared) return shape
	return {
		...(shape as Record<string, unknown>),
		messageVerbs: {
			...((shape as { messageVerbs?: object } | undefined)?.messageVerbs ??
				{}),
			...declared
		}
	}
}

/**
 * Refusal sentence when the session's mode forbids the verb, else null.
 * Best-effort on the reads (an unknown mode falls through to all-on — the
 * F29 posture: policy resolution failing must never block the turn's floor
 * behaviour, only the declared restrictions).
 *
 * With `door` — the message the verb is pressed on and who presses it —
 * the verb's **enabled-when** is asked too (R-15; U5e): core's declaration
 * for the verb (`CORE_ACTIONS`), under the genre's default and the
 * session's override for the function, over the session's published
 * values with the row's `item`. A failing predicate's reason is the
 * sentence — the same words the ⋮ menu greys the entry with. Read through
 * `enablementVerdict`, the reading `fireAction` and the listing share.
 */
export async function verbRefusal(
	db: Db,
	sessionId: number,
	verb: keyof MessageVerbPolicy,
	door?: { messageId: number; userId: number }
): Promise<string | null> {
	let genreId: string | null = null
	try {
		const [session] = await db
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!session?.genreId) return null
		genreId = session.genreId
		const { getSessionGenre } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const mode = await getSessionGenre(db, session.genreId)
		if (!mode) return null
		// The genre's declaration, with the message's own channel's over the
		// top (R-C). Identical to `mode.shape` for every genre that declares
		// no per-channel verbs, and the row is not read in that case.
		const shape = await shapeForMessage(db, mode.shape, door?.messageId)
		if (!resolveMessageVerbs(shape)[verb])
			return (
				`This session's genre ('${mode.name}') does not offer ${verb} on ` +
				`messages — what happened stands. Stopping, branching and editing are always yours.`
			)
		// A row of a several-row turn is retaken whole (R2), before any
		// newest-row verdict: the sentence that helps is where to go instead.
		if (verb === "retry" && door) {
			const whole = await retakeRowRefusal(db, mode.shape, door.messageId)
			if (whole) return whole
		}
	} catch {
		return null
	}
	if (!door || !genreId) return null
	return verbEnablementRefusal(db, sessionId, verb, door, genreId)
}

/**
 * The row regenerate in a **retake** genre (lair pass R2, owner 2026-09-28):
 * refused on a row that is not a delver's — no `characterId` — when the reply
 * run that created it wrote more than one row (its **turn yield**,
 * `turnYieldOf`). Regenerating that row alone would leave the rest of the
 * turn standing on a line it does not follow; Regenerate in the composer
 * takes the whole turn again. In the Lair: the Castellan's beats row in the Sanctum (R8).
 *
 * A **one-row** reply keeps the row regenerate with its swipes — a
 * narration, a pick, a Castellan's Sanctum reply — and a delver's row
 * always does (it re-voices that delver, B15). **Except a question its
 * turn stopped on** (R9, 2026-09-28): a one-row yield whose row carries a
 * form — the Lair's knock — is refused too, because re-driving it re-plans
 * the turn and a play would land in the question's row. Read off the run's yield,
 * never off the speaker or the channel: the Lair's Sanctum beats row is
 * refused though its channel offers no retake (R8). Null in a genre that
 * does not offer retake, and for a row no reply run created.
 */
export async function retakeRowRefusal(
	db: Db,
	shape: unknown,
	messageId: number
): Promise<string | null> {
	if (!resolveTurnControls(shape).retake.offered) return null
	const [row] = await db
		.select({
			role: schema.sessionMessages.role,
			characterId: schema.sessionMessages.characterId,
			channel: schema.sessionMessages.channel
		})
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, messageId))
		.limit(1)
	if (!row || row.role === "user" || row.characterId != null) return null
	const { creatingRunOf, turnYieldOf } = await import(
		"$lib/server/sessions/turnYield"
	)
	const run = await creatingRunOf(db, messageId)
	if (!run) return null
	const yieldRows = await turnYieldOf(db, run.id)
	if (yieldRows.length <= 1) {
		/**
		 * **A question its turn stopped on** (R9): a one-row turn whose row
		 * carries a form — the Lair's knock. Re-driving that row re-plans the
		 * turn, and a turn that now plays would write another voice's line
		 * into the question's row (the lead delver's, under the Castellan's
		 * name). The row IS its turn's whole yield, so the composer's
		 * Regenerate — the retake — takes that turn again, into rows of its
		 * own. Keyed on recorded facts: the yield, and a form on the row.
		 */
		if (
			yieldRows.length === 1 &&
			yieldRows[0]!.messageId === messageId &&
			(await rowAsks(db, messageId))
		)
			return (
				"This message is the question its turn stopped on. Use Regenerate in the " +
				"composer to take the whole turn again."
			)
		return null
	}
	/**
	 * Read off the yield, never the row's channel (R8): the Lair's Sanctum
	 * offers no retake, and its Castellan talk keeps the row regenerate —
	 * a one-row yield, answered above — but the turn's BEATS row sits there
	 * too, one part of a turn whose other rows are the story's. Regenerating
	 * it alone would re-drive the row as Sanctum talk. It is retaken with its
	 * turn, from the story's composer (the page routes its ⋮ there).
	 */
	const here = resolveTurnControls(shape, row.channel ?? undefined).retake.offered
	return (
		"This message is one part of a turn that wrote several. Use Regenerate in the " +
		(here ? "composer" : "story's composer") +
		" to take the whole turn again."
	)
}

/** Whether a row carries a form block — a question put to somebody. */
async function rowAsks(db: Db, messageId: number): Promise<boolean> {
	const { blockTreesOf } = await import("$lib/server/messages/blocks")
	return (await blockTreesOf(db, messageId)).some((tree) => formBlocksOf(tree).length > 0)
}

/** What each turn control is called in a refusal — the core action's label. */
const turnControlName = (control: TurnControl): string =>
	(coreAction(control)?.label as { en?: string } | undefined)?.en ?? control

/**
 * Refusal sentence for a press of a turn control (`SessionShape.turnControls`,
 * lair pass B7 + B8), else null. Three verdicts, in the order a person needs
 * them:
 *
 * 1. **Offered** — the genre switches the control off (or never opts in,
 *    for `narrate`): refused by name.
 * 2. **Present** — its present-when fails over the published values:
 *    refused with the declaration's reason.
 *    The listing hides the chip on the same verdict (`listSessionActions`).
 * 3. **Enabled** — the core action's enabled-when (busy, nobody seated to
 *    pick): refused with that reason, the one the grey chip shows.
 *
 * The `verbRefusal` posture: an unreadable genre refuses nothing. `advance`
 * is the composer's Continue — never the prefill `extend`, which
 * `verbRefusal` answers.
 */
export async function turnControlRefusal(
	db: Db,
	sessionId: number,
	control: TurnControl,
	actor: { userId: number },
	/**
	 * The pressing composer's channel (R6): a channel's declared
	 * `turnControls` win over the genre's. Absent is `main`.
	 */
	channel?: string
): Promise<string | null> {
	let genreId: string
	let presence: ReturnType<typeof resolveTurnControls>
	let modeName: string
	let modeShape: unknown
	try {
		const [session] = await db
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!session?.genreId) return null
		const { getSessionGenre } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const mode = await getSessionGenre(db, session.genreId)
		if (!mode) return null
		genreId = session.genreId
		modeName = mode.name
		modeShape = mode.shape
		presence = resolveTurnControls(mode.shape, channel)
	} catch {
		return null
	}
	const name = turnControlName(control)
	if (!presence[control].offered) {
		// Offered by the genre and taken away on this channel (R6): say
		// where, so the person knows the story's composer still has it.
		if (
			channel &&
			parseChannel(channel).slug !== "main" &&
			resolveTurnControls(modeShape)[control].offered
		)
			return `${name} is not offered on this channel — use it in the story.`
		return control === "advance"
			? `This session's genre ('${modeName}') does not offer Continue — send a line to move the story on.`
			: `This session's genre ('${modeName}') does not offer ${name}.`
	}
	try {
		const { publishedValues } = await import(
			"$lib/server/pipelines/entities/publishedValues"
		)
		const { enablementVerdict, reasonSentence } = await import(
			"$lib/server/pipelines/entities/sessionActions"
		)
		if (presence[control].presentWhen.length) {
			const values = await publishedValues(db, sessionId)
			const present = turnControlPresent(presence, control, values)
			if (!present.present)
				return await reasonSentence(
					{ i18n: present.reason ?? { en: `${name} is not offered here.` } },
					actor
				)
		}
		const gate = await enablementVerdict(db, sessionId, genreId, actor, {
			specSlug: CORE_ACTION_SPEC,
			key: control,
			enabledWhen: coreAction(control)?.enabledWhen
		})
		if (gate.enabled) return null
		return await reasonSentence(gate.reason!, actor)
	} catch (e) {
		console.warn(`[verbs] the turn control '${control}' could not be judged:`, e)
		return null
	}
}

/**
 * Which turn control a fire with an explicit entry the order does NOT hold
 * is a press of (B8), or null for one that is no turn control — the owner's
 * latitude to fire an unprepared entry (§4.7), an envoy's reference, the
 * pipeline's own voice on a channel with no narrator.
 *
 * - a `character:` reference is **Pick who speaks** (`pick`);
 * - the null reference in a `voice: 'narrator'` genre is **the narrator's
 *   turn** (`narrate`) — elsewhere the null reference is the pipeline's own
 *   voice (the Writing Room's manuscript), not a narrator.
 */
export function pressedTurnControl(
	shape: unknown,
	entry: { ref: string | null; channel?: string }
): TurnControl | null {
	if (typeof entry.ref === "string")
		return entry.ref.startsWith("character:") ? "pick" : null
	const voice = (shape as { voice?: unknown } | undefined)?.voice
	return entry.ref === null && voice === "narrator" ? "narrate" : null
}

/**
 * The door for a fire naming an entry the order does not hold (B8): the
 * turn control it presses (`pressedTurnControl`), judged by
 * `turnControlRefusal`; null when it presses none, or the genre is
 * unreadable.
 */
export async function unpreparedEntryRefusal(
	db: Db,
	sessionId: number,
	entry: { ref: string | null; channel?: string },
	actor: { userId: number },
	/** The pressing composer's channel (R6); else the entry's. */
	pressedOn?: string
): Promise<string | null> {
	let control: TurnControl | null
	try {
		const [session] = await db
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!session?.genreId) return null
		const { getSessionGenre } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const mode = await getSessionGenre(db, session.genreId)
		if (!mode) return null
		control = pressedTurnControl(mode.shape, entry)
	} catch {
		return null
	}
	return control
		? turnControlRefusal(
				db,
				sessionId,
				control,
				actor,
				pressedOn ?? entry.channel
			)
		: null
}

/**
 * The enabled-when half of a verb's door, on its own because the floors
 * ask it too (review W2): `edit` from `sessionMessages:update` when the
 * content changes, `branch` from `sessions:branch` — neither has a key in
 * `MessageVerbPolicy` (a genre cannot switch a floor off), and both have
 * a declared predicate (`CORE_ACTIONS`: not while generating; edit not on
 * a hidden row). Null when the verb is offered now, or when core describes
 * no such verb. A read that fails refuses nothing (the F29 posture above):
 * a declared restriction is the law, a broken resolver is not. `genreId`
 * is read here unless the caller already has it.
 */
export async function verbEnablementRefusal(
	db: Db,
	sessionId: number,
	verb: string,
	door: { messageId: number; userId: number },
	genreId?: string
): Promise<string | null> {
	const declared = coreAction(verb)
	try {
		if (!genreId) {
			const [session] = await db
				.select({ genreId: schema.sessions.genreId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, sessionId))
				.limit(1)
			if (!session?.genreId) return null
			genreId = session.genreId
		}
		const { enablementVerdict, reasonSentence } = await import(
			"$lib/server/pipelines/entities/sessionActions"
		)
		const gate = await enablementVerdict(
			db,
			sessionId,
			genreId,
			{ userId: door.userId },
			{ specSlug: CORE_ACTION_SPEC, key: verb, enabledWhen: declared?.enabledWhen },
			door.messageId
		)
		if (gate.enabled) return null
		return await reasonSentence(gate.reason!, { userId: door.userId })
	} catch (e) {
		console.warn(`[verbs] enabled-when for '${verb}' could not be read:`, e)
		return null
	}
}

/**
 * Why `extend` is unavailable in this session, or `null` when it is available.
 *
 * ## Two refusals, one answer, because a person only wants one sentence
 *
 * `verbRefusal` above answers whether this KIND of session offers the verb at
 * all — the genre's declaration, 20 §4. It says nothing about whether the
 * connection serving the session can actually resume a partial reply, and most
 * cannot: a continuation is only a continuation when the model is handed the
 * text so far inside an OPEN assistant turn. Everything else produces a fresh
 * reply that `joinContinuation` then glues onto the partial, with nothing
 * reporting it.
 *
 * So the two are composed here rather than at each call site, and in this order:
 * the genre's refusal wins, because "this mode does not offer extend" is true
 * whatever connection is behind it, and telling somebody to change their wire
 * mode when the mode would refuse anyway sends them to a screen that cannot help.
 *
 * ## The connection is resolved the way the TURN resolves it — nearly
 *
 * Through `resolveTaskConfig`: prompt config → the instance's `text->text`
 * default. A shortcut that read the instance default alone would be right
 * until somebody set a connection on their prompt config, and then would
 * disable a button that works (or, worse, enable one that does not).
 *
 * ⏳ Since the one road (09-B B4, R-8) the turn itself resolves through the
 * scope data (`config/world.ts`), which also carries the pipeline panel's pick
 * on the generate node; this affordance check does not read that pick, so it
 * can disagree with the run when a per-node connection differs from the prompt
 * config's. An affordance, not a write — the turn's own resolution wins.
 *
 * ⚠ A resolution FAILURE is not this function's refusal. "No connection is set"
 * is a different problem with a different sentence, and the reply road writes
 * that one onto the message row where a person can see it; answering it here
 * would grey out Extend on an instance whose real fault is that nothing is
 * configured at all. Null — let the turn refuse, in its own words.
 */
export async function extendVerbRefusal(
	db: Db,
	sessionId: number,
	userId: number,
	messageId?: number
): Promise<string | null> {
	const genre = await verbRefusal(
		db,
		sessionId,
		"extend",
		messageId != null ? { messageId, userId } : undefined
	)
	if (genre) return genre
	try {
		const { getUserConfigurations } = await import(
			"$lib/server/utils/getUserConfigurations"
		)
		const { resolveTaskConfig } = await import(
			"$lib/server/utils/resolveTaskConfig"
		)
		const { resolveContinueRefusal } = await import(
			"$lib/server/connections/resolve"
		)
		const { promptConfig } = await getUserConfigurations(userId)
		const resolved = await resolveTaskConfig({
			taskType: "session",
			promptConfigId: promptConfig?.id,
			sessionId
		})
		if (!resolved.connection) return null
		return resolveContinueRefusal(resolved.connection)
	} catch {
		// The same F29 posture as `verbRefusal`: a policy read that fails must
		// never block the turn's floor behaviour. An unresolvable connection is
		// the turn's problem to report, not a reason to take the verb away.
		return null
	}
}
