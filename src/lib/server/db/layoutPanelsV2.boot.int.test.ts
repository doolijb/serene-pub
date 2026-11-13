/**
 * ⏳ The version 2 boot pass runs BEFORE the boot prune, at boot fidelity
 * (`PLAN-session-layout-simplify-2026-11-05` D5). `syncWidgetSettings` deletes
 * any stored key no widget declares: `composer`, `otherTabsComposer`,
 * `showActions` and `nextUp` are declared by the Composer and Turn line only,
 * so a layout still on Messages would lose them if the prune ran first.
 * Deleted with `./sessionLayoutPanels` at the 0.7 squash.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let n = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

const V1 = {
	panels: {
		version: 1,
		left: [],
		middle: {
			above: [],
			primary: { key: "p1", tabs: ["messages"] },
			below: []
		},
		right: []
	}
}

/** A stamped session layout at version 1 whose Messages hold the moved keys. */
async function seed() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const me = await createTestUser(testDb, `v2boot-${n++}`)
	const [s] = await testDb
		.insert(schema.sessions)
		.values({ userId: me.id, isGroup: false, genreId: "core:genre/story" })
		.returning()
	await testDb.insert(schema.sessionPanelLayouts).values({
		sessionId: s.id,
		userId: me.id,
		layout: V1,
		layoutCopiedAt: new Date()
	})
	await testDb.insert(schema.widgetSettings).values({
		sessionId: s.id,
		userId: me.id,
		widgetInstanceId: "messages",
		values: { composer: "quill", nextUp: "list" }
	})
	return { sessionId: s.id, userId: me.id }
}

const bootPieces = async () => {
	const { convertPanelsToV2 } = await import("./sessionLayoutPanels")
	const { syncWidgetSettings } = await import("./widgetSettings")
	const { readWidgetSettings } = await import("./widgetSettings")
	const { CORE_WIDGETS } = await import("$lib/shared/widgets/types")
	return {
		convertPanelsToV2,
		syncWidgetSettings,
		readWidgetSettings,
		CORE_WIDGETS
	}
}

describe("⏳ the version 2 pass and the boot prune", () => {
	test("a version-change boot keeps the moved Messages keys: convert first, then prune", async () => {
		const {
			convertPanelsToV2,
			syncWidgetSettings,
			readWidgetSettings,
			CORE_WIDGETS
		} = await bootPieces()
		const { sessionId, userId } = await seed()
		await convertPanelsToV2()
		await syncWidgetSettings(CORE_WIDGETS)
		const rows = await readWidgetSettings(sessionId, userId)
		expect(rows.composer?.composer).toBe("quill")
		expect(rows["turn-line"]?.nextUp).toBe("list")
	}, 60_000)

	test("the order matters: pruning first loses them", async () => {
		const {
			convertPanelsToV2,
			syncWidgetSettings,
			readWidgetSettings,
			CORE_WIDGETS
		} = await bootPieces()
		const { sessionId, userId } = await seed()
		// Messages no longer declares `composer` / `nextUp`, so the prune
		// deletes them before the conversion can carry them.
		await syncWidgetSettings(CORE_WIDGETS)
		await convertPanelsToV2()
		const rows = await readWidgetSettings(sessionId, userId)
		expect(rows.composer).toBeUndefined()
		expect(rows["turn-line"]).toBeUndefined()
	}, 60_000)

	test("db/index.ts calls convertPanelsToV2 in the gated block, before syncWidgetSettings(CORE_WIDGETS)", () => {
		const src = fs.readFileSync(path.resolve(__dirname, "index.ts"), "utf8")
		const convert = src.indexOf("convertPanelsToV2(")
		const prune = src.indexOf("syncWidgetSettings(CORE_WIDGETS")
		expect(
			convert,
			"convertPanelsToV2( is not called in index.ts"
		).toBeGreaterThan(-1)
		expect(prune).toBeGreaterThan(-1)
		expect(convert).toBeLessThan(prune)
		expect(src).toMatch(/syncWidgetSettings\(CORE_WIDGETS,\s*\{\s*spare:/)
	})
})
