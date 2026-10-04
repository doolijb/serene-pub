/**
 * A remote card's bytes, read with a ceiling (lorebooks plan S4).
 *
 * `response.arrayBuffer()` reads whatever the server sends, however much that
 * is, before anything can look at it. This streams the body instead, counting
 * as it goes, and the moment the count passes `maxBytes` it stops: the reader
 * is cancelled and the request aborted, so the rest of the body is never
 * downloaded, let alone held. A `Content-Length` already over the ceiling is
 * refused before a byte of the body is read.
 */
import { CardSourceUnavailableError } from "./types"
import { megabytes } from "$lib/shared/imports/fileCaps"

export function remoteCardTooLarge(maxBytes: number): string {
	return `This card file is larger than the ${megabytes(maxBytes)} Serene Pub will read.`
}

export async function readCappedBody(
	response: Response,
	maxBytes: number,
	/** Aborted when the ceiling is passed, so the request itself stops too. */
	abort?: AbortController
): Promise<Buffer> {
	const refuse = async (reader?: ReadableStreamDefaultReader<Uint8Array>) => {
		abort?.abort()
		await (reader ? reader.cancel() : response.body?.cancel())?.catch(
			() => undefined
		)
		return new CardSourceUnavailableError(remoteCardTooLarge(maxBytes))
	}

	const declared = Number(response.headers.get("content-length"))
	if (Number.isFinite(declared) && declared > maxBytes) throw await refuse()

	const body = response.body
	if (!body) return Buffer.alloc(0)
	const reader = body.getReader()
	const chunks: Uint8Array[] = []
	let total = 0
	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		total += value.byteLength
		if (total > maxBytes) throw await refuse(reader)
		chunks.push(value)
	}
	return Buffer.concat(chunks, total)
}
