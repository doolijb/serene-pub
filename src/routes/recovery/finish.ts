/**
 * The tail both `restore` and `fresh` share.
 *
 * By the time either gets here the data directory is in a state that should
 * work, and the only remaining question is whether *this* process can pick it
 * up without being restarted. It usually can — measured, not assumed: a second
 * PGlite on the same path in the same process opens cleanly after the first
 * one aborted. When it cannot, saying so beats redirecting the owner into a
 * page that says the database will not open without explaining that the thing
 * they just did did in fact work.
 */
import { renderProblemPage } from "./pages"

export async function finishAndRedirect(): Promise<Response> {
	const { restartAfterRecovery } = await import("$lib/server/startup")
	const state = await restartAfterRecovery()
	if (state.ok) {
		return new Response(null, {
			status: 303,
			headers: { location: "/", "cache-control": "no-store" }
		})
	}
	return renderProblemPage(
		"That worked, but the database still will not open",
		[
			"The move itself succeeded — the previous database is set aside and the new one is in place.",
			"Opening it inside this already-running process did not work. Restart Serene Pub: a fresh start is the ordinary way in, and if it opens then this page will be gone.",
			String((state.error as Error)?.message ?? state.error)
		]
	)
}
