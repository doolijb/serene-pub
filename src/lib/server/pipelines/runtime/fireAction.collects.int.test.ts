/**
 * Lair pass R3 (2026-09-28): an action **collects** its text and recipients
 * in the collect modal, and the fire carries them from any venue.
 *
 * Was B10's `composerText` test: the text was read off the composer's
 * draft, and only a press with no message and no form carried it. Now:
 *  1. the text arrives from a chip or palette press (no message), a press
 *     on a message's ⋮ and a form's option;
 *  2. a `required` action pressed with nothing is refused;
 *  3. recipients are validated — seated and enabled, none twice, within
 *     min and max;
 *  4. an action collecting nothing gets "" and no recipients, whatever the
 *     press sent.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { annexField, annexFieldAction } from "@serene-pub/sdk"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "collects-test-secret" }
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
vi.mock("$lib/server/sockets/utils/broadcastHelpers", async (importOriginal) => ({
	...(await importOriginal<object>()),
	broadcastToSessionUsers: async () => {},
	emitToUserRedacted: async () => {}
}))

const LAIR = "core:genre/lair"
const NUDGE = "core:spec/lair-nudge#nudge"
const PLUGIN = "acme.tally"
const fakeIo = {} as any

let ownerId: number
let lairSessionId: number
let chatSessionId: number
const cast: Record<"brannoc" | "vell" | "isolde" | "gone", number> = {} as never

const press = async (req: {
	sessionId: number
	action: string
	text?: string
	recipients?: unknown[]
	messageId?: number
	blockId?: string
	payload?: Record<string, unknown>
}) => {
	const { fireAction } = await import("$lib/server/pipelines/runtime/fireAction")
	return fireAction(db as any, { ...req, actor: { userId: ownerId }, io: fakeIo })
}

const nodeOutput = (receipt: any, key: string) =>
	receipt.nodes.find((n: any) => n.nodeKey === key)?.output as any

/** A Lair row, the session's newest — what a ⋮ press is on. */
async function row(content: string) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return (await insertLegacy(db as any, { sessionId: lairSessionId, role: "assistant", content })).id
}

/** A row carrying one `choices` form whose option fires Nudge. */
async function nudgeForm(blockId: string) {
	const { appendParts } = await import("$lib/server/messages/store")
	const id = await row("Which way?")
	await appendParts(db as any, id, [
		{
			type: "core:blocks",
			data: {
				blocks: [
					{
						kind: "choices",
						id: blockId,
						head: id,
						question: "Which way?",
						actions: [{ fn: "nudge", action: NUDGE, label: "Say which", choice: "say" }]
					}
				]
			}
		} as any
	])
	return id
}

