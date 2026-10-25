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
/** Story's reply: one model call since the reckoning and the sweep became routines (lane 3, 2026-10-20); 🚧 two alternatives since *Replies carry changes* (D7; grouped by branch, lane T3). */
const STORY = "core:spec/story-respond"
const LAIR = "core:spec/lair-reply"

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

/**
 * ⏳ Rewritten (PLAN-layering lane 5a, 2026-10-20): the reckoning and the
 * sweep left the reply — they are **routines** now (`core:spec/story-reckoning`,
 * `core:spec/story-sweep`, lane 3), each its own pipeline with its own panel.
 *
 * 🚧 Rewritten again (lane T3, 2026-10-23): *Replies carry changes* (A2's D7
 * junction) made the reply two alternative model calls — `reply.prose.generate`
 * and `reply.changes.generate`, one per branch of the `reply` junction. Each is
 * its own group, headed by its branch where the two would read alike (*Reply ·
 * prose*, *Reply · changes*); each branch's own steps sit with its call.
 *
 * 🚧 RF fix 3 (2026-10-23): a branch holds only its call and what reads that
 * call's answer. The save, the commit and the line's face run once after the
 * junction, so each is ONE step, filed once in the whole pipeline — never a
 * copy under each call (two **Closest sprite** steps were two settings for one
 * thing; the owner ruled no two steps' settings are ever merged into one).
 */
