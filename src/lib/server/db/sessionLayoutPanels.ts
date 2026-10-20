/**
 * ⏳ TRANSITIONAL — the boot pass that brings every stored session layout to
 * **panels** (`PLAN-session-panels-2026-10-14` §2, owner D6). Delete this
 * file, its `session-layouts` startup task and its tests at the 0.7 squash,
 * together with the SDK's `panelsFromSlots` and the three old slots.
 *
 * Two steps, in this order, each idempotent:
 *
 * 1. **Completing pre-copy-model rows** (`completeSessionLayouts`, brief 3 of
 *    `PLAN-layout-one-format-2026-09-28`). Before the copy model a
 *    `session_panel_layouts` row held only the slots its person had set, and
 *    the page drew every missing slot from a BASE: the preset the row pinned
 *    (`layout_preset_id`) if it still resolved for that person, else the genre
 *    default layout. Each such row is made whole ONCE with what the screen
 *    drew: its own slot if set, else the base's; a row with no arrangement of
 *    its own takes the base's `panels` too. The base's `widgetSettings` fold
 *    into this person's `widget_settings` rows as `widgetSettingDeviations`
 *    lays them; `started from` = the pin where it still resolved, else the
 *    genre default layout's row; `layout_copied_at` = now. Selected by
 *    `layout_copied_at IS NULL`, the one marker only a pre-copy row carries.
 *
 * 2. **Converting to panels** (`convertLayoutsToPanels`). Every
 *    `session_panel_layouts` row, and every person's own
 *    (`origin = 'user'`) `session_layout_presets` row, whose `layout` has no
 *    `panels` but does hold an ⏳ old slot (`zoneLayout`, `widgetGrid`,
 *    `arrangedGrid`) gets `layout.panels = panelsFromSlots(layout)`. The old
 *    slots stay on the row, inert, until the 0.7 squash; nothing else the
 *    row holds moves, and `layout_updated_at` does not (the drawing is the
 *    same, so no session may read the preset as **Updated**).
 *
 *    Left alone, on purpose:
 *    - a row already carrying `panels` — not rewritten, byte for byte;
 *    - a row with no old slot (`{}`, **Start from scratch**): it places
 *      nothing, and the page draws its floor;
 *    - a row whose conversion would place only the floor's conversation
 *      (the old slots put no `messages` anywhere and nothing in the middle):
 *      stored `panels` always name a primary, which would turn the floor —
 *      the genre's primary, whatever it is — into a placed `messages`.
 *      Readers convert such a row on the fly (`panelsOf`), as before;
 *    - core rows (`origin = 'core'`), which the `layout-presets` reconciler
 *      re-seeds from the catalogue each boot, already in `panels`;
 *    - plugin rows (`origin = 'plugin'`), which `syncPluginLayouts` keeps
 *      equal to the manifest: writing `panels` into one would read as a
 *      moved layout at the next sync and bump `layout_updated_at` every boot.
 *      Readers reach them through `panelsOf`.
 *
 * It is a boot step and not a migration, per the boot defaults-sync rule: it
 * reads shipped rows the reconcilers write, so it runs after both of them.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { db } from "."
import * as schema from "./schema"
import { canApplyLayoutPreset, genreDefaultLayoutRow } from "./layoutPresets"
import { widgetSettingDeviations } from "$lib/shared/widgets/settings"
import { OLD_LAYOUT_SLOTS as SLOTS, panelsToWrite } from "./panelsFromStored"

type Blob = Record<string, unknown>


/** The genre a session answered to before, when its row is gone. */
const FALLBACK_GENRE = "core:genre/story" // Story since 2026-10-19 (was Chat, now the assistant)

const isObj = (v: unknown): v is Blob =>
	!!v && typeof v === "object" && !Array.isArray(v)

