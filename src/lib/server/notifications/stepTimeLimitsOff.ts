/**
 * The `step-time-limits-off` producer (lane dbg-1, owner 2026-11-15): while the diagnostic switch *Turn off step
 * time limits* is on, every administrator holds one open row that lands on Admin › Diagnostics, where the switch
 * is. It is a condition: it clears only when the switch goes off (`clearedHow` `acted`).
 *
 * Called by the `systemSettings:updateStepTimeLimitsOff` handler after the write. 🚧 Provisional vocabulary.
 *
 * - **On** — raise for every administrator who is not deleted (`raiseNotification` keeps one open row per user
 *   and `regarding`, so turning it on twice raises nothing new).
 * - **Off** — clear every open row.
 *
 * Never throws.
 */
import { and, eq } from "drizzle-orm"
import { db as appDb } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { STEP_TIME_LIMITS_OFF, regardingFor } from "$lib/shared/notifications/kinds"
import { clearNotifications, raiseNotification } from "./store"

/** Where the row lands: the switch, on Admin › Diagnostics. */
export const STEP_TIME_LIMITS_HREF = "/admin/diagnostics#step-time-limits"

export async function syncStepTimeLimitsNotice(on: boolean, db?: Db): Promise<void> {
	const d = (db ?? appDb) as unknown as Db
	const regarding = regardingFor.stepTimeLimitsOff()
	try {
		if (!on) {
			await clearNotifications({ regarding }, "acted", d)
			return
		}
		const admins = await d
			.select({ id: schema.users.id })
			.from(schema.users)
			.where(and(eq(schema.users.isAdmin, true), eq(schema.users.isDeleted, false)))
		await raiseNotification(
			{
				userIds: admins.map((a) => a.id),
				kind: STEP_TIME_LIMITS_OFF.id,
				regarding,
				href: STEP_TIME_LIMITS_HREF
			},
			d
		)
	} catch (err) {
		console.error("[notifications] step-time-limits-off:", err)
	}
}
