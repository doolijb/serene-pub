/**
 * 🚧 Live scenes §15 G1–G3, at the scenes routine's walk and outlet (boundaries
 * are found a couple of rounds late, by `sceneBoundariesOf`, and placed through
 * `proposeJudgedSceneCue`) and the per-line hook: a genre's **declared
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
import { everyNRounds, registrationKeyOf, type RegistrationDecl } from "@serene-pub/sdk"
import { SCENE_BOUNDARIES_SPEC_ID } from "@serene-pub/core-catalog"
import { rowOfDecl } from "$lib/server/pipelines/registrations/rows"

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
/** The test genre that opts into the first scene and the cast refresh (🚧 `shape.scenes.first`, `castRefresh`). */
const OPENING = "test:genre/opening"
/** The test genre that registers the scenes routine (only `noteTimeAction` asks). */
const ROUTINED = "test:genre/routined"
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
	// Raw, not through `genreKeeping`: the SDK does not declare these `scenes` keys yet.
	await publish("test:spec/opening-create", {
		inputGenre: OPENING,
		inputEvent: sessionEvents.sessionCreated,
		genre: {
			name: { en: "Opening" },
			family: "test",
			shape: { channels: ["main"], scenes: { first: true, castRefresh: true } }
		}
	})
	// The scenes routine, registered on a genre of its own: a registration row at genre
	// scope and the routine's spec published, as the boot writes them for the core genres.
	await publish(SCENE_BOUNDARIES_SPEC_ID, {})
	const routineDecl = {
		key: registrationKeyOf({ family: "routine", cadence: everyNRounds({ n: 2 }) } as any, SCENE_BOUNDARIES_SPEC_ID),
		trigger: { family: "routine", cadence: everyNRounds({ n: 2 }) },
		pipeline: SCENE_BOUNDARIES_SPEC_ID
	} as unknown as RegistrationDecl
	await testDb
		.insert(schema.registrations)
		.values(rowOfDecl(routineDecl, { kind: "genre", genreId: ROUTINED }, "genre"))
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

/** n plain lines on the current day. */
async function plain(sessionId: number, n: number) {
	const ids: number[] = []
	for (let i = 0; i < n; i++) ids.push((await say(sessionId, `Line ${i + 1}.`)).id)
	return ids
}

/** The routine's walk alone (a line is old at 2 rounds; `every` wide enough for a young session's whole past). */
async function found(sessionId: number, opts: { depth?: number; every?: number } = {}) {
	const { sceneBoundariesOf } = await import("./boundaryWatcher")
	return sceneBoundariesOf(testDb as any, sessionId, { depth: opts.depth ?? 2, every: opts.every ?? 10 })
}

