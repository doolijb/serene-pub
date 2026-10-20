/**
 * ⏳ The boot pass to panels (`./sessionLayoutPanels`,
 * `PLAN-session-panels-2026-10-14` §2). Deleted with it at the 0.7 squash.
 *
 * Step 1 makes a pre-copy-model session layout row whole (brief 3 of
 * `PLAN-layout-one-format-2026-09-28`).
 *
 * Before the copy model a row held only the slots its person had set, and the
 * page drew each missing slot from a base: the pinned preset if it still
 * resolved for them, else the genre default layout. The base's
 * `widgetSettings` sat UNDER the person's own values, field by field. The step
 * writes exactly that composition into the row once, so the screen draws the
 * same thing from the row alone — and these tests hold it to "the same thing"
 * by computing the old drawing with the old rules, before the step runs.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { panelsFromSlots } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { layoutPresetSeedKey } from "$lib/shared/sessionLayout/presets"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(() => {})

const ADVENTURE = "core:genre/story"
const SLOTS = ["zoneLayout", "widgetGrid", "arrangedGrid"] as const

type Blob = Record<string, any>

const isObj = (v: unknown): v is Blob =>
	!!v && typeof v === "object" && !Array.isArray(v)

let n = 0

async function seedAdventure() {
	const { syncLayoutPresets } = await import("./layoutPresets")
	await syncLayoutPresets([ADVENTURE])
	const [row] = await testDb
		.select()
		.from(schema.sessionLayoutPresets)
		.where(eq(schema.sessionLayoutPresets.seedKey, layoutPresetSeedKey(ADVENTURE)))
	return row
}

async function person(tag: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `bf-${tag}-${n++}`)
}

async function sessionOf(userId: number) {
	const [s] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, genreId: ADVENTURE })
		.returning()
	return s
}

/** A row exactly as the pre-copy code left it: its own slots, no copy stamp. */
async function preCopyRow(args: {
	sessionId: number
	userId: number
	layout: Blob
	pin?: number | null
	layoutSettings?: Blob
	settings?: Record<string, Blob>
}) {
	const [row] = await testDb
		.insert(schema.sessionPanelLayouts)
		.values({
			sessionId: args.sessionId,
			userId: args.userId,
			layout: args.layout,
			startedFromLayoutPresetId: args.pin ?? null,
			layoutCopiedAt: null,
			layoutSettings: args.layoutSettings ?? {}
		})
		.returning()
	for (const [widgetInstanceId, values] of Object.entries(args.settings ?? {}))
		await testDb.insert(schema.widgetSettings).values({
			sessionId: args.sessionId,
			userId: args.userId,
			widgetInstanceId,
			values
		})
	return row
}

const rowOf = async (sessionId: number, userId: number) => {
	const [row] = await testDb
		.select()
		.from(schema.sessionPanelLayouts)
		.where(
			and(
				eq(schema.sessionPanelLayouts.sessionId, sessionId),
				eq(schema.sessionPanelLayouts.userId, userId)
			)
		)
	return row
}

const settingsOf = async (sessionId: number, userId: number) => {
	const { readWidgetSettings } = await import("./widgetSettings")
	return readWidgetSettings(sessionId, userId)
}

/**
 * What the page drew BEFORE the copy model, by the rules it drew with — the
 * server's `resolveActivePresetLayout` (the pin if it still resolved for this
 * person, else the genre default layout), the client's `presetBase` (the
 * person's `layoutSettings` over the preset's layout), the manager's
 * `slot ?? base slot`, and `presetWidgetSettings` (the base's pins under the
 * person's own values, per widget and per field). Written out here rather than
 * imported, because the code that did it is gone.
 */
