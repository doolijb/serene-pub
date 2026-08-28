/**
 * Message verbs (20 §4): core owns the mechanics; the mode declares
 * availability; the check happens server-side at the verb — the
 * `triggerFunction` doctrine, applied to messages: hiding a button is
 * presentation, refusing the fire is what makes "removed" mean removed.
 *
 * **The floors are not in this file's vocabulary on purpose.** Delete and
 * hide are unconditionally the session owner's; `SessionShape.messageVerbs`
 * cannot express forbidding them, and no code path consults anything before
 * honouring them beyond ownership. What this module resolves is only the
 * forbiddable set: retry, continue, edit, stepBack.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

type Db = { select: any }

export interface MessageVerbPolicy {
	retry: boolean
	continue: boolean
	edit: boolean
	stepBack: boolean
}

const ALL_ON: MessageVerbPolicy = {
	retry: true,
	continue: true,
	edit: true,
	stepBack: true
}

export function resolveMessageVerbs(shape: unknown): MessageVerbPolicy {
	const declared =
		shape && typeof shape === "object"
			? ((shape as any).messageVerbs ?? null)
			: null
	if (!declared || typeof declared !== "object") return ALL_ON
	return {
		retry: declared.retry !== false,
		continue: declared.continue !== false,
		edit: declared.edit !== false,
		stepBack: declared.stepBack !== false
	}
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
		const mode = await getSessionGenre(db as any, session.genreId)
		if (!mode) return null
		if (resolveMessageVerbs(mode.shape)[verb]) return null
		return (
			`This session's mode ('${mode.name}') does not offer ${verb} on ` +
			`messages — what happened stands. Deleting or hiding is always yours.`
		)
	} catch {
		return null
	}
}
