/**
 * 🚧 Live scenes §15 G1–G3, at the boundary watcher: a genre's **declared
 * boundary triggers** (★9 — off its summarize-scene spec's
 * `contributes.boundaryTriggers`), the genre's **place**
 * (`SessionShape.scenes.place`, read off the state ledger as it stood at each
 * line) and the open scene's **stored cast** following the lines. No model.
 *
 * No core genre declares a boundary trigger of its own (the Lair's *new
 * floor* went with its floor slot, 2026-10-21), so G1 declares one on a TEST
 * genre, `test:genre/delve`: its *new floor*, read off the world's `floor`.
 * Each genre's published rows — its create spec (the genre's shape, as boot
 * writes it) and its summarize-scene spec — are written straight into the
 * registry tables, as `bootstrapPipelines` would.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import type { BoundaryTriggerDecl } from "@serene-pub/sdk"
import { genreKeeping } from "$lib/server/utils/testGenre"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const LAIR = "core:genre/lair"
/** The test genre G1 declares its boundary trigger on. */
const DELVE = "test:genre/delve"
const DELVE_SUMMARIZE_SCENE = "test:spec/delve-summarize-scene"
const NEW_FLOOR = {
	key: "newFloor",
	label: { en: "the party reached a new floor" },
	when: { channel: "main", stateKey: "floor" }
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-boundary-genre-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { sessionEvents, genre: defineGenre } = await import("@serene-pub/sdk")
	const {
		lairGenre,
		lairSummarizeSceneSpec,
		LAIR_SUMMARIZE_SCENE_SPEC_ID,
		summarizeScene,
		GENRE_SUMMARIZE_SCENE_VERSION,
		floorSlot,
		locationSlot
	} = await import("@serene-pub/core-catalog")
	/** One published version of a slug, as the registry holds it. */
	const publish = async (slug: string, version: Record<string, unknown>) => {
		const [spec] = await testDb.insert(schema.pipelineSpecs).values({ slug, name: slug }).returning()
		const [row] = await testDb
			.insert(schema.pipelineSpecVersions)
			.values({
				specId: spec.id,
				semver: "1.0.0",
				status: "published",
				canonicalHash: `test-${slug}`,
				...version
			} as any)
			.returning()
		await testDb
			.update(schema.pipelineSpecs)
			.set({ activeVersionId: row.id })
			.where(eq(schema.pipelineSpecs.id, spec.id))
	}
	await publish("core:spec/lair-create", {
		inputGenre: LAIR,
		inputEvent: sessionEvents.sessionCreated,
		genre: { name: lairGenre.name, family: lairGenre.family, shape: lairGenre.shape }
	})
	await publish(LAIR_SUMMARIZE_SCENE_SPEC_ID, {
		contributes: (lairSummarizeSceneSpec() as { contributes?: unknown }).contributes
	})
	// The test genre: the world's floor and place, and its own trigger on its
	// summarize-scene spec — the one way a genre declares one.
	const delve = genreKeeping(DELVE, {
		name: { en: "Delve" },
		family: "test",
		shape: { channels: ["main"], scenes: { place: { stateKey: "location" } } },
		slots: [floorSlot, locationSlot],
		events: {},
		summarize: { scene: DELVE_SUMMARIZE_SCENE }
	})
	await publish("test:spec/delve-create", {
		inputGenre: DELVE,
		inputEvent: sessionEvents.sessionCreated,
		genre: { name: delve.name, family: delve.family, shape: delve.shape }
	})
	const delveSummarize = summarizeScene(DELVE_SUMMARIZE_SCENE, {
		version: GENRE_SUMMARIZE_SCENE_VERSION,
		genre: delve,
		channels: { story: "main" },
		boundaries: [NEW_FLOOR]
	}) as { contributes?: unknown }
	await publish(DELVE_SUMMARIZE_SCENE, { contributes: delveSummarize.contributes })
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
/** A person, a book, and a Lair session reading it (or another genre's; null: Chat). */
async function makeWorld(opts: { scenes?: unknown; genreId?: string | null } = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `boundary-genre-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Genre Book ${seq}`, userId: user.id })
		.returning()
	await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: lorebook.id, year: 5, month: 1, day: 2 }]))
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			lorebookId: lorebook.id,
			// null: the column's default (Chat), which names no place and declares no trigger.
			...(opts.genreId === null ? {} : { genreId: opts.genreId ?? LAIR }),
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 2,
			metadata: opts.scenes ? { scenes: opts.scenes } : {}
		} as any)
		.returning()
	return { user, lorebook, session }
}

