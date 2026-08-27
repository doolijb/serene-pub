import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { updateLegacyWhere } from "$lib/server/messages/store"
import { and, eq } from "drizzle-orm"
import {
	broadcastToSessionUsers,
	broadcastToSessionUsersVaryingByRole
} from "../sockets/utils/broadcastHelpers"
import type { LLMQueueStatus } from "./llmQueue"

const GUEST_FACING_GENERATION_ERROR_MESSAGE =
	"Generation failed. Ask the session owner to check their connection settings."

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
 * Round-12 audit fix (MEDIUM): the raw upstream provider error (eg. "HTTP
 * 401: Unauthorized", a KoboldCPP model-load failure with an embedded
 * response body) used to be broadcast verbatim to the whole session room,
 * including guests who have no relationship to the owner's LLM connection
 * or credentials. The stored DB row still keeps the real error — the owner
 * needs it to troubleshoot their own connection — only the guest-facing
 * broadcast is redacted.
 */
export async function persistGenerationErrorRow(
	socketIo: any,
	sessionId: number,
	generatingMessageId: number,
	err: unknown
) {
	const error = friendlyErrorFromUnknown(err)
	console.error("[generationStatus] generation failed:", err)
	const [updated] = await updateLegacyWhere(
		db,
		and(
			eq(schema.sessionMessages.id, generatingMessageId),
			eq(schema.sessionMessages.isGenerating, true)
		),
		{
			isGenerating: false,
			generationStage: null,
			queueItemId: null,
			error
		}
	)
	if (updated) {
		const guestFacing = {
			...updated,
			error: { message: GUEST_FACING_GENERATION_ERROR_MESSAGE }
		}
		await broadcastToSessionUsersVaryingByRole(
			socketIo,
			sessionId,
			"sessionMessage",
			{ sessionMessage: updated },
			{ sessionMessage: guestFacing }
		)
	}
}
