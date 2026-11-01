import type { WidgetRequests } from "@serene-pub/sdk"
import { statusText } from "$lib/client/i18n/state.svelte"
import { notifications } from "$lib/client/notifications/notifications.svelte"
import { notify } from "$lib/client/utils/notify"
import { WIDGET_NOTICE } from "$lib/shared/notifications/kinds"

/** At most one accepted notice per widget in this many ms. */
export const NOTIFY_RATE_MS = 2000

const lastAccepted = new Map<string, number>()
const actionWarned = new Set<string>()

/**
 * 🚧 `notify` (M0, SHAPES L6): a widget's notice in the app's one
 * toaster. The toast's `source` is the widget, so its next notice replaces its
 * last. `sticky` also lists it in Activity for this visit. `action` is not
 * drawn yet.
 */
export function answerNotify(
	params: WidgetRequests["notify"]["params"],
	from: { widgetId: string; owner: string },
	sessionId: number | null,
	now: () => number = Date.now
): void {
	const kind = params.kind
	if (kind !== "info" && kind !== "success" && kind !== "warning")
		throw new Error("A notice is info, success or warning.")
	const text = statusText({ i18n: params.text })
	if (typeof text !== "string" || !text.trim())
		throw new Error("A notice needs some text.")

	const key = `${from.owner}:${from.widgetId}`
	const t = now()
	const last = lastAccepted.get(key)
	if (last !== undefined && t - last < NOTIFY_RATE_MS) {
		console.info(`[notify] dropped a notice from ${key}: one each 2 s.`)
		return
	}
	lastAccepted.set(key, t)

	if (params.action && !actionWarned.has(key)) {
		actionWarned.add(key)
		console.info(
			"[notify] action buttons are not delivered yet; the notice was shown without one."
		)
	}

	notify[kind]({ title: text, source: `widget:${key}` })

	if (params.sticky && sessionId != null) {
		notifications.raiseLocal({
			kind: WIDGET_NOTICE.id,
			regarding: `session:${sessionId}/widget:${key}`,
			level: kind === "warning" ? "attention" : "info",
			href: `/sessions/${sessionId}`,
			vars: { text, session: "this session" }
		})
	}
}
