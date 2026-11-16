/**
 * A session that has the *Summarize finished scenes* routine
 * (`core:spec/scene-summaries`) reads its Summaries as On request whatever is
 * stored: the routine's mode alone decides what is summarized by itself, a
 * close drafts nothing, and the owner's presses are always offered. A session
 * without the routine reads its stored value. Every "with" session here is
 * proven to have the routine through `sessionRoutineMode`, so no claim passes
 * because registrations were never projected.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

const SUMMARIES = "core:spec/scene-summaries"
const REGISTRATION = "every-n-rounds→scene-summaries"
const asDb = () => testDb as unknown as Db

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(
			os.tmpdir(),
			"serene-pub-vitest-scene-settings-summary-routine-"
		)
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 240_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

let seq = 0
async function makeWorld(
	opts: {
		summary?: "onClose" | "onRequest" | "never"
		genreId?: string
		/** The session's own row for the routine: dropped, or set to a mode. */
		routine?: "dropped" | "off"
	} = {}
) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `summary-routine-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Summary Routine Book ${seq}`, userId: user.id })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			lorebookId: book!.id,
			genreId: opts.genreId ?? "core:genre/story",
			metadata: opts.summary ? { scenes: { summary: opts.summary } } : {}
		} as any)
		.returning()
	if (opts.routine) {
		const { rowOfChange, rowOfDrop } = await import(
			"$lib/server/pipelines/registrations/rows"
		)
		const { upsertRow } = await import(
			"$lib/server/pipelines/registrations/write"
		)
		const scope = { kind: "session", sessionId: session!.id } as const
		await upsertRow(
			asDb(),
			opts.routine === "dropped"
				? rowOfDrop(REGISTRATION, scope, "owner")
				: rowOfChange(
						{ key: REGISTRATION, mode: "off" },
						scope,
						"owner"
					)
		)
	}
	return { user, session: session!, bookId: book!.id }
}

async function routineModeOf(sessionId: number) {
	const { sessionRoutineMode } = await import(
		"$lib/server/pipelines/routines/sessionRoutines"
	)
	return sessionRoutineMode(asDb(), sessionId, SUMMARIES)
}

async function contextOf(sessionId: number) {
	const { sessionSceneContext } = await import(
		"$lib/server/sessions/sceneSettings"
	)
	return (await sessionSceneContext(asDb(), sessionId))!
}

async function say(sessionId: number, content: string) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return insertLegacy(
		testDb as any,
		{ sessionId, role: "user", content } as any
	)
}

async function closedScene(w: Awaited<ReturnType<typeof makeWorld>>) {
	const { openScene, closeScene } = await import(
		"$lib/server/scenes/liveScenes"
	)
	const a = await say(w.session.id, "One.")
	const b = await say(w.session.id, "Two.")
	const opened = await openScene(asDb(), {
		sessionId: w.session.id,
		userId: w.user.id,
		channel: "main",
		atMessageId: a.id
	})
	await closeScene(asDb(), {
		sceneId: opened.scene.id,
		userId: w.user.id,
		atMessageId: b.id
	})
	return { sceneId: opened.scene.id, lines: [a.id, b.id] }
}

