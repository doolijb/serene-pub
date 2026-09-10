/**
 * `POST /recovery/delete-backup` — remove one backup file the owner picked.
 *
 * The only thing on this surface that destroys anything, along with its
 * neighbour `delete-broken`, and it exists because ruling 3 keeps every backup
 * forever: nothing culls them, so the owner needs a way to reclaim the disk.
 * Same two-post confirm as everything else here.
 */
import type { RequestEvent } from "@sveltejs/kit"
import { consumeConfirmToken, guardRecovery, issueConfirmToken } from "../guard"
import { formatBytes, renderConfirmPage, renderProblemPage } from "../pages"

export async function POST(event: RequestEvent) {
	const refused = await guardRecovery(event)
	if (refused) return refused

	const form = await event.request.formData()
	const name = String(form.get("name") ?? "")

	const { deleteBackup, listBackups, recoveryPaths } = await import(
		"$lib/server/db/recovery"
	)
	const paths = recoveryPaths()
	const backup = listBackups(paths).find((entry) => entry.name === name)
	if (!backup) {
		return renderProblemPage("That backup is not there", [
			`Serene Pub could not find a backup called "${name}" in ${paths.backupsDir}.`,
			"Nothing was deleted."
		])
	}

	if (!consumeConfirmToken(form.get("confirm"), "delete-backup", name)) {
		return renderConfirmPage({
			title: "Serene Pub — delete a backup",
			heading: "Delete this backup?",
			explain: [
				`${backup.name} (${formatBytes(backup.bytes)}) will be deleted from ${paths.backupsDir}.`,
				backup.hasMeta
					? "Its companion meta.json goes with it. Nothing else does."
					: "Nothing else is affected.",
				"This one cannot be undone — unlike everything else on this page, the file is removed rather than moved."
			],
			action: "/recovery/delete-backup",
			fields: { name: backup.name },
			token: issueConfirmToken("delete-backup", backup.name),
			submitLabel: "Delete this backup",
			danger: true
		})
	}

	try {
		deleteBackup(backup.name, paths)
	} catch (error) {
		return renderProblemPage("It was not deleted", [
			String((error as Error)?.message ?? error)
		])
	}

	return new Response(null, {
		status: 303,
		headers: {
			location: "/recovery?done=backup-deleted",
			"cache-control": "no-store"
		}
	})
}
