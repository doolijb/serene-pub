/**
 * C1 against real rows: `import(export(rows))` is the identity and the hash is
 * stable.
 *
 * The SDK asserts this over in-memory documents already. This file asserts it
 * over the column mapping, which is where it actually breaks — a dropped
 * `blockChain`, a preset value that comes back as a string, an edge whose port
 * survived but whose shape did not. None of those fail a unit test and all of
 * them make an exported pipeline behave differently on the far side.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { saveDocument, loadDocument } from "$lib/server/pipelines/boot/store"
import { spec, slot, canonicalHash, compile } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"

let db: TestDb

const chatTurn = () =>
	compile(
		spec("core:spec/chat-turn", { version: "1.0.0" })
			.on("core:event/message-created@1")
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
			.consume("save", ($) =>
				C.createMessage.v1({ text: $.generate.text })
			)
			.preset("balanced", { label: "Balanced", default: true }, (p) =>
				p.params("history", { limit: 40 })
			)
			.build()
	)

/** Exercises the parts the simple chain does not: nesting, a bounded loop, a map. */
const agentic = () =>
	compile(
		spec("core:spec/agentic", { version: "0.2.0" })
			.input("input", C.userMessage.v1())
			.async("gather", { mode: "parallel" }, (b) =>
				b
					.chain("semantic", (c) =>
						c
							.provider("embed", ($) =>
								C.embedText.v1({
									text: $.input.text,
									connection: slot.connection()
								})
							)
							.query("vsearch", ($) =>
								C.vectorSearch.v1({
									vector: $.gather.semantic.embed.vector
								})
							)
					)
					.chain("keyword", (c) =>
						c.query("lore", ($) =>
							C.lorebookTriggers.v1({ text: $.input.text })
						)
					)
			)
			.build()
	)

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

describe("pipeline store", () => {
	it("round-trips a chat turn without changing its hash (C1)", async () => {
		const doc = chatTurn()
		const before = canonicalHash(doc)

		const saved = await saveDocument(db as any, doc, { publish: true })
		const back = await loadDocument(db as any, saved.specVersionId)

		expect(canonicalHash(back)).toBe(before)
		expect(back).toEqual(doc)
	})

	it("round-trips nested blocks, which is where the mapping actually breaks", async () => {
		const doc = agentic()
		const saved = await saveDocument(db as any, doc)
		const back = await loadDocument(db as any, saved.specVersionId)

		expect(canonicalHash(back)).toBe(canonicalHash(doc))
		// Named explicitly because losing either is silent: the block's members
		// still run, they just stop being attributable to their chain.
		expect(
			back.nodes.find((n) => n.key === "gather.semantic.embed")
				?.blockChain
		).toBe("semantic")
		expect(back.blocks[0]?.chains).toEqual(["semantic", "keyword"])
	})

	it("stores presets as rows and returns them intact (F4)", async () => {
		const doc = chatTurn()
		const saved = await saveDocument(db as any, doc)
		const back = await loadDocument(db as any, saved.specVersionId)

		expect(back.presets[0]?.slug).toBe("balanced")
		expect(back.presets[0]?.default).toBe(true)
		// The value came back a number, not "40". A preset that round-trips its
		// types loosely is a pipeline that behaves differently after an export.
		expect(back.presets[0]?.values[0]?.value).toEqual({ limit: 40 })
	})

	it("re-saving a semver replaces that version rather than duplicating it", async () => {
		const doc = chatTurn()
		const first = await saveDocument(db as any, doc)
		const second = await saveDocument(db as any, doc)

		expect(second.specId).toBe(first.specId)
		const versions = await db
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.specId, first.specId))
		expect(versions.filter((v) => v.semver === "1.0.0")).toHaveLength(1)
	})

	it("the database refuses a sixth kind (F1)", async () => {
		const doc = chatTurn()
		const saved = await saveDocument(db as any, doc)
		await expect(
			db.insert(schema.pipelineNodes).values({
				specVersionId: saved.specVersionId,
				nodeKey: "rogue",
				kind: "agent",
				typeId: "demo:agent/rogue",
				typeVersion: 1,
				config: {},
				position: 99
			})
		).rejects.toThrow()
	})

	it("the database refuses an unbounded repeat (F9)", async () => {
		const doc = chatTurn()
		const saved = await saveDocument(db as any, doc)
		await expect(
			db.insert(schema.pipelineBlocks).values({
				specVersionId: saved.specVersionId,
				blockId: "forever",
				kind: "loop",
				max: null,
				position: 0
			})
		).rejects.toThrow()
	})

	it("an edge to a node the version does not contain is refused before it is written", async () => {
		const doc = chatTurn()
		doc.edges.push({
			from: "generate",
			fromPort: "text",
			to: "nowhere",
			toPort: "text"
		})
		await expect(saveDocument(db as any, doc)).rejects.toThrow(
			/references a node this version does not contain/
		)
	})
})