async function say(sessionId: number, content: string, extra: Record<string, unknown> = {}) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return insertLegacy(testDb as any, { sessionId, role: "user", content, ...extra } as any)
}

/** One world value written to the session's ledger, as a keeper's apply appends it. */
async function setWorld(sessionId: number, slotId: string, v: unknown) {
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "session",
		ownerId: sessionId,
		slotId,
		value: { v },
		sessionId,
		updatedBy: "run:test"
	} as any)
}

async function watch(sessionId: number, messageId: number, runIds?: string[]) {
	const { watchSceneBoundaries } = await import("./boundaryWatcher")
	return watchSceneBoundaries(testDb as any, { sessionId, messageId, ...(runIds ? { runIds } : {}) })
}

async function cuesOf(sessionId: number) {
	return testDb.select().from(schema.sceneCues).where(eq(schema.sceneCues.sessionId, sessionId))
}

const LOCATION = "core:slot/location@1"
const FLOOR = "core:slot/floor@1"

describe("G1 — a genre's declared boundary trigger (★9)", () => {
	test("the session reads its genre's from the summarize-scene spec, on unless switched off", async () => {
		const { sessionSceneContext } = await import("$lib/server/sessions/sceneSettings")
		const w = await makeWorld({ genreId: DELVE })
		const ctx = await sessionSceneContext(testDb as any, w.session.id)
		expect(ctx?.placeKey).toBe("location")
		expect(ctx?.declaredTriggers).toEqual([
			{
				key: "newFloor",
				label: { en: "the party reached a new floor" },
				when: { channel: "main", stateKey: "floor" },
				on: true,
				words: "the party reached a new floor"
			}
		])
		const off = await makeWorld({ genreId: DELVE, scenes: { triggers: { newFloor: false } } })
		expect((await sessionSceneContext(testDb as any, off.session.id))?.declaredTriggers[0]?.on).toBe(false)
		// The Lair declares none of its own since its rewrite: the place changing covers room to room.
		const lair = await makeWorld()
		const lairCtx = await sessionSceneContext(testDb as any, lair.session.id)
		expect(lairCtx?.placeKey).toBe("location")
		expect(lairCtx?.declaredTriggers).toEqual([])
	}, 60_000)

	test("Suggested: the floor changing between two lines cues a new scene there, in the trigger's words", async () => {
		const { offeredSceneCues } = await import("./boundaryWatcher")
		const w = await makeWorld({ genreId: DELVE })
		const m1 = await say(w.session.id, "We take the stairs.")
		expect(await watch(w.session.id, m1.id)).toBeNull()
		await setWorld(w.session.id, FLOOR, 2)
		const m2 = await say(w.session.id, "Down here it is colder.")
		const r = await watch(w.session.id, m2.id)
		expect(r).toMatchObject({ outcome: "suggested", messageId: m2.id, triggers: ["newFloor"] })
		const cues = await cuesOf(w.session.id)
		expect(cues).toHaveLength(1)
		expect(cues[0]).toMatchObject({ trigger: "newFloor", atMessageId: m2.id, state: "open" })
		expect(await offeredSceneCues(testDb as any, w.session.id)).toEqual([
			{
				id: cues[0]!.id,
				channel: "main",
				messageId: m2.id,
				triggers: ["newFloor"],
				reason: "the party reached a new floor"
			}
		])
		// The next line on the same floor: nothing new.
		const m3 = await say(w.session.id, "Still the second floor.")
		expect(await watch(w.session.id, m3.id)).toBeNull()
	}, 60_000)

	test("Automatic places the boundary; Manual records nothing; switched off, nothing fires", async () => {
		const { openSceneIds } = await import("./boundaryWatcher")
		const auto = await makeWorld({ genreId: DELVE, scenes: { mode: "automatic" } })
		await say(auto.session.id, "Top floor.")
		await setWorld(auto.session.id, FLOOR, 3)
		const a2 = await say(auto.session.id, "Third floor.")
		const placed = await watch(auto.session.id, a2.id)
		expect(placed).toMatchObject({ outcome: "placed", triggers: ["newFloor"] })
		expect(await openSceneIds(testDb as any, auto.session.id)).toEqual([placed!.openedSceneId])

		for (const scenes of [{ mode: "manual" }, { triggers: { newFloor: false } }]) {
			const w = await makeWorld({ genreId: DELVE, scenes })
			await say(w.session.id, "Up.")
			await setWorld(w.session.id, FLOOR, 2)
			const m2 = await say(w.session.id, "Down.")
			expect(await watch(w.session.id, m2.id)).toBeNull()
			expect(await cuesOf(w.session.id)).toHaveLength(0)
		}
	}, 60_000)

	test("the other predicates: speaker, narration and actionKey read the line and the run that wrote it", async () => {
		const liveScenes = await import("./liveScenes")
		const runRegistry = await import("$lib/server/pipelines/runtime/runRegistry")
		const w = await makeWorld({ genreId: null })
		const declared = [
			{ key: "castellanSpoke", label: "the Castellan spoke", when: { speaker: "narrator", narration: false } },
			{ key: "trapSprung", label: "a trap was sprung", when: { actionKey: "trigger-trap" } }
		] as const
		const spy = vi
			.spyOn(liveScenes, "sessionBoundaryTriggers")
			.mockResolvedValue(declared as unknown as BoundaryTriggerDecl[])
		try {
			await say(w.session.id, "I open the door.")
			// An envoy's line (no character, no narration flag): the story's own voice.
			const envoy = await say(w.session.id, "The door creaks.", { role: "assistant" })
			expect((await watch(w.session.id, envoy.id))?.triggers).toEqual(["castellanSpoke"])
			// A line a run of the trap action wrote.
			runRegistry.start({
				runId: "run-trap-1",
				userId: w.user.id,
				sessionId: w.session.id,
				specId: "core:spec/lair-trap",
				kind: "action",
				action: "core:spec/lair-trap#trigger-trap"
			})
			try {
				const trap = await say(w.session.id, "The floor gives way!", {
					role: "assistant",
					isNarratorResponse: true
				})
				expect((await watch(w.session.id, trap.id, ["run-trap-1"]))?.triggers).toEqual(["trapSprung"])
			} finally {
				runRegistry.finish("run-trap-1")
			}
			// A person's line fires neither.
			const person = await say(w.session.id, "I step back.")
			expect(await watch(w.session.id, person.id)).toBeNull()
		} finally {
			spy.mockRestore()
		}
	}, 60_000)

	test("a session's override may switch a declared key, and nothing it does not declare", async () => {
		const { writeSceneSettings, SceneSettingsRefusal } = await import("$lib/server/sessions/sceneSettings")
		const w = await makeWorld({ genreId: DELVE })
		await writeSceneSettings(testDb as any, w.session.id, { triggers: { newFloor: false } })
		await expect(
			writeSceneSettings(testDb as any, w.session.id, { triggers: { sanctumTalk: false } as never })
		).rejects.toBeInstanceOf(SceneSettingsRefusal)
		await expect(
			writeSceneSettings(testDb as any, w.session.id, { place: { stateKey: "floor" } })
		).rejects.toThrow(/the place is the genre's to name/)
		const [row] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect((row.metadata as any).scenes).toEqual({ triggers: { newFloor: false } })
	}, 60_000)
})

describe("G2 — the genre's place", () => {
	test("place changed fires where the room moves, read as each line was written; names carry the place", async () => {
		const { scenePlaceOf, openScene } = await import("./liveScenes")
		const w = await makeWorld()
		await setWorld(w.session.id, LOCATION, "the Entrance")
		const m1 = await say(w.session.id, "We step in.")
		const opened = await openScene(testDb as any, {
			sessionId: w.session.id,
			userId: w.user.id,
			atMessageId: m1.id
		})
		// `Scene N · <place>`, then the day (the first scene's differs from none).
		expect(opened.scene.name!.startsWith("Scene 1 · the Entrance · ")).toBe(true)

		await setWorld(w.session.id, LOCATION, "the Crypt")
		const m2 = await say(w.session.id, "Bones everywhere.")
		// As each line was written: the Entrance at m1, the Crypt at m2.
		expect(await scenePlaceOf(testDb as any, w.session.id, { messageId: m1.id })).toBe("the Entrance")
		expect(await scenePlaceOf(testDb as any, w.session.id, { messageId: m2.id })).toBe("the Crypt")
		expect(await scenePlaceOf(testDb as any, w.session.id)).toBe("the Crypt")
		expect((await watch(w.session.id, m2.id))?.triggers).toEqual(["placeChanged"])

		// Back where the open scene opened, before anyone took the cue: no new scene.
		await setWorld(w.session.id, LOCATION, "the Entrance")
		const m3 = await say(w.session.id, "Back out again.")
		expect(await watch(w.session.id, m3.id)).toBeNull()
	}, 60_000)

	test("🚧 G17: the summarize request's scene carries the place as it stood at the opening line, and both shipped templates say it", async () => {
		const { openScene, sceneHeaderOf } = await import("./liveScenes")
		const { renderTranscript } = await import("$lib/server/pipelines/runtime/transcript")
		const { renderTemplate } = await import("$lib/server/pipelines/prompt/renderers")
		const { DEFAULT_TRANSCRIPT_TEMPLATE, LAIR_TRANSCRIPT_TEMPLATE } = await import("@serene-pub/core-catalog")
		const w = await makeWorld()
		await setWorld(w.session.id, LOCATION, "the Vault")
		const m1 = await say(w.session.id, "Gold, everywhere.")
		const opened = await openScene(testDb as any, { sessionId: w.session.id, userId: w.user.id, atMessageId: m1.id })
		// The room moves on; the scene opened in the Vault.
		await setWorld(w.session.id, LOCATION, "the Stair")
		await say(w.session.id, "Up we go.")
		const [row] = await testDb.select().from(schema.scenes).where(eq(schema.scenes.id, opened.scene.id))
		// The automatic name already says the place, so the header does not
		// say it twice.
		expect(row!.name).toContain("the Vault")
		const auto = await sceneHeaderOf(testDb as any, row!)
		expect(auto.name).toBe(row!.name)
		expect(auto.place).toBeUndefined()
		// Renamed, the name no longer says it: the header carries the place
		// as it stood at the opening line, not where the room moved on to.
		const header = await sceneHeaderOf(testDb as any, { ...row!, name: "The treasury" })
		expect(header.place).toBe("the Vault")
		const render = (source: string, variables: Record<string, unknown>) =>
			renderTemplate("core:template/handlebars@1", { template: source, variables })
		const preamble = async (template: string) =>
			(await renderTranscript({ messages: [], scene: { scene: header } }, template, render, (t) => t.length))
				.preamble
		expect(await preamble(DEFAULT_TRANSCRIPT_TEMPLATE)).toContain(`, at the Vault`)
		expect(await preamble(LAIR_TRANSCRIPT_TEMPLATE)).toContain(`, in the Vault`)

		// A genre that names no place: none on the request either.
		const chat = await makeWorld({ genreId: null })
		await setWorld(chat.session.id, LOCATION, "the Harbour")
		const c1 = await say(chat.session.id, "Gulls.")
		const chatScene = await openScene(testDb as any, { sessionId: chat.session.id, userId: chat.user.id, atMessageId: c1.id })
		const [chatRow] = await testDb.select().from(schema.scenes).where(eq(schema.scenes.id, chatScene.scene.id))
		expect((await sceneHeaderOf(testDb as any, chatRow!)).place).toBeUndefined()
	}, 60_000)

	test("a genre that names no place never fires it, and its names carry none", async () => {
		const { openScene, scenePlaceOf } = await import("./liveScenes")
		const w = await makeWorld({ genreId: null })
		await setWorld(w.session.id, LOCATION, "the Harbour")
		const m1 = await say(w.session.id, "Gulls.")
		expect(await scenePlaceOf(testDb as any, w.session.id)).toBeNull()
		const opened = await openScene(testDb as any, { sessionId: w.session.id, userId: w.user.id, atMessageId: m1.id })
		expect(opened.scene.name!.startsWith("Scene 1")).toBe(true)
		expect(opened.scene.name).not.toContain("Harbour")
		await setWorld(w.session.id, LOCATION, "the Market")
		const m2 = await say(w.session.id, "Fish.")
		expect(await watch(w.session.id, m2.id)).toBeNull()
	}, 60_000)
})

describe("G3 — the open scene's stored cast follows the lines", () => {
	test("a new speaker joins the stored cast; a line by someone already in it writes nothing", async () => {
		const { openScene, refreshOpenSceneCast } = await import("./liveScenes")
		const { readSceneCast } = await import("$lib/server/utils/sceneCast")
		const w = await makeWorld({ genreId: null, scenes: { mode: "manual" } })
		const m1 = await say(w.session.id, "Hello?")
		const opened = await openScene(testDb as any, { sessionId: w.session.id, userId: w.user.id, atMessageId: m1.id })
		expect((await readSceneCast(opened.scene.id, testDb as any)).participantCharacters).toEqual([])

		const [aria] = await testDb
			.insert(schema.characters)
			.values({ name: "Aria", userId: w.user.id, description: "A delver." } as any)
			.returning()
		const m2 = await say(w.session.id, "I'm here.", { role: "assistant", characterId: aria.id })
		// Manual mode: no cue, but the cast still follows.
		expect(await watch(w.session.id, m2.id)).toBeNull()
		const cast = await readSceneCast(opened.scene.id, testDb as any)
		expect(cast.participantCharacters).toHaveLength(1)
		const [binding] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, cast.participantCharacters[0]!))
		expect(binding.characterId).toBe(aria.id)

		const m3 = await say(w.session.id, "Still here.", { role: "assistant", characterId: aria.id })
		expect(
			await refreshOpenSceneCast(testDb as any, { sessionId: w.session.id, channel: "main", messageId: m3.id })
		).toBe(false)
		// A line before the open scene, or on a lane with none, is left alone.
		expect(
			await refreshOpenSceneCast(testDb as any, { sessionId: w.session.id, channel: "phone", messageId: m3.id })
		).toBe(false)
		const rows = await testDb
			.select()
			.from(schema.sceneCharacters)
			.where(and(eq(schema.sceneCharacters.sceneId, opened.scene.id)))
		expect(rows).toHaveLength(1)
	}, 60_000)
})

describe("noteTimeAction's cause (for lane H's call sites)", () => {
	test("a tick is never a time action; every other cause is", async () => {
		const { noteTimeAction } = await import("./boundaryWatcher")
		const w = await makeWorld({ genreId: null })
		await noteTimeAction(testDb as any, { sessionId: w.session.id, cause: "tick" })
		expect(await cuesOf(w.session.id)).toHaveLength(0)
		await noteTimeAction(testDb as any, { sessionId: w.session.id, cause: "keeper" })
		expect((await cuesOf(w.session.id)).map((c) => [c.trigger, c.state])).toEqual([["timeAction", "pending"]])
	}, 60_000)
})
