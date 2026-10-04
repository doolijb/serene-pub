/**
 * ⏳ TRANSITIONAL — the one-shot boot step that makes a pre-copy-model
 * **session layout** row whole (brief 3 of `PLAN-layout-one-format-2026-09-28`).
 * Delete this file, its `session-layouts` startup task and its test at the
 * pre-release migrations squash: by then no row can predate the copy model.
 *
 * ## Why it exists
 *
 * Before the copy model a `session_panel_layouts` row held only the slots its
 * person had set, and the page drew every missing slot from a BASE: the preset
 * the row pinned (`layout_preset_id`) if it still resolved for that person,
 * else the genre default layout, else nothing. The base's `widgetSettings` sat
 * UNDER the person's own values, widget by widget and field by field. The copy
 * model reads the row alone, so each such row is made whole ONCE, with exactly
 * what the screen drew:
 *
 * - `layout`, slot by slot: the row's own slot if set, else the base's (the
 *   old `slot ?? base slot`, applied once). `active`, `tierSizeOverrides` and
 *   anything else the row holds are kept as they are.
 * - the base's `widgetSettings` fold into this person's `widget_settings` rows
 *   UNDER their own values (fill only).
 * - `started from` = the pin where it still resolved, else the genre default
 *   layout's row; `layout_copied_at` = now.
 *
 * The base is composed as the page composed it (`{ ...preset.layout,
 * ...layout_settings }`), and style pins were only ever read from the row's
 * own `layout_settings`, so they are left untouched.
 *
 * A row is selected by `layout_copied_at IS NULL` — the one marker only a
 * pre-copy row carries, since every write under the copy model stamps it — so
 * the step is idempotent and a finished row is never selected again. It is a
 * boot step and not a migration, per the boot defaults-sync rule: it reads
 * shipped rows the reconcilers write, so it runs after both of them.
 *
 * A session a person never opened has no row; it is copied on first open from
 * whatever their new-session layout is by then.
 */
import { and, asc, eq, isNull } from "drizzle-orm"
import { db } from "."
import * as schema from "./schema"
import { canApplyLayoutPreset, genreDefaultLayoutRow } from "./layoutPresets"

type Blob = Record<string, unknown>

const SLOTS = ["zoneLayout", "widgetGrid", "arrangedGrid"] as const

/** The genre a session answered to before, when its row is gone. */
const FALLBACK_GENRE = "core:genre/chat"

const isObj = (v: unknown): v is Blob =>
	!!v && typeof v === "object" && !Array.isArray(v)

/**
 * Make every pre-copy-model row whole, each in its own transaction. Returns
 * how many rows it finished; `0` on every boot after the first.
 *
 * A row that fails is logged by id and left as it was (its transaction rolled
 * back, `layout_copied_at` still null), and the step goes on to the next: one
 * bad row must not leave every later row unfinished, boot after boot. The
 * failed row is drawn from itself alone until a later boot finishes it.
 */
export async function completeSessionLayouts(): Promise<number> {
	const pending = await db
		.select({ id: schema.sessionPanelLayouts.id })
		.from(schema.sessionPanelLayouts)
		.where(isNull(schema.sessionPanelLayouts.layoutCopiedAt))
		.orderBy(asc(schema.sessionPanelLayouts.id))
	let done = 0
	let failed = 0
	for (const { id } of pending) {
		try {
			if (await db.transaction((tx) => completeRow(tx, id))) done++
		} catch (err) {
			failed++
			console.error(
				`[session-layouts] could not make session layout row ${id} whole; ` +
					`left as it was, retried next boot:`,
				err
			)
		}
	}
	if (done)
		console.info(
			`[session-layouts] made ${done} session layout(s) whole for the copy model`
		)
	if (failed)
		console.warn(`[session-layouts] ${failed} session layout row(s) left unfinished`)
	return done
}

async function completeRow(tx: Db, id: number): Promise<boolean> {
	// Re-read under the transaction: a person's own write may have finished it.
	const [row] = await tx
		.select()
		.from(schema.sessionPanelLayouts)
		.where(
			and(
				eq(schema.sessionPanelLayouts.id, id),
				isNull(schema.sessionPanelLayouts.layoutCopiedAt)
			)
		)
		.limit(1)
	if (!row) return false
	const [session] = await tx
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, row.sessionId))
		.limit(1)
	const genreId = session?.genreId ?? FALLBACK_GENRE

	// The base the page drew under this row, found as the server found it.
	let preset: Blob = {}
	let from: number | null = null
	const pin = row.startedFromLayoutPresetId
	if (pin != null && (await canApplyLayoutPreset(pin, genreId, row.userId, tx))) {
		const [pinned] = await tx
			.select({ layout: schema.sessionLayoutPresets.layout })
			.from(schema.sessionLayoutPresets)
			.where(eq(schema.sessionLayoutPresets.id, pin))
			.limit(1)
		if (pinned) {
			preset = isObj(pinned.layout) ? pinned.layout : {}
			from = pin
		}
	}
	if (from === null) {
		const def = await genreDefaultLayoutRow(genreId, tx)
		if (def) {
			preset = isObj(def.layout) ? def.layout : {}
			from = def.id
		}
	}
	const base: Blob = {
		...preset,
		...(isObj(row.layoutSettings) ? row.layoutSettings : {})
	}

	// The arrangement, slot by slot, with everything else the row holds kept.
	const own: Blob = isObj(row.layout) ? row.layout : {}
	const layout: Blob = { ...own }
	for (const slot of SLOTS) {
		const v = own[slot] ?? base[slot]
		if (v === undefined) delete layout[slot]
		else layout[slot] = v
	}

	// The base's widget settings, UNDER this person's own, field by field.
	if (isObj(base.widgetSettings)) {
		const mine = new Map(
			(
				await tx
					.select()
					.from(schema.widgetSettings)
					.where(
						and(
							eq(schema.widgetSettings.sessionId, row.sessionId),
							eq(schema.widgetSettings.userId, row.userId)
						)
					)
			).map((r) => [r.widgetSlug, isObj(r.values) ? r.values : {}])
		)
		for (const [widgetSlug, pinned] of Object.entries(base.widgetSettings)) {
			if (!isObj(pinned)) continue
			const had = mine.get(widgetSlug) ?? {}
			const values = { ...pinned, ...had }
			if (!Object.keys(values).length) continue
			if (JSON.stringify(values) === JSON.stringify(had)) continue
			await tx
				.insert(schema.widgetSettings)
				.values({
					sessionId: row.sessionId,
					userId: row.userId,
					widgetSlug,
					values
				})
				.onConflictDoUpdate({
					target: [
						schema.widgetSettings.userId,
						schema.widgetSettings.sessionId,
						schema.widgetSettings.widgetSlug
					],
					set: { values, updatedAt: new Date() }
				})
		}
	}

	await tx
		.update(schema.sessionPanelLayouts)
		.set({
			layout,
			startedFromLayoutPresetId: from,
			layoutCopiedAt: new Date()
		})
		.where(
			and(
				eq(schema.sessionPanelLayouts.id, id),
				isNull(schema.sessionPanelLayouts.layoutCopiedAt)
			)
		)
	return true
}
