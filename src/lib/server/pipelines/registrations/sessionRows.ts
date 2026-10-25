/**
 * 🚧 A session's own registration rows for one action (PLAN-layering D7,
 * §11-1): its enabled-when override (U5e) as the row's `when` (R31). The
 * on/off toggle is `setSessionFunction` (`entities/sessionGenres.ts`).
 */
import { and, eq } from "drizzle-orm"
import type { EnabledWhen } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { effectiveRegistrations, invalidateRegistrations } from "$lib/server/pipelines/registrations/resolve"
import { actionRegistrationKey, registrationScopeWhere, rowOfChange } from "$lib/server/pipelines/registrations/rows"

/**
 * Set (or with `null` clear) the session's enabled-when override for one
 * action: on the session's own registering row when it has one, else on a
 * change row under the action's registration key (`trigger_ref` names the
 * action, so a verb no registration carries is found too). A change row left
 * with nothing to say is removed.
 */
export async function setSessionActionWhen(
	db: Db,
	sessionId: number,
	identity: string,
	list: ReadonlyArray<EnabledWhen> | null,
	origin: string
): Promise<void> {
	const resolved = await effectiveRegistrations(db, sessionId)
	const key =
		[...(resolved?.offered ?? []), ...(resolved?.effective ?? [])].find(
			(r) => r.trigger.family === "action" && r.trigger.action === identity
		)?.key ?? actionRegistrationKey(identity)
	const where = and(
		registrationScopeWhere({ kind: "session", sessionId }),
		eq(schema.registrations.key, key)
	)
	const [row] = await db.select().from(schema.registrations).where(where).limit(1)
	const when = list ? ({ all: [...list] } as Record<string, unknown>) : null
	if (row) {
		const isChange = !row.triggerFamily && !row.dropped
		const empty =
			isChange &&
			!when &&
			row.values == null &&
			row.mode == null &&
			row.allowStacking == null &&
			row.minAge == null &&
			row.caps == null &&
			row.order == null
		if (empty) await db.delete(schema.registrations).where(eq(schema.registrations.id, row.id))
		else
			await db
				.update(schema.registrations)
				.set({ when, triggerRef: row.triggerRef ?? identity, updatedAt: new Date() })
				.where(eq(schema.registrations.id, row.id))
	} else if (when) {
		await db
			.insert(schema.registrations)
			.values({ ...rowOfChange({ key, when: when as never }, { kind: "session", sessionId }, origin), triggerRef: identity })
	}
	invalidateRegistrations()
}
