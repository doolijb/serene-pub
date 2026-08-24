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

let db: TestDb

const TRANSFORM = "core:script:text/transform@1"
const STOP = "core:script:text/stop@1"

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db as any)
}, 60_000)

describe("the view", () => {
	it("lists core's script types from registry rows, grouped data intact", async () => {
		const view = await scriptsView(db as any)
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
		const view = await scriptsView(db as any)
		const transform = view.types.find((t) => t.typeId === TRANSFORM)!
		expect(transform.extras).toContain("speakerName")
		expect(transform.extras).toContain("castNames")
	})
})

describe("authoring", () => {
	it("creates with the type's variable space as the declared I/O", async () => {
		const row = await createScript(db as any, {
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
			createScript(db as any, { typeId: "risu:script:lua/run@1" })
		).rejects.toThrow(ScriptNotUsableError)
	})

	it("names copies uniquely within the type's own pool", async () => {
		const first = await createScript(db as any, {
			typeId: TRANSFORM,
			name: "Dedupe me"
		})
		const second = await createScript(db as any, {
			typeId: TRANSFORM,
			name: "Dedupe me"
		})
		expect(second.name).not.toBe(first.name)
		expect(second.name).toContain("Dedupe me")
	})

	it("a verdict type refuses out-variables — a declaration the executor would ignore", async () => {
		const row = await createScript(db as any, { typeId: STOP })
		expect(row.varsOut).toEqual([])
		await expect(
			updateScript(db as any, row.id, { varsOut: ["text"] })
		).rejects.toThrow(ScriptNotUsableError)
	})

	it("the variable space is fixed: ports plus hook extras, nothing typed on faith", async () => {
		const row = await createScript(db as any, { typeId: TRANSFORM })

		// An extra some hook supplies is a legal read...
		await updateScript(db as any, row.id, {
			varsIn: ["text", "speakerName"]
		})
		const view = await scriptsView(db as any)
		const stored = view.scripts.find((s) => s.id === row.id)!
		expect(stored.varsIn).toEqual(["text", "speakerName"])

		// ...a name nothing supplies is refused with the name — a declaration
		// nothing will ever satisfy is the "stores cleanly and does nothing"
		// shape, one field down.
		await expect(
			updateScript(db as any, row.id, { varsIn: ["text", "mood"] })
		).rejects.toThrow(ScriptNotUsableError)

		// ...and an extra is read-only by construction: it has no legal out.
		await expect(
			updateScript(db as any, row.id, { varsOut: ["speakerName"] })
		).rejects.toThrow(ScriptNotUsableError)
	})

	it("duplicates source and declarations under a fresh name", async () => {
		const row = await createScript(db as any, {
			typeId: TRANSFORM,
			name: "Original"
		})
		await updateScript(db as any, row.id, {
			source: "return text.trim()\n",
			varsIn: ["text"]
		})
		const copy = await duplicateScript(db as any, row.id)
		expect(copy.name).toContain("Original")
		expect(copy.source).toBe("return text.trim()\n")
		expect(copy.isImmutable).toBe(false)
	})
})

describe("the refusals", () => {
	it("an immutable row refuses edits and deletion — duplicate to edit", async () => {
		const [shipped] = await (db as any)
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
			updateScript(db as any, shipped.id, { name: "Renamed" })
		).rejects.toThrow(ScriptNotUsableError)
		await expect(deleteScript(db as any, shipped.id)).rejects.toThrow(
			ScriptNotUsableError
		)
		// The copy is the way in, exactly like a shipped prompt.
		const copy = await duplicateScript(db as any, shipped.id)
		expect(copy.isImmutable).toBe(false)
	})

	it("a referenced script refuses deletion and names the holder", async () => {
		const row = await createScript(db as any, {
			typeId: TRANSFORM,
			name: "Held by a chain"
		})

		// A chain is an ordered ref list at the `scripts` slot path (18 §2) —
		// written here the way U-S3's config layer will write it, so this test
		// is pinned to the storage ruling rather than to code that exists yet.
		const [spec] = await (db as any)
			.select()
			.from(schema.pipelineSpecs)
			.limit(1)
		await (db as any).insert(schema.pipelineNodeOverrides).values({
			specId: spec.id,
			scopeKind: "session",
			nodeKey: "generate",
			slot: "scripts",
			path: "chain",
			value: [row.id]
		})

		await expect(deleteScript(db as any, row.id)).rejects.toThrow(
			ScriptNotUsableError
		)
		const view = await scriptsView(db as any)
		const held = view.scripts.find((s) => s.id === row.id)!
		expect(held.usedBy.length).toBeGreaterThan(0)
	})

	it("a missing row says so", async () => {
		await expect(deleteScript(db as any, 999_999)).rejects.toThrow(
			ScriptNotFoundError
		)
		await expect(
			scriptType(db as any, "core:script:text/transform@1")
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
		const row = await createScript(db as any, {
			typeId: TRANSFORM,
			name: "Round tripper"
		})
		await updateScript(db as any, row.id, {
			source: "// exact bytes\nreturn text.trim()\n",
			varsIn: ["text", "speakerName"]
		})
		const artifact = await exportScriptArtifact(db as any, [row.id])
		expect(artifact.scripts[0]).toEqual({
			type: TRANSFORM,
			name: "Round tripper",
			source: "// exact bytes\nreturn text.trim()\n",
			in: ["text", "speakerName"],
			out: ["text"]
		})

		await deleteScript(db as any, row.id)
		const report = await importScriptArtifact(
			db as any,
			parseScriptArtifact(JSON.parse(JSON.stringify(artifact)))
		)
		expect(report.imported).toEqual([{ name: "Round tripper" }])
		const view = await scriptsView(db as any)
		const back = view.scripts.find((s) => s.name === "Round tripper")!
		expect(back.source).toBe("// exact bytes\nreturn text.trim()\n")
		expect(back.varsIn).toEqual(["text", "speakerName"])
	})

	it("a bare entry is a legal artifact — the doc's own shape", async () => {
		const { importScriptArtifact, parseScriptArtifact } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const report = await importScriptArtifact(
			db as any,
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
		await createScript(db as any, { typeId: TRANSFORM, name: "Taken" })
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
		const report = await importScriptArtifact(db as any, pack, [0, 1])
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
		const [conn] = await (db as any)
			.insert(schema.connections)
			.values({ name: "Kobold", type: "koboldcpp" })
			.returning()
		connectionId = conn.id
	})

	it("attaches only stop scripts — the scope guard as a refusal", async () => {
		const { attachConnectionScript, listConnectionScripts } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const guard = await createScript(db as any, {
			typeId: STOP,
			name: "ChatML guard"
		})
		await attachConnectionScript(db as any, connectionId, guard.id)
		expect(
			(await listConnectionScripts(db as any, connectionId)).map(
				(s) => s.name
			)
		).toEqual(["ChatML guard"])

		// A transform never rides a connection: the completion stream is what
		// flows through it, and everything else attaches on pipeline steps.
		const filter = await createScript(db as any, {
			typeId: TRANSFORM,
			name: "Not a guard"
		})
		await expect(
			attachConnectionScript(db as any, connectionId, filter.id)
		).rejects.toThrow(ScriptNotUsableError)

		// Attaching twice is a mistake, not a second guard.
		await expect(
			attachConnectionScript(db as any, connectionId, guard.id)
		).rejects.toThrow(ScriptNotUsableError)
	})

	it("an attachment is a reference: usedBy names it, deletion refuses, detach releases", async () => {
		const { detachConnectionScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const view = await scriptsView(db as any)
		const guard = view.scripts.find((s) => s.name === "ChatML guard")!
		expect(guard.usedBy).toContain("connection: Kobold")
		await expect(deleteScript(db as any, guard.id)).rejects.toThrow(
			ScriptNotUsableError
		)

		await detachConnectionScript(db as any, connectionId, guard.id)
		await expect(deleteScript(db as any, guard.id)).resolves.toBeUndefined()
	})
})
