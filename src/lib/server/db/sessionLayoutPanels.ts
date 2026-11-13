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
 * 3. **Converting to panels version 2** (`convertPanelsToV2`,
 *    `PLAN-session-layout-simplify-2026-11-05` D2/D14). Every
 *    `session_panel_layouts` row whose `layout.panels` is absent or version 1,
 *    and every `user` / `pub` `session_layout_presets` row likewise, gets
 *    `panels` version 2 (`storedLayoutAsV2`) and the Messages settings and
 *    style pins that moved to the Composer and Turn line widgets carried onto
 *    them, one transaction per row. Stale `composer*` / `turn-line*` values
 *    are dropped first. `layout_updated_at` never moves.
 *
 *    - It also runs from `dbReady`, BEFORE the boot prune
 *      (`syncWidgetSettings`, PLAN D5): the prune deletes any stored key no
 *      widget declares any more, and `composer` / `nextUp` / `showActions`
 *      are declared by the NEW widgets only.
 *    - A pre-copy row (`layout_copied_at IS NULL`) waits for step 1, which
 *      makes it whole from a base row the startup reconcilers write later;
 *      converting it first would freeze a partial layout. This task's
 *      step 3 runs after steps 1 and 2 and so converts it then.
 *    - A row with no `panels` and no placing old slot (`{}`, or old slots
 *      that place only the floor — `none` / `floor`) gets its SETTINGS moves
 *      and style copies only: readers derive its floor. It is selected only
 *      while those would still change something, so a boot after they are
 *      done reads and writes nothing for it.
 *    - Rows still to convert (pre-copy ones skipped, and ones that failed) are
 *      returned as `pending`; the `dbReady` prune spares their Messages
 *      copies' moved keys (`syncWidgetSettings`'s `spare`) until the startup
 *      task converts them.
 *    - Core and plugin rows are never selected (re-seeded / kept equal to
 *      the manifest, and read through `panelsOf` / the copy).
 *
 * It is a boot step and not a migration, per the boot defaults-sync rule: it
 * reads shipped rows the reconcilers write, so it runs after both of them.
 */
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db } from "."
import * as schema from "./schema"
import { canApplyLayoutPreset, genreDefaultLayoutRow } from "./layoutPresets"
import { widgetSettingDeviations } from "$lib/shared/widgets/settings"
import {
	OLD_LAYOUT_SLOTS as SLOTS,
	panelsToWrite,
	storedLayoutAsV2,
	storedPanelsKind
} from "./panelsFromStored"

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
	/** What step 3 wrote (panels version 2). */
	version2: PanelsV2Report
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
	Omit<SessionLayoutPanelsReport, "completed" | "version2">
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

// ── Step 3: panels version 2 ───────────────────────────────────────────────

/** What step 3 did. */
export interface PanelsV2Report {
	/** Session layout rows written. */
	sessions: number
	/** Saved layouts (`user` / `pub`) written. */
	presets: number
	/** Rows that failed and were left as they were. */
	failed: number
	/**
	 * Session rows still to convert: every one skipped as pre-copy
	 * (`layout_copied_at IS NULL`) and every one that failed. The boot prune
	 * spares their Messages copies' moved keys (`syncWidgetSettings`'s `spare`)
	 * until the startup task converts them.
	 */
	pending: Array<{ userId: number; sessionId: number }>
}

/** `layout.panels` absent or version 1. (The column is `json`: no `=`, no `?`.) */
const notYetV2 = (layout: AnyPgColumn) =>
	or(
		sql`(${layout} -> 'panels') IS NULL`,
		sql`(${layout} -> 'panels' ->> 'version') = '1'`
	)!

type SettingsMap = Record<string, Record<string, unknown>>

