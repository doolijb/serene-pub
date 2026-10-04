/**
 * Forms, over the real handlers (plans/29 R-15 *Forms* · *The line*; R-21
 * (5); 09-B B9, F39; plans/30 U5d, 2026-09-17).
 *
 * What is pinned, every one through `sessions:fireAction` and the runs
 * it starts — never `runSpec` directly:
 *
 *  1. **A spec writes a choices block.** The message gains ONE `core:blocks`
 *     part; every option carries the writing spec's stamped identity, the
 *     block an id and its addressee; the row's text is announced with its
 *     parts.
 *  2. **The addressee is the audience.** The guest whose persona the block
 *     is addressed to answers by clicking — `blockId` + `{ choice }` — and
 *     the run fires; another guest, and the owner, are refused with the
 *     sentence; `form-answered` lands in the session's changes with
 *     `answeredBy: 'click'`. A person addressee: **no event, no child run**.
 *  3. **Elara asks Tom.** Tom is a cast character nobody portrays. The
 *     asking run writes the block; `form-addressed` is dispatched **after
 *     its receipt is saved**; `core:spec/answer-form-chat` runs as its child
 *     (`parent_run_id`, depth 1) with a fake JSON oracle answering one
 *     option; `answer-form` **collects** the fire and the host dispatches it
 *     after the answer's receipt (review W2) — the block's action runs as
 *     Tom, a grandchild at depth 2, exactly as the click did; the answer's
 *     receipt names `firedAction` and the child's run id; `form-answered`
 *     is recorded with `answeredBy: 'oracle'` and the next reply's inlet
 *     sees it. A grandchild parked at review parks nothing in the answer
 *     run: it ends `ok`, and resolving the review lands the line.
 *  4. **The cycle guard.** An action that always re-asks: the tree parks
 *     at depth 4 for the session owner (E1c's cap pause) — Continue runs
 *     one more window and parks again, Stop here receipts the parked run as
 *     `cancelled` naming the cap; nothing loops unasked.
 *     The descendants cap reached at the **fire door** (W1) is a receipted
 *     halt too — the would-be child's row, lineage filled, the routed spec
 *     named — and the answer run halts on the cap; an oracle's answer that
 *     misses the form halts the answer run, never errs it.
 *  5. **The line.** A `world` action in a `message` venue is refused at
 *     `saveDocument`; so is one whose `act` audience names a participant; a
 *     block naming a `world` action is refused at the write — its own
 *     spec's or another's named by identity (S6); `answer-form`'s road
 *     (`fireAction` with `as`) refuses a `world` action; a person's press on
 *     a legacy block (no identity) is held to the routed spec's governing
 *     action (W6).
 *  6. **The click path is unchanged** for a block with no addressee — the
 *     U5c test next door still holds — and a fire that lies about the block
 *     is refused.
 *  7. **The review's rulings (2026-09-17).** The oracle's answer uses the
 *     answer run's PINNED portrayals — a member joining as Tom mid-answer
 *     does not flip it (W3); a form put to nobody here is the owner's to
 *     answer (W4); a `choices` press is normalised to `{ choice }` and a
 *     `form` press is checked against its fields (W5); every option of an
 *     addressed question must be stamped (W6); a form is answered ONCE —
 *     the block carries `answered` and a second press is refused naming who
 *     (W7); a `form`-venue action is listed nowhere and the block's fire
 *     still resolves it (S1); a block naming another spec's action with the
 *     wrong function is refused at the write (S2); the click's ack carries
 *     the tree's progress (S4); an update's blocks replace the row's (S5).
 *  8. **The fix pass (2026-09-17).** A parked run releases the press (R-b):
 *     the ack says `parked`, the session's trigger lock is free for the
 *     next trigger, and approving lands the line — whether the parked run
 *     is a grandchild the answer fired or the pressed action itself, whose
 *     outcome then arrives as pushes. Every fire leaves a row under the id
 *     the answer's receipt named (W-a): stopped before it started is
 *     `cancelled` with the actor and reason, a throw on the way is a halt
 *     on the sentence. A cap refusal's row lands after the parent's (S-b).
 *  9. **Staleness and order (R-15; plans/30 U5f, 2026-09-17).** A block
 *     carries the channel head it was issued at (`head` = its own row for a
 *     fresh write); a line landing on the channel stales it — the holder's
 *     press is refused as *overtaken*, `form-superseded` is recorded once
 *     and a second press adds none; a block answered before the head moved
 *     stays answered; an AI-addressed answer dispatched after the head moved
 *     halts at the door on the same sentence, receipted; a line on another
 *     lane of the channel stales nothing (the head is lane-scoped); **an
 *     answer to a form on a row does not move on from that row** — the
 *     answer's line carries `metadata.answersForm`, the staleness head
 *     leaves it out, so three questions to three AI characters on one row
 *     are all answered and a second form on a row is still open after the
 *     first was answered — while any other line still supersedes every open
 *     form on the row.
 */
import { TURN_ORDER_BY_GENRE } from "@serene-pub/core-catalog"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import type { MessageBlock, SpecDocument } from "@serene-pub/sdk"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "forms-test-secret" }
})

/**
 * The model, faked: every generating step gets the same JSON document back,
 * `{"choice":"maybe"}` — what the answer pipeline's oracle is asked for. The
 * asking specs below write their blocks as literals and call no model, so
 * the fake speaks only when Tom is answering.
 */
let modelAnswer = '{"choice":"maybe"}'
/** Answers taken in order before `modelAnswer` — for a tree whose forms answer differently. */
let modelAnswers: string[] = []
/** Something a test wants done WHILE the oracle is answering — a member joining, say. */
let midAnswer: (() => Promise<void>) | null = null
let modelCalls = 0
class FakeAdapter implements FakeTextAdapter {
	injected: any
	promptBuilder: any = {}
	constructor(_p: any) {}
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	abort() {}
	async generateText() {
		modelCalls++
		const answer = modelAnswers.length ? modelAnswers.shift()! : modelAnswer
		if (midAnswer) {
			const hook = midAnswer
			midAnswer = null
			await hook()
		}
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent(answer)
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))
vi.mock("$lib/server/utils/resolveTaskConfig", () => ({
	resolveTaskConfig: async () => ({
		connection: { id: 1, type: "koboldcpp", promptFormat: "vicuna" },
		sampling: { id: 1 }
	})
}))
vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const real = await importOriginal<
		typeof import("$lib/server/connections/capabilityTarget")
	>()
	return {
		...real,
		resolveCapabilityTarget: async (
			db: Db,
			req: Parameters<typeof real.resolveCapabilityTarget>[1]
		) => {
			const target = await real.resolveCapabilityTarget(db, req)
			if (target.ok) return target
			return {
				ok: true,
				capability: req.capability,
				connection: { id: 1, type: "koboldcpp", promptFormat: "vicuna" },
				sampling: { id: 1 },
				connectionVia: "pipelineConfig",
				samplingVia: "pipelineConfig"
			}
		}
	}
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

const CHAT = "core:genre/chat"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-forms-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number) {
	return {
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
const noopEmit = () => {}

async function character(userId: number, name: string, isPersona = false) {
	const schema = await import("$lib/server/db/schema")
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: name, isPersona })
		.returning()
	return row!.id
}

/** A chat session with an owner, a guest, and a cast character Tom nobody portrays. */
async function sessionWithTom(tag: string) {
	const schema = await import("$lib/server/db/schema")
	const owner = await makeUser(`${tag}-owner`)
	const guest = await makeUser(`${tag}-guest`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, genreId: CHAT })
		.returning()
	await testDb.insert(schema.sessionGuests).values({ sessionId: session!.id, userId: guest.id })
	const tom = await character(owner.id, `Tom ${tag}`)
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId: session!.id, characterId: tom, isActive: true })
	return { owner, guest, session: session!, tom }
}

/**
 * A pair of fixture specs under `core:` (the chat genre's companions): `ask`
 * writes a narration row carrying the block list it was built with, `answer`
 * is what the block's options fire and writes a line as the answerer. Two
 * specs, because a spec has one graph and asking and answering are two.
 */
type Ids = { answerFn: string; answerAction: string }

async function publishAskAndAnswer(
	tag: string,
	blocks: (ids: Ids) => MessageBlock[],
	opts: {
		answerBlocks?: (ids: Ids) => MessageBlock[]
		/** Answer's venue — the shipped shape is `form` (review S1); `message` is the pre-review one. */
		answerVenue?: "form" | "message"
		/** Extra actions declared on the ask spec. */
		askActions?: Array<Record<string, unknown>>
		/** A literal line for Answer to write instead of the chosen option's label. */
		answerText?: string
		/**
		 * The oracle's document, as a literal: Ask then reads the cast and
		 * resolves the addressee through `make-choices@1` — the Adventure
		 * narrator's road — instead of writing `blocks` verbatim.
		 */
		askJson?: { addressee?: string; question: string; options: Array<{ key: string; label: string }> }
		/**
		 * A line Answer writes BEFORE its `save` (lair pass R9): a run that
		 * wrote something before its gate — so a reject at that gate still
		 * leaves an effect behind.
		 */
		answerFirst?: string
		/** What Answer collects (R3), for a form-venue action's collect modal (R9). */
		answerCollects?: Record<string, unknown>
	} = {}
) {
	const { spec, compile } = await import("@serene-pub/sdk")
	const C = await import("@serene-pub/contracts")
	const { chatGenre } = await import("@serene-pub/core-catalog")
	const { saveDocument } = await import("$lib/server/pipelines/boot/store")
	const askId = `core:spec/test-${tag}-ask`
	const answerId = `core:spec/test-${tag}-answer`
	const askFn = `${tag}-ask`
	const answerFn = `${tag}-answer`
	// Ask's options point at Answer's declaration on purpose (the Adventure
	// genre's own shape): the host holds them to the installed declaration.
	const ids: Ids = { answerFn, answerAction: `${answerId}#${answerFn}` }
	const askBuilder = spec(askId, {
		version: "1.0.0",
		taxonomy: { role: "action"},
		contributes: {
			actions: [
				{
					key: askFn,
					venue: { kind: "composer" },
					label: { en: "Ask" },
					description: { en: "A test action." }
				},
				...((opts.askActions ?? []) as any[])
			]
		}
	}).inlet("input", C.userMessage.v1(), {
		genre: chatGenre,
		event: "core:event/session-action@1"
	})
	const ask: SpecDocument = compile(
		opts.askJson
			? askBuilder
					.query("cast", ($) => C.sessionCast.v1({ scope: $.input.sessionScope }))
					.task("choices", ($) =>
						C.makeChoices.v1({
							json: opts.askJson as any,
							fn: answerFn,
							action: ids.answerAction,
							cast: $.cast.cast
						})
					)
					.outlet("save", ($) =>
						C.createMessage.v1({
							narration: true,
							text: $.choices.text,
							blocks: $.choices.blocks
						})
					)
					.build()
			: askBuilder
					.outlet("save", () =>
						C.createMessage.v1({
							narration: true,
							text: "Will you come to the festival?",
							blocks: blocks(ids) as any
						})
					)
					.build()
	)
	const answerBuilder = spec(answerId, {
		version: "1.0.0",
		taxonomy: { role: "action"},
		contributes: {
			actions: [
				{
					key: answerFn,
					venue: { kind: opts.answerVenue ?? "form" },
					audience: { see: ["participant"], act: ["participant"] },
					...(opts.answerCollects ? { collects: opts.answerCollects } : {}),
					label: { en: "Answer" },
					description: { en: "A test action." }
				}
			]
		}
	}).inlet("input", C.userMessage.v1(), {
		genre: chatGenre,
		event: "core:event/session-action@1"
	})
	const answer: SpecDocument = compile(
		opts.answerBlocks
			? answerBuilder
					.outlet("save", () =>
						C.createMessage.v1({
							narration: true,
							text: "And again?",
							blocks: opts.answerBlocks!(ids) as any
						})
					)
					.build()
			: opts.answerText !== undefined
				? answerBuilder
						.task("answer", ($) => C.readAnswer.v1({ payload: $.input.payload, form: $.input.form }))
						.outlet("save", ($) =>
							C.createMessage.v1({
								text: opts.answerText!,
								characterId: $.answer.characterId,
								speaker: $.answer.addressee
							})
						)
						.build()
				: opts.answerFirst !== undefined
					? answerBuilder
							.task("answer", ($) => C.readAnswer.v1({ payload: $.input.payload, form: $.input.form }))
							.outlet("said", () => C.createMessage.v1({ narration: true, text: opts.answerFirst! }))
							.outlet("save", ($) =>
								C.createMessage.v1({
									text: $.answer.label,
									characterId: $.answer.characterId,
									speaker: $.answer.addressee
								})
							)
							.build()
					: answerBuilder
							.task("answer", ($) => C.readAnswer.v1({ payload: $.input.payload, form: $.input.form }))
							.outlet("save", ($) =>
								C.createMessage.v1({
									text: $.answer.label,
									characterId: $.answer.characterId,
									speaker: $.answer.addressee
								})
							)
							.build()
	)
	const batch = new Set([askId, answerId])
	await saveDocument(testDb as any, ask, { publish: true, batch })
	await saveDocument(testDb as any, answer, { publish: true, batch })
	return { askId, answerId, askFn, answerFn }
}

const festival = (addressee: string) => (ids: Ids): MessageBlock[] => [
	{
		kind: "choices",
		addressee: addressee as any,
		question: "Will you come to the festival?",
		actions: [
			{ fn: ids.answerFn, action: ids.answerAction, label: "Yes", choice: "yes" },
			{ fn: ids.answerFn, action: ids.answerAction, label: "Maybe", choice: "maybe" },
			{ fn: ids.answerFn, action: ids.answerAction, label: "No", choice: "no" }
		]
	}
]