async function drawnBefore(sessionId: number, userId: number) {
	const row = await rowOf(sessionId, userId)
	let preset: Blob = {}
	const pinned = row.startedFromLayoutPresetId
		? (
				await testDb
					.select()
					.from(schema.sessionLayoutPresets)
					.where(eq(schema.sessionLayoutPresets.id, row.startedFromLayoutPresetId))
			)[0]
		: undefined
	const resolves =
		!!pinned &&
		pinned.genreId === ADVENTURE &&
		!pinned.withdrawnAt &&
		(pinned.origin !== "user" ||
			pinned.visibility === "shared" ||
			pinned.authorUserId === userId)
	if (resolves) preset = pinned!.layout as Blob
	else {
		const [def] = await testDb
			.select()
			.from(schema.sessionLayoutPresets)
			.where(eq(schema.sessionLayoutPresets.seedKey, layoutPresetSeedKey(ADVENTURE)))
		preset = (def?.layout as Blob) ?? {}
	}
	const base: Blob = { ...preset, ...(row.layoutSettings as Blob) }
	const own = row.layout as Blob
	const layout: Blob = {}
	for (const k of SLOTS) {
		const v = own[k] ?? base[k]
		if (v !== undefined) layout[k] = v
	}
	// A row with no arrangement of its own drew the base's panels.
	if (own.panels !== undefined) layout.panels = own.panels
	else if (!SLOTS.some((k) => own[k] !== undefined) && base.panels !== undefined)
		layout.panels = base.panels
	const values = await settingsOf(sessionId, userId)
	const settings: Record<string, Blob> = {}
	if (isObj(base.widgetSettings))
		for (const [w, v] of Object.entries(base.widgetSettings))
			if (isObj(v)) settings[w] = { ...v }
	for (const [w, v] of Object.entries(values))
		settings[w] = { ...(settings[w] ?? {}), ...v }
	return { layout, settings, active: own.active, sizes: own.tierSizeOverrides }
}

/** What the page draws AFTER: the row's own slots and the person's own values. */
async function drawnAfter(sessionId: number, userId: number) {
	const row = await rowOf(sessionId, userId)
	const own = row.layout as Blob
	const layout: Blob = {}
	for (const k of [...SLOTS, "panels"]) if (own[k] !== undefined) layout[k] = own[k]
	return {
		layout,
		settings: await settingsOf(sessionId, userId),
		active: own.active,
		sizes: own.tierSizeOverrides
	}
}

const complete = async () =>
	(await import("./sessionLayoutPanels")).completeSessionLayouts()

