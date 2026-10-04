/**
 * The `update-available` producer (PLAN-notifications §5): a newer release on
 * this install's channel raises a row for every admin. The row lands on
 * Admin › Updates, which says how this install gets the release — the in-app
 * update where the launcher can apply it, the releases page where it cannot.
 *
 * Called by `updates/updateCheck.ts` after each SUCCESSFUL check (at most
 * daily, never on a pre-release) with the notifiable tag, or null when the
 * running version is current.
 *
 * - **Raise** — only when the tag is one nobody has been told about yet. Every
 *   stored `app:update` row, open or cleared, counts as "told": an admin who
 *   dismissed `v0.7.0` is not asked again tomorrow, nor after a restart.
 * - **Superseded** — a newer tag clears the open rows of the older one before
 *   raising; a check that finds nothing newer (the pub now runs it) clears
 *   every open row.
 *
 * Never throws.
 */
import { and, eq } from "drizzle-orm"
import { db as appDb } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { UPDATE_AVAILABLE, regardingFor } from "$lib/shared/notifications/kinds"
import { clearNotifications, raiseNotification } from "./store"

/** Where the row lands: Admin › Updates. */
export const UPDATE_HREF = "/admin/updates"

export async function syncUpdateNotifications(
	tag: string | null,
	db?: Db
): Promise<void> {
	const d = (db ?? appDb) as unknown as Db
	const regarding = regardingFor.update()
	try {
		if (!tag) {
			await clearNotifications({ regarding }, "superseded", d)
			return
		}
		const T = schema.notifications
		const rows = await d
			.select({ vars: T.vars, clearedAt: T.clearedAt })
			.from(T)
			.where(eq(T.regarding, regarding))
		if (rows.some((r) => (r.vars as { tag?: unknown } | null)?.tag === tag))
			return
		if (rows.some((r) => r.clearedAt === null))
			await clearNotifications({ regarding }, "superseded", d)
		const admins = await d
			.select({ id: schema.users.id })
			.from(schema.users)
			.where(
				and(
					eq(schema.users.isAdmin, true),
					eq(schema.users.isDeleted, false)
				)
			)
		await raiseNotification(
			{
				userIds: admins.map((a) => a.id),
				kind: UPDATE_AVAILABLE.id,
				regarding,
				href: UPDATE_HREF,
				vars: { tag }
			},
			d
		)
	} catch (err) {
		console.error("[notifications] update-available:", err)
	}
}