async function fire(userId: number, params: Record<string, unknown>) {
	const { sessionsFireActionHandler } = await import("./sessions")
	return sessionsFireActionHandler.handler(fakeSocket(userId), params as any, noopEmit)
}

/**
 * The runs a session produced — **excluding the turn-order recompute**.
 *
 * Since PLAN-turn-order A6 every session event runs its genre's turn-order spec:
 * five reads and a `jsonb_set`, no model, no message. It is a real run and
 * it is on this table, but it is not what any assertion in this file is
 * about — the form road is — and listing it in every expected array would
 * say "a form was asked, and also the order was recomputed" over and over.
 * The recompute has its own tests (`turnStrategies.test.ts`,
 * `sessionEvents.emit.int.test.ts`).
 */
// Every genre's own (R27): core's six turn-order specs, from the table the
// catalog publishes them by.
const TURN_ORDER_SPECS = new Set(TURN_ORDER_BY_GENRE.map((t) => t.spec))

async function runsOf(sessionId: number) {
	return (await allRunsOf(sessionId)).filter(
		(r) => !TURN_ORDER_SPECS.has(r.specSlug ?? "")
	)
}

async function allRunsOf(sessionId: number) {
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select({
			runId: schema.pipelineRuns.runId,
			specSlug: schema.pipelineRuns.specSlug,
			outcome: schema.pipelineRuns.outcome,
			haltReason: schema.pipelineRuns.haltReason,
			parentRunId: schema.pipelineRuns.parentRunId,
			rootRunId: schema.pipelineRuns.rootRunId,
			depth: schema.pipelineRuns.depth,
			receipt: schema.pipelineRuns.receipt
		})
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
		.orderBy(asc(schema.pipelineRuns.id))
}

/** The newest narration row's block tree — what the asking spec wrote. */
async function lastBlockTree(sessionId: number) {
	const schema = await import("$lib/server/db/schema")
	const { blockTreesOf } = await import("$lib/server/messages/blocks")
	const rows = await testDb
		.select({ id: schema.sessionMessages.id, content: schema.sessionMessages.content })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))
	for (const row of [...rows].reverse()) {
		const trees = await blockTreesOf(testDb as any, row.id)
		if (trees.length) return { messageId: row.id, content: row.content, blocks: trees[0]! }
	}
	return null
}

describe("R-15 · a spec writes a choices block", () => {
	test("the message carries one core:blocks part; every option is stamped with the writing spec's identity, the block with an id and its addressee", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, session, tom } = await sessionWithTom("stamp")
		// Addressed to a character nobody portrays and who is NOT in this
		// session's cast, so the resolver says `none`: the block is written
		// and waits, and nothing is dispatched (a bare `stamp` test).
		const stranger = await character(owner.id, "Stranger")
		const { askId, askFn, answerId } = await publishAskAndAnswer(
			"stamp",
			festival(`character:${stranger}`)
		)
		const res = await fire(owner.id, {
			sessionId: session.id,
			action: `${askId}#${askFn}`
		})
		expect(res.error).toBeUndefined()
		const written = await lastBlockTree(session.id)
		expect(written).not.toBeNull()
		const parts = await testDb
			.select()
			.from(schema.messageParts)
			.where(eq(schema.messageParts.messageId, written!.messageId))
		expect(parts.filter((p) => p.type === "core:blocks")).toHaveLength(1)
		const [block] = written!.blocks as any[]
		expect(block.kind).toBe("choices")
		expect(typeof block.id).toBe("string")
		expect(block.addressee).toBe(`character:${stranger}`)
		expect(block.question).toBe("Will you come to the festival?")
		for (const o of block.actions) expect(o.action).toBe(`${answerId}#stamp-answer`)
		// Nobody portrays the stranger: no child run.
		const runs = await runsOf(session.id)
		expect(runs.map((r) => r.specSlug)).toEqual([askId])
		expect(runs[0]!.depth).toBe(0)
		expect(runs[0]!.parentRunId).toBeNull()
		void tom
	})

	test("a block naming another spec's action is held to the installed declaration — unknown is refused", async () => {
		const { owner, session } = await sessionWithTom("foreign")
		const { askId, askFn } = await publishAskAndAnswer("foreign", () => [
			{
				kind: "choices",
				actions: [{ fn: "vanish", action: "core:spec/nowhere#vanish", label: "Vanish" }]
			}
		])
		const res = await fire(owner.id, {
			sessionId: session.id,
			action: `${askId}#${askFn}`
		})
		expect(res.error).toMatch(/'core:spec\/nowhere#vanish', which nothing published/)
	})

	test("a block naming a function the spec declares no action for is refused at the write, with the function named", async () => {
		const { owner, session } = await sessionWithTom("undeclared")
		const { askId, askFn } = await publishAskAndAnswer("undeclared", () => [
			{
				kind: "choices",
				actions: [{ fn: "grant-everything", label: "Grant" }]
			}
		])
		const res = await fire(owner.id, {
			sessionId: session.id,
			action: `${askId}#${askFn}`
		})
		expect(res.error).toMatch(/grant-everything.*declares no action for/)
	})
})

describe("R-15 · the addressee is the audience", () => {
	test("the guest whose persona is addressed answers by clicking; another guest and the owner are refused; the change says click; no child run", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, guest, session } = await sessionWithTom("click")
		const other = await makeUser("click-other")
		await testDb.insert(schema.sessionGuests).values({ sessionId: session.id, userId: other.id })
		// The guest's own presence: a persona row for a character they own.
		const elara = await character(guest.id, "Elara", true)
		await testDb.insert(schema.sessionPersonas).values({ sessionId: session.id, personaId: elara })
		const { askId, askFn, answerId, answerFn } = await publishAskAndAnswer(
			"click",
			festival(`character:${elara}`)
		)
		const asked = await fire(owner.id, {
			sessionId: session.id,
			action: `${askId}#${askFn}`
		})
		expect(asked.error).toBeUndefined()
		const written = (await lastBlockTree(session.id))!
		const block = written.blocks[0] as any

		const answer = (userId: number, choice = "yes") =>
			fire(userId, {
				sessionId: session.id,
				action: `${answerId}#${answerFn}`,
				messageId: written.messageId,
				blockId: block.id,
				payload: { choice }
			})

		// Not theirs: another guest, and the owner who asked.
		expect((await answer(other.id)).error).toMatch(/theirs to answer/)
		expect((await answer(owner.id)).error).toMatch(/theirs to answer/)
		// A choice the block never offered.
		expect((await answer(guest.id, "later")).error).toMatch(/not one of the choices/)
		// The addressee's person: the run fires.
		const ok = await answer(guest.id)
		expect(ok.error).toBeUndefined()
		expect(ok.success).toBe(true)

		const runs = await runsOf(session.id)
		expect(runs.map((r) => r.specSlug)).toEqual([askId, answerId])
		// A person's answer is a root of its own: no lineage, no dispatch.
		for (const r of runs) {
			expect(r.depth).toBe(0)
			expect(r.parentRunId).toBeNull()
		}
		// The answer landed as Elara's line — `read-answer` gave the spec the
		// label, the addressee and their row. Elara is the guest's PRESENCE
		// (a `session_personas` row), so the row is the person's: the
		// persona columns, role `user`, the holder's user id — never a
		// character row, which the client resolves against the cast and
		// renders as "Unknown" (2026-09-17; was pinned here as
		// `characterId === elara`). The participant reference is unchanged.
		const rows = await testDb
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, session.id))
			.orderBy(asc(schema.sessionMessages.id))
		const line = rows[rows.length - 1]!
		expect(line.content).toBe("Yes")
		expect(line.personaId).toBe(elara)
		expect(line.characterId).toBeNull()
		expect(line.role).toBe("user")
		expect(line.userId).toBe(guest.id)
		expect((line.metadata as any)?.speaker).toBe(`character:${elara}`)

		const { peekSessionChanges } = await import("$lib/server/messages/sessionChanges")
		const changes = await peekSessionChanges(testDb as any, session.id)
		const answered = changes.find((c) => c.event === "core:event/form-answered@1")
		expect(answered).toMatchObject({
			messageId: written.messageId,
			blockId: block.id,
			action: `${answerId}#${answerFn}`,
			addressee: `character:${elara}`,
			answer: { choice: "yes" },
			answeredBy: "click"
		})

		// Answered once (W7): the stored block says so — in place, still ONE
		// part — and a second press is refused naming who answered.
		const after = (await lastBlockTree(session.id))!
		expect(after.messageId).toBe(written.messageId)
		expect((after.blocks[0] as any).answered).toMatchObject({
			by: `character:${elara}`,
			choice: "yes"
		})
		expect(typeof (after.blocks[0] as any).answered.at).toBe("string")
		const parts = await testDb
			.select()
			.from(schema.messageParts)
			.where(eq(schema.messageParts.messageId, written.messageId))
		expect(parts.filter((p) => p.type === "core:blocks")).toHaveLength(1)
		expect((await answer(guest.id, "no")).error).toMatch(/already answered by Elara/)
		expect((await runsOf(session.id)).map((r) => r.specSlug)).toEqual([askId, answerId])
	})

	test("a fire that lies about the block is refused: the wrong function, the wrong identity, a form that is not there", async () => {
		const { owner, guest, session } = await sessionWithTom("lie")
		const elara = await character(guest.id, "Elara", true)
		const schema = await import("$lib/server/db/schema")
		await testDb.insert(schema.sessionPersonas).values({ sessionId: session.id, personaId: elara })
		const { askId, askFn, answerId, answerFn } = await publishAskAndAnswer(
			"lie",
			festival(`character:${elara}`)
		)
		await fire(owner.id, { sessionId: session.id, action: `${askId}#${askFn}` })
		const written = (await lastBlockTree(session.id))!
		const block = written.blocks[0] as any
		const base = { sessionId: session.id, messageId: written.messageId, blockId: block.id, payload: { choice: "no" } }
		// The wrong key: the option the choice names fires 'lie-answer'.
		expect((await fire(guest.id, { ...base, action: `${askId}#${askFn}` })).error).toMatch(
			/answered by 'lie-answer', not 'lie-ask'/
		)
		// The right key under the wrong spec — a different identity.
		expect(
			(await fire(guest.id, { ...base, action: `${askId}#${answerFn}` })).error
		).toMatch(/not '.*' to answer/)
		expect(
			(await fire(guest.id, { ...base, action: `${answerId}#${answerFn}`, blockId: "nope" }))
				.error
		).toMatch(/no longer here/)
	})
})

