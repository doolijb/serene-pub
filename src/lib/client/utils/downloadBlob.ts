/**
 * Triggers a browser download from a socket export response's
 * `{blob, filename}` payload. Socket.IO serializes a Node Buffer as a plain
 * object with a numeric-indexed `data` array (or, less commonly, as an
 * array directly) rather than a real Uint8Array, so that shape has to be
 * normalized before it can be wrapped in a Blob.
 */
export function downloadBlob(payload: { blob: unknown; filename: string }): void {
	const bufferData = Array.isArray(payload.blob)
		? payload.blob
		: (payload.blob as any).data || payload.blob
	const blob = new Blob([new Uint8Array(bufferData)], {
		type: payload.filename.endsWith(".json") ? "application/json" : "image/png"
	})

	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = payload.filename
	document.body.appendChild(a)
	a.click()
	document.body.removeChild(a)
	URL.revokeObjectURL(url)
}
