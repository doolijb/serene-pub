/**
 * The MODELS on one endpoint, as reactive state — the socket half of the
 * model detail view, without any markup.
 *
 * One consumer: `ModelDetailView`. The index renders models off the connection
 * list (which carries them) rather than fanning out one fetch per card, so this
 * hook serves only the view that edits one row and must see the server's answer
 * to every write.
 *
 * Rules inherited verbatim:
 * - one id in, everything else fetched; never reads or writes the editor
 *   draft, so the unsaved-changes baseline stays clean;
 * - every response REPLACES the list — a sync can restore or mark rows, a
 *   patch can change what a pair may default for, and patching one row
 *   locally would leave the chips a press behind.
 */
import { useTypedSocket } from "$lib/client/sockets/typedSocket"
import { useInterest } from "$lib/client/sockets/interest.svelte"

export type ConnectionModelRow = NonNullable<
	Sockets.Connections.Models.Response["models"]
>[number]

const NO_SYNC: Sockets.Connections.ModelsSync = { at: null, error: null }

export function useConnectionModels(getConnectionId: () => number) {
	const socket = useTypedSocket()

	const connectionId = $derived(getConnectionId())

	let view = $state<Sockets.Connections.Models.Response | null>(null)
	let loading = $state(true)
	let busy = $state(false)
	let notice = $state("")

	const rows = $derived(view?.models ?? [])
	const modelsSync = $derived(view?.modelsSync ?? NO_SYNC)

	function say(message: string) {
		notice = message
		setTimeout(() => (notice = ""), 4000)
	}

	function addManual(model: string, name?: string) {
		const identifier = model.trim()
		if (!identifier) return
		busy = true
		socket.emit("connections:createModel", {
			id: connectionId,
			model: {
				model: identifier,
				...(name?.trim() ? { name: name.trim() } : {})
			}
		})
	}

	function patch(row: ConnectionModelRow, model: Record<string, unknown>) {
		busy = true
		socket.emit("connections:updateModel", {
			id: connectionId,
			modelId: row.id,
			model: model as any
		})
	}

	function remove(row: ConnectionModelRow) {
		busy = true
		socket.emit("connections:deleteModel", {
			id: connectionId,
			modelId: row.id
		})
	}

	/**
	 * The response every model event carries, the sync included.
	 *
	 * `emitToUser` reaches every open tab for this user rather than only the
	 * one that asked — the same guard every other handler in the sidebar
	 * carries.
	 */
	const applyModels = (res: Sockets.Connections.Models.Response) => {
		if (res.connectionId !== connectionId) return
		loading = false
		busy = false
		if (res.error) return
		view = res
	}

	const handleError = () => {
		// The :error events carry an error string and nothing else, so this
		// cannot tell whose failure it was. It stops the spinner and leaves the
		// last answer the server actually gave on screen; Layout's onAny
		// catch-all owns the toast.
		loading = false
		busy = false
	}

	const handleTest = (msg: Sockets.Connections.Test.Response) => {
		// A passing test persists its listing server-side and rewrites the
		// endpoint's capability column that the per-model layer sits over.
		// Re-reading is the whole answer.
		if (msg.connectionId !== connectionId || !msg.ok) return
		socket.emit("connections:models", { id: connectionId })
	}

	// Standing interest, declared ABOVE the effect that fetches. Effects run in
	// creation order, so a declaration made after the emitting effect would miss
	// the interest sync that request flushes and the first listing would arrive
	// with nobody wanting it. Bare keys: none of these events is in
	// SCOPED_EVENTS, and the handlers' own `connectionId` guard narrows them.
	useInterest<"connections:models">("connections:models", applyModels)
	useInterest<"connections:createModel">(
		"connections:createModel",
		applyModels
	)
	useInterest<"connections:updateModel">(
		"connections:updateModel",
		applyModels
	)
	useInterest<"connections:deleteModel">(
		"connections:deleteModel",
		applyModels
	)
	useInterest<"connections:models:error">(
		"connections:models:error",
		handleError
	)
	useInterest<"connections:createModel:error">(
		"connections:createModel:error",
		handleError
	)
	useInterest<"connections:updateModel:error">(
		"connections:updateModel:error",
		handleError
	)
	useInterest<"connections:deleteModel:error">(
		"connections:deleteModel:error",
		handleError
	)
	useInterest<"connections:test">("connections:test", handleTest)

	// Re-fetch when the endpoint changes: the fetch keys off the id, not the
	// mount, so the view survives its id being swapped.
	let lastFetchedId: number | null = null
	$effect(() => {
		const id = connectionId
		if (id === lastFetchedId) return
		lastFetchedId = id
		loading = true
		view = null
		socket.emit("connections:models", { id })
	})

	return {
		get rows() {
			return rows
		},
		/** The endpoint's type, for the management policy. */
		get endpointType() {
			return view?.type
		},
		/** When the endpoint's listing was last reconciled. */
		get modelsSync() {
			return modelsSync
		},
		get loading() {
			return loading
		},
		get busy() {
			return busy
		},
		get notice() {
			return notice
		},
		say,
		addManual,
		patch,
		remove
	}
}

export type ConnectionModelsState = ReturnType<typeof useConnectionModels>
