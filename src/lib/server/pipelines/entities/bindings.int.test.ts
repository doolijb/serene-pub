/**
 * The two rebinding seams (19 §3, §5).
 *
 * What is pinned, binding side (plans/31 V2 — one identity): a binding is
 * about a **subject**. An action's identity is served by its declarer and
 * nobody else — a foreign narrator is its own action, never an alternative
 * to core's — so the row selects **among the eligible** only on an event
 * subject: a session-scope row on the primary turn beats the companion
 * default, an ineligible bind refuses at write in a sentence, a bind whose
 * spec stops serving falls through at read, and clearing is reset-is-delete.
 *
 * Node side, end to end: swapping a session's next-speaker strategy changes the
 * type the run executes — with no explicit pick, the rebound round-robin
 * *decides*, and the receipt names the substituted type with no extra
 * bookkeeping. A stale or incompatible rebind row degrades to the pin at
 * load; a run never fails because a swap went wrong.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

class FakeAdapter {
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
	// The TEXT action, by its name. `generate` named both this and a render
	// until the actions were split; a fake that kept the old name would go on
	// passing while `dispatch` called something no adapter has.
	async generateText() {
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: "The Ashguard ride at dawn."
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
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: async () => ({
		sampling: { id: 1 },
		contextConfig: { id: 1 },
		promptConfig: { id: 1, systemPrompt: "Stay in character." }
	})
}))
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

// The standard genre's own id (24 §3) — the id sessions carry.
const STANDARD = "core:genre/chat"
const CORE_NARRATE = "core:spec/narrate"
const STAGE_NARRATE = "chariot.stage:spec/dramatic-narrate"
const CORE_RESPOND = "core:spec/respond"
/** A second member of the primary-turn bucket, seeded below: the same lock, and a message write. */
const STAGE_RESPOND = "chariot.stage:spec/dramatic-respond"

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "bindings-test", isAdmin: false })
		.returning()
	userId = user.id
	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Alice", description: "A knight." })
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
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	sessionId = session.id
	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId,
		isActive: true,
		visibility: "visible"
	})
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId, personaId: persona.id })
	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "Have you seen the ashguard?",
		personaId: persona.id
	})

	const [contextConfig] = await db
		.insert(schema.contextConfigs)
		.values({ name: "Bindings Context", template: "{{instructions}}" })
		.returning()
	const [promptConfig] = await db
		.insert(schema.promptConfigs)
		.values({ name: "Bindings Prompt", systemPrompt: "You are {{char}}." })
		.returning()
	await db.insert(schema.systemSettings).values({
		id: 1,
		defaultContextConfigId: contextConfig.id,
		defaultPromptConfigId: promptConfig.id
	})

	// A second narrate contributor: a foreign spec whose active published
	// version declares the trigger. Contributed functions need no nodes —
	// eligibility is the declaration.
	const [spec] = await db
		.insert(schema.pipelineSpecs)
		.values({ slug: STAGE_NARRATE, name: "Dramatic Narrator" } as any)
		.returning()
	const [version] = await db
		.insert(schema.pipelineSpecVersions)
		.values({
			specId: spec.id,
			semver: "1.0.0",
			status: "published",
			canonicalHash: "test-dramatic-narrate",
			contributes: {
				triggers: [
					{
						genre: STANDARD,
						function: "narrate",
						kind: "button",
						i18n: { en: "Dramatize" }
					}
				]
			}
		} as any)
		.returning()
	await db
		.update(schema.pipelineSpecs)
		.set({ activeVersionId: version.id })
		.where(eq(schema.pipelineSpecs.id, spec.id))

	// A second answer to the primary turn (plans/31 V2): a foreign spec whose
	// active published version carries the same inlet lock as core's respond
	// — (chat, message-respond) — and writes a session message (19 §0). That
	// is the whole of bucket membership; the nodes need not run.
	const [respondSpec] = await db
		.insert(schema.pipelineSpecs)
		.values({ slug: STAGE_RESPOND, name: "Dramatic Respond" } as any)
		.returning()
	const [respondVersion] = await db
		.insert(schema.pipelineSpecVersions)
		.values({
			specId: respondSpec.id,
			semver: "1.0.0",
			status: "published",
			canonicalHash: "test-dramatic-respond",
			inputGenre: STANDARD,
			inputEvent: "core:event/message-respond@1"
		} as any)
		.returning()
	await db.insert(schema.pipelineNodes).values([
		{
			specVersionId: respondVersion.id,
			nodeKey: "input",
			kind: "inlet",
			definitionId: "core:inlet/user-message",
			definitionVersion: 1,
			position: 0
		},
		{
			specVersionId: respondVersion.id,
			nodeKey: "save",
			kind: "outlet",
			definitionId: "core:outlet/create-message",
			definitionVersion: 1,
			position: 1
		}
	] as any)
	await db
		.update(schema.pipelineSpecs)
		.set({ activeVersionId: respondVersion.id })
		.where(eq(schema.pipelineSpecs.id, respondSpec.id))
}, 60_000)