describe("⏳ step 1: completing pre-copy-model session layout rows", () => {
	test(
		"a sparse row over a pinned preset, a sparse row on the genre default, a full row, and a dead pin all draw exactly as before",
		async () => {
			const def = await seedAdventure()
			const me = await person("me")
			const stranger = await person("stranger")
			const { saveUserLayoutPreset } = await import("./layoutPresets")
			const pinned = await saveUserLayoutPreset({
				genreId: ADVENTURE,
				userId: me.id,
				name: "Pinned",
				layout: {
					zoneLayout: {
						version: 1,
						zones: {
							left: { kind: "side", side: "left", pinned: true, widgets: ["stats"] }
						}
					},
					widgetGrid: {
						version: 1,
						cell: 44,
						widgets: [
							{ id: "messages", zone: "middle", order: 0, size: { w: "grow", h: "grow" } }
						]
					},
					widgetSettings: {
						stats: { density: "compact", title: "Numbers" },
						"lore-entries": { pageSize: 5 }
					}
				}
			})
			const secret = await saveUserLayoutPreset({
				genreId: ADVENTURE,
				userId: stranger.id,
				name: "Secret",
				layout: { widgetGrid: { version: 1, cell: 44, widgets: [] } }
			})

			// 1. Sparse, pinned: its own arrangement only, plus its own value
			//    for ONE field the preset also pins.
			const a = await sessionOf(me.id)
			await preCopyRow({
				sessionId: a.id,
				userId: me.id,
				pin: pinned.id,
				layout: {
					active: [{ id: "stats", on: true, order: 0 }],
					tierSizeOverrides: { wide: [2, 1] },
					arrangedGrid: {
						left: { cols: 1, rows: 12, items: [{ id: "stats", x: 0, y: 0, w: 1, h: 12 }] }
					}
				},
				layoutSettings: { widgetStyles: { stats: { id: 1, slug: "mine" } } },
				settings: { stats: { density: "roomy" }, "scene-portraits": { bars: false } }
			})
			// 2. Sparse, unpinned: the genre default layout was its base.
			const b = await sessionOf(me.id)
			await preCopyRow({
				sessionId: b.id,
				userId: me.id,
				layout: {
					zoneLayout: {
						version: 1,
						zones: {
							right: { kind: "side", side: "right", pinned: true, widgets: ["stats"] }
						}
					}
				}
			})
			// 3. Full: every slot its own; only the settings can fill.
			const c = await sessionOf(me.id)
			const full = {
				zoneLayout: { version: 1, zones: {} },
				widgetGrid: { version: 1, cell: 44, widgets: [] },
				arrangedGrid: {}
			}
			await preCopyRow({ sessionId: c.id, userId: me.id, pin: pinned.id, layout: full })
			// 4. A pin that no longer resolves for this person (someone else's
			//    private row): the genre default layout was drawn instead.
			const d = await sessionOf(me.id)
			await preCopyRow({ sessionId: d.id, userId: me.id, pin: secret.id, layout: {} })

			const sessions = [a, b, c, d]
			const before = await Promise.all(sessions.map((s) => drawnBefore(s.id, me.id)))
			const done = await complete()
			expect(done).toBeGreaterThanOrEqual(4)
			const after = await Promise.all(sessions.map((s) => drawnAfter(s.id, me.id)))
			expect(after).toEqual(before)

			// The field the person set wins; the preset fills the one they did not.
			expect(after[0].settings.stats).toEqual({ density: "roomy", title: "Numbers" })
			expect(after[2].layout).toEqual(full)

			// Provenance: the pin where it resolved, else the genre default layout.
			const rows = await Promise.all(sessions.map((s) => rowOf(s.id, me.id)))
			expect(rows.map((r) => r.startedFromLayoutPresetId)).toEqual([
				pinned.id,
				def.id,
				pinned.id,
				def.id
			])
			for (const r of rows) expect(r.layoutCopiedAt).toBeInstanceOf(Date)
			// Style pins are the row's own and are left exactly as they were.
			expect(rows[0].layoutSettings).toEqual({
				widgetStyles: { stats: { id: 1, slug: "mine" } }
			})
		},
		60_000
	)

	test(
		"a second run finds nothing to do and changes nothing",
		async () => {
			await seedAdventure()
			const me = await person("again")
			const s = await sessionOf(me.id)
			await preCopyRow({ sessionId: s.id, userId: me.id, layout: {} })
			await complete()
			const once = await rowOf(s.id, me.id)
			const settingsOnce = await settingsOf(s.id, me.id)
			expect(await complete()).toBe(0)
			const twice = await rowOf(s.id, me.id)
			expect(twice).toEqual(once)
			expect(await settingsOf(s.id, me.id)).toEqual(settingsOnce)
		},
		60_000
	)

	test(
		"a row that fails is logged by id and left for the next boot; the rows after it are still finished",
		async () => {
			await seedAdventure()
			// Drain whatever an earlier test left, so the calls below are ours.
			await complete()
			const me = await person("fails")
			const rows = []
			for (let i = 0; i < 3; i++) {
				const s = await sessionOf(me.id)
				rows.push(await preCopyRow({ sessionId: s.id, userId: me.id, layout: {} }))
			}
			const real = testDb.transaction.bind(testDb)
			let calls = 0
			// The second row's transaction throws inside, as a bad row would: it
			// rolls back, and the step must go on to the third.
			const spy = vi
				.spyOn(testDb, "transaction")
				.mockImplementation(((fn: any, config?: any) =>
					++calls === 2
						? real(async () => {
								throw new Error("boom")
							})
						: real(fn, config)) as any)
			const logged = vi.spyOn(console, "error").mockImplementation(() => {})
			let errors: unknown[][] = []
			try {
				expect(await complete()).toBe(2)
			} finally {
				errors = [...logged.mock.calls]
				spy.mockRestore()
				logged.mockRestore()
			}
			const [first, second, third] = await Promise.all(
				rows.map((r) => rowOf(r.sessionId, me.id))
			)
			expect(first.layoutCopiedAt).toBeInstanceOf(Date)
			expect(second.layoutCopiedAt).toBeNull()
			expect(second.layout).toEqual({})
			expect(third.layoutCopiedAt).toBeInstanceOf(Date)
			expect(errors).toHaveLength(1)
			expect(String(errors[0][0])).toContain(`row ${rows[1].id}`)
			// The next boot finishes it.
			expect(await complete()).toBe(1)
			expect((await rowOf(rows[1].sessionId, me.id)).layoutCopiedAt).toBeInstanceOf(Date)
		},
		60_000
	)

	test(
		"a row the copy model wrote is never selected",
		async () => {
			await seedAdventure()
			const me = await person("copied")
			const s = await sessionOf(me.id)
			const stamped = new Date("2026-09-01T00:00:00Z")
			await testDb.insert(schema.sessionPanelLayouts).values({
				sessionId: s.id,
				userId: me.id,
				layout: { zoneLayout: { version: 1, zones: {} } },
				layoutCopiedAt: stamped
			})
			await complete()
			const row = await rowOf(s.id, me.id)
			expect(row.layout).toEqual({ zoneLayout: { version: 1, zones: {} } })
			expect(row.layoutCopiedAt!.getTime()).toBe(stamped.getTime())
			expect(row.startedFromLayoutPresetId).toBeNull()
		},
		60_000
	)
})