/** One run of the scenes routine: the walk, then each boundary through the outlet, in line order. */
async function runRoutine(sessionId: number, opts: { depth?: number; every?: number } = {}) {
	const { proposeJudgedSceneCue } = await import("./boundaryWatcher")
	const walked = await found(sessionId, opts)
	const outcomes = []
	for (const b of walked.boundaries)
		outcomes.push(
			await proposeJudgedSceneCue(testDb as any, {
				sessionId,
				channel: "main",
				atMessageId: b.at,
				reason: b.reason,
				trigger: b.trigger
			})
		)
	return { ...walked, outcomes }
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
		// The per-line hook fires no trigger; the routine finds it two rounds on.
		expect(await watch(w.session.id, m2.id)).toBeNull()
		expect(await cuesOf(w.session.id)).toHaveLength(0)
		await plain(w.session.id, 1)
		const run = await runRoutine(w.session.id)
		expect(run.boundaries).toEqual([{ at: m2.id, trigger: "newFloor", reason: "the party reached a new floor" }])
		expect(run.outcomes).toMatchObject([{ outcome: "suggested" }])
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
		const m4 = await say(w.session.id, "Still the second floor.")
		expect(await watch(w.session.id, m4.id)).toBeNull()
		await plain(w.session.id, 1)
		expect((await runRoutine(w.session.id)).boundaries).toEqual([])
		expect(await cuesOf(w.session.id)).toHaveLength(1)
	}, 60_000)

	test("Automatic places the boundary; Manual records nothing; switched off, nothing fires", async () => {
		const { openSceneIds } = await import("./boundaryWatcher")
		const auto = await makeWorld({ genreId: DELVE, scenes: { mode: "automatic" } })
		await say(auto.session.id, "Top floor.")
		await setWorld(auto.session.id, FLOOR, 3)
		const a2 = await say(auto.session.id, "Third floor.")
		expect(await watch(auto.session.id, a2.id)).toBeNull()
		await plain(auto.session.id, 1)
		const placed = await runRoutine(auto.session.id)
		expect(placed.outcomes).toMatchObject([{ outcome: "placed" }])
		expect(placed.boundaries.map((b) => b.trigger)).toEqual(["newFloor"])
		expect(await openSceneIds(testDb as any, auto.session.id)).toEqual([placed.outcomes[0]!.openedSceneId])

		for (const scenes of [{ mode: "manual" }, { triggers: { newFloor: false } }]) {
			const w = await makeWorld({ genreId: DELVE, scenes })
			await say(w.session.id, "Up.")
			await setWorld(w.session.id, FLOOR, 2)
			const m2 = await say(w.session.id, "Down.")
			expect(await watch(w.session.id, m2.id)).toBeNull()
			await plain(w.session.id, 2)
			expect((await runRoutine(w.session.id)).boundaries).toEqual([])
			expect(await cuesOf(w.session.id)).toHaveLength(0)
		}
	}, 60_000)

	test("the other predicates: speaker and narration read the line; actionKey never fires under the routine", async () => {
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
			expect(await watch(w.session.id, envoy.id)).toBeNull()
			// A line a run of the trap action wrote: the hook fires nothing for it, and the
			// routine, two rounds on, cannot ask the run that wrote it, so the trigger never fires.
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
				expect(await watch(w.session.id, trap.id, ["run-trap-1"])).toBeNull()
			} finally {
				runRegistry.finish("run-trap-1")
			}
			// A person's line fires neither.
			const person = await say(w.session.id, "I step back.")
			expect(await watch(w.session.id, person.id)).toBeNull()
			await plain(w.session.id, 2)
			const run = await runRoutine(w.session.id)
			expect(run.boundaries.map((b) => [b.at, b.trigger])).toEqual([[envoy.id, "castellanSpoke"]])
			expect(await cuesOf(w.session.id)).toMatchObject([{ trigger: "castellanSpoke", atMessageId: envoy.id }])
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
		// The hook fires nothing; the routine finds the move two rounds on.
		expect(await watch(w.session.id, m2.id)).toBeNull()
		await plain(w.session.id, 1)
		expect((await found(w.session.id)).boundaries).toEqual([
			{ at: m2.id, trigger: "placeChanged", reason: "the place changed" }
		])

		// Back where the open scene opened, before anyone took the cue: no new scene.
		await setWorld(w.session.id, LOCATION, "the Entrance")
		const m3 = await say(w.session.id, "Back out again.")
		expect(await watch(w.session.id, m3.id)).toBeNull()
		await plain(w.session.id, 1)
		expect((await found(w.session.id)).boundaries).toEqual([])
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
		await plain(w.session.id, 2)
		expect((await found(w.session.id)).boundaries).toEqual([])
	}, 60_000)
})

