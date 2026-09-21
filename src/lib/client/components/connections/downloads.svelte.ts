/**
 * Every file this pub is fetching, in ONE list.
 *
 * Four feeds, four shapes, four screens that each knew about one of them: the
 * KoboldCPP model downloads, the KoboldCPP binary, Ollama's pulls, and the
 * local ONNX cache. The 2026-09-17 concept ruling (R4) puts them behind one
 * Downloads view with a tray at the foot of the index, so the shapes are
 * reconciled HERE, at the seam, and nothing downstream branches on where a
 * download came from (R5).
 *
 * ## The ONNX feed comes off the list, not off a fifth subscription
 *
 * A local ONNX download's progress is already patched into `connections:list`
 * rows by `ConnectionsSidebar` — that is what moves the bar in the two ONNX
 * views. Subscribing again here would be a second copy of the same event
 * arriving a frame apart, so the index hands the rows in with `setOnnx` and
 * this store reads the `local` state they already carry.
 *
 * ## Bytes, never time
 *
 * `percent` is overall BYTES and is `null` the moment any in-flight item has
 * no total — a bar built from three known totals and one unknown is a bar
 * that jumps backwards. Nothing here estimates a finish time (ruling R7).
 */
import { SvelteMap } from "svelte/reactivity"
import { declareInterest } from "$lib/client/sockets/interest.svelte"
import { typedSocketOrNull } from "$lib/client/sockets/typedSocket"

export type DownloadSource =
	| "koboldcpp"
	| "koboldcpp-binary"
	| "ollama"
	| "onnx"

export interface DownloadItem {
	/** Unique across sources: `<source>:<whatever that source keys by>`. */
	id: string
	source: DownloadSource
	/** The connection the file lands on, where one owns it. */
	connectionId?: number
	/** Where it is going, as a person would say it: "KoboldCPP", "Embeddings". */
	destinationLabel: string
	/** The file or model being fetched. */
	name: string
	downloadedBytes?: number
	totalBytes?: number
	/** 0–100 when the feed reports one directly. */
	percent?: number
	state: "in_flight" | "cancelling" | "done" | "failed"
	error?: string
	startedAt?: number
}

/** What the tray and the Downloads view both read off the list. */
export interface DownloadTotals {
	inFlight: number
	/** 0–100 over every in-flight item's bytes, or null when any total is unknown. */
	percent: number | null
	finished: number
	failed: number
}

// ── The four feeds, as pure functions ───────────────────────────────────────

type KcppDownloads = Record<
	string,
	{
		filename: string
		modelName?: string
		status?: string
		downloaded: number
		total: number
		isDone: boolean
	}
>

export function kcppItems(
	downloads: KcppDownloads | undefined
): DownloadItem[] {
	return Object.values(downloads ?? {}).map((d) => ({
		id: `koboldcpp:${d.filename}`,
		source: "koboldcpp" as const,
		destinationLabel: "KoboldCPP",
		name: d.modelName || d.filename,
		downloadedBytes: d.downloaded,
		totalBytes: d.total,
		state: d.isDone
			? d.status === "error"
				? ("failed" as const)
				: ("done" as const)
			: ("in_flight" as const)
	}))
}

export function kcppBinaryItem(
	download:
		| {
				assetName: string
				status: string
				downloaded: number
				total: number
				isDone: boolean
				error?: string
		  }
		| null
		| undefined
): DownloadItem | null {
	if (!download) return null
	return {
		id: "koboldcpp-binary",
		source: "koboldcpp-binary",
		destinationLabel: "KoboldCPP",
		name: download.assetName,
		downloadedBytes: download.downloaded,
		totalBytes: download.total,
		state: download.isDone
			? download.status === "error"
				? "failed"
				: "done"
			: "in_flight",
		error: download.error
	}
}

type OllamaQuants = Record<
	string,
	{
		modelName?: string
		status?: string
		isDone: boolean
		files?: Record<string, { total: number; completed: number }>
	}
>

/**
 * Ollama counts per FILE, several per pull. Summed into one line, because a
 * person pulling `llama3.1:8b` is fetching one thing however many blobs that
 * turns out to be.
 */
