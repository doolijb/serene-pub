/**
 * The widget-settings reconciler drops stored values for fields a descriptor
 * has stopped declaring, and says which. Pinned here: a still-declared value
 * survives, a row emptied by the prune is deleted rather than left holding
 * `{}`, a placed copy is pruned against its widget's declaration, and a widget
 * outside the synced set is untouched.
 *
 * And the column a row is keyed by: `widget_instance_id`, renamed from
 * `widget_slug` by `0099_rename_widget_settings_instance_id`, which must keep
 * every row a 0.6 install already holds.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { WidgetDecl } from "$lib/shared/widgets/types"
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

let n = 0

async function scenario() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `ws-owner-${n++}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, genreId: "core:genre/story" })
		.returning()
	return { user, session }
}

const widget = (
	id: string,
	settings: WidgetDecl["settings"],
	channels?: string[]
): WidgetDecl => ({
	id,
	title: id,
	component: id,
	...(channels ? { channels } : {}),
	settings
})

async function store(
	sessionId: number,
	userId: number,
	widgetInstanceId: string,
	values: Record<string, unknown>
) {
	await testDb
		.insert(schema.widgetSettings)
		.values({ sessionId, userId, widgetInstanceId, values })
}

const rowsFor = (sessionId: number, widgetInstanceId: string) =>
	testDb
		.select()
		.from(schema.widgetSettings)
		.where(
			and(
				eq(schema.widgetSettings.sessionId, sessionId),
				eq(schema.widgetSettings.widgetInstanceId, widgetInstanceId)
			)
		)

const sync = async (decls: WidgetDecl[]) =>
	(await import("./widgetSettings")).syncWidgetSettings(decls)

describe("syncWidgetSettings", () => {
	test("drops a value for a field the descriptor stopped declaring", async () => {
		const s = await scenario()
		await store(s.session.id, s.user.id, "phone", {
			density: "compact",
			retired: "gone"
		})

		const dropped = await sync([
			widget("phone", {
				density: {
					type: "enum",
					of: ["cosy", "compact"],
					default: "cosy"
				}
			})
		])

		const [row] = await rowsFor(s.session.id, "phone")
		expect(row.values).toEqual({ density: "compact" })
		expect(dropped).toContainEqual({
			widgetInstanceId: "phone",
			sessionId: s.session.id,
			userId: s.user.id,
			key: "retired",
			reason: "undeclared"
		})
	})

	test("deletes a row the prune empties rather than storing {}", async () => {
		const s = await scenario()
		await store(s.session.id, s.user.id, "phone", { retired: "gone" })

		await sync([widget("phone", {})])

		expect(await rowsFor(s.session.id, "phone")).toHaveLength(0)
	})

	test("keeps the core-owned keys every widget carries", async () => {
		const s = await scenario()
		await store(s.session.id, s.user.id, "phone", {
			title: "Burner",
			lane: 3
		})

		await sync([widget("phone", {}, ["text-messages"])])

		const [row] = await rowsFor(s.session.id, "phone")
		expect(row.values).toEqual({ title: "Burner", lane: 3 })
	})

	test("prunes a placed copy against its widget's declaration", async () => {
		const s = await scenario()
		await store(s.session.id, s.user.id, "phone#burner", {
			density: "compact",
			retired: "gone"
		})

		const dropped = await sync([
			widget("phone", {
				density: {
					type: "enum",
					of: ["cosy", "compact"],
					default: "cosy"
				}
			})
		])

		const [row] = await rowsFor(s.session.id, "phone#burner")
		expect(row.values).toEqual({ density: "compact" })
		expect(dropped).toContainEqual({
			widgetInstanceId: "phone#burner",
			sessionId: s.session.id,
			userId: s.user.id,
			key: "retired",
			reason: "undeclared"
		})
	})

	test("leaves a copy of a widget outside the synced set alone", async () => {
		const s = await scenario()
		await store(s.session.id, s.user.id, "other#2", { anything: 1 })

		await sync([widget("phone", {})])

		const [row] = await rowsFor(s.session.id, "other#2")
		expect(row.values).toEqual({ anything: 1 })
	})

	test("leaves a widget outside the synced set alone", async () => {
		const s = await scenario()
		await store(s.session.id, s.user.id, "other", { anything: 1 })

		await sync([widget("phone", {})])

		const [row] = await rowsFor(s.session.id, "other")
		expect(row.values).toEqual({ anything: 1 })
	})

	test("writes nothing when every stored value still reconciles", async () => {
		const s = await scenario()
		await store(s.session.id, s.user.id, "phone", { title: "Burner" })
		const [before] = await rowsFor(s.session.id, "phone")

		const dropped = await sync([widget("phone", {})])

		const [after] = await rowsFor(s.session.id, "phone")
		expect(dropped).toEqual([])
		expect(after.updatedAt).toEqual(before.updatedAt)
	})
})

/**
 * Last, because it takes the table back to its 0.6 shape and lets the
 * migration bring it forward again — the state every later test would see.
 */
describe("0099_rename_widget_settings_instance_id", () => {
	const MIGRATION = "0099_rename_widget_settings_instance_id"
	const client = () => (testDb as any).$client

	test("renames the column and keeps every row under its instance id", async () => {
		const s = await scenario()
		// The table as a 0.6 install holds it before the migration.
		await client().exec(`
			ALTER TABLE "widget_settings" RENAME COLUMN "widget_instance_id" TO "widget_slug";
			DROP INDEX "widget_settings_user_session_widget_idx";
			DROP INDEX "widget_settings_widget_idx";
			CREATE UNIQUE INDEX "widget_settings_user_session_widget_idx" ON "widget_settings" USING btree ("user_id","session_id","widget_slug");
			CREATE INDEX "widget_settings_widget_idx" ON "widget_settings" USING btree ("widget_slug");
		`)
		await client().query(
			`INSERT INTO "widget_settings" ("session_id", "user_id", "widget_slug", "values")
			 VALUES ($1, $2, 'messages#sanctum', '{"title":"Sanctum"}'),
			        ($1, $2, 'stats', '{"title":"Party"}')`,
			[s.session.id, s.user.id]
		)

		const file = await fs.readFile(
			path.resolve(process.cwd(), "drizzle", `${MIGRATION}.sql`),
			"utf8"
		)
		for (const statement of file.split("--> statement-breakpoint"))
			if (statement.trim()) await client().exec(statement)

		const columns = (
			await client().query(
				`SELECT column_name FROM information_schema.columns
				 WHERE table_name = 'widget_settings'`
			)
		).rows.map((r: { column_name: string }) => r.column_name)
		expect(columns).toContain("widget_instance_id")
		expect(columns).not.toContain("widget_slug")

		const { readWidgetSettings } = await import("./widgetSettings")
		expect(await readWidgetSettings(s.session.id, s.user.id)).toEqual({
			"messages#sanctum": { title: "Sanctum" },
			stats: { title: "Party" }
		})
		// The unique index came back on the renamed column: the writer's
		// upsert (its conflict target) still lands on the one row.
		const { writeWidgetSettings } = await import("./widgetSettings")
		await writeWidgetSettings(s.session.id, s.user.id, {
			"messages#sanctum": { title: "Inner sanctum" }
		})
		expect(await readWidgetSettings(s.session.id, s.user.id)).toEqual({
			"messages#sanctum": { title: "Inner sanctum" }
		})
	})
})
