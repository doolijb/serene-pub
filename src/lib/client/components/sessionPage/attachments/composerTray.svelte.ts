/**
 * The session page's half of the composer **tray** (PLAN-composer-attachments
 * §3.1, §3.3): it keeps the viewer's tray items for the open session, uploads
 * the files core's composer asks it to attach, and asks the server what this
 * session's reply can read (**attachment readers**). The composer is a widget
 * — it never touches a socket — so it reads all of this off the dossier
 * (`composer.tray`, `composer.attachments`) and asks through requests
 * (`attach-files`, `remove-tray-item`).
 *
 * **Transport** (D4): `attachments:begin` with the file's first bytes, then
 * 1 MiB `attachments:chunk`s from offset 0, each awaited, then
 * `attachments:finish`. Uploads run ONE at a time: a `begin` reply names no
 * file, so one in flight is what makes the reply this upload's — and the
 * server allows two per person anyway.
 *
 * **Who hears what.** `begin`/`chunk` replies come to this socket only;
 * `finish`/`remove`/`list` to every tab of the person, so a second tab's tray
 * follows this one, and the `list` the server pushes after a Send — the sent
 * items gone — is what clears the tiles. Every reply carries `sessionId`;
 * one for another session is not this tray's.
 *
 * Listeners go through the interest registry with their handler
 * (`declareInterest` returns the release), never a bare `socket.off`.
 */
import { SvelteMap } from "svelte/reactivity"
import type {
	AttachmentKindV1,
	AttachmentReadersV1,
	TrayItemV1
} from "@serene-pub/core-catalog/conversation"
import type {
	AttachmentReaders,
	AttachmentsBeginResponse,
	AttachmentsChunkResponse,
	AttachmentsError,
	AttachmentsFinishResponse,
	AttachmentsListResponse,
	AttachmentsReadersResponse,
	AttachmentsRemoveResponse,
	TrayItemView
} from "$lib/shared/sockets/attachments"
import { ATTACHMENT_CAPS } from "$lib/shared/attachments/caps"

/** What the tray needs of the socket: an emit, and a listener with its release. */
export interface TrayTransport {
	emit(event: string, data: unknown): void
	on(event: string, handler: (data: any) => void): () => void
}

interface Tile {
	/** The tray item id once `begin` answered; a local key before. */
	id: string
	local: boolean
	status: TrayItemV1["status"]
	progress: number
	refusal: string | null
	filename: string
	bytes: number
	kind: AttachmentKindV1 | null
	thumbSrc: string | null
	/** Tray order: the server's position, or arrival order for a local tile. */
	order: number
}

const NO_ANSWER = "The upload stopped: the server did not answer."
const WAIT_MS = 60_000

/** The server's tray item as a tile. */
function tileOf(view: TrayItemView, progress = 1): Tile {
	return {
		id: view.id,
		local: false,
		status: view.status,
		progress: view.status === "uploading" ? progress : 1,
		refusal: view.refusal,
		filename: view.filename ?? "file",
		bytes: view.bytes,
		kind: view.attachmentKind,
		thumbSrc:
			view.status === "ready" && view.attachmentKind === "image"
				? (view.file?.thumbUrl ?? null)
				: null,
		order: view.position
	}
}

/** The readers as the composer reads them (`AttachmentReadersV1`). */
export function readersV1(r: AttachmentReaders): AttachmentReadersV1 {
	const accept = (["image", "text", "pdf"] as const)
		.filter((k) => r.kinds[k]?.allowed)
		.flatMap((k) => r.accepts[k] ?? [])
	return {
		kinds: r.kinds,
		calls: r.calls.map((c) => ({
			key: c.key,
			label: c.label,
			reads: c.reads,
			placeholderFor: c.placeholderFor,
			// Present only for an administrator: the server removed the
			// pair for everyone else (`redactConnections`).
			...(c.connection?.model || c.connection?.name
				? { model: (c.connection.model ?? c.connection.name)! }
				: {})
		})),
		accept: [...new Set(accept)].join(","),
		filesPerMessage: r.limits.filesPerMessage,
		bytesPerKind: r.limits.bytesPerKind
	}
}