describe("G3 — the open scene's stored cast follows the lines (a genre that opts in, never Manual)", () => {
	/** An open scene at its first line and a character who speaks the next. */
	async function openedWith(genreId: string | null, scenes: unknown) {
		const { openScene } = await import("./liveScenes")
		const w = await makeWorld({ genreId, scenes })
		const m1 = await say(w.session.id, "Hello?")
		const opened = await openScene(testDb as any, { sessionId: w.session.id, userId: w.user.id, atMessageId: m1.id })
		const speaker = async (name: string, content: string) => {
			const [c] = await testDb
				.insert(schema.characters)
				.values({ name, userId: w.user.id, description: "A delver." } as any)
				.returning()
			return { character: c!, line: await say(w.session.id, content, { role: "assistant", characterId: c!.id }) }
		}
		return { w, opened, speaker }
	}

	test("a new speaker joins the stored cast; a line by someone already in it writes nothing", async () => {
		const { refreshOpenSceneCast, } = await import("./liveScenes")
		const { openSceneCastCause, followOpenSceneCast } = await import("./boundaryWatcher")
		const { readSceneCast } = await import("$lib/server/utils/sceneCast")
		const { w, opened, speaker } = await openedWith(OPENING, { mode: "suggested" })
		expect((await readSceneCast(opened.scene.id, testDb as any)).participantCharacters).toEqual([])

		const aria = await speaker("Aria", "I'm here.")
		await watch(w.session.id, aria.line.id)
		const cast = await readSceneCast(opened.scene.id, testDb as any)
		expect(cast.participantCharacters).toHaveLength(1)
		const [binding] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, cast.participantCharacters[0]!))
		expect(binding.characterId).toBe(aria.character.id)

		const m3 = await say(w.session.id, "Still here.", { role: "assistant", characterId: aria.character.id })
		expect(
			await refreshOpenSceneCast(testDb as any, { sessionId: w.session.id, channel: "main", messageId: m3.id })
		).toBe(false)
		expect(await followOpenSceneCast(testDb as any, { sessionId: w.session.id, messageId: m3.id })).toBeNull()
		// A line before the open scene, or on a lane with none, is left alone.
		expect(
			await refreshOpenSceneCast(testDb as any, { sessionId: w.session.id, channel: "phone", messageId: m3.id })
		).toBe(false)
		const rows = await testDb
			.select()
			.from(schema.sceneCharacters)
			.where(and(eq(schema.sceneCharacters.sceneId, opened.scene.id)))
		expect(rows).toHaveLength(1)

		// A second speaker moves the cast: the refresh names the scene and its cause.
		const bea = await speaker("Bea", "Me too.")
		expect(await followOpenSceneCast(testDb as any, { sessionId: w.session.id, messageId: bea.line.id })).toEqual({
			sceneId: opened.scene.id,
			cause:
				"Opening keeps the open scene's cast up to date from its lines. Set How scenes begin to Manual to stop it."
		})
		expect(openSceneCastCause(null)).toBe(
			"This session's genre keeps the open scene's cast up to date from its lines. Set How scenes begin to Manual to stop it."
		)
	}, 60_000)

	test("a refresh with no trigger fired still follows, and invents no result", async () => {
		const { w, opened, speaker } = await openedWith(OPENING, { mode: "suggested" })
		const aria = await speaker("Aria", "I'm here.")
		// Nothing fired at the line: no result is invented for the refresh.
		expect(await watch(w.session.id, aria.line.id)).toBeNull()
		const { readSceneCast } = await import("$lib/server/utils/sceneCast")
		expect((await readSceneCast(opened.scene.id, testDb as any)).participantCharacters).toHaveLength(1)
	}, 60_000)

	test("a genre without castRefresh never refreshes the cast, in any mode", async () => {
		const { followOpenSceneCast } = await import("./boundaryWatcher")
		const { readSceneCast } = await import("$lib/server/utils/sceneCast")
		for (const genreId of [null, LAIR, DELVE]) {
			const { w, opened, speaker } = await openedWith(genreId, { mode: "suggested" })
			const aria = await speaker("Aria", "I'm here.")
			await watch(w.session.id, aria.line.id)
			expect(await followOpenSceneCast(testDb as any, { sessionId: w.session.id, messageId: aria.line.id })).toBeNull()
			expect((await readSceneCast(opened.scene.id, testDb as any)).participantCharacters).toEqual([])
		}
	}, 60_000)

	test("Manual is the off switch: the genre opted in, and the cast still does not follow", async () => {
		const { followOpenSceneCast } = await import("./boundaryWatcher")
		const { readSceneCast } = await import("$lib/server/utils/sceneCast")
		const { w, opened, speaker } = await openedWith(OPENING, { mode: "manual" })
		const aria = await speaker("Aria", "I'm here.")
		expect(await watch(w.session.id, aria.line.id)).toBeNull()
		expect(await followOpenSceneCast(testDb as any, { sessionId: w.session.id, messageId: aria.line.id })).toBeNull()
		expect((await readSceneCast(opened.scene.id, testDb as any)).participantCharacters).toEqual([])
	}, 60_000)
})

