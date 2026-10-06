/**
 * A session turn, run as a pipeline against real rows.
 *
 * The last integration point: everything below this has its own tests, and this
 * one asks whether the app could actually call it — the spec loads from the
 * database the bootstrap published it to, the world resolves from real config
 * rows, and the turn writes a real message.
 *
 * The model is faked and only the model.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { CHAT_RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"

// Whichever test runs a turn first pays the cold dynamic import of the entire
// dispatch chain — the SDK, the contracts, the host bindings, the legacy adapter
// and Handlebars — which on a slow machine is comfortably past vitest's 5s
// default. Raised per file rather than per test deliberately: the cost belongs
// to the *first* turn, not to any particular assertion, so a per-test timeout
// would make this file pass or fail depending on the order its tests ran in.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })

let streamed: string[] = []

/**
 * Fired inside the fake model's `generateText`, so a test can do something
 * while a turn is mid-provider — pressing Cancel, in the one below. Awaited
 * there, so a hook that writes rows has them landed before the model
 * "answers" and the run moves on to its write.
 */
let whileGenerating: (() => void | Promise<void>) | null = null

/** Pinned to the real action, so a rename cannot pass here — fakeTextAdapter.ts. */
class FakeAdapter implements FakeTextAdapter {
	injected: any
	promptBuilder: any = {}
	constructor(_p: any) {}
	/** The composed stop list. Recorded so a test can assert what was handed over. */
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
		await whileGenerating?.()
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				for (const chunk of ["The Ashguard ", "ride at dawn."])
					onContent(chunk)
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
// The reply dispatch consumes the run's own resolution now (R-8) and asks the
// resolver only to load the pair — so the stand-in connection is supplied
// where dispatch actually reads it. The real resolver answers first: a test
// that registers a capability default of its own gets that connection (and
// its stop guards), and only an instance with nothing registered falls back
// to the stand-in.
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

let db: TestDb
let sessionId: number
let userId: number
let characterId: number
/** The run owner's own presence in this session — their persona (0132). */
let personaId: number

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "turn-test", isAdmin: false })
		.returning()
	userId = user.id

	const [character] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Alice",
			description: "A knight sworn to {{user}}."
		})
		.returning()
	characterId = character.id

	const [persona] = await db
		.insert(schema.characters)
		.values({
			userId,
			isPersona: true,
			name: "Bob",
			description: "A traveller."
		})
		.returning()

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Turn Lore", userId })
		.returning()
	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				lorebookId: lorebook.id,
				name: "The Ashguard",
				keys: "ashguard",
				content: "Riders who patrol the ash wastes."
			}
		])
	)

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId,
		isActive: true,
	})
	personaId = persona.id
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId, personaId: persona.id })
	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "Have you seen the ashguard?",
		personaId: persona.id
	})

	await db.insert(schema.systemSettings).values({ id: 1 })
	// `{{{instructions}}}`, not `{{instructions}}`. Since 0.6 a value
	// arrives carrying its own heading and fence, and a double stash
	// HTML-escapes the fence.
	//
	// The `injectionsByIndex` lookup is the template opting in to
	// script injections (18 §4a): position belongs to the template, so
	// a template without the block renders none — which is the ruling,
	// not a gap. Renders zero bytes when the map is empty, which every
	// other test in this file depends on.
	const turnTemplate =
		"{{{instructions}}}\nLORE:{{{worldLore}}}\n{{#each sessionMessages}}{{#each (lookup ../injectionsByIndex @index)}}{{this.content}}\n{{/each}}{{this.name}}: {{this.message}}\n{{/each}}"

	// The story string reaches the pipeline from `pipeline_context_templates`
	// now, selected through the config layer — `context_configs` above is the
	// legacy row and nothing renders it. Written as an instance override rather
	// than by editing the shipped config, because that is what choosing a
	// template in the panel actually does.
	const { createContextTemplate } = await import(
		"$lib/server/pipelines/entities/contextTemplates"
	)
	const { CONTEXT_TEMPLATE_NODE_TYPE } = await import(
		"$lib/server/pipelines/entities/contextTemplateDefaults"
	)
	const { declarations } = await import("$lib/server/pipelines/config/panel")
	const template = await createContextTemplate(db, {
		nodeDefinitionId: CONTEXT_TEMPLATE_NODE_TYPE,
		name: "Turn Template",
		source: turnTemplate
	})
	const [respondSpec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
		.limit(1)
	// By node type, not "the first template slot": every `template` slot is a
	// reference now, so the history and lore queries have one too, and picking
	// the first one silently configures the wrong node.
	const decl = (await declarations(db, respondSpec.activeVersionId!)).find(
		(d) =>
			d.control === "context-template-ref" &&
			d.nodeDefinitionId === CONTEXT_TEMPLATE_NODE_TYPE
	)!
	// The template pin lands as the selected configuration's own value —
	// the only global home since the layer simplification (2026-08-24).
	{
		const { resolveSelectedConfig, duplicateConfig, selectConfig } =
			await import("$lib/server/pipelines/config/named")
		const shipped = await resolveSelectedConfig(
			db,
			respondSpec.id,
			CHAT_RESPOND_SPEC_ID,
			{}
		)
		const copy = await duplicateConfig(db, shipped!.configId, "Turn host")
		await selectConfig(db, respondSpec.id, "pub", 0, copy.id)
		await db
			.insert(schema.pipelineConfigValues)
			.values({
				configId: copy.id,
				nodeKey: decl.nodeKey,
				slot: decl.slot,
				path: decl.path,
				value: template.id
			})
			.onConflictDoUpdate({
				target: [
					schema.pipelineConfigValues.configId,
					schema.pipelineConfigValues.nodeKey,
					schema.pipelineConfigValues.slot,
					schema.pipelineConfigValues.path
				],
				set: { value: template.id }
			})
	}
}, 60_000)

