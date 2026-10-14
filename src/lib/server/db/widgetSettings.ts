/**
 * The widget-settings reconciler (PLAN 25; ruled 2026-09-10).
 *
 * Stored settings are deviations from a widget's declared defaults, so a field
 * the descriptor stops declaring leaves a value nothing reads. This pass prunes
 * them: for each widget being synced it re-runs the shared
 * `pruneWidgetSettings` over every stored row, writes back what still
 * reconciles, deletes a row the prune empties, and returns (and logs) what it
 * dropped.
 *
 * Scope is the widget ids handed in, so core boot prunes core widgets and a
 * plugin prunes its own on install/update. A row is keyed by a widget instance
 * id, so its widget — and the declaration it is pruned against — is
 * `widgetOfInstance` of that id: a placed copy (`messages#sanctum`) is pruned
 * with its widget, and an aliased one (`world-state`, the SDK's
 * `WIDGET_ID_ALIASES`) with the widget it became, the settings the alias
 * implies as its defaults (`widgetSettingsSchema`) — so a World State row's
 * `layout` is rewritten as Stats' `arrangement`, not dropped. A row for a
 * widget outside that set is untouched — an
 * unread value is harmless, and an absent declaration is not evidence the
 * widget is gone.
 *
 * The write is conditional on the prune actually changing something, so a boot
 * with nothing to fix issues no statements and bumps no `updatedAt`.
 */
import { and, eq, inArray, like, notInArray, or } from "drizzle-orm"
import { resolveWidgetAlias, widgetOfInstance } from "@serene-pub/sdk"
import { db } from "."
import * as schema from "./schema"
import {
	pruneWidgetSettings,
	widgetSettingsSchema,
	type SettingDropReason
} from "$lib/shared/widgets/settings"
import type { WidgetDecl } from "$lib/shared/widgets/types"

/** One stored value the prune removed, and where it was. */
export interface DroppedWidgetSetting {
	widgetInstanceId: string
	sessionId: number
	userId: number
	key: string
	reason: SettingDropReason
}

/**
 * Prune stored settings for the given widgets against their current
 * declarations. Idempotent: safe to run every boot.
 */
export async function syncWidgetSettings(
	decls: WidgetDecl[]
): Promise<DroppedWidgetSetting[]> {
	const widgetIds = decls.map((d) => d.id)
	if (!widgetIds.length) return []

	// The widgets themselves, and every placed copy (`<widget id>#<name>`):
	// which copies are in scope is `widgetOfInstance`'s answer below.
	const rows = await db
		.select()
		.from(schema.widgetSettings)
		.where(
			or(
				inArray(schema.widgetSettings.widgetInstanceId, widgetIds),
				like(schema.widgetSettings.widgetInstanceId, "%#%")
			)
		)
	if (!rows.length) return []

	const schemas = new Map(
		decls.map((d) => [d.id, widgetSettingsSchema(d)] as const)
	)
	const declsById = new Map(decls.map((d) => [d.id, d] as const))
	const dropped: DroppedWidgetSetting[] = []

	for (const row of rows) {
		const widget = widgetOfInstance(row.widgetInstanceId)
		const decl = declsById.get(widget)
		// An aliased row's schema is its own: the alias's settings are its defaults.
		const fields =
			decl && resolveWidgetAlias(row.widgetInstanceId).aliasedFrom
				? widgetSettingsSchema({ ...decl, id: row.widgetInstanceId })
				: schemas.get(widget)
		if (!fields) continue
		const result = pruneWidgetSettings(fields, row.values)
		for (const d of result.dropped)
			dropped.push({
				widgetInstanceId: row.widgetInstanceId,
				sessionId: row.sessionId,
				userId: row.userId,
				key: d.key,
				reason: d.reason
			})
		const before = JSON.stringify(row.values ?? {})
		const after = JSON.stringify(result.values)
		if (before === after) continue
		if (!Object.keys(result.values).length) {
			await db
				.delete(schema.widgetSettings)
				.where(eq(schema.widgetSettings.id, row.id))
			continue
		}
		await db
			.update(schema.widgetSettings)
			.set({ values: result.values })
			.where(eq(schema.widgetSettings.id, row.id))
	}

	if (dropped.length)
		console.info(
			`widget settings: dropped ${dropped.length} stored value(s) no ` +
				`longer declared — ` +
				dropped
					.map(
						(d) =>
							`${d.widgetInstanceId}.${d.key} (${d.reason}, session ` +
							`${d.sessionId}, user ${d.userId})`
					)
					.join(", ")
		)
	return dropped
}

