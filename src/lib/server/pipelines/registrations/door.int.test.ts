/**
 * 🚧 The registration door (§11-2) and its re-check (A11), and a preset's
 * requirements (A16) — lane 5b, against the published catalogue:
 *
 *  · core's every registration passes the boot's re-check;
 *  · a registration whose pipeline no longer fits its trigger is left out
 *    as stale, said with the door's sentence, and its preset gets a notice;
 *    it comes back when it fits again;
 *  · the preset editor's save is refused in a sentence;
 *  · a preset whose required package is missing, switched off or out of
 *    range is withdrawn at the sync, never deleted;
 *  · a pipeline's envoys are checked against the registering genre.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { register, systemCron, type RegistrationDecl, type SpecDocument } from "@serene-pub/sdk"
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
let boot: any

const STORY = "core:genre/story"
const REPLY = "core:spec/story-respond"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-registration-door-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	boot = await bootstrapPipelines(testDb as any)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** The reply, mounted on a five-minute system cron — a routine whose moment carries no message. */
const misfit = (): RegistrationDecl => register(systemCron({ every: 5, unit: "minutes" }), REPLY) as RegistrationDecl

let seq = 0
async function adminPreset(changes: Parameters<typeof import("./presetRows").writePresetChanges>[2]) {
	const [p] = await testDb
		.insert(schema.sessionPresets)
		.values({ name: `Door preset ${++seq}`, genreId: STORY, bindings: {}, enabled: true, isDefault: false, isImmutable: false } as any)
		.returning()
	const { writePresetChanges } = await import("./presetRows")
	await writePresetChanges(testDb as any, p!.id, changes)
	return p!
}

describe("the boot's re-check (A11)", () => {
	test("every registration core ships fits", () => {
		expect(boot.registrationFit.checked).toBeGreaterThan(50)
		expect(boot.registrationFit.broken).toEqual([])
	})
})

describe("the door", () => {
	test("a registration that does not fit its trigger is refused in a sentence (the preset editor's save)", async () => {
		const { presetChangesRefusal } = await import("./presetRows")
		const refused = await presetChangesRefusal(testDb as any, { genreId: STORY, name: "Night shift" }, { register: [misfit()] })
		expect(refused).toMatch(/preset 'Night shift'/)
		expect(refused).toMatch(/message|speaker|actor/)
		// What fits passes.
		expect(await presetChangesRefusal(testDb as any, { genreId: STORY, name: "Fine" }, { change: [{ key: "message-respond→story-respond", order: 5 }] })).toBeNull()
	})

	test("a broken registration is left out as stale, with the door's sentence and a notice on its preset — until it fits again", async () => {
		const p = await adminPreset({ register: [misfit()] })
		const { refitAfterChange, brokenReason } = await import("./fit")
		const report = await refitAfterChange(testDb as any, [REPLY])
		const key = misfit().key
		expect(report.broken.map((b) => b.key)).toContain(key)
		expect(brokenReason("preset", String(p.id), key)).toMatch(/no longer fits here/)
		const { presetRegistrations } = await import("./resolve")
		const resolved = (await presetRegistrations(testDb as any, p.id))!
		expect(resolved.offered.some((r) => r.key === key)).toBe(false)
		expect(resolved.stale.find((s) => s.registration.key === key)?.reason).toMatch(/no longer fits here/)
		const notices = await testDb.select().from(schema.sessionPresetNotices).where(eq(schema.sessionPresetNotices.presetId, p.id))
		expect(notices.map((n) => n.event)).toContain(key)

		// The registration goes; the re-check mends the verdict and clears the notice.
		const { writePresetChanges } = await import("./presetRows")
		await writePresetChanges(testDb as any, p.id, {})
		await refitAfterChange(testDb as any, [REPLY])
		expect(brokenReason("preset", String(p.id), key)).toBeNull()
		const after = await testDb.select().from(schema.sessionPresetNotices).where(eq(schema.sessionPresetNotices.presetId, p.id))
		expect(after.map((n) => n.event)).not.toContain(key)
	})

	test("a session's own action switched on goes through the door", async () => {
		const { registrationDoor } = await import("./door")
		const verdict = await registrationDoor(testDb as any, [misfit()], { layer: "this session", genreId: STORY })
		expect(verdict.errors.some((f) => f.law === "registration fit")).toBe(true)
		expect(verdict.perDecl[0]!.length).toBeGreaterThan(0)
	})

	test("an envoy a pipeline references is the registering genre's to declare", async () => {
		const { envoyFindingsOf } = await import("./door")
		const doc = {
			id: "acme:spec/keeper-says",
			nodes: [
				{ key: "say", kind: "oracle", definitionId: "core:oracle/generate-text", definitionVersion: 1, config: {}, resolvedRefs: { prompts: "envoy:keeper" } },
				{ key: "write", kind: "outlet", definitionId: "core:outlet/create-message", definitionVersion: 1, config: { speaker: "envoy:herald" } }
			],
			suits: []
		} as unknown as SpecDocument
		const decl = { key: "message-respond→keeper-says", trigger: { family: "event", event: "core:event/message-respond@1" }, pipeline: doc.id } as RegistrationDecl
		const findings = envoyFindingsOf(decl, doc, STORY, new Set(["narrator"]), "preset 'Keep'")
		expect(findings.map((f) => f.message)).toEqual([
			expect.stringMatching(/reads the prompts of envoy 'keeper', which 'core:genre\/story' does not declare/),
			expect.stringMatching(/speaks \(step 'write'\) as envoy 'herald'/)
		])
		expect(envoyFindingsOf(decl, doc, STORY, new Set(["keeper", "herald"]), "")).toEqual([])
		// A locked document was judged against its own genre when it compiled.
		expect(envoyFindingsOf(decl, { ...doc, input: { genre: STORY } } as never, STORY, new Set(), "")).toEqual([])
	})
})

