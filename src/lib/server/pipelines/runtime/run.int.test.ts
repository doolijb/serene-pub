/**
 * A pipeline running inside core, against real rows.
 *
 * This is the first point where the executor, the stored document, core's
 * bindings and the real database are all in the same test. What it proves is
 * narrow and worth stating exactly: a spec loaded from rows reads real session
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
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { spec, compile, run, slot } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"

let db: TestDb
let sessionId: number
let userId: number

const readAndWrite = () =>
	compile(
		spec("core:spec/echo-turn", { version: "1.0.0" })
			.on("core:event/message-created@1")
			.input("input", C.userMessage.v1())
			.query("history", ($) =>
				C.sessionHistory.v1({ scope: $.input.sessionScope })
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

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	sessionId = session.id

	await db.insert(schema.sessionMessages).values([
		{ sessionId, role: "user", content: "first" },
		{ sessionId, role: "assistant", content: "second" },
		{ sessionId, role: "user", content: "hidden one", isHidden: true }
	])
}, 60_000)

describe("running a pipeline in core", () => {
	it("reads real messages and writes a real one back", async () => {
		const saved = await saveDocument(db as any, readAndWrite(), {
			publish: true
		})
		const doc = await loadDocument(db as any, saved.specVersionId)

		const receipt = await run(doc, {
			input: { text: "third", sessionScope: { sessionId } },
			seed: "seed:core",
			triggerSource: "event",
			bindings: coreBindings(),
			host: createHost(db as any, { sessionId, userId })
		})

		expect(receipt.outcome).toBe("ok")

		const history = receipt.nodes.find((n) => n.nodeKey === "history")!
		expect(
			(history.output as any).messages.map((m: any) => m.content)
		).toEqual(["first", "second"])

		const rows = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
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
			input: { text: "x", sessionScope: { sessionId } },
			seed: "seed:core",
			bindings: coreBindings(),
			host: createHost(db as any, { sessionId, userId })
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
			input: { text: "fourth", sessionScope: { sessionId } },
			seed: "seed:core",
			bindings: coreBindings(),
			host: createHost(db as any, { sessionId, userId })
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
			input: { text: "fifth", sessionScope: { sessionId } },
			seed: "seed:core",
			bindings: coreBindings(),
			host: createHost(db as any, { sessionId, userId })
		})
		expect(receipt.emitted.map((e) => e.event)).toContain(
			"core:event/message-created@1"
		)
	})

	it("reading another session is an error, not an empty result", async () => {
		// Returning [] would let a mis-scoped pipeline look like a working one with
		// a quiet session, and "the bot forgot everything" points at retrieval rather
		// than at permissions.
		const host = createHost(db as any, { sessionId, userId })
		await expect(
			host.read!(
				"session_messages",
				{ sessionId: sessionId + 999 },
				{
					key: "history",
					typeId: "core:query/session-history",
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
		const receipt = await run(doc, {
			input: { text: "x", sessionScope: { sessionId } },
			seed: "seed:core",
			bindings: coreBindings(),
			host: createHost(db as any, { sessionId, userId })
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
		const { coreBindings: bindings } = await import(
			"$lib/server/pipelines/runtime/bindings"
		)
		const result: any = await bindings()["core:task/assemble@2"]!(
			{ decisions: [], budget: { total: 100 } },
			{} as any
		)
		expect(result.kind).toBe("halt")
		expect(result.reason).toMatch(/nothing to render into/)
	})

	it("assemble renders once a template resolves", async () => {
		const { coreBindings: bindings } = await import(
			"$lib/server/pipelines/runtime/bindings"
		)
		const result: any = await bindings()["core:task/assemble@2"]!(
			{
				// Source AND engine. A resolved template row carries both —
				// `world.ts`'s `pushTemplate` emits the pair or neither — and
				// the binding halts on a source with no engine rather than
				// rendering it as Handlebars on a guess, which is what used to
				// happen to every template on every install.
				template: {
					source: "{{#each sessionMessages}}{{this.content}}{{/each}}",
					engine: CORE_TEMPLATE_ENGINE
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
			input: { text: "sixth", sessionScope: { sessionId } },
			seed: "seed:replay",
			bindings: coreBindings(),
			host: createHost(db as any, { sessionId, userId })
		})

		const before = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))

		const { replay } = await import("@serene-pub/sdk")
		const again = await replay(doc, first, coreBindings())

		const after = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))

		expect(again.outcome).toBe("ok")
		// The point of C5: a replay explains a run, it does not re-run it. A
		// replay that wrote a second message would make the inspector unusable on
		// exactly the runs people most want to inspect.
		expect(after.length).toBe(before.length)
	})
})
