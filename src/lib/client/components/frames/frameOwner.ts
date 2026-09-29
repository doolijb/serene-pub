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