/** This user's stored deviations for one session, keyed by widget instance id. */
export async function readWidgetSettings(
	sessionId: number,
	userId: number
): Promise<Record<string, Record<string, unknown>>> {
	const rows = await db
		.select({
			widgetInstanceId: schema.widgetSettings.widgetInstanceId,
			values: schema.widgetSettings.values
		})
		.from(schema.widgetSettings)
		.where(
			and(
				eq(schema.widgetSettings.sessionId, sessionId),
				eq(schema.widgetSettings.userId, userId)
			)
		)
	const out: Record<string, Record<string, unknown>> = {}
	for (const r of rows)
		if (r.values && Object.keys(r.values).length)
			out[r.widgetInstanceId] = r.values
	return out
}

/**
 * The widget instance ids this user ALREADY has a row for in one session.
 *
 * The exemption the seating gate is held to (ruled 2026-09-17): a disable
 * deletes nothing, so a key that is already stored is written back whatever the
 * session can seat today. A plugin turned off stops being offered; the
 * arrangement a person made under it waits for the re-enable, exactly as
 * `announcedWidgetIds` leaves a style already made alone.
 *
 * Ids rather than values, because the gate asks only whether a row exists —
 * `readWidgetSettings` next door is for the reader that wants what is in them,
 * and it drops an empty row this one would still report.
 */
export async function storedWidgetInstanceIds(
	sessionId: number,
	userId: number
): Promise<Set<string>> {
	const rows = await db
		.select({ widgetInstanceId: schema.widgetSettings.widgetInstanceId })
		.from(schema.widgetSettings)
		.where(
			and(
				eq(schema.widgetSettings.sessionId, sessionId),
				eq(schema.widgetSettings.userId, userId)
			)
		)
	return new Set(rows.map((r) => r.widgetInstanceId))
}

/**
 * Replace this user's settings for one session with `next`.
 *
 * A widget whose deviations are empty gets no row: the caller has already
 * pruned to deviations, and storing `{}` would assert an override that is not
 * one. A widget absent from `next` has its row removed for the same reason.
 */
export async function writeWidgetSettings(
	sessionId: number,
	userId: number,
	next: Record<string, Record<string, unknown>>
): Promise<void> {
	const keep = Object.entries(next).filter(
		([, values]) => values && Object.keys(values).length
	)
	const mine = and(
		eq(schema.widgetSettings.sessionId, sessionId),
		eq(schema.widgetSettings.userId, userId)
	)
	// Anything of this user's for this session that is not staying, in one
	// statement — so a widget dropped from `next` loses its row.
	await db.delete(schema.widgetSettings).where(
		keep.length
			? and(
					mine,
					notInArray(
						schema.widgetSettings.widgetInstanceId,
						keep.map(([instanceId]) => instanceId)
					)
				)
			: mine
	)
	for (const [widgetInstanceId, values] of keep)
		await db
			.insert(schema.widgetSettings)
			.values({ sessionId, userId, widgetInstanceId, values })
			.onConflictDoUpdate({
				target: [
					schema.widgetSettings.userId,
					schema.widgetSettings.sessionId,
					schema.widgetSettings.widgetInstanceId
				],
				set: { values, updatedAt: new Date() }
			})
}