/** One session layout row and its person's `widget_settings`, as the stores. */
async function readSessionStores(h: Db, id: number) {
	const [row] = await h
		.select()
		.from(schema.sessionPanelLayouts)
		.where(
			and(
				eq(schema.sessionPanelLayouts.id, id),
				isNotNull(schema.sessionPanelLayouts.layoutCopiedAt),
				notYetV2(schema.sessionPanelLayouts.layout)
			)
		)
		.limit(1)
	if (!row) return null
	const rows = await h
		.select({
			widgetInstanceId: schema.widgetSettings.widgetInstanceId,
			values: schema.widgetSettings.values
		})
		.from(schema.widgetSettings)
		.where(
			and(
				eq(schema.widgetSettings.sessionId, row.sessionId),
				eq(schema.widgetSettings.userId, row.userId)
			)
		)
	const old: SettingsMap = {}
	for (const r of rows) old[r.widgetInstanceId] = isObj(r.values) ? r.values : {}
	const ls: Blob = isObj(row.layoutSettings) ? row.layoutSettings : {}
	const answer = storedLayoutAsV2(
		{
			layout: isObj(row.layout) ? row.layout : {},
			settings: old,
			styles: isObj(ls.widgetStyles) ? ls.widgetStyles : undefined
		},
		{ dropStale: true }
	)
	return { row, old, ls, answer }
}

