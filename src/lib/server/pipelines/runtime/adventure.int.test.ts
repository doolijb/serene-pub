/**
 * An Adventure turn, running against real rows.
 *
 * What the declaration test next door cannot show is the thing this genre is
 * FOR: a turn that plans, narrates, gives two people a voice and then writes
 * the numbers down — with the numbers landing as proposals a player may refuse,
 * or as writes when the session says to trust the narrator.
 *
 * ## The model is a stub, and it answers one document
 *
 * Every generating step gets the same JSON back, carrying the planner's
 * `speakers` and the keeper's two lists at once. That is not laziness: what is
 * under test is the WIRING — which list the map iterates, which names resolve to
 * which rows, which branch of the route fires — and a stub that answered
 * differently per step would be a second implementation of the pipeline's own
 * ordering, asserting itself.
 *
 * ## Why the config is passed explicitly
 *
 * The author preset's values (the two `path` selections, and the trusted
 * branch's `mode`) reach a real install through `ensureDefaultConfig`, which needs a
 * published spec, a seeded prompt pool and a projected world. This test runs
 * the executor directly, so it supplies the same two values as configuration.
 * That the PRESET carries them is asserted in `specs/adventure.test.ts`; that
 * the pipeline does the right thing WITH them is asserted here.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import { ok, run } from "@serene-pub/sdk"
import {
	ADVENTURE_ADVANCE_TIME_SPEC_ID,
	ADVENTURE_GENRE_ID,
	ADVENTURE_RESPOND_SPEC_ID,
	CORE_SPECS
} from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { loadDocument, saveDocument } from "$lib/server/pipelines/boot/store"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { stateFor } from "$lib/server/state/resolve"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { SHIPPED_CONTEXT_TEMPLATE } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

/**
 * ⚠ `core:task/set-state@1` reaches the database DIRECTLY, through a dynamic
 * import — a Task has no write seam (see `bindings.state.ts`). So the module it
 * imports has to be this test's database, or the proposals it writes land
 * against a session that does not exist there.
 */
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-adventure-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/**
 * The one answer the stubbed model gives, for every step.
 *
 * It carries the planner's keys AND the keeper's, because what is under test is
 * the WIRING — which list the map iterates, which names resolve to which rows,
 * which branch of the route fires — and a stub that answered differently per
 * step would be a second implementation of the pipeline's own ordering,
 * asserting itself.
 *
 * ⚠ `value` is TEXT, and that is the shipped schema rather than a shortcut: the
 * grammar a schema compiles to on the llama.cpp family cannot say "a number
 * here and a word there" in one list, so `resolve-state-changes` is where `"14"`
 * becomes the integer `hp` is declared as.
 */
const ANSWER = JSON.stringify({
	beats: ["The lantern gutters.", "Something moves in the fog."],
	speakers: [{ name: "Wren", intent: "warn the party" }, { name: "Marrow" }],
	worldHints: { location: "the fog road", timeOfDay: "dusk", weather: "fog" },
	needsLookup: false,
	values: [
		{ owner: "Wren", slot: "hp", value: "14" },
		{ owner: "world", slot: "weather", value: "fog" }
	],
	inventory: [],
	/**
	 * The two keeper ACTIONS still read a `changes` list, because they still go
	 * out through the prose door: this lane converted the respond pipeline's
	 * planner and keeper and left Rest and Time passes on `generate-text` +
	 * `parse-json`. The key is here so the stub answers all four specs, and it
	 * goes when they are converted.
	 */
	changes: [{ owner: "world", slot: "time-of-day", value: "dusk" }]
})

