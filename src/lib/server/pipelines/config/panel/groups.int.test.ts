/**
 * Settings grouped by model call (owner rulings 2026-09-30, Q5).
 *
 * The owner's complaint: a pipeline with four model calls showed four
 * "Prompts", four "Connection" and four "Sampling" with nothing to tell them
 * apart, and the step headings that should have were numbered ("Generate
 * reply 2"). The payload now carries `groups`: one per model call, holding
 * that call's own prompt, connection and sampling, headed by the step's label,
 * else its step status, else its definition's name — derived from the graph,
 * never declared, never numbered.
 */

import { describe, it, expect, beforeAll, onTestFinished } from "vitest"
import { and, eq, isNotNull } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	namespaceView,
	optionId,
	type NamespaceView,
	type SettingsGroup
} from "$lib/server/pipelines/config/panel"
import { STORY_RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { groupSteps } from "$lib/server/pipelines/config/panel/groups"

const SECRET = "test-instance-secret"
/** Story's reply: the reply, then the reckoning and the sweep (2026-10-19; Adventure retired). */
const STORY = "core:spec/story-respond"
const LAIR = "core:spec/lair-respond"

let db: TestDb
let userId: number
let adminId: number
let sessionId: number

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const [user] = await db
		.insert(schema.users)
		.values({ username: "groups-user", isAdmin: false })
		.returning()
	userId = user.id
	const [admin] = await db
		.insert(schema.users)
		.values({ username: "groups-admin", isAdmin: true })
		.returning()
	adminId = admin.id
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: adminId, isGroup: false })
		.returning()
	sessionId = session.id
}, 60_000)

const asAdmin = (slug: string, over: object = {}) =>
	namespaceView(db, SECRET, slug, {
		userId: adminId,
		isAdmin: true,
		...over
	}) as Promise<NamespaceView>
const asUser = (slug: string) =>
	namespaceView(db, SECRET, slug, { userId, isAdmin: false }) as Promise<NamespaceView>

const id = (nodeKey: string, slot: string, path = "") =>
	optionId(SECRET, nodeKey, slot, path)
const ofControl = (g: SettingsGroup, control: string) =>
	g.front.filter((o) => o.control === control)
const calls = (v: NamespaceView) => v.groups.filter((g) => g.kind === "model-call")

/** Every heading and label a person reads, anywhere in the view. */
function headings(v: NamespaceView): string[] {
	const out: string[] = []
	for (const g of v.groups) {
		if (g.heading) out.push(g.heading)
		for (const o of [...g.front, ...(g.enabled ? [g.enabled] : [])]) out.push(o.label)
		for (const s of g.advanced) {
			out.push(s.heading)
			for (const o of s.options) out.push(o.label)
		}
	}
	return out
}

