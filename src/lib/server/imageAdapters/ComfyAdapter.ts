/**
 * ComfyUI — a graph backend this pub TALKS TO and never runs
 * (DESIGN-image-generation §4.5, §4.9, §4.10, §4.11).
 *
 *   GET  /system_stats        — version, device, VRAM (the test)
 *   GET  /object_info         — node classes + every loader's accepted names
 *   POST /upload/image        — references, by content-addressed filename
 *   POST /prompt              — the rendered graph, `{ prompt, client_id }`
 *   WS   /ws?clientId=        — `progress` / `executing` / `executed`, binary previews
 *   GET  /history/{id}        — outputs, when the socket missed them
 *   GET  /view                — each output picture's bytes
 *   POST /interrupt           — cancel
 *
 * Nothing else: never ComfyUI-Manager's install or download routes, never
 * `/userdata` writes. What the server lacks is reported (*Missing nodes: …*)
 * and fixed by the person, in ComfyUI.
 *
 * ## The workflow is not ours to choose here
 *
 * A Comfy pair draws with a **workflow** — a `workflows` row the host resolves
 * from the oracle's `workflow` slot and hands over as `ImageGenOptions.workflow`.
 * Its holes are filled by core's Handlebars (`imageGen/comfy/render.ts`), and
 * the drawing sheet is DERIVED from what it reads (`sheetForWorkflow`), so the
 * receipt's `ignored` list is honest per graph. The sheet says
 * `payload: "template"`, which is what makes the bind guard require a workflow.
 *
 * ## Series
 *
 * `packKeyedGraph` packs a whole series into one queue call per `seriesMax`
 * items; `generateImage` with `opts.series` renders the graph once per item,
 * prefixes ids by key and merges (`imageGen/comfy/merge.ts`). Each picture
 * comes back with the key of the marked output node that drew it.
 */
import { createHash, randomUUID } from "node:crypto"
import {
	BaseImageAdapter,
	Translation,
	type DrawingSheet,
	type GeneratedMediaItem,
	type ImageAdapterExports,
	type ImageGenOptions,
	type ImageGenRequest,
	type ImageGenResult
} from "./BaseImageAdapter"
import type { ImageEditRequest } from "$lib/server/adapters/actions"
import type { SettingsSchema } from "@serene-pub/sdk"
import type { MediaRef } from "@serene-pub/sdk"
import type {
	ImageGenProgress,
	ImageSeriesCallItem,
	ImageWorkflowDocument
} from "$lib/shared/imageGen/types"
import type { PlannedImageCall, RenderedSeriesItem } from "$lib/server/imageGen/packing"
import { PREVIEW_CLASSES, type ComfyGraph } from "$lib/server/imageGen/comfy/graph"
import {
	defaultScope,
	deriveComfySheet,
	mergeScope,
	readsOf,
	referencesRead,
	renderWorkflow,
	SERIES_MAX_DEFAULT
} from "$lib/server/imageGen/comfy/render"
import {
	chunkSeries,
	keyOfNodeId,
	localIdOf,
	mergeKeyedRenders
} from "$lib/server/imageGen/comfy/merge"
import {
	modelNamesOf,
	summariseObjectInfo,
	MODEL_LOADER_INPUTS,
	type ObjectInfoSummary
} from "$lib/server/imageGen/comfy/objectInfo"

export const COMFY_DEFAULT_URL = "http://localhost:8188"

/** How often the history is asked when the socket cannot be used. */
const HISTORY_POLL_MS = 1000

const PROFILE_SCHEMA: SettingsSchema = {
	authHeader: {
		type: "string",
		label: "Auth header",
		description:
			"Only for a ComfyUI behind a proxy that asks for one: the header name the API key is sent in. Leave it as Authorization for a Bearer token.",
		default: "Authorization"
	},
	seriesMax: {
		type: "number",
		label: "Pictures per call",
		description:
			"How many pictures of a series one queue call may draw. More is faster on a GPU with room to spare; fewer if ComfyUI runs out of memory.",
		default: SERIES_MAX_DEFAULT,
		min: 1,
		max: 64
	}
	// Later (§4.5 "Not done"): `comfyUser` — a multi-user ComfyUI puts a
	// `comfy-user` header on every call. One profile key when it is built.
} as SettingsSchema

