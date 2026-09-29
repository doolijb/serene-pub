/**
 * The activity producer (PLAN-notifications §5): a background job of yours —
 * a graph build, a scene summary, a history compile, a session lore summary —
 * that finished raises one notification, for its OWNER only. An administrator
 * sees everyone's cards in the Activity view, but somebody else's review is
 * not waiting on them.
 *
 * - reaches `review` → `ACTIVITY_READY`; reaches `error` → `ACTIVITY_FAILED`,
 *   under the same `regarding`, so a failure replaces a ready row.
 * - the card goes (`activityStore.remove`) → the row clears with the reason
 *   the store was given: `acted` (saved/applied), `dismissed`, `superseded`.
 * - a restart drops every activity; both kinds are `memoryBacked`, so the boot
 *   sweep lapses their rows.
 *
 * The href is the DURABLE subject — the lorebook place or the session — never
 * the card, which is gone after a restart or a dismiss.
 *
 * Reached through `activityStore`'s notifier seam, wired once at boot by
 * `wireActivityNotifications` (`notifications/service.ts`), so the store never
 * imports the database. Never throws.
 */
import type {
	Activity,
	ActivityClearedHow
} from "$lib/server/utils/activityStore"
import { activityStore } from "$lib/server/utils/activityStore"
import { toHash, type LoreRoute } from "$lib/shared/lorebooks/loreRoute"
import {
	ACTIVITY_FAILED,
	ACTIVITY_READY,
	regardingFor,
	sessionHref,
	type NotificationVars
} from "$lib/shared/notifications/kinds"
import { clearNotifications, raiseNotification } from "./store"

/** The job's name in the row's `{job}` — the words its Activity card uses. */
export function activityJob(activity: Activity): string {
	switch (activity.kind) {
		case "graph_build":
			return "Graph build"
		case "scene_summarize":
			return "Scene summary"
		case "compile_history_entry":
			return "History compile"
		case "session_summarize":
			return activity.loreType === "world"
				? "World lore summary"
				: "Character lore summary"
	}
}

/** What it was about, in the row's `{subject}`: the card's own title line. */
export function activitySubject(activity: Activity): string {
	const parts: (string | undefined)[] = []
	switch (activity.kind) {
		case "graph_build":
			parts.push(activity.lorebookLabel)
			break
		case "scene_summarize":
			parts.push(activity.sceneName, activity.lorebookLabel)
			break
		case "compile_history_entry":
			parts.push(activity.historyEntryDate, activity.lorebookLabel)
			break
		case "session_summarize":
			parts.push(activity.topic || activity.sessionLabel)
			break
	}
	return parts
		.map((p) => p?.trim())
		.filter(Boolean)
		.join(" · ")
}

function loreHref(route: LoreRoute): string {
	return `/lorebooks${toHash(route)}`
}

/**
 * Where the call to action goes: the place the result lands, addressed the
 * way the Activity card's own navigation addresses it (`ActivitySidebar`'s
 * `navigate*`). A lore address rides `/lorebooks#lore=…`, which `openHref`
 * opens as the Lorebooks view.
 *
 * ⚠ A session summary lands on the session only. Its review modal is reopened
 * by the card (`sessionSummarizesCtx.setReviewActivityId`), which an href
 * cannot carry yet.
 */
export function activityHref(activity: Activity): string {
	switch (activity.kind) {
		case "graph_build":
			return loreHref({
				lorebookId: activity.lorebookId,
				scope: "all",
				lens: "graph"
			})
		case "scene_summarize":
			// A scene is addressed under the history entry it was compiled
			// into, so one with no entry yet is the History list.
			return loreHref(
				activity.historyEntryId
					? {
							lorebookId: activity.lorebookId,
							scope: "scenes",
							entryId: activity.historyEntryId,
							sceneId: activity.sceneId
						}
					: { lorebookId: activity.lorebookId, scope: "history" }
			)
		case "compile_history_entry":
			return loreHref({
				lorebookId: activity.lorebookId,
				scope: "history",
				entryId: activity.historyEntryId
			})
		case "session_summarize":
			return sessionHref(activity.sessionId)
	}
}

/** The raise for a settled activity, or null while it is still running. */
export function activityNotice(activity: Activity): {
	userIds: number[]
	kind: string
	regarding: string
	href: string
	vars: NotificationVars
} | null {
	const kind =
		activity.status === "review"
			? ACTIVITY_READY.id
			: activity.status === "error"
				? ACTIVITY_FAILED.id
				: null
	if (!kind) return null
	return {
		userIds: [activity.userId],
		kind,
		regarding: regardingFor.activity(activity.id),
		href: activityHref(activity),
		vars: { job: activityJob(activity), subject: activitySubject(activity) }
	}
}

/**
 * One chain per activity, so a clear can never overtake the raise it clears
 * (a review applied within the raise's round trip would otherwise leave the
 * row open).
 */
const chains = new Map<string, Promise<void>>()
function inOrder(activityId: string, step: () => Promise<unknown>): Promise<void> {
	const prior = chains.get(activityId) ?? Promise.resolve()
	const next = prior.then(step).then(
		() => {},
		() => {}
	)
	chains.set(activityId, next)
	void next.then(() => {
		if (chains.get(activityId) === next) chains.delete(activityId)
	})
	return next
}

export function notifyActivitySettled(activity: Activity, db?: Db): Promise<void> {
	const notice = activityNotice(activity)
	if (!notice) return Promise.resolve()
	return inOrder(activity.id, () => raiseNotification(notice, db))
}

export function clearActivityNotification(
	activity: Activity,
	how: ActivityClearedHow,
	db?: Db
): Promise<void> {
	return inOrder(activity.id, () =>
		clearNotifications(
			{
				regarding: regardingFor.activity(activity.id),
				userId: activity.userId
			},
			how,
			db
		)
	)
}

/** Fill `activityStore`'s notifier seam. Idempotent. */
export function wireActivityNotifications(db?: Db): void {
	activityStore.setNotifier({
		settled: (activity) => notifyActivitySettled(activity, db),
		cleared: (activity, how) => clearActivityNotification(activity, how, db)
	})
}
