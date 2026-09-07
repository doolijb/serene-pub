/**
 * The A/B prompt-diff tool, held to its own standard.
 *
 * The rule the whole measurement lane is built on — *a green suite is evidence
 * only if the thing under test can move it* — applies to the instrument as much
 * as to the corpus, and rather more sharply: a comparison tool that reports
 * "identical" whatever it is handed would be indistinguishable from a working
 * one on nine sessions out of ten, because most controls change most prompts
 * not at all. So this asserts both directions, in this order:
 *
 *   1. **it does not manufacture a difference** — the same configuration on
 *      both sides is byte-identical, no entry entered or left, empty patch;
 *   2. **it sees a real one** — the admission gate on one side puts a keyless
 *      entry in the prompt, and the report names it with the reason *each side*
 *      gave;
 *   3. **it changed nothing** — no run recorded, no message written, no config
 *      value touched.
 *
 * (1) is the load-bearing one. Without it (2) would pass on a tool that
 * reported every session as different, which is the failure mode a diff tool
 * actually has.
 *
 * ⚠ This runs the **shipped** reply spec through `runTurn`, on a database with
 * boot's own defaults and pipeline rows in it, so what is being tested is the
 * tool over the real path rather than over a hand-built world. That is the
 * point: the tool exists to be trusted about real installs.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import {
	PRESETS,
	SHIPPED,
	comparePrompts,
	presetVariant,
	renderComparison,
	sessionsWithMessages
} from "$lib/server/pipelines/measure/promptDiff"

let db: TestDb
let dataDir: string
let userId: number
let sessionId: number
let characterId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "prompt-diff-secret" }
})

// No embedding model: every mechanism this file measures is in the lexical
// half, which is the half that must work with nothing installed (design §11).
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-prompt-ab-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir

	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "prompt-ab", isAdmin: true })
		.returning()
	userId = user.id

	const [character] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Ash",
			description: "A rider who patrols the ash wastes.",
			personality: "Terse, loyal, slow to trust."
		})
		.returning()
	characterId = character.id

	const [persona] = await db
		.insert(schema.personas)
		.values({
			userId,
			isDefault: false,
			name: "Rell",
			description: "A cartographer looking for a way north."
		})
		.returning()

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Prompt AB", userId })
		.returning()

	/**
	 * Three keyed entries and one keyless one.
	 *
	 * The three keyed ones are what the session as configured retrieves, and
	 * there are three of them so the report's *reordering* half has something
	 * to be about — with one entry in the prompt, `moved` is unreachable and
	 * `promptOrder` could be wrong in either direction without anything saying
	 * so. `The Ashguard` has **no keys at all** and is what only the admission
	 * gate can bring in, which is what makes the difference the tool has to
	 * notice a difference somebody would actually care about rather than a
	 * whitespace change.
	 */
	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				lorebookId: lorebook.id,
				name: "The Ford",
				keys: "ford",
				content: "A shallow crossing, passable except after rain."
			},
			{
				lorebookId: lorebook.id,
				name: "The Wastes",
				keys: "wastes",
				content: "Ash flats that run from the ridge to the far coast."
			},
			{
				lorebookId: lorebook.id,
				name: "The City",
				keys: "city",
				content: "Walls, foundries, and a council that answers to nobody."
			},
			{
				lorebookId: lorebook.id,
				name: "The Ashguard",
				keys: "",
				content:
					"An order of oathbound riders who patrol the wastes and answer to nobody in the city."
			}
		])
	)

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId,
		isActive: true,
		visibility: "visible"
	})
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId, personaId: persona.id })

	for (const content of [
		"the riders came down from the wastes before dark",
		"they asked after the ford and we told them where it was",
		"the wastes are no place to winter, whatever they say",
		"they answer to nobody in the city, they say"
	])
		await db.insert(schema.sessionMessages).values({
			sessionId,
			role: "user",
			content,
			personaId: persona.id
		} as any)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const compare = (variantName: string | null) =>
	comparePrompts({
		db: db as any,
		sessionId,
		userId,
		currentCharacterId: characterId,
		baseline: SHIPPED,
		variant: variantName ? presetVariant(variantName)! : SHIPPED
	})

describe("the tool does not manufacture a difference", () => {
	it("reports the same configuration as identical, twice over", async () => {
		const same = await compare(null)

		expect(
			same.baseline.stopped,
			`the baseline never reached the provider: ${same.baseline.stopped}`
		).toBeUndefined()
		expect(same.variant.stopped).toBeUndefined()
		// A real prompt, not an empty string agreeing with another empty one —
		// the way this assertion could pass while proving nothing.
		expect(same.baseline.prompt.length).toBeGreaterThan(0)
		expect(same.baseline.prompt).toContain("World lore")

		expect(same.identical).toBe(true)
		expect(same.patch).toBe("")
		expect(same.entered).toEqual([])
		expect(same.left).toEqual([])
		expect(same.moved).toEqual([])
	}, 120_000)

	it("says so in the report rather than printing an empty diff", async () => {
		const report = renderComparison(await compare(null))
		expect(report).toContain("IDENTICAL")
		expect(report).not.toContain("PROMPT DIFF")
	}, 120_000)
})