// ── Step 2: converting to panels ────────────────────────────────────────────

/** All three old slots, as a pre-panels row holds them. */
const OLD_FULL: Blob = {
	zoneLayout: {
		version: 1,
		zones: {
			left: { kind: "side", side: "left", pinned: true, widgets: ["stats"] },
			right: { kind: "side", side: "right", pinned: false, widgets: ["lore-entries"] },
			top: { kind: "strip", area: "top", widgets: ["places"] }
		},
		styles: { chat: "bubbles" }
	},
	widgetGrid: {
		version: 1,
		cell: 44,
		widgets: [{ id: "messages", zone: "middle", order: 0, size: { w: "grow", h: "grow" } }]
	},
	arrangedGrid: {
		middle: { cols: 12, rows: 12, items: [{ id: "messages", x: 0, y: 0, w: 12, h: 12 }] },
		left: {
			cols: 1,
			rows: 12,
			items: [
				{ id: "stats", x: 0, y: 0, w: 1, h: 6, group: "g:chronicle,stats" },
				{ id: "chronicle", x: 0, y: 0, w: 1, h: 6, group: "g:chronicle,stats" }
			]
		}
	}
}

const convert = async () =>
	(await import("./sessionLayoutPanels")).convertLayoutsToPanels()
const pass = async () =>
	(await import("./sessionLayoutPanels")).sessionLayoutPanels()

/** A row the copy model wrote (stamped), holding `layout` verbatim. */
async function copiedRow(userId: number, layout: Blob) {
	const s = await sessionOf(userId)
	const [row] = await testDb
		.insert(schema.sessionPanelLayouts)
		.values({ sessionId: s.id, userId, layout, layoutCopiedAt: new Date() })
		.returning()
	return row
}

const sessionRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessionPanelLayouts)
			.where(eq(schema.sessionPanelLayouts.id, id))
	)[0]

const presetRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessionLayoutPresets)
			.where(eq(schema.sessionLayoutPresets.id, id))
	)[0]

/** The column's stored text, for "byte for byte". */
async function storedText(table: "session_panel_layouts" | "session_layout_presets", id: number) {
	const res: any = await testDb.execute(
		sql`select layout::text as t from ${sql.identifier(table)} where id = ${id}`
	)
	return (res.rows ?? res)[0].t as string
}

