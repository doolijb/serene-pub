/**
 * The notifications managed service: boot reconciliation.
 *
 * Open rows can outlive the facts they were raised for — a restart drops every
 * in-memory park, and a crash between a decision and its clear loses the
 * clear. Boot settles both, each in one statement or one pass, because
 * `reconcileServices` runs inside `appReady`, which every request awaits.
 *
 * Producers add their own re-checks here as they land (a your-move row whose
 * person is not at the head of the stored order, an open-form row whose
 * form was answered or went stale).
 */
import {
	lapseMemoryBackedNotifications,
	pruneNotifications
} from "./store"
import { OPEN_FORM, YOUR_MOVE } from "$lib/shared/notifications/kinds"
import { wireActivityNotifications } from "./activity"

type Recheck = (db: Db) => Promise<void>

const RECHECKS_KEY = Symbol.for("serene-pub.notificationRechecks")
const rechecks = ((globalThis as Record<symbol, unknown>)[RECHECKS_KEY] ??=
	new Map<string, Recheck>()) as Map<string, Recheck>

/**
 * Register a boot re-check for a kind. Keyed by kind id, so a module evaluated
 * twice under HMR replaces rather than duplicates.
 */
export function registerNotificationRecheck(kind: string, recheck: Recheck) {
	rechecks.set(kind, recheck)
}

// Core's own re-checks, registered here so they are in the map before
// `reconcileNotificationsOnBoot` runs — a producer module loaded lazily (on
// the first session event) would register too late. Each is imported lazily.
registerNotificationRecheck(YOUR_MOVE.id, async (db) =>
	(await import("./yourMove")).recheckYourMove(db)
)
registerNotificationRecheck(OPEN_FORM.id, async (db) =>
	(await import("./openForm")).recheckOpenForms(db)
)

// Finished activities (graph builds, summaries, compiles) raise through the
// activity store's notifier seam, filled here once at boot. Nothing to
// re-check: they live in memory, so the lapse sweep below settles them.
wireActivityNotifications()

export async function reconcileNotificationsOnBoot(): Promise<void> {
	const db = (await import("$lib/server/db")).db as unknown as Db
	try {
		const lapsed = await lapseMemoryBackedNotifications(db)
		if (lapsed) console.log(`[notifications] ${lapsed} lapsed at boot`)
	} catch (err) {
		console.error("[notifications] lapse sweep failed:", err)
	}
	for (const [kind, recheck] of rechecks) {
		try {
			await recheck(db)
		} catch (err) {
			console.error(`[notifications] boot re-check for ${kind} failed:`, err)
		}
	}
	try {
		await pruneNotifications(db)
	} catch (err) {
		console.error("[notifications] prune failed:", err)
	}
}
