/**
 * 🚧 m3-core (plan §9): `sessions:view` hands an applet genre's session view the launcher's grants as
 * `sessionView.appletGrants` (one source: `appletMount`); an ordinary genre's view has none.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
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
	vi.stubEnv("SP_PLUGINS_ENABLED", "1")
}, 60_000)
afterAll(() => {
	vi.unstubAllEnvs()
})

const fakeSocket = (userId: number) =>
	({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any
const noop = () => {}
let n = 0

async function scenario(applet: boolean) {
	const k = n++
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { declaredPermissions, reviewMarks } = await import(
		"$lib/server/plugins/permissions"
	)
	const owner = await createTestUser(testDb, `asv-owner-${k}`)
	const pluginId = `acme.cards-${k}`
	const manifest = {
		id: pluginId,
		name: "Cards",
		version: "1.0.0",
		permissions: ["storage", "applet:characters:read", "network"],
		surfaces: {
			"session-view": { entry: "view.html", title: "Card table" }
		}
	}
	await testDb.insert(schema.plugins).values({
		pluginId,
		name: "Cards",
		version: "1.0.0",
		bundleSource: "// x",
		bundleHash: "deadbeef",
		enabled: true,
		manifest,
		adminDenied: reviewMarks(declaredPermissions(manifest as any))
	} as any)
	const typeId = `core:inlet/asv-${k}`
	await testDb.insert(schema.pipelineDefinitionRegistry).values({
		definitionId: typeId,
		version: 1,
		kind: "inlet",
		status: "live",
		sessionShape: { ...(applet ? { applet: true } : {}), view: pluginId }
	})
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, genreId: `${typeId}@1` })
		.returning()
	return {
		owner,
		session,
		pluginId,
		genreId: `${typeId}@1`,
		shape: { ...(applet ? { applet: true } : {}), view: pluginId }
	}
}

describe("sessions:view — appletGrants (m3-core)", () => {
	test("an applet genre's session view carries what appletMount grants for the same row", async () => {
		const { sessionsViewHandler } = await import("./sessions")
		const { appletMount } = await import("$lib/server/plugins/appletMount")
		const s = await scenario(true)
		const res = await sessionsViewHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id } as any,
			noop
		)
		const [row] = await testDb
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, s.pluginId))
		const mount = appletMount(
			s.pluginId,
			{ ...row, enabled: true } as any,
			[{ genreId: s.genreId, name: "", shape: s.shape }]
		)
		expect(mount).not.toBeNull()
		expect(res.sessionView?.appletGrants).toEqual(mount!.grants)
		expect(res.sessionView?.appletGrants).toContain("storage")
	}, 60_000)

	test("an ordinary genre's session view has no appletGrants", async () => {
		const { sessionsViewHandler } = await import("./sessions")
		const s = await scenario(false)
		const res = await sessionsViewHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id } as any,
			noop
		)
		expect(res.sessionView?.pluginId).toBe(s.pluginId)
		expect("appletGrants" in res.sessionView!).toBe(false)
	}, 60_000)
})