describe("Story's turn: one group per model call", () => {
	/** The three calls, by the node keys the payload never names (ruled 2026-10-19). */
	const AGENTS = [
		{ call: "generate", heading: "Reply" },
		{ call: "reckon.on.reckonWrite", heading: "What the reply changed" },
		{ call: "sweep.due.sweepWrite", heading: "Look back over the story" }
	]

	it("draws three groups — the reply, the reckoning, the sweep — then the whole pipeline", async () => {
		const v = await asAdmin(STORY)
		expect(calls(v).map((g) => g.heading)).toEqual(AGENTS.map((a) => a.heading))
		expect(v.groups.at(-1)).toMatchObject({ kind: "pipeline", heading: "Whole pipeline" })
		expect(v.groups.map((g) => g.key)).toEqual(v.groups.map((_, i) => `g${i}`))
		for (const g of calls(v)) expect(g.purpose).toBeTruthy()
	})

	it("gives each group exactly its own prompt, connection and sampling", async () => {
		const v = await asAdmin(STORY)
		const prompts: string[] = []
		calls(v).forEach((g, i) => {
			const a = AGENTS[i]!
			const p = ofControl(g, "prompts-ref").map((o) => o.id)
			expect(p).toHaveLength(1)
			prompts.push(p[0]!)
			expect(ofControl(g, "connection-ref").map((o) => o.id)).toEqual([id(a.call, "connection")])
			expect(ofControl(g, "sampling-ref").map((o) => o.id)).toEqual([id(a.call, "sampling")])
			// …and in that order: Loadout (I12), Prompt, Model, Sampling.
			expect(g.front.slice(0, 4).map((o) => o.control)).toEqual([
				"loadout-ref",
				"prompts-ref",
				"connection-ref",
				"sampling-ref"
			])
		})
		expect(new Set(prompts).size).toBe(prompts.length)
		// No group carries another's: nothing model-shaped is left over.
		const pipeline = v.groups.at(-1)!
		expect(pipeline.front.filter((o) => /-ref$/.test(o.control) && o.control !== "scripts-chain")).toEqual([])
	})

	it("files the budget, which serves every call, under the whole pipeline", async () => {
		const v = await asAdmin(STORY)
		const [reply] = calls(v)
		const pipeline = v.groups.at(-1)!
		const has = (g: SettingsGroup, nodeKey: string, slot: string, path = "") =>
			g.advanced.some((s) => s.options.some((o) => o.id === id(nodeKey, slot, path)))
		expect(has(pipeline, "contextBudget", "params", "safetyMargin")).toBe(true)
		expect(has(reply!, "contextBudget", "params", "safetyMargin")).toBe(false)
	})

	it("shows a non-admin the same three headings, each with its own prompt and nothing to tune", async () => {
		const v = await asUser(STORY)
		expect(v.groups.map((g) => g.heading)).toEqual(AGENTS.map((a) => a.heading))
		v.groups.forEach((g, i) => {
			const a = AGENTS[i]!
			expect(ofControl(g, "prompts-ref")).toHaveLength(1)
			for (const o of g.front.filter((f) => f.control !== "prompts-ref")) {
				expect(o.id).toBe(id(a.call, "connection"))
				expect(o.writable).toBe(false)
			}
			expect(g.advanced).toEqual([])
		})
	})

	it("never numbers a heading", async () => {
		const numbered = (hs: string[]) => hs.filter((h) => /\s\d+$/.test(h))
		for (const v of [await asAdmin(STORY), await asAdmin(LAIR), await asAdmin("core:spec/assistant-respond")]) {
			expect(numbered(groupSteps(v.groups).map((s) => s.heading))).toEqual([])
			expect(numbered(headings(v))).toEqual([])
		}
	})
})

describe("a heading never names a node", () => {
	it("is prose — no group or step heading equals a node key", async () => {
		for (const slug of [STORY, LAIR]) {
			const keys = new Set(
				(
					await db
						.select({ nodeKey: schema.pipelineNodes.nodeKey })
						.from(schema.pipelineNodes)
						.innerJoin(
							schema.pipelineSpecs,
							eq(schema.pipelineSpecs.activeVersionId, schema.pipelineNodes.specVersionId)
						)
						.where(eq(schema.pipelineSpecs.slug, slug))
				).map((k) => k.nodeKey.toLowerCase())
			)
			const v = await asAdmin(slug)
			for (const g of v.groups) {
				expect(keys.has((g.heading ?? "").toLowerCase())).toBe(false)
				for (const s of g.advanced) expect(keys.has(s.heading.toLowerCase())).toBe(false)
			}
		}
	})
})

describe("Story's reply group", () => {
	it("is the first group, headed Reply, with the reply's own prompt, connection and sampling", async () => {
		const v = await asAdmin(STORY_RESPOND_SPEC_ID)
		const g = v.groups[0]!
		expect(g.heading).toBe("Reply")
		expect(g.kind).toBe("model-call")
		expect(ofControl(g, "prompts-ref").map((o) => o.id)).toEqual([id("context", "prompts")])
		expect(ofControl(g, "connection-ref").map((o) => o.id)).toEqual([id("generate", "connection")])
		expect(ofControl(g, "sampling-ref").map((o) => o.id)).toEqual([id("generate", "sampling")])
	})

	it("fronts Loadout, Prompt, Model and Sampling; the lore sources' switches, labelled by their step, serve the whole pipeline", async () => {
		const v = await asAdmin(STORY_RESPOND_SPEC_ID)
		expect(v.groups[0]!.front.slice(0, 4).map((o) => o.control)).toEqual([
			"loadout-ref",
			"prompts-ref",
			"connection-ref",
			"sampling-ref"
		])
		const switches = v.groups.at(-1)!.front.filter((o) => o.control === "boolean")
		expect(switches.map((o) => o.label)).toContain("World lore")
		expect(switches.map((o) => o.label)).not.toContain("Use this source")
		expect(new Set(switches.map((o) => o.label)).size).toBe(switches.length)
	})
})

