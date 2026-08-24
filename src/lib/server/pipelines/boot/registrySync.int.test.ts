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
} from "$lib/server/pipelines/boot/registrySync"
import { saveDocument, loadDocument } from "$lib/server/pipelines/boot/store"
import type { Descriptor } from "@serene-pub/sdk"
import {
	S,
	allTypes,
	allScriptTypes,
	getScriptType,
	snapshotRegistry,
	checkInstall,
	installable,
	renderInstall,
	spec,
	slot,
	compile
} from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"
import { and, eq } from "drizzle-orm"

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

	it("refreshes display text in place — a reworded description is not a new version", async () => {
		// Labels and descriptions are stripped from the content hash so they
		// can change without a bump; the row must pick them up, because the
		// row is what a form renders from (F6). Same pin, same contract, new
		// wording → the stored slots move and nothing raises.
		const base = allTypes().find(
			(d: any) => d.id === "core:query/session-history@1"
		)! as any
		const reworded = {
			...base,
			slots: {
				...base.slots,
				params: {
					...base.slots.params,
					schema: {
						...base.slots.params.schema,
						limit: {
							...base.slots.params.schema.limit,
							description: "Reworded after shipping."
						}
					}
				}
			}
		}
		const r = await syncTypeRegistry(db as any, [reworded], {
			release: "0.6.0"
		})
		expect(r.updated).toContain("core:query/session-history@1")

		const rows = await readTypeRegistry(db as any)
		// Registry entries carry the bare id; the version is its own column.
		const row = rows.find(
			(e) => `${e.id}@${e.version}` === "core:query/session-history@1"
		)! as any
		expect(row.slots.params.schema.limit.description).toBe(
			"Reworded after shipping."
		)

		// Put the original wording back so later assertions see the build's own.
		const restore = await syncTypeRegistry(db as any, [base], {
			release: "0.6.0"
		})
		expect(restore.updated).toContain("core:query/session-history@1")
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
					C.sessionHistory.v1({ scope: $.input.sessionScope })
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
					C.sessionHistory.v1({ scope: $.input.sessionScope })
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

/**
 * `optional` reaches the row, and heals when it is stale.
 *
 * It was in the content hash from the start and stored nowhere, so the only
 * reader that could see it was the executor — the panel's other source is the
 * in-process descriptor, which does not exist for a plugin type and is what F6
 * forbids reaching for. The column arrived long after the property, so every
 * row written before it carries the default rather than the truth.
 */
describe("the optional flag is stored, and self-corrects", () => {
	it("writes it on insert, not only on the heal that follows", async () => {
		// Deleting the row first is what makes this the *insert* path. Without
		// it the assertion passes on a row the self-correcting branch fixed,
		// and removing the insert write entirely changes nothing — which is
		// exactly what a mutation showed.
		await db
			.delete(schema.pipelineTypeRegistry)
			.where(
				and(
					eq(
						schema.pipelineTypeRegistry.typeId,
						"core:query/relationships-perspectives"
					),
					eq(schema.pipelineTypeRegistry.version, 1)
				)
			)
		await syncTypeRegistry(db as any, allTypes(), { release: "test" })

		const [row] = await db
			.select()
			.from(schema.pipelineTypeRegistry)
			.where(
				and(
					eq(
						schema.pipelineTypeRegistry.typeId,
						"core:query/relationships-perspectives"
					),
					eq(schema.pipelineTypeRegistry.version, 1)
				)
			)
		expect(
			row,
			"relationships-perspectives was not re-inserted"
		).toBeTruthy()
		expect(row.optional).toBe(true)
	})

	it("corrects a row that predates the column, without changing its hash", async () => {
		// The upgrade case, and the reason this is not a backfill with a
		// hardcoded list: an existing row has the right hash and the wrong
		// column, so nothing that keys on the hash would ever look at it.
		const [before] = await db
			.select()
			.from(schema.pipelineTypeRegistry)
			.where(
				and(
					eq(
						schema.pipelineTypeRegistry.typeId,
						"core:query/relationships-perspectives"
					),
					eq(schema.pipelineTypeRegistry.version, 1)
				)
			)
		await db
			.update(schema.pipelineTypeRegistry)
			.set({ optional: false })
			.where(eq(schema.pipelineTypeRegistry.id, before.id))

		await syncTypeRegistry(db as any, allTypes(), { release: "test" })

		const [after] = await db
			.select()
			.from(schema.pipelineTypeRegistry)
			.where(eq(schema.pipelineTypeRegistry.id, before.id))
		expect(after.optional, "a stale column survived a boot").toBe(true)
		expect(after.contentHash, "the hash moved").toBe(before.contentHash)
	})

	it("leaves a genuinely non-optional type alone", async () => {
		const [row] = await db
			.select()
			.from(schema.pipelineTypeRegistry)
			.where(
				and(
					eq(
						schema.pipelineTypeRegistry.typeId,
						"core:query/session-history"
					),
					eq(schema.pipelineTypeRegistry.version, 1)
				)
			)
		expect(row.optional).toBe(false)
	})
})

/**
 * The declared name, on the same footing as `optional` and for the same reason.
 *
 * ⚠ `snapshotRegistry` did not project `i18n` at all until 0.6, so the column
 * existed and was always NULL — and every reader that wanted a name invented
 * one from the type id instead. Which is why the *heal* matters more than the
 * insert here: a fresh database gets the name either way, and every install
 * that has ever booted has a row that will never take the conflict path,
 * because display text is stripped from the hash on purpose.
 */
describe("the declared name is stored, and self-corrects", () => {
	const PIN = "core:query/relationships-perspectives"
	const NAME = "Relationships: their perspective"

	const rowFor = async (typeId: string) => {
		const [row] = await db
			.select()
			.from(schema.pipelineTypeRegistry)
			.where(
				and(
					eq(schema.pipelineTypeRegistry.typeId, typeId),
					eq(schema.pipelineTypeRegistry.version, 1)
				)
			)
		return row
	}

	it("writes it on insert", async () => {
		// Deleted first, so this is the insert path rather than a row the heal
		// corrected — the mistake the `optional` test above records.
		await db
			.delete(schema.pipelineTypeRegistry)
			.where(
				and(
					eq(schema.pipelineTypeRegistry.typeId, PIN),
					eq(schema.pipelineTypeRegistry.version, 1)
				)
			)
		await syncTypeRegistry(db as any, allTypes(), { release: "test" })

		const row = await rowFor(PIN)
		expect(row, "the row was not re-inserted").toBeTruthy()
		expect((row.i18n as any)?.name?.en).toBe(NAME)
	})

	it("fills in a row that predates the column, without changing its hash", async () => {
		const before = await rowFor(PIN)
		await db
			.update(schema.pipelineTypeRegistry)
			.set({ i18n: null })
			.where(eq(schema.pipelineTypeRegistry.id, before.id))

		await syncTypeRegistry(db as any, allTypes(), { release: "test" })

		const [after] = await db
			.select()
			.from(schema.pipelineTypeRegistry)
			.where(eq(schema.pipelineTypeRegistry.id, before.id))
		expect(
			(after.i18n as any)?.name?.en,
			"a NULL name survived a boot, so every upgraded install keeps the invented one"
		).toBe(NAME)
		expect(after.contentHash, "the hash moved").toBe(before.contentHash)
	})

	it("picks up a rename, which is the promise that keeps it out of the hash", async () => {
		const before = await rowFor(PIN)
		await db
			.update(schema.pipelineTypeRegistry)
			.set({ i18n: { name: { en: "Something else entirely" } } })
			.where(eq(schema.pipelineTypeRegistry.id, before.id))

		await syncTypeRegistry(db as any, allTypes(), { release: "test" })

		const [after] = await db
			.select()
			.from(schema.pipelineTypeRegistry)
			.where(eq(schema.pipelineTypeRegistry.id, before.id))
		expect((after.i18n as any)?.name?.en).toBe(NAME)
	})
})

/**
 * Script types go into the same registry, under the same rules (18 §2, U-S1).
 *
 * The claim is not "scripts have rows" — it is that there is *one* sync. A
 * parallel projection for the fourth paradigm would be a second set of freeze,
 * conflict and re-projection rules, agreeing on the day it was written and
 * drifting after. These assert the shared machinery actually carries them.
 */
describe("script types ride the node-type sync", () => {
	const ALL = () => [...allTypes(), ...allScriptTypes()]

	const scriptRow = async (typeId: string) => {
		const [row] = await db
			.select()
			.from(schema.pipelineTypeRegistry)
			.where(
				and(
					eq(schema.pipelineTypeRegistry.typeId, typeId),
					eq(schema.pipelineTypeRegistry.version, 1)
				)
			)
		return row
	}

	it("projects all seven core contracts as rows of kind 'script'", async () => {
		await syncTypeRegistry(db as any, ALL(), { release: "test" })

		const rows = await db
			.select()
			.from(schema.pipelineTypeRegistry)
			.where(eq(schema.pipelineTypeRegistry.kind, "script"))
		expect(rows.map((r: any) => r.typeId).sort()).toEqual(
			allScriptTypes()
				.map((t) => t.id.replace(/@\d+$/, ""))
				.sort()
		)
	})

	it("stores the chain semantics, because the panel reads rows", async () => {
		// A `transport: 'process'` script type has no descriptor in this
		// process, so a semantics only the descriptor knows is a semantics the
		// panel cannot render — the same argument that put `slots` in a column.
		expect((await scriptRow("core:script:text/stop")).semantics).toBe(
			"verdict"
		)
		expect((await scriptRow("core:script:text/transform")).semantics).toBe(
			"transform"
		)
	})

	it("leaves node types with no semantics rather than a stand-in", async () => {
		// NULL here is a real value: a node type has no chain semantics to
		// have. Defaulting it to 'transform' would make the column unreadable.
		expect(
			(await scriptRow("core:query/session-history")).semantics
		).toBeNull()
	})

	it("is idempotent, which is what lets it run unconditionally at boot", async () => {
		const again = await syncTypeRegistry(db as any, ALL(), {
			release: "test"
		})
		expect(again.inserted).toEqual([])
		expect(again.updated).toEqual([])
	})

	it("refuses a moved script contract exactly as it refuses a moved node one", async () => {
		// The freeze rule is the whole reason scripts share this path. A
		// contract that could change under a pin would let every chain using it
		// start behaving differently with nothing on screen to say so.
		const before = await scriptRow("core:script:text/stop")
		await db
			.update(schema.pipelineTypeRegistry)
			.set({ contentHash: "stale-from-the-previous-build" })
			.where(eq(schema.pipelineTypeRegistry.id, before.id))

		await expect(
			syncTypeRegistry(db as any, ALL(), { release: "test" })
		).rejects.toBeInstanceOf(TypeRegistryConflictError)

		// Put it back, so the shared database is not left conflicting for
		// whatever runs next in this file.
		await db
			.update(schema.pipelineTypeRegistry)
			.set({ contentHash: before.contentHash })
			.where(eq(schema.pipelineTypeRegistry.id, before.id))
	})

	it("carries the blast radius as display text, out of the hash", async () => {
		const row = await scriptRow("core:script:messages/inject")
		expect((row.i18n as any)?.blastRadius?.en).toMatch(/additive/i)

		// Copyediting it must not be a contract change — the promise that lets
		// a warning be reworded without a version bump.
		const { typeContentHash } = await import(
			"$lib/server/pipelines/boot/registrySync"
		)
		const [entry] = snapshotRegistry(
			[getScriptType("core:script:messages/inject@1")!],
			{ release: "test" }
		)
		const reworded = typeContentHash({
			...entry,
			i18n: { blastRadius: { en: "Something else entirely" } }
		} as any)
		expect(reworded).toBe(typeContentHash(entry))
	})
})

/**
 * The row → entry read is lossless for the fields the hash depends on.
 *
 * ⚠ `readTypeRegistry` is what install-time validation reads, and it rebuilds a
 * `RegistryEntry` field by field — so a field added to the projection and not
 * to the reader silently disappears on the way back. For a *hashed* field that
 * is not a cosmetic loss: the same row would hash differently depending on
 * which direction it was travelling, and every script type would look
 * conflicted to anything that compared them.
 */
describe("a registry row round-trips through the reader", () => {
	it("returns the same content hash it was written with", async () => {
		await syncTypeRegistry(
			db as any,
			[...allTypes(), ...allScriptTypes()],
			{
				release: "test"
			}
		)
		const { typeContentHash } = await import(
			"$lib/server/pipelines/boot/registrySync"
		)

		const readBack = new Map(
			(await readTypeRegistry(db as any)).map((e) => [
				`${e.id}@${e.version}`,
				e
			])
		)

		// Node types too, and they are the reason this is worth widening: the
		// asymmetry this caught — `public` coming back `false` where the
		// projection had `undefined` — was never about scripts. It had been
		// true of every node type since the column was added, and nothing
		// compared the two directions until now.
		for (const t of [...allScriptTypes(), ...allTypes()]) {
			const [projected] = snapshotRegistry([t], { release: "test" })
			const pin = `${projected!.id}@${projected!.version}`
			const back = readBack.get(pin)
			expect(back, `${pin} did not come back`).toBeTruthy()
			expect(typeContentHash(back!), pin).toBe(
				typeContentHash(projected!)
			)
		}
	})
})
