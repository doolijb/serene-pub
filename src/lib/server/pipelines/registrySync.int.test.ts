/**
 * U2's acceptance criteria, as tests: sync is idempotent, a changed version
 * raises rather than publishing or ignoring, and install-time validation reads
 * the rows rather than the in-process descriptors.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import {
	syncTypeRegistry,
	readTypeRegistry,
	TypeRegistryConflictError
} from "./registrySync"
import { saveDocument, loadDocument } from "./store"
import type { Descriptor } from "@serene-pub/sdk"
import {
	S,
	allTypes,
	checkInstall,
	installable,
	renderInstall,
	spec,
	slot,
	compile
} from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

describe("type registry sync", () => {
	it("seeds the registry from the core contracts", async () => {
		const r = await syncTypeRegistry(db as any, allTypes(), {
			release: "0.6.0"
		})
		expect(r.inserted.length).toBeGreaterThan(20)
		expect(r.inserted).toContain("core:provider/generate-text@1")

		const rows = await db.select().from(schema.pipelineTypeRegistry)
		expect(rows.length).toBe(r.inserted.length)
	})

	it("is idempotent, which is why it can run unconditionally at boot", async () => {
		const again = await syncTypeRegistry(db as any, allTypes(), {
			release: "0.6.0"
		})
		expect(again.inserted).toEqual([])
		expect(again.updated).toEqual([])
		expect(again.unchanged.length).toBeGreaterThan(20)
	})

	it("raises when a published version's content changed — never publishes, never ignores", async () => {
		// Publishing silently would rewrite the meaning of every pin to @1.
		// Ignoring would leave the rows describing a build that no longer exists,
		// so plugin drift diagnostics would start reporting core's drift as theirs.
		// Built as a plain descriptor rather than through describeTaskType,
		// because a type id may only be registered once per process (F5) — and
		// what this test simulates is core's *next build*, not a second
		// declaration in this one.
		const drifted = {
			kind: "task",
			id: "core:task/chunk-text@1",
			timeoutMs: 1000,
			ports: {
				in: { text: S.text },
				out: { main: S.json, chunks: S.json }
			}
		} as unknown as Descriptor
		await expect(
			syncTypeRegistry(db as any, [drifted], { release: "0.6.1" })
		).rejects.toThrow(TypeRegistryConflictError)

		await expect(
			syncTypeRegistry(db as any, [drifted], { release: "0.6.1" })
		).rejects.toThrow(/Publish core:task\/chunk-text@2 instead/)
	})

	it("a new version lands beside the old one rather than replacing it", async () => {
		const v2 = {
			kind: "task",
			id: "core:task/chunk-text@2",
			timeoutMs: 1000,
			ports: {
				in: { text: S.text },
				out: { main: S.json, chunks: S.json }
			}
		} as unknown as Descriptor
		const r = await syncTypeRegistry(db as any, [v2], { release: "0.6.1" })
		expect(r.inserted).toEqual(["core:task/chunk-text@2"])

		const registry = await readTypeRegistry(db as any)
		const versions = registry
			.filter((e) => e.id === "core:task/chunk-text")
			.map((e) => e.version)
			.sort()
		// The old version stays: specs that pinned @1 are still pinning @1, and
		// that is the whole contract.
		expect(versions).toEqual([1, 2])
	})

	it("checkInstall validates a stored document against the stored registry", async () => {
		const doc = compile(
			spec("chariot.demo:turn", { version: "1.0.0" })
				.input("input", C.userMessage.v1())
				.query("history", ($) =>
					C.chatHistory.v1({ scope: $.input.chatScope })
				)
				.task("prompt", ($) =>
					C.assemble.v2({ candidates: $.history.messages })
				)
				.provider("generate", ($) =>
					C.generateText.v1({
						context: $.prompt.context,
						connection: slot.connection()
					})
				)
				.build()
		)
		const saved = await saveDocument(db as any, doc)
		const stored = await loadDocument(db as any, saved.specVersionId)

		const findings = checkInstall({
			declares: [],
			documents: [stored],
			registry: await readTypeRegistry(db as any)
		})
		expect(installable(findings), renderInstall(findings)).toBe(true)
	})

	it("a document compiled against a different release is refused by shape drift", async () => {
		// Every id still resolves. Only the shape moved — which is the failure a
		// version number alone does not catch, and the reason documents record
		// the shape each edge was compiled against.
		const doc = compile(
			spec("chariot.demo:stale", { version: "1.0.0" })
				.input("input", C.userMessage.v1())
				.query("history", ($) =>
					C.chatHistory.v1({ scope: $.input.chatScope })
				)
				.build()
		)
		doc.edges = doc.edges.map((e) => ({ ...e, shape: "core:shape/text@1" }))

		const findings = checkInstall({
			declares: [],
			documents: [doc],
			registry: await readTypeRegistry(db as any)
		})
		expect(installable(findings)).toBe(false)
		expect(findings.find((f) => f.code === "E_SHAPE_DRIFT")?.fix).toMatch(
			/rebuild the plugin against this release/
		)
	})
})