describe("the Lair's turn", () => {
	it("draws one group per model call, each with one connection, one sampling and its own prompt", async () => {
		const v = await asAdmin(LAIR)
		const oracles = await db
			.select({ nodeKey: schema.pipelineNodes.nodeKey })
			.from(schema.pipelineNodes)
			.innerJoin(
				schema.pipelineSpecs,
				eq(schema.pipelineSpecs.activeVersionId, schema.pipelineNodes.specVersionId)
			)
			.where(
				and(
					eq(schema.pipelineSpecs.slug, LAIR),
					eq(schema.pipelineNodes.kind, "oracle")
				)
			)
		// Every oracle with a model of its own (the embed steps have none a person sets).
		const withModel = oracles.filter((o) =>
			v.groups.some((g) => g.front.some((f) => f.id === id(o.nodeKey, "connection")))
		)
		expect(calls(v)).toHaveLength(withModel.length)
		expect(calls(v).length).toBeGreaterThan(3)
		for (const g of calls(v)) {
			expect(ofControl(g, "connection-ref")).toHaveLength(1)
			expect(ofControl(g, "sampling-ref")).toHaveLength(1)
			// A prompt: a prompts-ref, or the Castellan's own texts in the Sanctum.
			expect(g.front.filter((o) => o.control === "prompts-ref" || o.control === "text").length).toBeGreaterThan(0)
		}
		// The Castellan's instructions sit with the call that reads them — no detached envoy group.
		const holders = calls(v).filter((g) => g.front.some((o) => o.control === "text"))
		expect(holders).toHaveLength(1)
		expect(v.groups.filter((g) => g.kind === "pipeline").every((g) => !g.front.some((o) => o.control === "text"))).toBe(true)
	})

	/**
	 * The party speech (owner ruling 2026-09-30): "they are character turns,
	 * not first delver, later delver". Each delver speaking takes ONE
	 * character turn — a planned delver's and a picked one's alike, on one
	 * prompt, one model and one sampling — and the Castellan speaking for
	 * the party is its own call.
	 */
	it("shows one Character turn group, with one prompt, one model and one sampling, and the Castellan's party call beside it", async () => {
		const v = await asAdmin(LAIR)
		const headings = calls(v).map((g) => g.heading)
		expect(headings.filter((h) => h === "Character turn")).toHaveLength(1)
		expect(headings).toContain("Castellan speaks for the party")
		for (const gone of ["Voices", "First voice", "Further voices", "Picked voice"])
			expect(headings).not.toContain(gone)
		const turn = calls(v).find((g) => g.heading === "Character turn")!
		expect(turn.purpose).toMatch(/each delver speaks/i)
		expect(ofControl(turn, "prompts-ref")).toHaveLength(1)
		expect(ofControl(turn, "connection-ref")).toHaveLength(1)
		expect(ofControl(turn, "sampling-ref")).toHaveLength(1)
		// Nothing model-shaped of the character turn is left in the whole pipeline.
		const pipeline = v.groups.find((g) => g.kind === "pipeline")!
		expect(pipeline.front.filter((o) => o.control === "prompts-ref" || o.control === "connection-ref" || o.control === "sampling-ref")).toEqual([])
		const party = calls(v).find((g) => g.heading === "Castellan speaks for the party")!
		expect(party.purpose).toMatch(/one call/i)
		expect(ofControl(party, "prompts-ref")).toHaveLength(1)
	})
})