const turn = async (over: any = {}) => {
	const { runTurn } = await import("$lib/server/pipelines/runtime/runTurn")
	return await runTurn({
		db: db,
		sessionId,
		userId,
		currentCharacterId: characterId,
		text: "Have you seen the ashguard?",
		...over
	})
}

describe("running a turn", () => {
	it("runs the spec the bootstrap published, from rows", async () => {
		// Nothing here constructs a document: it is loaded from the table the
		// startup path wrote it to, which is the difference between "the
		// pipeline works" and "the app could run the pipeline".
		const { generatedText, haltExplanation } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		const receipt = await turn()

		expect(haltExplanation(receipt)).toBe(null)
		expect(generatedText(receipt)).toBe("The Ashguard ride at dawn.")
	})

	it("writes the message it generated", async () => {
		await turn({ seed: "turn:written" })
		const rows = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
		expect(rows.map((r) => r.content)).toContain(
			"The Ashguard ride at dawn."
		)
	})

	it("streams to the sink while still putting the whole text on the port", async () => {
		// The user watches it arrive; the receipt records one value. A socket
		// handle is not a value — it would land in the receipt and in every
		// downstream node's input.
		const { generatedText } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		streamed = []
		const receipt = await turn({
			seed: "turn:stream",
			sink: { onChunk: (c: string) => streamed.push(c) }
		})
		expect(streamed).toEqual(["The Ashguard ", "ride at dawn."])
		expect(generatedText(receipt)).toBe("The Ashguard ride at dawn.")
		expect(JSON.stringify(receipt)).not.toContain("onChunk")
	})

	it("previews without sending or writing anything", async () => {
		const before = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))

		const receipt: any = await turn({ preview: true, seed: "turn:preview" })
		const after = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))

		expect(receipt.preview?.context?.rendered?.rendered).toContain(
			'LORE:World lore: \n```json\n{"The Ashguard"'
		)
		// The whole point of a preview: it is the real payload, and nothing
		// happened.
		expect(after).toHaveLength(before.length)
	})

	it("says plainly when the spec was never published", async () => {
		const { runTurn, PipelineUnavailableError } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		await expect(
			runTurn({
				db: db,
				sessionId,
				userId,
				currentCharacterId: characterId,
				text: "x",
				specId: "core:spec/not-published"
			})
		).rejects.toThrow(PipelineUnavailableError)
	})
})

/**
 * Cancel, on a real turn (13 §3).
 *
 * ⚠ Cancel used to reach the adapter and nothing else: `signal` stopped the
 * request in flight, `checkCancel` was never wired, and the executor walked on
 * to the next node — so stopping an image render started the write that
 * followed it. The assertion is therefore about the node that must *not* run,
 * not about the status that comes back.
 *
 * The fake model returns normally when aborted, which is the case the signal
 * alone cannot cover: a provider that hands back what it has is a successful
 * node, and nothing about its result says stop.
 */
