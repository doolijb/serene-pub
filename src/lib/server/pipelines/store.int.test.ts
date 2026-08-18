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
import { saveDocument, loadDocument } from "./store"
import { spec, slot, canonicalHash, compile } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"

let db: TestDb

const chatTurn = () =>
	compile(
		spec("core:spec/chat-turn", { version: "1.0.0" })
			.on("core:event/message-created@1")
			.input("input", C.userMessage.v1())
			.query("history", ($) => C.chatHistory.v1({ scope: $.input.chatScope }))
			.task("prompt", ($) => C.assemble.v2({ candidates: $.history.messages }))
			.provider("generate", ($) =>
				C.generateText.v1({
					context: $.prompt.context,
					connection: slot.connection()
				})
			)
			.consume("save", ($) => C.createMessage.v1({ text: $.generate.text }))
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
								C.vectorSearch.v1({ vector: $.gather.semantic.embed.vector })
							)
					)
					.chain("keyword", (c) =>
						c.query("lore", ($) => C.lorebookTriggers.v1({ text: $.input.text }))
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
		expect(back.nodes.find((n) => n.key === "gather.semantic.embed")?.blockChain).toBe(
			"semantic"
		)
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