describe("a session with the routine", () => {
	test("its context reads On request whatever is stored, and carries the routine's mode", async () => {
		for (const summary of ["never", "onClose", "onRequest"] as const) {
			const w = await makeWorld({ summary })
			expect(await routineModeOf(w.session.id)).toBe("full")
			const ctx = await contextOf(w.session.id)
			expect(ctx.settings.summary).toBe("onRequest")
			expect(ctx.summaryRoutine).toBe("full")
		}
	})

	test("a routine set Off still counts as had, and the context says off", async () => {
		const w = await makeWorld({ summary: "never", routine: "off" })
		expect(await routineModeOf(w.session.id)).toBe("off")
		const ctx = await contextOf(w.session.id)
		expect(ctx.settings.summary).toBe("onRequest")
		expect(ctx.summaryRoutine).toBe("off")
	})

	test("stored On close: a scene's close drafts nothing", async () => {
		const { sceneCloseHandler } = await import("$lib/server/sockets/scenes")
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		const w = await makeWorld({ summary: "onClose" })
		expect(await routineModeOf(w.session.id)).not.toBeNull()
		const m1 = await say(w.session.id, "One.")
		const opened = await openScene(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id,
			channel: "main",
			atMessageId: m1.id
		})
		await say(w.session.id, "Two.")
		await sceneCloseHandler.handler(
			fakeSocket(w.user.id),
			{ sceneId: opened.scene.id },
			() => {}
		)
		await new Promise((r) => setTimeout(r, 500))
		const [row] = await testDb
			.select({
				status: schema.scenes.summaryStatus,
				closed: schema.scenes.closedAtMessageId
			})
			.from(schema.scenes)
			.where(eq(schema.scenes.id, opened.scene.id))
		expect(row!.closed).not.toBeNull()
		expect(row!.status).toBe("none")
	})

	test("stored Never: Summarize all is not refused", async () => {
		const { sceneProcessAllHandler } = await import(
			"$lib/server/sockets/scenes"
		)
		const w = await makeWorld({ summary: "never" })
		expect(await routineModeOf(w.session.id)).not.toBeNull()
		const res: any = await sceneProcessAllHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, requestId: "p1" },
			() => {}
		)
		expect(res.sessionId).toBe(w.session.id)
		expect(res.sceneIds).toEqual([])
	})

	test("stored Never: the due scene is named", async () => {
		const { sceneSummaryDueOf } = await import(
			"$lib/server/scenes/sceneSummaryDue"
		)
		const w = await makeWorld({ summary: "never" })
		expect(await routineModeOf(w.session.id)).not.toBeNull()
		const { sceneId } = await closedScene(w)
		for (let i = 0; i < 6; i++) await say(w.session.id, `Later ${i}.`)
		const r = await sceneSummaryDueOf(asDb(), w.session.id, { depth: 2 })
		expect(r.sceneId).toBe(sceneId)
	})

	test("stored Never or On close: the cues reply and the open scenes reply read On request", async () => {
		const { sceneCuesHandler, sceneOpenScenesHandler } = await import(
			"$lib/server/sockets/scenes"
		)
		for (const summary of ["never", "onClose"] as const) {
			const w = await makeWorld({ summary })
			expect(await routineModeOf(w.session.id)).toBe("full")
			const cues: any = await sceneCuesHandler.handler(
				fakeSocket(w.user.id),
				{ sessionId: w.session.id },
				() => {}
			)
			expect(cues.settings.summary).toBe("onRequest")
			const open: any = await sceneOpenScenesHandler.handler(
				fakeSocket(w.user.id),
				{ sessionId: w.session.id },
				() => {}
			)
			expect(open.settings.summary).toBe("onRequest")
		}
	})

	test("the resolver throwing: the context resolves On request with no routine, mayPlace unchanged, and warns", async () => {
		const w = await makeWorld({ summary: "never" })
		const before = await contextOf(w.session.id)
		const resolve = await import(
			"$lib/server/pipelines/registrations/resolve"
		)
		const spy = vi
			.spyOn(resolve, "effectiveRegistrations")
			.mockRejectedValue(new Error("resolver down"))
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const ctx = await contextOf(w.session.id)
			expect(ctx.settings.summary).toBe("onRequest")
			expect(ctx.summaryRoutine).toBeNull()
			expect(ctx.mayPlace).toBe(before.mayPlace)
			expect(warn).toHaveBeenCalledTimes(1)
			expect(String(warn.mock.calls[0]![0])).toContain(
				`session ${w.session.id}`
			)
		} finally {
			spy.mockRestore()
			warn.mockRestore()
		}
	})
})

describe("a session without the routine", () => {
	test("its context reads the stored value and has no routine", async () => {
		for (const summary of ["never", "onClose", "onRequest"] as const) {
			const w = await makeWorld({ summary, routine: "dropped" })
			expect(await routineModeOf(w.session.id)).toBeNull()
			const ctx = await contextOf(w.session.id)
			expect(ctx.settings.summary).toBe(summary)
			expect(ctx.summaryRoutine).toBeNull()
		}
	})

	test("Chat never has it: the stored value is read", async () => {
		const w = await makeWorld({
			summary: "onClose",
			genreId: "core:genre/chat"
		})
		expect(await routineModeOf(w.session.id)).toBeNull()
		expect((await contextOf(w.session.id)).settings.summary).toBe("onClose")
	})

	test("stored Never still refuses Summarize all, and the cues read Never", async () => {
		const { sceneProcessAllHandler, sceneCuesHandler } = await import(
			"$lib/server/sockets/scenes"
		)
		const w = await makeWorld({ summary: "never", routine: "dropped" })
		expect(await routineModeOf(w.session.id)).toBeNull()
		await expect(
			sceneProcessAllHandler.handler(
				fakeSocket(w.user.id),
				{ sessionId: w.session.id, requestId: "p2" },
				() => {}
			)
		).rejects.toThrow(
			"This session's scene summaries are off (Summaries: Never)."
		)
		const cues: any = await sceneCuesHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id },
			() => {}
		)
		expect(cues.settings.summary).toBe("never")
	})

	test("stored On close still drafts at a close", async () => {
		const { sceneCloseHandler } = await import("$lib/server/sockets/scenes")
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		const w = await makeWorld({ summary: "onClose", routine: "dropped" })
		expect(await routineModeOf(w.session.id)).toBeNull()
		const m1 = await say(w.session.id, "One.")
		const opened = await openScene(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id,
			channel: "main",
			atMessageId: m1.id
		})
		await say(w.session.id, "Two.")
		await sceneCloseHandler.handler(
			fakeSocket(w.user.id),
			{ sceneId: opened.scene.id },
			() => {}
		)
		let status = "none"
		for (let i = 0; i < 100 && status === "none"; i++) {
			await new Promise((r) => setTimeout(r, 50))
			const [row] = await testDb
				.select({ s: schema.scenes.summaryStatus })
				.from(schema.scenes)
				.where(eq(schema.scenes.id, opened.scene.id))
			status = row!.s
		}
		expect(["running", "failed", "review"]).toContain(status)
	})
})
