/**
 * The widget-settings reconciler drops stored values for fields a descriptor
 * has stopped declaring, and says which. Pinned here: a still-declared value
 * survives, a row emptied by the prune is deleted rather than left holding
 * `{}`, and a widget outside the synced set is untouched.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
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
		.values({ userId: user.id, isGroup: false, genreId: "core:genre/chat" })
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
	surface: { kind: "native", component: id },
	...(channels ? { channels } : {}),
	settings
})

async function store(
	sessionId: number,
	userId: number,
	widgetSlug: string,
	values: Record<string, unknown>
) {
	await testDb
		.insert(schema.widgetSettings)
		.values({ sessionId, userId, widgetSlug, values })
}

const rowsFor = (sessionId: number, widgetSlug: string) =>
	testDb
		.select()
		.from(schema.widgetSettings)
		.where(
			and(
				eq(schema.widgetSettings.sessionId, sessionId),
				eq(schema.widgetSettings.widgetSlug, widgetSlug)
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
			widgetSlug: "phone",
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
