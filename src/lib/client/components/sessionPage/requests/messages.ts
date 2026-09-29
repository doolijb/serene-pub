/**
 * 🚧 `messages` (anyone may ask): the next older page of the session's
 * lines. The page's own pager answers; the request's `channel`, `cursor`
 * and `limit` are not read — every widget pages the one window the page
 * holds.
 */
import type { WidgetRequests } from "@serene-pub/sdk"

type Result = WidgetRequests["messages"]["result"]

/** What this answer needs of the page. */
export interface MessagesDeps {
	olderPage(): Promise<Result>
}

/** Answer one `messages` with the page's next older page. */
export async function answerMessages(_params: unknown, deps: MessagesDeps): Promise<Result> {
	return await deps.olderPage()
}