/**
 * An async block is configurable, and the control comes from the SDK.
 *
 * Whether chains run together is the author's default and the administrator's
 * decision — the same precedence `review` uses, and for the same reason: the
 * person who knows the provider is rate-limited is not the person who wrote the
 * spec. No core pipeline declares an async block yet, so without a synthetic
 * one this whole path would ship unexercised.
 */
describe("an async block offers its mode", () => {
	// Published here rather than leaning on another test having run: the
	// agentic fixture is saved inside one, and a suite whose setup is another
	// suite's side effect passes or fails on ordering.
	let versionId: number
	beforeAll(async () => {
		const saved = await saveDocument(db as any, agentic(), { publish: true })
		versionId = saved.specVersionId
	})

	it("declares one option per async block, addressed by the block's id", async () => {
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const { BLOCK_MODE_DECL } = await import("@serene-pub/sdk")

		const decls = await declarations(db as any, versionId)

		const mode = decls.find(
			(d) => d.nodeKey === "gather" && d.path === "mode"
		)
		expect(mode, "the async block declared no mode option").toBeTruthy()
		expect(mode!.control).toBe("enum")
		expect(mode!.of).toEqual(BLOCK_MODE_DECL.of)
		// The author's declaration is the default the panel shows as inherited.
		expect(mode!.authorDefault).toBe("parallel")
		// Addressed by block id, which is what `resolveConfig` is handed — a
		// value written anywhere else never reaches the executor.
		expect(mode!.slot).toBe("settings")
	})

	it("offers nothing for a map block", async () => {
		// A map's mode is a property of what it iterates, not a choice about
		// concurrency — a control whose effect nobody could predict from its
		// label is worse than no control.
		//
		// Its own spec, because the agentic fixture declares only an async
		// block: iterating its blocks and skipping the async one left nothing
		// to assert, and the test passed while a mutation that offered a mode
		// on *every* block sailed through it.
		const mapped = compile(
			spec("core:spec/mapped", { version: "0.1.0" })
				.input("input", C.userMessage.v1())
				.query("history", ($) =>
					C.chatHistory.v1({ scope: $.input.chatScope })
				)
				.map(
					"each",
					{ over: ($: any) => $.history.messages, max: 4 },
					(m) =>
						m.provider("draft", ($: any) =>
							C.generateText.v1({
								context: $.input.text,
								connection: slot.connection()
							})
						)
				)
				.build()
		)
		const saved = await saveDocument(db as any, mapped, { publish: true })

		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const decls = await declarations(db as any, saved.specVersionId)
		const blocks = (await db
			.select()
			.from(schema.pipelineBlocks)
			.where(
				eq(schema.pipelineBlocks.specVersionId, saved.specVersionId)
			)) as any[]

		const nonAsync = blocks.filter((b) => b.kind !== "async")
		expect(
			nonAsync.length,
			"nothing to test against — the fixture declares no map block"
		).toBeGreaterThan(0)
		for (const b of nonAsync)
			expect(
				decls.some(
					(d) => d.nodeKey === b.blockId && d.path === "mode"
				),
				`${b.kind} block '${b.blockId}' offered a mode`
			).toBe(false)
	})
})
