/**
 * U2's acceptance criteria, as tests: sync is idempotent, a changed version
 * raises rather than publishing or ignoring, and install-time validation reads
 * the rows rather than the in-process descriptors.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import {
	syncDefinitionRegistry,
	readDefinitionRegistry
} from "$lib/server/pipelines/boot/registrySync"
import { saveDocument, loadDocument } from "$lib/server/pipelines/boot/store"
import type { Descriptor } from "@serene-pub/sdk"
import {
	S,
	allDefinitions,
	allScriptKinds,
	getScriptKind,
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
	// Skipped: this file counts what the sync inserted, and a pre-published
	// entry type would be a row it did not insert.
	db = await createTestDb({ skipEntryTypes: true })
}, 60_000)

describe("type registry sync", () => {
	it("seeds the registry from the core contracts", async () => {
		const r = await syncDefinitionRegistry(db, allDefinitions(), {
			release: "0.6.0"
		})
		expect(r.inserted.length).toBeGreaterThan(20)
		expect(r.inserted).toContain("core:oracle/generate-text@1")

		const rows = await db.select().from(schema.pipelineDefinitionRegistry)
		expect(rows.length).toBe(r.inserted.length)
	})

	it("is idempotent, which is why it can run unconditionally at boot", async () => {
		const again = await syncDefinitionRegistry(db, allDefinitions(), {
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
		const base = allDefinitions().find(
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
		const r = await syncDefinitionRegistry(db, [reworded], {
			release: "0.6.0"
		})
		expect(r.updated).toContain("core:query/session-history@1")

		const rows = await readDefinitionRegistry(db)
		// Registry entries carry the bare id; the version is its own column.
		const row = rows.find(
			(e) => `${e.id}@${e.version}` === "core:query/session-history@1"
		)! as any
		expect(row.slots.params.schema.limit.description).toBe(
			"Reworded after shipping."
		)

		// Put the original wording back so later assertions see the build's own.
		const restore = await syncDefinitionRegistry(db, [base], {
			release: "0.6.0"
		})
		expect(restore.updated).toContain("core:query/session-history@1")
	})

	it("moves the pointer when a published declaration's content changed", async () => {
		// This raised until the content-addressing ruling (2026-09-10), and the
		// refusal reached `bootstrapPipelines`, which returned early — so a
		// descriptor edit stopped every pipeline on an upgrading install and
		// the only way to ship one was a migration deleting rows.
		//
		// Built as a plain descriptor rather than through describeTaskDefinition,
		// because a type id may only be registered once per process (F5) — and
		// what this test simulates is core's *next build*, not a second
		// declaration in this one. The slug is one of the SDK's own `test:`
		// fixtures, published beside the contracts and bound by nothing here —
		// a declaration this file may move without any binding noticing.
		const drifted = {
			kind: "task",
			id: "test:task/sloppy-stream@1",
			timeoutMs: 5000,
			ports: {
				in: { main: S.textStream },
				out: { main: S.json, first: S.json }
			}
		} as unknown as Descriptor

		const before = (
			await db
				.select()
				.from(schema.pipelineDefinitionRegistry)
				.where(
					and(
						eq(
							schema.pipelineDefinitionRegistry.definitionId,
							"test:task/sloppy-stream"
						),
						eq(schema.pipelineDefinitionRegistry.version, 1)
					)
				)
		)[0]! as any

		const moved = await syncDefinitionRegistry(db, [drifted], {
			release: "0.6.1"
		})
		expect(moved.republished).toContain("test:task/sloppy-stream@1")

		// Idempotent from there: the same declaration a second time is not a
		// second pointer move.
		const again = await syncDefinitionRegistry(db, [drifted], {
			release: "0.6.1"
		})
		expect(again.republished).toEqual([])

		// And the declaration the pointer moved off is still resolvable, which
		// is the whole reason the refusal could be dropped.
		const archived = await db
			.select()
			.from(schema.pipelineDefinitionDeclarations)
			.where(
				eq(
					schema.pipelineDefinitionDeclarations.contentHash,
					before.contentHash
				)
			)
		expect(archived).toHaveLength(1)
	})

	it("a new version lands beside the old one rather than replacing it", async () => {
		const v2 = {
			kind: "task",
			id: "test:task/sloppy-stream@2",
			timeoutMs: 5000,
			ports: {
				in: { main: S.textStream },
				out: { main: S.json, first: S.json }
			}
		} as unknown as Descriptor
		const r = await syncDefinitionRegistry(db, [v2], { release: "0.6.1" })
		expect(r.inserted).toEqual(["test:task/sloppy-stream@2"])

		const registry = await readDefinitionRegistry(db)
		const versions = registry
			.filter((e) => e.id === "test:task/sloppy-stream")
			.map((e) => e.version)
			.sort()
		// The old version stays: specs that pinned @1 are still pinning @1, and
		// that is the whole contract.
		expect(versions).toEqual([1, 2])
	})

	it("checkInstall validates a stored document against the stored registry", async () => {
		const doc = compile(
			spec("chariot.demo:turn", { version: "1.0.0" })
				.inlet("input", C.userMessage.v1())
				.query("history", ($) =>
					C.sessionHistory.v1({ scope: $.input.sessionScope })
				)
				.task("prompt", ($) =>
					C.assemble.v2({ candidates: $.history.messages })
				)
				.oracle("generate", ($) =>
					C.generateText.v1({
						context: $.prompt.context,
						connection: slot.connection()
					})
				)
				.build()
		)
		const saved = await saveDocument(db, doc)
		const stored = await loadDocument(db, saved.specVersionId)

		const findings = checkInstall({
			declares: [],
			documents: [stored],
			registry: await readDefinitionRegistry(db)
		})
		expect(installable(findings), renderInstall(findings)).toBe(true)
	})

	it("a document compiled against a different release is refused by shape drift", async () => {
		// Every id still resolves. Only the shape moved — which is the failure a
		// version number alone does not catch, and the reason documents record
		// the shape each edge was compiled against.
		const doc = compile(
			spec("chariot.demo:stale", { version: "1.0.0" })
				.inlet("input", C.userMessage.v1())
				.query("history", ($) =>
					C.sessionHistory.v1({ scope: $.input.sessionScope })
				)
				.build()
		)
		doc.edges = doc.edges.map((e) => ({ ...e, shape: "core:shape/text@1" }))

		const findings = checkInstall({
			declares: [],
			documents: [doc],
			registry: await readDefinitionRegistry(db)
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
			.delete(schema.pipelineDefinitionRegistry)
			.where(
				and(
					eq(
						schema.pipelineDefinitionRegistry.definitionId,
						"core:query/relationships-perspectives"
					),
					eq(schema.pipelineDefinitionRegistry.version, 1)
				)
			)
		await syncDefinitionRegistry(db, allDefinitions(), { release: "test" })

		const [row] = await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(
				and(
					eq(
						schema.pipelineDefinitionRegistry.definitionId,
						"core:query/relationships-perspectives"
					),
					eq(schema.pipelineDefinitionRegistry.version, 1)
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
			.from(schema.pipelineDefinitionRegistry)
			.where(
				and(
					eq(
						schema.pipelineDefinitionRegistry.definitionId,
						"core:query/relationships-perspectives"
					),
					eq(schema.pipelineDefinitionRegistry.version, 1)
				)
			)
		await db
			.update(schema.pipelineDefinitionRegistry)
			.set({ optional: false })
			.where(eq(schema.pipelineDefinitionRegistry.id, before.id))

		await syncDefinitionRegistry(db, allDefinitions(), { release: "test" })

		const [after] = await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(eq(schema.pipelineDefinitionRegistry.id, before.id))
		expect(after.optional, "a stale column survived a boot").toBe(true)
		expect(after.contentHash, "the hash moved").toBe(before.contentHash)
	})

	it("leaves a genuinely non-optional type alone", async () => {
		const [row] = await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(
				and(
					eq(
						schema.pipelineDefinitionRegistry.definitionId,
						"core:query/session-history"
					),
					eq(schema.pipelineDefinitionRegistry.version, 1)
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

	const rowFor = async (definitionId: string) => {
		const [row] = await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(
				and(
					eq(schema.pipelineDefinitionRegistry.definitionId, definitionId),
					eq(schema.pipelineDefinitionRegistry.version, 1)
				)
			)
		return row
	}

	it("writes it on insert", async () => {
		// Deleted first, so this is the insert path rather than a row the heal
		// corrected — the mistake the `optional` test above records.
		await db
			.delete(schema.pipelineDefinitionRegistry)
			.where(
				and(
					eq(schema.pipelineDefinitionRegistry.definitionId, PIN),
					eq(schema.pipelineDefinitionRegistry.version, 1)
				)
			)
		await syncDefinitionRegistry(db, allDefinitions(), { release: "test" })

		const row = await rowFor(PIN)
		expect(row, "the row was not re-inserted").toBeTruthy()
		expect((row.i18n as any)?.name?.en).toBe(NAME)
	})

	it("fills in a row that predates the column, without changing its hash", async () => {
		const before = await rowFor(PIN)
		await db
			.update(schema.pipelineDefinitionRegistry)
			.set({ i18n: null })
			.where(eq(schema.pipelineDefinitionRegistry.id, before.id))

		await syncDefinitionRegistry(db, allDefinitions(), { release: "test" })

		const [after] = await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(eq(schema.pipelineDefinitionRegistry.id, before.id))
		expect(
			(after.i18n as any)?.name?.en,
			"a NULL name survived a boot, so every upgraded install keeps the invented one"
		).toBe(NAME)
		expect(after.contentHash, "the hash moved").toBe(before.contentHash)
	})

	it("picks up a rename, which is the promise that keeps it out of the hash", async () => {
		const before = await rowFor(PIN)
		await db
			.update(schema.pipelineDefinitionRegistry)
			.set({ i18n: { name: { en: "Something else entirely" } } })
			.where(eq(schema.pipelineDefinitionRegistry.id, before.id))

		await syncDefinitionRegistry(db, allDefinitions(), { release: "test" })

		const [after] = await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(eq(schema.pipelineDefinitionRegistry.id, before.id))
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
	const ALL = () => [...allDefinitions(), ...allScriptKinds()]

	const scriptRow = async (definitionId: string) => {
		const [row] = await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(
				and(
					eq(schema.pipelineDefinitionRegistry.definitionId, definitionId),
					eq(schema.pipelineDefinitionRegistry.version, 1)
				)
			)
		return row
	}

	it("projects all seven core contracts as rows of kind 'script'", async () => {
		await syncDefinitionRegistry(db, ALL(), { release: "test" })

		const rows = await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(eq(schema.pipelineDefinitionRegistry.kind, "script"))
		expect(rows.map((r: any) => r.definitionId).sort()).toEqual(
			allScriptKinds()
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
		const again = await syncDefinitionRegistry(db, ALL(), {
			release: "test"
		})
		expect(again.inserted).toEqual([])
		expect(again.updated).toEqual([])
	})

	it("republishes a moved script contract exactly as it republishes a node one", async () => {
		// One rule is the whole reason scripts share this path: a script type
		// that published differently from a node type would need its own
		// answer to every question this file asks.
		const before = await scriptRow("core:script:text/stop")
		await db
			.update(schema.pipelineDefinitionRegistry)
			.set({ contentHash: "stale-from-the-previous-build" })
			.where(eq(schema.pipelineDefinitionRegistry.id, before.id))

		const moved = await syncDefinitionRegistry(db, ALL(), { release: "test" })
		expect(moved.republished).toContain("core:script:text/stop@1")

		// The row is back on the build's own declaration, so the rest of this
		// file sees what it expects.
		expect((await scriptRow("core:script:text/stop")).contentHash).toBe(
			before.contentHash
		)
	})

	it("carries the blast radius as display text, out of the hash", async () => {
		const row = await scriptRow("core:script:messages/inject")
		expect((row.i18n as any)?.blastRadius?.en).toMatch(/additive/i)

		// Copyediting it must not be a contract change — the promise that lets
		// a warning be reworded without a version bump.
		const { definitionContentHash } = await import(
			"$lib/server/pipelines/boot/registrySync"
		)
		const [entry] = snapshotRegistry(
			[getScriptKind("core:script:messages/inject@1")!],
			{ release: "test" }
		)
		const reworded = definitionContentHash({
			...entry,
			i18n: { blastRadius: { en: "Something else entirely" } }
		} as any)
		expect(reworded).toBe(definitionContentHash(entry))
	})
})

/**
 * The row → entry read is lossless for the fields the hash depends on.
 *
 * ⚠ `readDefinitionRegistry` is what install-time validation reads, and it rebuilds a
 * `RegistryEntry` field by field — so a field added to the projection and not
 * to the reader silently disappears on the way back. For a *hashed* field that
 * is not a cosmetic loss: the same row would hash differently depending on
 * which direction it was travelling, and every script type would look
 * conflicted to anything that compared them.
 */
