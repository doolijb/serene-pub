/**
 * ONE local ONNX lane's residency and what switching it would cost — the
 * socket half of the two ONNX detail views, without any markup.
 *
 * ## Why one hook for two lanes
 *
 * The embedding lane and the entity lane answer the same three questions
 * (what is active, is it resident, when was it last used) through different
 * events — `vectorization:status` carries a queue depth and prices a switch on
 * `vectorization:reindexCost`; `ner:status` carries an annotated-row count and
 * prices its own switch in the same payload. Those two vocabularies are
 * reconciled HERE, at the seam, and never merged (R5): the views read one
 * `LaneSnapshot` and never branch on which family answered.
 *
 * ## Admin only, both of them
 *
 * `ner:` is restricted interest, and every one of these four handlers is
 * `requireAdmin` server-side — `vectorization:status` and
 * `vectorization:reindexCost` included, even though `vectorization:` is not a
 * restricted PREFIX. So nothing is asked for at all unless the user is known
 * to be an admin: the reply would be an error either way, and asking keeps a
 * refusal in the console and a toast on the screen for the many non-admins who
 * open this panel to read.
 *
 * ⚠ Null is "not answered", never "no". A view renders its status line only
 * when `status` is non-null, rather than showing a zero nobody measured.
 */
import { useTypedSocket } from "$lib/client/sockets/typedSocket"
import { declareInterest } from "$lib/client/sockets/interest.svelte"

/** The two `connections.modality` values that have a lane behind them (§10). */
export type LaneModality = "embeddings" | "ner"

/** One lane's residency, in one shape for both families. */
export interface LaneSnapshot {
	/** A capability default names a pair for this lane. */
	starred: boolean
	/** The identity the lane works under, or null. */
	modelId: string | null
	loaded: boolean
	loadError: string | null
	lastUsedAt: string | null
	/** Minutes idle before the lane unloads, or null where none was sent. */
	ttlMinutes: number | null
	/** Rows waiting on the lane, or null where the lane counts none. */
	pending: number | null
	/** Rows already annotated (entities only), or null. */
	annotatedRows: number | null
}

/**
 * What switching this lane's active model throws away.
 *
 * ⚠ Rows, and the two containers they belong to. No rate and no estimate:
 * neither lane measures throughput, so there is no honest time to put beside
 * this and the views must not invent one.
 */
export interface LaneCost {
	rows: number
	lorebooks?: number
	sessions?: number
}

function fromVectorization(
	msg: Sockets.Vectorization.Status.Response
): LaneSnapshot {
	return {
		starred: msg.starred,
		modelId: msg.modelId,
		loaded: msg.loaded,
		loadError: msg.loadError,
		lastUsedAt: msg.lastUsedAt,
		ttlMinutes: msg.ttlMinutes ?? null,
		pending: msg.pending ?? null,
		annotatedRows: null
	}
}

function fromNer(msg: Sockets.Ner.Status.Response): LaneSnapshot {
	return {
		starred: msg.starred,
		modelId: msg.modelId,
		// `modelReady` is the lane's own word for "loaded and usable"; `loaded`
		// arrived later and is the one both families now speak.
		loaded: msg.loaded ?? msg.modelReady,
		loadError: msg.loadError,
		lastUsedAt: msg.lastUsedAt ?? null,
		ttlMinutes: msg.ttlMinutes ?? null,
		// The entity lane counts no queue. Null omits the clause rather than
		// printing a zero nobody measured.
		pending: null,
		annotatedRows: msg.annotatedRows
	}
}