const PROFILE_DEFAULTS = {
	authHeader: "Authorization",
	seriesMax: SERIES_MAX_DEFAULT
}

/**
 * The sheet before a workflow is chosen: a template payload with nothing
 * honoured yet. The real one comes from `sheetForWorkflow`.
 */
export const COMFY_SHEET: DrawingSheet = {
	negative: false,
	seed: false,
	steps: false,
	cfg: false,
	sampler: false,
	clipSkip: false,
	size: { kind: "enum", sizes: [] },
	references: null,
	init: false,
	mask: false,
	transparent: "none",
	perCall: SERIES_MAX_DEFAULT,
	outputs: { perRun: 1, keyed: true },
	progress: true,
	preview: true,
	cancel: true,
	video: false,
	payload: "template"
}

/** `seriesMax` off a connection's profile: a whole number ≥ 1, else the default. */
export function seriesMaxOf(connection: { extraJson?: unknown } | null | undefined): number {
	const raw = (connection?.extraJson as any)?.profile?.seriesMax
	const n = typeof raw === "number" ? raw : Number(raw)
	return Number.isFinite(n) && n >= 1 ? Math.min(64, Math.floor(n)) : SERIES_MAX_DEFAULT
}

function comfySheetFor(connection: { type: string; extraJson?: unknown }): DrawingSheet {
	return { ...COMFY_SHEET, perCall: seriesMaxOf(connection) }
}

async function sheetForWorkflow(
	connection: { type: string; extraJson?: unknown },
	workflow: Pick<ImageWorkflowDocument, "document" | "variables" | "outputNode">
): Promise<DrawingSheet> {
	return deriveComfySheet(workflow, seriesMaxOf(connection))
}

/**
 * Rule 1 of the packing (§4.7): a series of distinct keys draws as keyed
 * graphs, `seriesMax` items per call. One item, or keys repeated (the copies
 * of one prompt a `batch` asks for), is not a series — the host batches or
 * loops it instead.
 */
function packKeyedGraph(
	items: readonly RenderedSeriesItem[],
	sheet: DrawingSheet
): PlannedImageCall[] | null {
	if (sheet.payload !== "template" || !sheet.outputs.keyed) return null
	if (items.length < 2) return null
	if (new Set(items.map((i) => i.key)).size !== items.length) return null
	return chunkSeries(items, sheet.perCall).map((chunk, index) => ({
		index,
		keys: chunk.map((i) => i.key),
		count: chunk.length
	}))
}

// ── Transport helpers ───────────────────────────────────────────────────────

/** The connection's auth header, when it has a key. */
function authHeaders(connection: { extraJson?: unknown }): Record<string, string> {
	const extra = (connection.extraJson ?? {}) as Record<string, any>
	const key = typeof extra.apiKey === "string" ? extra.apiKey.trim() : ""
	if (!key) return {}
	const name =
		typeof extra.profile?.authHeader === "string" && extra.profile.authHeader.trim()
			? extra.profile.authHeader.trim()
			: "Authorization"
	const value =
		name.toLowerCase() === "authorization" && !/\s/.test(key) ? `Bearer ${key}` : key
	return { [name]: value }
}

function rootOf(connection: { baseUrl?: string | null }): string {
	return (connection.baseUrl || COMFY_DEFAULT_URL).trim().replace(/\/+$/, "")
}

/** A minimal socket — what the global `WebSocket` offers, and what a test fakes. */
export interface ComfySocket {
	binaryType?: string
	addEventListener(type: string, listener: (ev: any) => void): void
	close(): void
}
type SocketFactory = (url: string, headers: Record<string, string>) => ComfySocket

let socketFactory: SocketFactory = (url, headers) => {
	const WS = (globalThis as any).WebSocket
	if (!WS) throw new Error("WebSocket is not available in this runtime")
	// Undici's WebSocket takes headers in its init; a browser-shaped one ignores them.
	return Object.keys(headers).length ? new WS(url, { headers }) : new WS(url)
}

