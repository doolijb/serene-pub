/**
 * The browser half of the package upload (K6): the three requests in
 * `$lib/shared/plugins/packageUpload` — start, pieces in order, finish —
 * answered with the install's reply. Any refusal arrives as the server's own
 * sentence, thrown as an Error.
 */
import {
	PLUGIN_PACKAGE_FILENAME_HEADER,
	PLUGIN_PACKAGE_SIZE_HEADER,
	PLUGIN_PACKAGE_UPLOAD_PATH,
	type PackageUploadPiece,
	type PackageUploadStart
} from "$lib/shared/plugins/packageUpload"

export interface UploadPackageOptions {
	/** Called after each piece is accepted, with the bytes sent so far and the file's size. */
	onProgress?: (sent: number, total: number) => void
	fetchImpl?: typeof fetch
}

async function answer<T>(
	fetchImpl: typeof fetch,
	url: string,
	init: RequestInit
): Promise<T> {
	let res: Response
	try {
		res = await fetchImpl(url, { ...init, credentials: "same-origin" })
	} catch {
		throw new Error(
			"The package could not be uploaded: the connection dropped."
		)
	}
	let body: any = null
	try {
		body = await res.json()
	} catch {
		/* not JSON: handled below */
	}
	if (!res.ok) {
		if (body && typeof body.error === "string") throw new Error(body.error)
		throw new Error(
			`The package could not be uploaded (HTTP ${res.status}).`
		)
	}
	if (body === null)
		throw new Error(
			`The package could not be uploaded (HTTP ${res.status}).`
		)
	return body as T
}

export async function uploadPackage(
	file: File,
	opts: UploadPackageOptions = {}
): Promise<Sockets.Plugins.InstallLocal.Response> {
	const fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args))
	const start = await answer<PackageUploadStart>(
		fetchImpl,
		PLUGIN_PACKAGE_UPLOAD_PATH,
		{
			method: "POST",
			headers: {
				[PLUGIN_PACKAGE_FILENAME_HEADER]: encodeURIComponent(file.name),
				[PLUGIN_PACKAGE_SIZE_HEADER]: String(file.size)
			}
		}
	)
	const id = encodeURIComponent(start.upload)
	let offset = 0
	while (offset < file.size) {
		const end = Math.min(offset + start.pieceBytes, file.size)
		await answer<PackageUploadPiece>(
			fetchImpl,
			`${PLUGIN_PACKAGE_UPLOAD_PATH}?upload=${id}&offset=${offset}`,
			{ method: "PUT", body: file.slice(offset, end) }
		)
		offset = end
		opts.onProgress?.(offset, file.size)
	}
	return answer<Sockets.Plugins.InstallLocal.Response>(
		fetchImpl,
		`${PLUGIN_PACKAGE_UPLOAD_PATH}?upload=${id}`,
		{ method: "POST" }
	)
}