describe("cancelling a turn", () => {
	it("stops before the next node, and the receipt says who and why", async () => {
		const runRegistry = await import(
			"$lib/server/pipelines/runtime/runRegistry"
		)
		const before = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))

		const runId = "run:cancel-mid-flight"
		const handle = runRegistry.start({
			runId,
			userId,
			sessionId,
			kind: "reply"
		})
		whileGenerating = () => {
			runRegistry.cancel(runId, userId)
		}

		let receipt: any
		try {
			receipt = await turn({
				seed: "turn:cancelled",
				runId,
				// Exactly the pair the socket handler passes: the event for the
				// adapter, the poll for the executor, one controller behind both.
				signal: handle.controller.signal,
				cancelSignal: () => runRegistry.cancellation(handle)
			})
		} finally {
			whileGenerating = null
			runRegistry.finish(runId)
		}

		// The write node is the one after the provider. It did not run — which
		// is the whole claim, and it is a row, not a status.
		expect(receipt.nodes.map((n: any) => n.nodeKey)).toContain("generate")
		expect(receipt.nodes.map((n: any) => n.nodeKey)).not.toContain("save")
		// The pipeline's own placeholder is the one row the turn added (09-B
		// B4), and Stop finalised it: out of the generating state, no error —
		// the run-level guarantee, kept by the host rather than by a node.
		const after = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
		expect(after).toHaveLength(before.length + 1)
		const placeholder = after.find(
			(m) => !before.some((b) => b.id === m.id)
		)!
		expect(placeholder.isGenerating).toBe(false)
		expect(placeholder.error).toBeNull()

		expect(receipt.outcome).toBe("cancelled")
		expect(receipt.cancelledBy).toBe(`user:${userId}`)
		expect(receipt.haltReason).toBe("the run was cancelled")
	})
})

/**
 * Who portrays whom, resolved once at run start and pinned on the receipt
 * (plans/29 R-21 (4); U5a).
 *
 * The claim is not that the map is right — `portrayals.int.test.ts` holds
 * the table — but that the run **pins** it: computed before the first node,
 * equal to what the resolver answers for the same inputs, unmoved by a
 * membership change that lands while the model is still generating, and
 * resolved only where it means something.
 */
