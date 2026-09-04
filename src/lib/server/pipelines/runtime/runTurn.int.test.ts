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
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"

// Whichever test runs a turn first pays the cold dynamic import of the entire
// dispatch chain — the SDK, the contracts, the host bindings, the legacy adapter
// and Handlebars — which on a slow machine is comfortably past vitest's 5s
// default. Raised per file rather than per test deliberately: the cost belongs
// to the *first* turn, not to any particular assertion, so a per-test timeout
// would make this file pass or fail depending on the order its tests ran in.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })

let streamed: string[] = []

/** Pinned to the real action, so a rename cannot pass here — fakeTextAdapter.ts. */
class FakeAdapter implements FakeTextAdapter {
	injected: any
	promptBuilder: any = {}
	constructor(_p: any) {}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	abort() {}
	async generateText() {
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

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)

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
		.insert(schema.personas)
		.values({
			userId,
			name: "Bob",
			description: "A traveller.",
			isDefault: false
		})
		.returning()

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Turn Lore", userId })
		.returning()
	await db.insert(schema.worldLoreEntries).values({
		lorebookId: lorebook.id,
		name: "The Ashguard",
		keys: "ashguard",
		content: "Riders who patrol the ash wastes.",
		retrievalStrategy: "keyword"
	})

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
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
		.values({
			name: "Turn Context",
			// `{{{instructions}}}`, not `{{instructions}}`. Since 0.6 a value
			// arrives carrying its own heading and fence, and a double stash
			// HTML-escapes the fence — this fixture rendered
			// `Instructions:\n&quot;&quot;&quot;` until it was a triple.
			//
			// The `injectionsByIndex` lookup is the template opting in to
			// script injections (18 §4a): position belongs to the template, so
			// a template without the block renders none — which is the ruling,
			// not a gap. Renders zero bytes when the map is empty, which every
			// other test in this file depends on.
			template:
				"{{{instructions}}}\nLORE:{{{worldLore}}}\n{{#each sessionMessages}}{{#each (lookup ../injectionsByIndex @index)}}{{this.content}}\n{{/each}}{{this.name}}: {{this.message}}\n{{/each}}"
		})
		.returning()
	const [promptConfig] = await db
		.insert(schema.promptConfigs)
		.values({ name: "Turn Prompt", systemPrompt: "You are {{char}}." })
		.returning()
	await db.insert(schema.systemSettings).values({
		id: 1,
		defaultContextConfigId: contextConfig.id,
		defaultPromptConfigId: promptConfig.id
	})

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
	const template = await createContextTemplate(db as any, {
		nodeTypeId: CONTEXT_TEMPLATE_NODE_TYPE,
		name: "Turn Template",
		source: contextConfig.template!
	})
	const [respondSpec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
		.limit(1)
	// By node type, not "the first template slot": every `template` slot is a
	// reference now, so the history and lore queries have one too, and picking
	// the first one silently configures the wrong node.
	const decl = (
		await declarations(db as any, respondSpec.activeVersionId!)
	).find(
		(d) =>
			d.control === "context-template-ref" &&
			d.nodeTypeId === CONTEXT_TEMPLATE_NODE_TYPE
	)!
	// The template pin lands as the selected configuration's own value —
	// the only global home since the layer simplification (2026-08-24).
	{
		const { resolveSelectedConfig, duplicateConfig, selectConfig } =
			await import("$lib/server/pipelines/config/named")
		const shipped = await resolveSelectedConfig(
			db as any,
			respondSpec.id,
			RESPOND_SPEC_ID,
			{}
		)
		const copy = await duplicateConfig(
			db as any,
			shipped!.configId,
			"Turn host"
		)
		await selectConfig(db as any, respondSpec.id, "instance", 0, copy.id)
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
		db: db as any,
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
				db: db as any,
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
 * Script chains, applied by the substrate on a real turn (18 §4a, U-S4).
 *
 * The chain is configuration — an override row at slot `scripts`, exactly what
 * the panel writes — and the write consumer's hook applies it to the reply
 * before it is stored. The binding is never told; the receipt is (S5).
 */
describe("script chains on a turn", () => {
	/** A hook node's key, read from the published rows by its type. */
	async function hookNodeKey(
		typeId = "core:consumer/create-message"
	): Promise<{
		specId: number
		nodeKey: string
	}> {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
			.limit(1)
		const nodes = await db
			.select()
			.from(schema.pipelineNodes)
			.where(
				eq(schema.pipelineNodes.specVersionId, spec.activeVersionId!)
			)
		const node = (nodes as any[]).find((n) => n.typeId === typeId)!
		return { specId: spec.id, nodeKey: node.nodeKey }
	}

	async function attachChain(
		ids: number[],
		typeId = "core:consumer/create-message"
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
			db as any,
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
			const copy = await duplicateConfig(
				db as any,
				configId,
				"Chain host"
			)
			configId = copy.id
			await selectConfig(db as any, specId, "instance", 0, configId)
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
			.filter((n) => n.typeId?.startsWith("core:consumer/create-message"))
			.flatMap((n) => n.scripts ?? [])

	/**
	 * What the write consumer was handed — post-scripts, pre-store. The
	 * provider's output (`generatedText`) is deliberately upstream of the
	 * write hook and must stay untouched by it.
	 */
	const writtenText = (receipt: any): string =>
		(receipt.nodes as any[]).find((n) =>
			n.typeId?.startsWith("core:consumer/create-message")
		)?.input?.text

	it("a transform rewrites the reply before it is stored, and the receipt says so per link", async () => {
		const { createScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const shout = await createScript(db as any, {
			typeId: "core:script:text/transform@1",
			name: "Turn shouter"
		})
		const { updateScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		await updateScript(db as any, shout.id, {
			source: "ctx.log('shouting'); return text.toUpperCase()"
		})
		const broken = await createScript(db as any, {
			typeId: "core:script:text/transform@1",
			name: "Turn breaker"
		})
		await updateScript(db as any, broken.id, {
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
		const late = await createScript(db as any, {
			typeId: "core:script:text/stop@1",
			name: "Late stop"
		})
		await updateScript(db as any, late.id, { source: "return 17" })
		const early = await createScript(db as any, {
			typeId: "core:script:text/stop@1",
			name: "Early stop"
		})
		await updateScript(db as any, early.id, {
			source: "return text.indexOf('ride')"
		})
		await attachChain([late.id, early.id])

		const receipt = await turn({ seed: "turn:scripts-stop" })
		expect(writtenText(receipt)).toBe("The Ashguard ")
		const rows = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
		expect(rows.map((r) => r.content)).toContain("The Ashguard ")

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
		const off = await createScript(db as any, {
			typeId: "core:script:text/transform@1",
			name: "Turn muted"
		})
		await updateScript(db as any, off.id, {
			source: "return 'never'"
		})
		await updateScript(db as any, off.id, { enabled: false })
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
		const roll = await createScript(db as any, {
			typeId: "core:script:text/transform@1",
			name: "Turn roller"
		})
		await updateScript(db as any, roll.id, {
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
		const shout = await createScript(db as any, {
			typeId: "core:script:text/transform@1",
			name: "Turn switched-off shouter"
		})
		await updateScript(db as any, shout.id, {
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
		const expander = await createScript(db as any, {
			typeId: "core:script:text/transform@1",
			name: "Turn expander"
		})
		await updateScript(db as any, expander.id, {
			// The user typed a nickname; the script resolves it to the key the
			// lorebook actually uses.
			source: "return text.replace('the riders', 'the ashguard')"
		})
		await attachChain([expander.id], "core:input/user-message")

		const receipt: any = await turn({
			preview: true,
			seed: "turn:scripts-input",
			text: "Tell me about the riders."
		})
		const rendered: string =
			receipt.preview?.context?.rendered?.rendered ?? ""
		// The keyword scan saw the transformed text, so the entry fired.
		expect(rendered).toContain("The Ashguard")

		const apps = (receipt.nodes as any[])
			.filter((n: any) => n.typeId?.startsWith("core:input/user-message"))
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
			.values({ name: "Turn Kobold", type: "koboldcpp" })
			.returning()
		// "The instance default connection carries it" is the whole point of this
		// test, and since 0181 that means a registered `connection_defaults` row
		// rather than `system_settings.default_connection_id`. `connectionStopsFor`
		// reads it through the same resolver dispatch does, which is what keeps
		// the guard attached to the connection the run actually uses.
		const { setCapabilityDefault } = await import(
			"$lib/server/connections/capabilityDefaults"
		)
		await setCapabilityDefault(db as any, "text->text", {
			connectionId: conn.id
		})

		const { createScript, updateScript, attachConnectionScript } =
			await import("$lib/server/pipelines/entities/scripts")
		const guard = await createScript(db as any, {
			typeId: "core:script:text/stop@1",
			name: "Dawn guard"
		})
		await updateScript(db as any, guard.id, {
			source: "return text.indexOf('at dawn')"
		})
		await attachConnectionScript(db as any, conn.id, guard.id)

		try {
			const receipt = await turn({ seed: "turn:connection-stop" })
			expect(writtenText(receipt)).toBe("The Ashguard ride ")

			const apps = receiptScripts(receipt)
			const winner = apps.find((a: any) => a.won)
			expect(winner).toMatchObject({
				name: "Dawn guard",
				via: "connection:Turn Kobold",
				appliedBy: "substrate"
			})
		} finally {
			// Released so the tests after this one run against a bare default
			// connection rather than inheriting the guard.
			const { detachConnectionScript } = await import(
				"$lib/server/pipelines/entities/scripts"
			)
			await detachConnectionScript(db as any, conn.id, guard.id)
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
		const reminder = await createScript(db as any, {
			typeId: "core:script:messages/inject@1",
			name: "Turn reminder"
		})
		await updateScript(db as any, reminder.id, {
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
				n.typeId?.startsWith("core:task/build-template-context")
			)
			.flatMap((n: any) => n.scripts ?? [])
		expect(apps).toMatchObject([
			{ name: "Turn reminder", result: "ok", changed: true }
		])
	})
})
