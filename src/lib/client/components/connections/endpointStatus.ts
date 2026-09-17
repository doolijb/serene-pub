/**
 * What the index knows about an endpoint that is RUNNING, as opposed to
 * configured.
 *
 * Three small view models and nothing else. The facts come from three separate
 * event families — the managed KoboldCPP process, the Ollama host, the two
 * local ONNX lanes — and every one of them can be silent: a manager switched
 * off, a host that is down, a server build that does not answer this event yet.
 * So each field is nullable and **null means "not answered"**, never "no" —
 * which is what lets a group render its header and simply omit the status line
 * rather than showing a placeholder that claims something.
 *
 * ⚠ Shapes, not fetches. Who asks for these, and only when the list actually
 * contains an endpoint of that kind, is `ConnectionIndexView`'s business; this
 * module exists so the card can be handed one object per kind instead of a
 * dozen loose props.
 */

/** The managed KoboldCPP subprocess and the files it is working on. */
export interface KcppStatus {
	/** `null` until `koboldcpp:getSubprocessStatus` answers. */
	run: "stopped" | "starting" | "running" | "crashed" | "stopping" | null
	/**
	 * The file names this process has resident — text and image alike, because
	 * "how many are resident" is the manager's decision and not this list's.
	 */
	loadedFiles: string[]
	/** Downloads still in flight, by the filename the row carries. */
	downloads: { filename: string; downloaded: number; total: number }[]
}

/** The Ollama host behind an `ollama` endpoint. */
export interface OllamaStatus {
	/** `null` until `ollama:version` answers either way. */
	reachable: boolean | null
	version: string | null
	/** The model names Ollama currently holds in memory. */
	running: string[]
}

/**
 * One local ONNX lane's residency — embeddings or entities.
 *
 * ⚠ One shape for both, because the two lanes answer the same three questions
 * with different events (`vectorization:status`, `ner:status`). Reconciled
 * HERE, at the seam, rather than by making the card read two payloads (R5).
 */
export interface LaneStatus {
	/** The identity the lane would work under, or null when nothing is active. */
	modelId: string | null
	loaded: boolean
	lastUsedAt: string | null
	/**
	 * Rows waiting on this lane, or `null` when the lane does not count them —
	 * which the entity lane does not. Null omits the clause rather than
	 * printing a zero nobody measured.
	 */
	pending: number | null
}

/** Whole minutes since an ISO timestamp, or null for an absent or future one. */
export function idleMinutes(
	iso: string | null | undefined,
	now: number = Date.now()
): number | null {
	if (!iso) return null
	const then = Date.parse(iso)
	if (!Number.isFinite(then)) return null
	const minutes = Math.floor((now - then) / 60_000)
	return minutes >= 0 ? minutes : null
}