export function ollamaItems(quants: OllamaQuants | undefined): DownloadItem[] {
	const out: DownloadItem[] = []
	for (const [key, pull] of Object.entries(quants ?? {})) {
		// The server's map has carried an "undefined" key; it names no pull.
		if (key === "undefined") continue
		const files = Object.values(pull.files ?? {})
		const completed = files.reduce((sum, f) => sum + (f.completed ?? 0), 0)
		const total = files.reduce((sum, f) => sum + (f.total ?? 0), 0)
		out.push({
			id: `ollama:${key}`,
			source: "ollama",
			destinationLabel: "Ollama",
			name: pull.modelName || key,
			downloadedBytes: completed,
			totalBytes: total || undefined,
			state: pull.isDone
				? pull.status === "error"
					? "failed"
					: "done"
				: "in_flight"
		})
	}
	return out
}

/** The fields of a list row this feed reads. */
export interface OnnxRowsConnection {
	id?: number
	name?: string | null
	models: readonly {
		id: number
		name: string
		local?: {
			state?: "not_downloaded" | "downloading" | "on_disk" | "error"
			percent?: number
			downloadedBytes?: number
			totalBytes?: number
			error?: string | null
		}
	}[]
}

export function onnxItems(
	connections: readonly OnnxRowsConnection[]
): DownloadItem[] {
	const out: DownloadItem[] = []
	for (const connection of connections) {
		if (connection.id == null) continue
		for (const model of connection.models) {
			const local = model.local
			if (local?.state !== "downloading" && local?.state !== "error")
				continue
			out.push({
				id: `onnx:${connection.id}:${model.id}`,
				source: "onnx",
				connectionId: connection.id,
				destinationLabel: connection.name || "This machine",
				name: model.name,
				downloadedBytes: local.downloadedBytes,
				totalBytes: local.totalBytes,
				percent: local.percent,
				state: local.state === "error" ? "failed" : "in_flight",
				error: local.error ?? undefined
			})
		}
	}
	return out
}

/**
 * The tray's numbers.
 *
 * `percent` refuses to answer rather than guess: one in-flight item with no
 * total makes the whole bar a lie, and a tray that says 90% for ten minutes
 * is worse than one that shows a count and no bar.
 */
export function aggregate(items: readonly DownloadItem[]): DownloadTotals {
	const inFlight = items.filter(
		(i) => i.state === "in_flight" || i.state === "cancelling"
	)
	let done = 0
	let total = 0
	let known = inFlight.length > 0
	for (const item of inFlight) {
		if (item.totalBytes == null || item.totalBytes <= 0) {
			known = false
			break
		}
		total += item.totalBytes
		done += item.downloadedBytes ?? 0
	}
	return {
		inFlight: inFlight.length,
		percent:
			known && total > 0 ? Math.min(100, (done / total) * 100) : null,
		finished: items.filter((i) => i.state === "done").length,
		failed: items.filter((i) => i.state === "failed").length
	}
}

// ── The store ───────────────────────────────────────────────────────────────

/**
 * One instance, module-scoped, because there is one socket and one set of
 * downloads behind it. Views read it; only `subscribe` writes to the wire.
 */
class DownloadsStore {
	/**
	 * Keyed by feed, so a fresh answer from one source replaces that source's
	 * items wholesale without touching the other three. ⚠ `SvelteMap`, not
	 * `$state(new Map())` — a plain Map's mutations are not reactive.
	 */
	#feeds = new SvelteMap<DownloadSource, DownloadItem[]>()
	/** Ids the person has dismissed from the finished list. */
	#cleared = new SvelteMap<string, true>()
	/**
	 * How many views are listening. Counted because the tray and the Downloads
	 * view are both subscribers and are open together — a release that emptied
	 * the feeds on the first of them to unmount would blank the other one.
	 */
	#subscribers = 0

