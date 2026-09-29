/**
 * Authored components' compiled modules (C6, P3):
 * `/authored-ui/authored.<id>/<artifact hash>.js`, served from the component
 * cache — see `$lib/server/components/serve` for every rule. Same-origin and
 * `text/javascript`, so the UI worker (`script-src 'self'`) imports it.
 */
import type { RequestHandler } from "@sveltejs/kit"
import { db } from "$lib/server/db"
import { serveAuthoredArtifact } from "$lib/server/components/serve"

export const GET: RequestHandler = ({ params }) => serveAuthoredArtifact(db, params.rest)
