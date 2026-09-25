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
import { and, eq } from "drizzle-orm"
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

describe("the session-scope rebind (PLAN-turn-order §4.7, R28, R29)", () => {
	// Chat's own turn-order spec (R27): the session under test is a chat session.
	const TURN_ORDER = "core:spec/chat-turn-order"
	// Chat's strategy sits behind its model path (M4): the key comes from the
	// table in the app, spelled here.
	const STRATEGY = "decide.rules.strategy"

	it("writes a session-scope rebind of the turn-order spec's `strategy` node", async () => {
		const { setSessionNodeRebind } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const set = await setSessionNodeRebind(db, {
			sessionId,
			userId,
			spec: TURN_ORDER,
			nodeKey: STRATEGY,
			definitionId: "core:task/turn-user-split@1"
		})
		expect(set.error).toBeUndefined()
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, TURN_ORDER))
		const [row] = await db
			.select()
			.from(schema.pipelineNodeRebinds)
			.where(
				and(
					eq(schema.pipelineNodeRebinds.specId, spec.id),
					eq(schema.pipelineNodeRebinds.scopeKind, "session"),
					eq(schema.pipelineNodeRebinds.scopeId, sessionId)
				)
			)
		expect(row).toMatchObject({
			nodeKey: STRATEGY,
			definitionId: "core:task/turn-user-split@1"
		})

		// And it is what the spec actually runs.
		const { applyNodeRebinds } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const { loadPublished } = await import(
			"$lib/server/pipelines/boot/bootstrap"
		)
		const doc = await applyNodeRebinds(
			db,
			await loadPublished(db, TURN_ORDER),
			{ specSlug: TURN_ORDER, sessionId }
		)
		expect(
			(doc.nodes as any[]).find((n) => n.key === STRATEGY).definitionId
		).toBe("core:task/turn-user-split")
	})

	it("offers the pin first, then the node's declared swaps, read off the registry", async () => {
		const { listSessionNodeSwaps } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, TURN_ORDER))
		const offered = await listSessionNodeSwaps(db, {
			spec: TURN_ORDER,
			nodeKey: STRATEGY,
			specVersionId: spec.activeVersionId!
		})
		expect(offered.map((o) => o.definitionId)).toEqual([
			"core:task/turn-round-robin@1",
			"core:task/turn-user-split@1",
			"core:task/turn-random@1",
			"core:task/turn-scripted@1",
			"core:task/turn-manual@1",
			"core:task/turn-narrator@1"
		])
	})

	it("refuses a definition the node does not offer", async () => {
		const { setSessionNodeRebind } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const refused = await setSessionNodeRebind(db, {
			sessionId,
			userId,
			spec: TURN_ORDER,
			nodeKey: STRATEGY,
			definitionId: "core:task/assemble@2"
		})
		expect(refused.error).toContain("is not offered")
	})

	it("refuses a spec that serves another genre — the rebind would never run", async () => {
		const { setSessionNodeRebind } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const refused = await setSessionNodeRebind(db, {
			sessionId,
			userId,
			spec: "core:spec/adventure-turn-order",
			nodeKey: STRATEGY,
			definitionId: "core:task/turn-narrator@1"
		})
		expect(refused.error).toContain("serves 'core:genre/adventure'")
	})

	it("lists the session's pipeline cards: the turn-order strategy, with its offered swaps (A8)", async () => {
		const { listSessionPipelineCards } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const cards = await listSessionPipelineCards(db, sessionId)
		const card = cards.find((c) => c.spec === TURN_ORDER && c.nodeKey === STRATEGY)
		expect(card).toBeDefined()
		expect(card!.options.length).toBeGreaterThan(1)
		expect(card!.default).toBe(card!.options[0].definitionId)
	})

	it("refuses a spec whose lock answers no event — nothing would run the rebind (A7r review)", async () => {
		const { setSessionNodeRebind } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const [spec] = await db
			.select({ activeVersionId: schema.pipelineSpecs.activeVersionId })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, TURN_ORDER))
		const [before] = await db
			.select({
				inputEvent: schema.pipelineSpecVersions.inputEvent,
				inputEvents: schema.pipelineSpecVersions.inputEvents
			})
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.id, spec.activeVersionId!))
		await db
			.update(schema.pipelineSpecVersions)
			.set({ inputEvent: null, inputEvents: null })
			.where(eq(schema.pipelineSpecVersions.id, spec.activeVersionId!))
		try {
			const refused = await setSessionNodeRebind(db, {
				sessionId,
				userId,
				spec: TURN_ORDER,
				nodeKey: STRATEGY,
				definitionId: "core:task/turn-user-split@1"
			})
			expect(refused.error).toContain("answers no event")
		} finally {
			await db
				.update(schema.pipelineSpecVersions)
				.set(before)
				.where(eq(schema.pipelineSpecVersions.id, spec.activeVersionId!))
		}
	})

	it("refuses a node not in session settings, and a definition a session node does not offer", async () => {
		const { setSessionNodeRebind } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		// `write` is the outlet: not in session settings at all.
		const outlet = await setSessionNodeRebind(db, {
			sessionId,
			userId,
			spec: TURN_ORDER,
			nodeKey: "write",
			definitionId: "core:outlet/set-turn-order@1"
		})
		expect(outlet.error).toContain("not a node a session may swap")
		// `pool` is in session settings for its params, and offers only its
		// pin (plus any contribution) — a strategy is not among them.
		const pool = await setSessionNodeRebind(db, {
			sessionId,
			userId,
			spec: TURN_ORDER,
			nodeKey: "pool",
			definitionId: "core:task/turn-random@1"
		})
		expect(pool.error).toContain("is not offered")
	})

	it("refuses a node the spec does not have at all", async () => {
		const { setSessionNodeRebind } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const refused = await setSessionNodeRebind(db, {
			sessionId,
			userId,
			spec: TURN_ORDER,
			nodeKey: "nope",
			definitionId: "core:task/turn-manual@1"
		})
		expect(refused.error).toContain("no node 'nope'")
	})

	it("a plugin's own spec is rebindable exactly like core's — the mark rides the row (R26)", async () => {
		const { setSessionNodeRebind } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		const { turnOrderSpec, chatGenre } = await import("@serene-pub/core-catalog")
		const C = await import("@serene-pub/contracts")
		await saveDocument(
			db,
			turnOrderSpec({
				id: "acme.rp:spec/chat-turn-order-alt",
				genre: chatGenre,
				events: ["core:event/message-completed@1"],
				strategy: C.turnRoundRobin,
				swaps: [C.turnRandom]
			}),
			{ publish: true }
		)
		const rebind = () =>
			setSessionNodeRebind(db, {
				sessionId,
				userId,
				spec: "acme.rp:spec/chat-turn-order-alt",
				nodeKey: "strategy",
				definitionId: "core:task/turn-random@1"
			})
		// Not a pipeline this session runs: a swap there would change nothing.
		expect((await rebind()).error).toMatch(/is not a pipeline this session runs/)
		// Once the session runs it — its own binding — the swap is its to make.
		const { bindSubject } = await import("$lib/server/pipelines/entities/bindings")
		const bound = await bindSubject(db, {
			scope: { kind: "session", id: sessionId },
			genreId: "core:genre/chat",
			subject: "core:event/message-completed@1",
			specSlug: "acme.rp:spec/chat-turn-order-alt",
			userId
		})
		expect(bound.error).toBeUndefined()
		expect((await rebind()).error).toBeUndefined()
	})

	it("an enabled plugin's contribution is offered after the declared swaps; a disabled one is not", async () => {
		const { listSessionNodeSwaps, swapKey } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		await db.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: "acme:task/turn-natural",
			version: 1,
			kind: "task",
			// Public: a contribution runs in core's pipeline (R62).
			isPublic: true,
			i18n: { name: { en: "Natural" } },
			// A strategy's ports, as the install check (plugins/swaps.ts) holds it to.
			ports: {
				in: { candidates: "core:shape/turn-candidates@1", messages: "core:shape/messages@1" },
				out: { main: "core:shape/turn-entries@1", order: "core:shape/turn-entries@1" }
			}
		})
		await db.insert(schema.plugins).values({
			pluginId: "acme",
			name: "Acme",
			bundleSource: "// x",
			bundleHash: "deadbeef",
			enabled: true,
			manifest: {
				swaps: [{ spec: TURN_ORDER, node: STRATEGY, definition: "acme:task/turn-natural@1" }]
			}
		})
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, TURN_ORDER))
		const list = () =>
			listSessionNodeSwaps(db, {
				spec: TURN_ORDER,
				nodeKey: STRATEGY,
				specVersionId: spec.activeVersionId!
			})
		const offered = (await list()).map((o) => o.definitionId)
		expect(offered.at(-1)).toBe("acme:task/turn-natural@1")
		expect((await list()).at(-1)?.name).toBe("Natural")

		// A session picks it — the row is written through the one verb.
		const { setSessionNodeRebind, applyNodeRebinds } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const { loadPublished } = await import("$lib/server/pipelines/boot/bootstrap")
		expect(
			(
				await setSessionNodeRebind(db, {
					sessionId,
					userId,
					spec: TURN_ORDER,
					nodeKey: STRATEGY,
					definitionId: "acme:task/turn-natural@1"
				})
			).error
		).toBeUndefined()

		await db
			.update(schema.plugins)
			.set({ disabledSwaps: [swapKey(TURN_ORDER, STRATEGY, "acme:task/turn-natural@1")] })
			.where(eq(schema.plugins.pluginId, "acme"))
		expect((await list()).map((o) => o.definitionId)).not.toContain("acme:task/turn-natural@1")
		// Disabling withdraws it from the session that already picked it, not
		// only from new picks (M2 review): the run falls back to the pin.
		const doc = await applyNodeRebinds(db, await loadPublished(db, TURN_ORDER), {
			specSlug: TURN_ORDER,
			sessionId
		})
		expect((doc.nodes as any[]).find((n) => n.key === STRATEGY).definitionId).toBe(
			"core:task/turn-round-robin"
		)
		// And the person can still clear it.
		expect(
			(
				await setSessionNodeRebind(db, {
					sessionId,
					userId,
					spec: TURN_ORDER,
					nodeKey: STRATEGY,
					definitionId: null
				})
			).error
		).toBeUndefined()

		await db
			.update(schema.plugins)
			.set({ disabledSwaps: [], enabled: false })
			.where(eq(schema.plugins.pluginId, "acme"))
		expect((await list()).map((o) => o.definitionId)).not.toContain("acme:task/turn-natural@1")
	})

	it("clearing restores the pin — reset-is-delete", async () => {
		const { setSessionNodeRebind, applyNodeRebinds } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const { loadPublished } = await import(
			"$lib/server/pipelines/boot/bootstrap"
		)
		const cleared = await setSessionNodeRebind(db, {
			sessionId,
			userId,
			spec: TURN_ORDER,
			nodeKey: STRATEGY,
			definitionId: null
		})
		expect(cleared.error).toBeUndefined()
		const doc = await applyNodeRebinds(
			db,
			await loadPublished(db, TURN_ORDER),
			{ specSlug: TURN_ORDER, sessionId }
		)
		expect(
			(doc.nodes as any[]).find((n) => n.key === STRATEGY).definitionId
		).toBe("core:task/turn-round-robin")
	})
})
