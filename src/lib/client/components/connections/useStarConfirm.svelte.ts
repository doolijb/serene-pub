/**
 * Ask before a star move throws stored work away — one flow for every screen
 * that can move the embedding or the entity star: the Connections view,
 * Admin → Defaults and the document view.
 *
 * - **The embedding star** is priced by the server first
 *   (`vectorization:reindexCost`): the stored vectors the new model can't use.
 *   Above zero, `EmbeddingSwitchDialog` asks; at zero — the first star, a
 *   re-star of the model the vectors were made by, a second connection naming
 *   the same address and model — the move goes straight through. A price that
 *   cannot be had moves nothing: on a paid service the move it would have
 *   confirmed is a bill.
 * - **The entity star** asks (`EntitySwitchDialog`) when it moves off a starred
 *   pair to another one, with the annotated-row count. An unstar of either
 *   star keeps what is stored and asks nothing.
 *
 * `stage(moves)` takes one screen press — one move, or a "default for all"
 * that stages several; the questions chain (re-embed, then re-scan) before the
 * single `commit(moves)`, which is the screen's own write. A move that changes
 * nothing is dropped before anything is asked. `dropped(moves)` hears every
 * staged press that ends without a commit, so a picker that already shows the
 * new choice can put the old one back.
 */
import { EMBEDDING_CAPABILITY } from "$lib/shared/constants/embeddings"
import { NER_CAPABILITY } from "$lib/shared/constants/ner"
import { useTypedSocket } from "$lib/client/sockets/typedSocket"
import { declareInterest } from "$lib/client/sockets/interest.svelte"
import { awaitReply, isReplyTimeout } from "$lib/client/utils/awaitReply"
import { toaster } from "$lib/client/utils/toaster"

export interface StarMove {
	capability: string
	/** The connection the star moves to; null unstars. */
	connectionId: number | null
	modelId: number | null
}

/** A pair as the dialogs name it. */
export interface StarModel {
	name: string
	/** The model's files are this install's own, so they stay on disk. */
	isLocal: boolean
}

type Defaults = Record<
	string,
	| { connectionId?: number | null; connectionModelId?: number | null }
	| undefined
>

export interface StarConfirmOptions {
	getDefaults: () => Defaults | undefined
	/** A pair, by name, for the dialogs' words; null when not known here. */
	modelOf: (connectionId: number, modelId: number | null) => StarModel | null
	/** Write the moves — the screen's own emit, and whatever it says after. */
	commit: (moves: StarMove[]) => void
	/** A staged press ended without a write. */
	dropped?: (moves: StarMove[]) => void
}

export function useStarConfirm(opts: StarConfirmOptions) {
	const socket = useTypedSocket()

	let staged = $state<StarMove[] | null>(null)
	let embeddingOpen = $state(false)
	let embeddingCost =
		$state<Sockets.Vectorization.ReindexCost.Response | null>(null)
	let entityOpen = $state(false)
	let entityRows = $state<number | null>(null)
	/** Which press is current; a late answer to a replaced one is ignored. */
	let ticket = 0
	let releaseEntityCount: (() => void) | null = null

	const starOf = (capability: string) => opts.getDefaults()?.[capability]
	const unchanged = (move: StarMove) => {
		const now = starOf(move.capability)
		return (
			(now?.connectionId ?? null) === move.connectionId &&
			(now?.connectionModelId ?? null) === move.modelId
		)
	}
	const namedMove = (capability: string) =>
		staged?.find((m) => m.capability === capability) ?? null
	const named = (
		connectionId: number | null | undefined,
		modelId: number | null
	) => (connectionId != null ? opts.modelOf(connectionId, modelId) : null)

	function close() {
		ticket++
		staged = null
		embeddingOpen = false
		entityOpen = false
		releaseEntityCount?.()
		releaseEntityCount = null
	}
	function drop() {
		const moves = staged
		close()
		if (moves?.length) opts.dropped?.(moves)
	}
	function commitNow() {
		const moves = staged ?? []
		close()
		if (moves.length) opts.commit(moves)
	}

	function stage(moves: StarMove[]) {
		if (staged) drop()
		const real = moves.filter((m) => !unchanged(m))
		if (!real.length) return
		staged = real
		priceEmbedding()
	}

	function priceEmbedding() {
		const move = staged?.find(
			(m) =>
				m.capability === EMBEDDING_CAPABILITY &&
				m.connectionId != null &&
				m.modelId != null
		)
		if (!move) return askEntity()
		const mine = ++ticket
		const target = {
			connectionId: move.connectionId!,
			modelId: move.modelId!
		}
		embeddingCost = null
		awaitReply({
			socket,
			event: "vectorization:reindexCost",
			params: { target },
			errorEvent: "vectorization:reindexCost:error",
			match: (msg) =>
				!msg.target?.edit &&
				msg.target?.connectionId === target.connectionId &&
				msg.target?.modelId === target.modelId
		}).then(
			(msg) => {
				if (mine !== ticket) return
				embeddingCost = msg
				if (msg.rows > 0) embeddingOpen = true
				else askEntity()
			},
			(err) => {
				if (mine !== ticket) return
				// A refusal is already on screen (Layout toasts every `:error`);
				// silence is said here, because nothing else will.
				if (isReplyTimeout(err))
					toaster.error({
						title: "Not switched",
						description:
							"The server didn't say what switching would re-embed. Try again."
					})
				drop()
			}
		)
	}

	/** Moving the entity star off one starred pair onto another re-scans. */
	const switchesEntity = () => {
		const move = namedMove(NER_CAPABILITY)
		return (
			!!move &&
			move.connectionId != null &&
			starOf(NER_CAPABILITY)?.connectionId != null
		)
	}

	function askEntity() {
		if (!switchesEntity()) return commitNow()
		const mine = ++ticket
		entityRows = null
		entityOpen = true
		releaseEntityCount = declareInterest<"ner:status">(
			"ner:status",
			(msg) => {
				if (mine === ticket) entityRows = msg.annotatedRows
			}
		)
		socket.emit("ner:status", {})
	}

	return {
		stage,
		/** The moves waiting on an answer, or null. */
		get staged() {
			return staged
		},
		/** The props `EmbeddingSwitchDialog` takes. */
		get embeddingDialog() {
			const now = starOf(EMBEDDING_CAPABILITY)
			const from = named(
				now?.connectionId,
				now?.connectionModelId ?? null
			)
			const move = namedMove(EMBEDDING_CAPABILITY)
			return {
				open: embeddingOpen,
				cost: embeddingCost,
				currentName: from?.name ?? null,
				nextName:
					named(move?.connectionId, move?.modelId ?? null)?.name ??
					null,
				currentIsLocal: from?.isLocal ?? false,
				onConfirm: () => {
					if (!embeddingOpen) return
					embeddingOpen = false
					askEntity()
				},
				// A late close after a confirm does nothing.
				onCancel: () => {
					if (embeddingOpen) drop()
				}
			}
		},
		/** The props `EntitySwitchDialog` takes. */
		get entityDialog() {
			const now = starOf(NER_CAPABILITY)
			const from = named(
				now?.connectionId,
				now?.connectionModelId ?? null
			)
			const move = namedMove(NER_CAPABILITY)
			return {
				open: entityOpen,
				rows: entityRows,
				currentName: from?.name ?? null,
				nextName:
					named(move?.connectionId, move?.modelId ?? null)?.name ??
					null,
				currentIsLocal: from?.isLocal ?? false,
				onConfirm: () => {
					if (!entityOpen) return
					commitNow()
				},
				onCancel: () => {
					if (entityOpen) drop()
				}
			}
		}
	}
}