describe("R-15 · Elara asks Tom, and the AI answers as Tom", () => {
	test("form-addressed is dispatched after the asking run's receipt; answer-form runs as its child; the block's action fires as the grandchild; the change says oracle", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, session, tom } = await sessionWithTom("elara")
		const { askId, askFn, answerId, answerFn } = await publishAskAndAnswer(
			"elara",
			festival(`character:${tom}`)
		)
		modelAnswer = '{"choice":"maybe"}'
		const before = modelCalls
		const asked = await fire(owner.id, {
			sessionId: session.id,
			action: `${askId}#${askFn}`
		})
		expect(asked.error).toBeUndefined()
		expect(modelCalls - before).toBe(1)

		// In row order, which is dispatch order (W2): the answer's receipt is
		// saved before the fire it collected is dispatched, so the child's
		// row lands before the grandchild's — depth and row order agree.
		const runs = await runsOf(session.id)
		expect(runs.map((r) => r.specSlug)).toEqual([
			askId,
			"core:spec/answer-form-chat",
			answerId
		])
		const [root, child, grandchild] = runs
		expect(root!.outcome).toBe("ok")
		expect(root!.depth).toBe(0)
		expect(child!.outcome).toBe("ok")
		expect(child!.parentRunId).toBe(root!.runId)
		expect(child!.rootRunId).toBe(root!.runId)
		expect(child!.depth).toBe(1)
		// The receipt itself names the parent (R-21 (5)).
		expect((child!.receipt as any).parentRunId).toBe(root!.runId)
		expect((child!.receipt as any).depth).toBe(1)
		// The answer pipeline ran its whole spine and its outlet emitted.
		const nodes = (child!.receipt as any).nodes.map((n: any) => n.nodeKey)
		expect(nodes).toEqual(
			expect.arrayContaining(["input", "context", "form", "lines", "prompt", "generate", "answer"])
		)
		expect((child!.receipt as any).emitted.map((e: any) => e.event)).toContain(
			"core:event/form-answered@1"
		)
		// The answer's receipt names what it fired and the child it chose
		// the id for (W2) — the outlet collected, the host dispatched.
		const answerNode = (child!.receipt as any).nodes.find((n: any) => n.nodeKey === "answer")
		expect(answerNode.output.firedAction).toBe(`${answerId}#${answerFn}`)
		expect(answerNode.output.firedRunId).toBe(grandchild!.runId)
		// The action the answer fired: the grandchild, exactly as a click
		// would have run it.
		expect(grandchild!.outcome).toBe("ok")
		expect(grandchild!.parentRunId).toBe(child!.runId)
		expect(grandchild!.rootRunId).toBe(root!.runId)
		expect(grandchild!.depth).toBe(2)

		// Tom's line, as Tom.
		const rows = await testDb
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, session.id))
			.orderBy(asc(schema.sessionMessages.id))
		const line = rows[rows.length - 1]!
		expect(line.content).toBe("Maybe")
		expect(line.characterId).toBe(tom)

		// The change the next reply's inlet reads.
		const written = (await lastBlockTree(session.id))!
		const { peekSessionChanges } = await import("$lib/server/messages/sessionChanges")
		const changes = await peekSessionChanges(testDb as any, session.id)
		expect(changes.find((c) => c.event === "core:event/form-answered@1")).toMatchObject({
			messageId: written.messageId,
			blockId: (written.blocks[0] as any).id,
			action: `${answerId}#${answerFn}`,
			addressee: `character:${tom}`,
			answer: { choice: "maybe" },
			answeredBy: "oracle"
		})
		// And the block is marked answered, as Tom (W7).
		expect((written.blocks[0] as any).answered).toMatchObject({
			by: `character:${tom}`,
			choice: "maybe"
		})
	})

	/** Review ON for Answer's write, as the session's own override. */
	async function reviewAnswersSave(answerId: string, sessionId: number) {
		const schema = await import("$lib/server/db/schema")
		const [answerSpec] = await testDb
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, answerId))
		await testDb.insert(schema.pipelineNodeOverrides).values({
			specId: answerSpec!.id,
			scopeKind: "session",
			scopeId: sessionId,
			nodeKey: "save",
			slot: "settings",
			path: "review",
			value: "on"
		})
	}

	test("a grandchild parked at review releases the press: the ack says parked, the lock is free for the next trigger, the answer run ends ok, and approving lands the line (R-b, W2)", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, session, tom } = await sessionWithTom("parked")
		const { askId, askFn, answerId } = await publishAskAndAnswer(
			"parked",
			festival(`character:${tom}`)
		)
		// The grandchild parks at its `save`, and a parked gate is never timed
		// out (waiting is free, F13).
		await reviewAnswersSave(answerId, session.id)
		const { pendingReviewsFor, resolveReview } = await import(
			"$lib/server/pipelines/runtime/reviewGate"
		)
		for (const r of pendingReviewsFor(owner.id)) resolveReview(r.id, owner.id, "reject")

		// The first answer fires and parks; the second misses the form, so the
		// press it answers halts at the outlet and parks nothing.
		modelAnswers = ['{"choice":"yes"}', '{"choice":"never"}']
		const budget = <T>(p: Promise<T>, ms: number) =>
			Promise.race([p, new Promise<"timed out">((r) => setTimeout(() => r("timed out"), ms))])
		try {
			// The ack returns while the grandchild is still parked — it used
			// to wait for the owner, holding the session's trigger lock.
			const asked = await budget(
				fire(owner.id, { sessionId: session.id, action: `${askId}#${askFn}` }),
				30_000
			)
			expect(asked).not.toBe("timed out")
			expect((asked as any).error).toBeUndefined()
			expect((asked as any).success).toBe(true)
			expect((asked as any).parked).toBe(true)
			expect(pendingReviewsFor(owner.id)).toHaveLength(1)

			// While the grandchild waits: the root and the answer run are
			// both receipted `ok` — the answer's outlet collected the fire
			// and returned, and nothing is counting down on it — and the
			// parked run has no row yet.
			const parked = await runsOf(session.id)
			expect(parked.map((r) => `${r.specSlug}:${r.outcome}`)).toEqual([
				`${askId}:ok`,
				"core:spec/answer-form-chat:ok"
			])
			const answerNode = (parked[1]!.receipt as any).nodes.find(
				(n: any) => n.nodeKey === "answer"
			)
			expect(answerNode.result).toBe("ok")
			expect(typeof answerNode.output.firedRunId).toBe("string")
			// No line yet.
			const rows = await testDb
				.select({ content: schema.sessionMessages.content })
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.sessionId, session.id))
			expect(rows.map((r) => r.content)).not.toContain("Yes")

			// The lock went with the ack: a second trigger in the same
			// session is served while the first's grandchild is still parked.
			const second = await budget(
				fire(owner.id, { sessionId: session.id, action: `${askId}#${askFn}` }),
				30_000
			)
			expect(second).not.toBe("timed out")
			expect((second as any).success).toBe(true)
			expect((second as any).parked).toBeUndefined()
			expect(pendingReviewsFor(owner.id)).toHaveLength(1)

			const [review] = pendingReviewsFor(owner.id)
			expect(review!.specId).toBe(answerId)
			expect(review!.nodeKey).toBe("save")
			resolveReview(review!.id, owner.id, "approve")
		} finally {
			modelAnswers = []
		}
		// The parked run kept its handle: approving lands its row and the line.
		await vi.waitFor(
			async () => {
				const runs = await runsOf(session.id)
				expect(runs.some((r) => r.specSlug === answerId && r.outcome === "ok")).toBe(true)
			},
			{ timeout: 30_000, interval: 100 }
		)
		const runs = await runsOf(session.id)
		expect(runs.map((r) => `${r.specSlug}:${r.outcome}`)).toEqual([
			`${askId}:ok`,
			"core:spec/answer-form-chat:ok",
			`${askId}:ok`,
			"core:spec/answer-form-chat:halt",
			`${answerId}:ok`
		])
		const landed = runs[4]!
		expect(landed.runId).toBe(
			(runs[1]!.receipt as any).nodes.find((n: any) => n.nodeKey === "answer").output.firedRunId
		)
		expect(landed.parentRunId).toBe(runs[1]!.runId)
		expect(landed.depth).toBe(2)
		const line = (
			await testDb
				.select()
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.sessionId, session.id))
				.orderBy(asc(schema.sessionMessages.id))
		).pop()!
		expect(line.content).toBe("Yes")
		expect(line.characterId).toBe(tom)
		expect(pendingReviewsFor(owner.id)).toHaveLength(0)
	})

	test("a pressed action that parks at its own write answers parked at once, and its outcome arrives as pushes once the owner decides (R-b)", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, session } = await sessionWithTom("parked-press")
		// A question put to nobody: the owner answers it by clicking, and
		// Answer's own write is the gated one.
		const plain = (ids: Ids): MessageBlock[] => [
			{
				kind: "choices",
				question: "Will you come to the festival?",
				actions: [
					{ fn: ids.answerFn, action: ids.answerAction, label: "Yes", choice: "yes" },
					{ fn: ids.answerFn, action: ids.answerAction, label: "No", choice: "no" }
				]
			}
		]
		const { askId, askFn, answerId, answerFn } = await publishAskAndAnswer(
			"parked-press",
			plain,
			{ answerVenue: "message" }
		)
		await reviewAnswersSave(answerId, session.id)
		const { pendingReviewsFor, resolveReview } = await import(
			"$lib/server/pipelines/runtime/reviewGate"
		)
		for (const r of pendingReviewsFor(owner.id)) resolveReview(r.id, owner.id, "reject")
		const asked = await fire(owner.id, {
			sessionId: session.id,
			action: `${askId}#${askFn}`
		})
		expect(asked.error).toBeUndefined()
		const written = (await lastBlockTree(session.id))!
		const block = written.blocks[0] as any

		const { sessionsFireActionHandler } = await import("./sessions")
		const pushes: Array<{ event: string; data: any }> = []
		const ack = await sessionsFireActionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				action: `${answerId}#${answerFn}`,
				messageId: written.messageId,
				blockId: block.id,
				payload: { choice: "yes" },
				runId: "parked-press-run"
			} as any,
			(event: string, data: unknown) => pushes.push({ event, data })
		)
		// Parked, and nothing else: no success, no error, no terminal frame —
		// the run has not ended.
		expect(ack).toEqual({ sessionId: session.id, action: `${answerId}#${answerFn}`, parked: true })
		expect(pushes.filter((p) => p.event === "pipelines:progress" && p.data.done)).toEqual([])
		expect((await runsOf(session.id)).map((r) => r.specSlug)).toEqual([askId])
		const [review] = pendingReviewsFor(owner.id)
		expect(review).toMatchObject({ specId: answerId, nodeKey: "save" })

		pushes.length = 0
		resolveReview(review!.id, owner.id, "approve")
		// What the ack would have carried arrives as pushes: the terminal
		// frame on the card the press opened, then the answer.
		await vi.waitFor(
			() =>
				expect(
					pushes.some((p) => p.event === "sessions:fireAction" && p.data.success)
				).toBe(true),
			{ timeout: 30_000, interval: 100 }
		)
		const terminal = pushes.find((p) => p.event === "pipelines:progress" && p.data.done)
		expect(terminal?.data).toMatchObject({ runId: "parked-press-run", outcome: "ok" })
		const runs = await runsOf(session.id)
		expect(runs.map((r) => `${r.specSlug}:${r.outcome}`)).toEqual([`${askId}:ok`, `${answerId}:ok`])
		expect(runs[1]!.runId).toBe("parked-press-run")
		const line = (
			await testDb
				.select()
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.sessionId, session.id))
				.orderBy(asc(schema.sessionMessages.id))
		).pop()!
		expect(line.content).toBe("Yes")
		// And the form is answered, as a click (W7).
		expect(((await lastBlockTree(session.id))!.blocks[0] as any).answered).toMatchObject({
			by: `user:${owner.id}`,
			choice: "yes"
		})
	})

	test("a member joining as Tom mid-answer does not flip the AI's answer: the fire reads the answer run's pinned portrayals (W3)", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, session, tom } = await sessionWithTom("pinned")
		const { askId, askFn, answerId } = await publishAskAndAnswer(
			"pinned",
			festival(`character:${tom}`)
		)
		// While the oracle is answering as Tom, Tom becomes a member's own
		// presence — a persona row — which the resolver would now call a
		// person's. The answer run pinned him as the AI's at its start.
		midAnswer = async () => {
			await testDb
				.insert(schema.sessionPersonas)
				.values({ sessionId: session.id, personaId: tom })
		}
		const asked = await fire(owner.id, {
			sessionId: session.id,
			action: `${askId}#${askFn}`
		})
		expect(asked.error).toBeUndefined()
		expect(midAnswer).toBeNull()
		const runs = await runsOf(session.id)
		expect(runs.map((r) => `${r.specSlug}:${r.outcome}`)).toEqual([
			`${askId}:ok`,
			"core:spec/answer-form-chat:ok",
			`${answerId}:ok`
		])
		const line = (
			await testDb
				.select()
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.sessionId, session.id))
				.orderBy(asc(schema.sessionMessages.id))
		).pop()!
		expect(line.content).toBe("Maybe")
		expect(line.characterId).toBe(tom)
		// A person's click, by contrast, re-resolves: with Tom now a presence
		// the block is answered, so the refusal is the answered one — but a
		// FRESH question put to Tom is now the presence-holder's, not the AI's.
		const again = await fire(owner.id, {
			sessionId: session.id,
			action: `${askId}#${askFn}`
		})
		expect(again.error).toBeUndefined()
		expect(await runsOf(session.id)).toHaveLength(4)
	})

	test("an answer naming no option the block offers halts the answer run at the outlet — never an err — and nothing fires (W1)", async () => {
		const { owner, session, tom } = await sessionWithTom("junk")
		const { askId, askFn } = await publishAskAndAnswer("junk", festival(`character:${tom}`))
		modelAnswer = '{"choice":"never"}'
		try {
			const asked = await fire(owner.id, {
				sessionId: session.id,
				action: `${askId}#${askFn}`
			})
			expect(asked.error).toBeUndefined()
		} finally {
			modelAnswer = '{"choice":"maybe"}'
		}
		const runs = await runsOf(session.id)
		expect(runs.map((r) => r.specSlug)).toEqual([askId, "core:spec/answer-form-chat"])
		const child = runs[1]!
		expect(child.outcome).toBe("halt")
		expect(child.haltReason).toMatch(/does not fit the form/)
		expect(child.parentRunId).toBe(runs[0]!.runId)
		expect((child.receipt as any).haltNodeKey).toBe("answer")
		// The block waits, unanswered.
		const written = (await lastBlockTree(session.id))!
		expect((written.blocks[0] as any).answered).toBeUndefined()
	})
})

