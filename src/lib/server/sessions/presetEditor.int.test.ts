/**
 * 🚧 The admin preset editor's reads (PLAN-layering §4, P4, R2, R4, A5,
 * A10; lane 7) against the published catalogue: a preset's view (the
 * genre's defaults, its changes, what it runs, its settings, the trigger
 * catalogue); the pipeline picker filtered by fit with reasons in words;
 * the condition picker's derived properties; a preset's settings checked
 * against the genre's fields; routine purposes for the settings form.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { coreEvents, eventIdOf, everyNTurns } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

let testDb: TestDb
let dataDir: string

const STORY = "core:genre/story"
const SWEEP = "every-n-turns→story-sweep"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-preset-editor-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function presetId(seedKey: string): Promise<number> {
	const [p] = await testDb
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, seedKey))
	return p!.id
}

describe("the preset editor's view", () => {
	test("Minimal: the genre's defaults, its drops, what it runs, the catalogue", async () => {
		const { presetEditorView } = await import("./presetEditor")
		const view = await presetEditorView(testDb as any, await presetId("core-story-minimal"))
		expect(view?.genreId).toBe(STORY)
		const defaultKeys = view!.defaults!.map((r) => r.key)
		expect(defaultKeys).toContain(SWEEP)
		expect(view!.changes?.drop ?? []).toContain(SWEEP)
		expect(view!.effective!.map((r) => r.key)).not.toContain(SWEEP)
		// Every registration names its pipeline in words.
		expect(view!.defaults!.every((r) => typeof r.pipelineName === "string" && r.pipelineName.length > 0)).toBe(true)
		// The catalogue the Add picker builds a trigger from.
		expect(view!.catalogue!.events.some((e) => e.id === eventIdOf(coreEvents.sceneOpened))).toBe(true)
		expect(view!.catalogue!.cadences.some((c) => c.id === everyNTurns({ n: 1 }).id && "n" in c.options)).toBe(true)
		expect(view!.catalogue!.actions.length).toBeGreaterThan(0)
	})

	test("settings: the genre's fields and the rules, with each layer's say", async () => {
		const { presetEditorView } = await import("./presetEditor")
		const view = await presetEditorView(testDb as any, await presetId("core-story-rule-based"))
		const rigour = view!.settings!.find((s) => s.key === "rigour")
		expect(rigour?.rules).toBe(true)
		expect(rigour?.preset).toMatchObject({ value: "scripts", lock: true })
		expect(view!.settings!.some((s) => s.key === "autoAdvance")).toBe(true)
	})

	test("no such preset: null", async () => {
		const { presetEditorView } = await import("./presetEditor")
		expect(await presetEditorView(testDb as any, 987654)).toBeNull()
	})
})

describe("the pipeline picker, filtered by fit (R4)", () => {
	test("a routine trigger: routine pipelines fit, a reply does not — and says why", async () => {
		const { registrationCandidates } = await import("./presetEditor")
		const list = await registrationCandidates(testDb as any, { family: "routine", cadence: everyNTurns({ n: 5 }) } as any)
		const sweep = list.find((c) => c.slug === "core:spec/story-sweep")
		expect(sweep?.fits).toBe(true)
		const reply = list.find((c) => c.slug === "core:spec/story-respond")
		expect(reply?.fits).toBe(false)
		expect(reply?.reason).toMatch(/routine/)
		// Those that fit come first.
		const firstUnfit = list.findIndex((c) => !c.fits)
		expect(list.slice(firstUnfit).every((c) => !c.fits)).toBe(true)
	})
})

describe("the condition picker (A5)", () => {
	test("Story's derived properties, each with a stored path and a type", async () => {
		const { conditionPropsFor } = await import("./presetEditor")
		const props = await conditionPropsFor(STORY)
		expect(props.length).toBeGreaterThan(0)
		expect(props.every((p) => typeof p.path === "string" && p.path.length > 0)).toBe(true)
		expect(props.some((p) => p.name.startsWith("world."))).toBe(true)
		expect(await conditionPropsFor("acme:genre/nothing@1")).toEqual([])
	})
})

describe("a preset's settings", () => {
	test("checked against the genre's fields", async () => {
		const { normalizePresetSettings } = await import("./presetEditor")
		const ok = await normalizePresetSettings(testDb as any, STORY, {
			tone: { value: "grim", lock: true },
			autoAdvance: "off"
		})
		expect(ok).toEqual({ ok: true, settings: { tone: { value: "grim", lock: true }, autoAdvance: "off" } })
		const refused = await normalizePresetSettings(testDb as any, STORY, { nonsense: 1 })
		expect(refused.ok).toBe(false)
		expect(await normalizePresetSettings(testDb as any, STORY, null)).toEqual({ ok: true, settings: null })
	})
})

describe("routine purposes for the settings form", () => {
	test("Chat's Remember things declares what it does", async () => {
		const { routinePurposes } = await import("./settingsForm")
		const purposes = await routinePurposes(testDb as any, ["core:spec/assistant-memory"])
		expect(purposes.get("core:spec/assistant-memory")).toMatch(/remembers/)
	})
})

describe("where a pipeline runs (R2, R38)", () => {
	test("the sweep: Story's defaults register it, Minimal drops it", async () => {
		const { registeredInOf } = await import("./presetEditor")
		const places = await registeredInOf(testDb as any, "core:spec/story-sweep")
		expect(places.some((p) => p.scope === "genre" && p.genreId === STORY && p.key === SWEEP)).toBe(true)
		const minimal = places.find((p) => p.scope === "preset" && p.presetId != null && p.dropped)
		expect(minimal?.key).toBe(SWEEP)
		expect(places.every((p) => !p.key.startsWith("admin:"))).toBe(true)
	})
})
