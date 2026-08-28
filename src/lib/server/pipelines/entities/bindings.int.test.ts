/**
 * The two rebinding seams (19 §3, §5).
 *
 * What is pinned, function side: the binding selects **among the eligible**
 * only — a session-scope row beats the companion default, an ineligible bind
 * refuses at write in a sentence, a bind whose spec stops serving falls
 * through at read, and clearing is reset-is-delete.
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
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	abort() {}
	async generate() {
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

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)

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
		.insert(schema.personas)
		.values({
			userId,
			name: "Bob",
			description: "A traveller.",
			isDefault: false
		})
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	sessionId = session.id
	await db
		.insert(schema.sessionCharacters)
		.values({
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
}, 60_000)

describe("function bindings (19 §3)", () => {
	it("the binding selects among the eligible — session scope beats the companion default", async () => {
		const { resolveFunctionSpec } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const { bindFunction, functionCandidates } = await import(
			"$lib/server/pipelines/entities/bindings"
		)

		// Both serve; the companion (core) wins by default.
		expect(
			await functionCandidates(db as any, STANDARD, "narrate")
		).toEqual(expect.arrayContaining([CORE_NARRATE, STAGE_NARRATE]))
		expect(
			await resolveFunctionSpec(db as any, STANDARD, "narrate", {
				sessionId
			})
		).toBe(CORE_NARRATE)

		// This session picks the foreign contributor.
		const bound = await bindFunction(db as any, {
			scope: { kind: "session", id: sessionId },
			genreId: STANDARD,
			functionKey: "narrate",
			specSlug: STAGE_NARRATE,
			userId
		})
		expect(bound.error).toBeUndefined()
		expect(
			await resolveFunctionSpec(db as any, STANDARD, "narrate", {
				sessionId
			})
		).toBe(STAGE_NARRATE)
		// Another session still gets the default — the binding is scoped.
		expect(
			await resolveFunctionSpec(db as any, STANDARD, "narrate", {
				sessionId: sessionId + 999
			})
		).toBe(CORE_NARRATE)
	})

	it("an ineligible bind refuses at write; a bind gone stale falls through at read", async () => {
		const { resolveFunctionSpec } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const { bindFunction } = await import(
			"$lib/server/pipelines/entities/bindings"
		)

		// The respond spec does not serve narrate.
		const refused = await bindFunction(db as any, {
			scope: { kind: "session", id: sessionId },
			genreId: STANDARD,
			functionKey: "narrate",
			specSlug: "core:spec/respond",
			userId
		})
		expect(refused.error).toContain("does not serve 'narrate'")

		// Retire the bound contributor: the session-scope row still exists, but
		// eligibility is re-checked at read, so resolution falls through.
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, STAGE_NARRATE))
		await db
			.update(schema.pipelineSpecs)
			.set({ activeVersionId: null })
			.where(eq(schema.pipelineSpecs.id, spec.id))
		expect(
			await resolveFunctionSpec(db as any, STANDARD, "narrate", {
				sessionId
			})
		).toBe(CORE_NARRATE)

		// Restore, then clear: reset-is-delete, back to the default.
		const [version] = await db
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.specId, spec.id))
		await db
			.update(schema.pipelineSpecs)
			.set({ activeVersionId: version.id })
			.where(eq(schema.pipelineSpecs.id, spec.id))
		const cleared = await bindFunction(db as any, {
			scope: { kind: "session", id: sessionId },
			genreId: STANDARD,
			functionKey: "narrate",
			specSlug: null,
			userId
		})
		expect(cleared.error).toBeUndefined()
		expect(
			await resolveFunctionSpec(db as any, STANDARD, "narrate", {
				sessionId
			})
		).toBe(CORE_NARRATE)
	})
})

describe("the strategy swap (19 §5)", () => {
	it("swapping to round-robin changes what the run executes — and it decides", async () => {
		const { setSessionSpeakerStrategy, getSessionSpeakerStrategy } =
			await import("$lib/server/pipelines/entities/bindings")
		const { runTurn } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)

		const set = await setSessionSpeakerStrategy(db as any, {
			sessionId,
			userId,
			typeId: "core:task/turn-round-robin@1"
		})
		expect(set.error).toBeUndefined()
		expect(await getSessionSpeakerStrategy(db as any, sessionId)).toBe(
			"core:task/turn-round-robin@1"
		)

		// No explicit pick: under the pinned turn-manual this turn would have
		// no speaker at all. The rebound strategy decides — Alice has never
		// replied, so the rotation seats her.
		const receipt = await runTurn({
			db: db as any,
			sessionId,
			userId,
			currentCharacterId: null,
			text: "Who rides next?",
			seed: "rebind:1",
			skipReceipt: true
		})
		const speaker = receipt.nodes.find((n: any) => n.nodeKey === "speaker")
		expect(speaker!.typeId).toBe("core:task/turn-round-robin@1")
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

		const refused = await setSessionSpeakerStrategy(db as any, {
			sessionId,
			userId,
			typeId: "core:task/assemble@2"
		})
		expect(refused.error).toContain("not a next-speaker strategy")

		// The generic setter refuses on shape too.
		const generic = await setNodeRebind(db as any, {
			scope: { kind: "session", id: sessionId },
			specSlug: "core:spec/respond",
			nodeKey: "speaker",
			typeId: "core:task/assemble@2",
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
			typeId: "core:task/turn-none@1", // wrong shape for `prompt`
			updatedBy: userId
		})
		const doc = await applyNodeRebinds(
			db as any,
			await loadPublished(db as any, "core:spec/respond"),
			{ specSlug: "core:spec/respond", sessionId }
		)
		const prompt = (doc.nodes as any[]).find((n) => n.key === "prompt")
		expect(prompt.typeId).toBe("core:task/assemble")

		// And the good rebind from the previous test is still in force.
		const speaker = (doc.nodes as any[]).find((n) => n.key === "speaker")
		expect(speaker.typeId).toBe("core:task/turn-round-robin")
	})

	it("clearing restores the pin — reset-is-delete", async () => {
		const { setSessionSpeakerStrategy, getSessionSpeakerStrategy } =
			await import("$lib/server/pipelines/entities/bindings")
		const cleared = await setSessionSpeakerStrategy(db as any, {
			sessionId,
			userId,
			typeId: null
		})
		expect(cleared.error).toBeUndefined()
		expect(await getSessionSpeakerStrategy(db as any, sessionId)).toBe(null)
	})
})
