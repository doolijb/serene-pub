/**
 * 🚧 (M2e) `frameCauseOfRun`: a person's press (the `action` family) in a
 * session an applet genre draws carries that applet's frame-origin cause;
 * routine and event runs, previews and ordinary sessions get none.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const APPLET_GENRE = "acme.tools:genre/sim"

vi.mock(
	"$lib/server/pipelines/entities/sessionGenres",
	async (importOriginal) => {
		const orig: any = await importOriginal()
		return {
			...orig,
			getSessionGenre: async (d: any, id: string) =>
				id === "acme.tools:genre/sim"
					? {
							genreId: id,
							name: "Sim",
							shape: { applet: true, view: "acme.tools" }
						}
					: orig.getSessionGenre(d, id)
		}
	}
)

let db: TestDb
let appletSession: number
let ordinary: number
let frameCauseOfRun: typeof import("./runTurn").frameCauseOfRun

beforeAll(async () => {
	db = await createTestDb()
	const [{ id: userId }] = await db
		.insert(schema.users)
		.values({ username: "fcr" })
		.returning({ id: schema.users.id })
	const mk = async (genreId: string) =>
		(
			await db
				.insert(schema.sessions)
				.values({ userId, isGroup: false, genreId } as any)
				.returning()
		)[0].id
	appletSession = await mk(APPLET_GENRE)
	ordinary = await mk("core:genre/story")
	;({ frameCauseOfRun } = await import("./runTurn"))
})

describe("frameCauseOfRun", () => {
	it("a person's press in an applet session carries the applet's cause", async () => {
		expect(
			await frameCauseOfRun({
				db,
				sessionId: appletSession,
				fromPressDoor: true
			} as any)
		).toEqual({
			pluginId: "acme.tools"
		})
	})
	it("an automatic action run (auto-advance, read-aloud) gets none", async () => {
		const c = { db, sessionId: appletSession } as any
		expect(
			await frameCauseOfRun({ ...c, triggerFamily: "action" })
		).toBeUndefined()
		expect(await frameCauseOfRun(c)).toBeUndefined()
	})
	it("a child run, a routine, an event and a preview get none", async () => {
		const c = { db, sessionId: appletSession } as any
		expect(
			await frameCauseOfRun({
				...c,
				fromPressDoor: true,
				lineage: { parentRunId: "r" }
			})
		).toBeUndefined()
		expect(
			await frameCauseOfRun({
				...c,
				registration: { family: "routine", key: "k" }
			})
		).toBeUndefined()
		expect(
			await frameCauseOfRun({ ...c, triggerFamily: "event" })
		).toBeUndefined()
		expect(
			await frameCauseOfRun({ ...c, fromPressDoor: true, preview: true })
		).toBeUndefined()
	})
	it("an ordinary session gets none", async () => {
		expect(
			await frameCauseOfRun({
				db,
				sessionId: ordinary,
				fromPressDoor: true
			} as any)
		).toBeUndefined()
	})
})