describe("01 §8 · the cycle guard", () => {
	test("an action that always re-asks parks at depth 4 for the session owner; Continue runs one more window, Stop here cancels", async () => {
		const { owner, guest, session, tom } = await sessionWithTom("loop")
		const { _resetLineage } = await import("$lib/server/pipelines/runtime/lineage")
		const { pendingCapPausesFor, resolveCapPause, _resetCapPauses } = await import(
			"$lib/server/pipelines/runtime/capPause"
		)
		const { settleSessionEvents } = await import("$lib/server/pipelines/runtime/sessionEvents")
		_resetLineage()
		_resetCapPauses()
		// `answer` writes ANOTHER block addressed to Tom firing `answer`:
		// asked → answered → asked → answered → …
		const { askId, askFn, answerId } = await publishAskAndAnswer(
			"loop",
			festival(`character:${tom}`),
			{ answerBlocks: festival(`character:${tom}`) }
		)
		const before = modelCalls
		const asked = await fire(owner.id, {
			sessionId: session.id,
			action: `${askId}#${askFn}`
		})
		expect(asked.error).toBeUndefined()
		const byDepth = async () => (await runsOf(session.id)).sort((a, b) => a.depth - b.depth)
		const runs = await byDepth()
		// root(0) → answer-form(1) → answer(2) → answer-form(3) → answer(4);
		// the fifth dispatch parks: no row, nothing run.
		expect(runs.map((r) => `${r.specSlug}@${r.depth}`)).toEqual([
			`${askId}@0`,
			"core:spec/answer-form-chat@1",
			`${answerId}@2`,
			"core:spec/answer-form-chat@3",
			`${answerId}@4`
		])
		for (const r of runs) expect(r.outcome).toBe("ok")
		expect(modelCalls - before).toBe(2)

		// The session owner is asked, the chain named root first.
		const [pause, ...more] = pendingCapPausesFor(owner.id)
		expect(more).toEqual([])
		expect(pause!.depth).toBe(5)
		expect(pause!.specSlug).toBe("core:spec/answer-form-chat")
		expect(pause!.chain).toHaveLength(6)
		expect(pause!.cap).toMatch(/cycle guard.*5 dispatches deep.*cap of 4/)
		// Only the owner: the guest does not see it, and cannot answer it.
		expect(pendingCapPausesFor(guest.id)).toEqual([])
		await expect(resolveCapPause(testDb as any, pause!.id, guest.id, "continue")).rejects.toThrow(
			/no longer waiting/
		)

		// Continue: one more window of four, then it parks again at depth 9.
		await resolveCapPause(testDb as any, pause!.id, owner.id, "continue")
		await settleSessionEvents(session.id)
		const again = await byDepth()
		expect(again.map((r) => r.depth)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
		expect(modelCalls - before).toBe(4)
		const [second] = pendingCapPausesFor(owner.id)
		expect(second!.depth).toBe(9)
		expect(second!.cap).toMatch(/cap of 8/)

		// Stop here: the parked run is receipted as cancelled, naming the cap.
		await resolveCapPause(testDb as any, second!.id, owner.id, "cancel")
		expect(pendingCapPausesFor(owner.id)).toEqual([])
		const done = await byDepth()
		const stopped = done[done.length - 1]!
		expect(stopped.depth).toBe(9)
		expect(stopped.outcome).toBe("cancelled")
		expect(stopped.haltReason).toMatch(/stopped at the cycle cap by the session owner/)
		expect(stopped.rootRunId).toBe(runs[0]!.runId)
		expect((stopped.receipt as any).nodes).toEqual([])
		// Answered once: a second answer finds nothing.
		await expect(resolveCapPause(testDb as any, second!.id, owner.id, "continue")).rejects.toThrow(
			/no longer waiting/
		)
		// And nothing is left holding the tree: every run in it — the clicks'
		// and answers' `form-answered` children included — has settled.
		await settleSessionEvents(session.id)
		const { _treeCount } = await import("$lib/server/pipelines/runtime/lineage")
		expect(_treeCount()).toBe(0)
	})

	test("the descendants cap reached at the fire door is a receipted halt — the would-be child's row, lineage filled, the routed spec named — and no run errs (W1)", async () => {
		const { owner, session, tom } = await sessionWithTom("fanout")
		const { _resetLineage, MAX_RUN_DESCENDANTS } = await import(
			"$lib/server/pipelines/runtime/lineage"
		)
		_resetLineage()
		expect(MAX_RUN_DESCENDANTS).toBe(16)
		// Nine questions to Tom in one message: nine answer runs (children)
		// and up to nine fires (grandchildren) — eighteen, past the cap of
		// sixteen. The FIRST oracle answer misses the enum, so its answer run
		// halts and fires nothing: 1 + 8·2 = 17 admissions, and the
		// seventeenth is the ninth answer's fire — refused at the fire door.
		const nine = (ids: Ids): MessageBlock[] =>
			Array.from({ length: 9 }, (_, i) => ({
				...festival(`character:${tom}`)(ids)[0]!,
				question: `Question ${i + 1}: will you come to the festival?`
			}))
		const { askId, askFn, answerId } = await publishAskAndAnswer("fanout", nine)
		modelAnswers = ['{"choice":"never"}']
		const before = modelCalls
		const asked = await fire(owner.id, {
			sessionId: session.id,
			action: `${askId}#${askFn}`
		})
		expect(asked.error).toBeUndefined()
		expect(modelCalls - before).toBe(9)
		const runs = await runsOf(session.id)
		// No `err` anywhere: a missed answer and a refused fire are halts.
		expect(runs.filter((r) => r.outcome === "err")).toEqual([])
		const children = runs.filter((r) => r.specSlug === "core:spec/answer-form-chat")
		const grandchildren = runs.filter((r) => r.specSlug === answerId)
		expect(children).toHaveLength(9)
		expect(grandchildren).toHaveLength(8)
		// The first answer missed the form: a halt, nothing fired.
		expect(children[0]!.outcome).toBe("halt")
		expect(children[0]!.haltReason).toMatch(/does not fit the form/)
		// Seven fires landed; the eighth is the refusal's row — the child
		// that never ran, under the ninth answer, at depth 2, naming the
		// spec it would have run and the cap that refused it.
		expect(grandchildren.slice(0, 7).map((r) => r.outcome)).toEqual(Array(7).fill("ok"))
		const refused = grandchildren[7]!
		expect(refused.outcome).toBe("halt")
		expect(refused.haltReason).toMatch(/cycle guard.*fathered 16 runs/)
		expect(refused.depth).toBe(2)
		expect(refused.parentRunId).toBe(children[8]!.runId)
		expect(refused.rootRunId).toBe(runs[0]!.runId)
		expect((refused.receipt as any).nodes).toEqual([])
		// In row order: the parent's row lands before the refused child's
		// (S-b) — the commit records the refusal, and `dispatchFires` writes
		// the child's row after the answer's own receipt, so the tree reads
		// in dispatch order. It used to land the child first.
		expect(runs.indexOf(refused)).toBeGreaterThan(runs.indexOf(children[8]!))
		expect(runs[runs.length - 1]).toBe(refused)
		// The ninth answer halted at its outlet on the same cap.
		expect(children[8]!.haltReason).toMatch(/^answer: cycle guard/)
		// And the ninth answer run halted on the cap at its outlet.
		expect(children[8]!.outcome).toBe("halt")
		expect(children[8]!.haltReason).toMatch(/cycle guard.*fathered 16 runs/)
		for (const c of children.slice(1, 8)) expect(c.outcome).toBe("ok")
	}, 120_000)
})

describe("W-a · every fire leaves a row under the id the answer named", () => {
	/**
	 * A press whose emit hook does something at the moment the fired
	 * action's stage frame goes out — the frame `dispatchFires` sends just
	 * before `fireAction` starts the grandchild (S4), which is the last
	 * moment before the fire runs.
	 */
	async function pressWithHook(
		userId: number,
		params: Record<string, unknown>,
		firedSpec: string,
		hook: () => void
	) {
		const { sessionsFireActionHandler } = await import("./sessions")
		return sessionsFireActionHandler.handler(
			fakeSocket(userId),
			params as any,
			(event: string, data: any) => {
				if (event === "pipelines:progress" && data?.stage === firedSpec) hook()
			}
		)
	}

	test("a fire stopped before it started — the answer run stopped as it dispatched — is receipted cancelled, with who stopped it and why", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, session, tom } = await sessionWithTom("stopped-fire")
		const { askId, askFn, answerId } = await publishAskAndAnswer(
			"stopped-fire",
			festival(`character:${tom}`)
		)
		const runRegistry = await import("$lib/server/pipelines/runtime/runRegistry")
		modelAnswer = '{"choice":"yes"}'
		let stoppedAnswer: string | undefined
		const asked = await pressWithHook(
			owner.id,
			{ sessionId: session.id, action: `${askId}#${askFn}` },
			answerId,
			() => {
				// The answer run is still registered while it dispatches its
				// fire: stop it now, and the fire finds its parent's signal
				// aborted before it starts.
				const answer = runRegistry
					.active()
					.find((h) => h.sessionId === session.id && h.specId === "core:spec/answer-form-chat")
				expect(answer).toBeDefined()
				stoppedAnswer = answer!.runId
				expect(runRegistry.cancel(answer!.runId, owner.id)).toEqual({ found: true, allowed: true })
			}
		)
		modelAnswer = '{"choice":"maybe"}'
		expect(asked.error).toBeUndefined()
		expect(asked.success).toBe(true)
		const runs = await runsOf(session.id)
		expect(runs.map((r) => `${r.specSlug}:${r.outcome}`)).toEqual([
			`${askId}:ok`,
			"core:spec/answer-form-chat:ok",
			`${answerId}:cancelled`
		])
		expect(runs[1]!.runId).toBe(stoppedAnswer)
		// The row is under the id the answer's receipt named — no `console.warn`
		// and nothing is the failure this closes.
		const firedRunId = (runs[1]!.receipt as any).nodes.find((n: any) => n.nodeKey === "answer")
			.output.firedRunId
		const fire = runs[2]!
		expect(fire.runId).toBe(firedRunId)
		expect(fire.parentRunId).toBe(runs[1]!.runId)
		expect(fire.rootRunId).toBe(runs[0]!.runId)
		expect(fire.depth).toBe(2)
		expect(fire.haltReason).toBe("the run that dispatched this one was stopped")
		expect((fire.receipt as any).cancelledBy).toBe("system:parent-stopped")
		expect((fire.receipt as any).nodes).toEqual([])
		// Nothing landed, and the form stays open.
		const rows = await testDb
			.select({ content: schema.sessionMessages.content })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, session.id))
		expect(rows.map((r) => r.content)).not.toContain("Yes")
		expect(((await lastBlockTree(session.id))!.blocks[0] as any).answered).toBeUndefined()
	})

	test("a fire that threw on its way is receipted as a halt on the error's sentence, and the answer run is not failed by it", async () => {
		const { owner, session, tom } = await sessionWithTom("thrown-fire")
		const { askId, askFn, answerId } = await publishAskAndAnswer(
			"thrown-fire",
			festival(`character:${tom}`)
		)
		modelAnswer = '{"choice":"yes"}'
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		let asked: Awaited<ReturnType<typeof pressWithHook>>
		try {
			asked = await pressWithHook(
				owner.id,
				{ sessionId: session.id, action: `${askId}#${askFn}` },
				answerId,
				() => {
					// The stage frame is sent from inside `dispatchFires`' try:
					// a sink that throws there is a throw on the fire's way.
					throw new Error("the progress sink fell over")
				}
			)
		} finally {
			modelAnswer = '{"choice":"maybe"}'
			warn.mockRestore()
		}
		expect(asked.error).toBeUndefined()
		expect(asked.success).toBe(true)
		const runs = await runsOf(session.id)
		expect(runs.map((r) => `${r.specSlug}:${r.outcome}`)).toEqual([
			`${askId}:ok`,
			"core:spec/answer-form-chat:ok",
			`${answerId}:halt`
		])
		const firedRunId = (runs[1]!.receipt as any).nodes.find((n: any) => n.nodeKey === "answer")
			.output.firedRunId
		const fire = runs[2]!
		expect(fire.runId).toBe(firedRunId)
		expect(fire.parentRunId).toBe(runs[1]!.runId)
		expect(fire.depth).toBe(2)
		expect(fire.haltReason).toBe("the fire did not run: the progress sink fell over")
		expect((fire.receipt as any).cancelledBy).toBeUndefined()
		expect((fire.receipt as any).nodes).toEqual([])
		expect(((await lastBlockTree(session.id))!.blocks[0] as any).answered).toBeUndefined()
	})
})