describe("the substrate's settings slot is projected, and self-corrects", () => {
	it("a row projected before R-9 gains the slot at the next boot, without its hash moving", async () => {
		// The upgrade case (2026-09-16): every install's rows for optional and
		// gated definitions predate the projected `settings` slot. The slot is
		// outside the hash on purpose, so this row is the shape the display
		// refresh handles — `updated`, never `republished` — and the panel
		// reads the switch from the row on the first boot after upgrading.
		const [before] = await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(
				and(
					eq(
						schema.pipelineDefinitionRegistry.definitionId,
						"core:query/world-lore"
					),
					eq(schema.pipelineDefinitionRegistry.version, 1)
				)
			)
		expect((before.slots as any).settings?.kind).toBe("settings")
		const { settings: _settings, ...authored } = before.slots as any
		await db
			.update(schema.pipelineDefinitionRegistry)
			.set({ slots: authored })
			.where(eq(schema.pipelineDefinitionRegistry.id, before.id))

		const r = await syncDefinitionRegistry(db, allDefinitions(), {
			release: "test"
		})
		expect(r.updated).toContain("core:query/world-lore@1")
		expect(r.republished).not.toContain("core:query/world-lore@1")

		const [after] = await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(eq(schema.pipelineDefinitionRegistry.id, before.id))
		expect((after.slots as any).settings?.schema?.enabled?.type).toBe("boolean")
		expect(after.contentHash, "the hash moved").toBe(before.contentHash)
	})

	it("a gated row carries `review` at the declaration's default", async () => {
		const [row] = await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(
				and(
					eq(
						schema.pipelineDefinitionRegistry.definitionId,
						"core:outlet/attach-image"
					),
					eq(schema.pipelineDefinitionRegistry.version, 1)
				)
			)
		expect((row.slots as any).settings?.schema?.review).toMatchObject({
			type: "enum",
			of: ["off", "on"],
			default: "on",
			facet: "review"
		})
	})
})