describe("Story's reply: two alternative calls, a group each", () => {
	const PROSE = "reply.prose.generate"
	const CHANGES = "reply.changes.generate"
	const groupOf = (v: NamespaceView, call: string) =>
		calls(v).find((g) => g.front.some((o) => o.id === id(call, "connection")))!

	it("draws a group per branch, each headed by its branch, then the whole pipeline", async () => {
		const v = await asAdmin(STORY)
		expect(calls(v).map((g) => g.heading).sort()).toEqual(["Reply · changes", "Reply · prose"])
		expect(groupOf(v, PROSE).heading).toBe("Reply · prose")
		expect(groupOf(v, CHANGES).heading).toBe("Reply · changes")
		expect(v.groups.at(-1)).toMatchObject({ kind: "pipeline", heading: "Whole pipeline" })
	})

	it("gives the prose reply its own prompt, connection and sampling, Loadout first", async () => {
		const v = await asAdmin(STORY)
		const g = groupOf(v, PROSE)
		expect(ofControl(g, "prompts-ref")).toHaveLength(1)
		expect(ofControl(g, "connection-ref").map((o) => o.id)).toEqual([id(PROSE, "connection")])
		expect(ofControl(g, "sampling-ref").map((o) => o.id)).toEqual([id(PROSE, "sampling")])
		expect(g.front.slice(0, 4).map((o) => o.control)).toEqual(["loadout-ref", "prompts-ref", "connection-ref", "sampling-ref"])
	})

	/** The tail after the junction, by its steps' headings: the save, the commit, the line's face. */
	const TAIL = ["Update message", "Apply what the reply changed", "Closest sprite", "Show sprite"]

	it("keeps each branch's own steps with its call, and nothing of the tail", async () => {
		const v = await asAdmin(STORY)
		const changes = groupOf(v, CHANGES)
		expect(ofControl(changes, "connection-ref").map((o) => o.id)).toEqual([id(CHANGES, "connection")])
		expect(ofControl(changes, "sampling-ref").map((o) => o.id)).toEqual([id(CHANGES, "sampling")])
		const heads = changes.advanced.map((s) => s.heading)
		expect(heads).toContain("What a reply may change")
		for (const g of [changes, groupOf(v, PROSE)])
			for (const h of TAIL) expect(g.advanced.map((s) => s.heading)).not.toContain(h)
		// The Review arm that could never run is not drawn at all.
		expect(headings(v)).not.toContain("Propose what the reply changed")
	})

	it("files the tail once, in the whole pipeline: one save, one commit, one Closest sprite, one Show sprite", async () => {
		const v = await asAdmin(STORY)
		const pipeline = v.groups.at(-1)!
		expect(pipeline.kind).toBe("pipeline")
		const everywhere = groupSteps(v.groups).map((s) => s.heading)
		for (const h of TAIL) {
			expect(pipeline.advanced.filter((s) => s.heading === h), h).toHaveLength(1)
			expect(everywhere.filter((x) => x === h), h).toHaveLength(1)
		}
		// No step heading is suffixed by a branch any more: nothing clashes inside a group.
		expect(everywhere.filter((h) => / · (prose|changes)$/.test(h))).toEqual([])
	})

	it("files the budget in the whole pipeline: it serves the turn, not one call", async () => {
		const v = await asAdmin(STORY)
		const holder = v.groups.find((g) => g.advanced.some((s) => s.options.some((o) => o.id === id("contextBudget", "params", "safetyMargin"))))
		expect(holder?.kind).toBe("pipeline")
	})

	it("shows a non-admin the one group, with its prompt and nothing to tune", async () => {
		const v = await asUser(STORY)
		expect(v.groups).toHaveLength(1)
		const [g] = v.groups
		expect(ofControl(g!, "prompts-ref")).toHaveLength(1)
		for (const o of g!.front.filter((f) => f.control !== "prompts-ref")) {
			expect(o.writable).toBe(false)
		}
		expect(g!.advanced).toEqual([])
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
	it("leads with the prose reply's call — its own prompt, connection and sampling", async () => {
		const v = await asAdmin(STORY_RESPOND_SPEC_ID)
		const g = calls(v).find((x) => x.heading === "Reply · prose")!
		expect(g.kind).toBe("model-call")
		expect(ofControl(g, "prompts-ref").map((o) => o.id)).toEqual([id("context", "prompts")])
		expect(ofControl(g, "connection-ref").map((o) => o.id)).toEqual([id("reply.prose.generate", "connection")])
		expect(ofControl(g, "sampling-ref").map((o) => o.id)).toEqual([id("reply.prose.generate", "sampling")])
	})

	it("fronts Loadout, Prompt, Model and Sampling; the lore sources' switches, labelled by their step, serve the whole pipeline", async () => {
		const v = await asAdmin(STORY_RESPOND_SPEC_ID)
		expect(calls(v).find((x) => x.heading === "Reply · prose")!.front.slice(0, 4).map((o) => o.control)).toEqual([
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
	 * prompt, one model and one sampling. Rewritten 2026-10-21 (Lair rewrite
	 * R13): nobody speaks for the party, so there is no party call beside it.
	 */
	it("shows one Character turn group, with one prompt, one model and one sampling, and no party call", async () => {
		const v = await asAdmin(LAIR)
		const headings = calls(v).map((g) => g.heading)
		expect(headings.filter((h) => h === "Character turn")).toHaveLength(1)
		expect(headings).not.toContain("Castellan speaks for the party")
		for (const gone of ["Voices", "First voice", "Further voices", "Picked voice"])
			expect(headings).not.toContain(gone)
		const turn = calls(v).find((g) => g.heading === "Character turn")!
		expect(turn.purpose).toMatch(/every delver/i)
		expect(ofControl(turn, "prompts-ref")).toHaveLength(1)
		expect(ofControl(turn, "connection-ref")).toHaveLength(1)
		expect(ofControl(turn, "sampling-ref")).toHaveLength(1)
		// Nothing model-shaped of the character turn is left in the whole pipeline.
		const pipeline = v.groups.find((g) => g.kind === "pipeline")!
		expect(pipeline.front.filter((o) => o.control === "prompts-ref" || o.control === "connection-ref" || o.control === "sampling-ref")).toEqual([])
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

	it("reads a configured value from inside a session as the genre's defaults', by name", async () => {
		const [cfg] = await db
			.insert(schema.samplingConfigs)
			.values({ name: "Steady narration", values: {} } as any)
			.returning({ id: schema.samplingConfigs.id, name: schema.samplingConfigs.name })
		// An administrator's instance-wide value: on the genre's defaults'
		// registration of the reply (PLAN-layering D5), not a configuration.
		const { setPipelineValue } = await import("$lib/server/utils/testDb")
		await setPipelineValue(db, STORY, { nodeKey: "reply.prose.generate", slot: "sampling", path: "" }, cfg!.id)
		const v = await asAdmin(STORY, { sessionId })
		const sampling = calls(v).find((g) => g.heading === "Reply · prose")!.front.find((o) => o.control === "sampling-ref")!
		expect(sampling.inherits).toEqual({ from: "config", label: `As configured — ${cfg!.name}` })
		expect(sampling.provenance?.source).toBe("config")
		expect(sampling.provenance?.label).toBe("From the genre's defaults")
		expect(sampling.valueLabel).toBe(cfg!.name)
	})
})

describe("a step label and a step purpose on the spec", () => {
	it("a purpose sits under its group, and a label names a step in Advanced", async () => {
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
		const shipped = await Promise.all(["reply.prose.generate", "prompt"].map(nodeRow))
		onTestFinished(async () => {
			for (const row of shipped)
				await db
					.update(schema.pipelineNodes)
					.set({ expose: row.expose as any })
					.where(eq(schema.pipelineNodes.id, row.id))
		})
		await relabel("reply.prose.generate", {
			label: "Turn writer",
			purpose: "Writes what happens next."
		})
		await relabel("prompt", { label: "Writer's prompt layout" })

		// The prose reply's call, labelled: its group reads the label — no
		// branch beside it now that no other group reads alike — and its
		// purpose sits under it.
		const v = await asAdmin(STORY)
		const planner = calls(v).find((g) => g.heading === "Turn writer")!
		expect(planner.purpose).toBe("Writes what happens next.")
		expect(calls(v).map((g) => g.heading)).toContain("Reply")
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