describe("the review's rulings (2026-09-17)", () => {
	test("a form put to nobody here — a character not in the cast — is the owner's to answer, and a guest's press is refused (W4)", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, guest, session } = await sessionWithTom("nobody")
		const stranger = await character(owner.id, "Stranger")
		const { askId, askFn, answerId, answerFn } = await publishAskAndAnswer(
			"nobody",
			festival(`character:${stranger}`)
		)
		await fire(owner.id, { sessionId: session.id, action: `${askId}#${askFn}` })
		const written = (await lastBlockTree(session.id))!
		const block = written.blocks[0] as any
		const answer = (userId: number) =>
			fire(userId, {
				sessionId: session.id,
				action: `${answerId}#${answerFn}`,
				messageId: written.messageId,
				blockId: block.id,
				payload: { choice: "no" }
			})
		expect((await answer(guest.id)).error).toMatch(/nobody here portrays.*owner's to answer/)
		const ok = await answer(owner.id)
		expect(ok.error).toBeUndefined()
		expect(ok.success).toBe(true)
		const line = (
			await testDb
				.select()
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.sessionId, session.id))
				.orderBy(asc(schema.sessionMessages.id))
		).pop()!
		expect(line.content).toBe("No")
		expect((await lastBlockTree(session.id))!.blocks[0]).toMatchObject({
			answered: { by: `character:${stranger}`, choice: "no" }
		})
	})

	test("a choices press is normalised to { choice } and a form press is checked against its fields (W5)", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, guest, session } = await sessionWithTom("w5")
		const elara = await character(guest.id, "Elara", true)
		await testDb.insert(schema.sessionPersonas).values({ sessionId: session.id, personaId: elara })
		// Two forms in one message: the festival question and a small form.
		const { askId, askFn, answerId, answerFn } = await publishAskAndAnswer(
			"w5",
			(ids) => [
				...festival(`character:${elara}`)(ids),
				{
					kind: "form",
					fn: ids.answerFn,
					action: ids.answerAction,
					addressee: `character:${elara}` as any,
					question: "How many are you bringing?",
					label: "Send",
					fields: {
						count: { type: "integer", required: true, min: 1, max: 4 },
						note: { type: "string" }
					}
				}
			],
			{ answerText: "Sent." }
		)
		await fire(owner.id, { sessionId: session.id, action: `${askId}#${askFn}` })
		const written = (await lastBlockTree(session.id))!
		const [choices, form] = written.blocks as any[]
		const press = (blockId: string, payload: Record<string, unknown>) =>
			fire(guest.id, {
				sessionId: session.id,
				action: `${answerId}#${answerFn}`,
				messageId: written.messageId,
				blockId,
				payload
			})
		// The choices press carries junk beside its choice: the run gets
		// `{ choice }` and nothing else — what the oracle's commit hands it.
		const picked = await press(choices.id, { choice: "yes", extra: "junk", choice2: 1 })
		expect(picked.error).toBeUndefined()
		let runs = await runsOf(session.id)
		const choiceRun = runs[runs.length - 1]!
		const readAnswer = (choiceRun.receipt as any).nodes.find((n: any) => n.nodeKey === "answer")
		expect(readAnswer.output.values).toEqual({ choice: "yes" })
		const { peekSessionChanges } = await import("$lib/server/messages/sessionChanges")
		expect(
			(await peekSessionChanges(testDb as any, session.id)).find(
				(c) => c.event === "core:event/form-answered@1"
			)?.answer
		).toEqual({ choice: "yes" })
		// The form press is checked field by field, with the faults named.
		expect((await press(form.id, { count: "two" })).error).toMatch(/does not fit the form.*count/)
		expect((await press(form.id, {})).error).toMatch(/does not fit the form.*'count' is required/)
		expect((await press(form.id, { count: 9 })).error).toMatch(/does not fit the form/)
		expect((await runsOf(session.id))).toHaveLength(runs.length)
		const sent = await press(form.id, { count: 2, note: "the cousins" })
		expect(sent.error).toBeUndefined()
		runs = await runsOf(session.id)
		const formRun = runs[runs.length - 1]!
		expect(formRun.outcome).toBe("ok")
		expect(
			(formRun.receipt as any).nodes.find((n: any) => n.nodeKey === "answer").output.values
		).toEqual({ count: 2, note: "the cousins" })
		expect((await lastBlockTree(session.id))!.blocks[1]).toMatchObject({
			answered: { by: `character:${elara}` }
		})
	})

	test("every option of an addressed question must name a declared action — not the first alone (W6)", async () => {
		const { owner, session, tom } = await sessionWithTom("w6write")
		// `dup` is declared by NO action of the ask spec (V2: a key names at
		// most one, so an undeclared key is the only way an option goes
		// unstamped); it is the SECOND option that carries it.
		const { askId, askFn } = await publishAskAndAnswer(
			"w6write",
			(ids) => [
				{
					kind: "choices",
					addressee: `character:${tom}` as any,
					question: "Will you?",
					actions: [
						{ fn: ids.answerFn, action: ids.answerAction, label: "Yes", choice: "yes" },
						{ fn: "dup", label: "No", choice: "no" }
					]
				}
			],
			{
				askActions: [
					{ key: "dup-a", venue: { kind: "composer" }, label: { en: "A" }, description: { en: "A test action." } },
					{ key: "dup-b", venue: { kind: "composer" }, label: { en: "B" }, description: { en: "A test action." } }
				]
			}
		)
		const res = await fire(owner.id, {
			sessionId: session.id,
			action: `${askId}#${askFn}`
		})
		expect(res.error).toMatch(/the blocks name 'dup', which '.*' declares no action for/)
		expect(await lastBlockTree(session.id)).toBeNull()
	})

	test("a person's press on a legacy block (no identity) is held to the sole declarer of its key: a world one is refused (W6, S6; V2)", async () => {
		const { spec, compile } = await import("@serene-pub/sdk")
		const C = await import("@serene-pub/contracts")
		const { chatGenre } = await import("@serene-pub/core-catalog")
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		const { owner, session } = await sessionWithTom("legacyworld")
		// A world action in the composer — the only place it may live.
		const id = "core:spec/test-legacy-grant"
		await saveDocument(
			testDb as any,
			compile(
				spec(id, {
					version: "1.0.0",
					taxonomy: { role: "action"},
					contributes: {
						actions: [
							{
								key: "legacy-grant",
								venue: { kind: "composer" },
								effects: "world",
								label: { en: "Grant" },
								description: { en: "A test action." }
							}
						]
					}
				})
					.inlet("input", C.userMessage.v1(), {
						genre: chatGenre,
						event: "core:event/session-action@1"
					})
					.outlet("save", ($) => C.createMessage.v1({ text: $.input.text }))
					.build()
			),
			{ publish: true }
		)
		// A block stored before identities — planted, since the write refuses
		// it — naming the function with no `action` to hold it to.
		const { insertLegacy, appendParts } = await import("$lib/server/messages/store")
		const row = await insertLegacy(testDb as any, {
			sessionId: session.id,
			userId: owner.id,
			role: "assistant",
			content: "Grant it?",
			isNarratorResponse: true
		})
		await appendParts(testDb as any, row.id, [
			{
				type: "core:blocks",
				data: {
					blocks: [
						{
							kind: "choices",
							id: "legacy",
							question: "Grant it?",
							actions: [{ fn: "legacy-grant", label: "Yes", choice: "yes" }]
						}
					]
				}
			}
		])
		// The owner presses the block: the bare key resolves to its sole
		// declarer (V2), and THAT action's effects line refuses the press.
		const res = await fire(owner.id, {
			sessionId: session.id,
			key: "legacy-grant",
			messageId: row.id,
			blockId: "legacy",
			payload: { choice: "yes" }
		})
		// L1 (2026-09-17) widened the sentence, not the rule: the exception it
		// names is a block addressed to `owner`, and this block is addressed
		// to a character.
		expect(res.error).toMatch(
			/changes something outside the story.*never a question put to anybody else/
		)
		expect((await runsOf(session.id)).map((r) => r.specSlug)).not.toContain(id)
		// From the composer, with no block, the same person runs it.
		const composer = await fire(owner.id, { sessionId: session.id, key: "legacy-grant" })
		expect(composer.error).toBeUndefined()
		expect((await runsOf(session.id)).map((r) => r.specSlug)).toContain(id)
	})

	test("a block naming another spec's world action by identity is refused at the write (S6), and so is one whose fn disagrees with the named action (S2)", async () => {
		const { spec, compile } = await import("@serene-pub/sdk")
		const C = await import("@serene-pub/contracts")
		const { chatGenre } = await import("@serene-pub/core-catalog")
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		const { owner, session } = await sessionWithTom("foreignworld")
		const grantId = "core:spec/test-foreign-grant"
		await saveDocument(
			testDb as any,
			compile(
				spec(grantId, {
					version: "1.0.0",
					taxonomy: { role: "action"},
					contributes: {
						actions: [
							{
								key: "foreign-grant",
								venue: { kind: "composer" },
								effects: "world",
								label: { en: "Grant" },
								description: { en: "A test action." }
							}
						]
					}
				})
					.inlet("input", C.userMessage.v1(), {
						genre: chatGenre,
						event: "core:event/session-action@1"
					})
					.outlet("save", ($) => C.createMessage.v1({ text: $.input.text }))
					.build()
			),
			{ publish: true }
		)
		const { askId, askFn } = await publishAskAndAnswer("foreignworld", () => [
			{
				kind: "choices",
				actions: [
					{ fn: "foreign-grant", action: `${grantId}#foreign-grant`, label: "Grant it", choice: "yes" }
				]
			}
		])
		const res = await fire(owner.id, {
			sessionId: session.id,
			action: `${askId}#${askFn}`
		})
		expect(res.error).toMatch(/foreign-grant.*changes something outside the story/)
		expect(await lastBlockTree(session.id)).toBeNull()

		// The fn must be the named action's function.
		const { askId: askId2, askFn: askFn2 } = await publishAskAndAnswer("wrongfn", (ids) => [
			{
				kind: "choices",
				actions: [{ fn: "something-else", action: ids.answerAction, label: "Go", choice: "go" }]
			}
		])
		const wrong = await fire(owner.id, {
			sessionId: session.id,
			action: `${askId2}#${askFn2}`
		})
		expect(wrong.error).toMatch(/with fn 'something-else', but that action's key is 'wrongfn-answer'/)
		expect(await lastBlockTree(session.id)).toBeNull()
	})

	test("a form-venue action is listed in no venue, and the block's fire still resolves it (S1)", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, guest, session } = await sessionWithTom("formvenue")
		const elara = await character(guest.id, "Elara", true)
		await testDb.insert(schema.sessionPersonas).values({ sessionId: session.id, personaId: elara })
		const { askId, askFn, answerId, answerFn } = await publishAskAndAnswer(
			"formvenue",
			festival(`character:${elara}`),
			{ answerVenue: "form" }
		)
		const { listSessionActions } = await import(
			"$lib/server/pipelines/entities/sessionActions"
		)
		for (const userId of [owner.id, guest.id]) {
			const venues = await listSessionActions(testDb as any, session.id, { userId })
			expect(Object.keys(venues)).not.toContain("form")
			for (const [kind, bucket] of Object.entries(venues))
				for (const a of [...bucket.primary, ...bucket.overflow])
					expect(`${kind}:${a.specSlug}#${a.key}`).not.toBe(`${kind}:${answerId}#${answerFn}`)
			// Ask, a composer action, is listed as ever.
			expect(venues.composer.overflow.map((a) => a.key)).toContain(askFn)
		}
		// And the socket's projection agrees.
		const { sessionsActionsHandler } = await import("./sessions")
		const res = await sessionsActionsHandler.handler(
			fakeSocket(guest.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(Object.keys(res.venues)).not.toContain("form")
		// The press still resolves it.
		await fire(owner.id, { sessionId: session.id, action: `${askId}#${askFn}` })
		const written = (await lastBlockTree(session.id))!
		const ok = await fire(guest.id, {
			sessionId: session.id,
			action: `${answerId}#${answerFn}`,
			messageId: written.messageId,
			blockId: (written.blocks[0] as any).id,
			payload: { choice: "maybe" }
		})
		expect(ok.error).toBeUndefined()
		expect((await runsOf(session.id)).map((r) => r.specSlug)).toEqual([askId, answerId])
	})

	test("the click's ack carries the tree's progress: the answer run's stage and statuses ride the root's card (S4)", async () => {
		const { owner, session, tom } = await sessionWithTom("progress")
		const { askId, askFn } = await publishAskAndAnswer("progress", festival(`character:${tom}`))
		const { sessionsFireActionHandler } = await import("./sessions")
		const frames: any[] = []
		const res = await sessionsFireActionHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, action: `${askId}#${askFn}`, runId: "root-progress" } as any,
			(event: string, data: unknown) => {
				if (event === "pipelines:progress") frames.push(data)
			}
		)
		expect(res.error).toBeUndefined()
		// Every frame is the root's — the card the client opened — and one
		// of them names the answer run being made.
		expect(frames.length).toBeGreaterThan(0)
		for (const f of frames) expect(f.runId).toBe("root-progress")
		const stage = frames.find((f) => typeof f.stage === "string")
		expect(stage?.stage).toMatch(/Answer a form/)
		// Stamped as the root's, like every frame on its card.
		expect(stage?.specId).toBe(askId)
		// The child's start is a frame the card can show (2026-09-17): the
		// session it belongs to, the label every frame on this card carries,
		// and a CLEARED status — the card shows a status in place of the
		// stage, and the parent's last status standing hid every child.
		expect(stage).toMatchObject({ sessionId: session.id, label: askFn, status: null })
		// The terminal frame is the root's, last — and self-describing, so a
		// card that reads it after the run was forgotten still has a title.
		expect(frames[frames.length - 1]).toMatchObject({
			done: true,
			outcome: "ok",
			sessionId: session.id,
			label: askFn
		})
	})

	test("an update's blocks replace the row's block tree rather than adding a second (S5)", async () => {
		const { spec, compile } = await import("@serene-pub/sdk")
		const C = await import("@serene-pub/contracts")
		const { chatGenre } = await import("@serene-pub/core-catalog")
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		const schema = await import("$lib/server/db/schema")
		const { owner, session } = await sessionWithTom("replace")
		// A spec that creates a row with one block tree, then updates the
		// same row with another — the reply's own shape (placeholder, fill).
		const id = "core:spec/test-replace-blocks"
		const doc = compile(
			spec(id, {
				version: "1.0.0",
				taxonomy: { role: "action"},
				contributes: {
					actions: [
						{ key: "twice", venue: { kind: "composer" }, label: { en: "Twice" }, description: { en: "A test action." } },
						{ key: "pick", venue: { kind: "form" }, label: { en: "Pick" }, description: { en: "A test action." } }
					]
				}
			})
				.inlet("input", C.userMessage.v1(), {
					genre: chatGenre,
					event: "core:event/session-action@1"
				})
				.outlet("first", () =>
					C.createMessage.v1({
						narration: true,
						text: "First.",
						blocks: [{ kind: "choices", actions: [{ fn: "pick", label: "One", choice: "one" }] }] as any
					})
				)
				.outlet("second", ($) =>
					C.updateMessage.v1({
						target: $.first.messageId,
						text: "Second.",
						blocks: [{ kind: "choices", actions: [{ fn: "pick", label: "Two", choice: "two" }] }] as any
					})
				)
				.build()
		)
		await saveDocument(testDb as any, doc, { publish: true })
		const res = await fire(owner.id, { sessionId: session.id, action: `${id}#twice` })
		expect(res.error).toBeUndefined()
		const written = (await lastBlockTree(session.id))!
		const parts = await testDb
			.select()
			.from(schema.messageParts)
			.where(eq(schema.messageParts.messageId, written.messageId))
		expect(parts.filter((p) => p.type === "core:blocks")).toHaveLength(1)
		expect((written.blocks[0] as any).actions.map((a: any) => a.choice)).toEqual(["two"])
		expect(written.content).toBe("Second.")
	})
})

