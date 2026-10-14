/**
 * Scripts as rows, and the refusals that keep a chain meaningful.
 *
 * Same failure mode as prompts, one tier down: a chain stores this row's id,
 * so the writes this module refuses are the ones that would leave an
 * attachment that stores cleanly and does nothing — a deleted row a chain
 * still points at, an out-declaration a verdict type's executor would ignore,
 * an edit to a shipped row other installs rely on staying identical.
 *
 * The view is tested against the *registry rows*, not the SDK map: the page
 * renders from rows (F6), so what these assertions prove is what the page can
 * actually see.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import {
	createScript,
	deleteScript,
	duplicateScript,
	scriptsView,
	scriptType,
	updateScript,
	ScriptNotFoundError,
	ScriptNotUsableError
} from "$lib/server/pipelines/entities/scripts"
import {
	libraryView,
	pipelineScriptSeams
} from "$lib/server/pipelines/config/library"
import { optionId, stepKeyFor } from "$lib/server/pipelines/config/panel/ids"

let db: TestDb

const TRANSFORM = "core:script:text/transform@1"
const STOP = "core:script:text/stop@1"

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
}, 60_000)

describe("the view", () => {
	it("lists core's script types from registry rows, grouped data intact", async () => {
		const view = await scriptsView(db)
		const ids = view.types.map((t) => t.typeId)
		expect(ids).toContain(TRANSFORM)
		expect(ids).toContain(STOP)

		const stop = view.types.find((t) => t.typeId === STOP)!
		// Semantics is contract and rides the row (migration 0125); the badge
		// is display text and rides i18n. Both must reach the page.
		expect(stop.semantics).toBe("verdict")
		expect(stop.blastRadius.length).toBeGreaterThan(0)

		const transform = view.types.find((t) => t.typeId === TRANSFORM)!
		expect(transform.semantics).toBe("transform")
		expect(transform.varsIn).toContain("text")
	})

	it("derives a type's extras from the hooks that accept it", async () => {
		// The write consumers declare `extras: ['speakerName', 'castNames']`
		// on their scripts slot; the type's readable space is the union across
		// hooks, read from registry rows — a plugin hook widens it with no
		// core change.
		const view = await scriptsView(db)
		const transform = view.types.find((t) => t.typeId === TRANSFORM)!
		expect(transform.extras).toContain("speakerName")
		expect(transform.extras).toContain("castNames")
	})

	it("every type can read the ambient `session`, an interior-point type included (R32)", async () => {
		// No slot lists `session` since the modder pass — the executor hands
		// it to every site — so a type reachable only at an interior point
		// (turn/select, at turn-scripted's `select`) reads it too.
		const view = await scriptsView(db)
		expect(view.types.length).toBeGreaterThan(0)
		for (const t of view.types) expect(t.extras, t.typeId).toContain("session")
		expect(view.types.find((t) => t.typeId === "core:script:turn/select@1")?.extras).toContain(
			"session"
		)
	})
})

describe("authoring", () => {
	it("creates with the type's variable space as the declared I/O", async () => {
		const row = await createScript(db, {
			typeId: TRANSFORM,
			name: "Slop killer"
		})
		expect(row.varsIn).toEqual(["text"])
		expect(row.varsOut).toEqual(["text"])
		// The starter body is a no-op on purpose: the first save can never
		// break a chain.
		expect(row.source).toContain("return text")
	})

	it("refuses a type this build does not register, naming it", async () => {
		await expect(
			createScript(db, { typeId: "risu:script:lua/run@1" })
		).rejects.toThrow(ScriptNotUsableError)
	})

	it("names copies uniquely within the type's own pool", async () => {
		const first = await createScript(db, {
			typeId: TRANSFORM,
			name: "Dedupe me"
		})
		const second = await createScript(db, {
			typeId: TRANSFORM,
			name: "Dedupe me"
		})
		expect(second.name).not.toBe(first.name)
		expect(second.name).toContain("Dedupe me")
	})

	it("a verdict type refuses out-variables — a declaration the executor would ignore", async () => {
		const row = await createScript(db, { typeId: STOP })
		expect(row.varsOut).toEqual([])
		await expect(
			updateScript(db, row.id, { varsOut: ["text"] })
		).rejects.toThrow(ScriptNotUsableError)
	})

	it("the variable space is fixed: ports plus hook extras, nothing typed on faith", async () => {
		const row = await createScript(db, { typeId: TRANSFORM })

		// An extra some hook supplies is a legal read...
		await updateScript(db, row.id, {
			varsIn: ["text", "speakerName"]
		})
		const view = await scriptsView(db)
		const stored = view.scripts.find((s) => s.id === row.id)!
		expect(stored.varsIn).toEqual(["text", "speakerName"])

		// ...a name nothing supplies is refused with the name — a declaration
		// nothing will ever satisfy is the "stores cleanly and does nothing"
		// shape, one field down.
		await expect(
			updateScript(db, row.id, { varsIn: ["text", "mood"] })
		).rejects.toThrow(ScriptNotUsableError)

		// ...and an extra is read-only by construction: it has no legal out.
		await expect(
			updateScript(db, row.id, { varsOut: ["speakerName"] })
		).rejects.toThrow(ScriptNotUsableError)
	})

	it("duplicates source and declarations under a fresh name", async () => {
		const row = await createScript(db, {
			typeId: TRANSFORM,
			name: "Original"
		})
		await updateScript(db, row.id, {
			source: "return text.trim()\n",
			varsIn: ["text"]
		})
		const copy = await duplicateScript(db, row.id)
		expect(copy.name).toContain("Original")
		expect(copy.source).toBe("return text.trim()\n")
		expect(copy.isImmutable).toBe(false)
	})
})

describe("the refusals", () => {
	it("an immutable row refuses edits and deletion — duplicate to edit", async () => {
		const [shipped] = await (db)
			.insert(schema.pipelineScripts)
			.values({
				typeId: TRANSFORM,
				name: "Shipped guard",
				seedKey: "pipeline-script:test-shipped",
				isImmutable: true,
				source: "return text"
			})
			.returning()
		await expect(
			updateScript(db, shipped.id, { name: "Renamed" })
		).rejects.toThrow(ScriptNotUsableError)
		await expect(deleteScript(db, shipped.id)).rejects.toThrow(
			ScriptNotUsableError
		)
		// The copy is the way in, exactly like a shipped prompt.
		const copy = await duplicateScript(db, shipped.id)
		expect(copy.isImmutable).toBe(false)
	})

	it("a referenced script refuses deletion and names the holder", async () => {
		const row = await createScript(db, {
			typeId: TRANSFORM,
			name: "Held by a chain"
		})

		// A chain is an ordered ref list at the `scripts` slot path (18 §2) —
		// written here the way U-S3's config layer will write it, so this test
		// is pinned to the storage ruling rather than to code that exists yet.
		const [spec] = await (db)
			.select()
			.from(schema.pipelineSpecs)
			.limit(1)
		await (db).insert(schema.pipelineNodeOverrides).values({
			specId: spec.id,
			scopeKind: "session",
			nodeKey: "generate",
			slot: "scripts",
			path: "chain",
			value: [row.id]
		})

		await expect(deleteScript(db, row.id)).rejects.toThrow(
			ScriptNotUsableError
		)
		const view = await scriptsView(db)
		const held = view.scripts.find((s) => s.id === row.id)!
		expect(held.usedBy.length).toBeGreaterThan(0)
	})

	it("a missing row says so", async () => {
		await expect(deleteScript(db, 999_999)).rejects.toThrow(
			ScriptNotFoundError
		)
		await expect(
			scriptType(db, "core:script:text/transform@1")
		).resolves.not.toBeNull()
	})
})

describe("sharing (18 §2, U-S7)", () => {
	it("export → wipe → import round-trips a script byte-identically", async () => {
		const {
			exportScriptArtifact,
			importScriptArtifact,
			parseScriptArtifact
		} = await import("$lib/server/pipelines/entities/scripts")
		const row = await createScript(db, {
			typeId: TRANSFORM,
			name: "Round tripper"
		})
		await updateScript(db, row.id, {
			source: "// exact bytes\nreturn text.trim()\n",
			varsIn: ["text", "speakerName"]
		})
		const artifact = await exportScriptArtifact(db, [row.id])
		expect(artifact.scripts[0]).toEqual({
			type: TRANSFORM,
			name: "Round tripper",
			source: "// exact bytes\nreturn text.trim()\n",
			in: ["text", "speakerName"],
			out: ["text"]
		})

		await deleteScript(db, row.id)
		const report = await importScriptArtifact(
			db,
			parseScriptArtifact(JSON.parse(JSON.stringify(artifact)))
		)
		expect(report.imported).toEqual([{ name: "Round tripper" }])
		const view = await scriptsView(db)
		const back = view.scripts.find((s) => s.name === "Round tripper")!
		expect(back.source).toBe("// exact bytes\nreturn text.trim()\n")
		expect(back.varsIn).toEqual(["text", "speakerName"])
	})

	it("a bare entry is a legal artifact — the doc's own shape", async () => {
		const { importScriptArtifact, parseScriptArtifact } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const report = await importScriptArtifact(
			db,
			parseScriptArtifact({
				type: TRANSFORM,
				name: "Bare entry",
				source: "return text",
				in: ["text"],
				out: ["text"]
			})
		)
		expect(report.imported).toEqual([{ name: "Bare entry" }])
	})

	it("per-script opt-in, name collisions as copies, and unknown types reported — never dropped silently", async () => {
		const { importScriptArtifact, parseScriptArtifact } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		await createScript(db, { typeId: TRANSFORM, name: "Taken" })
		const pack = parseScriptArtifact({
			serenePub: "scripts@1",
			scripts: [
				{
					type: TRANSFORM,
					name: "Taken",
					source: "return text",
					in: ["text"],
					out: ["text"]
				},
				{
					type: "risu:script:lua/run@1",
					name: "Foreign",
					source: "print('hi')",
					in: [],
					out: []
				},
				{
					type: TRANSFORM,
					name: "Left behind",
					source: "return text",
					in: ["text"],
					out: ["text"]
				}
			]
		})
		const report = await importScriptArtifact(db, pack, [0, 1])
		expect(report.imported).toEqual([
			{ name: "Taken", renamed: "Taken (2)" }
		])
		expect(report.skipped).toEqual([
			{
				name: "Foreign",
				reason: expect.stringContaining("risu:script:lua/run@1")
			},
			{ name: "Left behind", reason: "not selected" }
		])
	})

	it("a malformed artifact refuses whole, naming what was expected", async () => {
		const { parseScriptArtifact } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		expect(() => parseScriptArtifact({ nonsense: true })).toThrow(
			ScriptNotUsableError
		)
		expect(() =>
			parseScriptArtifact({
				serenePub: "scripts@1",
				scripts: [{ type: TRANSFORM }]
			})
		).toThrow(ScriptNotUsableError)
	})
})

describe("connection attachment (18 §4b)", () => {
	let connectionId: number

	beforeAll(async () => {
		const [conn] = await (db)
			.insert(schema.connections)
			.values({ name: "Kobold", type: "koboldcpp" })
			.returning()
		connectionId = conn.id
	})

	it("attaches only stop scripts — the scope guard as a refusal", async () => {
		const { attachConnectionScript, listConnectionScripts } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const guard = await createScript(db, {
			typeId: STOP,
			name: "ChatML guard"
		})
		await attachConnectionScript(db, connectionId, guard.id)
		expect(
			(await listConnectionScripts(db, connectionId)).map(
				(s) => s.name
			)
		).toEqual(["ChatML guard"])

		// A transform never rides a connection: the completion stream is what
		// flows through it, and everything else attaches on pipeline steps.
		const filter = await createScript(db, {
			typeId: TRANSFORM,
			name: "Not a guard"
		})
		await expect(
			attachConnectionScript(db, connectionId, filter.id)
		).rejects.toThrow(ScriptNotUsableError)

		// Attaching twice is a mistake, not a second guard.
		await expect(
			attachConnectionScript(db, connectionId, guard.id)
		).rejects.toThrow(ScriptNotUsableError)
	})

	it("an attachment is a reference: usedBy names it, deletion refuses, detach releases", async () => {
		const { detachConnectionScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const view = await scriptsView(db)
		const guard = view.scripts.find((s) => s.name === "ChatML guard")!
		expect(guard.usedBy).toContain("connection: Kobold")
		await expect(deleteScript(db, guard.id)).rejects.toThrow(
			ScriptNotUsableError
		)

		await detachConnectionScript(db, connectionId, guard.id)
		await expect(deleteScript(db, guard.id)).resolves.toBeUndefined()
	})
})

describe("placement and fits (PLAN-script-placement D5)", () => {
	const SECRET = "placement-test-secret"

	// No shipped pipeline runs extract-cast, the one core step with a
	// `castScripts` slot, so one is given a node of it — the shape a
	// modder's pipeline would have.
	beforeAll(async () => {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/summarize-world"))
			.limit(1)
		await db.insert(schema.pipelineNodes).values({
			specVersionId: spec.activeVersionId!,
			nodeKey: "castProbe",
			kind: "oracle",
			definitionId: "core:oracle/extract-cast",
			definitionVersion: 1,
			config: {},
			position: 9_999
		})
	}, 60_000)

	/** A step whose definition declares the `castScripts` slot, and its pipeline. */
	async function castStep() {
		for (const p of await pipelineScriptSeams(db))
			for (const [nodeKey, node] of p.nodes)
				if ((node.row?.slots as any)?.castScripts?.kind === "scripts")
					return { pipeline: p, nodeKey, row: node.row! }
		throw new Error("no step declares castScripts")
	}

	it("a chain at a castScripts slot counts as use and blocks delete", async () => {
		const { pipeline, nodeKey, row } = await castStep()
		const accepts = ((row.slots as any).castScripts.accepts ?? []) as string[]
		expect(accepts.length).toBeGreaterThan(0)
		const script = await createScript(db, {
			typeId: accepts[0],
			name: "Cast only"
		})
		await db.insert(schema.pipelineNodeOverrides).values({
			specId: pipeline.specId,
			scopeKind: "session",
			nodeKey,
			slot: "castScripts",
			path: "",
			value: [script.id]
		})

		await expect(deleteScript(db, script.id)).rejects.toThrow(
			/still in a chain/
		)
		const view = await scriptsView(db, { secret: SECRET })
		const held = view.scripts.find((s) => s.id === script.id)!
		expect(held.usedBy).toEqual([pipeline.label])
		expect(held.use).toEqual([
			{
				kind: "pipeline",
				pipelineSlug: pipeline.slug,
				pipelineLabel: pipeline.label,
				nodeKey,
				stepLabel: pipeline.nodes.get(nodeKey)!.stepLabel,
				at: "out:cast",
				stepKey: stepKeyFor(SECRET, nodeKey),
				optionId: optionId(SECRET, nodeKey, "castScripts", ""),
				unplaced: false
			}
		])
	}, 60_000)

	it("a chain whose seam is gone is still a use, marked unplaced", async () => {
		const { pipeline, nodeKey } = await castStep()
		const script = await createScript(db, {
			typeId: TRANSFORM,
			name: "Stranded"
		})
		await db.insert(schema.pipelineNodeOverrides).values({
			specId: pipeline.specId,
			scopeKind: "session",
			nodeKey,
			slot: "scripts",
			path: "a-point-nobody-declares",
			value: [script.id]
		})
		await expect(deleteScript(db, script.id)).rejects.toThrow(
			ScriptNotUsableError
		)
		const view = await scriptsView(db, { secret: SECRET })
		const held = view.scripts.find((s) => s.id === script.id)!
		expect(held.use).toHaveLength(1)
		expect(held.use[0]).toMatchObject({
			kind: "pipeline",
			at: "a-point-nobody-declares",
			unplaced: true
		})
	}, 60_000)

	it("an address that is not a chain's is not a use", async () => {
		const { pipeline, nodeKey } = await castStep()
		const script = await createScript(db, {
			typeId: TRANSFORM,
			name: "Not in a chain"
		})
		// A number at a non-chain slot is some other setting's value.
		await db.insert(schema.pipelineNodeOverrides).values({
			specId: pipeline.specId,
			scopeKind: "session",
			nodeKey,
			slot: "sampling",
			path: "",
			value: script.id
		})
		const view = await scriptsView(db, { secret: SECRET })
		expect(view.scripts.find((s) => s.id === script.id)!.use).toEqual([])
	}, 60_000)

	it("fits counts every seam whose accepts names the kind", async () => {
		const pipelines = (await pipelineScriptSeams(db)).filter((p) => !p.disabled)
		const expected = pipelines.flatMap((p) =>
			p.seams.filter((s) => s.accepts.includes(TRANSFORM)).map((s) => ({ p, s }))
		)
		expect(expected.length).toBeGreaterThan(0)

		const mine = await createScript(db, { typeId: TRANSFORM, name: "Fits probe" })
		const view = await scriptsView(db)
		const transform = view.scripts.find((s) => s.id === mine.id)!
		expect(transform.fits.seams).toBe(expected.length)
		expect(new Set(transform.fits.pipelines)).toEqual(
			new Set(expected.map((e) => e.p.slug))
		)
		expect(new Set(transform.fits.at)).toEqual(new Set(expected.map((e) => e.s.at)))
		expect(new Set(transform.fits.steps)).toEqual(
			new Set(expected.map((e) => e.s.stepLabel))
		)
		for (const slug of transform.fits.pipelines)
			expect(view.pipelineLabels[slug]).toBeTruthy()

		// A kind no seam accepts fits nowhere.
		const unfit = view.types.find(
			(t) => !pipelines.some((p) => p.seams.some((s) => s.accepts.includes(t.typeId)))
		)
		if (unfit) {
			const row = await createScript(db, { typeId: unfit.typeId })
			const again = await scriptsView(db)
			expect(again.scripts.find((s) => s.id === row.id)!.fits.seams).toBe(0)
		}
	}, 60_000)

	it("the library lists each pipeline's seams, castScripts as out:cast", async () => {
		const { pipeline, nodeKey } = await castStep()
		const view = await libraryView(db)
		const p = view.pipelines.find((x) => x.slug === pipeline.slug)!
		const cast = p.scriptSeams.find((s) => s.nodeKey === nodeKey && s.at === "out:cast")
		expect(cast).toBeTruthy()
		expect(cast!.accepts.length).toBeGreaterThan(0)
		expect(cast!.stepLabel.length).toBeGreaterThan(0)
	}, 60_000)
})
