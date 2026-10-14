/**
 * Who the session page answers each request kind for (F9) — enforced once,
 * in front of every answer, off the SDK's marking (`WIDGET_REQUEST_ASKERS`):
 * a scoped read to a widget holding its scope, a write to core's widgets or
 * to a plugin's holding the write grant (D4, ruled Q2), the rest to anyone.
 *
 * One door rather than a check per case: a kind added to the SDK says who may
 * ask it there, and this page holds it to that without a line of its own. A
 * request that passes is still not a grant — each answer keeps its own rules
 * (an admin's view, an image off the app's origin, a plugin's write held to
 * its channel by `send` and `draft` and to its grant by each write's own
 * `holdsWidgetGrant`).
 *
 * This page is the boundary between a plugin's code and the viewer's
 * authority: a plugin's widget runs in a worker with `connect-src 'none'`
 * (or an opaque-origin frame) and reaches the viewer's socket only through
 * these answers. The server then judges each write as the viewer's own
 * (`state:set`, the composer's send) — it cannot tell a widget's press from
 * the viewer's, and needs not: the viewer may make that write themselves.
 */
import { widgetRequestRefusal } from "@serene-pub/sdk"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

/** Which widget asks, as a `WidgetRequestHandler` is handed it. */
type From = Parameters<WidgetRequestHandler>[2]

/**
 * The asking widget's declared channels (`WidgetDecl.channels`), which the
 * widget wire carries beside `from` — none when it carried none, so a channel
 * write from a widget that declares no channel is refused.
 */
export function declaredChannelsOf(from: From): string[] {
	const channels: unknown = from.channels
	return Array.isArray(channels) ? channels.filter((c): c is string => typeof c === "string") : []
}

/**
 * Does the asking widget hold this BARE grant (`session:state:write`,
 * `channel:dice:write`)? Core's widgets hold every grant; a plugin's only
 * what its `grants` list — a list, never a string whose `includes` would
 * match a substring. Each write answer asks it again, so the page's answer
 * refuses on its own even if the door in front of it were skipped.
 */
export function holdsWidgetGrant(from: From | undefined, grant: string): boolean {
	if (!from || from.owner === "core") return true
	return Array.isArray(from.grants) && from.grants.includes(grant)
}

/**
 * `answer`, behind the askers table: a widget that may not ask a kind is
 * declined with the table's sentence before any of `answer` runs. `from.grants`
 * are BARE scopes (`lore`, `session:state:write`), as the widget wire sends
 * them; a channel write is judged against the widget's declared channels and
 * the channel the params name.
 */
export function guardWidgetRequests(answer: WidgetRequestHandler): WidgetRequestHandler {
	return ((kind, params, from) => {
		const asker = { owner: from.owner, grants: from.grants, channels: declaredChannelsOf(from) }
		const refused = widgetRequestRefusal(kind, asker, params)
		if (refused) return Promise.reject(new Error(refused))
		return answer(kind, params, from)
	}) as WidgetRequestHandler
}