/**
 * The road's first step, walked live 2026-09-17: an Adventure session cannot
 * be started without a lorebook (the genre declares `lorebook: "required"`),
 * and the refusal has to reach the person as the shape's own sentence — the
 * handler used to THROW it, and the socket layer's catch-all replaces a
 * thrown message with a constant on purpose.
 */
describe("starting an Adventure session over sessions:create", () => {
	test("a missing required lorebook is refused on sessions:create:error in the shape's sentence, and no row is made", async () => {
		const schema = await import("$lib/server/db/schema")
		const owner = await makeUser("start-refusal-owner")
		const elara = await character(owner.id, "Elara")
		const rook = await character(owner.id, "Rook", true)
		const { sessionsCreateHandler } = await import("./sessions")
		const rowsOf = async () =>
			testDb
				.select({ id: schema.sessions.id })
				.from(schema.sessions)
				.where(eq(schema.sessions.userId, owner.id))
		expect(await rowsOf()).toHaveLength(0)
		const pushes: Array<{ event: string; data: any }> = []
		const res = await sessionsCreateHandler.handler(
			fakeSocket(owner.id),
			{
				session: {
					name: "No book",
					genreId: "core:genre/adventure",
					presetId: null,
					lorebookId: null
				} as any,
				characterIds: [elara],
				personaIds: [rook],
				characterPositions: { [elara]: 0 }
			},
			(event: string, data: unknown) => pushes.push({ event, data })
		)
		// The ack and the error push carry the same sentence; the success
		// event is never sent.
		expect(res.error).toMatch(/does not fit 'Adventure'.*requires a lorebook/)
		expect(res.session).toBeUndefined()
		expect(pushes.map((p) => p.event)).toEqual(["sessions:create:error"])
		expect(pushes[0]!.data.error).toMatch(/requires a lorebook/)
		expect(await rowsOf()).toHaveLength(0)
	})

	test("a genre this build does not register is refused the same way", async () => {
		const owner = await makeUser("start-unregistered-owner")
		const { sessionsCreateHandler } = await import("./sessions")
		const pushes: Array<{ event: string; data: any }> = []
		const res = await sessionsCreateHandler.handler(
			fakeSocket(owner.id),
			{
				session: { name: "x", genreId: "plugin:genre/nowhere", presetId: null } as any,
				characterIds: [],
				personaIds: [],
				characterPositions: {}
			},
			(event: string, data: unknown) => pushes.push({ event, data })
		)
		expect(res.error).toMatch(/not a session mode this build registers/)
		expect(pushes.map((p) => p.event)).toEqual(["sessions:create:error"])
	})
})

/**
 * The persona road, walked live 2026-09-17: the narrator's JSON named the
 * owner's persona ("Rook") and `make-choices` resolved it against the CAST
 * alone — a persona is a `session_personas` row — so the block went out
 * unaddressed, and the owner's press landed as a line with no author. Both
 * halves: a presence resolves by name like a cast member, and a question put
 * to nobody in particular is answered as the presser — through their
 * presence where they have one, as themselves where they have none.
 */
describe("the narrator names the player's persona", () => {
	const festivalJson = (addressee?: string) => ({
		...(addressee ? { addressee } : {}),
		question: "Will you come to the festival?",
		options: [
			{ key: "yes", label: "Yes" },
			{ key: "maybe", label: "Maybe" },
			{ key: "no", label: "No" }
		]
	})
	const lastLine = async (sessionId: number) => {
		const schema = await import("$lib/server/db/schema")
		return (
			await testDb
				.select()
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.sessionId, sessionId))
				.orderBy(asc(schema.sessionMessages.id))
		).pop()!
	}

	test("a persona named by the oracle is the block's addressee, and the holder's press lands as their persona's line", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, session } = await sessionWithTom("persona-name")
		const rook = await character(owner.id, "Rook", true)
		await testDb.insert(schema.sessionPersonas).values({ sessionId: session.id, personaId: rook })
		const { askId, askFn, answerId, answerFn } = await publishAskAndAnswer(
			"persona-name",
			() => [],
			{ askJson: festivalJson("rook") }
		)
		const asked = await fire(owner.id, { sessionId: session.id, action: `${askId}#${askFn}` })
		expect(asked.error).toBeUndefined()
		const written = (await lastBlockTree(session.id))!
		const block = written.blocks[0] as any
		expect(block.addressee).toBe(`character:${rook}`)
		// Nobody dispatched an answer: the addressee is a person's.
		expect((await runsOf(session.id)).map((r) => r.specSlug)).toEqual([askId])

		const ok = await fire(owner.id, {
			sessionId: session.id,
			action: `${answerId}#${answerFn}`,
			messageId: written.messageId,
			blockId: block.id,
			payload: { choice: "yes" }
		})
		expect(ok.error).toBeUndefined()
		const line = await lastLine(session.id)
		expect(line.content).toBe("Yes")
		expect(line.personaId).toBe(rook)
		expect(line.characterId).toBeNull()
		expect(line.role).toBe("user")
		expect(line.userId).toBe(owner.id)
		expect((line.metadata as any)?.speaker).toBe(`character:${rook}`)
	})

	test("a cast member named by the oracle still resolves, and the AI answers as before", async () => {
		const { owner, session, tom } = await sessionWithTom("cast-name")
		const { askId, askFn, answerId } = await publishAskAndAnswer(
			"cast-name",
			() => [],
			{ askJson: festivalJson("tom cast-name") }
		)
		const asked = await fire(owner.id, { sessionId: session.id, action: `${askId}#${askFn}` })
		expect(asked.error).toBeUndefined()
		expect(((await lastBlockTree(session.id))!.blocks[0] as any).addressee).toBe(`character:${tom}`)
		expect((await runsOf(session.id)).map((r) => `${r.specSlug}:${r.outcome}`)).toEqual([
			`${askId}:ok`,
			"core:spec/answer-form-chat:ok",
			`${answerId}:ok`
		])
		const line = await lastLine(session.id)
		expect(line.content).toBe("Maybe")
		expect(line.characterId).toBe(tom)
		expect(line.personaId).toBeNull()
		expect((line.metadata as any)?.speaker).toBe(`character:${tom}`)
	})

	test("a question put to nobody in particular is answered as the presser: through their persona, else as themselves", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, guest, session } = await sessionWithTom("nobody-press")
		const rook = await character(owner.id, "Rook", true)
		await testDb.insert(schema.sessionPersonas).values({ sessionId: session.id, personaId: rook })
		// A name nobody here bears: the block goes out unaddressed.
		const { askId, askFn, answerId, answerFn } = await publishAskAndAnswer(
			"nobody-press",
			() => [],
			{ askJson: festivalJson("Nobody") }
		)
		const ask = () => fire(owner.id, { sessionId: session.id, action: `${askId}#${askFn}` })
		const press = (userId: number, w: { messageId: number; blockId: string }, choice: string) =>
			fire(userId, {
				sessionId: session.id,
				action: `${answerId}#${answerFn}`,
				messageId: w.messageId,
				blockId: w.blockId,
				payload: { choice }
			})

		expect((await ask()).error).toBeUndefined()
		const first = (await lastBlockTree(session.id))!
		expect((first.blocks[0] as any).addressee).toBeUndefined()
		// The owner, who has a persona here: the line is the persona's.
		expect((await press(owner.id, { messageId: first.messageId, blockId: (first.blocks[0] as any).id }, "yes")).error).toBeUndefined()
		const ownerLine = await lastLine(session.id)
		expect(ownerLine).toMatchObject({ content: "Yes", personaId: rook, characterId: null, role: "user", userId: owner.id })
		expect((ownerLine.metadata as any)?.speaker).toBe(`character:${rook}`)
		// The record of the answer names the block's addressee — none — and the presser.
		const { peekSessionChanges } = await import("$lib/server/messages/sessionChanges")
		const answered = (await peekSessionChanges(testDb as any, session.id)).find(
			(c) => c.event === "core:event/form-answered@1" && c.blockId === (first.blocks[0] as any).id
		)
		expect(answered).toMatchObject({ answeredBy: "click" })
		expect((answered as any).addressee).toBeUndefined()
		expect(((await lastBlockTree(session.id))!.blocks[0] as any).answered).toMatchObject({ by: `user:${owner.id}` })

		// A guest with no persona here: the line is theirs, as themselves.
		expect((await ask()).error).toBeUndefined()
		const second = (await lastBlockTree(session.id))!
		expect(second.messageId).not.toBe(first.messageId)
		expect((await press(guest.id, { messageId: second.messageId, blockId: (second.blocks[0] as any).id }, "no")).error).toBeUndefined()
		const guestLine = await lastLine(session.id)
		expect(guestLine).toMatchObject({ content: "No", personaId: null, characterId: null, role: "user", userId: guest.id })
		expect((guestLine.metadata as any)?.speaker).toBe(`user:${guest.id}`)
	})
})