	get items(): DownloadItem[] {
		const out: DownloadItem[] = []
		for (const feed of this.#feeds.values())
			for (const item of feed)
				if (!this.#cleared.has(item.id)) out.push(item)
		return out
	}
	get totals(): DownloadTotals {
		return aggregate(this.items)
	}
	get inFlight(): number {
		return this.totals.inFlight
	}
	get percent(): number | null {
		return this.totals.percent
	}
	get finished(): DownloadItem[] {
		return this.items.filter((i) => i.state === "done")
	}
	get failed(): DownloadItem[] {
		return this.items.filter((i) => i.state === "failed")
	}

	/** The ONNX feed, handed in from whoever holds `connections:list`. */
	setOnnx(connections: readonly OnnxRowsConnection[]) {
		this.#feeds.set("onnx", onnxItems(connections))
	}

	/**
	 * Listen to the three manager feeds and ask each for its current state.
	 *
	 * ⚠ Interest is declared BEFORE anything is emitted: a request flushes the
	 * pending interest sync, so a declaration made after the emit would miss
	 * the flush its own first reply rides on.
	 *
	 * `koboldcpp:` and `ollama:` are restricted (admin-only) interest, so a
	 * non-admin subscribes to nothing rather than collecting a refusal per key.
	 */
	subscribe(opts: { admin: boolean }): () => void {
		if (!opts.admin) return () => {}
		const socket = typedSocketOrNull()
		this.#subscribers++
		const releases = [
			declareInterest<"koboldcpp:getDownloadProgress">(
				"koboldcpp:getDownloadProgress",
				(msg) => this.#feeds.set("koboldcpp", kcppItems(msg.downloads))
			),
			declareInterest<"koboldcpp:downloadProgress">(
				"koboldcpp:downloadProgress",
				(msg) => this.#feeds.set("koboldcpp", kcppItems(msg.downloads))
			),
			declareInterest<"koboldcpp:getBinaryDownloadProgress">(
				"koboldcpp:getBinaryDownloadProgress",
				(msg) => this.#setBinary(msg.download)
			),
			declareInterest<"koboldcpp:binaryDownloadProgress">(
				"koboldcpp:binaryDownloadProgress",
				(msg) => this.#setBinary(msg.download)
			),
			declareInterest<"ollama:getDownloadProgress">(
				"ollama:getDownloadProgress",
				(msg) =>
					this.#feeds.set(
						"ollama",
						ollamaItems(msg.downloadingQuants)
					)
			),
			declareInterest<"ollama:pullProgress">(
				"ollama:pullProgress",
				(msg) =>
					this.#feeds.set(
						"ollama",
						ollamaItems(msg.downloadingQuants)
					)
			)
		]
		socket?.emit("koboldcpp:getDownloadProgress", {})
		socket?.emit("koboldcpp:getBinaryDownloadProgress", {})
		socket?.emit("ollama:getDownloadProgress", {})
		return () => {
			for (const release of releases) release()
			this.#subscribers = Math.max(0, this.#subscribers - 1)
			// The feeds are dropped with the LAST subscriber: a tray reading
			// minutes-old bytes on its next mount is a tray that lies.
			if (this.#subscribers === 0) {
				this.#feeds.delete("koboldcpp")
				this.#feeds.delete("koboldcpp-binary")
				this.#feeds.delete("ollama")
				this.#cleared.clear()
			}
		}
	}

	#setBinary(download: Parameters<typeof kcppBinaryItem>[0]) {
		const item = kcppBinaryItem(download)
		this.#feeds.set("koboldcpp-binary", item ? [item] : [])
	}

	/**
	 * Stop one download, wherever it is going.
	 *
	 * The item goes to `cancelling` here rather than waiting for the feed to
	 * catch up — a cancel that leaves the bar moving reads as a cancel that
	 * did not work. The feed's next answer replaces it either way.
	 */
	cancel(item: DownloadItem) {
		const socket = typedSocketOrNull()
		if (!socket) return
		switch (item.source) {
			case "koboldcpp":
				socket.emit("koboldcpp:cancelDownload", {
					filename: item.id.slice("koboldcpp:".length)
				})
				break
			case "koboldcpp-binary":
				socket.emit("koboldcpp:cancelBinaryDownload", {})
				break
			case "ollama":
				socket.emit("ollama:cancelPull", {
					modelName: item.id.slice("ollama:".length)
				})
				break
			case "onnx": {
				const [, id, modelId] = item.id.split(":")
				socket.emit("connections:cancelModelDownload", {
					id: Number(id),
					modelId: Number(modelId)
				})
				break
			}
		}
		this.#patch(item.id, { state: "cancelling" })
	}

	/** Forget what has finished — locally, and in the two managers' histories. */
	clearFinished() {
		for (const item of this.items)
			if (item.state === "done" || item.state === "failed")
				this.#cleared.set(item.id, true)
		const socket = typedSocketOrNull()
		socket?.emit("koboldcpp:clearDownloadHistory", {})
		socket?.emit("ollama:clearDownloadHistory", {})
	}

	#patch(id: string, patch: Partial<DownloadItem>) {
		for (const [source, feed] of this.#feeds)
			if (feed.some((i) => i.id === id))
				this.#feeds.set(
					source,
					feed.map((i) => (i.id === id ? { ...i, ...patch } : i))
				)
	}
}

export const downloads = new DownloadsStore()