describe("bindings (19 §3; plans/31 V2)", () => {
	it("an action identity is served by its declarer alone — a foreign narrator is a second action, not an alternative", async () => {
		const { resolveSubjectSpec } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const { bindSubject, subjectCandidates } = await import(
			"$lib/server/pipelines/entities/bindings"
		)

		// Two actions, two subjects: each names its own declarer.
		expect(await subjectCandidates(db, STANDARD, `${CORE_NARRATE}#narrate`)).toEqual([CORE_NARRATE])
		expect(await subjectCandidates(db, STANDARD, `${STAGE_NARRATE}#narrate`)).toEqual([STAGE_NARRATE])
		expect(await resolveSubjectSpec(db, STANDARD, `${CORE_NARRATE}#narrate`, { sessionId })).toBe(CORE_NARRATE)
		expect(await resolveSubjectSpec(db, STANDARD, `${STAGE_NARRATE}#narrate`, { sessionId })).toBe(STAGE_NARRATE)

		// Binding core's narrator to the stage's spec is refused: the stage
		// spec does not serve that identity — it serves its own.
		const refused = await bindSubject(db, {
			scope: { kind: "session", id: sessionId },
			genreId: STANDARD,
			subject: `${CORE_NARRATE}#narrate`,
			specSlug: STAGE_NARRATE,
			userId
		})
		expect(refused.error).toContain(`does not serve '${CORE_NARRATE}#narrate'`)

		// Something that is neither an identity nor an event id is refused by name.
		const bare = await bindSubject(db, {
			scope: { kind: "session", id: sessionId },
			genreId: STANDARD,
			subject: "narrate",
			specSlug: STAGE_NARRATE,
			userId
		})
		expect(bare.error).toMatch(/'narrate' is not something a binding is about/)
	})

	it("the binding selects among the eligible on an event subject — session scope beats the companion default", async () => {
		const { resolveSubjectSpec } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const { bindSubject, subjectCandidates } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const { sessionEvents } = await import("@serene-pub/sdk")
		const RESPOND = sessionEvents.messageRespond

		// The bucket: core's respond spec, and the second one seeded below.
		const candidates = await subjectCandidates(db, STANDARD, RESPOND)
		expect(candidates).toEqual(expect.arrayContaining([CORE_RESPOND, STAGE_RESPOND]))
		expect(await resolveSubjectSpec(db, STANDARD, RESPOND, { sessionId })).toBe(CORE_RESPOND)

		// This session picks the foreign one for its turns.
		const bound = await bindSubject(db, {
			scope: { kind: "session", id: sessionId },
			genreId: STANDARD,
			subject: RESPOND,
			specSlug: STAGE_RESPOND,
			userId
		})
		expect(bound.error).toBeUndefined()
		expect(await resolveSubjectSpec(db, STANDARD, RESPOND, { sessionId })).toBe(STAGE_RESPOND)
		// …and the event road reads the same row (R-6, the event half).
		const { resolveSessionEventSpec } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		expect(await resolveSessionEventSpec(db, STANDARD, RESPOND, { sessionId })).toBe(STAGE_RESPOND)
		// Another session still gets the default — the binding is scoped.
		expect(await resolveSubjectSpec(db, STANDARD, RESPOND, { sessionId: sessionId + 999 })).toBe(
			CORE_RESPOND
		)
	})

	it("an ineligible bind refuses at write; a bind gone stale falls through at read", async () => {
		const { resolveSubjectSpec } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const { bindSubject } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const { sessionEvents } = await import("@serene-pub/sdk")
		const RESPOND = sessionEvents.messageRespond

		// The narrate spec does not answer the primary turn.
		const refused = await bindSubject(db, {
			scope: { kind: "session", id: sessionId },
			genreId: STANDARD,
			subject: RESPOND,
			specSlug: CORE_NARRATE,
			userId
		})
		expect(refused.error).toContain(`does not serve '${RESPOND}'`)

		// Retire the bound contributor: the session-scope row still exists, but
		// eligibility is re-checked at read, so resolution falls through.
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, STAGE_RESPOND))
		await db
			.update(schema.pipelineSpecs)
			.set({ activeVersionId: null })
			.where(eq(schema.pipelineSpecs.id, spec.id))
		expect(await resolveSubjectSpec(db, STANDARD, RESPOND, { sessionId })).toBe(CORE_RESPOND)

		// Restore, then clear: reset-is-delete, back to the default.
		const [version] = await db
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.specId, spec.id))
		await db
			.update(schema.pipelineSpecs)
			.set({ activeVersionId: version.id })
			.where(eq(schema.pipelineSpecs.id, spec.id))
		const cleared = await bindSubject(db, {
			scope: { kind: "session", id: sessionId },
			genreId: STANDARD,
			subject: RESPOND,
			specSlug: null,
			userId
		})
		expect(cleared.error).toBeUndefined()
		expect(await resolveSubjectSpec(db, STANDARD, RESPOND, { sessionId })).toBe(CORE_RESPOND)
	})
})