describe("R-15 · staleness and order", () => {
	/** A person's line on the session's channel, written the way the store does. */
	async function landLine(sessionId: number, userId: number, channel = "main") {
		const { insertLegacy } = await import("$lib/server/messages/store")
		return insertLegacy(testDb as any, {
			sessionId,
			userId,
			role: "user",
			channel,
			content: "Anyway, as I was saying…"
		})
	}

	const supersededChanges = async (sessionId: number) => {
		const { peekSessionChanges } = await import("$lib/server/messages/sessionChanges")
		return (await peekSessionChanges(testDb as any, sessionId)).filter(
			(c) => c.event === "core:event/form-superseded@1"
		)
	}

	test("a block carries the head it was issued at; a line on the channel stales it — the press is overtaken, recorded once", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, guest, session } = await sessionWithTom("stale")
		const elara = await character(guest.id, "Elara", true)
		await testDb.insert(schema.sessionPersonas).values({ sessionId: session.id, personaId: elara })
		const { askId, askFn, answerId, answerFn } = await publishAskAndAnswer(
			"stale",
			festival(`character:${elara}`)
		)
		const asked = await fire(owner.id, {
			sessionId: session.id,
			action: `${askId}#${askFn}`
		})
		expect(asked.error).toBeUndefined()
		const written = (await lastBlockTree(session.id))!
		const block = written.blocks[0] as any
		// The head at issue is the row itself — the newest on its channel.
		expect(block.head).toBe(written.messageId)

		const answer = (choice = "yes") =>
			fire(guest.id, {
				sessionId: session.id,
				action: `${answerId}#${answerFn}`,
				messageId: written.messageId,
				blockId: block.id,
				payload: { choice }
			})

		// A line lands on the channel: the head moves past the form.
		const line = await landLine(session.id, owner.id)
		expect(line.id).toBeGreaterThan(written.messageId)

		const overtaken = await answer()
		expect(overtaken.error).toBe(
			"That question was overtaken — the conversation moved on before it was answered."
		)
		// Nothing ran, and nothing was answered.
		expect((await runsOf(session.id)).map((r) => r.specSlug)).toEqual([askId])
		expect(((await lastBlockTree(session.id))!.blocks[0] as any).answered).toBeUndefined()
		// Recorded once, for the next reply's inlet — and once only.
		const first = await supersededChanges(session.id)
		expect(first).toHaveLength(1)
		expect(first[0]).toMatchObject({ messageId: written.messageId, blockId: block.id })
		expect((await answer("no")).error).toMatch(/overtaken/)
		expect(await supersededChanges(session.id)).toHaveLength(1)
		// Staleness is computed, never stored: the block itself is unchanged.
		const after = (await lastBlockTree(session.id))!
		expect(after.messageId).toBe(written.messageId)
		expect((after.blocks[0] as any).head).toBe(written.messageId)
	})

	test("a block answered before the head moved stays answered — answered beats stale", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, guest, session } = await sessionWithTom("answered-first")
		const elara = await character(guest.id, "Elara", true)
		await testDb.insert(schema.sessionPersonas).values({ sessionId: session.id, personaId: elara })
		const { askId, askFn, answerId, answerFn } = await publishAskAndAnswer(
			"answered-first",
			festival(`character:${elara}`)
		)
		await fire(owner.id, { sessionId: session.id, action: `${askId}#${askFn}` })
		const written = (await lastBlockTree(session.id))!
		const block = written.blocks[0] as any
		const answer = (choice: string) =>
			fire(guest.id, {
				sessionId: session.id,
				action: `${answerId}#${answerFn}`,
				messageId: written.messageId,
				blockId: block.id,
				payload: { choice }
			})
		expect((await answer("yes")).error).toBeUndefined()
		// The answer's own line moved the head; the block is answered, not stale.
		expect(((await lastBlockTree(session.id))!.blocks[0] as any).answered).toMatchObject({ choice: "yes" })
		await landLine(session.id, owner.id)
		expect((await answer("no")).error).toMatch(/already answered by Elara/)
		expect(await supersededChanges(session.id)).toHaveLength(0)
	})

	test("an AI-addressed answer dispatched after the head moved halts at the door on the sentence, receipted", async () => {
		const { owner, session, tom } = await sessionWithTom("stale-ai")
		const { askId, askFn, answerId } = await publishAskAndAnswer(
			"stale-ai",
			festival(`character:${tom}`)
		)
		modelAnswer = '{"choice":"yes"}'
		// While the oracle is answering as Tom, a line lands on the channel.
		midAnswer = async () => {
			await landLine(session.id, owner.id)
		}
		let asked: Awaited<ReturnType<typeof fire>>
		try {
			asked = await fire(owner.id, { sessionId: session.id, action: `${askId}#${askFn}` })
		} finally {
			midAnswer = null
			modelAnswer = '{"choice":"maybe"}'
		}
		expect(asked.error).toBeUndefined()
		const runs = await runsOf(session.id)
		expect(runs.map((r) => `${r.specSlug}:${r.outcome}`)).toEqual([
			`${askId}:ok`,
			"core:spec/answer-form-chat:ok",
			`${answerId}:halt`
		])
		const fireRow = runs[2]!
		expect(fireRow.haltReason).toBe(
			"That question was overtaken — the conversation moved on before it was answered."
		)
		expect(fireRow.parentRunId).toBe(runs[1]!.runId)
		expect(fireRow.depth).toBe(2)
		// Nothing landed as Tom's line, the block is unanswered, the lapse is recorded.
		const written = (await lastBlockTree(session.id))!
		expect((written.blocks[0] as any).answered).toBeUndefined()
		const changes = await supersededChanges(session.id)
		expect(changes).toHaveLength(1)
		expect(changes[0]).toMatchObject({
			messageId: written.messageId,
			blockId: (written.blocks[0] as any).id
		})
	})

	test("a line on another lane of the channel stales nothing — the head is lane-scoped", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, guest, session } = await sessionWithTom("other-lane")
		const elara = await character(guest.id, "Elara", true)
		await testDb.insert(schema.sessionPersonas).values({ sessionId: session.id, personaId: elara })
		const { askId, askFn, answerId, answerFn } = await publishAskAndAnswer(
			"other-lane",
			festival(`character:${elara}`)
		)
		await fire(owner.id, { sessionId: session.id, action: `${askId}#${askFn}` })
		const written = (await lastBlockTree(session.id))!
		const block = written.blocks[0] as any
		// `main:2` is another lane of the same channel — another conversation.
		const other = await landLine(session.id, owner.id, "main:2")
		expect(other.id).toBeGreaterThan(written.messageId)
		const { channelHead } = await import("$lib/server/messages/channels")
		expect(await channelHead(testDb as any, session.id, "main")).toBe(written.messageId)
		expect(await channelHead(testDb as any, session.id, "main:2")).toBe(other.id)
		const ok = await fire(guest.id, {
			sessionId: session.id,
			action: `${answerId}#${answerFn}`,
			messageId: written.messageId,
			blockId: block.id,
			payload: { choice: "maybe" }
		})
		expect(ok.error).toBeUndefined()
		expect(ok.success).toBe(true)
		expect(((await lastBlockTree(session.id))!.blocks[0] as any).answered).toMatchObject({ choice: "maybe" })
		expect(await supersededChanges(session.id)).toHaveLength(0)
	})

	test("three questions to three AI characters in one message: all three answered, none superseded — an answer does not move on from the row it answers", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, session, tom } = await sessionWithTom("three")
		const ann = await character(owner.id, "Ann three")
		const bob = await character(owner.id, "Bob three")
		for (const characterId of [ann, bob])
			await testDb
				.insert(schema.sessionCharacters)
				.values({ sessionId: session.id, characterId, isActive: true })
		const three = (ids: Ids): MessageBlock[] =>
			[tom, ann, bob].map((who, i) => ({
				...festival(`character:${who}`)(ids)[0]!,
				question: `Question ${i + 1}: will you come to the festival?`
			}))
		const { askId, askFn, answerId } = await publishAskAndAnswer("three", three)
		modelAnswers = ['{"choice":"yes"}', '{"choice":"maybe"}', '{"choice":"no"}']
		const asked = await fire(owner.id, { sessionId: session.id, action: `${askId}#${askFn}` })
		expect(asked.error).toBeUndefined()
		const runs = await runsOf(session.id)
		// Ask, then three (answer-form → answer) pairs, every one `ok`.
		expect(runs.map((r) => `${r.specSlug}:${r.outcome}`)).toEqual([
			`${askId}:ok`,
			"core:spec/answer-form-chat:ok",
			`${answerId}:ok`,
			"core:spec/answer-form-chat:ok",
			`${answerId}:ok`,
			"core:spec/answer-form-chat:ok",
			`${answerId}:ok`
		])
		const written = (await lastBlockTree(session.id))!
		const blocks = written.blocks as any[]
		expect(blocks.map((b) => b.answered?.choice)).toEqual(["yes", "maybe", "no"])
		expect(blocks.map((b) => b.answered?.by)).toEqual([
			`character:${tom}`,
			`character:${ann}`,
			`character:${bob}`
		])
		expect(await supersededChanges(session.id)).toHaveLength(0)
		// The answers' rows say what they answer — the host's stamp, on the
		// row's metadata — and the staleness head for the asking row is still
		// the asking row, though the channel head has moved three times.
		const rows = await testDb
			.select({ id: schema.sessionMessages.id, content: schema.sessionMessages.content, metadata: schema.sessionMessages.metadata })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, session.id))
			.orderBy(asc(schema.sessionMessages.id))
		const answers = rows.filter((r) => r.id > written.messageId)
		expect(answers.map((r) => r.content)).toEqual(["Yes", "Maybe", "No"])
		expect(answers.map((r) => (r.metadata as any).answersForm)).toEqual(
			blocks.map((b) => ({ messageId: written.messageId, blockId: b.id }))
		)
		const { channelHead, stalenessHead } = await import("$lib/server/messages/channels")
		expect(await channelHead(testDb as any, session.id, "main")).toBe(answers[2]!.id)
		expect(await stalenessHead(testDb as any, session.id, "main", written.messageId)).toBe(written.messageId)
	})

	test("a NON-answer line on the channel still supersedes every open form on the row", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, guest, session } = await sessionWithTom("two-open")
		const elara = await character(guest.id, "Elara", true)
		await testDb.insert(schema.sessionPersonas).values({ sessionId: session.id, personaId: elara })
		const two = (ids: Ids): MessageBlock[] =>
			[1, 2].map((n) => ({
				...festival(`character:${elara}`)(ids)[0]!,
				question: `Question ${n}: will you come to the festival?`
			}))
		const { askId, askFn, answerId, answerFn } = await publishAskAndAnswer("two-open", two)
		await fire(owner.id, { sessionId: session.id, action: `${askId}#${askFn}` })
		const written = (await lastBlockTree(session.id))!
		const [first, second] = written.blocks as any[]
		const press = (blockId: string, choice: string) =>
			fire(guest.id, {
				sessionId: session.id,
				action: `${answerId}#${answerFn}`,
				messageId: written.messageId,
				blockId,
				payload: { choice }
			})
		// Answering the first leaves the second open: the answer's line is
		// not the conversation moving on from the row.
		expect((await press(first.id, "yes")).error).toBeUndefined()
		const { stalenessHead } = await import("$lib/server/messages/channels")
		expect(await stalenessHead(testDb as any, session.id, "main", written.messageId)).toBe(written.messageId)
		// A person's ordinary line is: both forms are past — the open one is
		// refused as overtaken, the answered one stays answered.
		const line = await landLine(session.id, owner.id)
		expect((line.metadata as any).answersForm).toBeUndefined()
		expect(await stalenessHead(testDb as any, session.id, "main", written.messageId)).toBe(line.id)
		expect((await press(second.id, "no")).error).toMatch(/overtaken/)
		expect((await press(first.id, "no")).error).toMatch(/already answered by Elara/)
		const changes = await supersededChanges(session.id)
		expect(changes).toHaveLength(1)
		expect(changes[0]).toMatchObject({ messageId: written.messageId, blockId: second.id })
		const after = (await lastBlockTree(session.id))!.blocks as any[]
		expect(after[0].answered).toMatchObject({ choice: "yes" })
		expect(after[1].answered).toBeUndefined()
	})
})