/**
 * Step 1: make every pre-copy-model row whole, each in its own transaction. Returns
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
	// A row with no arrangement of its own drew the base's whole, `panels`
	// included; one with its own `panels` drew those alone.
	const own: Blob = isObj(row.layout) ? row.layout : {}
	const layout: Blob = { ...own }
	if (own.panels === undefined) {
		for (const slot of SLOTS) {
			const v = own[slot] ?? base[slot]
			if (v === undefined) delete layout[slot]
			else layout[slot] = v
		}
		if (!SLOTS.some((s) => own[s] !== undefined) && base.panels !== undefined)
			layout.panels = base.panels
	}

	// The base's widget settings and this person's own, laid as the one
	// reader lays them (`widgetSettingDeviations`), then stored.
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
			).map((r) => [r.widgetInstanceId, isObj(r.values) ? r.values : {}])
		)
		for (const [widgetInstanceId, preset] of Object.entries(
			base.widgetSettings
		)) {
			if (!isObj(preset)) continue
			const had = mine.get(widgetInstanceId) ?? {}
			const values = widgetSettingDeviations({ preset, stored: had })
			if (!Object.keys(values).length) continue
			if (JSON.stringify(values) === JSON.stringify(had)) continue
			await tx
				.insert(schema.widgetSettings)
				.values({
					sessionId: row.sessionId,
					userId: row.userId,
					widgetInstanceId,
					values
				})
				.onConflictDoUpdate({
					target: [
						schema.widgetSettings.userId,
						schema.widgetSettings.sessionId,
						schema.widgetSettings.widgetInstanceId
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

/** What the boot pass did. */
export interface SessionLayoutPanelsReport {
	/** Pre-copy-model session layout rows made whole (step 1). */
	completed: number
	/** Session layout rows given `panels` (step 2). */
	sessions: number
	/** A person's own session layout presets given `panels` (step 2). */
	presets: number
	/** Rows left to `panelsOf` because they would place only the floor. */
	floorOnly: number
}

/** Step 2 over one table: every row whose `layout->'panels'` is absent. */
async function convertTable(
	table: typeof schema.sessionPanelLayouts | typeof schema.sessionLayoutPresets,
	only?: ReturnType<typeof eq>
): Promise<{ written: number; floorOnly: number }> {
	const noPanels = sql`(${table.layout} -> 'panels') IS NULL`
	const rows = await db
		.select({ id: table.id, layout: table.layout })
		.from(table)
		.where(only ? and(noPanels, only) : noPanels)
		.orderBy(asc(table.id))
	let written = 0
	let floorOnly = 0
	for (const row of rows) {
		const panels = panelsToWrite(row.layout)
		if (panels === "floor") floorOnly++
		if (!panels || panels === "floor") continue
		try {
			const done = await db
				.update(table)
				.set({ layout: { ...(row.layout as Blob), panels } })
				// Only if nobody wrote `panels` since the read.
				.where(and(eq(table.id, row.id), noPanels))
				.returning({ id: table.id })
			if (done.length) written++
		} catch (err) {
			console.error(
				`[session-layouts] could not convert layout row ${row.id} to panels; ` +
					`left as it was, retried next boot:`,
				err
			)
		}
	}
	return { written, floorOnly }
}

/**
 * Step 2: give every stored session layout, and every person's own session
 * layout preset, its `panels` (see the module header for what is left alone).
 */
export async function convertLayoutsToPanels(): Promise<
	Omit<SessionLayoutPanelsReport, "completed">
> {
	const s = await convertTable(schema.sessionPanelLayouts)
	const p = await convertTable(
		schema.sessionLayoutPresets,
		eq(schema.sessionLayoutPresets.origin, "user")
	)
	return {
		sessions: s.written,
		presets: p.written,
		floorOnly: s.floorOnly + p.floorOnly
	}
}

/** The `session-layouts` startup task: both steps, one log line. */
export async function sessionLayoutPanels(): Promise<SessionLayoutPanelsReport> {
	const completed = await completeSessionLayouts()
	const converted = await convertLayoutsToPanels()
	const report = { completed, ...converted }
	console.info(
		`[session-layouts] panels: ${report.sessions} session layout(s) and ` +
			`${report.presets} saved layout(s) converted; ${report.completed} ` +
			`pre-copy row(s) made whole; ${report.floorOnly} left to the floor`
	)
	return report
}