describe("the strategy swap (19 §5)", () => {
	it("swapping to round-robin changes what the run executes — and it decides", async () => {
		const { setSessionSpeakerStrategy, getSessionSpeakerStrategy } =
			await import("$lib/server/pipelines/entities/bindings")
		const { runTurn } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)

		const set = await setSessionSpeakerStrategy(db, {
			sessionId,
			userId,
			definitionId: "core:task/turn-round-robin@1"
		})
		expect(set.error).toBeUndefined()
		expect(await getSessionSpeakerStrategy(db, sessionId)).toBe(
			"core:task/turn-round-robin@1"
		)

		// No explicit pick: under the pinned turn-manual this turn would have
		// no speaker at all. The rebound strategy decides — Alice has never
		// replied, so the rotation seats her.
		const receipt = await runTurn({
			db: db,
			sessionId,
			userId,
			currentCharacterId: null,
			text: "Who rides next?",
			seed: "rebind:1",
			skipReceipt: true
		})
		const speaker = receipt.nodes.find((n: any) => n.nodeKey === "speaker")
		expect(speaker!.definitionId).toBe("core:task/turn-round-robin@1")
		expect(speaker!.output).toMatchObject({
			characterId,
			strategy: "round-robin",
			main: { via: "strategy" }
		})
	}, 30_000)

	it("a non-strategy refuses at write; an incompatible row degrades to the pin at load", async () => {
		const { setSessionSpeakerStrategy, applyNodeRebinds, setNodeRebind } =
			await import("$lib/server/pipelines/entities/bindings")
		const { loadPublished } = await import(
			"$lib/server/pipelines/boot/bootstrap"
		)

		const refused = await setSessionSpeakerStrategy(db, {
			sessionId,
			userId,
			definitionId: "core:task/assemble@2"
		})
		expect(refused.error).toContain("not a next-speaker strategy")

		// The generic setter refuses on shape too.
		const generic = await setNodeRebind(db, {
			scope: { kind: "session", id: sessionId },
			specSlug: "core:spec/respond",
			nodeKey: "speaker",
			definitionId: "core:task/assemble@2",
			userId
		})
		expect(generic.error).toContain("does not publish the same shape")

		// A row that went bad *after* writing (forged, or stale across a
		// re-projection) is the load-side guard's case: the pin survives.
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/respond"))
		await db.insert(schema.pipelineNodeRebinds).values({
			specId: spec.id,
			scopeKind: "session",
			scopeId: sessionId,
			nodeKey: "prompt",
			definitionId: "core:task/turn-none@1", // wrong shape for `prompt`
			updatedBy: userId
		})
		const doc = await applyNodeRebinds(
			db,
			await loadPublished(db, "core:spec/respond"),
			{ specSlug: "core:spec/respond", sessionId }
		)
		const prompt = (doc.nodes as any[]).find((n) => n.key === "prompt")
		expect(prompt.definitionId).toBe("core:task/assemble")

		// And the good rebind from the previous test is still in force.
		const speaker = (doc.nodes as any[]).find((n) => n.key === "speaker")
		expect(speaker.definitionId).toBe("core:task/turn-round-robin")
	})

	it("clearing restores the pin — reset-is-delete", async () => {
		const { setSessionSpeakerStrategy, getSessionSpeakerStrategy } =
			await import("$lib/server/pipelines/entities/bindings")
		const cleared = await setSessionSpeakerStrategy(db, {
			sessionId,
			userId,
			definitionId: null
		})
		expect(cleared.error).toBeUndefined()
		expect(await getSessionSpeakerStrategy(db, sessionId)).toBe(null)
	})
})
