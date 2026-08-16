import type {
	TypedSocket,
	SocketEventMap
} from "$lib/client/sockets/typedSocket"
import {
	resolveSillyTavernDataRoot,
	relativeToDataRoot,
	isRelevantImportPath
} from "$lib/shared/utils/sillyTavernPaths"

export interface PickedFile {
	/** Path relative to the resolved SillyTavern data root, forward-slashed. */
	relativePath: string
	file: File
}

export interface FolderPickResult {
	/** Every relevant file found under the resolved data root. */
	files: PickedFile[]
	/** Files scan needs to read (characters, settings.json, groups, worlds). */
	scanFiles: PickedFile[]
	/** Chat/group-chat history — only uploaded for what the user selects to import. */
	deferredFiles: PickedFile[]
}

function isChatHistoryPath(relativePath: string): boolean {
	return (
		relativePath.startsWith("chats/") ||
		relativePath.startsWith("group chats/")
	)
}

/**
 * Walks a browser-picked folder (from <input webkitdirectory>), resolves the
 * SillyTavern data root within it, and filters down to the files the import
 * flow actually needs. Returns null if no recognizable SillyTavern data was
 * found in the picked folder.
 */
export function resolvePickedFolder(
	fileList: FileList
): FolderPickResult | null {
	const all = Array.from(fileList)
	const relPaths = all.map((f) => f.webkitRelativePath || f.name)
	const root = resolveSillyTavernDataRoot(relPaths)
	if (root === null) return null

	const files: PickedFile[] = []
	for (const file of all) {
		const relativePath = relativeToDataRoot(
			file.webkitRelativePath || file.name,
			root
		)
		if (isRelevantImportPath(relativePath)) {
			files.push({ relativePath, file })
		}
	}

	return {
		files,
		scanFiles: files.filter((f) => !isChatHistoryPath(f.relativePath)),
		deferredFiles: files.filter((f) => isChatHistoryPath(f.relativePath))
	}
}

/**
 * One-shot request/response over the app's emit+listen socket pattern (no
 * per-call ack). Rejects on timeout instead of hanging forever — a lost
 * message, a server-side handler that throws before reaching its own
 * try/catch, or a dropped connection would otherwise leave the caller
 * waiting indefinitely with no feedback.
 */
function requestOnce<K extends keyof SocketEventMap>(
	socket: TypedSocket,
	event: K,
	params: SocketEventMap[K]["params"],
	timeoutMs = 30_000
): Promise<SocketEventMap[K]["response"]> {
	return new Promise((resolve, reject) => {
		let settled = false

		const timer = setTimeout(() => {
			if (settled) return
			settled = true
			socket.off(event, listener)
			reject(
				new Error(
					`Timed out waiting for a response (${String(event)}). The server may have hit an error — check the server logs.`
				)
			)
		}, timeoutMs)

		const listener = (response: SocketEventMap[K]["response"]) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			socket.off(event, listener)
			resolve(response)
		}
		socket.on(event, listener)
		socket.emit(event, params)
	})
}

/** Starts a new import staging session, returning its id. */
export async function startImportSession(socket: TypedSocket): Promise<string> {
	const response = await requestOnce(
		socket,
		"import:sillytavern:startSession",
		{}
	)
	if (!response.success || !response.importSessionId) {
		throw new Error(response.error || "Failed to start import session")
	}
	return response.importSessionId
}

const MAX_BATCH_BYTES = 8 * 1024 * 1024 // 8MB
const MAX_BATCH_FILES = 20

type StageFilesPayload = { relativePath: string; data: Uint8Array }[]

async function* batchFilesForUpload(
	pickedFiles: PickedFile[]
): AsyncGenerator<StageFilesPayload> {
	let batch: StageFilesPayload = []
	let batchBytes = 0

	for (const { relativePath, file } of pickedFiles) {
		const data = new Uint8Array(await file.arrayBuffer())

		if (
			batch.length > 0 &&
			(batch.length >= MAX_BATCH_FILES ||
				batchBytes + data.byteLength > MAX_BATCH_BYTES)
		) {
			yield batch
			batch = []
			batchBytes = 0
		}

		batch.push({ relativePath, data })
		batchBytes += data.byteLength
	}

	if (batch.length > 0) yield batch
}

/**
 * socket.io's binary parser reliably handles one large binary attachment per
 * message, but disconnects the transport almost immediately when a message
 * contains more than ~10-14 *separate* binary attachments (verified
 * empirically against socket.io 4.8.x) — regardless of total payload size.
 * A batch of up to 20 individually-Uint8Array'd files tripped this every
 * time. Concatenating into one blob + a manifest of offsets sidesteps it
 * entirely: exactly one binary attachment per message, no matter the file
 * count.
 */
export function concatenateBatch(batch: StageFilesPayload): {
	manifest: { relativePath: string; length: number }[]
	blob: Uint8Array
} {
	const manifest = batch.map((f) => ({
		relativePath: f.relativePath,
		length: f.data.byteLength
	}))
	const totalLength = batch.reduce((sum, f) => sum + f.data.byteLength, 0)
	const blob = new Uint8Array(totalLength)
	let offset = 0
	for (const f of batch) {
		blob.set(f.data, offset)
		offset += f.data.byteLength
	}
	return { manifest, blob }
}

/**
 * Uploads picked files to the server's import staging area in batches,
 * awaiting each batch's response before sending the next (the app's socket
 * layer has no per-call ack, so batches are sent strictly sequentially).
 */
export async function stageFilesToServer(
	socket: TypedSocket,
	importSessionId: string,
	pickedFiles: PickedFile[],
	onProgress?: (staged: number, total: number) => void
): Promise<void> {
	if (pickedFiles.length === 0) return

	const total = pickedFiles.length
	let staged = 0

	for await (const batch of batchFilesForUpload(pickedFiles)) {
		const { manifest, blob } = concatenateBatch(batch)
		const response = await requestOnce(
			socket,
			"import:sillytavern:stageFiles",
			{ importSessionId, manifest, blob },
			60_000
		)

		if (!response.success) {
			throw new Error(response.error || "Failed to upload files")
		}

		staged += batch.length
		onProgress?.(staged, total)
	}
}
