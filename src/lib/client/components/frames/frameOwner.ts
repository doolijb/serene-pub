/**
 * Whose document a plugin frame is — the owner its widget wire reports to the
 * page (`WidgetRequestFrom.owner`), read off the frame's own address.
 *
 * A frame's address is `/plugin-ui/<pluginId>/<file…>` (`frameSrc`), so the
 * first segment names the plugin. Never `core`: that is the app's own owner
 * id, and the page answers a request from `core` with core's authority (a
 * line sent as the viewer, a turn fired, a proposal decided). Core renders no
 * frame of its own, so a frame claiming it — a row stored under `core` before
 * installs refused it — is answered as an unknown owner instead.
 */
export function frameOwnerOf(src: string): string {
	const m = /^\/plugin-ui\/([^/]+)\//.exec(src)
	if (!m) return "unknown"
	let id: string
	try {
		id = decodeURIComponent(m[1])
	} catch {
		return "unknown"
	}
	return id === "core" ? "unknown" : id
}

/**
 * Where a frame's own package assets are served — `/plugin-assets/<owner>/<v>/`
 * — read off a `/plugin-ui/<owner>/…?v=<v>` address. Undefined without a
 * version or for `core`/an unknown owner.
 */
export function frameAssetsBaseOf(src: string): string | undefined {
	const owner = frameOwnerOf(src)
	if (owner === "unknown") return undefined
	const v = frameVersionOf(src)
	if (!v) return undefined
	return `/plugin-assets/${encodeURIComponent(owner)}/${encodeURIComponent(v)}/`
}

/**
 * The installed version a `/plugin-ui/…?v=<v>` address carries (`frameSrc`),
 * or undefined. A component's address carries it too (M2a), so the document
 * it nests (`sp-frame`) is addressed — and given its `assetsBase` — the same way.
 */
export function frameVersionOf(src: string): string | undefined {
	const q = src.indexOf("?")
	if (q < 0) return undefined
	return new URLSearchParams(src.slice(q + 1)).get("v") || undefined
}