describe("how a Model or Sampling value reads", () => {
	it("names what an unset slot resolves to and where the value came from, never an id", async () => {
		const v = await asAdmin(STORY)
		for (const g of calls(v))
			for (const o of g.front.filter((f) => f.control === "connection-ref" || f.control === "sampling-ref")) {
				expect(o.inherits?.label).toMatch(/^(Pipeline default — |Pub default — |From the [A-Z][A-Za-z ]* loadout — |No model set|No sampling config set)/)
				expect(o.provenance?.label).toBeTruthy()
				if (o.valueLabel !== undefined) expect(o.valueLabel).not.toMatch(/^\d+$/)
			}
	})

	it("reads a configured value from inside a session as the configuration's, by name", async () => {
		const [cfg] = await db
			.insert(schema.samplingConfigs)
			.values({ name: "Steady narration", values: {} } as any)
			.returning({ id: schema.samplingConfigs.id, name: schema.samplingConfigs.name })
		const v0 = await asAdmin(STORY)
		const selected = v0.selectedConfig!
		// Written straight to the selected configuration's rows, as a config edit would.
		await db
			.delete(schema.pipelineConfigValues)
			.where(
				and(
					eq(schema.pipelineConfigValues.configId, selected.id),
					eq(schema.pipelineConfigValues.nodeKey, "generate"),
					eq(schema.pipelineConfigValues.slot, "sampling")
				)
			)
		await db.insert(schema.pipelineConfigValues).values({
			configId: selected.id,
			nodeKey: "generate",
			slot: "sampling",
			path: "",
			value: cfg!.id
		} as any)
		const v = await asAdmin(STORY, { sessionId })
		const sampling = calls(v)[0]!.front.find((o) => o.control === "sampling-ref")!
		expect(sampling.inherits).toEqual({ from: "config", label: `As configured — ${cfg!.name}` })
		expect(sampling.provenance?.source).toBe("config")
		expect(sampling.provenance?.label).toBe(`From the “${v.selectedConfig!.name}” configuration`)
		expect(sampling.valueLabel).toBe(cfg!.name)
	})
})

describe("a step label and a step purpose on the spec", () => {
	it("head the group and sit under it, and a label names a step in Advanced", async () => {
		const [spec] = await db
			.select({ versionId: schema.pipelineSpecs.activeVersionId })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, STORY))
		const nodeRow = async (nodeKey: string) =>
			(
				await db
					.select()
					.from(schema.pipelineNodes)
					.where(
						and(
							eq(schema.pipelineNodes.specVersionId, spec!.versionId!),
							eq(schema.pipelineNodes.nodeKey, nodeKey)
						)
					)
			)[0]!
		const relabel = async (nodeKey: string, extra: Record<string, unknown>) => {
			const row = await nodeRow(nodeKey)
			await db
				.update(schema.pipelineNodes)
				.set({ expose: { ...((row.expose as object) ?? {}), ...extra } as any })
				.where(eq(schema.pipelineNodes.id, row.id))
		}
		// Put back what the catalog ships once this test is done, so the
		// shipped-spec sweeps below read the documents as they boot.
		const shipped = await Promise.all(["generate", "prompt", "reckon.on.reckonWrite"].map(nodeRow))
		onTestFinished(async () => {
			for (const row of shipped)
				await db
					.update(schema.pipelineNodes)
					.set({ expose: row.expose as any })
					.where(eq(schema.pipelineNodes.id, row.id))
		})
		await relabel("generate", {
			label: "Turn writer",
			purpose: "Writes what happens next."
		})
		await relabel("prompt", { label: "Writer's prompt layout" })
		// The reckoning without its label or purpose, as a spec that sets neither.
		const scene = await nodeRow("reckon.on.reckonWrite")
		const { label: _label, purpose: _purpose, ...unlabelled } = (scene.expose ?? {}) as Record<string, unknown>
		await db
			.update(schema.pipelineNodes)
			.set({ expose: unlabelled as any })
			.where(eq(schema.pipelineNodes.id, scene.id))

		const v = await asAdmin(STORY)
		const planner = calls(v)[0]!
		expect(planner.heading).toBe("Turn writer")
		expect(planner.purpose).toBe("Writes what happens next.")
		// The status heads a call that carries no label, with no purpose under it.
		expect(calls(v)[1]!.heading).toBe("Noting what changed")
		expect(calls(v)[1]!.purpose).toBeUndefined()
		expect(planner.advanced.map((s) => s.heading)).toContain("Writer's prompt layout")
		// Every option of that step carries the same heading.
		expect(groupSteps(v.groups).map((s) => s.heading)).toContain("Writer's prompt layout")
	})
})

