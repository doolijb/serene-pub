/**
 * A pipeline running inside core, against real rows.
 *
 * This is the first point where the executor, the stored document, core's
 * bindings and the real database are all in the same test. What it proves is
 * narrow and worth stating exactly: a spec loaded from rows reads real chat
 * messages and writes a real one back, and the receipt describes what happened.
 *
 * It does not prove parity with the existing prompt path — nothing here builds
 * a prompt yet. `assemble` and `generate-text` deliberately halt, and one test
 * below asserts that they halt *legibly* rather than failing like a bug.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { saveDocument, loadDocument } from "$lib/server/pipelines/boot/store"
import { createHost, HostScopeError } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { spec, compile, run, slot } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"

let db: TestDb
let chatId: number
let userId: number

const readAndWrite = () =>
	compile(
		spec("core:spec/echo-turn", { version: "1.0.0" })
			.on("core:event/message-created@1")
			.input("input", C.userMessage.v1())
			.query("history", ($) =>
				C.chatHistory.v1({ scope: $.input.chatScope })
			)
			.consume("save", ($) => C.createMessage.v1({ text: $.input.text }))
			.build()
	)

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "pipeline-test", isAdmin: false })
		.returning()
	userId = user.id

	const [chat] = await db
		.insert(schema.chats)
		.values({ userId, isGroup: false })
		.returning()
	chatId = chat.id

	await db.insert(schema.chatMessages).values([
		{ chatId, role: "user", content: "first" },
		{ chatId, role: "assistant", content: "second" },
		{ chatId, role: "user", content: "hidden one", isHidden: true }
	])
}, 60_000)

describe("running a pipeline in core", () => {
	it("reads real messages and writes a real one back", async () => {
		const saved = await saveDocument(db as any, readAndWrite(), {
			publish: true
		})
		const doc = await loadDocument(db as any, saved.specVersionId)

		const receipt = await run(doc, {
			input: { text: "third", chatScope: { chatId } },
			seed: "seed:core",
			triggerSource: "event",
			bindings: coreBindings(),
			host: createHost(db as any, { chatId, userId })
		})

		expect(receipt.outcome).toBe("ok")

		const history = receipt.nodes.find((n) => n.nodeKey === "history")!
		expect(
			(history.output as any).messages.map((m: any) => m.content)
		).toEqual(["first", "second"])

		const rows = await db
			.select()
			.from(schema.chatMessages)
			.where(eq(schema.chatMessages.chatId, chatId))
		expect(rows.map((r) => r.content)).toContain("third")
	})

	it("a hidden message never reaches the pipeline", async () => {
		// Honoured in the host rather than in each binding, so a Query type added
		// later cannot forget it.
		const saved = await saveDocument(db as any, readAndWrite(), {
			publish: true
		})
		const doc = await loadDocument(db as any, saved.specVersionId)
		const receipt = await run(doc, {
			input: { text: "x", chatScope: { chatId } },
			seed: "seed:core",
			bindings: coreBindings(),
			host: createHost(db as any, { chatId, userId })
		})
		const history = receipt.nodes.find((n) => n.nodeKey === "history")!
		expect(JSON.stringify(history.output)).not.toContain("hidden one")
	})

	it("the write lands as a discriminated result carrying the real row id", async () => {
		const saved = await saveDocument(db as any, readAndWrite(), {
			publish: true
		})
		const doc = await loadDocument(db as any, saved.specVersionId)
		const receipt = await run(doc, {
			input: { text: "fourth", chatScope: { chatId } },
			seed: "seed:core",
			bindings: coreBindings(),
			host: createHost(db as any, { chatId, userId })
		})
		const save = receipt.nodes.find((n) => n.nodeKey === "save")!
		expect((save.output as any).status).toBe("committed")
		expect((save.output as any).ids.id).toBeTypeOf("number")
	})

	it("core emits the event the write causes — the node never does (F8)", async () => {
		const saved = await saveDocument(db as any, readAndWrite(), {
			publish: true
		})
		const doc = await loadDocument(db as any, saved.specVersionId)
		const receipt = await run(doc, {
			input: { text: "fifth", chatScope: { chatId } },
			seed: "seed:core",
			bindings: coreBindings(),
			host: createHost(db as any, { chatId, userId })
		})
		expect(receipt.emitted.map((e) => e.event)).toContain(
			"core:event/message-created@1"
		)
	})

	it("reading another chat is an error, not an empty result", async () => {
		// Returning [] would let a mis-scoped pipeline look like a working one with
		// a quiet chat, and "the bot forgot everything" points at retrieval rather
		// than at permissions.
		const host = createHost(db as any, { chatId, userId })
		await expect(
			host.read!(
				"chat_messages",
				{ chatId: chatId + 999 },
				{
					key: "history",
					typeId: "core:query/chat-history",
					typeVersion: 1,
					kind: "query"
				}
			)
		).rejects.toThrow(HostScopeError)
	})

	it("an unbound type halts with a reason rather than failing like a bug", async () => {
		const doc = compile(
			spec("core:spec/needs-assemble", { version: "1.0.0" })
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
		const receipt = await run(doc, {
			input: { text: "x", chatScope: { chatId } },
			seed: "seed:core",
			bindings: coreBindings(),
			host: createHost(db as any, { chatId, userId })
		})

		expect(receipt.outcome).toBe("halt")
		// Assemble is bound now, so the run gets one node further and stops at the
		// Provider. The message says what is missing and what it is waiting on,
		// because for the next two releases this is a state the app is
		// legitimately in.
		expect(receipt.haltNodeKey).toBe("prompt")
		expect(receipt.haltReason).toMatch(/assemble has no template/)
	})

	it("assemble halts legibly when the context config did not resolve", async () => {
		// A missing template is a configuration problem, not a crash, and the
		// difference decides whether a user opens settings or files a bug.
		const { coreBindings: bindings } = await import("$lib/server/pipelines/runtime/bindings")
		const result: any = await bindings()["core:task/assemble@2"]!(
			{ decisions: [], budget: { total: 100 } },
			{} as any
		)
		expect(result.kind).toBe("halt")
		expect(result.reason).toMatch(/nothing to render into/)
	})

	it("assemble renders once a template resolves", async () => {
		const { coreBindings: bindings } = await import("$lib/server/pipelines/runtime/bindings")
		const result: any = await bindings()["core:task/assemble@2"]!(
			{
				template: {
					source: "{{#each chatMessages}}{{this.content}}{{/each}}"
				},
				decisions: [],
				messages: [{ id: 1, role: "user", content: "hello" }],
				budget: { total: 100 }
			},
			{} as any
		)
		expect(result.kind).toBe("ok")
		expect(result.value.context.rendered).toBe("hello")
	})

	it("replay reproduces the run without touching the database again", async () => {
		const saved = await saveDocument(db as any, readAndWrite(), {
			publish: true
		})
		const doc = await loadDocument(db as any, saved.specVersionId)
		const first = await run(doc, {
			input: { text: "sixth", chatScope: { chatId } },
			seed: "seed:replay",
			bindings: coreBindings(),
			host: createHost(db as any, { chatId, userId })
		})

		const before = await db
			.select()
			.from(schema.chatMessages)
			.where(eq(schema.chatMessages.chatId, chatId))

		const { replay } = await import("@serene-pub/sdk")
		const again = await replay(doc, first, coreBindings())

		const after = await db
			.select()
			.from(schema.chatMessages)
			.where(eq(schema.chatMessages.chatId, chatId))

		expect(again.outcome).toBe("ok")
		// The point of C5: a replay explains a run, it does not re-run it. A
		// replay that wrote a second message would make the inspector unusable on
		// exactly the runs people most want to inspect.
		expect(after.length).toBe(before.length)
	})
})
