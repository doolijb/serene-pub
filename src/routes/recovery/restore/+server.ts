/**
 * `POST /recovery/restore` — put a backup where the database is.
 *
 * Two posts. The first names a backup and gets a page restating exactly what
 * will move, carrying a single-use token; the second spends the token and does
 * it. Nothing happens on the first, so a refresh of the confirmation page is
 * inert, and nothing happens twice on the second, so a refresh *after* the
 * restore is inert too — which matters here more than anywhere: a second run
 * would set the just-restored database aside and restore over it again.
 */
import type { RequestEvent } from "@sveltejs/kit"
import { consumeConfirmToken, guardRecovery, issueConfirmToken } from "../guard"
import { formatBytes, renderConfirmPage, renderProblemPage } from "../pages"
import { finishAndRedirect } from "../finish"

export async function POST(event: RequestEvent) {
	const refused = await guardRecovery(event)
	if (refused) return refused

	const form = await event.request.formData()
	const name = String(form.get("name") ?? "")
	const confirm = form.get("confirm")

	const { listBackups, recoveryPaths } = await import(
		"$lib/server/db/recovery"
	)
	const paths = recoveryPaths()
	const backup = listBackups(paths).find((entry) => entry.name === name)
	if (!backup) {
		return renderProblemPage("That backup is not there", [
			`Serene Pub could not find a backup called "${name}" in ${paths.backupsDir}.`,
			"It may have been renamed or removed since this page was loaded. Go back and pick one from the list."
		])
	}

	if (!consumeConfirmToken(confirm, "restore", name)) {
		return renderConfirmPage({
			title: "Serene Pub — restore a backup",
			heading: "Restore this backup?",
			explain: [
				`Serene Pub will put ${backup.name} (${formatBytes(backup.bytes)}, taken ${backup.modifiedAt}) in place of the current database.`,
				`The current database is not deleted. It is moved to a folder next to it called serene-pub.db.broken-<date> inside ${paths.dataDir}, and stays there until you delete it yourself.`,
				backup.hasMeta
					? "This backup carries the meta.json that was current when it was taken, so the API passphrases stored inside it will still open. Your current meta.json is kept alongside as meta.json.replaced-<date>."
					: "This backup has no meta.json of its own, so your current one is kept exactly as it is.",
				backup.hasUsers
					? `This backup also carries your user files — media and avatars, ${formatBytes(backup.usersBytes)}. Putting them back moves the current users/ folder to users.broken-<date>, the same way the database is moved. Leave the box ticked unless you want to keep the media you have now: a database restored on its own points at images that came with it and are not there.`
					: "This backup has no user files of its own, so your media and avatars are left exactly as they are.",
				"Anything you did since this backup was taken is in the database being set aside, not in this one."
			],
			action: "/recovery/restore",
			fields: { name: backup.name },
			checkbox: backup.hasUsers
				? {
						name: "users",
						label: "Also restore the user files in this backup (media and avatars)",
						checked: true
					}
				: undefined,
			token: issueConfirmToken("restore", backup.name),
			submitLabel: "Restore this backup"
		})
	}

	const { restoreBackup } = await import("$lib/server/db/recovery")
	try {
		// Unticked reaches a form post as an absent field, not a false one — so
		// the decline is "the box was not sent", and only for a backup that had
		// a box to untick.
		await restoreBackup(backup.name, paths, {
			restoreUsers: !backup.hasUsers || form.get("users") === "yes"
		})
	} catch (error) {
		return renderProblemPage("The restore did not go ahead", [
			String((error as Error)?.message ?? error),
			`Your database has not been touched — it is still at ${paths.dbPath}, exactly as it was.`,
			"The attempt was left beside it as serene-pub.db.restore-failed-<date> so you can see what came out of the archive. Try another backup, or start fresh."
		])
	}

	return await finishAndRedirect()
}