describe("every shipped spec reads without two headings alike", () => {
	/** Every spec the boot published, by slug. */
	const shipped = async () =>
		(
			await db
				.select({ slug: schema.pipelineSpecs.slug })
				.from(schema.pipelineSpecs)
				.where(isNotNull(schema.pipelineSpecs.activeVersionId))
		)
			.map((r) => r.slug)
			.sort()

	it("gives no two groups of one spec the same heading, and no two steps of one group the same heading", async () => {
		const slugs = await shipped()
		expect(slugs.length).toBeGreaterThan(10)
		const clashes: string[] = []
		const repeated = (list: string[]) => [...new Set(list.filter((h, i) => list.indexOf(h) !== i))]
		for (const slug of slugs) {
			const v = await asAdmin(slug)
			for (const h of repeated(v.groups.flatMap((g) => (g.heading ? [g.heading] : []))))
				clashes.push(`${slug}: two groups headed "${h}"`)
			for (const g of v.groups)
				for (const h of repeated(g.advanced.map((s) => s.heading)))
					clashes.push(`${slug} › ${g.heading ?? "(one group)"}: two steps headed "${h}"`)
		}
		expect(clashes).toEqual([])
	}, 120_000)

	it("heads every model call of a multi-call spec by its step label, with its purpose beneath", async () => {
		const missing: string[] = []
		for (const slug of await shipped()) {
			const groups = calls(await asAdmin(slug))
			if (groups.length < 2) continue
			for (const g of groups)
				if (!g.purpose) missing.push(`${slug} › ${g.heading}: no purpose`)
		}
		expect(missing).toEqual([])
	}, 120_000)
})

describe("what a step and an agent receive and carry out (ruling 2026-10-12)", () => {
	const labels = (ls: { label: string }[] | undefined) => (ls ?? []).map((l) => l.label)
	const stepNamed = (v: NamespaceView, heading: string) =>
		v.groups.flatMap((g) => g.advanced).find((s) => s.heading === heading)

	it("Story's reply: the model step takes the assembled prompt and hands on its text; the save writes the reply", async () => {
		const v = await asAdmin(STORY_RESPOND_SPEC_ID)
		const reply = stepNamed(v, "Reply")!
		expect(reply.effect).toBe("external")
		expect(reply.receives).toContainEqual(
			expect.objectContaining({ port: "context", label: "the assembled prompt", from: "Assemble" })
		)
		expect(labels(reply.carriesOut).join(" ")).toMatch(/text/)

		const save = stepNamed(v, "Update message")!
		expect(save.effect).toBe("write")
		expect(save.carriesOut).toContainEqual({
			port: "session",
			shape: "core:outlet/update-message",
			label: "saves the finished reply"
		})
		// The lore source reads as its band — a share, never a number.
		const lore = stepNamed(v, "World lore")!
		expect(labels(lore.carriesOut)).toContain("world lore, a share of the context")
		expect(labels(lore.carriesOut).join(" ")).not.toMatch(/\d/)

		// Across the groups: what the run takes from the session, and its writes.
		const received = v.groups.flatMap((g) => labels(g.receives))
		const carried = v.groups.flatMap((g) => labels(g.carriesOut))
		expect(received).toContain("the session")
		expect(carried).toEqual(expect.arrayContaining(["saves the finished reply"]))
	}, 60_000)

	it("is the admin's view only: a member's payload carries no wiring", async () => {
		const v = await asUser(STORY_RESPOND_SPEC_ID)
		for (const g of v.groups) {
			expect(g.receives).toBeUndefined()
			expect(g.carriesOut).toBeUndefined()
			for (const s of g.advanced) {
				expect(s.receives).toBeUndefined()
				expect(s.carriesOut).toBeUndefined()
				expect(s.effect).toBeUndefined()
			}
		}
	}, 60_000)
})

