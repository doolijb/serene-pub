/**
 * `GET /recovery/download?name=…` — a set-aside database as a `.tgz`.
 *
 * The one action here that reads rather than writes, and the reason it exists
 * at all: a directory PostgreSQL will not start on is very often still
 * repairable with tools this app does not ship (`pg_resetwal` and friends —
 * see docs/troubleshooting.md), and it is always worth attaching to a bug
 * report. Getting a copy off the machine should not require the owner to find
 * their data directory in a file manager.
 *
 * A GET, deliberately, and with no confirm token: it changes nothing.
 */
import { Readable } from "node:stream"
import type { RequestEvent } from "@sveltejs/kit"
import { guardRecovery } from "../guard"
import { renderProblemPage } from "../pages"

export async function GET(event: RequestEvent) {
	const refused = await guardRecovery(event)
	if (refused) return refused

	const name = event.url.searchParams.get("name") ?? ""
	const { packBrokenDir, recoveryPaths } = await import(
		"$lib/server/db/recovery"
	)

	let packed
	try {
		packed = packBrokenDir(name, recoveryPaths())
	} catch (error) {
		return renderProblemPage("There is nothing to download", [
			String((error as Error)?.message ?? error)
		])
	}

	// Streamed: a data directory is tens to hundreds of megabytes, and this runs
	// in a process that may already be short of memory from whatever stopped it.
	return new Response(
		// `Readable.toWeb` rather than handing the Node stream straight to
		// `Response`: only the web stream is a body every runtime this ships on
		// accepts, and adapter-node converts it back on the way out.
		Readable.toWeb(packed.stream) as ReadableStream<Uint8Array>,
		{
			status: 200,
			headers: {
				"content-type": "application/gzip",
				// The filename is a name this module generated, not one a caller
				// supplied — `packBrokenDir` refuses anything that is not one of
				// its own prefixes — so it cannot carry a quote or a newline
				// into this header.
				"content-disposition": `attachment; filename="${packed.filename}"`,
				"cache-control": "no-store"
			}
		}
	)
}