describe("a preset's requirements (A16)", () => {
	async function plugin(pluginId: string, version: string, enabled: boolean, manifest: Record<string, unknown> = {}) {
		const [row] = await testDb
			.insert(schema.plugins)
			.values({ pluginId, name: pluginId, version, bundleSource: "// none", bundleHash: `door-${pluginId}-${++seq}`, enabled, manifest })
			.returning()
		return row!
	}

	test("missing, switched off, out of range — each said; in range, nothing", async () => {
		await plugin("acme.dice", "1.1.0", true)
		await plugin("acme.sleepy", "2.0.0", false)
		const { presetRequirementFindings } = await import("./door")
		expect(await presetRequirementFindings(testDb as any, ["acme.dice@^1.0", "core:event/message-respond@1"])).toEqual([])
		expect(await presetRequirementFindings(testDb as any, ["acme.dice@^1.2"])).toEqual([
			"'acme.dice' is version 1.1.0, and 'acme.dice@^1.2' asks for ^1.2"
		])
		expect(await presetRequirementFindings(testDb as any, ["acme.gone:spec/roll@^1"])).toEqual([
			"'acme.gone' is not installed (required as 'acme.gone:spec/roll@^1')"
		])
		expect(await presetRequirementFindings(testDb as any, ["acme.sleepy"])).toEqual([
			"'acme.sleepy' is switched off (required as 'acme.sleepy')"
		])
		// The install door reads the same: a ranged entry is a requirement, not a missing id.
		const { missingRequirements } = await import("$lib/server/plugins/requirements")
		expect(await missingRequirements(testDb as any, ["acme.dice@^1.0"])).toEqual([])
		expect(await missingRequirements(testDb as any, ["acme.dice@^2"])).toEqual(["acme.dice@^2"])
	})

	test("the preset sync withdraws a preset whose requirement is not met — never deletes it — and restores it once met", async () => {
		const host = await plugin("acme.host", "1.0.0", true, {
			presets: [{ slug: "night", genre: STORY, label: "Night", requires: ["acme.lamp@^1"] }]
		})
		const { syncPluginPresets, presetSeedKey } = await import("$lib/server/pipelines/boot/registrySync")
		const report = await syncPluginPresets(testDb as any)
		const seedKey = presetSeedKey("acme.host", "night")
		expect(report.unmet?.some((u) => u.startsWith(seedKey))).toBe(true)
		let [row] = await testDb.select().from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, seedKey))
		expect(row!.withdrawnAt).not.toBeNull()
		await plugin("acme.lamp", "1.3.0", true)
		await syncPluginPresets(testDb as any)
		;[row] = await testDb.select().from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, seedKey))
		expect(row!.withdrawnAt).toBeNull()
		void host
	})
})

describe("⏳ a package genre's defaults from what its specs suit (D7)", () => {
	test("an unlocked spec in the genre's namespace answers the events it suits; its actions are offered", async () => {
		const { legacyGenreDefaults } = await import("./genreDefaults")
		const regs = legacyGenreDefaults("acme:genre/heist", [
			{ slug: "acme:spec/heist-reply", inputGenre: null, inputEvent: null, inputEvents: null, contributes: null, suits: ["core:event/message-respond@1"] },
			{ slug: "other:spec/reply", inputGenre: null, inputEvent: null, inputEvents: null, contributes: null, suits: ["core:event/message-respond@1"] }
		])
		expect(
			regs.filter((r) => r.trigger.family === "event").map((r) => [(r.trigger as { event: string }).event, r.pipeline])
		).toEqual(expect.arrayContaining([["core:event/message-respond@1", "acme:spec/heist-reply"]]))
		expect(regs.some((r) => r.pipeline === "other:spec/reply")).toBe(false)
	})
})