export function createComposerTray(
	transport: TrayTransport,
	opts: { sessionId: () => number | null; waitMs?: number }
) {
	const tiles = new SvelteMap<string, Tile>()
	let readers = $state<AttachmentReadersV1 | null>(null)
	let localSeq = 0
	let loadedFor: number | null = null
	let arrival = 1_000_000
	/** Tiles the person removed while they were uploading: their upload stops. */
	const cancelled = new Set<string>()
	const waitMs = opts.waitMs ?? WAIT_MS

	const here = (data: { sessionId?: number } | undefined) =>
		data?.sessionId != null && data.sessionId === opts.sessionId()

	/* ── one reply at a time ─────────────────────────────────────────── */
	type Waiter = { match: (event: string, data: any) => boolean; done: (event: string, data: any) => void }
	const waiters = new Set<Waiter>()
	function waitFor(
		match: (event: string, data: any) => boolean
	): Promise<{ event: string; data: any }> {
		return new Promise((resolve) => {
			const w: Waiter = {
				match,
				done: (event, data) => {
					clearTimeout(timer)
					waiters.delete(w)
					resolve({ event, data })
				}
			}
			const timer = setTimeout(
				() => w.done("timeout", { error: NO_ANSWER }),
				waitMs
			)
			waiters.add(w)
		})
	}
	const hear = (event: string) => (data: any) => {
		for (const w of [...waiters]) if (w.match(event, data)) w.done(event, data)
	}

	/* ── the pushes ──────────────────────────────────────────────────── */
	const releases: Array<() => void> = []
	const on = (event: string, handler: (data: any) => void) =>
		releases.push(transport.on(event, handler))

	for (const e of [
		"attachments:begin",
		"attachments:begin:error",
		"attachments:chunk",
		"attachments:chunk:error",
		"attachments:finish:error"
	])
		on(e, hear(e))

	on("attachments:finish", (res: AttachmentsFinishResponse) => {
		hear("attachments:finish")(res)
		if (!here(res)) return
		tiles.set(res.trayItem.id, tileOf(res.trayItem))
	})
	on("attachments:remove", (res: AttachmentsRemoveResponse) => {
		if (!here(res)) return
		tiles.delete(res.trayItemId)
	})
	on("attachments:list", (res: AttachmentsListResponse) => {
		if (!here(res)) return
		// The server's tray is the truth — a Send just took some, a second
		// tab added one. A tile this tab is still uploading keeps its
		// progress; a refusal this tab holds locally stays until removed.
		const listed = new Set(res.tray.map((t) => t.id))
		for (const [id, tile] of tiles)
			if (!tile.local && !listed.has(id)) tiles.delete(id)
		for (const view of res.tray) {
			const mine = tiles.get(view.id)
			tiles.set(
				view.id,
				tileOf(view, mine?.status === "uploading" ? mine.progress : 0)
			)
		}
	})
	on("attachments:readers", (res: AttachmentsReadersResponse) => {
		if (!here(res)) return
		readers = readersV1(res.readers)
	})

	/* ── uploads, one at a time ──────────────────────────────────────── */
	let queue: Promise<void> = Promise.resolve()

	function refuseTile(key: string, reason: string) {
		const tile = tiles.get(key)
		if (tile) tiles.set(key, { ...tile, status: "refused", refusal: reason })
	}

	async function upload(file: File, key: string): Promise<void> {
		const sessionId = opts.sessionId()
		if (sessionId == null) return refuseTile(key, "This session is not open.")
		if (cancelled.has(key)) return void tiles.delete(key)
		const head = new Uint8Array(
			await file.slice(0, Math.min(file.size, ATTACHMENT_CAPS.headBytes)).arrayBuffer()
		)
		const begun = waitFor(
			(event, data) =>
				(event === "attachments:begin" || event === "attachments:begin:error") &&
				data?.sessionId === sessionId
		)
		transport.emit("attachments:begin", {
			sessionId,
			filename: file.name,
			bytes: file.size,
			head
		})
		const opened = await begun
		if (opened.event !== "attachments:begin")
			return refuseTile(key, (opened.data as AttachmentsError).error ?? NO_ANSWER)
		const { trayItemId, chunkBytes } = opened.data as AttachmentsBeginResponse

		// The tile takes the server's id; removed meanwhile, the upload goes.
		const local = tiles.get(key)
		tiles.delete(key)
		if (cancelled.has(key) || !local) {
			transport.emit("attachments:remove", { trayItemId })
			return
		}
		tiles.set(trayItemId, { ...local, id: trayItemId, local: false })

		for (let index = 0, offset = 0; offset < file.size; index++, offset += chunkBytes) {
			if (cancelled.has(trayItemId)) return
			const data = new Uint8Array(
				await file.slice(offset, Math.min(offset + chunkBytes, file.size)).arrayBuffer()
			)
			const acked = waitFor(
				(event, d) =>
					(event === "attachments:chunk" && d?.trayItemId === trayItemId && d?.index === index) ||
					(event === "attachments:chunk:error" && d?.trayItemId === trayItemId)
			)
			transport.emit("attachments:chunk", { trayItemId, index, data })
			const ack = await acked
			if (ack.event !== "attachments:chunk") {
				const reason = (ack.data as AttachmentsError).error ?? NO_ANSWER
				const tile = tiles.get(trayItemId)
				if (tile) tiles.set(trayItemId, { ...tile, local: true, status: "refused", refusal: reason })
				return
			}
			const progress = ack.data as AttachmentsChunkResponse
			const tile = tiles.get(trayItemId)
			if (tile)
				tiles.set(trayItemId, {
					...tile,
					progress: progress.bytes ? progress.received / progress.bytes : 1
				})
		}
		if (cancelled.has(trayItemId)) return
		const finished = waitFor(
			(event, d) =>
				(event === "attachments:finish" && d?.trayItem?.id === trayItemId) ||
				(event === "attachments:finish:error" && d?.trayItemId === trayItemId)
		)
		transport.emit("attachments:finish", { trayItemId })
		const done = await finished
		if (done.event !== "attachments:finish") {
			const tile = tiles.get(trayItemId)
			if (tile)
				tiles.set(trayItemId, {
					...tile,
					local: true,
					status: "refused",
					refusal: (done.data as AttachmentsError).error ?? NO_ANSWER
				})
		}
		// A ready (or refused-at-finish) item arrives through the
		// `attachments:finish` push, which every tab hears.
	}

	return {
		/** The tray as the composer draws it (`composer.tray`), in tray order. */
		get view(): TrayItemV1[] {
			return [...tiles.values()]
				.sort((a, b) => a.order - b.order)
				.map((t) => ({
					id: t.id,
					status: t.status,
					progress: t.progress,
					refusal: t.refusal,
					filename: t.filename,
					bytes: t.bytes,
					kind: t.kind,
					thumbSrc: t.thumbSrc
				}))
		},
		/** What this reply can read (`composer.attachments`); null until asked. */
		get readers(): AttachmentReadersV1 | null {
			return readers
		},
		/** The ready items a Send carries, in tray order. */
		sendableIds(): string[] {
			return this.view.filter((t) => t.status === "ready").map((t) => t.id)
		},
		/** Ask the server for the tray and the readers — the session opened, or the socket came back. */
		load(): void {
			const sessionId = opts.sessionId()
			if (sessionId == null) return
			// Another session: its own tray, never the last one's tiles.
			if (sessionId !== loadedFor) {
				loadedFor = sessionId
				tiles.clear()
				readers = null
			}
			transport.emit("attachments:list", { sessionId })
			transport.emit("attachments:readers", { sessionId })
		},
		/** Ask again what the reply reads (its pipeline or connection may have moved). */
		refreshReaders(): void {
			const sessionId = opts.sessionId()
			if (sessionId != null) transport.emit("attachments:readers", { sessionId })
		},
		/** Upload files into the tray, one after another; returns once they are queued. */
		attach(files: readonly File[]): void {
			this.refreshReaders()
			for (const file of files) {
				const key = `local:${++localSeq}`
				tiles.set(key, {
					id: key,
					local: true,
					status: "uploading",
					progress: 0,
					refusal: null,
					filename: file.name || "file",
					bytes: file.size,
					kind: null,
					thumbSrc: null,
					order: arrival++
				})
				queue = queue
					.then(() => upload(file, key))
					.catch((e) => refuseTile(key, e instanceof Error ? e.message : NO_ANSWER))
			}
		},
		/** Take one item out of the tray: a refusal shown here, an upload, a ready file. */
		remove(id: string): void {
			const tile = tiles.get(id)
			cancelled.add(id)
			tiles.delete(id)
			if (!tile || id.startsWith("local:")) return
			transport.emit("attachments:remove", { trayItemId: id })
		},
		/** Take one attachment off a sent message (D9). */
		removeFromMessage(messageId: number, partId: number): void {
			transport.emit("attachments:removeFromMessage", { messageId, partId })
		},
		/** The session closed: drop everything and stop listening. */
		destroy(): void {
			for (const r of releases.splice(0)) r()
			for (const w of [...waiters]) w.done("timeout", { error: NO_ANSWER })
			tiles.clear()
		}
	}
}

export type ComposerTray = ReturnType<typeof createComposerTray>
