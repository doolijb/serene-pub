/**
 * Who the session page answers each request kind for (F9) — enforced once,
 * in front of every answer, off the SDK's marking (`WIDGET_REQUEST_ASKERS`):
 * core's writes to core's own widgets, a request that reads scoped data to a
 * widget holding its scope, the rest to anyone.
 *
 * One door rather than a check per case: a kind added to the SDK says who may
 * ask it there, and this page holds it to that without a line of its own. A
 * request that passes is still not a grant — each answer keeps its own rules
 * (an admin's view, an image off the app's origin).
 */
import { widgetRequestRefusal } from "@serene-pub/sdk"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

/**
 * `answer`, behind the askers table: a widget that may not ask a kind is
 * declined with the table's sentence before any of `answer` runs. `from.grants`
 * are BARE scopes (`lore`), as the widget wire sends them.
 */
export function guardWidgetRequests(answer: WidgetRequestHandler): WidgetRequestHandler {
	return ((kind, params, from) => {
		const refused = widgetRequestRefusal(kind, { owner: from.owner, grants: from.grants })
		if (refused) return Promise.reject(new Error(refused))
		return answer(kind, params, from)
	}) as WidgetRequestHandler
}