describe("the genre's first scene (🚧 shape.scenes.first)", () => {
	async function scenesOf(sessionId: number) {
		return testDb.select().from(schema.scenes).where(eq(schema.scenes.sessionId, sessionId))
	}

	test("Suggested: the routine gives the first line an open opening cue, offered as \"the story began\"; no scene", async () => {
		const { offeredSceneCues } = await import("./boundaryWatcher")
		const w = await makeWorld({ genreId: OPENING, scenes: { mode: "suggested" } })
		const m1 = await say(w.session.id, "Once upon a time.")
		// The hook never opens or offers the opening.
		expect(await watch(w.session.id, m1.id)).toBeNull()
		expect(await cuesOf(w.session.id)).toHaveLength(0)
		await plain(w.session.id, 1)
		const run = await runRoutine(w.session.id)
		expect(run.boundaries).toEqual([{ at: m1.id, trigger: "opening", reason: "the story began" }])
		expect(run.outcomes).toMatchObject([{ outcome: "suggested" }])
		const cues = await cuesOf(w.session.id)
		expect(cues).toHaveLength(1)
		expect(cues[0]).toMatchObject({ trigger: "opening", atMessageId: m1.id, state: "open" })
		expect(await offeredSceneCues(testDb as any, w.session.id)).toEqual([
			{ id: cues[0]!.id, channel: "main", messageId: m1.id, triggers: ["opening"], reason: "the story began" }
		])
		expect(await scenesOf(w.session.id)).toHaveLength(0)
	}, 60_000)

	test("Automatic: the routine opens Scene 1 at the first line; the opening cue is placed", async () => {
		const w = await makeWorld({ genreId: OPENING, scenes: { mode: "automatic" } })
		const m1 = await say(w.session.id, "Once upon a time.")
		expect(await watch(w.session.id, m1.id)).toBeNull()
		expect(await scenesOf(w.session.id)).toHaveLength(0)
		await plain(w.session.id, 1)
		const run = await runRoutine(w.session.id)
		expect(run.boundaries.map((b) => b.trigger)).toEqual(["opening"])
		const r = run.outcomes[0]!
		expect(r).toMatchObject({ outcome: "placed" })
		const scenes = await scenesOf(w.session.id)
		expect(scenes).toHaveLength(1)
		expect(scenes[0]).toMatchObject({ id: r.openedSceneId, openedAtMessageId: m1.id })
		expect((await cuesOf(w.session.id)).map((c) => [c.trigger, c.state])).toEqual([["opening", "placed"]])
	}, 60_000)

	test("Manual: nothing", async () => {
		const w = await makeWorld({ genreId: OPENING, scenes: { mode: "manual" } })
		const m1 = await say(w.session.id, "Once upon a time.")
		expect(await watch(w.session.id, m1.id)).toBeNull()
		await plain(w.session.id, 2)
		expect(await found(w.session.id)).toEqual({ boundaries: [], why: "scenes are Manual here" })
		expect((await runRoutine(w.session.id)).outcomes).toEqual([])
		expect(await cuesOf(w.session.id)).toHaveLength(0)
		expect(await scenesOf(w.session.id)).toHaveLength(0)
	}, 60_000)

	test("a session that already has lines gets no opening, hidden lines included", async () => {
		const w = await makeWorld({ genreId: OPENING, scenes: { mode: "suggested" } })
		await say(w.session.id, "One.")
		const m2 = await say(w.session.id, "Two.")
		const m3 = await say(w.session.id, "Three.")
		expect(await watch(w.session.id, m2.id)).toBeNull()
		expect(await watch(w.session.id, m3.id)).toBeNull()
		await plain(w.session.id, 2)
		// The routine's window opens after the first line (`every` of 1 round): the story
		// did not begin where it starts reading.
		expect((await runRoutine(w.session.id, { every: 1 })).boundaries).toEqual([])
		expect(await cuesOf(w.session.id)).toHaveLength(0)

		// A hidden earlier line still means the story did not begin here.
		const h = await makeWorld({ genreId: OPENING, scenes: { mode: "suggested" } })
		await say(h.session.id, "Hidden.", { isHidden: true })
		const visible = await say(h.session.id, "Visible.")
		expect(await watch(h.session.id, visible.id)).toBeNull()
		await plain(h.session.id, 2)
		expect((await runRoutine(h.session.id)).boundaries).toEqual([])
		expect(await cuesOf(h.session.id)).toHaveLength(0)
	}, 60_000)

	test("a removed opening scene never comes back", async () => {
		const w = await makeWorld({ genreId: OPENING, scenes: { mode: "automatic" } })
		const m1 = await say(w.session.id, "Once upon a time.")
		await plain(w.session.id, 1)
		const first = await runRoutine(w.session.id)
		expect(first.outcomes[0]?.outcome).toBe("placed")
		await testDb.delete(schema.scenes).where(eq(schema.scenes.id, first.outcomes[0]!.openedSceneId!))
		expect(await watch(w.session.id, m1.id)).toBeNull()
		expect((await runRoutine(w.session.id)).boundaries).toEqual([])
		await say(w.session.id, "And then.")
		await plain(w.session.id, 2)
		expect((await runRoutine(w.session.id)).boundaries).toEqual([])
		expect(await scenesOf(w.session.id)).toHaveLength(0)
		expect((await cuesOf(w.session.id)).map((c) => c.trigger)).toEqual(["opening"])
	}, 60_000)

	test("a genre without scenes.first gets no opening cue", async () => {
		for (const genreId of [LAIR, DELVE, null]) {
			const w = await makeWorld({ genreId, scenes: { mode: "suggested" } })
			const m1 = await say(w.session.id, "Once upon a time.")
			await watch(w.session.id, m1.id)
			await plain(w.session.id, 2)
			await runRoutine(w.session.id)
			expect((await cuesOf(w.session.id)).map((c) => c.trigger)).not.toContain("opening")
		}
	}, 60_000)
})

describe("noteTimeAction's cause (for lane H's call sites)", () => {
	test("a tick is never a time action; every other cause is; only where the scenes routine runs", async () => {
		const { noteTimeAction } = await import("./boundaryWatcher")
		const w = await makeWorld({ genreId: ROUTINED })
		await noteTimeAction(testDb as any, { sessionId: w.session.id, cause: "tick" })
		expect(await cuesOf(w.session.id)).toHaveLength(0)
		await noteTimeAction(testDb as any, { sessionId: w.session.id, cause: "keeper" })
		expect((await cuesOf(w.session.id)).map((c) => [c.trigger, c.state])).toEqual([["timeAction", "pending"]])
		// A genre that registers no scenes routine leaves no marker, whatever the cause.
		const bare = await makeWorld({ genreId: DELVE })
		await noteTimeAction(testDb as any, { sessionId: bare.session.id, cause: "keeper" })
		expect(await cuesOf(bare.session.id)).toHaveLength(0)
	}, 60_000)
})
