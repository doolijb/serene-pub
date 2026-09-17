import {
	declareInterest,
	requestWithInterest
} from "$lib/client/sockets/interest.svelte"
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
 *
 * ## Interest
 *
 * Both halves go through the **interest registry**, and both are BARE: neither
 * event has an entry in `SCOPED_EVENTS` (the reply names a binding, not a
 * book), and a scoped key for an unscoped event matches nothing. The interest
 * is held only for the length of one call — `cleanup` releases it down all
 * three exits (reply, error, timeout), which is what keeps a promise that
 * nobody is waiting on from leaving a subscriber behind.
 *
 * The error interest is declared BEFORE the request, because
 * `requestWithInterest` flushes the interest sync and emits in the same breath:
 * a key declared after it would reach the server behind the request it is
 * meant to hear the failure of.
 *
 * `socket` is still taken — the callers hold one and pass it — but the registry
 * owns the transport now, so nothing here listens on it directly.
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
			releaseReply()
			releaseError()
		}

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

		// Never gated (plan ruling 2 — an error is not an output to skip), but
		// the registry is the only listener path.
		const releaseError =
			declareInterest<"lorebooks:resolveOrCreateBindingByName:error">(
				"lorebooks:resolveOrCreateBindingByName:error",
				errorHandler
			)

		const releaseReply =
			requestWithInterest<"lorebooks:resolveOrCreateBindingByName">(
				"lorebooks:resolveOrCreateBindingByName",
				{
					lorebookId,
					name,
					requestId
				} satisfies Sockets.Lorebooks.ResolveOrCreateBindingByName.Params,
				handler
			)

		const timeout = setTimeout(() => {
			cleanup()
			reject(new Error(`Timed out resolving character "${name}".`))
		}, REQUEST_TIMEOUT_MS)
	})
}
