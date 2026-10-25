/**
 * 🚧 **A reply that carries changes sets a tie's field** (lane T3,
 * 2026-10-23; ties on the graph). On a real Story turn with a scripted
 * model: *Replies carry changes* on, the session played by a copy of the
 * romance archetype, Wren and Mara each holding their side of a bond. The
 * reply answers JSON in the one grammar — `entryType: "bond"`, `op: "set"`,
 * `field: "affection"`, `name` the one the side is towards — and Mara's side
 * moves; its standing is worked out from it by rungs and her row on the
 * lorebook follows, in the same run.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "reply-ties-test-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

/** What the reply answers (JSON while it carries changes); every other call says nothing to file. */
const script = vi.hoisted(() => ({ reply: "They walk on." as string }))
class FakeAdapter {
	injected: any
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	async generateText() {
		const asked = JSON.stringify(this.injected ?? {})
		const text = asked.includes("You keep the record of a story")
			? JSON.stringify({ changes: [], clock: [], place: [] })
			: asked.includes("You keep the books of a story")
				? "They walk on."
				: script.reply
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => onContent(text)
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

const ROMANCE = "test:ruleset/reply-ties-romance@1"
let ownerId: number
const fakeSocket = (uid: number) => ({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}
function quietIo() {
	return {
		sockets: { adapter: { rooms: { get: () => undefined } }, sockets: { get: () => undefined, values: () => [].values() } },
		to: () => ({ emit: () => {} })
	}
}
async function settle() {
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-reply-ties-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	// A copy of the romance archetype, as an administrator's copy of it runs.
	const { defineRuleset } = await import("@serene-pub/sdk")
	const { romanceTemplate } = await import("@serene-pub/core-catalog")
	const { template: _template, ...romance } = romanceTemplate.ruleset as unknown as Record<string, unknown>
	defineRuleset(ROMANCE, romance as never)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "reply-ties-owner")).id
	const [textConn] = await db.insert(schema.connections).values({ name: "Text", type: "openai", baseUrl: "http://text/v1" }).returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "reply-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Reply ties test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 300, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", { connectionId: textConn!.id, connectionModelId: modelId, samplingConfigId: sampling!.id })
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

describe("🚧 a reply carrying changes sets a tie's field (ties T3)", () => {
	it("Mara's affection for Wren is set; her standing follows by rungs, and so does her row", async () => {
		const [wren, mara] = await db
			.insert(schema.characters)
			.values(["Wren", "Mara"].map((name) => ({ userId: ownerId, name, description: `${name}.`, isPersona: false })))
			.returning()
		const [preset] = await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, "core-story-living"))
		const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
		const created: any = await sessionsCreateHandler.handler(
			fakeSocket(ownerId),
			{ session: { name: "The pier", presetId: preset!.id }, characterIds: [wren!.id, mara!.id], personaIds: [], characterPositions: {}, tags: [] } as any,
			emit
		)
		expect(created?.error, created?.error).toBeUndefined()
		await settle()
		const sessionId = created.session.id as number

		// The book: both of them on it, a row each way, the session reading it at Full.
		const [book] = await db.insert(schema.lorebooks).values({ userId: ownerId, name: "Hollow Hearts" }).returning()
		const bindings = await db
			.insert(schema.lorebookBindings)
			.values([wren!, mara!].map((c, i) => ({ lorebookId: book!.id, characterId: c.id, binding: `{{char:${i + 1}}}`, name: c.name })))
			.returning()
		const bindingOf = (c: { id: number }) => bindings.find((b) => b.characterId === c.id)!
		const [wrenRow, maraRow] = await db
			.insert(schema.narrativeRelationships)
			.values([
				{ lorebookId: book!.id, fromNodeId: bindingOf(wren!).id, toNodeId: bindingOf(mara!).id, relationshipType: "warm" },
				{ lorebookId: book!.id, fromNodeId: bindingOf(mara!).id, toNodeId: bindingOf(wren!).id, relationshipType: "wary" }
			])
			.returning()
		await db.update(schema.sessions).set({ lorebookId: book!.id, primaryRuleset: ROMANCE, rigour: "mechanics" }).where(eq(schema.sessions.id, sessionId))
		const key = (c: { id: number }) => `character:${c.id}`
		const side = (who: { id: number }, other: { id: number; name: string }, row: { id: number }, fields: Record<string, unknown>) => ({
			sessionId,
			ownerKind: "session_cast",
			ownerId: who.id,
			rulesetId: ROMANCE,
			zoneType: "bonds",
			entries: [{ entryId: null, entryType: "bond", name: other.name, sideOwner: key(who), fields: { towards: key(other), edge: String(row.id), ...fields } }]
		})
		await db.insert(schema.zoneContents).values([side(wren!, mara!, wrenRow!, { affection: 7, standing: "warm" }), side(mara!, wren!, maraRow!, { affection: 4, standing: "wary" })])

		// *Replies carry changes*: the reply's own `changes` duty, on in this session.
		const { STORY_RESPOND_SPEC_ID } = await import("@serene-pub/core-catalog")
		const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
		const { rowOfChange } = await import("$lib/server/pipelines/registrations/rows")
		const { upsertRow } = await import("$lib/server/pipelines/registrations/write")
		const replyReg = (await effectiveRegistrations(db as never, sessionId))!.effective.find((r) => r.pipeline === STORY_RESPOND_SPEC_ID)!
		await upsertRow(db as never, rowOfChange({ key: replyReg.key, values: { reading: { params: { changes: true } } } }, { kind: "session", sessionId }, "owner"))

		// The reply, in the one grammar: Mara's side towards Wren, its affection set.
		const change = { owner: "Mara", changes: "entry", attribute: "", entryType: "bond", op: "set", field: "affection", value: "9", name: "Wren", reason: "his words landed" }
		script.reply = JSON.stringify({ message: "Mara looks at Wren a long moment, and smiles.", changes: [change] })
		try {
			const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
			const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
				fakeSocket(ownerId),
				{ sessionId, personaId: null, content: "I meant every word.", channel: "main" } as any,
				emit
			)
			expect(res?.error, res?.error).toBeUndefined()
			await settle()
		} finally {
			script.reply = "They walk on."
		}

		const runs = await db
			.select({ runId: schema.pipelineRuns.runId, specSlug: schema.pipelineRuns.specSlug, receipt: schema.pipelineRuns.receipt })
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.sessionId, sessionId))
		const reply = runs.filter((r) => r.specSlug === STORY_RESPOND_SPEC_ID)
		const nodes = reply.flatMap((r) => ((r.receipt as any)?.nodes ?? []) as any[])
		const keyOf = (n: any) => n.key ?? n.nodeKey
		// The grammar the reply was asked in carries the tie's field.
		const shape = nodes.find((n) => keyOf(n) === "reply.changes.shape")
		const schemaAsked = (shape?.output ?? shape?.outputs)?.facts?.replySchema ?? (shape?.output ?? shape?.outputs)?.replySchema
		expect(schemaAsked?.properties?.changes?.items?.properties?.field?.enum).toEqual(["affection", "standing", ""])
		// The commit, after the reply junction (RF fix 3) — by its published address.
		const { replyApplyKey } = await import("$lib/server/utils/testDb")
		const applyKey = await replyApplyKey(db, STORY_RESPOND_SPEC_ID)
		const apply = nodes.find((n) => keyOf(n) === applyKey)
		expect(apply, "the reply's change was applied").toBeTruthy()
		expect((apply?.output ?? apply?.outputs)?.rejected ?? []).toEqual([])

		const { zonesFor } = await import("$lib/server/rulesets/zones")
		const zones = await zonesFor(db, sessionId, ROMANCE, [wren!, mara!].map((c) => ({ key: key(c), owner: { kind: "session_cast", id: c.id } })) as any)
		expect(zones[key(mara!)]?.bonds?.[0]?.fields).toMatchObject({ affection: 9, standing: "close", towards: key(wren!) })
		// Wren's side is his own: untouched.
		expect(zones[key(wren!)]?.bonds?.[0]?.fields).toMatchObject({ affection: 7, standing: "warm" })
		const [row] = await db.select().from(schema.narrativeRelationships).where(eq(schema.narrativeRelationships.id, maraRow!.id))
		expect(row).toMatchObject({ relationshipType: "close" })
		expect(reply.map((r) => r.runId)).toContain(row!.rulesRunId)
	}, 180_000)
})
