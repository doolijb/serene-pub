/**
 * Pipelines named by a string in a list that mixes genres carry their genre
 * beside the name (NOMENCLATURE §2, "Pipeline names"): every genre's reply
 * is "Reply", so the bare name reads alike four times — and a set of names
 * (`usedBy`) folds the four into one.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { eq, inArray } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { pipelineLabelsById } from "$lib/server/pipelines/entities/pipelineLabels"
import {
	createScript,
	scriptsView
} from "$lib/server/pipelines/entities/scripts"
import { libraryView } from "$lib/server/pipelines/config/library"
import { choiceSets } from "$lib/server/pipelines/config/panel/choices"
import { createPrompt } from "$lib/server/pipelines/entities/prompts"
import { promptPoolKeyFor } from "$lib/server/pipelines/entities/promptPool"

let db: TestDb

const REPLIES = [
	"core:spec/chat-respond",
	"core:spec/adventure-respond",
	"core:spec/guide-respond",
	"core:spec/lair-respond"
]

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
}, 60_000)

async function idOf(slug: string): Promise<number> {
	const [row] = await db
		.select({ id: schema.pipelineSpecs.id })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
	return row!.id
}

describe("pipelineLabelsById", () => {
	it("puts each genre's display name beside its Reply", async () => {
		const labels = await pipelineLabelsById(db)
		expect(labels.get(await idOf("core:spec/chat-respond"))).toBe(
			"Reply · Chat"
		)
		expect(labels.get(await idOf("core:spec/lair-respond"))).toBe(
			"Reply · Lair"
		)
		const replies = await Promise.all(
			REPLIES.map(async (s) => labels.get(await idOf(s)))
		)
		expect(new Set(replies).size).toBe(REPLIES.length)
	}, 60_000)

	it("leaves a pipeline every genre shares bare", async () => {
		const labels = await pipelineLabelsById(db)
		expect(labels.get(await idOf("core:spec/summarize-scene"))).toBe(
			"Summarize scene"
		)
	}, 60_000)
})

describe("payloads that name pipelines by a string", () => {
	it("the library's pipelines carry the label usedBy and origin name them by", async () => {
		const view = await libraryView(db)
		const chat = view.pipelines.find(
			(p) => p.slug === "core:spec/chat-respond"
		)!
		expect(chat.name).toBe("Reply")
		expect(chat.label).toBe("Reply · Chat")
	}, 60_000)

	it("a picker's \"from …\" names another genre's Reply with its genre", async () => {
		// Written while configuring Chat's Reply, offered in the Lair's: a
		// bare "from Reply" there would read as if it were written here.
		const chat = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/chat-respond"))
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const decl = (await declarations(db, chat[0]!.activeVersionId!)).find(
			(d) => d.nodeKey === "context" && d.control === "prompts-ref"
		)!
		const mine = await createPrompt(db, {
			nodeDefinitionId: decl.nodeDefinitionId!,
			slot: decl.slot,
			createdForSpecId: chat[0]!.id,
			name: "Written for Chat's reply",
			fields: { systemPrompt: "s", postHistoryInstructions: "p" }
		})
		const sets = await choiceSets(db, await idOf("core:spec/lair-respond"))
		const offered = sets.promptsBy
			.get(promptPoolKeyFor(decl.nodeDefinitionId!, decl.slot))!
			.find((c: any) => c.id === mine.id) as any
		expect(offered.group).toBe("alsoFits")
		expect(offered.description).toBe("from Reply · Chat")
	}, 60_000)

	it("two genres' Reply holding one script stay two pipelines in usedBy", async () => {
		const row = await createScript(db, {
			typeId: "core:script:text/transform@1",
			name: "Held by two replies"
		})
		const specs = await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(
				inArray(schema.pipelineSpecs.slug, [
					"core:spec/chat-respond",
					"core:spec/lair-respond"
				])
			)
		for (const spec of specs)
			await db.insert(schema.pipelineNodeOverrides).values({
				specId: spec.id,
				scopeKind: "session",
				nodeKey: "generate",
				slot: "scripts",
				path: "chain",
				value: [row.id]
			})

		const held = (await scriptsView(db)).scripts.find(
			(s) => s.id === row.id
		)!
		expect(held.usedBy).toEqual(["Reply · Chat", "Reply · Lair"])
	}, 60_000)
})
