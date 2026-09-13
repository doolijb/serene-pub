import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { updateLegacyWhere } from "$lib/server/messages/store"
import { and, eq } from "drizzle-orm"
import { broadcastToSessionUsers } from "../sockets/utils/broadcastHelpers"
import {
	ComposedError,
	type ConnectionIdentity
} from "$lib/server/connections/visibility"
import type { LLMQueueStatus } from "./llmQueue"

/**
 * What a failure says when its own words cannot be shown.
 *
 * The axis is administrator-vs-everyone, not owner-vs-guest: under the 0.6
 * ruling a non-admin owner has no more relationship to the instance's compute
 * than a guest does, so this is what BOTH of them read. It used to say "ask the
 * session owner to check their connection settings", which was the old axis and
 * is now wrong advice as well as a leak — a non-admin owner has no connection
 * settings to check.
 */
const OPAQUE_GENERATION_ERROR_MESSAGE =
	"Generation failed — the service reported an error. An administrator can " +
	"see the details."

export function friendlyErrorFromUnknown(err: unknown): {
	message: string
	code?: string
} {
	const raw = err instanceof Error ? err.message : String(err)
	// Pull a leading HTTP-status-looking token out of adapter error messages
	// (e.g. "KoboldCPP API error: 500 ...") so it can be shown as a code.
	const statusMatch = raw.match(/\b([1-5]\d{2})\b/)
	const code = statusMatch
		? statusMatch[1]
		: (err as any)?.code || (err as any)?.name
	const message =
		raw && raw !== "[object Object]"
			? raw
			: "Generation failed for an unknown reason."
	return { message, code: code ? String(code) : undefined }
}

export async function persistGenerationStage(
	generatingMessageId: number,
	sessionId: number,
	socketIo: any,
	status: LLMQueueStatus
) {
	const stage =
		status === "queued" || status === "loading" || status === "generating"
			? status
			: null
	const [updated] = await updateLegacyWhere(
		db,
		and(
			eq(schema.sessionMessages.id, generatingMessageId),
			eq(schema.sessionMessages.isGenerating, true)
		),
		{ generationStage: stage }
	)
	if (updated) {
		await broadcastToSessionUsers(socketIo, sessionId, "sessionMessage", {
			sessionMessage: updated
		})
	}
}

/**
 * Fail a generating message, and say why — to whoever is allowed to be told.
 *
 * ## Why redacting the broadcast was never enough
 *
 * A Round-12 fix sent guests a generic sentence while the owner got the raw
 * service text. It was right about the danger and wrong about two things.
 *
 * It was wrong about the AXIS: under the 0.6 ruling connections are invisible to
 * everyone who is not an administrator, and a non-admin OWNER is on the wrong
 * side of that line. `managedPreflight` fills these errors with the model file
 * path and the base URL, and the owner was being handed them verbatim.
 *
 * And it was wrong about the MOMENT. This row is stored. `projectLegacy` re-serves
 * it on every reload, so a redaction applied to the broadcast is undone by the
 * next page load — the leak is not in the emit, it is in the column.
 *
 * ## So the shape of the row is the fix
 *
 * The message is the part everyone may read; the identity is a FIELD beside it,
 * under the one key `withoutConnectionIdentity` removes. Every read path already
 * runs that walk — `broadcastToSessionUsers` per recipient, `emitToUser` for the
 * session load — so redaction happens on every serving of the row, first and
 * thousandth alike, and nothing here has to know who is listening. The
 * administrator keeps the whole diagnostic, which is what storing pre-redacted
 * text would have destroyed forever.
 *
 * ⚠ A `ComposedError`'s words are ours and name nobody, so they are shown as
 * written; anything else came back from a service and is moved into the field.
 * Unmarked therefore degrades to a duller sentence, never to a leak — see
 * `ComposedError`.
 */
export async function persistGenerationErrorRow(
	socketIo: any,
	sessionId: number,
	generatingMessageId: number,
	err: unknown,
	/**
	 * The queue item this failure belongs to, where the caller holds one.
	 *
	 * ⚠ A run may only fail the row it still owns. `isGenerating` alone is true
	 * again the moment a regenerate starts, so a late failure from a detached or
	 * superseded run would stop the generation that replaced it and show its
	 * error instead. A caller with no queue item — a refusal raised before one
	 * exists — passes nothing and fences on `isGenerating` as before.
	 */
	queueItemId?: string
) {
	const raw = friendlyErrorFromUnknown(err)
	// The server log is the administrator's, and always has been.
	console.error("[generationStatus] generation failed:", err)

	const composed = err instanceof ComposedError
	const connection: ConnectionIdentity | undefined = composed
		? err.connection
		: { detail: raw.message }

	// The code goes with the message it was extracted from, and only when that
	// message is ours. `friendlyErrorFromUnknown` reads any three-digit run as a
	// status, so on `http://192.168.1.5:5001/…` it returns "192" — an octet of a
	// private address, not an HTTP status, and no more shareable than the
	// sentence it came out of. An administrator reads it inside `detail` below,
	// where the whole service message is.
	const error = {
		message: composed ? raw.message : OPAQUE_GENERATION_ERROR_MESSAGE,
		...(composed && raw.code ? { code: raw.code } : {}),
		...(connection ? { connection } : {})
	}

	const [updated] = await updateLegacyWhere(
		db,
		and(
			eq(schema.sessionMessages.id, generatingMessageId),
			eq(schema.sessionMessages.isGenerating, true),
			...(queueItemId
				? [eq(schema.sessionMessages.queueItemId, queueItemId)]
				: [])
		),
		{
			isGenerating: false,
			generationStage: null,
			queueItemId: null,
			error
		}
	)
	// One payload for everybody now, where there used to be two. The difference
	// between what an administrator and a guest receive is made by the walk
	// inside `broadcastToSessionUsers`, per recipient — which is the same rule,
	// in the same place, as every other emit on the server.
	if (updated)
		await broadcastToSessionUsers(socketIo, sessionId, "sessionMessage", {
			sessionMessage: updated
		})
}