describe("⏳ step 2: converting stored layouts to panels", () => {
	test(
		"a row with all three old slots gains panelsFromSlots' panels; the old slots and every other key stay as they were",
		async () => {
			const me = await person("full")
			const layout = { ...OLD_FULL, active: [{ id: "stats", on: true, order: 0 }] }
			const row = await copiedRow(me.id, layout)
			await convert()
			const after = (await sessionRow(row.id)).layout as Blob
			expect(after.panels).toEqual(panelsFromSlots(OLD_FULL as any))
			const { panels: _p, ...rest } = after
			expect(rest).toEqual(layout)
			// The style pack pin rides along in the inert old slot.
			expect((after.zoneLayout as Blob).styles).toEqual({ chat: "bubbles" })
			// Grouped side items became one panel's tabs; the strip a fit panel above.
			const panels = after.panels as any
			expect(panels.left).toHaveLength(1)
			expect(panels.left[0].tabs.sort()).toEqual(["chronicle", "stats"])
			expect(panels.middle.above[0]).toMatchObject({ tabs: ["places"], height: "fit" })
			expect(panels.middle.primary.tabs).toEqual(["messages"])
		},
		60_000
	)

	test(
		"a row with only zoneLayout converts when it names the conversation, and is left to the floor when it does not",
		async () => {
			const me = await person("zl")
			const withMessages = {
				zoneLayout: {
					version: 1,
					zones: {
						right: { kind: "side", side: "right", pinned: true, widgets: ["messages", "stats"] }
					}
				}
			}
			const sidesOnly = {
				zoneLayout: {
					version: 1,
					zones: { left: { kind: "side", side: "left", pinned: false, widgets: ["stats"] } }
				}
			}
			const a = await copiedRow(me.id, withMessages)
			const b = await copiedRow(me.id, sidesOnly)
			const before = await storedText("session_panel_layouts", b.id)
			const report = await convert()
			expect(report.floorOnly).toBeGreaterThanOrEqual(1)
			const after = (await sessionRow(a.id)).layout as Blob
			expect(after.panels).toEqual(panelsFromSlots(withMessages as any))
			expect((after.panels as any).middle.primary.tabs).toEqual(["messages"])
			expect(after.zoneLayout).toEqual(withMessages.zoneLayout)
			// Stored panels always name a primary: this one would turn the
			// floor into a placed `messages`, so it is left to `panelsOf`.
			expect(await storedText("session_panel_layouts", b.id)).toBe(before)
		},
		60_000
	)

	test(
		"a person's own saved layout converts without moving layout_updated_at; core and plugin rows are their reconcilers'",
		async () => {
			await seedAdventure()
			const me = await person("preset")
			const [mine] = await testDb
				.insert(schema.sessionLayoutPresets)
				.values({
					genreId: ADVENTURE,
					origin: "user",
					authorUserId: me.id,
					slug: `mine-${n++}`,
					name: "Mine",
					layout: { ...OLD_FULL, widgetSettings: { stats: { density: "compact" } } }
				})
				.returning()
			const [plugin] = await testDb
				.insert(schema.sessionLayoutPresets)
				.values({
					genreId: ADVENTURE,
					origin: "plugin",
					pluginId: "some-plugin",
					seedKey: `layout:${ADVENTURE}:some-plugin/x-${n++}`,
					slug: `x-${n}`,
					name: "Plugin",
					visibility: "shared",
					layout: OLD_FULL
				})
				.returning()
			const pluginBefore = await storedText("session_layout_presets", plugin.id)
			const report = await convert()
			expect(report.presets).toBeGreaterThanOrEqual(1)
			const after = await presetRow(mine.id)
			const layout = after.layout as Blob
			expect(layout.panels).toEqual(panelsFromSlots(OLD_FULL as any))
			expect(layout.widgetSettings).toEqual({ stats: { density: "compact" } })
			expect(layout.arrangedGrid).toEqual(OLD_FULL.arrangedGrid)
			expect(after.layoutUpdatedAt.getTime()).toBe(mine.layoutUpdatedAt.getTime())
			expect(await storedText("session_layout_presets", plugin.id)).toBe(pluginBefore)
			// The core default already ships panels and is not rewritten.
			const def = await seedAdventure()
			expect((def.layout as Blob).panels).toBeDefined()
		},
		60_000
	)

	test(
		"a second run converts nothing and changes nothing",
		async () => {
			const me = await person("idem")
			const row = await copiedRow(me.id, OLD_FULL)
			await pass()
			const once = await storedText("session_panel_layouts", row.id)
			const onceRow = await sessionRow(row.id)
			const again = await pass()
			expect(again).toMatchObject({ completed: 0, sessions: 0, presets: 0 })
			expect(await storedText("session_panel_layouts", row.id)).toBe(once)
			expect((await sessionRow(row.id)).updatedAt.getTime()).toBe(onceRow.updatedAt.getTime())
		},
		60_000
	)

	test(
		"a row already carrying panels — and one with nothing to convert — is untouched byte for byte",
		async () => {
			const me = await person("has-panels")
			const panels = {
				version: 1,
				left: [],
				middle: { above: [], primary: { key: "p1", tabs: ["messages"] }, below: [] },
				right: [{ key: "p2", tabs: ["stats"], pinned: false }]
			}
			// Old slots that would convert differently ride along, inert.
			const row = await copiedRow(me.id, { panels, ...OLD_FULL })
			const empty = await copiedRow(me.id, {})
			const before = await storedText("session_panel_layouts", row.id)
			const beforeRow = await sessionRow(row.id)
			await convert()
			expect(await storedText("session_panel_layouts", row.id)).toBe(before)
			expect((await sessionRow(row.id)).updatedAt.getTime()).toBe(beforeRow.updatedAt.getTime())
			expect((await sessionRow(empty.id)).layout).toEqual({})
		},
		60_000
	)

	test(
		"a pre-copy row is made whole first, then converted, in one pass",
		async () => {
			await seedAdventure()
			const me = await person("both")
			const s = await sessionOf(me.id)
			const row = await preCopyRow({ sessionId: s.id, userId: me.id, layout: OLD_FULL })
			const report = await pass()
			expect(report.completed).toBeGreaterThanOrEqual(1)
			const after = await rowOf(s.id, me.id)
			expect(after.id).toBe(row.id)
			expect(after.layoutCopiedAt).toBeInstanceOf(Date)
			expect((after.layout as Blob).panels).toEqual(panelsFromSlots(OLD_FULL as any))
		},
		60_000
	)
})
