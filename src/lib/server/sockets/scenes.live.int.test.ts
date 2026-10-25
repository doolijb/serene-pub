/**
 * 🚧 Live scenes, lane B (PROPOSAL-live-scenes §3, §8, §14 B): scenes as
 * ranges, opened and closed at messages; filing, stamping, naming and cast
 * with no model; the message write stamp; the span read for the summarize
 * pipeline; and which spec `scenes:process` resolves.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	historyValues,
	insertSessionMessageRow
} from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-scenes-live-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

function recorder() {
	const emits: Array<{ event: string; data: any }> = []
	const emit = (event: string, data: any) => {
		emits.push({ event, data })
	}
	return { emits, emit }
}

let seq = 0
/**
 * A person, a book with a history entry at Year 5 Mo 1 Day 2, a character in
 * the session, and a session whose clock is `clock`.
 */
async function makeWorld(
	clock: { year: number; month?: number; day?: number } | null = {
		year: 5,
		month: 1,
		day: 2
	}
) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `live-scenes-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Live Book ${seq}`, userId: user.id })
		.returning()
	const [history] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{ lorebookId: lorebook.id, year: 5, month: 1, day: 2 }
			])
		)
		.returning()
	const [vell] = await testDb
		.insert(schema.characters)
		.values({
			userId: user.id,
			name: "Vell",
			description: "A smuggler."
		} as any)
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			lorebookId: lorebook.id,
			storyClockYear: clock?.year ?? null,
			storyClockMonth: clock?.month ?? null,
			storyClockDay: clock?.day ?? null
		})
		.returning()
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId: session.id, characterId: vell.id } as any)
	return { user, lorebook, history, vell, session }
}

async function say(
	sessionId: number,
	content: string,
	extra: Partial<typeof schema.sessionMessages.$inferInsert> = {}
) {
	return insertSessionMessageRow(testDb, sessionId, { content, ...extra })
}

describe("the message write stamp", () => {
	test("insertLegacy stamps the session's clock; a copy keeps what it was given", async () => {
		const { insertLegacy } = await import("$lib/server/messages/store")
		const w = await makeWorld({ year: 5, month: 1, day: 2 })
		const row = await insertLegacy(testDb as any, {
			sessionId: w.session.id,
			role: "user",
			content: "Stamped."
		})
		expect(row.storyClockYear).toBe(5)
		expect(row.storyClockMonth).toBe(1)
		expect(row.storyClockDay).toBe(2)

		const copy = await insertLegacy(testDb as any, {
			sessionId: w.session.id,
			role: "user",
			content: "Said earlier.",
			storyClockYear: 3,
			storyClockMonth: null,
			storyClockDay: null,
			storyClockHour: null,
			storyClockMinute: null
		})
		expect(copy.storyClockYear).toBe(3)
	}, 60_000)

	test("a session with no book stamps nothing", async () => {
		const { insertLegacy } = await import("$lib/server/messages/store")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, `live-scenes-nobook-${++seq}`)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()
		const row = await insertLegacy(testDb as any, {
			sessionId: session.id,
			role: "user",
			content: "Nowhere."
		})
		expect(row.storyClockYear).toBeNull()
	}, 60_000)
})

