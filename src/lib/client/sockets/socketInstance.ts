import type { Socket } from "socket.io-client"

/**
 * The one live socket, in its own module.
 *
 * Split out rather than living in `loadSockets.client.ts` because that file
 * re-exports from `typedSocket.ts`, which needs to read the socket — importing
 * back the other way would close a cycle. This module imports nothing but a
 * type, so anything can read from it.
 *
 * Replaces `sveltekit-io`'s `skio.get()`. That package's only real job was
 * standing up a second Socket.IO server on its own port; with Socket.IO
 * attached to the app server, all that remained of it was this variable.
 */
let socket: Socket | null = null

export function setSocket(next: Socket | null) {
	socket = next
}

export function getSocket(): Socket | null {
	return socket
}
