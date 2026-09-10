/**
 * `POST /recovery/delete-broken` — remove one set-aside database directory.
 *
 * The counterpart to every "moved aside, never deleted" promise elsewhere in
 * this module: those directories are kept forever precisely so that this is the
 * owner's decision and nothing else's. Deleting one is irreversible, and the
 * confirmation says so in those words.
 */
import type { RequestEvent } from "@sveltejs/kit"
import { consumeConfirmToken, guardRecovery, issueConfirmToken } from "../guard"
import { formatBytes, renderConfirmPage, renderProblemPage } from "../pages"

export async function POST(event: RequestEvent) {
	const refused = await guardRecovery(event)
	if (refused) return refused

	const form = await event.request.formData()
	const name = String(form.get("name") ?? "")

	const { deleteBrokenDir, listBrokenDirs, recoveryPaths } = await import(
		"$lib/server/db/recovery"
	)
	const paths = recoveryPaths()
	const dir = listBrokenDirs(paths).find((entry) => entry.name === name)
	if (!dir) {
		return renderProblemPage("That directory is not there", [
			`Serene Pub could not find a set-aside database called "${name}" in ${paths.dataDir}.`,
			"Nothing was deleted."
		])
	}

	if (!consumeConfirmToken(form.get("confirm"), "delete-broken", name)) {
		return renderConfirmPage({
			title: "Serene Pub — delete a set-aside database",
			heading: "Delete this set-aside database?",
			explain: [
				`${dir.name} (${formatBytes(dir.bytes)}) will be removed from ${paths.dataDir}, along with everything inside it.`,
				dir.kind === "broken"
					? "This is a database that was set aside by a restore or a start-fresh. It is the only copy of anything that was in it, and it may still be repairable with the PostgreSQL tools described in the troubleshooting guide."
					: "This is what came out of a restore that did not open. It has never been the live database.",
				"This cannot be undone. If you might want it later, download it first."
			],
			action: "/recovery/delete-broken",
			fields: { name: dir.name },
			token: issueConfirmToken("delete-broken", dir.name),
			submitLabel: "Delete it permanently",
			danger: true
		})
	}

	try {
		deleteBrokenDir(dir.name, paths)
	} catch (error) {
		return renderProblemPage("It was not deleted", [
			String((error as Error)?.message ?? error)
		])
	}

	return new Response(null, {
		status: 303,
		headers: {
			location: "/recovery?done=directory-deleted",
			"cache-control": "no-store"
		}
	})
}