describe("scenes:open / scenes:close / scenes:moveBoundary", () => {
	test("open files under the entry dated at the clock, names the scene, writes the cast", async () => {
		const { sceneOpenHandler } = await import("./scenes")
		const w = await makeWorld()
		const m1 = await say(w.session.id, "We go tonight.", {
			role: "assistant",
			characterId: w.vell.id
		})
		const { emits, emit } = recorder()
		const res: any = await sceneOpenHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, atMessageId: m1.id, requestId: "r1" },
			emit
		)
		expect(res.requestId).toBe("r1")
		expect(res.sessionId).toBe(w.session.id)
		expect(res.scene.historyEntryId).toBe(w.history.id)
		expect(res.createdHistoryEntry).toBe(false)
		expect(res.scene.channel).toBe("main")
		expect(res.scene.openedAtMessageId).toBe(m1.id)
		expect(res.scene.closedAtMessageId).toBeNull()
		expect(res.scene.openedStoryClockYear).toBe(5)
		expect(res.scene.summaryStatus).toBe("none")
		expect(res.scene.name).toMatch(/^Scene 1 · /)
		// The sender is a participant, written as the book's member.
		expect(res.scene.participantCharacters).toHaveLength(1)
		expect(res.castProposal.some((p: any) => p.name === "Vell")).toBe(true)
		expect(emits.map((e) => e.event)).toContain("scenes:open")
	}, 60_000)

	test("a clock past the newest entry's day creates the entry dated at the clock", async () => {
		const { sceneOpenHandler } = await import("./scenes")
		const w = await makeWorld({ year: 5, month: 1, day: 9 })
		const m1 = await say(w.session.id, "Days later.")
		const res: any = await sceneOpenHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, atMessageId: m1.id },
			() => {}
		)
		expect(res.createdHistoryEntry).toBe(true)
		expect(res.scene.historyEntryId).not.toBe(w.history.id)
		const [entry] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, res.scene.historyEntryId))
		expect(entry.fields).toMatchObject({ year: 5, month: 1, day: 9 })
	}, 60_000)

	test("opening again closes the open scene before the new boundary; one open scene per channel", async () => {
		const { sceneOpenHandler } = await import("./scenes")
		const w = await makeWorld()
		const m1 = await say(w.session.id, "One.")
		const m2 = await say(w.session.id, "Two.")
		const m3 = await say(w.session.id, "Three.")
		const first: any = await sceneOpenHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, atMessageId: m1.id },
			() => {}
		)
		const second: any = await sceneOpenHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, atMessageId: m3.id },
			() => {}
		)
		expect(second.closedScene.id).toBe(first.scene.id)
		expect(second.closedScene.closedAtMessageId).toBe(m2.id)
		expect(second.closedScene.selectedMessageIds).toEqual([m1.id, m2.id])
		// Same day as the previous scene: no date on the name.
		expect(second.scene.name).toBe("Scene 2")

		// The partial unique index: a second open row on the channel is refused.
		await expect(
			testDb.insert(schema.scenes).values({
				lorebookId: w.lorebook.id,
				sessionId: w.session.id,
				historyEntryId: w.history.id,
				channel: "main",
				openedAtMessageId: m3.id
			})
		).rejects.toThrow()
	}, 60_000)

	test("close derives the selection from the range; a message inside a scene cannot open another", async () => {
		const { sceneOpenHandler, sceneCloseHandler } = await import("./scenes")
		const w = await makeWorld()
		const m1 = await say(w.session.id, "A.")
		const m2 = await say(w.session.id, "Hidden.", { isHidden: true })
		const m3 = await say(w.session.id, "B.")
		const side = await say(w.session.id, "Psst.", { channel: "sanctum" })
		const m4 = await say(w.session.id, "C.")
		const opened: any = await sceneOpenHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, atMessageId: m1.id },
			() => {}
		)
		const closed: any = await sceneCloseHandler.handler(
			fakeSocket(w.user.id),
			{ sceneId: opened.scene.id, atMessageId: m3.id },
			() => {}
		)
		expect(closed.scene.closedAtMessageId).toBe(m3.id)
		expect(closed.scene.closedStoryClockYear).toBe(5)
		// Hidden and other-channel rows are not the scene's story lines.
		expect(closed.scene.selectedMessageIds).toEqual([m1.id, m3.id])
		expect(m2.id).toBeLessThan(side.id)

		await expect(
			sceneOpenHandler.handler(
				fakeSocket(w.user.id),
				{ sessionId: w.session.id, atMessageId: m3.id },
				() => {}
			)
		).rejects.toThrow(/overlap/)

		// Closing with no message: the channel's newest line.
		const next: any = await sceneOpenHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, atMessageId: m4.id },
			() => {}
		)
		const done: any = await sceneCloseHandler.handler(
			fakeSocket(w.user.id),
			{ sceneId: next.scene.id },
			() => {}
		)
		expect(done.scene.closedAtMessageId).toBe(m4.id)
		await expect(
			sceneCloseHandler.handler(
				fakeSocket(w.user.id),
				{ sceneId: next.scene.id },
				() => {}
			)
		).rejects.toThrow(/already closed/)
	}, 60_000)

	test("moveBoundary re-derives the range and refuses an overlap", async () => {
		const {
			sceneOpenHandler,
			sceneCloseHandler,
			sceneMoveBoundaryHandler
		} = await import("./scenes")
		const w = await makeWorld()
		const m1 = await say(w.session.id, "1")
		const m2 = await say(w.session.id, "2")
		const m3 = await say(w.session.id, "3")
		const m4 = await say(w.session.id, "4")
		const a: any = await sceneOpenHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, atMessageId: m1.id },
			() => {}
		)
		const b: any = await sceneOpenHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, atMessageId: m3.id },
			() => {}
		)
		await sceneCloseHandler.handler(
			fakeSocket(w.user.id),
			{ sceneId: b.scene.id, atMessageId: m4.id },
			() => {}
		)
		// Scene A is [m1, m2]; pulling its end back to m1 frees m2.
		const moved: any = await sceneMoveBoundaryHandler.handler(
			fakeSocket(w.user.id),
			{ sceneId: a.scene.id, closedAt: m1.id },
			() => {}
		)
		expect(moved.scene.selectedMessageIds).toEqual([m1.id])
		// Pushing it into B is refused.
		await expect(
			sceneMoveBoundaryHandler.handler(
				fakeSocket(w.user.id),
				{ sceneId: a.scene.id, closedAt: m3.id },
				() => {}
			)
		).rejects.toThrow(/overlap/)
		// An end before the start is refused.
		await expect(
			sceneMoveBoundaryHandler.handler(
				fakeSocket(w.user.id),
				{ sceneId: b.scene.id, closedAt: m2.id, openedAt: m4.id },
				() => {}
			)
		).rejects.toThrow()
	}, 60_000)

	test("only the session's owner moves its boundaries; a session with no shared book files in its own", async () => {
		const { sceneOpenHandler } = await import("./scenes")
		const w = await makeWorld()
		const m1 = await say(w.session.id, "Mine.")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const stranger = await createTestUser(testDb, `live-stranger-${++seq}`)
		await expect(
			sceneOpenHandler.handler(
				fakeSocket(stranger.id),
				{ sessionId: w.session.id, atMessageId: m1.id },
				() => {}
			)
		).rejects.toThrow(/access denied/)

		const [bare] = await testDb
			.insert(schema.sessions)
			.values({ userId: w.user.id, isGroup: false })
			.returning()
		const b1 = await say(bare.id, "No book.")
		// 🚧 pr-6 (§B-3a): no shared book is no refusal — the scene is filed in
		// the session's own book.
		await sceneOpenHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: bare.id, atMessageId: b1.id },
			() => {}
		)
		const [own] = await testDb
			.select({ id: schema.lorebooks.id })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.sessionId, bare.id))
		const [filed] = await testDb
			.select({ lorebookId: schema.scenes.lorebookId })
			.from(schema.scenes)
			.where(eq(schema.scenes.sessionId, bare.id))
		expect(filed.lorebookId).toBe(own.id)
	}, 60_000)

	test("scenes:create (tick selection) still works beside ranges", async () => {
		const { sceneCreateHandler } = await import("./scenes")
		const w = await makeWorld()
		const m1 = await say(w.session.id, "Picked.")
		const { scene } = await sceneCreateHandler.handler(
			fakeSocket(w.user.id),
			{
				scene: {
					lorebookId: w.lorebook.id,
					sessionId: w.session.id,
					historyEntryId: w.history.id,
					selectedMessageIds: [m1.id]
				}
			} as any,
			() => {}
		)
		expect(scene.openedAtMessageId).toBeNull()
		expect(scene.selectedMessageIds).toEqual([m1.id])
	}, 60_000)
})