describe("who portrays whom on a turn", () => {
	it("pins the resolver's answer on the receipt, and the inlet carries the speaker as a reference", async () => {
		const { resolvePortrayals, turnRefs } = await import(
			"$lib/server/pipelines/runtime/portrayals"
		)
		const receipt: any = await turn({ seed: "turn:portrayals" })
		const expected = await resolvePortrayals(db as any, {
			sessionId,
			runOwnerUserId: userId,
			refs: await turnRefs(db as any, sessionId, `character:${characterId}`),
			speaker: `character:${characterId}`
		})
		expect(receipt.portrayals).toEqual(expected)
		expect(receipt.portrayals[`character:${characterId}`]).toEqual({
			by: "ai"
		})
		expect(receipt.portrayals.owner).toEqual({
			by: "person",
			userId: String(userId)
		})
		expect(receipt.portrayals["run-owner"]).toEqual({
			by: "person",
			userId: String(userId)
		})
		// The inlet published the reference (R-18 (3)) beside the bare id,
		// and the turn strategy carried it through.
		const inlet = receipt.nodes.find((n: any) => n.nodeKey === "input")
		expect(inlet.output.speaker).toBe(`character:${characterId}`)
		expect(inlet.output.characterId).toBe(characterId)
		// The reply run seats no `speaker` node since A6 (PLAN-turn-order
		// §4.4): the entry being fired names who speaks, and it arrives on
		// the inlet — which the assertion above already reads.
		expect(receipt.nodes.some((n: any) => n.nodeKey === "speaker")).toBe(
			false
		)
		expect((inlet.output as any).characterId).toBe(characterId)
		/**
		 * And who PRESSED, beside who is speaking (G9, 2026-09-17) — the two
		 * differ on nearly every turn, which is the whole reason the port
		 * exists: a person types and a character answers. The run owner holds
		 * a persona here, so their reference is that character's; a persona
		 * IS a character (0132), and a line written as them is written as that
		 * character.
		 */
		expect(inlet.output.presser).toBe(`character:${personaId}`)
		expect(inlet.output.presser).not.toBe(inlet.output.speaker)
		// Stored with the receipt, as the blob is.
		const [row] = await db
			.select({ receipt: schema.pipelineRuns.receipt })
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.runId, receipt.runId))
		expect((row!.receipt as any).portrayals).toEqual(expected)
	})

	it("a member joining mid-run does not change the pinned map", async () => {
		const { resolvePortrayals, turnRefs } = await import(
			"$lib/server/pipelines/runtime/portrayals"
		)
		// A guest who, while the model is generating, joins the session and
		// attaches the cast character as their own persona — which would
		// make `character:<id>` a person's portrayal on the NEXT resolution.
		const [guest] = await db
			.insert(schema.users)
			.values({ username: "turn-mid-run-guest", isAdmin: false })
			.returning()
		const [theirs] = await db
			.insert(schema.characters)
			.values({
				userId: guest.id,
				name: "Alice",
				description: "The guest's own Alice.",
				isPersona: true
			})
			.returning()
		// Their persona is a cast row too, so the pinned answer is `ai` and
		// the mid-run answer would be `person`.
		await db.insert(schema.sessionCharacters).values({
			sessionId,
			characterId: theirs.id,
			isActive: false,
		})
		/**
		 * What the resolver would answer at the moment the join landed —
		 * read from inside the oracle, after the rows are in. If anything
		 * after run start re-resolved, this is what it would see, and it
		 * disagrees with the pinned map on purpose.
		 */
		let seenMidRun: any = null
		/** Did the save outlet start after the join had landed? */
		let saveStartedAfterJoin = false
		let receipt: any
		try {
			// Awaited inside the fake model's call: the rows are landed
			// before the oracle "answers", so the run's write and its
			// receipt both come after a membership the pinned map predates.
			whileGenerating = async () => {
				await db
					.insert(schema.sessionGuests)
					.values({ sessionId, userId: guest.id })
				await db
					.insert(schema.sessionPersonas)
					.values({ sessionId, personaId: theirs.id })
				seenMidRun = await resolvePortrayals(db as any, {
					sessionId,
					runOwnerUserId: userId,
					refs: await turnRefs(
						db as any,
						sessionId,
						`character:${characterId}`
					),
					speaker: `character:${characterId}`
				})
			}
			receipt = await turn({
				seed: "turn:portrayals-join",
				onNode: (e: any) => {
					if (e.nodeKey === "save" && e.phase === "start")
						saveStartedAfterJoin = seenMidRun !== null
				}
			})
		} finally {
			whileGenerating = null
		}
		// The join really did land mid-run: the resolver saw it before the
		// write began, and answered differently from what the run pinned.
		expect(saveStartedAfterJoin).toBe(true)
		expect(seenMidRun[`character:${theirs.id}`]).toEqual({
			by: "person",
			userId: String(guest.id)
		})
		expect(seenMidRun[`user:${guest.id}`]).toBeUndefined()
		// Pinned before node 1: the guest is not a member of THIS run, so a
		// re-resolution anywhere after the oracle would fail here.
		expect(receipt.outcome).toBe("ok")
		expect(receipt.portrayals[`character:${theirs.id}`]).toEqual({
			by: "ai"
		})
		expect(receipt.portrayals).not.toEqual(seenMidRun)
		// And the stored blob is the pinned one, not the mid-run one.
		const [row] = await db
			.select({ receipt: schema.pipelineRuns.receipt })
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.runId, receipt.runId))
		expect((row!.receipt as any).portrayals[`character:${theirs.id}`]).toEqual(
			{ by: "ai" }
		)
		// Leave the session as it was for the tests after this one.
		await db
			.delete(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.personaId, theirs.id))
		await db
			.delete(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.characterId, theirs.id))
		await db
			.delete(schema.sessionGuests)
			.where(eq(schema.sessionGuests.userId, guest.id))
	})

	it("a guest's presence is asked about even when it is not in the cast (W4)", async () => {
		const [guest] = await db
			.insert(schema.users)
			.values({ username: "turn-presence-guest", isAdmin: false })
			.returning()
		const [elara] = await db
			.insert(schema.characters)
			.values({
				userId: guest.id,
				name: "Elara",
				description: "The guest's persona — in the session, not the cast.",
				isPersona: true
			})
			.returning()
		await db
			.insert(schema.sessionGuests)
			.values({ sessionId, userId: guest.id })
		await db
			.insert(schema.sessionPersonas)
			.values({ sessionId, personaId: elara.id })
		try {
			const receipt: any = await turn({ seed: "turn:presence" })
			expect(receipt.portrayals[`character:${elara.id}`]).toEqual({
				by: "person",
				userId: String(guest.id)
			})
		} finally {
			await db
				.delete(schema.sessionPersonas)
				.where(eq(schema.sessionPersonas.personaId, elara.id))
			await db
				.delete(schema.sessionGuests)
				.where(eq(schema.sessionGuests.userId, guest.id))
		}
	})

	it("is resolved for a reply and for a review-gated run, and not for a pre-call preview (W1)", async () => {
		// The token count / debug preview halts before any oracle: nobody
		// speaks, nobody is portrayed, and the map is absent — not empty.
		const preview: any = await turn({
			seed: "turn:preview-portrayals",
			preview: true,
			skipReceipt: true
		})
		expect(preview.outcome).toBe("halt")
		expect(preview.preview).toBeTruthy()
		expect("portrayals" in preview).toBe(false)
		// A run parked at its write (`{ atNode }` — the summarize road) still
		// reached the model, and is answered like a reply.
		const { runSpec } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		const { CHAT_RESPOND_SPEC_ID } = await import(
			"$lib/server/pipelines/boot/bootstrap"
		)
		const gated: any = await runSpec({
			db: db as any,
			sessionId,
			userId,
			specId: CHAT_RESPOND_SPEC_ID,
			currentCharacterId: characterId,
			speaker: `character:${characterId}`,
			input: {
				text: "Have you seen the ashguard?",
				continuationPrefill: "",
				sideCharacter: null,
				speaker: `character:${characterId}`,
				sessionId,
				characterId,
				sessionScope: { sessionId, currentCharacterId: characterId },
				messageId: null,
				fields: {}
			},
			seed: "turn:gated-portrayals",
			preview: { atNode: "save" },
			skipReceipt: true
		})
		expect(gated.outcome).toBe("halt")
		expect(gated.haltNodeKey).toBe("save")
		expect(gated.portrayals[`character:${characterId}`]).toEqual({
			by: "ai"
		})
		expect(gated.portrayals.owner).toEqual({
			by: "person",
			userId: String(userId)
		})
	})
})

