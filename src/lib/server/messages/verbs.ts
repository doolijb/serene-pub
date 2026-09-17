/**
 * Message verbs (20 §4; R-15, ruled 2026-09-15): core owns the mechanics;
 * the genre declares availability; the check happens server-side at the
 * verb — the `triggerFunction` doctrine, applied to messages: hiding a
 * button is presentation, refusing the fire is what makes "removed" mean
 * removed.
 *
 * **The floors are not in this file's vocabulary on purpose.** Stop, branch
 * and edit are present in every genre: `SessionShape.messageVerbs` cannot
 * express forbidding them (the SDK refuses a declaration that tries, at
 * registration), and no code path consults anything before honouring them
 * beyond ownership. What this module resolves is the forbiddable set — the
 * genre-declared content actions (`retry`, `continue`, `stepBack`) and the
 * opt-in built-ins (`delete`, `hide`, `swipe`), which a genre may switch off
 * and never re-implement.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { MESSAGE_VERBS, type MessageVerb } from "@serene-pub/sdk"

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
 * Refusal sentence when the session's mode forbids the verb, else null.
 * Best-effort on the reads (an unknown mode falls through to all-on — the
 * F29 posture: policy resolution failing must never block the turn's floor
 * behaviour, only the declared restrictions).
 */
export async function verbRefusal(
	db: Db,
	sessionId: number,
	verb: keyof MessageVerbPolicy
): Promise<string | null> {
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
		if (resolveMessageVerbs(mode.shape)[verb]) return null
		return (
			`This session's genre ('${mode.name}') does not offer ${verb} on ` +
			`messages — what happened stands. Stopping, branching and editing are always yours.`
		)
	} catch {
		return null
	}
}

/**
 * Why `continue` is unavailable in this session, or `null` when it is available.
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
 * the genre's refusal wins, because "this mode does not offer continue" is true
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
 * would grey out Continue on an instance whose real fault is that nothing is
 * configured at all. Null — let the turn refuse, in its own words.
 */
export async function continueVerbRefusal(
	db: Db,
	sessionId: number,
	userId: number
): Promise<string | null> {
	const genre = await verbRefusal(db, sessionId, "continue")
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
