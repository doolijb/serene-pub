import { requestWithInterest } from "$lib/client/sockets/interest.svelte"
import type { SocketEventMap } from "$lib/client/sockets/typedSocket"
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
	/** Session/group-session history — only uploaded for what the user selects to import. */
	deferredFiles: PickedFile[]
}

function isSessionHistoryPath(relativePath: string): boolean {
	return (
		relativePath.startsWith("sessions/") ||
		relativePath.startsWith("group sessions/")
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
		scanFiles: files.filter((f) => !isSessionHistoryPath(f.relativePath)),
		deferredFiles: files.filter((f) => isSessionHistoryPath(f.relativePath))
	}
}

/**
 * One-shot request/response over the app's emit+listen pattern (no per-call
 * ack): declares interest in the reply, sends the request, and releases that
 * interest the moment the reply lands or the wait times out. Rejecting on
 * timeout rather than hanging forever is what gives the caller feedback when a
 * message is lost, a server-side handler throws before reaching its own
 * try/catch, or the connection drops.
 *
 * The registry reaches the app's ONE socket itself, so neither this helper nor
 * the exports below take a socket. A test drives them by putting its own
 * socket in `socketInstance` (`setSocket`).
 */
function requestOnce<K extends keyof SocketEventMap>(
	event: K,
	params: SocketEventMap[K]["params"],
	timeoutMs = 30_000
): Promise<SocketEventMap[K]["response"]> {
	return new Promise((resolve, reject) => {
		let settled = false
		// Assigned before any reply can reach the handler below: the reply
		// crosses the socket, so it cannot arrive during the synchronous emit
		// inside `requestWithInterest`.
		let release: (() => void) | undefined

		const timer = setTimeout(() => {
			if (settled) return
			settled = true
			release?.()
			reject(
				new Error(
					`Timed out waiting for a response (${String(event)}). The server may have hit an error — check the server logs.`
				)
			)
		}, timeoutMs)

		release = requestWithInterest(
			event,
			params,
			(response: SocketEventMap[K]["response"]) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				// Release on reply: this request wants one answer, and holding
				// the key past it would keep the server emitting to a view
				// that is done asking.
				release?.()
				resolve(response)
			}
		)
	})
}

/** Starts a new import staging session, returning its id. */
export async function startImportSession(): Promise<string> {
	const response = await requestOnce("import:sillytavern:startSession", {})
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