/** Tests only: replace how the progress socket is opened. */
export function __setComfySocketFactory(f: SocketFactory | null) {
	socketFactory =
		f ??
		((url, headers) => {
			const WS = (globalThis as any).WebSocket
			return Object.keys(headers).length ? new WS(url, { headers }) : new WS(url)
		})
}

/** ComfyUI's `POST /prompt` refusal, verbatim (node id, class, message, details). */
export function describePromptRefusal(status: number, body: unknown): string {
	const b = (body ?? {}) as {
		error?: { message?: string; details?: string } | string
		node_errors?: Record<
			string,
			{ class_type?: string; errors?: Array<{ message?: string; details?: string }> }
		>
	}
	const parts: string[] = []
	const head =
		typeof b.error === "string" ? b.error : (b.error?.message ?? `HTTP ${status}`)
	const headDetails = typeof b.error === "object" ? b.error?.details : undefined
	parts.push(`ComfyUI refused the workflow: ${head}${headDetails ? ` (${clip(headDetails)})` : ""}.`)
	for (const [id, ne] of Object.entries(b.node_errors ?? {}))
		for (const err of ne.errors ?? [])
			parts.push(
				`Node ${id} (${ne.class_type ?? "?"}): ${err.message ?? "error"}${err.details ? `: ${clip(err.details)}` : ""}`
			)
	return parts.join(" ")
}

/** ComfyUI's `execution_error`, verbatim. */
export function describeExecutionError(data: Record<string, unknown>): string {
	const node = data.node_id ?? "?"
	const type = data.node_type ?? "?"
	const kind = data.exception_type ? `${data.exception_type}: ` : ""
	return `ComfyUI stopped at node ${node} (${type}): ${kind}${clip(String(data.exception_message ?? "unknown error"))}`
}

const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s)

const EXT_BY_MIME: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif"
}
const MIME_BY_EXT: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	mp4: "video/mp4",
	webm: "video/webm"
}

interface OutputFile {
	filename: string
	subfolder?: string
	type?: string
}

class ComfyAdapter extends BaseImageAdapter {
	/** The prompt id in flight, so a cancel interrupts ours and nobody else's. */
	private promptId: string | null = null

	async editImage(req: ImageEditRequest, opts: ImageGenOptions = {}): Promise<ImageGenResult> {
		const { init, mask, prompt, ...rest } = req
		return this.generateImage(
			{ ...rest, prompt: prompt ?? "", ...(init[0] ? { init: init[0] } : {}), ...(mask ? { mask } : {}) },
			opts
		)
	}

