/**
 * Serving an authored component's artifact (C6, P3) —
 * `/authored-ui/authored.<id>/<artifact hash>.js`, the URL
 * `authoredArtifactSrc` builds and the UI worker imports.
 *
 * Only that exact shape is answered (`parseAuthoredArtifactSrc`); every
 * other path — a `..`, an encoded one, a backslash, a source file's name,
 * another component's hash — is a 404, and no part of the request reaches
 * the filesystem unparsed. Only an enabled, cleanly compiled row is served,
 * and only under the artifact hash it names now, with the extension
 * subsystem on. The source is never served.
 *
 * A miss in the component cache is healed: the row's source is compiled
 * again (single-flight) and, when the rebuild is the same module (the
 * compiler is deterministic), served. A rebuild that comes out different
 * (the toolchain moved) is a new URL, so the old one is a 404.
 *
 * Immutable: the URL names the bytes' own hash, so it is cached for good.
 * Same-origin, so the UI worker's `script-src 'self'` takes it.
 */
import { pluginsEnabled } from "$lib/server/plugins/flag"
import { parseAuthoredArtifactSrc } from "$lib/shared/widgets/authoredOwner"
import { getAuthoredComponent } from "./store"
import { readArtifact } from "./cache"
import { compileAndRecord, componentCompilerAvailability } from "./compile"

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } })

/** The response for `/authored-ui/<rest>`. */
export async function serveAuthoredArtifact(db: Db, rest: string | null | undefined): Promise<Response> {
	if (!pluginsEnabled()) return notFound()
	const parsed = parseAuthoredArtifactSrc(rest)
	if (!parsed) return notFound()
	const { id, artifactHash } = parsed

	const row = await getAuthoredComponent(db, id)
	if (!row || !row.enabled || row.lastError || row.artifactHash !== artifactHash) return notFound()

	let code = await readArtifact(id, artifactHash)
	if (code === null && componentCompilerAvailability().available) {
		const rebuilt = await compileAndRecord(db, id).catch(() => undefined)
		if (rebuilt?.outcome.hash === artifactHash) code = await readArtifact(id, artifactHash)
	}
	if (code === null) return notFound()

	return new Response(code, {
		headers: {
			"Content-Type": "text/javascript; charset=utf-8",
			"Cache-Control": "public, max-age=31536000, immutable",
			"X-Content-Type-Options": "nosniff"
		}
	})
}
