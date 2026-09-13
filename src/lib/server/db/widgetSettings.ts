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
 * plugin prunes its own on install/update. A row for a widget outside that set
 * is untouched — an unread value is harmless, and an absent declaration is not
 * evidence the widget is gone.
 *
 * The write is conditional on the prune actually changing something, so a boot
 * with nothing to fix issues no statements and bumps no `updatedAt`.
 */
import { and, eq, inArray, notInArray } from "drizzle-orm"
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
	widgetSlug: string
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

	const rows = await db
		.select()
		.from(schema.widgetSettings)
		.where(inArray(schema.widgetSettings.widgetSlug, widgetIds))
	if (!rows.length) return []

	const schemas = new Map(
		decls.map((d) => [d.id, widgetSettingsSchema(d)] as const)
	)
	const dropped: DroppedWidgetSetting[] = []

	for (const row of rows) {
		const fields = schemas.get(row.widgetSlug)
		if (!fields) continue
		const result = pruneWidgetSettings(fields, row.values)
		for (const d of result.dropped)
			dropped.push({
				widgetSlug: row.widgetSlug,
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
							`${d.widgetSlug}.${d.key} (${d.reason}, session ` +
							`${d.sessionId}, user ${d.userId})`
					)
					.join(", ")
		)
	return dropped
}

/** This user's stored deviations for one session, keyed by widget id. */
export async function readWidgetSettings(
	sessionId: number,
	userId: number
): Promise<Record<string, Record<string, unknown>>> {
	const rows = await db
		.select({
			widgetSlug: schema.widgetSettings.widgetSlug,
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
			out[r.widgetSlug] = r.values
	return out
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
						schema.widgetSettings.widgetSlug,
						keep.map(([slug]) => slug)
					)
				)
			: mine
	)
	for (const [widgetSlug, values] of keep)
		await db
			.insert(schema.widgetSettings)
			.values({ sessionId, userId, widgetSlug, values })
			.onConflictDoUpdate({
				target: [
					schema.widgetSettings.userId,
					schema.widgetSettings.sessionId,
					schema.widgetSettings.widgetSlug
				],
				set: { values, updatedAt: new Date() }
			})
}