	async generateImage(req: ImageGenRequest, opts: ImageGenOptions = {}): Promise<ImageGenResult> {
		const workflow = opts.workflow
		if (!workflow)
			throw new Error(
				"Choose a workflow for this step — a ComfyUI connection draws with a ComfyUI workflow."
			)
		const signal = this.linkAbort(opts.signal)
		if (signal.aborted) return { media: [], isAborted: true, applied: [], ignored: [] }

		const t = new Translation()
		const reads = readsOf(workflow.document)
		const root = rootOf(this.connection)
		const headers = authHeaders(this.connection)
		const clientId = randomUUID()
		const runId = opts.runId ?? clientId

		// ── Files first: the document names them by server filename ───────────
		const refCap = referencesRead(workflow.document)
		let references: Array<{ filename: string }> = []
		if (req.references?.length) {
			if (!refCap) t.ignore("references")
			else {
				const take = req.references.slice(0, refCap)
				references = await this.uploadAll(root, headers, take, "references", t, opts, signal)
				if (take.length < req.references.length) t.ignore("references")
			}
		}
		const [init] =
			req.init && reads.has("init")
				? await this.uploadAll(root, headers, [req.init], "init", t, opts, signal)
				: []
		if (req.init && !reads.has("init")) t.ignore("init")
		const [mask] =
			req.mask && reads.has("mask")
				? await this.uploadAll(root, headers, [req.mask], "mask", t, opts, signal)
				: []
		if (req.mask && !reads.has("mask")) t.ignore("mask")

		// ── The scope (§4.5): what the request set, where the document reads it ─
		const fixedSeed =
			typeof req.seed === "number" && Number.isFinite(req.seed) && req.seed >= 0
				? req.seed
				: undefined
		const std: Record<string, unknown> = {}
		const knob = (reqKey: string, name: string, value: unknown) => {
			if (value === undefined || value === null || value === "") return
			if (reads.has(name)) std[name] = t.apply(reqKey, value)
			else t.ignore(reqKey)
		}
		std.prompt = t.apply("prompt", req.prompt)
		if (!reads.has("prompt")) t.ignore("prompt")
		knob("negativePrompt", "negative", req.negativePrompt)
		knob("steps", "steps", req.steps)
		knob("cfg", "cfg", req.cfg)
		knob("width", "width", req.width)
		knob("height", "height", req.height)
		knob("sampler", "sampler", req.sampler)
		knob("scheduler", "scheduler", req.scheduler)
		knob("clipSkip", "clipSkip", req.clipSkip)
		knob("denoise", "denoise", req.denoise)
		// The checkpoint is the pair's model, sent only where the workflow reads
		// `{{model}}`; a graph that bakes its own reports it ignored (§4.9).
		knob("model", "model", req.model ?? (this.connection as any).model ?? undefined)
		if (req.transparent) knob("transparent", "transparent", true)
		if (req.seed !== undefined) {
			if (reads.has("seed")) t.apply("seed", req.seed)
			else t.ignore("seed")
		}
		if (req.aspect && !req.width && !req.height) t.ignore("aspect")
		t.take("video", req.video, false)
		if (req.outputFormat) t.take("outputFormat", req.outputFormat, req.outputFormat === "png")

		const base = mergeScope(defaultScope(workflow.variables), {
			// 🚧 The workflow's dial values (its defaults, a loadout's
			// overrides over them), by name; the request's own fields below
			// win over a same-named value.
			...(req.workflowValues ?? {}),
			...std,
			negative: std.negative ?? defaultScope(workflow.variables).negative ?? "",
			transparent: !!req.transparent,
			clientId,
			runId,
			...(references.length ? { references } : {}),
			...(init ? { init } : {}),
			...(mask ? { mask } : {})
		})
		const newSeed = () => fixedSeed ?? Math.floor(Math.random() * 2 ** 32)

		// ── Render: one item, or a keyed merge of several ─────────────────────
		const series: ImageSeriesCallItem[] | undefined =
			opts.series && opts.series.length > 1 ? opts.series : undefined
		let prompt: ComfyGraph
		let outputs: Record<string, string> = {}
		if (series) {
			if (req.batch && req.batch > series.length) t.ignore("batch")
			const renders = []
			for (const item of series)
				renders.push({
					key: item.key,
					graph: await renderWorkflow(
						workflow.document,
						mergeScope(base, {
							...(item.vars ?? {}),
							prompt: item.prompt,
							negative: item.negative ?? base.negative ?? "",
							key: item.key,
							count: 1,
							seed: newSeed()
						})
					)
				})
			const merged = mergeKeyedRenders(renders, workflow.outputNode)
			prompt = merged.prompt
			outputs = merged.outputs
		} else {
			const count = Math.max(1, Math.floor(req.batch ?? 1))
			if (count > 1 && !reads.has("count")) t.ignore("batch")
			else if (count > 1) t.apply("batch", count)
			prompt = await renderWorkflow(
				workflow.document,
				mergeScope(base, { key: "1", count, seed: newSeed() })
			)
		}

		// ── Submit, and follow it ────────────────────────────────────────────
		opts.onProgress?.({ stage: "queued", percent: 0 })
		const watcher = this.watch(root, headers, clientId, prompt, signal, opts.onProgress)
		let promptId: string
		try {
			const res = await fetch(`${root}/prompt`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ prompt, client_id: clientId }),
				signal
			})
			const body = await res.json().catch(() => ({}))
			if (!res.ok || !(body as any)?.prompt_id) {
				watcher.close()
				throw new Error(describePromptRefusal(res.status, body))
			}
			promptId = String((body as any).prompt_id)
		} catch (e) {
			watcher.close()
			if (signal.aborted)
				return { media: [], isAborted: true, applied: t.applied, ignored: t.ignored }
			throw e
		}
		this.promptId = promptId

		let collected: Map<string, OutputFile[]>
		try {
			collected = await watcher.until(promptId)
		} catch (e) {
			if (signal.aborted) {
				await this.interrupt(root, headers)
				return { media: [], isAborted: true, applied: t.applied, ignored: t.ignored }
			}
			throw e
		} finally {
			watcher.close()
			this.promptId = null
		}
		if (signal.aborted)
			return { media: [], isAborted: true, applied: t.applied, ignored: t.ignored }

		// The socket missed them (or never opened): the history has them by node.
		if (!collected.size) collected = await this.historyOutputs(root, headers, promptId)

		// ── Outputs, keyed by node ───────────────────────────────────────────
		const markedByKey = new Map(Object.entries(outputs).map(([k, id]) => [id, k]))
		const single = workflow.outputNode
		const media: GeneratedMediaItem[] = []
		const ordered = [...collected.entries()].sort(([a], [b]) => {
			const ra = markedByKey.has(a) || a === single ? 0 : 1
			const rb = markedByKey.has(b) || b === single ? 0 : 1
			return ra - rb
		})
		for (const [nodeId, files] of ordered) {
			const node = prompt[nodeId]
			if (node && PREVIEW_CLASSES.has(node.class_type)) continue
			let key: string | null | undefined
			if (series) key = markedByKey.get(nodeId) ?? (localIdOf(nodeId) === single ? keyOfNodeId(nodeId) : null)
			else key = !single || nodeId === single ? undefined : null
			for (const f of files) {
				if (f.type === "temp") continue
				const picture = await this.view(root, headers, f, signal)
				media.push({
					kind: picture.mime.startsWith("video/") ? "video" : "image",
					mime: picture.mime,
					base64: picture.base64,
					...(key !== undefined ? { key } : {}),
					meta: {
						backend: "comfyui",
						promptId,
						node: nodeId,
						workflowId: workflow.id,
						workflowName: workflow.name
					}
				})
			}
		}
		if (!media.length)
			throw new Error(
				"ComfyUI finished without saving a picture. Check that the workflow's output node is a SaveImage."
			)
		opts.onProgress?.({ stage: "saving", percent: 100 })
		return { media, isAborted: false, applied: t.applied, ignored: t.ignored }
	}

	// ── Uploads ───────────────────────────────────────────────────────────────

	/**
	 * Upload each file under a content-addressed name, skipping one the server
	 * already holds (`GET /view` answers it). Returns `{ filename }` in order;
	 * a file that cannot be read reports `key` ignored and uploads nothing.
	 */
	private async uploadAll(
		root: string,
		headers: Record<string, string>,
		refs: readonly MediaRef[],
		key: string,
		t: Translation,
		opts: ImageGenOptions,
		signal: AbortSignal
	): Promise<Array<{ filename: string }>> {
		if (!opts.loadMedia) {
			t.ignore(key)
			return []
		}
		const out: Array<{ filename: string }> = []
		for (const ref of refs) {
			let file: { bytes: Uint8Array; mime: string }
			try {
				file = await opts.loadMedia(ref)
			} catch {
				t.ignore(key)
				return []
			}
			const hash = createHash("sha256").update(file.bytes).digest("hex").slice(0, 24)
			const filename = `serene-${hash}.${EXT_BY_MIME[file.mime] ?? "png"}`
			const have = await fetch(
				`${root}/view?${new URLSearchParams({ filename, type: "input", subfolder: "" })}`,
				{ headers, signal }
			)
				.then((r) => r.ok)
				.catch(() => false)
			if (!have) {
				const form = new FormData()
				form.append("image", new Blob([file.bytes as BlobPart], { type: file.mime }), filename)
				form.append("type", "input")
				form.append("overwrite", "true")
				const res = await fetch(`${root}/upload/image`, {
					method: "POST",
					headers,
					body: form,
					signal
				})
				if (!res.ok) {
					const text = await res.text().catch(() => "")
					throw new Error(`ComfyUI would not take an uploaded picture (${res.status}): ${clip(text, 200)}`)
				}
				const body = (await res.json().catch(() => ({}))) as { name?: string; subfolder?: string }
				out.push({ filename: body.subfolder ? `${body.subfolder}/${body.name}` : (body.name ?? filename) })
			} else out.push({ filename })
		}
		t.apply(key, true)
		return out
	}

	// ── Following a prompt ───────────────────────────────────────────────────

	/**
	 * Open the progress socket BEFORE submitting, so no event is missed. The
	 * returned `until(promptId)` resolves with the outputs per node once the
	 * prompt has finished, rejects with ComfyUI's own error, and falls back
	 * to polling the history when the socket cannot be used.
	 */
	private watch(
		root: string,
		headers: Record<string, string>,
		clientId: string,
		prompt: ComfyGraph,
		signal: AbortSignal,
		onProgress?: (p: ImageGenProgress) => void
	) {
		const outputs = new Map<string, OutputFile[]>()
		let promptId: string | null = null
		let settle: { resolve: () => void; reject: (e: Error) => void } | null = null
		let finished: { error?: Error; interrupted?: boolean } | null = null
		const finish = (f: { error?: Error; interrupted?: boolean }) => {
			if (finished) return
			finished = f
			if (settle) f.error ? settle.reject(f.error) : settle.resolve()
		}
		const ours = (data: any) => !promptId || !data?.prompt_id || data.prompt_id === promptId

		let lastPercent = 0
		/** Prompts this socket saw finish — one may finish before its id is known. */
		const done = new Set<string>()
		let socket: ComfySocket | null = null
		let socketOk = false
		try {
			socket = socketFactory(
				`${root.replace(/^http/, "ws")}/ws?clientId=${encodeURIComponent(clientId)}`,
				headers
			)
			socket.binaryType = "arraybuffer"
			socket.addEventListener("open", () => {
				socketOk = true
			})
			socket.addEventListener("error", () => {
				socketOk = false
			})
			socket.addEventListener("message", (ev: { data: unknown }) => {
				if (typeof ev.data !== "string") {
					const frame = previewFrame(ev.data)
					if (frame && onProgress)
						onProgress({ stage: "sampling", percent: lastPercent, preview: frame })
					return
				}
				let msg: { type?: string; data?: any }
				try {
					msg = JSON.parse(ev.data)
				} catch {
					return
				}
				const data = msg.data ?? {}
				if (!ours(data)) return
				switch (msg.type) {
					case "progress": {
						const max = Number(data.max) || 0
						const value = Number(data.value) || 0
						lastPercent = max ? Math.min(100, (value / max) * 100) : lastPercent
						onProgress?.({
							stage: "sampling",
							percent: lastPercent,
							step: value,
							steps: max
						})
						return
					}
					case "executing": {
						if (data.node === null || data.node === undefined) {
							if (data.prompt_id) done.add(String(data.prompt_id))
							if (promptId && data.prompt_id === promptId) finish({})
							return
						}
						const cls = prompt[String(data.node)]?.class_type ?? ""
						onProgress?.({
							stage: /Loader/.test(cls)
								? "loading"
								: /VAEDecode/.test(cls)
									? "decoding"
									: /Encode/.test(cls)
										? "conditioning"
										: /Save/.test(cls)
											? "saving"
											: "sampling",
							percent: lastPercent,
							message: cls
						})
						return
					}
					case "executed": {
						const images = data.output?.images
						if (Array.isArray(images) && data.node != null)
							outputs.set(String(data.node), [
								...(outputs.get(String(data.node)) ?? []),
								...images
							])
						return
					}
					case "execution_success":
						if (data.prompt_id) done.add(String(data.prompt_id))
						if (promptId && data.prompt_id === promptId) finish({})
						return
					case "execution_error":
						finish({ error: new Error(describeExecutionError(data)) })
						return
					case "execution_interrupted":
						finish({ interrupted: true, error: new Error("ComfyUI interrupted the run.") })
						return
				}
			})
		} catch {
			socket = null
		}

		const poll = async () => {
			// The safety net: the history says when it is done, socket or not.
			while (!finished && !signal.aborted) {
				await sleep(socketOk ? HISTORY_POLL_MS * 5 : HISTORY_POLL_MS, signal)
				if (finished || signal.aborted || !promptId) continue
				try {
					const res = await fetch(`${root}/history/${encodeURIComponent(promptId)}`, {
						headers
					})
					if (!res.ok) continue
					const body = (await res.json()) as Record<string, any>
					const entry = body?.[promptId]
					if (!entry) continue
					const status = entry.status ?? {}
					if (status.status_str === "error") {
						const msg = (status.messages ?? []).find(
							(m: any) => Array.isArray(m) && m[0] === "execution_error"
						)
						finish({
							error: new Error(
								msg ? describeExecutionError(msg[1] ?? {}) : "ComfyUI reported an error."
							)
						})
					} else if (status.completed !== false) finish({})
				} catch {
					// The next tick asks again.
				}
			}
		}

		return {
			close: () => {
				try {
					socket?.close()
				} catch {
					// already closed
				}
			},
			until: (id: string): Promise<Map<string, OutputFile[]>> => {
				promptId = id
				if (done.has(id)) finish({})
				return new Promise<Map<string, OutputFile[]>>((resolve, reject) => {
					const onAbort = () => reject(new Error("aborted"))
					signal.addEventListener("abort", onAbort, { once: true })
					settle = {
						resolve: () => {
							signal.removeEventListener("abort", onAbort)
							resolve(outputs)
						},
						reject: (e) => {
							signal.removeEventListener("abort", onAbort)
							reject(e)
						}
					}
					if (finished) {
						const f = finished as { error?: Error }
						f.error ? settle.reject(f.error) : settle.resolve()
					}
					void poll()
				})
			}
		}
	}

	private async historyOutputs(
		root: string,
		headers: Record<string, string>,
		promptId: string
	): Promise<Map<string, OutputFile[]>> {
		const out = new Map<string, OutputFile[]>()
		try {
			const res = await fetch(`${root}/history/${encodeURIComponent(promptId)}`, { headers })
			if (!res.ok) return out
			const body = (await res.json()) as Record<string, any>
			const outputs = body?.[promptId]?.outputs ?? {}
			for (const [node, o] of Object.entries(outputs as Record<string, any>))
				if (Array.isArray(o?.images)) out.set(node, o.images)
		} catch {
			// Nothing came back: the caller says so.
		}
		return out
	}

	private async view(
		root: string,
		headers: Record<string, string>,
		f: OutputFile,
		signal: AbortSignal
	): Promise<{ base64: string; mime: string }> {
		const q = new URLSearchParams({
			filename: f.filename,
			subfolder: f.subfolder ?? "",
			type: f.type ?? "output"
		})
		const res = await fetch(`${root}/view?${q}`, { headers, signal })
		if (!res.ok) throw new Error(`ComfyUI would not hand over ${f.filename} (${res.status}).`)
		const bytes = Buffer.from(await res.arrayBuffer())
		const ext = f.filename.split(".").pop()?.toLowerCase() ?? "png"
		const mime =
			res.headers.get("content-type")?.split(";")[0]?.trim() || MIME_BY_EXT[ext] || "image/png"
		return { base64: bytes.toString("base64"), mime: mime.startsWith("image/") || mime.startsWith("video/") ? mime : (MIME_BY_EXT[ext] ?? "image/png") }
	}

	/** Stop OUR prompt. Newer servers take the id; older ones stop what is running. */
	private async interrupt(root: string, headers: Record<string, string>) {
		try {
			await fetch(`${root}/interrupt`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify(this.promptId ? { prompt_id: this.promptId } : {})
			})
		} catch {
			// The caller has already stopped waiting.
		}
	}
}