describe("the tool sees a real difference", () => {
	it("puts the keyless entry in the prompt when the gate is on", async () => {
		const diff = await compare("admission")

		expect(diff.identical).toBe(false)
		expect(diff.variant.prompt).toContain("The Ashguard")
		expect(diff.baseline.prompt).not.toContain("The Ashguard")

		const entered = diff.entered.map((e) => e.on.title)
		expect(entered).toContain("The Ashguard")
		expect(diff.left).toEqual([])
	}, 120_000)

	it("carries the reason each side gave, not just the fact", async () => {
		const diff = await compare("admission")
		const row = diff.entered.find((e) => e.on.title === "The Ashguard")
		expect(row, "the entry that entered is not in `entered`").toBeTruthy()

		// The variant's side: it competed and won.
		expect(row!.on.state).toBe("included")
		expect(row!.on.score).not.toBeNull()

		// The baseline's side: the mechanism never made it a candidate, and the
		// sentence says why — which is the half a bare set difference loses,
		// and the half somebody deciding whether to turn this on needs.
		expect(row!.off.state).toBe("skipped")
		expect(row!.off.why).toMatch(/no key matched/i)
	}, 120_000)

	it("reports the gather branch numbers that moved", async () => {
		const diff = await compare("admission")
		const worldLore = diff.variant.branches.find(
			(l) => l.nodeKey === "gather.worldLore.read"
		)
		expect(worldLore?.admitThreshold).toBeGreaterThan(0)
		expect(worldLore?.admittedByEvidence).toBeGreaterThan(0)

		const report = renderComparison(diff)
		expect(report).toContain("+ entered")
		expect(report).toContain("The Ashguard")
		expect(report).toContain("PROMPT DIFF")
		// The reason vocabulary reaches the page, not only the object.
		expect(report).toMatch(/A: not retrieved/)
	}, 120_000)

	/**
	 * The third kind of change, and the one with no preset behind it: same
	 * entries, different order.
	 *
	 * The order lore reaches the model in is user-visible — the `World lore`
	 * block is a JSON object and `JSON.stringify` keeps insertion order — so a
	 * reorder is a real change to what the model reads even when the set is
	 * identical. This drives it through a bare override rather than a preset,
	 * which is also the `--set` path the runner script exposes.
	 */
	it("reports a reordering as a reordering", async () => {
		const reordered = await comparePrompts({
			db: db as any,
			sessionId,
			userId,
			currentCharacterId: characterId,
			baseline: SHIPPED,
			variant: {
				name: "recency over everything",
				overrides: [
					{
						nodeKey: "rank",
						path: "signalLastRefRecency",
						value: {
							messages: 0,
							worldLore: 4,
							characterLore: 0,
							history: 0,
							relationships: 0
						}
					}
				]
			}
		})

		expect(reordered.entered).toEqual([])
		expect(reordered.left).toEqual([])
		expect(reordered.moved.length).toBeGreaterThan(0)
		expect(reordered.identical).toBe(false)
		expect(reordered.baseline.order).not.toEqual(reordered.variant.order)
		// Same entries, so this really is only an ordering change.
		expect([...reordered.variant.order].sort()).toEqual(
			[...reordered.baseline.order].sort()
		)

		const report = renderComparison(reordered, { summaryOnly: true })
		expect(report).toContain("~ reordered")
	}, 120_000)

	it("prints both prompts whole when asked to", async () => {
		const diff = await compare("admission")
		const report = renderComparison(diff, { full: true })
		expect(report).toContain(diff.baseline.prompt)
		expect(report).toContain(diff.variant.prompt)
	}, 120_000)
})

describe("the tool changes nothing", () => {
	/**
	 * The requirement stated as an assertion rather than as an intention.
	 *
	 * `preview: true` stops before the provider and `skipReceipt: true` records
	 * no run, but both of those are properties of a call site that could be
	 * edited — and the overrides ride on the world in memory, which is the part
	 * a reader would most reasonably suspect of writing a config row.
	 */
	it("writes no run, no message and no configuration value", async () => {
		const runsBefore = await db.select().from(schema.pipelineRuns)
		const messagesBefore = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
		const valuesBefore = await db.select().from(schema.pipelineConfigValues)

		await compare("admission")
		await compare("trigrams")

		expect(await db.select().from(schema.pipelineRuns)).toHaveLength(
			runsBefore.length
		)
		expect(
			await db
				.select()
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.sessionId, sessionId))
		).toHaveLength(messagesBefore.length)
		expect(
			await db.select().from(schema.pipelineConfigValues)
		).toHaveLength(valuesBefore.length)
	}, 180_000)

	it("leaves the next comparison reading the same configuration", async () => {
		// The override is forced at the top of the scope chain *for one run*.
		// If it leaked into the world the next run builds, this baseline would
		// come back with the gate still on.
		await compare("admission")
		const after = await compare(null)
		expect(after.identical).toBe(true)
		expect(after.baseline.prompt).not.toContain("The Ashguard")
	}, 180_000)
})

describe("the surface the runner script drives", () => {
	it("finds every session with messages", async () => {
		expect(await sessionsWithMessages(db as any)).toContain(sessionId)
	})

	it("names a preset for every mechanism that ships off", () => {
		// Not an exhaustive list — a control with no preset is still reachable
		// through `--set` — but the ones design §10 asks about by name should
		// not need somebody to look up a node key first.
		for (const name of [
			"admission",
			"trigrams",
			"balanced",
			"title",
			"proximity",
			"semantic",
			"entities",
			"descriptions",
			"score-led"
		])
			expect(PRESETS[name], `no preset called '${name}'`).toBeTruthy()
		for (const preset of Object.values(PRESETS)) {
			expect(preset.about.length).toBeGreaterThan(0)
			expect(preset.overrides.length).toBeGreaterThan(0)
		}
	})
})
