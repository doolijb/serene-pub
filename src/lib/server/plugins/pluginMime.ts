/**
 * The media type a stored plugin file is served with, by extension.
 *
 * A leaf on purpose — it imports nothing. `frameHost.ts` reads it, and
 * `registrySync` imports `frameHost`, so anything this module pulled in
 * would load with the definition registry; reaching `$lib/server/db` that
 * way deadlocked every test that mocks the database with `createTestDb`.
 * `pluginPackage.ts` re-exports `mimeForUiPath` for its existing callers.
 */

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".wav": "audio/wav",
	".m4a": "audio/mp4",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".ttf": "font/ttf",
	".avif": "image/avif"
}

/** A slash-separated path's extension, as `node:path`'s `extname` reads it ('' for none or a leading dot). */
const extensionOf = (path: string): string => {
	const base = path.slice(path.lastIndexOf("/") + 1)
	const dot = base.lastIndexOf(".")
	return dot > 0 ? base.slice(dot) : ""
}

export const mimeForUiPath = (path: string): string =>
	MIME[extensionOf(path).toLowerCase()] ?? "application/octet-stream"