describe("a registry row round-trips through the reader", () => {
	it("returns the same content hash it was written with", async () => {
		await syncDefinitionRegistry(
			db,
			[...allDefinitions(), ...allScriptKinds()],
			{
				release: "test"
			}
		)
		const { definitionContentHash } = await import(
			"$lib/server/pipelines/boot/registrySync"
		)

		const readBack = new Map(
			(await readDefinitionRegistry(db)).map((e) => [
				`${e.id}@${e.version}`,
				e
			])
		)

		// Node types too, and they are the reason this is worth widening: the
		// asymmetry this caught — `public` coming back `false` where the
		// projection had `undefined` — was never about scripts. It had been
		// true of every node type since the column was added, and nothing
		// compared the two directions until now.
		for (const t of [...allScriptKinds(), ...allDefinitions()]) {
			const [projected] = snapshotRegistry([t], { release: "test" })
			const pin = `${projected!.id}@${projected!.version}`
			const back = readBack.get(pin)
			expect(back, `${pin} did not come back`).toBeTruthy()
			expect(definitionContentHash(back!), pin).toBe(
				definitionContentHash(projected!)
			)
		}
	})
})

/**
 * The registry statuses the sync writes (plans/29 R-2, 2026-09-17).
 *
 * `provisional` is the declaration's word — read off `Descriptor.provisional`,
 * carried in the row's `policy` (plans/31 V6: policy, outside the hash),
 * written on insert and healed on a row that predates the flag. `removed` is
 * the reverse-diff's: a `complete` sync marks every row of the
 * owner whose slug the build no longer publishes, keeps the row, dates it
 * once, and brings it back the day the slug is published again. A partial
 * sync — every other call in this file — withdraws nothing.
 */