describe("F41 · the effects line", () => {
	async function worldDoc(venue: Record<string, unknown>, act: string[] = ["owner"]) {
		const { spec, compile } = await import("@serene-pub/sdk")
		const C = await import("@serene-pub/contracts")
		const { chatGenre } = await import("@serene-pub/core-catalog")
		// Built as the allowed shape, then patched — the builder refuses the
		// disallowed shapes at construction (SDK forms.test.ts), and what is
		// under test here is the host's publish saying the same.
		const doc: SpecDocument = compile(
			spec("core:spec/test-grant", {
				version: "1.0.0",
				taxonomy: { role: "action"},
				contributes: {
					actions: [
						{
							key: "grant",
							venue: { kind: "composer" },
							effects: "world",
							label: { en: "Grant" },
							description: { en: "A test action." }
						}
					]
				}
			})
				.inlet("input", C.userMessage.v1(), {
					genre: chatGenre,
					event: "core:event/session-action@1"
				})
				.outlet("save", ($) => C.createMessage.v1({ text: $.input.text }))
				.build()
		)
		const [action] = (doc.contributes as any).actions
		return {
			...doc,
			contributes: {
				actions: [{ ...action, venue: [venue], audience: { see: ["participant"], act } }]
			}
		} as SpecDocument
	}

	// A widget venue since 2026-09-28: a message's own ⋮ is the owner's side of
	// the line (lair re-plan R11, File as a room) — and saves.
	test("a world action in a widget venue, or widened to a participant, is refused at saveDocument", async () => {
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		await expect(
			saveDocument(testDb as any, await worldDoc({ kind: "widget" }), { publish: true })
		).rejects.toThrow(/'world' action may not appear in the 'widget' venue/)
		await expect(
			saveDocument(testDb as any, await worldDoc({ kind: "composer" }, ["participant"]), {
				publish: true
			})
		).rejects.toThrow(/audience\.act names 'participant'/)
	})

	test("a block naming a world action is refused at the write", async () => {
		const { spec, compile } = await import("@serene-pub/sdk")
		const C = await import("@serene-pub/contracts")
		const { chatGenre } = await import("@serene-pub/core-catalog")
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		const { owner, session } = await sessionWithTom("worldblock")
		const id = "core:spec/test-world-block"
		const doc: SpecDocument = compile(
			spec(id, {
				version: "1.0.0",
				taxonomy: { role: "action"},
				contributes: {
					actions: [
						{
							key: "world-ask",
							venue: { kind: "composer" },
							label: { en: "Ask" },
							description: { en: "A test action." }
						},
						{
							key: "grant",
							venue: { kind: "composer" },
							// Its own slash name: `core:spec/test-grant` claims
							// `/grant` in the same genre (V2: one name, one action).
							slash: "grant-block",
							effects: "world",
							label: { en: "Grant" },
							description: { en: "A test action." }
						}
					]
				}
			})
				.inlet("input", C.userMessage.v1(), {
					genre: chatGenre,
					event: "core:event/session-action@1"
				})
				.outlet("save", () =>
					C.createMessage.v1({
						text: "Shall I grant it?",
						blocks: [
							{ kind: "choices", actions: [{ fn: "grant", label: "Grant it" }] }
						] as any
					})
				)
				.build()
		)
		await saveDocument(testDb as any, doc, { publish: true })
		const res = await fire(owner.id, {
			sessionId: session.id,
			action: `${id}#world-ask`
		})
		// L1 (2026-09-17): the refusal now names its one exception, which this
		// block — addressed to nobody in particular — is not.
		expect(res.error).toMatch(
			/effects: 'world'.*the one block that may carry it is one addressed to 'owner'/
		)
		// Nothing landed: no block part on any row of this session.
		expect(await lastBlockTree(session.id)).toBeNull()
	})

	test("the answer road refuses a world action, whatever a stored block says", async () => {
		// A block that names a `world` action can only exist by bypassing the
		// write (an import, a hand-written row) — so one is planted directly,
		// and the road `answer-form` takes (`fireAction` with `as`) still
		// refuses it: the effects line is drawn at every door.
		const schema = await import("$lib/server/db/schema")
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		const { owner, session, tom } = await sessionWithTom("worldanswer")
		await saveDocument(testDb as any, await worldDoc({ kind: "composer" }), { publish: true })
		const { insertLegacy, appendParts } = await import("$lib/server/messages/store")
		const row = await insertLegacy(testDb as any, {
			sessionId: session.id,
			userId: owner.id,
			role: "assistant",
			content: "Grant it?",
			isNarratorResponse: true
		})
		await appendParts(testDb as any, row.id, [
			{
				type: "core:blocks",
				data: {
					blocks: [
						{
							kind: "choices",
							id: "planted",
							addressee: `character:${tom}`,
							question: "Grant it?",
							actions: [
								{ fn: "grant", action: "core:spec/test-grant#grant", label: "Yes", choice: "yes" }
							]
						}
					]
				}
			}
		])
		const { fireAction } = await import("$lib/server/pipelines/runtime/fireAction")
		const outcome = await fireAction(testDb as any, {
			sessionId: session.id,
			action: "core:spec/test-grant#grant",
			messageId: row.id,
			blockId: "planted",
			payload: { choice: "yes" },
			actor: { userId: owner.id, as: `character:${tom}` }
		})
		expect(outcome).toMatchObject({ kind: "refused" })
		expect((outcome as any).error).toMatch(/changes something outside the story/)
		expect((await runsOf(session.id)).map((r) => r.specSlug)).not.toContain("core:spec/test-grant")
		void schema
	})

	/**
	 * **L1 (ruled 2026-09-17): the one block that may name a world action.**
	 *
	 * The line exists so that an out-of-fiction effect is never a question a
	 * *character* could be asked. A form put to the **owner** is not that
	 * question: the owner is already the whole of such an action's `act`
	 * audience, and pressing the button is the owner acting, in the one place
	 * the line has always allowed them to. The Lair genre's knock is the
	 * shipped case — the dungeon's master is asked whether to build the room
	 * the party just walked into, and either answer writes lore.
	 *
	 * Both halves of the write are exercised, because there are two gates:
	 * the spec's OWN declaration (`worldBlockFunctions`) and another spec's,
	 * named on purpose (`foreignBlockActions`) — which is the shape the knock
	 * actually has.
	 */
	test("a block addressed to the owner may name a world action, its own or another spec's", async () => {
		const { spec, compile } = await import("@serene-pub/sdk")
		const C = await import("@serene-pub/contracts")
		const { chatGenre } = await import("@serene-pub/core-catalog")
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		const { owner, session } = await sessionWithTom("worldowner")
		// The other spec, whose `world` declaration the block will name.
		await saveDocument(testDb as any, await worldDoc({ kind: "composer" }), {
			publish: true
		})
		const id = "core:spec/test-owner-block"
		const doc: SpecDocument = compile(
			spec(id, {
				version: "1.0.0",
				taxonomy: { role: "action"},
				contributes: {
					actions: [
						{
							key: "owner-ask",
							venue: { kind: "composer" },
							label: { en: "Ask" },
							description: { en: "A test action." }
						},
						{
							key: "mine",
							venue: { kind: "composer" },
							effects: "world",
							label: { en: "Mine" },
							description: { en: "A test action." }
						}
					]
				}
			})
				.inlet("input", C.userMessage.v1(), {
					genre: chatGenre,
					event: "core:event/session-action@1"
				})
				.outlet("save", () =>
					C.createMessage.v1({
						text: "Shall I grant it?",
						blocks: [
							{
								kind: "choices",
								question: "Shall I grant it?",
								addressee: "owner",
								actions: [
									// This spec's own world action…
									{ fn: "mine", label: "Mine", choice: "mine" },
									// …and another spec's, named on purpose.
									{
										fn: "grant",
										action: "core:spec/test-grant#grant",
										label: "Theirs",
										choice: "theirs"
									}
								]
							}
						] as any
					})
				)
				.build()
		)
		await saveDocument(testDb as any, doc, { publish: true })
		const res = await fire(owner.id, {
			sessionId: session.id,
			action: `${id}#owner-ask`
		})
		expect(res.error).toBeUndefined()
		const tree = await lastBlockTree(session.id)
		expect(tree).not.toBeNull()
		const block = tree!.blocks[0] as any
		expect(block.addressee).toBe("owner")
		expect(block.actions.map((a: any) => a.fn)).toEqual(["mine", "grant"])
		// Stamped like any other: the owner's own action with this spec's
		// identity, the foreign one with the identity it named.
		expect(block.actions[0].action).toBe(`${id}#mine`)
		expect(block.actions[1].action).toBe("core:spec/test-grant#grant")
	})

	test("any other addressee keeps the refusal, on both gates", async () => {
		const { spec, compile } = await import("@serene-pub/sdk")
		const C = await import("@serene-pub/contracts")
		const { chatGenre } = await import("@serene-pub/core-catalog")
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		const { owner, session, tom } = await sessionWithTom("worldchar")
		await saveDocument(testDb as any, await worldDoc({ kind: "composer" }), {
			publish: true
		})
		const blockFor = (addressee: string | undefined, foreign: boolean, k: number) => [
			{
				kind: "choices",
				question: "Shall I grant it?",
				...(addressee ? { addressee } : {}),
				actions: [
					foreign
						? {
								fn: "grant",
								action: "core:spec/test-grant#grant",
								label: "Yes",
								choice: "yes"
							}
						: { fn: `mine-${k}`, label: "Yes", choice: "yes" }
				]
			}
		]
		let n = 0
		const publish = async (addressee: string | undefined, foreign: boolean) => {
			// A distinct key per document: an action's slash name derives from
			// its key, and one slash name means one function per genre.
			const k = n++
			const id = `core:spec/test-addressee-${k}`
			const doc: SpecDocument = compile(
				spec(id, {
					version: "1.0.0",
					taxonomy: { role: "action"},
					contributes: {
						actions: [
							{
								key: `ask-${k}`,
								venue: { kind: "composer" },
								label: { en: "Ask" },
								description: { en: "A test action." }
							},
							{
								key: `mine-${k}`,
								venue: { kind: "composer" },
								effects: "world",
								label: { en: "Mine" },
								description: { en: "A test action." }
							}
						]
					}
				})
					.inlet("input", C.userMessage.v1(), {
						genre: chatGenre,
						event: "core:event/session-action@1"
					})
					.outlet("save", () =>
						C.createMessage.v1({
							text: "Shall I grant it?",
							blocks: blockFor(addressee, foreign, k) as any
						})
					)
					.build()
			)
			await saveDocument(testDb as any, doc, { publish: true })
			return fire(owner.id, {
				sessionId: session.id,
				action: `${id}#ask-${k}`
			})
		}
		// A character, and "nobody in particular" — on this spec's own
		// declaration and on another spec's alike.
		for (const addressee of [`character:${tom}`, undefined])
			for (const foreign of [false, true]) {
				const res = await publish(addressee, foreign)
				expect(res.error, `${addressee} foreign=${foreign}`).toMatch(
					/changes something outside the story/
				)
			}
	})

	/**
	 * The press, which is the other half of L1: the gate at the write says
	 * the block MAY carry it, and the door still asks who is pressing.
	 */
	test("the owner may press an owner-addressed world action; the answer road may not", async () => {
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		const { owner, session } = await sessionWithTom("worldpress")
		await saveDocument(testDb as any, await worldDoc({ kind: "composer" }), {
			publish: true
		})
		const { insertLegacy, appendParts } = await import("$lib/server/messages/store")
		const row = await insertLegacy(testDb as any, {
			sessionId: session.id,
			userId: owner.id,
			role: "assistant",
			content: "Grant it?",
			isNarratorResponse: true
		})
		await appendParts(testDb as any, row.id, [
			{
				type: "core:blocks",
				data: {
					blocks: [
						{
							kind: "choices",
							id: "to-owner",
							addressee: "owner",
							question: "Grant it?",
							actions: [
								{
									fn: "grant",
									action: "core:spec/test-grant#grant",
									label: "Yes",
									choice: "yes"
								}
							]
						}
					]
				}
			}
		])
		const { fireAction } = await import("$lib/server/pipelines/runtime/fireAction")
		const press = (actor: Record<string, unknown>) =>
			fireAction(testDb as any, {
				sessionId: session.id,
				action: "core:spec/test-grant#grant",
				messageId: row.id,
				blockId: "to-owner",
				payload: { choice: "yes" },
				actor: actor as any
			})

		// The AI answering as the owner is refused before the effects line is
		// even reached — nobody portrays the owner but the owner — and
		// `worldPressRefused` refuses an `as` fire in any case.
		const asAi = await press({ userId: owner.id, as: "owner" })
		expect(asAi).toMatchObject({ kind: "refused" })
		expect((await runsOf(session.id)).map((r) => r.specSlug)).not.toContain(
			"core:spec/test-grant"
		)

		// The owner's own click runs it.
		const clicked = await press({ userId: owner.id })
		expect(clicked).not.toMatchObject({ kind: "refused" })
		expect((await runsOf(session.id)).map((r) => r.specSlug)).toContain(
			"core:spec/test-grant"
		)
	})
})

/**
 * **An answer rejected at review that wrote nothing is no answer** (lair pass
 * R9, 2026-09-28) — a core rule, keyed on recorded facts (the receipt's
 * reviews, `pipeline_run_artifacts`), never on a genre. And the form-venue
 * action's collects reach the client (R3's note, checked and fixed in R9).
 */
describe("R9 · a rejected answer, and what a form-venue press collects", () => {
	/** Answer's `save` parks for review in this session. */
	async function gateSave(answerId: string, sessionId: number) {
		const schema = await import("$lib/server/db/schema")
		const [answerSpec] = await testDb
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, answerId))
		await testDb.insert(schema.pipelineNodeOverrides).values({
			specId: answerSpec!.id,
			scopeKind: "session",
			scopeId: sessionId,
			nodeKey: "save",
			slot: "settings",
			path: "review",
			value: "on"
		})
	}

	/** A question put to nobody — the owner answers it — and Answer's own write gated. */
	const plain = (ids: Ids): MessageBlock[] => [
		{
			kind: "choices",
			question: "Will you come to the festival?",
			actions: [
				{ fn: ids.answerFn, action: ids.answerAction, label: "Yes", choice: "yes" },
				{ fn: ids.answerFn, action: ids.answerAction, label: "No", choice: "no" }
			]
		}
	]

	/** Ask, then press Answer's Yes; resolve its review with `decision`; wait for the run to end. */
	async function askAndDecide(tag: string, decision: "reject", opts: { answerFirst?: string } = {}) {
		const { owner, session } = await sessionWithTom(tag)
		const { askId, askFn, answerId, answerFn } = await publishAskAndAnswer(tag, plain, {
			answerVenue: "message",
			...opts
		})
		await gateSave(answerId, session.id)
		const { pendingReviewsFor, resolveReview } = await import(
			"$lib/server/pipelines/runtime/reviewGate"
		)
		for (const r of pendingReviewsFor(owner.id)) resolveReview(r.id, owner.id, "reject")
		expect((await fire(owner.id, { sessionId: session.id, action: `${askId}#${askFn}` })).error).toBeUndefined()
		const written = (await lastBlockTree(session.id))!
		const block = written.blocks[0] as any
		const regarding = `session:${session.id}/form:${written.messageId}/${block.id}`
		// The person had already seen to the open-form notification — read
		// and cleared — before pressing.
		const schema = await import("$lib/server/db/schema")
		await testDb
			.update(schema.notifications)
			.set({ clearedAt: new Date() })
			.where(eq(schema.notifications.regarding, regarding))
		const ack = await fire(owner.id, {
			sessionId: session.id,
			action: `${answerId}#${answerFn}`,
			messageId: written.messageId,
			blockId: block.id,
			payload: { choice: "yes" }
		})
		expect(ack).toMatchObject({ parked: true })
		const [review] = pendingReviewsFor(owner.id)
		resolveReview(review!.id, owner.id, decision)
		await vi.waitFor(
			async () =>
				expect(
					(await runsOf(session.id)).find((r) => r.specSlug === answerId)?.outcome
				).toBe("halt"),
			{ timeout: 30_000, interval: 100 }
		)
		return { owner, session, written, block, regarding, answerId, answerFn }
	}

	async function lastBlockTreeOn(messageId: number) {
		const { blockTreesOf } = await import("$lib/server/messages/blocks")
		return (await blockTreesOf(testDb as any, messageId))[0] ?? null
	}

	async function openNotifications(regarding: string) {
		const schema = await import("$lib/server/db/schema")
		const rows = await testDb
			.select()
			.from(schema.notifications)
			.where(eq(schema.notifications.regarding, regarding))
		return rows.filter((r: any) => r.clearedAt === null)
	}

	test("rejected having written nothing: no answer — the form is open, its notification raised again, and a second press answers", async () => {
		const { owner, session, written, block, regarding, answerId, answerFn } = await askAndDecide(
			"reject-nothing",
			"reject"
		)
		await vi.waitFor(async () => expect(await openNotifications(regarding)).toHaveLength(1), {
			timeout: 10_000,
			interval: 100
		})
		expect(((await lastBlockTreeOn(written.messageId))![0] as any).answered).toBeUndefined()
		const { openFormOf } = await import("$lib/server/messages/blocks")
		expect(await openFormOf(testDb as any, session.id)).toMatchObject({
			messageId: written.messageId,
			blockId: block.id
		})
		// And it can be answered: this time the owner approves.
		const { pendingReviewsFor, resolveReview } = await import(
			"$lib/server/pipelines/runtime/reviewGate"
		)
		const again = await fire(owner.id, {
			sessionId: session.id,
			action: `${answerId}#${answerFn}`,
			messageId: written.messageId,
			blockId: block.id,
			payload: { choice: "no" }
		})
		expect(again).toMatchObject({ parked: true })
		const [review] = pendingReviewsFor(owner.id)
		resolveReview(review!.id, owner.id, "approve")
		await vi.waitFor(
			async () =>
				expect(((await lastBlockTreeOn(written.messageId))![0] as any).answered).toMatchObject({
					choice: "no"
				}),
			{ timeout: 30_000, interval: 100 }
		)
	})

	test("rejected after it had already written a row: its effects happened, so the form stays answered", async () => {
		const { written, regarding } = await askAndDecide("reject-after-write", "reject", {
			answerFirst: "The lanterns are lit before anyone answers."
		})
		await vi.waitFor(
			async () =>
				expect(((await lastBlockTreeOn(written.messageId))![0] as any).answered).toMatchObject({
					choice: "yes"
				}),
			{ timeout: 10_000, interval: 100 }
		)
		expect(await openNotifications(regarding)).toHaveLength(0)
	})

	test("a form-venue action's collects reach the client — listed in no venue, carried beside them", async () => {
		const { owner, session } = await sessionWithTom("form-collects")
		const { answerId, answerFn } = await publishAskAndAnswer("form-collects", festival("owner"), {
			answerVenue: "form",
			answerCollects: { text: { need: "required", label: { en: "Why?" } } }
		})
		const { buildSessionActions } = await import("./sessions")
		const res = await buildSessionActions(session.id, owner.id, "main")
		expect(Object.keys(res.venues)).not.toContain("form")
		expect(res.formCollects?.[`${answerId}#${answerFn}`]).toEqual({
			name: "Answer",
			description: "A test action.",
			collects: { text: { need: "required", label: "Why?" } }
		})
	})
})