export function useLaneStatus(
	getModality: () => LaneModality | null,
	/** Every handler behind this is `requireAdmin`. */
	getIsAdmin: () => boolean
) {
	const socket = useTypedSocket()

	const modality = $derived(getModality())
	const isAdmin = $derived(getIsAdmin())

	let status = $state<LaneSnapshot | null>(null)
	let cost = $state<LaneCost | null>(null)

	const applyVectorization = (msg: Sockets.Vectorization.Status.Response) => {
		status = fromVectorization(msg)
	}
	const applyNer = (msg: Sockets.Ner.Status.Response) => {
		status = fromNer(msg)
		// The entity lane prices its own switch in the same payload — there is
		// no second event to ask.
		cost = { rows: msg.annotatedRows }
	}
	const applyCost = (msg: Sockets.Vectorization.ReindexCost.Response) => {
		cost = {
			rows: msg.rows,
			...(msg.lorebooks != null ? { lorebooks: msg.lorebooks } : {}),
			...(msg.sessions != null ? { sessions: msg.sessions } : {})
		}
	}

	function askStatus() {
		if (!isAdmin) return
		if (modality === "embeddings") socket.emit("vectorization:status", {})
		else if (modality === "ner") socket.emit("ner:status", {})
	}
	function askCost() {
		// Only the embedding lane has a second event; the entity lane's count
		// rides on its status.
		if (isAdmin && modality === "embeddings")
			socket.emit("vectorization:reindexCost", {})
	}
	function refresh() {
		askStatus()
		askCost()
	}

	/**
	 * A download that has SETTLED may have changed what is on disk under the
	 * active model, so the lane is re-asked — but not on every frame of the
	 * bar, which would be one status query per progress packet.
	 */
	const handleDownloadSettled = (
		msg: Sockets.Connections.DownloadModel.Response
	) => {
		if (msg.local?.state === "downloading") return
		refresh()
	}

	// Every key this hook holds, declared ABOVE the effect that asks: effects
	// run in creation order and a request flushes the pending interest sync, so
	// a declaration made below would miss the flush its own first reply rides
	// on. Declared in an effect rather than through `useInterest` because the
	// key set MOVES with the modality — `useInterest` reads its key once.
	$effect(() => {
		if (modality !== "embeddings" || !isAdmin) return
		const releases = [
			declareInterest<"vectorization:status">(
				"vectorization:status",
				applyVectorization
			),
			declareInterest<"vectorization:unloadModel">(
				"vectorization:unloadModel",
				applyVectorization
			),
			declareInterest<"vectorization:reindexCost">(
				"vectorization:reindexCost",
				applyCost
			),
			// `loadModel` answers `{success}` and no status at all, so the lane
			// is re-asked rather than patched from it.
			declareInterest<"vectorization:loadModel">(
				"vectorization:loadModel",
				askStatus
			)
		]
		return () => releases.forEach((release) => release())
	})
	$effect(() => {
		if (modality !== "ner" || !isAdmin) return
		const releases = [
			declareInterest<"ner:status">("ner:status", applyNer),
			declareInterest<"ner:unloadModel">("ner:unloadModel", applyNer)
		]
		return () => releases.forEach((release) => release())
	})
	// The three things that move a lane from outside it: the star, the settings
	// push that carries the defaults, and a download finishing.
	$effect(() => {
		if (!modality || !isAdmin) return
		const releases = [
			declareInterest<"connections:setDefault">(
				"connections:setDefault",
				refresh
			),
			declareInterest<"systemSettings:get">(
				"systemSettings:get",
				refresh
			),
			declareInterest<"connections:modelDownloadProgress">(
				"connections:modelDownloadProgress",
				handleDownloadSettled
			)
		]
		return () => releases.forEach((release) => release())
	})

	// The ask. Keyed off the modality rather than the mount, so a view whose
	// endpoint is swapped under it asks again for the right lane.
	let lastAsked: LaneModality | null = null
	$effect(() => {
		if (!modality || !isAdmin) {
			lastAsked = null
			return
		}
		if (modality === lastAsked) return
		lastAsked = modality
		status = null
		cost = null
		refresh()
	})

	return {
		get status() {
			return status
		},
		get cost() {
			return cost
		},
		refresh
	}
}

export type LaneStatusState = ReturnType<typeof useLaneStatus>