describe("the summarize span and spec resolution", () => {
	test("summarize_span reads the story lane by range and attaches asides to the line they follow", async () => {
		const w = await makeWorld()
		const m1 = await say(w.session.id, "Story one.", {
			role: "assistant",
			characterId: w.vell.id
		})
		const a1 = await say(w.session.id, "Plan A.", { channel: "sanctum" })
		const a2 = await say(w.session.id, "Plan B.", { channel: "sanctum:2" })
		const a3 = await say(w.session.id, "Plan C.", { channel: "sanctum" })
		const m2 = await say(w.session.id, "Story two.")
		const other = await say(w.session.id, "Off-scene.", {
			channel: "phone"
		})
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(
			testDb as any,
			{ sessionId: w.session.id } as any
		)
		const node = {
			key: "source",
			definitionId: "core:query/summarize-source@2"
		} as any
		const span: any = await host.read!(
			"summarize_span",
			{
				sessionId: w.session.id,
				channel: "main",
				asides: ["sanctum"],
				openedAt: m1.id,
				closedAt: m2.id
			},
			node
		)
		expect(span.messages.map((m: any) => m.id)).toEqual([m1.id, m2.id])
		expect(span.messages[0].senderName).toBe("Vell")
		// Lane then time within the gap: lane 1's two, then lane 2's.
		expect(span.asides.map((m: any) => m.id)).toEqual([a1.id, a3.id, a2.id])
		expect(span.asides.every((m: any) => m.afterMessageId === m1.id)).toBe(
			true
		)
		expect(span.asides.map((m: any) => m.id)).not.toContain(other.id)

		// Rendered into units and batched: a unit per line and per aside,
		// asides after the line they follow; the preamble opens each batch.
		const { renderTranscript, batchUnits } = await import(
			"$lib/server/pipelines/runtime/transcript"
		)
		const { renderTemplate } = await import(
			"$lib/server/pipelines/prompt/renderers"
		)
		const render = (source: string, variables: Record<string, unknown>) =>
			renderTemplate("core:template/handlebars@1", {
				template: source,
				variables
			})
		const count = (t: string) => Math.ceil(t.length / 4)
		// The genre's template defines `aside` only; the rest is the Default's.
		const template =
			'{{#*inline "aside"}}[Sanctum {{{channel}}}] {{{name}}}: {{{text}}}{{/inline}}'
		const rendered = await renderTranscript(
			{
				messages: span.messages,
				asides: span.asides,
				scene: { scene: { name: "Scene 1" } },
				cast: { characters: [{ name: "Vell" }] }
			},
			template,
			render,
			count
		)
		expect(rendered.preamble).toBe("Scene: Scene 1\nPresent: Vell")
		expect(rendered.units.map((u) => u.messageId)).toEqual([
			m1.id,
			a1.id,
			a3.id,
			a2.id,
			m2.id
		])
		expect(rendered.units[0].text).toBe("Vell: Story one.")
		expect(rendered.units[3].text).toContain("[Sanctum sanctum:2]")
		// No template: the shipped Default throughout.
		const plain = await renderTranscript(
			{ messages: span.messages, asides: span.asides },
			null,
			render,
			count
		)
		expect(plain.preamble).toBe("")
		expect(plain.units[1].text).toMatch(
			/^\[Aside on sanctum, outside the story\]/
		)

		// A story line's files follow its text, named as `batch-messages@1`
		// names them (`history-attachments@1`, by message id); a line with
		// none renders as it did.
		const withFiles = await renderTranscript(
			{
				messages: span.messages,
				attachments: {
					[String(m1.id)]: [
						{
							attachmentKind: "image",
							filename: "cat.png",
							text: "a grey cat"
						},
						{ attachmentKind: "text", filename: "notes.txt" }
					]
				}
			},
			null,
			render,
			count
		)
		expect(withFiles.units[0].text).toBe(
			"Vell: Story one.\n[image: cat.png — a grey cat]\n[file: notes.txt]"
		)
		expect(withFiles.units[1].text).toBe(
			plain.units[plain.units.length - 1].text
		)
		expect(withFiles.units[0].tokens).toBe(count(withFiles.units[0].text))

		// 🚧 Lane E: an aside's files follow ITS text the same way, from the
		// second read over the asides (`asideAttachments`); the story's
		// files never name an aside's.
		const asideFiles = await renderTranscript(
			{
				messages: span.messages,
				asides: span.asides,
				attachments: {
					[String(a1.id)]: [{ attachmentKind: "image", filename: "wrong.png" }]
				},
				asideAttachments: {
					[String(a1.id)]: [
						{ attachmentKind: "image", filename: "plan.png", text: "a floor plan" }
					]
				}
			},
			null,
			render,
			count
		)
		expect(asideFiles.units[1].text).toBe(
			"[Aside on sanctum, outside the story] " +
				plain.units[1].text.replace(/^\[Aside on sanctum, outside the story\] /, "") +
				"\n[image: plan.png — a floor plan]"
		)
		expect(asideFiles.units[1].text).not.toContain("wrong.png")

		const batches = batchUnits(
			rendered.preamble,
			rendered.units,
			10_000,
			1,
			count
		)
		expect(batches).toHaveLength(1)
		expect(batches[0].startsWith("Scene: Scene 1\nPresent: Vell\n\n")).toBe(
			true
		)
		const tight = batchUnits(
			rendered.preamble,
			rendered.units,
			1,
			2,
			() => 5
		)
		expect(tight).toHaveLength(3)
		expect(tight.every((b) => b.startsWith("Scene: Scene 1"))).toBe(true)
		expect(batchUnits("Head", [], 100, 1, count)).toEqual([])
	}, 60_000)

	test("a session's scene spec: the genre's summarize.scene, else core's default", async () => {
		const { resolveSummarizeSceneSpec, DEFAULT_SUMMARIZE_SCENE_SPEC_ID } =
			await import("$lib/server/scenes/liveScenes")
		const w = await makeWorld()
		// Chat declares its own spec; none is published in this database, so
		// the default runs — and says so.
		const chat = await resolveSummarizeSceneSpec(
			testDb as any,
			w.session.id
		)
		expect(chat.specId).toBe(DEFAULT_SUMMARIZE_SCENE_SPEC_ID)
		expect(await resolveSummarizeSceneSpec(testDb as any, null)).toEqual({
			specId: DEFAULT_SUMMARIZE_SCENE_SPEC_ID
		})
		// A genre naming a spec that is not published here falls back, with a note.
		await testDb
			.update(schema.sessions)
			.set({ genreId: "x:genre/y" } as any)
			.where(eq(schema.sessions.id, w.session.id))
		const sdk = await import("@serene-pub/sdk")
		const spy = vi
			.spyOn(sdk, "getGenre")
			.mockReturnValue({
				id: "x:genre/y",
				summarize: { scene: "x:spec/missing" }
			} as any)
		try {
			const r = await resolveSummarizeSceneSpec(
				testDb as any,
				w.session.id
			)
			expect(r.specId).toBe(DEFAULT_SUMMARIZE_SCENE_SPEC_ID)
			expect(r.note).toMatch(/default pipeline/)
		} finally {
			spy.mockRestore()
		}
		// Nothing on the scene changes by resolving.
		const rows = await testDb
			.select()
			.from(schema.scenes)
			.where(and(eq(schema.scenes.sessionId, w.session.id)))
		expect(rows).toHaveLength(0)
	}, 60_000)
})
