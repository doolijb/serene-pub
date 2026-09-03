import { appVersion } from "$lib/shared/constants/version"
import { isPrereleaseVersion } from "$lib/shared/utils/releaseChannel"
import type { LayoutServerLoad } from "./$types"

/**
 * Attach Socket.IO to the HTTP server that is already serving this page.
 *
 * **Why here and not in `hooks.server.ts`.** The server is created outside the
 * SvelteKit bundle — by Vite in dev, by adapter-node's entry in production —
 * and neither hands it to app code, so both publish it on `globalThis` (see
 * `vite.config.ts` and `scripts/customize-build.js`). Something inside the
 * bundle has to pick it up, and `hooks.server.ts` turns out to be the one place
 * that cannot:
 *
 * - A *dynamic* import of the socket server from hooks silently never resolves
 *   in the production bundle. Rollup splits the socket server into its own
 *   chunk, and the circular references between it and the db chunk (the
 *   "Circular dependency" warnings during `vite build --ssr`) make the
 *   generated namespace helper deadlock — no error, no rejection, just a
 *   /socket.io/ that 404s forever.
 * - A *static* import from hooks is worse: hooks is part of the SSR core entry,
 *   so it pulls the db into the entry's own module graph and the server hangs
 *   during startup, before it ever listens.
 *
 * A route module has neither problem — it is its own chunk, which is exactly
 * how the old `/api/sockets-endpoint` route imported this same function. The
 * root layout load runs on every page render, so the socket server is always
 * attached before the browser that triggered it can try to connect.
 */
let socketsAttached = false
async function attachSocketsOnce() {
	if (socketsAttached) return
	const httpServer = (globalThis as any).__SERENE_PUB_HTTP_SERVER__
	if (!httpServer) return
	socketsAttached = true
	try {
		const { attachSocketServer } = await import(
			"$lib/server/sockets/loadSockets.server"
		)
		await attachSocketServer(httpServer)
	} catch (err) {
		// The flag stays set: a failed attach is not something retrying on
		// every page load will fix, and the log would repeat forever.
		console.error("[sockets] Failed to attach socket server:", err)
	}
}

export const load: LayoutServerLoad = async (event) => {
	// Awaited, not fire-and-forget: the page this load is serving will try to
	// open a socket as soon as it hydrates, and a race there shows up as a
	// spurious "Socket connection timeout" on first load.
	await attachSocketsOnce()

	// The one channel by which "this build is a pre-release" reaches the
	// client — the same one `isNewerReleaseAvailable` already travels, so
	// there is no second, differently-timed source for the UI to disagree
	// with. Everything downstream (the watermark, Document View's notice)
	// reads `page.data.isPrerelease`.
	const isPrerelease =
		typeof appVersion === "string" && isPrereleaseVersion(appVersion)

	// Second gate on the update notice, behind the one in updateCheck.ts.
	// That one means a pre-release never asks GitHub, so these are already
	// undefined here; this one means that stays true even if some future
	// caller populates locals another way. Every consumer of these two fields
	// (UpdateNoticeBar, SettingsSidebar, the Document View about page) reads
	// them from page data, so gating here covers all of them at once rather
	// than asking each to remember.
	return {
		isPrerelease,
		isNewerReleaseAvailable: isPrerelease
			? undefined
			: event.locals.isNewerReleaseAvailable,
		latestReleaseTag: isPrerelease
			? undefined
			: event.locals.latestReleaseTag
	}
}