describe("registry statuses (R-2)", () => {
	const statusOf = async (definitionId: string, version = 1) =>
		(
			await db
				.select({
					status: schema.pipelineDefinitionRegistry.status,
					removedAt: schema.pipelineDefinitionRegistry.removedAt
				})
				.from(schema.pipelineDefinitionRegistry)
				.where(
					and(
						eq(schema.pipelineDefinitionRegistry.definitionId, definitionId),
						eq(schema.pipelineDefinitionRegistry.version, version)
					)
				)
		)[0]

	it("writes provisional for a flagged declaration, live for the rest", async () => {
		await syncDefinitionRegistry(db, allDefinitions(), { release: "0.6.0" })
		expect((await statusOf("core:oracle/speak"))?.status).toBe("provisional")
		expect((await statusOf("core:oracle/mcp-tool"))?.status).toBe("provisional")
		expect((await statusOf("core:outlet/attach-image"))?.status).toBe("live")
		// The reader carries it back in the policy half, so the round trip is
		// lossless — and the hash never saw it.
		const back = (await readDefinitionRegistry(db)).find(
			(e) => `${e.id}@${e.version}` === "core:oracle/speak@1"
		)
		expect(back?.policy?.provisional).toBe(true)
	})

	it("heals a row written before the flag existed — a policy refresh, not a pointer move", async () => {
		await db
			.update(schema.pipelineDefinitionRegistry)
			.set({ status: "live", policy: null })
			.where(eq(schema.pipelineDefinitionRegistry.definitionId, "core:oracle/speak"))
		const result = await syncDefinitionRegistry(db, allDefinitions(), { release: "0.6.0" })
		expect((await statusOf("core:oracle/speak"))?.status).toBe("provisional")
		expect(result.republished).not.toContain("core:oracle/speak@1")
		const [row] = await db
			.select({ policy: schema.pipelineDefinitionRegistry.policy })
			.from(schema.pipelineDefinitionRegistry)
			.where(eq(schema.pipelineDefinitionRegistry.definitionId, "core:oracle/speak"))
		expect((row?.policy as any)?.provisional).toBe(true)
	})

	it("binding a provisional definition moves no pointer: the row's status and policy move, its hash stays", async () => {
		// V6's reversal of U6's choice, at the door that matters: the sync.
		const speak = allDefinitions().find((d) => d.id === "core:oracle/speak@1")!
		const { provisional: _p, ...bound } = speak
		const before = (await readDefinitionRegistry(db)).find(
			(e) => `${e.id}@${e.version}` === "core:oracle/speak@1"
		)
		const result = await syncDefinitionRegistry(db, [bound as any], { release: "0.6.0" })
		expect(result.republished).toEqual([])
		expect((await statusOf("core:oracle/speak"))?.status).toBe("live")
		const after = (await readDefinitionRegistry(db)).find(
			(e) => `${e.id}@${e.version}` === "core:oracle/speak@1"
		)
		expect(after?.policy?.provisional).toBeUndefined()
		const { definitionContentHash } = await import(
			"$lib/server/pipelines/boot/registrySync"
		)
		expect(definitionContentHash(after!)).toBe(definitionContentHash(before!))
		// Put the flag back for the tests that follow.
		await syncDefinitionRegistry(db, allDefinitions(), { release: "0.6.0" })
		expect((await statusOf("core:oracle/speak"))?.status).toBe("provisional")
	})

	it("a complete sync marks a slug the build no longer publishes removed — and only then", async () => {
		const all = allDefinitions()
		const without = all.filter((d) => d.id !== "core:outlet/attach-audio@1")

		// Partial: the same subset without `complete` withdraws nothing.
		const partial = await syncDefinitionRegistry(db, without, { release: "0.6.1" })
		expect(partial.removed).toEqual([])
		expect((await statusOf("core:outlet/attach-audio"))?.status).toBe("live")

		const culled = await syncDefinitionRegistry(db, without, {
			release: "0.6.1",
			complete: true
		})
		expect(culled.removed).toContain("core:outlet/attach-audio@1")
		const row = await statusOf("core:outlet/attach-audio")
		expect(row?.status).toBe("removed")
		expect(row?.removedAt).toBeTruthy()
		// Marked, never deleted — the row still answers by slug.
		expect(
			(await readDefinitionRegistry(db)).some(
				(e) => `${e.id}@${e.version}` === "core:outlet/attach-audio@1"
			)
		).toBe(true)

		// Dated once: a second complete sync neither re-reports nor re-dates.
		const again = await syncDefinitionRegistry(db, without, {
			release: "0.6.1",
			complete: true
		})
		expect(again.removed).toEqual([])
		expect((await statusOf("core:outlet/attach-audio"))?.removedAt).toEqual(row?.removedAt)

		// Published again: back to live, the date cleared.
		const restored = await syncDefinitionRegistry(db, all, {
			release: "0.6.1",
			complete: true
		})
		expect(restored.removed).toEqual([])
		const back = await statusOf("core:outlet/attach-audio")
		expect(back?.status).toBe("live")
		expect(back?.removedAt).toBeNull()
	})

	it("withdraws nothing when handed too few declarations to be a build", async () => {
		// A registry read before the contracts loaded, a hot reload that
		// re-evaluated half a module: "declares nothing" is never a build, and
		// culling every row on that evidence must not happen (U6 review, 3).
		const all = allDefinitions()
		const empty = await syncDefinitionRegistry(db, [], {
			release: "0.6.1",
			complete: true
		})
		expect(empty.removed).toEqual([])
		expect(empty.reverseDiffSkipped).toMatch(/too few to be a build/)
		expect((await statusOf("core:outlet/attach-audio"))?.status).toBe("live")

		const thin = await syncDefinitionRegistry(db, all.slice(0, 3), {
			release: "0.6.1",
			complete: true
		})
		expect(thin.removed).toEqual([])
		expect(thin.reverseDiffSkipped).toBeTruthy()
		expect((await statusOf("core:oracle/generate-text"))?.status).toBe("live")

		// Half or more IS a build: the diff runs, and reports nothing skipped.
		const most = await syncDefinitionRegistry(
			db,
			all.filter((d) => d.id !== "core:outlet/attach-audio@1"),
			{ release: "0.6.1", complete: true }
		)
		expect(most.reverseDiffSkipped).toBeUndefined()
		expect(most.removed).toContain("core:outlet/attach-audio@1")
		await syncDefinitionRegistry(db, all, { release: "0.6.1", complete: true })
		expect((await statusOf("core:outlet/attach-audio"))?.status).toBe("live")
	})

	it("an administrator's `deprecated` survives the cull and the restore", async () => {
		// `deprecated` is the one status no declaration carries (U6 review, 6):
		// the reverse-diff leaves the row alone and names it, and a later
		// sync — the same contract, or a moved one — never heals it to live.
		const all = allDefinitions()
		await db
			.update(schema.pipelineDefinitionRegistry)
			.set({ status: "deprecated" })
			.where(eq(schema.pipelineDefinitionRegistry.definitionId, "core:outlet/attach-audio"))

		const culled = await syncDefinitionRegistry(
			db,
			all.filter((d) => d.id !== "core:outlet/attach-audio@1"),
			{ release: "0.6.1", complete: true }
		)
		expect(culled.removed).not.toContain("core:outlet/attach-audio@1")
		expect(culled.deprecatedUnpublished).toEqual(["core:outlet/attach-audio@1"])
		expect((await statusOf("core:outlet/attach-audio"))?.status).toBe("deprecated")

		// Published again, same contract: still the administrator's word.
		const restored = await syncDefinitionRegistry(db, all, {
			release: "0.6.1",
			complete: true
		})
		expect(restored.deprecatedUnpublished).toEqual([])
		expect((await statusOf("core:outlet/attach-audio"))?.status).toBe("deprecated")

		// Published under a moved declaration — the pointer moves, the word stays.
		const base = all.find((d) => d.id === "core:outlet/attach-audio@1")! as any
		const moved = {
			...base,
			ports: { ...base.ports, out: { ...base.ports.out, extra: S.json } }
		}
		const republished = await syncDefinitionRegistry(db, [moved], { release: "0.6.2" })
		expect(republished.republished).toContain("core:outlet/attach-audio@1")
		expect((await statusOf("core:outlet/attach-audio"))?.status).toBe("deprecated")

		// Back to the build's own declaration and status for the tests after.
		await syncDefinitionRegistry(db, [base], { release: "0.6.1" })
		await db
			.update(schema.pipelineDefinitionRegistry)
			.set({ status: "live" })
			.where(eq(schema.pipelineDefinitionRegistry.definitionId, "core:outlet/attach-audio"))
	})

	it("the reverse-diff is scoped to the owner — a plugin's rows are not core's to withdraw", async () => {
		await db.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: "acme.demo:task/theirs",
			version: 1,
			kind: "task",
			ownerPluginId: 424242,
			transport: "process",
			ports: { in: {}, out: { main: "core:shape/json@1" } },
			slots: {}
		})
		await syncDefinitionRegistry(db, allDefinitions(), {
			release: "0.6.1",
			complete: true
		})
		expect((await statusOf("acme.demo:task/theirs"))?.status).toBe("live")
	})
})
