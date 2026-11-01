import type { RequestHandler } from "@sveltejs/kit"
import { db } from "$lib/server/db"
import { authenticateRequest } from "$lib/server/auth/authenticateRequest"
import { pluginDataResponse } from "$lib/server/plugins/frameHost"

// `me/…` is the signed-in person's own files (M2b): only that path needs to
// know who is asking, so the sign-in lookup runs for it alone.
export const GET: RequestHandler = async (event) => {
	const rest = event.params.rest
	const mine = typeof rest === "string" && /^[^/]+\/me(\/|$)/.test(rest)
	const user = mine ? await authenticateRequest(event) : null
	return pluginDataResponse(db, rest, event.request, user?.id ?? null)
}