/**
 * Script chains, applied by the substrate on a real turn (18 §4a, U-S4).
 *
 * The chain is configuration — an override row at slot `scripts`, exactly what
 * the panel writes — and the write consumer's hook applies it to the reply
 * before it is stored. The binding is never told; the receipt is (S5).
 */
describe("script chains on a turn", () => {
	/** A hook node's key, read from the published rows by its type. */
	async function hookNodeKey(
		typeId = "core:outlet/update-message"
	): Promise<{
		specId: number
		nodeKey: string
	}> {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
			.limit(1)
		const nodes = await db
			.select()
			.from(schema.pipelineNodes)
			.where(
				eq(schema.pipelineNodes.specVersionId, spec.activeVersionId!)
			)
		const node = (nodes as any[]).find((n) => n.definitionId === typeId)!
		return { specId: spec.id, nodeKey: node.nodeKey }
	}

	async function attachChain(
		ids: number[],
		// The reply's write is the UPDATE that fills the placeholder (09-B
		// B4); the create-message before it is the placeholder itself, with
		// no text for a chain to see.
		typeId = "core:outlet/update-message"
	): Promise<void> {
		// Chains attach as the selected configuration's own value — the only
		// global home since the layer simplification (2026-08-24).
		const { specId, nodeKey } = await hookNodeKey(typeId)
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.id, specId))
			.limit(1)
		const { resolveSelectedConfig, duplicateConfig, selectConfig } =
			await import("$lib/server/pipelines/config/named")
		const selected = await resolveSelectedConfig(
			db,
			specId,
			(spec as any).slug,
			{}
		)
		let configId = selected!.configId
		const [cfg] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, configId))
			.limit(1)
		if ((cfg as any).isImmutable) {
			const copy = await duplicateConfig(db, configId, "Chain host")
			configId = copy.id
			await selectConfig(db, specId, "pub", 0, configId)
		}
		await db
			.delete(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.slot, "scripts"))
		await db
			.insert(schema.pipelineConfigValues)
			.values({
				configId,
				nodeKey,
				slot: "scripts",
				path: "",
				value: ids
			})
			.onConflictDoUpdate({
				target: [
					schema.pipelineConfigValues.configId,
					schema.pipelineConfigValues.nodeKey,
					schema.pipelineConfigValues.slot,
					schema.pipelineConfigValues.path
				],
				set: { value: ids }
			})
	}

	const receiptScripts = (receipt: any) =>
		(receipt.nodes as any[])
			.filter((n) => n.definitionId?.startsWith("core:outlet/update-message"))
			.flatMap((n) => n.scripts ?? [])

	/**
	 * What the write consumer was handed — post-scripts, pre-store. The
	 * provider's output (`generatedText`) is deliberately upstream of the
	 * write hook and must stay untouched by it.
	 */
	const writtenText = (receipt: any): string =>
		(receipt.nodes as any[]).find((n) =>
			n.definitionId?.startsWith("core:outlet/update-message")
		)?.input?.text

	it("a transform rewrites the reply before it is stored, and the receipt says so per link", async () => {
		const { createScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const shout = await createScript(db, {
			typeId: "core:script:text/transform@1",
			name: "Turn shouter"
		})
		const { updateScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		await updateScript(db, shout.id, {
			source: "ctx.log('shouting'); return text.toUpperCase()"
		})
		const broken = await createScript(db, {
			typeId: "core:script:text/transform@1",
			name: "Turn breaker"
		})
		await updateScript(db, broken.id, {
			source: "return definitely.not.defined"
		})
		await attachChain([broken.id, shout.id])

		const { generatedText } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		const receipt = await turn({ seed: "turn:scripts-transform" })

		// The broken link degraded (S2); the good one still ran; the stored
		// message is the transformed text. The provider's own output is
		// untouched — the hook sits at the write, not the generation.
		expect(generatedText(receipt)).toBe("The Ashguard ride at dawn.")
		expect(writtenText(receipt)).toBe("THE ASHGUARD RIDE AT DAWN.")
		const rows = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
		expect(rows.map((r) => r.content)).toContain(
			"THE ASHGUARD RIDE AT DAWN."
		)

		const apps = receiptScripts(receipt)
		expect(apps.map((a: any) => [a.name, a.result])).toEqual([
			["Turn breaker", "err"],
			["Turn shouter", "ok"]
		])
		expect(apps[1].changed).toBe(true)
		expect(apps[1].logs).toEqual(["shouting"])
		expect(apps[1].appliedBy).toBe("substrate")
	})

	it("a stop verdict truncates at the earliest index and marks the winner (S4)", async () => {
		const { createScript, updateScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const late = await createScript(db, {
			typeId: "core:script:text/stop@1",
			name: "Late stop"
		})
		await updateScript(db, late.id, { source: "return 17" })
		const early = await createScript(db, {
			typeId: "core:script:text/stop@1",
			name: "Early stop"
		})
		await updateScript(db, early.id, {
			source: "return text.indexOf('ride')"
		})
		await attachChain([late.id, early.id])

		const receipt = await turn({ seed: "turn:scripts-stop" })
		expect(writtenText(receipt)).toBe("The Ashguard ")
		const rows = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
		// The receipt keeps what the script chain produced (above, with its
		// trailing space); the store trims every committed body (ruling
		// 2026-09-08), so the row is the trimmed form.
		expect(rows.map((r) => r.content)).toContain("The Ashguard")

		const apps = receiptScripts(receipt)
		const winner = apps.find((a: any) => a.won)
		expect(winner?.name).toBe("Early stop")
		expect(winner?.verdict).toBe(
			"The Ashguard ride at dawn.".indexOf("ride")
		)
	})

	it("a disabled link keeps its place and does nothing", async () => {
		const { createScript, updateScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const off = await createScript(db, {
			typeId: "core:script:text/transform@1",
			name: "Turn muted"
		})
		await updateScript(db, off.id, {
			source: "return 'never'"
		})
		await updateScript(db, off.id, { enabled: false })
		await attachChain([off.id])

		const { generatedText } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		const receipt = await turn({ seed: "turn:scripts-disabled" })
		expect(generatedText(receipt)).toBe("The Ashguard ride at dawn.")
		expect(receiptScripts(receipt)).toMatchObject([
			{ name: "Turn muted", result: "skip", reason: "disabled" }
		])
	})

	it("script randomness is the run seed: same seed, same reply — new seed, new roll", async () => {
		const { createScript, updateScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const roll = await createScript(db, {
			typeId: "core:script:text/transform@1",
			name: "Turn roller"
		})
		await updateScript(db, roll.id, {
			source: "return text + ' [d20:' + (1 + Math.floor(ctx.random() * 20)) + ']'"
		})
		await attachChain([roll.id])

		const a = await turn({ seed: "turn:scripts-seeded" })
		const b = await turn({ seed: "turn:scripts-seeded" })
		const c = await turn({ seed: "turn:scripts-reseeded" })
		expect(writtenText(a)).toMatch(/\[d20:\d+\]$/)
		expect(writtenText(a)).toEqual(writtenText(b))
		// A different seed is allowed a different roll — and with 20 faces it
		// gets one often enough that asserting inequality would flake; what is
		// pinned is that the seed is the *only* input.
		expect(writtenText(c)).toMatch(/\[d20:\d+\]$/)
	})

	it("the kill switch returns every run to vanilla — chains kept, doing nothing (18 §10)", async () => {
		const { createScript, updateScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const shout = await createScript(db, {
			typeId: "core:script:text/transform@1",
			name: "Turn switched-off shouter"
		})
		await updateScript(db, shout.id, {
			source: "return text.toUpperCase()"
		})
		await attachChain([shout.id])
		await db
			.update(schema.systemSettings)
			.set({ scriptsEnabled: false })
			.where(eq(schema.systemSettings.id, 1))

		try {
			const receipt = await turn({ seed: "turn:scripts-killswitch" })
			// Vanilla: untransformed, and not one application recorded — the
			// host supplied no engine, so the seam never engaged.
			expect(writtenText(receipt)).toBe("The Ashguard ride at dawn.")
			expect(receiptScripts(receipt)).toEqual([])
		} finally {
			await db
				.update(schema.systemSettings)
				.set({ scriptsEnabled: true })
				.where(eq(schema.systemSettings.id, 1))
			await attachChain([])
		}
	})

	it("the input hook shapes what retrieval sees — the stored message untouched", async () => {
		// 18 §4a: `user-message` declares an after-phase hook over the text it
		// publishes. A transform that surfaces a keyword makes lore fire that
		// otherwise would not — while the stored user message, written before
		// the turn began, keeps its bytes by construction.
		const { createScript, updateScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const expander = await createScript(db, {
			typeId: "core:script:text/transform@1",
			name: "Turn expander"
		})
		await updateScript(db, expander.id, {
			// The user typed a nickname; the script resolves it to the key the
			// lorebook actually uses.
			source: "return text.replace('the riders', 'the ashguard')"
		})
		await attachChain([expander.id], "core:inlet/user-message")

		const receipt: any = await turn({
			preview: true,
			seed: "turn:scripts-input",
			text: "Tell me about the riders."
		})
		/**
		 * Either wire shape, flattened — the ORDER is what this asserts.
		 *
		 * The test before this one registers a KoboldCPP connection as the
		 * instance default and leaves it registered, and that connection resolves
		 * to chat wire mode: assemble emits role-tagged messages and `rendered`
		 * is undefined. Reading only the string made this depend on which
		 * connection a previous test happened to leave behind. Joining the
		 * messages preserves their order, which is the whole claim — the
		 * injection sits after the newest real message and before the seed line,
		 * whatever shape the connection takes.
		 */
		const out = receipt.preview?.context?.rendered
		const rendered: string =
			out?.rendered ??
			(out?.messages ?? [])
				.map((m: { content: string }) => m.content)
				.join("\n")
		// The keyword scan saw the transformed text, so the entry fired.
		expect(rendered).toContain("The Ashguard")

		const apps = (receipt.nodes as any[])
			.filter((n: any) => n.definitionId?.startsWith("core:inlet/user-message"))
			.flatMap((n: any) => n.scripts ?? [])
		expect(apps).toMatchObject([
			{ name: "Turn expander", result: "ok", changed: true }
		])
	})

	it("a connection's stop guard rides every run against it, recorded with provenance", async () => {
		// 18 §4b: model knowledge accumulates on the connection. The pipeline
		// configured no chain at all — the guard arrives because the instance
		// default connection carries it, resolved by the same rule dispatch
		// uses, and the receipt's `via` names the side that supplied it (§4c).
		await attachChain([]) // no pipeline chain: the connection acts alone
		const [conn] = await db
			.insert(schema.connections)
			.values({
				name: "Turn Kobold",
				type: "koboldcpp",
				/**
				 * ⚠ Completion wire mode, and it is this FIXTURE's property
				 * rather than a preference.
				 *
				 * This connection stays registered as the instance default for
				 * every test after this one, and the file's context template
				 * (`Turn Context`, above) is written without `{{#systemBlock}}`
				 * and friends — deliberately minimal, so the injection cases can
				 * read positions out of one flat string. A chat-mode connection
				 * would render that template into a conversation with no role
				 * blocks to find, which `assemble.ts` refuses by name.
				 */
				capabilities: { overrides: { wire_chat: false } }
			})
			.returning()
		// "The instance default connection carries it" is the whole point of this
		// test, and since 0181 that means a registered `connection_defaults` row
		// rather than `system_settings.default_connection_id`. `connectionStopsFor`
		// reads it through the same resolver dispatch does, which is what keeps
		// the guard attached to the connection the run actually uses.
		// The MODEL half of the pair. A registration names both halves — an
		// endpoint on its own is incomplete and the turn refuses before the
		// guard is ever consulted.
		const { ensureConnectionModel } = await import(
			"$lib/server/connections/models"
		)
		const connModel = await ensureConnectionModel(db, conn.id, "turn-7b")
		const { setCapabilityDefault } = await import(
			"$lib/server/connections/capabilityDefaults"
		)
		await setCapabilityDefault(db, "text->text", {
			connectionId: conn.id,
			connectionModelId: connModel!.id
		})

		const { createScript, updateScript, attachConnectionScript } =
			await import("$lib/server/pipelines/entities/scripts")
		const guard = await createScript(db, {
			typeId: "core:script:text/stop@1",
			name: "Dawn guard"
		})
		await updateScript(db, guard.id, {
			source: "return text.indexOf('at dawn')"
		})
		await attachConnectionScript(db, conn.id, guard.id)

		try {
			const receipt = await turn({ seed: "turn:connection-stop" })
			expect(writtenText(receipt)).toBe("The Ashguard ride ")

			const apps = receiptScripts(receipt)
			const winner = apps.find((a: any) => a.won)
			// `via` says which SIDE supplied the guard, which is the provenance
			// a receipt reader needs; WHICH connection it was is identity, and
			// this record is stored in the receipt blob `pipelines:run` hands
			// back to whoever owns the run — a non-admin included. So the name
			// moved to `connectionName`, a key `withoutConnectionIdentity` has
			// always removed.
			expect(winner).toMatchObject({
				name: "Dawn guard",
				via: "connection",
				connectionName: "Turn Kobold",
				appliedBy: "substrate"
			})
			const { redactConnections } = await import(
				"$lib/server/connections/visibility"
			)
			expect(
				JSON.stringify(redactConnections(winner, { isAdmin: false }))
			).not.toContain("Turn Kobold")
		} finally {
			// Released so the tests after this one run against a bare default
			// connection rather than inheriting the guard.
			const { detachConnectionScript } = await import(
				"$lib/server/pipelines/entities/scripts"
			)
			await detachConnectionScript(db, conn.id, guard.id)
		}
	})

	it("an injection renders in the template's own loop, at its depth — never a splice", async () => {
		// The ruling of 2026-08-23: inject scripts attach on the *context
		// builder*, land as `context.injections`, resolve to a render index
		// beside `postHistory.targetIndex`, and the shipped template's loop
		// renders them — visible, movable, corpus-checkable (§20).
		const { createScript, updateScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const reminder = await createScript(db, {
			typeId: "core:script:messages/inject@1",
			name: "Turn reminder"
		})
		await updateScript(db, reminder.id, {
			source: "return [{ role: 'system', content: '[Stay terse.]', depth: 0 }]"
		})
		await attachChain([reminder.id], "core:task/build-template-context")

		const receipt: any = await turn({
			preview: true,
			seed: "turn:scripts-inject"
		})
		const rendered: string =
			receipt.preview?.context?.rendered?.rendered ?? ""

		// Depth 0 is the seed placeholder's own iteration: after the newest
		// real message, before the seed line the model continues from — the
		// same arithmetic postHistory uses.
		const note = rendered.indexOf("[Stay terse.]")
		const lastMessage = rendered.indexOf("Have you seen the ashguard?")
		const seedLine = rendered.lastIndexOf("Alice:")
		expect(note).toBeGreaterThan(lastMessage)
		expect(note).toBeLessThan(seedLine)

		// Recorded on the context node — additive, never a message-list edit.
		const apps = (receipt.nodes as any[])
			.filter((n: any) =>
				n.definitionId?.startsWith("core:task/build-template-context")
			)
			.flatMap((n: any) => n.scripts ?? [])
		expect(apps).toMatchObject([
			{ name: "Turn reminder", result: "ok", changed: true }
		])
	})
})

/**
 * The presser's own line (G9, contracts batch 2, 2026-09-17).
 *
 * The inlet publishes `presser` — asserted on the receipt above — and the
 * half that makes it worth publishing is what a spec can then DO with it:
 * wire it into `create-message@1`'s `speaker` and the row is written as the
 * person who pressed, not as the model. The host path existed already
 * (`speaker: 'user:<id>'` naming the run owner, with no character at all, is
 * `role: user` under their id and no persona); nothing carried the reference
 * to put in it, so a plugin that wanted the player's own line had to ride it
 * on the opponent's reply as a block (plan §12).
 *
 * `speaker` is handed the exact string `$.input.presser` resolves to, which
 * is the wiring under test — the node between them is the executor's, and
 * `resolveInput` copying a port into a config key is proved everywhere else
 * in this file.
 */
describe("a line written as whoever pressed", () => {
	it("writes a user-role row for the presser, with no persona", async () => {
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db as any, { sessionId, userId })
		const res = (await host.commit!(
			{ text: "I press the button.", speaker: `user:${userId}` },
			{ key: "say", definitionId: "core:outlet/create-message" } as any
		)) as { id: number }

		const [row] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, res.id))
		expect(row!.role).toBe("user")
		expect(row!.userId).toBe(userId)
		// A persona-less line is its author's: no persona, no character.
		expect(row!.personaId).toBeNull()
		expect(row!.characterId).toBeNull()
		// And the reference is on the row, which is what the client renders by.
		expect((row!.metadata as any)?.speaker).toBe(`user:${userId}`)
	})

	it("is still the model's line when nobody is named", async () => {
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db as any, { sessionId, userId })
		const res = (await host.commit!(
			{ text: "The wind picks up." },
			{ key: "say", definitionId: "core:outlet/create-message" } as any
		)) as { id: number }
		const [row] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, res.id))
		expect(row!.role).toBe("assistant")
	})
})
