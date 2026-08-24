import type { TypedSocket } from "$lib/client/sockets/typedSocket"

const REQUEST_TIMEOUT_MS = 15000

/**
 * Resolves a name to a real lorebookBindings id via the server's
 * lorebooks:resolveOrCreateBindingByName endpoint — used at Save time by
 * the summarize/process review screens to turn an accepted "suggested new
 * character" (from extraction or manually typed) into a real binding. The
 * server does the fuzzy-match-or-create decision, not the client — this is
 * what prevents a manually typed alias of an existing character (or two
 * users accepting the same suggestion at once) from minting a duplicate
 * background character.
 *
 * Correlates its own response via a generated `requestId` rather than
 * matching on `name`, since other clients viewing the same lorebook can
 * also be creating/broadcasting bindings concurrently.
 */
export function resolveOrCreateBindingByName(
	socket: TypedSocket,
	lorebookId: number,
	name: string
): Promise<{ id: number; created: boolean }> {
	return new Promise((resolve, reject) => {
		const requestId = crypto.randomUUID()

		function cleanup() {
			clearTimeout(timeout)
			socket.off("lorebooks:resolveOrCreateBindingByName", handler)
			socket.off(
				"lorebooks:resolveOrCreateBindingByName:error",
				errorHandler
			)
		}

		const timeout = setTimeout(() => {
			cleanup()
			reject(new Error(`Timed out resolving character "${name}".`))
		}, REQUEST_TIMEOUT_MS)

		function handler(
			data: Sockets.Lorebooks.ResolveOrCreateBindingByName.Response
		) {
			if (data.requestId !== requestId) return
			cleanup()
			resolve({ id: data.lorebookBindingId, created: data.created })
		}

		// The server's generic error wrapper has no `requestId` to filter on
		// (it only fires `{event}:error` with a plain message), so a
		// concurrent failed request from elsewhere could in principle reject
		// the wrong in-flight promise — acceptable here since each modal
		// only ever has one resolve-or-create call in flight at a time
		// (sequential awaits, see ProcessSceneModal/SummarizeLoreModal).
		function errorHandler(data: { error: string }) {
			cleanup()
			reject(
				new Error(
					data.error || `Failed to resolve character "${name}".`
				)
			)
		}

		socket.on("lorebooks:resolveOrCreateBindingByName", handler)
		socket.on("lorebooks:resolveOrCreateBindingByName:error", errorHandler)
		socket.emit("lorebooks:resolveOrCreateBindingByName", {
			lorebookId,
			name,
			requestId
		} satisfies Sockets.Lorebooks.ResolveOrCreateBindingByName.Params)
	})
}