const stubbed = () => {
	const parsed = JSON.parse(ANSWER) as Record<string, unknown>
	return {
		...coreBindings(),
		"core:oracle/generate-text@1": async () =>
			ok({ main: ANSWER, text: ANSWER, connection: { type: "stub" } }),
		/**
		 * The structured door, stubbed at the BINDING.
		 *
		 * WHICH capability a real request would lean on is the dispatch's
		 * answer and belongs to `connections/structuredOutput.test.ts`, which
		 * asks it without a database. What is under test here is the REQUEST
		 * the spec builds — a shape to fill and a transcript with nobody's name
		 * on the end of it — and the receipt is where that is read back.
		 *
		 * The stub selects by `path` the way the real binding does, because the
		 * keeper's two arms reaching one resolver as one list is exactly the
		 * wiring this file exists to assert.
		 */
		"core:oracle/generate-json@1": async (input: any) => {
			const path =
				typeof input?.params?.path === "string" ? input.params.path : ""
			const items = path
				.split(",")
				.map((p: string) => p.trim())
				.filter(Boolean)
				.flatMap((p: string) => {
					const value = parsed[p]
					return Array.isArray(value)
						? value
						: value == null
							? []
							: [value]
				})
			return ok({
				main: parsed,
				json: parsed,
				value: items,
				items,
				text: ANSWER,
				connection: { type: "stub" },
				structured: { mode: "schema", capability: "json_schema" }
			})
		}
	}
}

const nodeOf = (receipt: any, nodeKey: string): any =>
	receipt.nodes.find((n: any) => n.nodeKey === nodeKey)

/** The processed transcript a node published, as the executor recorded it. */
const linesOf = (receipt: any, nodeKey: string): any[] =>
	nodeOf(receipt, nodeKey)?.output?.messages ?? []

/**
 * The two values the author preset ships. See the header for why they are
 * supplied here rather than resolved.
 */
/**
 * What the executor resolves configuration from.
 *
 * `authorDefaults` is the floor a real install fills in through
 * `ensureDefaultConfig`: every assemble node points at a story string, the two
 * JSON steps at the lists they select, and the trusted branch at the one mode
 * that writes. Supplied here rather than resolved, for the reason in the
 * header — that the PRESET carries the same values is asserted next door.
 */
const template = {
	template: {
		source: SHIPPED_CONTEXT_TEMPLATE,
		engine: CORE_TEMPLATE_ENGINE
	}
}
const window = { sampling: { contextTokens: 8192, responseTokens: 512 } }

const WORLD: any = {
	overrides: [],
	samplingConfigs: [],
	connections: [],
	activeConnection: {},
	authorDefaults: {
		planPrompt: { ...template },
		scenePrompt: { ...template },
		"voices.item.prompt": { ...template },
		keeperPrompt: { ...template },
		prompt: { ...template },
		planWrite: { params: { path: "speakers" } },
		keeperWrite: { params: { path: "values,inventory" } },
		// The two ACTIONS ask for the keeper's shape now too, so their
		// generating step selects the same two arms the respond turn's does.
		write: { ...window, params: { path: "values,inventory" } },
		"commit.trusted.apply": { params: { mode: "apply" } },
		// A window, so the budget the prompt is cut to is a real number.
		scene: { ...window }
	}
}

let n = 0