/** A binary preview frame: 4 bytes event (1 = preview), 4 bytes format (1 JPEG, 2 PNG), the image. */
function previewFrame(data: unknown): { base64: string; mime: string } | null {
	let buf: Buffer
	if (data instanceof ArrayBuffer) buf = Buffer.from(data)
	else if (ArrayBuffer.isView(data)) buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
	else return null
	if (buf.length < 9 || buf.readUInt32BE(0) !== 1) return null
	const format = buf.readUInt32BE(4)
	return {
		base64: buf.subarray(8).toString("base64"),
		mime: format === 2 ? "image/png" : "image/jpeg"
	}
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve()
		const timer = setTimeout(done, ms)
		function done() {
			clearTimeout(timer)
			signal.removeEventListener("abort", done)
			resolve()
		}
		signal.addEventListener("abort", done, { once: true })
	})
}

// ── Test and list ─────────────────────────────────────────────────────────────

/** The full `/object_info`, summarised. Throws with the host's words. */
export async function fetchObjectInfo(connection: {
	baseUrl?: string | null
	extraJson?: unknown
}): Promise<ObjectInfoSummary> {
	const res = await fetch(`${rootOf(connection)}/object_info`, {
		headers: authHeaders(connection)
	})
	if (!res.ok) throw new Error(`ComfyUI's /object_info answered HTTP ${res.status}`)
	return summariseObjectInfo(await res.json())
}

