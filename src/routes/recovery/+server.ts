/**
 * `GET /recovery` — the page an owner lands on when the database will not open.
 *
 * A plain endpoint rather than a `+page.svelte`, and that is load-bearing: a
 * page would run the root layout's load, which attaches the socket server and
 * expects an app that can answer it. An endpoint runs nothing but itself.
 */
import type { RequestEvent } from "@sveltejs/kit"
import { guardRecovery } from "./guard"
import { collectRecoveryPageData, renderRecoveryHome } from "./pages"

const DONE_NOTICES: Record<string, { kind: "ok"; text: string } | undefined> = {
	"backup-deleted": {
		kind: "ok",
		text: "That backup file has been deleted. Everything else is where it was."
	},
	"directory-deleted": {
		kind: "ok",
		text: "That set-aside database directory has been deleted."
	}
}

export async function GET(event: RequestEvent) {
	const refused = await guardRecovery(event)
	if (refused) return refused

	// A one-shot notice from a redirect, so a completed delete can say so on the
	// page it comes back to without a session to hold it. A fixed set of codes
	// rather than the message itself: reflecting caller-supplied text onto a
	// page that offers unauthenticated destructive actions is a way to put words
	// in this app's mouth, and there are only ever two things to say.
	const notice = DONE_NOTICES[event.url.searchParams.get("done") ?? ""]

	return renderRecoveryHome(await collectRecoveryPageData(notice))
}
