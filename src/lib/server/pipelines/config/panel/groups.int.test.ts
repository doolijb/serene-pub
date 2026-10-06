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
import { CHAT_RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { groupSteps } from "$lib/server/pipelines/config/panel/groups"

const SECRET = "test-instance-secret"
const ADVENTURE = "core:spec/adventure-respond"
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

describe("Adventure's turn: one group per model call", () => {
	/** The four calls, by the node keys the payload never names. */
	const AGENTS = [
		{ call: "planWrite", prompt: "planContext", heading: "Planner" },
		{ call: "scene", prompt: "sceneContext", heading: "Narrator" },
		{ call: "voices.item.say", prompt: "voices.item.context", heading: "Voices" },
		{ call: "keeperWrite", prompt: "keeperContext", heading: "State-keeper" }
	]

	it("draws four groups — planner, narrator, voices, state keeper — then the whole pipeline", async () => {
		const v = await asAdmin(ADVENTURE)
		expect(calls(v).map((g) => g.heading)).toEqual(AGENTS.map((a) => a.heading))
		expect(v.groups.at(-1)).toMatchObject({ kind: "pipeline", heading: "Whole pipeline" })
		expect(v.groups.map((g) => g.key)).toEqual(v.groups.map((_, i) => `g${i}`))
	})

	it("gives each group exactly its own prompt, connection and sampling", async () => {
		const v = await asAdmin(ADVENTURE)
		calls(v).forEach((g, i) => {
			const a = AGENTS[i]!
			expect(ofControl(g, "prompts-ref").map((o) => o.id)).toEqual([id(a.prompt, "prompts")])
			expect(ofControl(g, "connection-ref").map((o) => o.id)).toEqual([id(a.call, "connection")])
			expect(ofControl(g, "sampling-ref").map((o) => o.id)).toEqual([id(a.call, "sampling")])
			// …and in that order: Prompt, Model, Sampling.
			expect(g.front.slice(0, 3).map((o) => o.control)).toEqual([
				"prompts-ref",
				"connection-ref",
				"sampling-ref"
			])
		})
		// No group carries another's: nothing model-shaped is left over.
		const pipeline = v.groups.at(-1)!
		expect(pipeline.front.filter((o) => /-ref$/.test(o.control) && o.control !== "scripts-chain")).toEqual([])
	})

	it("puts the planner's and the state keeper's switch on their groups", async () => {
		const v = await asAdmin(ADVENTURE)
		const [planner, narrator, voices, keeper] = calls(v)
		expect(planner!.enabled?.id).toBe(id("planWrite", "settings", "enabled"))
		expect(keeper!.enabled?.id).toBe(id("keeperWrite", "settings", "enabled"))
		expect(narrator!.enabled).toBeUndefined()
		expect(voices!.enabled).toBeUndefined()
	})

	it("files each call's other steps under its own Advanced, and what serves the whole turn under the whole pipeline", async () => {
		const v = await asAdmin(ADVENTURE)
		const [planner, narrator, voices] = calls(v)
		const pipeline = v.groups.at(-1)!
		const has = (g: SettingsGroup, nodeKey: string, slot: string, path = "") =>
			g.advanced.some((s) => s.options.some((o) => o.id === id(nodeKey, slot, path)))
		// The assemble paired with the call, by its template.
		expect(has(planner!, "planPrompt", "template")).toBe(true)
		expect(has(narrator!, "scenePrompt", "template")).toBe(true)
		// A step that feeds only one call: a voice's own lore share.
		expect(has(voices!, "voices.item.lore", "params", "share")).toBe(true)
		// The budget reads the narrator's model but serves every call.
		expect(has(pipeline, "contextBudget", "params", "safetyMargin")).toBe(true)
		expect(has(narrator!, "contextBudget", "params", "safetyMargin")).toBe(false)
	})

	it("shows a non-admin the same four headings, each with its own prompt and nothing to tune", async () => {
		const v = await asUser(ADVENTURE)
		expect(v.groups.map((g) => g.heading)).toEqual(AGENTS.map((a) => a.heading))
		v.groups.forEach((g, i) => {
			const a = AGENTS[i]!
			expect(ofControl(g, "prompts-ref").map((o) => o.id)).toEqual([id(a.prompt, "prompts")])
			// Whatever else a non-admin is shown is this call's own, read-only.
			for (const o of g.front.filter((f) => f.control !== "prompts-ref")) {
				expect(o.id).toBe(id(a.call, "connection"))
				expect(o.writable).toBe(false)
			}
			expect(g.advanced).toEqual([])
		})
	})

	it("never numbers a heading", async () => {
		const numbered = (hs: string[]) => hs.filter((h) => /\s\d+$/.test(h))
		for (const v of [await asAdmin(ADVENTURE), await asAdmin(LAIR), await asAdmin(CHAT_RESPOND_SPEC_ID)]) {
			// Once, step headings read "Generate reply 2"; no option's step does.
			expect(numbered(groupSteps(v.groups).map((s) => s.heading))).toEqual([])
			expect(numbered(headings(v))).toEqual([])
		}
	})
})

describe("a heading never names a node", () => {
	it("is prose — no group or step heading equals a node key", async () => {
		for (const slug of [ADVENTURE, LAIR]) {
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

describe("Chat's reply: one model call, one unheaded group", () => {
	it("holds everything in one group with no heading", async () => {
		const v = await asAdmin(CHAT_RESPOND_SPEC_ID)
		expect(v.groups).toHaveLength(1)
		const [g] = v.groups
		expect(g!.heading).toBeUndefined()
		expect(g!.kind).toBe("model-call")
		expect(ofControl(g!, "prompts-ref").map((o) => o.id)).toEqual([id("context", "prompts")])
		expect(ofControl(g!, "connection-ref").map((o) => o.id)).toEqual([id("generate", "connection")])
		expect(ofControl(g!, "sampling-ref").map((o) => o.id)).toEqual([id("generate", "sampling")])
	})

	it("fronts Prompt, Model and Sampling, then each source's switch labelled by its step", async () => {
		const [g] = (await asAdmin(CHAT_RESPOND_SPEC_ID)).groups
		expect(g!.front.slice(0, 3).map((o) => o.control)).toEqual([
			"prompts-ref",
			"connection-ref",
			"sampling-ref"
		])
		const switches = g!.front.slice(3)
		expect(switches.length).toBeGreaterThan(1)
		expect(switches.every((o) => o.control === "boolean")).toBe(true)
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
		const v = await asAdmin(ADVENTURE)
		for (const g of calls(v))
			for (const o of g.front.filter((f) => f.control === "connection-ref" || f.control === "sampling-ref")) {
				expect(o.inherits?.label).toMatch(/^(Pipeline default — |Pub default — |No model set|No sampling config set)/)
				expect(o.provenance?.label).toBeTruthy()
				if (o.valueLabel !== undefined) expect(o.valueLabel).not.toMatch(/^\d+$/)
			}
	})

	it("reads a configured value from inside a session as the configuration's, by name", async () => {
		const [cfg] = await db
			.insert(schema.samplingConfigs)
			.values({ name: "Steady narration", values: {} } as any)
			.returning({ id: schema.samplingConfigs.id, name: schema.samplingConfigs.name })
		const v0 = await asAdmin(ADVENTURE)
		const selected = v0.selectedConfig!
		// Written straight to the selected configuration's rows, as a config edit would.
		await db
			.delete(schema.pipelineConfigValues)
			.where(
				and(
					eq(schema.pipelineConfigValues.configId, selected.id),
					eq(schema.pipelineConfigValues.nodeKey, "scene"),
					eq(schema.pipelineConfigValues.slot, "sampling")
				)
			)
		await db.insert(schema.pipelineConfigValues).values({
			configId: selected.id,
			nodeKey: "scene",
			slot: "sampling",
			path: "",
			value: cfg!.id
		} as any)
		const v = await asAdmin(ADVENTURE, { sessionId })
		const sampling = calls(v)[1]!.front.find((o) => o.control === "sampling-ref")!
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
			.where(eq(schema.pipelineSpecs.slug, ADVENTURE))
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
		const shipped = await Promise.all(["planWrite", "planPrompt", "scene"].map(nodeRow))
		onTestFinished(async () => {
			for (const row of shipped)
				await db
					.update(schema.pipelineNodes)
					.set({ expose: row.expose as any })
					.where(eq(schema.pipelineNodes.id, row.id))
		})
		await relabel("planWrite", {
			label: "Turn planner",
			purpose: "Decides what happens next and who speaks."
		})
		await relabel("planPrompt", { label: "Planner's prompt layout" })
		// The narrator without its label or purpose, as a spec that sets neither.
		const scene = await nodeRow("scene")
		const { label: _label, purpose: _purpose, ...unlabelled } = (scene.expose ?? {}) as Record<string, unknown>
		await db
			.update(schema.pipelineNodes)
			.set({ expose: unlabelled as any })
			.where(eq(schema.pipelineNodes.id, scene.id))

		const v = await asAdmin(ADVENTURE)
		const planner = calls(v)[0]!
		expect(planner.heading).toBe("Turn planner")
		expect(planner.purpose).toBe("Decides what happens next and who speaks.")
		// The status heads a call that carries no label, with no purpose under it.
		expect(calls(v)[1]!.heading).toBe("Narrating the scene")
		expect(calls(v)[1]!.purpose).toBeUndefined()
		expect(planner.advanced.map((s) => s.heading)).toContain("Planner's prompt layout")
		// Every option of that step carries the same heading.
		expect(groupSteps(v.groups).map((s) => s.heading)).toContain("Planner's prompt layout")
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
