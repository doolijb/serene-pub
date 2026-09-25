/**
 * The `sessions:recordedEvent` push (R56, E1d): a package's event, recorded
 * in a session, to everyone watching that session — whose page hands it to
 * its widgets as `event:recorded`.
 *
 * An event is heard by everything in its scope, so the payload goes as
 * recorded: a secret never rides an event (it is state, with an audience —
 * R57). Core's own events are not pushed here; they reach clients as the
 * pushes and widget members they already have.
 *
 * A no-op with no socket server, like every other session push: a run
 * started by a test or a CLI has nobody to tell.
 */

import { packageEventById } from "@serene-pub/sdk"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import { broadcastToSessionUsers } from "$lib/server/sockets/utils/broadcastHelpers"

export interface RecordedEventPush {
	sessionId: number
	event: string
	payload: unknown
	at: number
}

/**
 * What an emitted event pushes, or null when it pushes nothing: only a
 * package's event, and only what its recording wrote — the author's payload,
 * never the envelope around it (cause, lineage).
 */
export function recordedEventPushOf(
	event: string,
	envelope: unknown,
	sessionId: number,
	at: number
): RecordedEventPush | null {
	if (!packageEventById(event)) return null
	const payload = (envelope as { payload?: unknown } | null)?.payload
	return { sessionId, event, payload: payload ?? null, at }
}

export async function pushRecordedEvent(
	io: SessionIo,
	push: RecordedEventPush
): Promise<void> {
	if (!io) return
	await broadcastToSessionUsers(
		io,
		push.sessionId,
		"sessions:recordedEvent",
		push
	)
}
