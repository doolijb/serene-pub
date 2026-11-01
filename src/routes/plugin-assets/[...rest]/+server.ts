import type { RequestHandler } from "@sveltejs/kit"
import { db } from "$lib/server/db"
import { pluginAssetResponse } from "$lib/server/plugins/frameHost"

export const GET: RequestHandler = (event) => pluginAssetResponse(db, event.params.rest, event.request)