async function convertSessionRow(handle: Db, id: number): Promise<boolean> {
	const first = await readSessionStores(handle, id)
	const c = first?.answer.changed
	if (!first || !(c!.layout || c!.settings || c!.styles)) return false
	return handle.transaction(async (tx) => {
		const cur = await readSessionStores(tx, id)
		if (!cur) return false
		const { row, old, ls, answer } = cur
		const { changed } = answer
		if (!(changed.layout || changed.settings || changed.styles)) return false
		if (changed.layout)
			await tx
				.update(schema.sessionPanelLayouts)
				.set({ layout: answer.layout })
				.where(eq(schema.sessionPanelLayouts.id, id))
		if (changed.settings) {
			const next = answer.settings ?? {}
			for (const instance of Object.keys(old))
				if (!(instance in next))
					await tx
						.delete(schema.widgetSettings)
						.where(
							and(
								eq(schema.widgetSettings.userId, row.userId),
								eq(schema.widgetSettings.sessionId, row.sessionId),
								eq(schema.widgetSettings.widgetInstanceId, instance)
							)
						)
			for (const [instance, values] of Object.entries(next)) {
				if (
					instance in old &&
					JSON.stringify(old[instance]) === JSON.stringify(values)
				)
					continue
				await tx
					.insert(schema.widgetSettings)
					.values({
						sessionId: row.sessionId,
						userId: row.userId,
						widgetInstanceId: instance,
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
		if (changed.styles)
			await tx
				.update(schema.sessionPanelLayouts)
				.set({ layoutSettings: { ...ls, widgetStyles: answer.styles } })
				.where(eq(schema.sessionPanelLayouts.id, id))
		return true
	})
}

async function readPresetStores(h: Db, id: number) {
	const [row] = await h
		.select({ layout: schema.sessionLayoutPresets.layout })
		.from(schema.sessionLayoutPresets)
		.where(
			and(
				eq(schema.sessionLayoutPresets.id, id),
				inArray(schema.sessionLayoutPresets.origin, ["user", "pub"]),
				notYetV2(schema.sessionLayoutPresets.layout)
			)
		)
		.limit(1)
	if (!row) return null
	return storedLayoutAsV2(
		{ layout: isObj(row.layout) ? row.layout : {} },
		{ dropStale: true }
	)
}

async function convertPresetRow(handle: Db, id: number): Promise<boolean> {
	const first = await readPresetStores(handle, id)
	if (!first?.changed.layout) return false
	return handle.transaction(async (tx) => {
		const cur = await readPresetStores(tx, id)
		if (!cur?.changed.layout) return false
		// `layout_updated_at` stays: the drawing is the same.
		await tx
			.update(schema.sessionLayoutPresets)
			.set({ layout: cur.layout })
			.where(eq(schema.sessionLayoutPresets.id, id))
		return true
	})
}

/**
 * Step 3: bring every stored session layout, and every `user` / `pub` saved
 * layout, to panels version 2 with the moved settings and style pins carried
 * (see the module header). One transaction per row; a row that fails is
 * logged, rolled back and skipped. Returns zeros on every boot after the first.
 */
export async function convertPanelsToV2(handle: Db = db): Promise<PanelsV2Report> {
	const report: PanelsV2Report = { sessions: 0, presets: 0, failed: 0, pending: [] }
	// Pre-copy rows wait for step 1; their moved Messages settings must outlive
	// the boot prune until step 3 of the startup task moves them.
	report.pending.push(
		...(await handle
			.select({
				userId: schema.sessionPanelLayouts.userId,
				sessionId: schema.sessionPanelLayouts.sessionId
			})
			.from(schema.sessionPanelLayouts)
			.where(
				and(
					isNull(schema.sessionPanelLayouts.layoutCopiedAt),
					notYetV2(schema.sessionPanelLayouts.layout)
				)
			)
			.orderBy(asc(schema.sessionPanelLayouts.id)))
	)
	const candidates = await handle
		.select({
			id: schema.sessionPanelLayouts.id,
			userId: schema.sessionPanelLayouts.userId,
			sessionId: schema.sessionPanelLayouts.sessionId,
			layout: schema.sessionPanelLayouts.layout,
			layoutSettings: schema.sessionPanelLayouts.layoutSettings
		})
		.from(schema.sessionPanelLayouts)
		.where(
			and(
				isNotNull(schema.sessionPanelLayouts.layoutCopiedAt),
				notYetV2(schema.sessionPanelLayouts.layout)
			)
		)
		.orderBy(asc(schema.sessionPanelLayouts.id))
	// A row with panels (v1) or old slots that place something always converts.
	// A `{}` / floor row converts only its settings and style pins, so it is
	// selected only while that would still change something (the same pure
	// answer the conversion itself uses, over one batched read), not every boot.
	const quiet = candidates.filter((c) => {
		const kind = storedPanelsKind(c.layout)
		return kind !== "v1" && kind !== "slots"
	})
	const settingsOf = new Map<string, SettingsMap>()
	if (quiet.length) {
		const rows = await handle
			.select({
				userId: schema.widgetSettings.userId,
				sessionId: schema.widgetSettings.sessionId,
				widgetInstanceId: schema.widgetSettings.widgetInstanceId,
				values: schema.widgetSettings.values
			})
			.from(schema.widgetSettings)
			.where(
				inArray(
					schema.widgetSettings.sessionId,
					quiet.map((c) => c.sessionId)
				)
			)
		for (const r of rows) {
			const key = `${r.userId}:${r.sessionId}`
			const m = settingsOf.get(key) ?? {}
			m[r.widgetInstanceId] = isObj(r.values) ? r.values : {}
			settingsOf.set(key, m)
		}
	}
	const sessionIds = candidates.filter((c) => {
		const kind = storedPanelsKind(c.layout)
		if (kind === "v1" || kind === "slots") return true
		const ls: Blob = isObj(c.layoutSettings) ? c.layoutSettings : {}
		const { changed } = storedLayoutAsV2(
			{
				layout: isObj(c.layout) ? c.layout : {},
				settings: settingsOf.get(`${c.userId}:${c.sessionId}`) ?? {},
				styles: isObj(ls.widgetStyles) ? ls.widgetStyles : undefined
			},
			{ dropStale: true }
		)
		return changed.layout || changed.settings || changed.styles
	})
	for (const { id, userId, sessionId } of sessionIds) {
		try {
			if (await convertSessionRow(handle, id)) report.sessions++
		} catch (err) {
			report.failed++
			report.pending.push({ userId, sessionId })
			console.error(
				`[session-layouts] could not convert session layout row ${id} to panels version 2; left as it was; its Messages settings are kept for the retry:`,
				err
			)
		}
	}
	const presetIds = await handle
		.select({ id: schema.sessionLayoutPresets.id })
		.from(schema.sessionLayoutPresets)
		.where(
			and(
				inArray(schema.sessionLayoutPresets.origin, ["user", "pub"]),
				notYetV2(schema.sessionLayoutPresets.layout)
			)
		)
		.orderBy(asc(schema.sessionLayoutPresets.id))
	for (const { id } of presetIds) {
		try {
			if (await convertPresetRow(handle, id)) report.presets++
		} catch (err) {
			report.failed++
			console.error(
				`[session-layouts] could not convert saved layout row ${id} to panels version 2; left as it was, retried next boot:`,
				err
			)
		}
	}
	if (report.sessions || report.presets || report.failed)
		console.info(
			`[session-layouts] panels version 2: ${report.sessions} session layout(s) and ${report.presets} saved layout(s) converted${report.failed ? `; ${report.failed} left as they were` : ""}`
		)
	return report
}

const isPlainValues = (v: unknown): boolean =>
	isObj(v) && Object.values(v).every(isObj)

/**
 * What `sessions:panelLayout:set` runs on a person's write BEFORE validating:
 * a page still holding an older layout (version 1, or only the ⏳ old slots)
 * is saved as panels version 2 with its Messages settings and style pins
 * moved the same way the boot pass moves them (no stale values dropped: a
 * live page's values are real). Anything else — a layout already version 2,
 * one nothing can be said about, or a payload the handler's own checks
 * refuse — comes back as the very object that was sent.
 */
export async function panelLayoutWriteAsV2<
	T extends { layout?: unknown; layoutSettings?: unknown; widgetSettings?: unknown }
>(sessionId: number, userId: number, sent: T, handle: Db = db): Promise<T> {
	try {
		const kind = storedPanelsKind(sent.layout)
		if (kind !== "v1" && kind !== "slots" && kind !== "floor" && kind !== "none")
			return sent
		const hasSettings = "widgetSettings" in sent
		const hasLs = "layoutSettings" in sent
		if (hasSettings && !isPlainValues(sent.widgetSettings)) return sent
		if (hasLs && !isObj(sent.layoutSettings)) return sent
		const stored = kind === "v1" || kind === "slots"
		let settings: SettingsMap | undefined = hasSettings
			? (sent.widgetSettings as SettingsMap)
			: undefined
		let storedLs: Blob | undefined
		if (stored && (!hasSettings || !hasLs)) {
			if (!hasSettings) {
				const rows = await handle
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
				settings = {}
				for (const r of rows)
					if (isObj(r.values) && Object.keys(r.values).length)
						settings[r.widgetInstanceId] = r.values
			}
			if (!hasLs) {
				const [row] = await handle
					.select({ layoutSettings: schema.sessionPanelLayouts.layoutSettings })
					.from(schema.sessionPanelLayouts)
					.where(
						and(
							eq(schema.sessionPanelLayouts.sessionId, sessionId),
							eq(schema.sessionPanelLayouts.userId, userId)
						)
					)
					.limit(1)
				storedLs = isObj(row?.layoutSettings) ? row.layoutSettings : undefined
			}
		}
		const ls = hasLs ? (sent.layoutSettings as Blob) : storedLs
		const styles = isObj(ls?.widgetStyles) ? ls.widgetStyles : undefined
		const answer = storedLayoutAsV2({
			layout: sent.layout as Blob,
			settings,
			styles
		})
		const { changed } = answer
		if (!changed.layout && !changed.settings && !changed.styles) return sent
		const out: Record<string, unknown> = { ...sent, layout: answer.layout }
		if (changed.settings) out.widgetSettings = answer.settings ?? {}
		if (changed.styles)
			out.layoutSettings = { ...(ls ?? {}), widgetStyles: answer.styles }
		return out as T
	} catch (err) {
		console.warn(
			"[session-layouts] could not read a layout write as panels version 2; saved as it was sent:",
			err
		)
		return sent
	}
}

/** The `session-layouts` startup task: all three steps, one log line. */
export async function sessionLayoutPanels(): Promise<SessionLayoutPanelsReport> {
	const completed = await completeSessionLayouts()
	const converted = await convertLayoutsToPanels()
	const version2 = await convertPanelsToV2()
	const report = { completed, ...converted, version2 }
	console.info(
		`[session-layouts] panels: ${report.sessions} session layout(s) and ` +
			`${report.presets} saved layout(s) converted; ${report.completed} ` +
			`pre-copy row(s) made whole; ${report.floorOnly} left to the floor; ` +
			`${version2.sessions} session layout(s) and ${version2.presets} saved ` +
			`layout(s) to version 2` +
			(version2.failed ? `; ${version2.failed} left as they were` : "")
	)
	return report
}