beforeAll(async () => {
	process.env.SP_PLUGINS_ENABLED = "1"
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-collects-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db as any)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "collects-owner")).id
	const [lair] = await db
		.insert(schema.sessions)
		.values({ userId: ownerId, isGroup: false, name: "lair", genreId: LAIR })
		.returning()
	lairSessionId = lair!.id
	const [chat] = await db
		.insert(schema.sessions)
		.values({ userId: ownerId, isGroup: false, name: "chat" })
		.returning()
	chatSessionId = chat!.id

	for (const name of ["brannoc", "vell", "isolde", "gone"] as const) {
		const [c] = await db
			.insert(schema.characters)
			.values({ userId: ownerId, name, description: `${name}, a delver.` } as any)
			.returning()
		cast[name] = c!.id
	}
	await db.insert(schema.sessionCharacters).values([
		{ sessionId: lairSessionId, characterId: cast.brannoc, isActive: true },
		{ sessionId: lairSessionId, characterId: cast.vell, isActive: true },
		{ sessionId: lairSessionId, characterId: cast.isolde, isActive: false },
		{ sessionId: lairSessionId, characterId: cast.gone, isActive: true, removedAt: new Date() }
	] as any)

	await db.insert(schema.plugins).values({
		pluginId: PLUGIN,
		name: PLUGIN,
		version: "1.0.0",
		bundleSource: "// none",
		bundleHash: `hash-${PLUGIN}`,
		enabled: true,
		manifest: {
			annexFields: [
				annexField({ key: "count", shape: { type: "integer" }, see: ["person"], act: ["owner"] })
			]
		}
	} as any)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("R3 · the collected text reaches the run from any press", () => {
	it("a chip or palette press (no message) hands it to the inlet, and Nudge's direction is it", async () => {
		const out = await press({ sessionId: lairSessionId, action: NUDGE, text: "  Bring the ogre back.  " })
		expect(out.kind, JSON.stringify(out)).toBe("ran")
		if (out.kind !== "ran") return
		expect(out.receipt.outcome).toBe("ok")
		expect(nodeOutput(out.receipt, "input").text).toBe("Bring the ogre back.")
		const changes = nodeOutput(out.receipt, "resolve").changes as any[]
		expect(changes.map((c) => c.value)).toEqual(["Bring the ogre back."])
	})

	it("a press on a message's ⋮ carries it too", async () => {
		const messageId = await row("The torches gutter.")
		const out = await press({ sessionId: lairSessionId, action: NUDGE, messageId, text: "Look up." })
		expect(out.kind, JSON.stringify(out)).toBe("ran")
		if (out.kind !== "ran") return
		expect(nodeOutput(out.receipt, "input").text).toBe("Look up.")
	})

	it("a form's option carries it too", async () => {
		const messageId = await nudgeForm("which-way")
		const out = await press({
			sessionId: lairSessionId,
			action: NUDGE,
			messageId,
			blockId: "which-way",
			payload: { choice: "say" },
			text: "North, always north."
		})
		expect(out.kind, JSON.stringify(out)).toBe("ran")
		if (out.kind !== "ran") return
		expect(nodeOutput(out.receipt, "input").text).toBe("North, always north.")
	})

	it("a required action with nothing collected is refused, not run empty", async () => {
		const out = await press({ sessionId: lairSessionId, action: NUDGE, text: "   " })
		expect(out).toEqual({ kind: "refused", error: "'Nudge' needs text." })
		const none = await press({ sessionId: lairSessionId, action: NUDGE })
		expect(none).toEqual({ kind: "refused", error: "'Nudge' needs text." })
	})

	it("an action collecting nothing still fires, and is handed no text and no recipients", async () => {
		const action = annexFieldAction(PLUGIN, "count")
		const out = await press({ sessionId: chatSessionId, action, payload: { value: 3 } })
		expect(out.kind, JSON.stringify(out)).toBe("ran")
		if (out.kind !== "ran") return
		expect(out.receipt.outcome).toBe("ok")
		expect(nodeOutput(out.receipt, "input").text).toBe("")

		const sent = await press({
			sessionId: chatSessionId,
			action,
			payload: { value: 4 },
			text: "stray",
			recipients: [`character:${cast.brannoc}`]
		})
		expect(sent.kind).toBe("ran")
		if (sent.kind !== "ran") return
		expect(nodeOutput(sent.receipt, "input").text).toBe("")
		expect(nodeOutput(sent.receipt, "input").recipients).toBeUndefined()
	})
})

describe("R3 · recipients are validated at the door", () => {
	it("the enabled seats are the seated, enabled, not-removed cast", async () => {
		const { enabledSeats } = await import("$lib/server/pipelines/runtime/fireAction")
		const seats = await enabledSeats(db as any, lairSessionId)
		expect([...seats].sort()).toEqual([`character:${cast.brannoc}`, `character:${cast.vell}`].sort())
	})

	it("unseated, disabled, removed, duplicate, below min and above max are each refused", async () => {
		const { recipientsRefusal } = await import("$lib/server/pipelines/runtime/fireAction")
		const b = `character:${cast.brannoc}`
		const v = `character:${cast.vell}`
		const seated = new Set([b, v])
		const one = { min: 1 }
		expect(recipientsRefusal([b], one, seated)).toBeNull()
		expect(recipientsRefusal([b, v], { min: 1, max: 2 }, seated)).toBeNull()
		expect(recipientsRefusal(["character:999"], one, seated)).toMatch(/enabled member of this session's cast — character:999/)
		expect(recipientsRefusal([`character:${cast.isolde}`], one, seated)).toMatch(/is not one/)
		expect(recipientsRefusal([`character:${cast.gone}`], one, seated)).toMatch(/is not one/)
		expect(recipientsRefusal([b, b], one, seated)).toBe(`names ${b} twice.`)
		expect(recipientsRefusal([], one, seated)).toBe("needs at least 1 recipient.")
		expect(recipientsRefusal(undefined, { min: 2 }, seated)).toBe("needs at least 2 recipients.")
		expect(recipientsRefusal([b, v], { min: 1, max: 1 }, seated)).toBe("takes at most 1 recipient.")
		expect(recipientsRefusal("x", one, seated)).toMatch(/as a list of cast members/)
		expect(recipientsRefusal([7], one, seated)).toMatch(/as a list of cast members/)
	})
})
