/**
 * Ask before saving an edit of the starred embedding connection that will
 * re-embed the index.
 *
 * Editing the starred connection's address, or its starred model's
 * identifier, changes the model identity every vector is stamped with — the
 * server then clears every vector the new identity did not make and re-embeds
 * them (`withStarConsequences`), which on a paid service is a real bill. So the
 * save asks first, with the same dialog and the same words as moving the star
 * (`EmbeddingSwitchDialog`) — and only when the server's price for the edit is
 * above zero: a respelled address (a trailing slash, a capital, a written-out
 * default port) is the same model and never asks.
 *
 * **The server decides whether an edit touches the star**, not this screen:
 * every address or identifier edit is priced, and an edit of a connection or
 * model the star is not on comes back at zero. A screen whose copy of the
 * defaults has not loaded yet therefore still asks when it must.
 *
 * `confirmEdit` resolves `true` when the save may go ahead: the edit moves
 * nothing, or the person confirmed. `false` when they kept the model they have,
 * and when the price could not be had — a refusal (already on screen: Layout
 * toasts every `:error`) or no answer at all (said here). An unpriced save that
 * might re-embed everything does not go ahead.
 */
import { useTypedSocket } from "$lib/client/sockets/typedSocket"
import { awaitReply, isReplyTimeout } from "$lib/client/utils/awaitReply"
import { toaster } from "$lib/client/utils/toaster"

type Target = Sockets.Vectorization.ReindexCost.Target

export interface EmbeddingEdit {
	connectionId: number
	/** The model row being renamed; absent for an edit of the connection. */
	modelId?: number
	edit: NonNullable<Target["edit"]>
	/** What runs now and what the save installs, by name, for the dialog. */
	currentName: string | null
	nextName: string | null
	currentIsLocal?: boolean
}

const sameTarget = (a: Target | undefined, b: Target) =>
	!!a &&
	a.connectionId === b.connectionId &&
	a.modelId === b.modelId &&
	JSON.stringify(a.edit ?? null) === JSON.stringify(b.edit ?? null)

/**
 * An address as a person reads it — no scheme, no trailing slash — for naming
 * the same model at two addresses ("bge-small at api.example.com/v1").
 */
export function addressOf(baseUrl: string | null | undefined): string {
	return (baseUrl ?? "")
		.trim()
		.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
		.replace(/\/+$/, "")
}

export function useEmbeddingEditConfirm() {
	const socket = useTypedSocket()

	/** The edit being priced or confirmed — its names are the dialog's. */
	let asking = $state<EmbeddingEdit | null>(null)
	let cost = $state<Sockets.Vectorization.ReindexCost.Response | null>(null)
	let open = $state(false)
	/** Kept out of `$state`: a function is an answer to give, not a view. */
	let answer: ((ok: boolean) => void) | null = null
	/** Which ask is current; a late reply to a replaced one is ignored. */
	let ticket = 0

	function settle(ok: boolean) {
		const give = answer
		answer = null
		asking = null
		open = false
		give?.(ok)
	}

	function confirmEdit(req: EmbeddingEdit): Promise<boolean> {
		// A second save while one is being priced replaces it.
		if (answer) settle(false)
		const mine = ++ticket
		const target: Target = {
			connectionId: req.connectionId,
			...(req.modelId !== undefined ? { modelId: req.modelId } : {}),
			edit: req.edit
		}
		return new Promise<boolean>((resolve) => {
			answer = resolve
			asking = req
			cost = null
			awaitReply({
				socket,
				event: "vectorization:reindexCost",
				params: { target },
				errorEvent: "vectorization:reindexCost:error",
				match: (msg) => sameTarget(msg.target, target)
			}).then(
				(msg) => {
					if (mine !== ticket) return
					cost = msg
					if (msg.rows > 0) open = true
					else settle(true)
				},
				(err) => {
					if (mine !== ticket) return
					if (isReplyTimeout(err))
						toaster.error({
							title: "Not saved",
							description:
								"The server didn't say whether this change re-embeds your index. Try saving again."
						})
					settle(false)
				}
			)
		})
	}

	return {
		confirmEdit,
		/** The props `EmbeddingSwitchDialog` takes. */
		get dialog() {
			return {
				open,
				cost,
				currentName: asking?.currentName ?? null,
				nextName: asking?.nextName ?? null,
				currentIsLocal: asking?.currentIsLocal ?? false,
				onConfirm: () => settle(true),
				onCancel: () => {
					if (answer) settle(false)
				}
			}
		}
	}
}