async function listModels(
	connection: SelectConnection
): Promise<{ models: string[]; error?: string }> {
	try {
		// The three loaders the SillyTavern set reads, one class at a time —
		// far smaller than the whole `/object_info`. A loader the server does
		// not have answers 404 or `{}`, which lists nothing for it.
		const merged: Record<string, unknown> = {}
		let reached = false
		for (const cls of new Set(MODEL_LOADER_INPUTS.map((k) => k.split(".")[0]!))) {
			const res = await fetch(`${rootOf(connection)}/object_info/${cls}`, {
				headers: authHeaders(connection)
			})
			if (res.status === 404) {
				reached = true
				continue
			}
			if (!res.ok) return { models: [], error: `HTTP ${res.status}` }
			reached = true
			Object.assign(merged, await res.json())
		}
		if (!reached) return { models: [], error: "ComfyUI did not answer." }
		return { models: modelNamesOf(summariseObjectInfo(merged)) }
	} catch (e) {
		return { models: [], error: e instanceof Error ? e.message : String(e) }
	}
}

async function testConnection(connection: SelectConnection): Promise<{
	ok: boolean
	error?: string
	extra?: Record<string, unknown>
}> {
	try {
		const res = await fetch(`${rootOf(connection)}/system_stats`, {
			headers: authHeaders(connection)
		})
		if (!res.ok)
			return {
				ok: false,
				error:
					res.status === 401 || res.status === 403
						? `ComfyUI refused the request (HTTP ${res.status}). If it sits behind a proxy, set its key.`
						: `HTTP ${res.status}`
			}
		const stats = (await res.json().catch(() => ({}))) as {
			system?: { comfyui_version?: string }
			devices?: Array<{ name?: string; vram_total?: number }>
		}
		const objectInfo = await fetchObjectInfo(connection)
		const device = stats.devices?.[0]
		return {
			ok: true,
			extra: {
				capabilities: { "text->image": "native", "text+image->image": "native" },
				comfy: {
					version: stats.system?.comfyui_version ?? null,
					device: device?.name ?? null,
					vramTotal: device?.vram_total ?? null,
					nodeCount: objectInfo.classes.length,
					// Taken off the reply by the connection test before it is
					// sent (`recordComfyTest`) — cached on the row instead.
					objectInfo
				}
			}
		}
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}

const exports: ImageAdapterExports = {
	Adapter: ComfyAdapter,
	listModels,
	testConnection,
	sheet: COMFY_SHEET,
	sheetFor: comfySheetFor,
	sheetForWorkflow,
	packKeyedGraph,
	fetchObjectInfo,
	profileSchema: PROFILE_SCHEMA,
	profileDefaults: PROFILE_DEFAULTS
}

export default exports
