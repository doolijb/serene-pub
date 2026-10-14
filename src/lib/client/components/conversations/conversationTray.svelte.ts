/**
 * A conversation composer's upload tray (PLAN-private-messages-2026-10-12
 * §4 "Uploads", §6.3): the session composer's tray client
 * (`createComposerTray`) with the scope swapped — the same
 * `attachments:begin|chunk|finish|list|remove` events, carrying
 * `{conversationId}` where the session tray carries `{sessionId}`. Same caps
 * (`ATTACHMENT_CAPS`), same one-upload-at-a-time transport, same tiles.
 *
 * The session tray matches every reply by its `sessionId`, so this wrapper
 * translates at the transport and nowhere else:
 *
 * - **out**: a payload's `sessionId` is sent as `conversationId`;
 * - **in**: a reply's `conversationId` is read as `sessionId`, and a reply
 *   that names no conversation (a session tray's, in another view of this
 *   tab) has its `sessionId` dropped, so session 12's tray push can never be
 *   mistaken for conversation 12's.
 *
 * `attachments:readers` is never sent: what a reply's model can read is a
 * session question, and a conversation has no reply.
 */
import {
	createComposerTray,
	type TrayTransport
} from "$lib/client/components/sessionPage/attachments/composerTray.svelte"

/** Payload in: the conversation's id read as the tray's scope. */
export function inbound(data: unknown): unknown {
	if (!data || typeof data !== "object") return data
	const d = data as Record<string, unknown>
	if (d.conversationId != null) return { ...d, sessionId: d.conversationId }
	if ("sessionId" in d) {
		const { sessionId: _session, ...rest } = d
		return rest
	}
	return data
}

/** Payload out: the tray's scope sent as the conversation's id. */
export function outbound(data: unknown): unknown {
	if (!data || typeof data !== "object" || !("sessionId" in data)) return data
	const { sessionId, ...rest } = data as Record<string, unknown>
	return { ...rest, conversationId: sessionId }
}

export function createConversationTray(
	transport: TrayTransport,
	opts: { conversationId: () => number | null; waitMs?: number }
) {
	const scoped: TrayTransport = {
		emit(event, data) {
			if (event === "attachments:readers") return
			transport.emit(event, outbound(data))
		},
		on(event, handler) {
			return transport.on(event, (data) => handler(inbound(data)))
		}
	}
	return createComposerTray(scoped, {
		sessionId: opts.conversationId,
		waitMs: opts.waitMs
	})
}

export type ConversationTray = ReturnType<typeof createConversationTray>
