/**
 * `POST /recovery/fresh` — set the current database aside and start empty.
 *
 * The confirmation here is the most important one on the surface, because this
 * is the action whose consequence an owner is most likely to misread: it does
 * not repair anything and it does not recover anything. It gets the app running
 * again with nothing in it, and everything that was in the database stays in a
 * folder next to the new one.
 */
import type { RequestEvent } from "@sveltejs/kit"
import { consumeConfirmToken, guardRecovery, issueConfirmToken } from "../guard"
import { renderConfirmPage, renderProblemPage } from "../pages"
import { finishAndRedirect } from "../finish"

export async function POST(event: RequestEvent) {
	const refused = await guardRecovery(event)
	if (refused) return refused

	const form = await event.request.formData()
	const { listBackups, recoveryPaths } = await import(
		"$lib/server/db/recovery"
	)
	const paths = recoveryPaths()

	if (!consumeConfirmToken(form.get("confirm"), "fresh")) {
		const backups = listBackups(paths)
		return renderConfirmPage({
			title: "Serene Pub — start fresh",
			heading: "Start with an empty database?",
			explain: [
				`The database at ${paths.dbPath} is moved to serene-pub.db.broken-<date> in the same folder. Nothing is deleted, and it stays there until you delete it yourself.`,
				"Serene Pub then starts with an empty database: no characters, no sessions, no lorebooks, no connections.",
				"meta.json is not touched, so your login and every stored API passphrase keep working.",
				backups.length
					? `There ${backups.length === 1 ? "is" : "are"} ${backups.length} backup${backups.length === 1 ? "" : "s"} available. Restoring one keeps the content that was in it — go back if you have not looked.`
					: "There are no backups to restore from, which is usually why this is the option left."
			],
			action: "/recovery/fresh",
			token: issueConfirmToken("fresh"),
			submitLabel: "Start fresh",
			danger: true
		})
	}

	const { startFresh } = await import("$lib/server/db/recovery")
	try {
		startFresh(paths)
	} catch (error) {
		return renderProblemPage("Nothing was moved", [
			String((error as Error)?.message ?? error),
			`Your database is still at ${paths.dbPath}, exactly as it was.`
		])
	}

	return await finishAndRedirect()
}