/** One Adventure session: a world, two people in it, and something to answer. */
async function adventure(opts: { trustNarrator?: boolean } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `adventure-${suffix}`)
	const cast = []
	for (const name of ["Wren", "Marrow"]) {
		const [row] = await db
			.insert(schema.characters)
			.values({
				userId: user.id,
				name: `${name}`,
				description: `${name} of the fog roads.`
			})
			.returning()
		cast.push(row)
	}
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `The fog roads ${suffix}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: true,
			name: `Run ${suffix}`,
			genreId: ADVENTURE_GENRE_ID,
			genreFields: {
				tone: "grounded",
				difficulty: "normal",
				trustNarrator: opts.trustNarrator ?? false
			}
		})
		.returning()
	for (const c of cast)
		await db
			.insert(schema.sessionCharacters)
			.values({ sessionId: session.id, characterId: c.id })
	await db
		// The real shape: the lorebook is the session row's own binding.
		.update(schema.sessions)
		.set({ lorebookId: lorebook.id })
		.where(eq(schema.sessions.id, session.id))
	/**
	 * A previous reply with a planner's document stuck to the end of it.
	 *
	 * This is the contamination the JSON steps are cut off from, reproduced
	 * exactly as a live turn produced it: the model wrote the scene and then
	 * appended the schema it had been shown. Left in the transcript, the next
	 * planner reads its own shape back and the keeper reads the PLANNER's.
	 */
	const [previous] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId: session.id,
			role: "assistant",
			characterId: cast[0]!.id,
			content:
				"Wren lifts the lantern and the fog swallows the light.\n\n" +
				'[{"beats": ["Wren lifts the lantern"], "speakers": [], ' +
				'"worldHints": {"weather": "fog"}, "needsLookup": false}]'
		})
		.returning()
	await db
		.insert(schema.messages)
		.values({ id: previous.id, sessionId: session.id, role: "assistant" })
	const [message] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId: session.id,
			role: "user",
			content: "I hold up the lantern."
		})
		.returning()
	await db
		.insert(schema.messages)
		.values({ id: message.id, sessionId: session.id, role: "user" })
	return { user, cast, lorebook, session, message, previous }
}

/** Publish one core spec and hand back the document the executor loads. */
async function published(slug: string) {
	const entry = CORE_SPECS.find((s) => s.slug === slug)!
	const saved = await saveDocument(db, entry.build(), { publish: true })
	return await loadDocument(db, saved.specVersionId)
}

const castKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_")

describe("an Adventure session", () => {
	it("resolves the genre's slots without anybody writing a row", async () => {
		// "Attaching" is reading: `valueOf` walks session → lorebook → card
		// → declaration default, so a fresh session already has the genre's
		// vocabulary and nothing was materialised to give it one.
		const w = await adventure()
		const state = await stateFor(db, w.session.id)
		expect(state.world.weather).toBe("clear")
		expect(state.world["time-of-day"]).toBe("morning")
		expect(state.cast[castKey("Wren")]?.hp).toBe(20)
		expect(state.cast[castKey("Wren")]?.stamina).toBe(10)

		const rows = await db
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.sessionId, w.session.id))
		expect(rows).toHaveLength(0)
	}, 60_000)

	it("a chat session on the same instance has no stats at all", async () => {
		// The declarations are global; the vocabulary is the GENRE's. This
		// is the whole of "a newcomer in a chat session never sees a bar".
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(db, `plain-chat-${++n}`)
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false, name: "Chat" })
			.returning()
		const state = await stateFor(db, session.id)
		expect(state.world).toEqual({})
		// `byId` is the cast's other index and is always present, empty or not
		// (R17): a reader that had to check whether it exists would be a reader
		// with two code paths for one question.
		expect(state.cast).toEqual({ byId: {} })
		expect(state.slots).toEqual([])
	}, 60_000)
})

describe("a turn", () => {
	it("gives every speaker the planner named a voice, and keeps state once", async () => {
		const w = await adventure()
		const doc = await published(ADVENTURE_RESPOND_SPEC_ID)
		const receipt = await run(doc, {
			input: {
				text: "I hold up the lantern.",
				sessionScope: { sessionId: w.session.id },
				fields: { trustNarrator: false }
			},
			seed: "seed:adventure",
			triggerSource: "event",
			// A halted run is compacted when an event triggered it, which
			// empties `receipt.nodes` — and the nodes are the evidence here.
			compactHaltReceipts: false,
			world: WORLD,
			bindings: stubbed(),
			host: createHost(db, {
				sessionId: w.session.id,
				userId: w.user.id
			})
		})
		// The reason and the node, so a failure here reads as a sentence
		// rather than as `'halt' !== 'ok'`.
		expect(
			`${receipt.outcome} ${receipt.haltReason ?? ""} ${(receipt as any).haltNodeKey ?? ""}`.trim()
		).toBe("ok")

		// Two speakers in the plan is two voice steps in the receipt, each
		// its own iteration of the map.
		const voices = receipt.nodes.filter(
			(node) => node.nodeKey === "voices.item.say"
		)
		expect(voices).toHaveLength(2)
		expect(voices.map((v) => v.iteration).sort()).toEqual([0, 1])

		// One keeper, and one proposal set — not one per speaker.
		const keeps = receipt.nodes.filter(
			(node) => node.nodeKey === "commit.reviewed.propose"
		)
		expect(keeps).toHaveLength(1)
		const kept = keeps[0]!.output as any
		// Four: the keeper's two, plus the two world hints the planner wrote
		// that the world does not already say. The third hint (weather, fog)
		// is the keeper's own change and is not proposed twice.
		expect(kept.proposed).toHaveLength(4)
		expect(kept.applied).toHaveLength(0)

		// Proposed means nothing moved yet.
		const proposals = await db
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.sessionId, w.session.id))
		expect(proposals).toHaveLength(4)
		const state = await stateFor(db, w.session.id)
		expect(state.cast[castKey("Wren")]?.hp).toBe(20)

		// And the reply is one message, carrying the scene and both voices.
		// Two assistant rows now: the contaminated one the fixture seeded, and
		// this turn's.
		const messages = await db
			.select()
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, w.session.id),
					eq(schema.sessionMessages.role, "assistant")
				)
			)
		expect(messages).toHaveLength(2)
	}, 60_000)

	/**
	 * How each step is put ON THE WIRE, which is a different question from
	 * whether the graph ran.
	 *
	 * Every assertion here corresponds to a live defect the first playtest
	 * produced: a planner and a keeper sent as roleplay continuations, a
	 * narrator prefilled as a cast member, and a keeper answering in the
	 * planner's schema because it had just read one in the transcript.
	 */
	it("asks the JSON steps a question and the narrator for narration", async () => {
		const w = await adventure()
		const doc = await published(ADVENTURE_RESPOND_SPEC_ID)
		const receipt: any = await run(doc, {
			input: {
				text: "I hold up the lantern.",
				sessionScope: { sessionId: w.session.id },
				fields: { trustNarrator: false }
			},
			seed: "seed:adventure-wire",
			triggerSource: "event",
			compactHaltReceipts: false,
			world: WORLD,
			bindings: stubbed(),
			host: createHost(db, {
				sessionId: w.session.id,
				userId: w.user.id
			})
		})
		expect(receipt.outcome).toBe("ok")

		// A — the shared transcript ends on the player, not on an empty line
		// with a character's name on it. `-2` is the seed id.
		const planner = linesOf(receipt, "lines")
		expect(planner.length).toBeGreaterThan(0)
		expect(planner.map((m: any) => m.id)).not.toContain(-2)
		expect(planner.at(-1)!.role).toBe("user")

		// C — and it carries no JSON for the next model to imitate. The prose
		// of that same reply survives, which is what "hygiene" has to mean:
		// the turn still happened.
		const transcript = planner
			.map((m: any) => String(m.message ?? ""))
			.join("\n")
		expect(transcript).toContain("the fog swallows the light")
		expect(transcript).not.toContain("worldHints")
		expect(transcript).not.toContain("needsLookup")

		// …and the stored row is untouched. The cut is on the way into a
		// prompt, never on the session.
		const [stored] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, w.previous.id))
		expect(stored!.content).toContain("worldHints")

		// A — both JSON steps ask for a SHAPE rather than describing one.
		for (const key of ["planWrite", "keeperWrite"]) {
			const node = nodeOf(receipt, key)
			expect(node?.definitionId, key).toBe("core:oracle/generate-json@1")
			expect(node?.input?.schema, `${key} sent no schema`).toEqual(
				expect.objectContaining({ type: "object" })
			)
		}

		// B — the narrator's transcript ends on the NARRATOR's line, not on
		// the session's current character.
		const scene = linesOf(receipt, "sceneLines")
		const sceneSeed = scene.at(-1)!
		expect(sceneSeed.id).toBe(-2)
		expect(sceneSeed.name).toBe("Narrator")

		// E — and each voice's transcript ends on THAT speaker.
		const voices = receipt.nodes.filter(
			(node: any) => node.nodeKey === "voices.item.lines"
		)
		expect(voices).toHaveLength(2)
		expect(
			voices
				.map((node: any) => node.output?.messages?.at(-1)?.name)
				.sort()
		).toEqual(["Marrow", "Wren"])
	}, 60_000)

	it("turns a keeper's written value into the type its slot is declared with", async () => {
		// The keeper's schema types `value` as text, because the grammar a
		// schema compiles to on the llama.cpp family cannot hold two types in
		// one list. `hp` is an integer slot, so `"14"` has to become 14 before
		// the write refuses it.
		const w = await adventure({ trustNarrator: true })
		const doc = await published(ADVENTURE_RESPOND_SPEC_ID)
		const receipt: any = await run(doc, {
			input: {
				text: "I hold up the lantern.",
				sessionScope: { sessionId: w.session.id },
				fields: { trustNarrator: true }
			},
			seed: "seed:adventure-coerce",
			triggerSource: "event",
			compactHaltReceipts: false,
			world: WORLD,
			bindings: stubbed(),
			host: createHost(db, {
				sessionId: w.session.id,
				userId: w.user.id
			})
		})
		expect(receipt.outcome).toBe("ok")
		const resolved = nodeOf(receipt, "keeperResolve")?.output?.changes ?? []
		// The keeper's two, and the two hints the world does not already say.
		expect(resolved).toHaveLength(4)
		expect(
			resolved.find((c: any) => c.slotId === "core:slot/hp@1")?.value
		).toBe(14)
		const state = await stateFor(db, w.session.id)
		expect(state.cast[castKey("Wren")]?.hp).toBe(14)
	}, 60_000)

	it("applies instead of proposing when the session trusts the narrator", async () => {
		const w = await adventure({ trustNarrator: true })
		const doc = await published(ADVENTURE_RESPOND_SPEC_ID)
		const receipt = await run(doc, {
			input: {
				text: "I hold up the lantern.",
				sessionScope: { sessionId: w.session.id },
				fields: { trustNarrator: true }
			},
			seed: "seed:adventure-trusted",
			triggerSource: "event",
			// A halted run is compacted when an event triggered it, which
			// empties `receipt.nodes` — and the nodes are the evidence here.
			compactHaltReceipts: false,
			world: WORLD,
			bindings: stubbed(),
			host: createHost(db, {
				sessionId: w.session.id,
				userId: w.user.id
			})
		})
		expect(receipt.outcome).toBe("ok")

		// The branch IS the decision, and the receipt records which fired.
		const applied = receipt.nodes.find(
			(node) => node.nodeKey === "commit.trusted.apply"
		)
		expect(applied, "the trusted branch did not run").toBeTruthy()
		expect((applied!.output as any).applied).toHaveLength(4)
		expect(
			receipt.nodes.find(
				(node) => node.nodeKey === "commit.reviewed.propose"
			)?.result
		).not.toBe("ok")

		// The numbers moved, and nothing is waiting to be accepted.
		const state = await stateFor(db, w.session.id)
		expect(state.cast[castKey("Wren")]?.hp).toBe(14)
		expect(state.world.weather).toBe("fog")
		// And the planner's hints, which no turn used to read at all.
		expect(state.world.location).toBe("the fog road")
		expect(state.world["time-of-day"]).toBe("dusk")
		const proposals = await db
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.sessionId, w.session.id))
		expect(proposals).toHaveLength(0)
	}, 60_000)
})

/**
 * The post-history reminder, on a pipeline whose every step assembles its own
 * prompt.
 *
 * The trigger is a suppression: below it a short session gets no reminder,
 * because a reinforcement note two messages after the system prompt is noise.
 * A genre with four assemble nodes has to honour it at each of them, and the
 * only evidence that it does not is a "Response reminder" block in a
 * two-message session — nothing errors and the prompt is well-formed.
 */
describe("the narrator's post-history reminder", () => {
	const REMINDER = "Remember: you are Narrator, not anybody in the scene."

	/** The scene step's own instructions, and its own trigger. */
	const worldWithTrigger = (trigger: number) => ({
		...WORLD,
		authorDefaults: {
			...WORLD.authorDefaults,
			sceneContext: { prompts: { postHistoryInstructions: REMINDER } },
			scenePrompt: {
				...WORLD.authorDefaults.scenePrompt,
				params: { postHistoryTokenTrigger: trigger }
			}
		}
	})

	const sceneTurn = async (trigger: number) => {
		const w = await adventure()
		const doc = await published(ADVENTURE_RESPOND_SPEC_ID)
		const receipt: any = await run(doc, {
			input: {
				text: "I hold up the lantern.",
				sessionScope: { sessionId: w.session.id },
				fields: { trustNarrator: false }
			},
			seed: `seed:adventure-post-history-${trigger}`,
			triggerSource: "event",
			compactHaltReceipts: false,
			world: worldWithTrigger(trigger),
			bindings: stubbed(),
			host: createHost(db, {
				sessionId: w.session.id,
				userId: w.user.id
			})
		})
		expect(receipt.outcome).toBe("ok")
		const node = nodeOf(receipt, "scenePrompt")
		// Both shapes, because which one this render produces is the
		// connection's business: a completions wire is one flat string, a chat
		// wire is the turns. The reminder is the same block either way.
		const context = node?.output?.context ?? {}
		const rendered = [
			typeof context.rendered === "string" ? context.rendered : "",
			...(context.messages ?? []).map((m: any) =>
				String(m?.content ?? "")
			)
		].join("\n")
		return { node, rendered }
	}

	it("goes out when no trigger is set, and says so on the receipt", async () => {
		const { node, rendered } = await sceneTurn(0)
		expect(rendered).toContain(REMINDER)
		expect(node.output.postHistory).toMatchObject({
			included: true,
			reason: "included",
			trigger: 0
		})
	}, 60_000)

	it("is suppressed below the trigger, at a step that is not the reply's", async () => {
		const { node, rendered } = await sceneTurn(100000)
		expect(rendered).not.toContain(REMINDER)
		expect(rendered).not.toContain("Response reminder")
		const diag = node.output.postHistory
		expect(diag).toMatchObject({
			included: false,
			reason: "below_token_trigger",
			trigger: 100000
		})
		// The number a reader is shown is the one the decision used.
		expect(diag.historyTokens).toBeLessThan(100000)
		expect(diag.historyTokens).toBeGreaterThan(0)
	}, 60_000)
})

/**
 * The planner's world hints, and the gate in front of every proposal.
 *
 * Both are read back through the node itself rather than through a whole turn:
 * what is under test is the RESOLUTION — which name becomes which row, which
 * value a slot will accept — and a run around it would assert the pipeline's
 * ordering a third time.
 */
describe("core:query/resolve-state-changes@1", () => {
	const queryCtx = (sessionId: number, userId: number) =>
		({
			read: (table: any, q: unknown) =>
				createHost(db, { sessionId, userId }).read!(table, q, {
					key: "resolve",
					definitionId: "core:query/resolve-state-changes",
					definitionVersion: 1,
					kind: "query"
				}),
			signal: new AbortController().signal,
			progress: () => {},
			log: () => {}
		}) as any

	const resolve = async (
		w: Awaited<ReturnType<typeof adventure>>,
		input: Record<string, unknown>
	) => {
		const { stateBindings } = await import("./bindings.state")
		const node = stateBindings({ runId: "hints" })[
			"core:query/resolve-state-changes@1"
		]!
		const result: any = await node(
			{ scope: { sessionId: w.session.id }, ...input } as any,
			queryCtx(w.session.id, w.user.id)
		)
		expect(result.kind).toBe("ok")
		return result.value as { changes: any[]; refused: string[] }
	}

	it("turns a planned location into one proposal for the world's slot", async () => {
		// The whole of defect 2: `worldHints` was required by the plan schema
		// and read by nobody, so a first turn that planned the archive left
		// Location unset and the world strip empty.
		const w = await adventure()
		const { changes, refused } = await resolve(w, {
			changes: [],
			plan: {
				worldHints: {
					location: "The Archive",
					timeOfDay: "morning",
					weather: "clear"
				}
			}
		})
		expect(refused).toEqual([])
		// Exactly one: the hour and the sky already say what the hint says, and
		// proposing what is already true is a button that changes nothing.
		expect(changes).toHaveLength(1)
		expect(changes[0]).toMatchObject({
			owner: { kind: "session", id: w.session.id },
			slotId: "core:slot/location@1",
			value: "The Archive"
		})
	}, 60_000)

	it("proposes the hour and the sky when they actually move", async () => {
		const w = await adventure()
		const { changes } = await resolve(w, {
			changes: [],
			plan: {
				worldHints: {
					location: "The Archive",
					timeOfDay: "night",
					weather: "storm"
				}
			}
		})
		expect(changes.map((c: any) => [c.slotId, c.value]).sort()).toEqual([
			["core:slot/location@1", "The Archive"],
			["core:slot/time-of-day@1", "night"],
			["core:slot/weather@1", "storm"]
		])
	}, 60_000)

	it("refuses a hint its slot does not hold, and names what it does", async () => {
		const w = await adventure()
		const { changes, refused } = await resolve(w, {
			changes: [],
			plan: {
				worldHints: {
					location: "The Archive",
					timeOfDay: "Late Afternoon",
					weather: "clear"
				}
			}
		})
		expect(changes.map((c: any) => c.slotId)).toEqual([
			"core:slot/location@1"
		])
		expect(refused.join(" ")).toContain("core:slot/time-of-day@1")
		expect(refused.join(" ")).toContain("morning, day, dusk, night")
	}, 60_000)

	it("lets the keeper's own value win over a hint for the same slot", async () => {
		// Two proposals for one value is two buttons saying opposite things
		// about the same number.
		const w = await adventure()
		const { changes } = await resolve(w, {
			changes: [{ owner: "world", slot: "weather", value: "fog" }],
			plan: {
				worldHints: {
					location: "The Archive",
					timeOfDay: "morning",
					weather: "storm"
				}
			}
		})
		const weather = changes.filter(
			(c: any) => c.slotId === "core:slot/weather@1"
		)
		expect(weather).toHaveLength(1)
		expect(weather[0].value).toBe("fog")
	}, 60_000)

	it("refuses what a slot cannot hold instead of proposing it", async () => {
		// Live, from a Rest: stamina 90 on a slot that stops at 10, mood
		// "Thoughtful" on an enum that does not hold it, and a weather
		// sentence. Every one of them reached a player as a change to accept.
		const w = await adventure()
		const { changes, refused } = await resolve(w, {
			changes: [
				{ owner: "Wren", slot: "stamina", value: "90" },
				{ owner: "Wren", slot: "hp", value: "80" },
				{ owner: "Wren", slot: "mood", value: "Thoughtful" },
				{
					owner: "world",
					slot: "weather",
					value: "Overcast with Storm Clouds, Threatening Rain and Thunder"
				},
				// …and one that is legitimate, which still lands.
				{ owner: "Wren", slot: "stamina", value: "7" }
			]
		})
		expect(changes).toHaveLength(1)
		expect(changes[0]).toMatchObject({
			slotId: "core:slot/stamina@1",
			value: 7
		})
		expect(refused).toHaveLength(4)
		expect(refused.join(" ")).toContain("does not go above 10")
		expect(refused.join(" ")).toContain("does not go above 20")
		expect(refused.join(" ")).toContain(
			"calm, wary, afraid, angry, hopeful"
		)
		expect(refused.join(" ")).toContain("clear, fog, rain, storm, snow")
	}, 60_000)

	it("says so when a change carries no slot at all", async () => {
		// What a live receipt showed as "there is no '' to set here": the
		// keeper's whole document arriving where one change was expected.
		const w = await adventure()
		const { changes, refused } = await resolve(w, {
			changes: [{ values: [], inventory: [] }]
		})
		expect(changes).toEqual([])
		expect(refused).toEqual([
			"a change arrived with no slot and no item on it, so there was nothing to set."
		])
	}, 60_000)
})

describe("an action", () => {
	it("runs, changes state and writes no message at all", async () => {
		const w = await adventure()
		const doc = await published(ADVENTURE_ADVANCE_TIME_SPEC_ID)
		const receipt = await run(doc, {
			input: {
				text: "",
				sessionScope: { sessionId: w.session.id },
				fields: { trustNarrator: false }
			},
			seed: "seed:adventure-clock",
			triggerSource: "ui",
			world: WORLD,
			bindings: stubbed(),
			host: createHost(db, {
				sessionId: w.session.id,
				userId: w.user.id
			})
		})
		expect(receipt.outcome).toBe("ok")
		const proposals = await db
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.sessionId, w.session.id))
		expect(proposals.length).toBeGreaterThan(0)

		// A clock tick is a ledger line, not a paragraph: the only assistant row
		// is the one the fixture seeded.
		const messages = await db
			.select()
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, w.session.id),
					eq(schema.sessionMessages.role, "assistant")
				)
			)
		expect(messages).toHaveLength(1)
		expect(messages[0]!.id).toBe(w.previous.id)
	}, 60_000)
})
