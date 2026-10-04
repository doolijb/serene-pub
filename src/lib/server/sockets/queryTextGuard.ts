/**
 * No failed query's text leaves on a socket — whatever road the packet took.
 *
 * Since drizzle-orm 0.44 a failed query's message is its SQL and the values it
 * wrote (`db/errors.ts`), and a caught `e.message` is forwarded by handlers,
 * activity cards, broadcasts and pushes alike: `emitToUser`, the session
 * broadcasts, `emitToInterested`, `pushToUser`, a raw `socket.emit`, an ack.
 * Guarding each road leaves the next one open, so this guards the one place
 * they all meet: the server's packet encoder. Socket.IO encodes a direct emit
 * (`Client` → `server.encoder`) and a broadcast (the adapter →
 * `nsp.server.encoder`) through the same instance, so one wrapper sees every
 * packet this server sends.
 *
 * Cheap on the ordinary packet: the encoded text is searched once for the
 * marker, and only a hit walks the payload (`payloadWithoutQueryText`) and
 * encodes it again. Each replaced original goes to the server log, where the
 * whole error belongs (the log ring keeps it without its values).
 */

import { payloadWithoutQueryText } from "$lib/server/db/errors"

/** The part of Socket.IO's `Server` this needs: its public `encoder`. */
export interface EncodingServer {
	encoder: { encode(packet: any): any[] }
}

/** Marks an encoder already guarded, so a second attach does not wrap twice. */
const GUARDED = Symbol.for("serene-pub:queryTextGuard")

/** The packet types whose first datum is the event name (EVENT, BINARY_EVENT). */
const EVENT_TYPES = new Set([2, 5])
/** CONNECT_ERROR: `{ message, data }` from a refused handshake — an error. */
const CONNECT_ERROR = 4

/**
 * The name the rule reads a packet by: an event's own name, `connect:error`
 * for a refused handshake (so any marker counts), and none for an ack or a
 * connect, whose strings are held to the stricter rule (drizzle's whole
 * shape, values and all).
 */
function ruleNameOf(packet: { type?: number; data?: unknown }): string {
	if (packet.type === CONNECT_ERROR) return "connect:error"
	if (
		EVENT_TYPES.has(packet.type as number) &&
		Array.isArray(packet.data) &&
		typeof packet.data[0] === "string"
	)
		return packet.data[0]
	return ""
}

export function installQueryTextGuard(io: EncodingServer): void {
	const encoder = io.encoder as EncodingServer["encoder"] & {
		[GUARDED]?: true
	}
	if (encoder[GUARDED]) return
	const encode = encoder.encode.bind(encoder)
	encoder.encode = (packet: any) => {
		const out = encode(packet)
		if (
			packet?.data === undefined ||
			!out.some(
				(part) => typeof part === "string" && part.includes("Failed query: ")
			)
		)
			return out
		const event = ruleNameOf(packet)
		const data = payloadWithoutQueryText(event, packet.data, (original) =>
			console.warn(
				`[sockets] ${event || "packet"}: a failed query's text was answered with the plain sentence. It was:`,
				original
			)
		)
		return data === packet.data ? out : encode({ ...packet, data })
	}
	encoder[GUARDED] = true
}
