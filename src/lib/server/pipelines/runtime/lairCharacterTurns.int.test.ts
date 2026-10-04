/**
 * **The Lair's character turns** (owner rulings 2026-09-30), run on a freshly
 * booted install: the shipped `lair-respond` and `lair-turn-order` documents,
 * their shipped config and prompts, the real executor and host, the model
 * stubbed at the binding.
 *
 *  1. "They are character turns, not first delver, later delver." While each
 *     delver speaks, the Castellan's planned turn voices nobody: its beats
 *     row carries the turns it plans (`metadata.turnPlan`), the turn order
 *     prepares each named delver in the plan's order (`via: 'plan'`), and
 *     each takes a character turn of their own — their own row, streamed,
 *     their own private lore and nobody else's — after which the order moves
 *     on to the next.
 *  2. The Castellan speaking for the party sees the stats of the party's room
 *     and of the rooms one way from it, and no other room's.
 *  3. Stat ownership: the Castellan's keeper writes the world's stats only;
 *     a character turn writes only its own delver's.
 *
 * The book: Verity and Brask, each keeping a secret the line names; three
 * rooms — the Guardroom (where the party stand), the Drowned Hall (one way
 * north) and the Far Vault (no way from here) — each with something lying in
 * it.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, desc, eq } from "drizzle-orm"
import { ok, readTurnOrder, run, sessionEvents } from "@serene-pub/sdk"
import {
	CORE_SPECS,
	LAIR_GENRE_ID,
	LAIR_RESPOND_SPEC_ID
} from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "lair-character-turns-secret" }
})

/**
 * What auto-advance fired, through a recorder: the runs here drive each turn
 * by hand, so a real fire would race them with a second reply.
 */
const fired: Array<{ sessionId: number; entry: Record<string, unknown> }> = []
vi.mock("$lib/server/sessions/fireTurn", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>
	return {
		...actual,
		fireTurnEntry: async (_db: unknown, opts: { sessionId: number; entry: Record<string, unknown> }) => {
			fired.push({ sessionId: opts.sessionId, entry: opts.entry })
			return { fired: true, runId: "run-recorded" }
		}
	}
})

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-lair-character-turns-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db as any)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const MESSAGE = "The ledger lies open on the altar."
const VERITY_SECRET = "Verity burned the ledger in the stove at midnight."
const BRASK_SECRET = "Brask watched the stove and said nothing about the ledger."

const ROOM = "The Guardroom"
const HALL = "The Drowned Hall"
const VAULT = "The Far Vault"
const HERE_ITEM = "a dropped torch"
const AHEAD_ITEM = "a sealed iron chest"
const FAR_ITEM = "a crown of black iron"

const PLAY = "via.turn.channel.story.door.play"
const CT = `${PLAY}.speech.each.character.turn`
const PARTY = `${PLAY}.speech.castellan.party.speaks`

/**
 * The model's one answer, for every structured step: the planner's plan
 * (Verity, then Brask) and the keeper's report — a change to each delver and
 * one to the world, so a keeper's ownership shows in what it lets through.
 */
const ANSWER = JSON.stringify({
	beats: ["The party gather round the altar."],
	speakers: [
		{ name: "Verity", intent: "read the ledger aloud" },
		{ name: "Brask", intent: "keep watch on the door" }
	],
	unknownExit: "",
	knockQuestion: "",
	worldHints: { location: ROOM },
	values: [
		{ owner: "Verity", slot: "hp", value: "14" },
		{ owner: "Brask", slot: "hp", value: "9" },
		{ owner: "world", slot: "gold", value: "12" }
	],
	inventory: []
})

const stubbed = (said: string[]) => {
	const parsed = JSON.parse(ANSWER) as Record<string, unknown>
	return {
		...coreBindings(),
		"core:oracle/generate-text@1": async () => {
			said.push("call")
			return ok({ main: "Hm.", text: "Hm.", connection: { type: "stub" } })
		},
		"core:oracle/generate-json@1": async (input: any) => {
			const at = typeof input?.params?.path === "string" ? input.params.path : ""
			const items = at
				.split(",")
				.map((p: string) => p.trim())
				.filter(Boolean)
				.flatMap((p: string) => {
					const value = parsed[p]
					return Array.isArray(value) ? value : value == null ? [] : [value]
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

let n = 0

async function book(fields: Record<string, unknown>) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { characterLoreValues } = await import("$lib/server/pipelines/testing/fixtures")
	const tag = `lct-${++n}`
	const user = await createTestUser(db, tag)
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `The vault ${tag}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: true,
			name: `Session ${tag}`,
			genreId: LAIR_GENRE_ID,
			lorebookId: lorebook!.id,
			genreFields: fields
		})
		.returning()
	const sessionId = session!.id
	const cast: Record<string, number> = {}
	for (const [i, name] of ["Verity", "Brask"].entries()) {
		const [c] = await db
			.insert(schema.characters)
			.values({ userId: user.id, name, description: `${name}, a delver.` })
			.returning()
		cast[name] = c!.id
		await db.insert(schema.sessionCharacters).values({
			sessionId,
			characterId: c!.id,
			isActive: true,
			position: i
		} as any)
	}
	const [verity, brask] = await db
		.insert(schema.lorebookBindings)
		.values([
			{ lorebookId: lorebook!.id, binding: "{{char:1}}", name: "Verity", characterId: cast.Verity! },
			{ lorebookId: lorebook!.id, binding: "{{char:2}}", name: "Brask", characterId: cast.Brask! }
		])
		.returning()
	await db.insert(schema.lorebookEntries).values(
		characterLoreValues([
			{
				lorebookId: lorebook!.id,
				name: "Verity's secret",
				keys: "ledger",
				content: VERITY_SECRET,
				lorebookBindingId: verity!.id
			},
			{
				lorebookId: lorebook!.id,
				name: "Brask's secret",
				keys: "ledger",
				content: BRASK_SECRET,
				lorebookBindingId: brask!.id
			}
		])
	)
	// Three rooms; one way, from the guardroom north to the hall.
	let position = 0
	const place = async (title: string) =>
		(
			await db
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: lorebook!.id,
					typeId: LOCATION_TYPE_ID,
					typeVersion: 1,
					position: ++position,
					title,
					keys: [],
					content: `${title}: stone, damp, and very quiet.`,
					enabled: true
				} as any)
				.returning()
		)[0]!
	const room = await place(ROOM)
	const hall = await place(HALL)
	const vault = await place(VAULT)
	await db.insert(schema.narrativeRelationships).values({
		lorebookId: lorebook!.id,
		fromEntryId: room.id,
		toEntryId: hall.id,
		relationshipType: "leads north to",
		reverseRelationshipType: "leads south to",
		visibility: "acknowledged" as any,
		status: "active",
		description: ""
	} as any)
	await db.insert(schema.attributeValues).values([
		{ ownerKind: "session", ownerId: sessionId, sessionId, slotId: "core:slot/location@1", value: { v: ROOM } },
		{ ownerKind: "session_location", ownerId: room.id, sessionId, slotId: "core:slot/inventory@1", value: { v: [HERE_ITEM] } },
		{ ownerKind: "session_location", ownerId: hall.id, sessionId, slotId: "core:slot/inventory@1", value: { v: [AHEAD_ITEM] } },
		{ ownerKind: "session_location", ownerId: vault.id, sessionId, slotId: "core:slot/inventory@1", value: { v: [FAR_ITEM] } }
	] as any)
	const [message] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "user", content: MESSAGE } as any)
		.returning()
	await db.insert(schema.messages).values({ id: message!.id, sessionId, role: "user" } as any)
	return { user, session: session!, cast, fields }
}
type Book = Awaited<ReturnType<typeof book>>

/** One Lair run over `b` — the Castellan's planned turn, or a delver's character turn. */
async function turn(b: Book, characterId: number | null = null) {
	const entry = CORE_SPECS.find((s) => s.slug === LAIR_RESPOND_SPEC_ID)!
	const said: string[] = []
	const receipt: any = await run(entry.build(), {
		input: {
			text: characterId ? "" : MESSAGE,
			sessionId: b.session.id,
			characterId,
			channel: "main",
			via: characterId ? "plan" : "send",
			sessionScope: { sessionId: b.session.id, currentCharacterId: characterId },
			fields: b.fields
		},
		seed: "seed:lair-character-turns",
		triggerSource: "event",
		compactHaltReceipts: false,
		bindings: stubbed(said),
		world: await buildWorld(db as any, { sessionId: b.session.id, specId: LAIR_RESPOND_SPEC_ID }),
		host: createHost(db as any, { sessionId: b.session.id, userId: b.user.id })
	} as any)
	return { receipt, said }
}

/**
 * The session's turn order, recomputed the way the app does after a row
 * lands — the genre's bound turn-order spec, through the one emitter — with
 * an edit's cause, so auto-advance (which would fire a real reply) stays
 * out of it.
 */
async function orderAfter(b: Book) {
	const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
	await emitSessionEvent(db as any, {
		sessionId: b.session.id,
		userId: b.user.id,
		event: sessionEvents.messageCompleted,
		payload: { sessionId: b.session.id, cause: { kind: "edit", userId: b.user.id } },
		wait: true
	})
	const [row] = await db
		.select({ metadata: schema.sessions.metadata })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, b.session.id))
	return readTurnOrder(row!.metadata).order
}

const ran = (receipt: any, key: string) =>
	(receipt.nodes as any[]).filter((node) => node.nodeKey === key && node.result === "ok")

function promptAt(receipt: any, key: string): string {
	const [node] = ran(receipt, key)
	expect(node, `${key} did not run (${receipt.outcome} ${receipt.haltReason ?? ""})`).toBeTruthy()
	const main = node.output?.main ?? node.output
	return typeof main?.rendered === "string" ? main.rendered : JSON.stringify(main?.messages ?? node.output)
}

const resolved = (receipt: any, key: string) => {
	const [node] = ran(receipt, key)
	expect(node, `${key} did not run (${receipt.outcome} ${receipt.haltReason ?? ""})`).toBeTruthy()
	const changes = (node.output?.changes ?? []) as Array<{ owner: { kind: string; id: number }; slotId: string }>
	return {
		owners: changes.map((c) => `${c.owner.kind}:${c.slotId}`).sort(),
		changes,
		refused: (node.output?.refused ?? []) as string[]
	}
}

describe("each delver speaks: every delver's line is a character turn", () => {
	it("the Castellan's planned turn voices nobody, and its beats row carries the turns it plans, in order", async () => {
		const b = await book({ trustNarrator: false })
		const { receipt, said } = await turn(b)
		expect(`${receipt.outcome} ${receipt.haltReason ?? ""}`.trim()).toBe("ok")
		expect(said).toEqual([])
		expect(ran(receipt, `${CT}.say`)).toHaveLength(0)
		const [plan] = await db
			.select({ metadata: schema.sessionMessages.metadata, channel: schema.sessionMessages.channel })
			.from(schema.sessionMessages)
			.where(and(eq(schema.sessionMessages.sessionId, b.session.id), eq(schema.sessionMessages.channel, "sanctum")))
			.orderBy(desc(schema.sessionMessages.id))
			.limit(1)
		expect((plan!.metadata as any)?.turnPlan?.turns).toEqual([
			`character:${b.cast.Verity}`,
			`character:${b.cast.Brask}`
		])
	})

	it("each named delver gets their own character turn: prepared in order, one streamed row each, only their own lore", async () => {
		const b = await book({ trustNarrator: false })
		await turn(b)
		// The plan row's own landing fires the first planned turn by itself.
		const { settleSessionEvents } = await import("$lib/server/pipelines/runtime/sessionEvents")
		await settleSessionEvents(b.session.id)
		expect(fired.filter((f) => f.sessionId === b.session.id).map((f) => f.entry)[0]).toMatchObject({
			ref: `character:${b.cast.Verity}`,
			via: "plan"
		})
		expect(await orderAfter(b)).toEqual([
			{ ref: `character:${b.cast.Verity}`, via: "plan" },
			{ ref: `character:${b.cast.Brask}`, via: "plan" }
		])

		const verity = await turn(b, b.cast.Verity!)
		expect(`${verity.receipt.outcome} ${verity.receipt.haltReason ?? ""}`.trim()).toBe("ok")
		expect(verity.said).toHaveLength(1)
		// Streamed into the delver's own row.
		const [opened] = ran(verity.receipt, `${CT}.placeholder`)
		expect(opened.input.generating).toBe(true)
		expect(opened.input.speaker).toBe(`character:${b.cast.Verity}`)
		const verityPrompt = promptAt(verity.receipt, `${CT}.prompt`)
		expect(verityPrompt).toContain(VERITY_SECRET)
		expect(verityPrompt).not.toContain(BRASK_SECRET)
		// It plays from the standing plan.
		expect(ran(verity.receipt, `${CT}.plan`)[0].output.plan?.speakers?.[0]?.name).toBe("Verity")
		expect(await orderAfter(b)).toEqual([{ ref: `character:${b.cast.Brask}`, via: "plan" }])

		const brask = await turn(b, b.cast.Brask!)
		expect(brask.said).toHaveLength(1)
		const braskPrompt = promptAt(brask.receipt, `${CT}.prompt`)
		expect(braskPrompt).toContain(BRASK_SECRET)
		expect(braskPrompt).not.toContain(VERITY_SECRET)
		expect(await orderAfter(b)).toEqual([])

		// Two delver rows on main, each their own and finished.
		const rows = await db
			.select({
				role: schema.sessionMessages.role,
				characterId: schema.sessionMessages.characterId,
				isGenerating: schema.sessionMessages.isGenerating,
				channel: schema.sessionMessages.channel
			})
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, b.session.id))
		const lines = rows.filter((r) => r.role !== "user" && r.channel === "main")
		expect(lines.map((r) => r.characterId)).toEqual([b.cast.Verity, b.cast.Brask])
		expect(lines.every((r) => !r.isGenerating)).toBe(true)
	})

	it("a person's line after the plan moves the story on: the Castellan is due again", async () => {
		const b = await book({ trustNarrator: false })
		await turn(b)
		await turn(b, b.cast.Verity!)
		const [line] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId: b.session.id, role: "user", content: "The floor gives way." } as any)
			.returning()
		await db.insert(schema.messages).values({ id: line!.id, sessionId: b.session.id, role: "user" } as any)
		expect(await orderAfter(b)).toEqual([{ ref: null, via: "voice" }])
	})
})

describe("stat ownership", () => {
	it("a character turn writes only its own delver's stats", async () => {
		const b = await book({ trustNarrator: false })
		await turn(b)
		const { receipt } = await turn(b, b.cast.Verity!)
		const { changes, refused } = resolved(receipt, `${CT}.keeperResolve`)
		expect(changes.map((c) => [c.owner.kind, c.owner.id, c.slotId])).toEqual([
			["session_cast", b.cast.Verity, "core:slot/hp@1"]
		])
		expect(refused).toHaveLength(2)
		// The Castellan's keeper did not run in a character turn.
		expect(ran(receipt, "keep.played.keeperWrite")).toHaveLength(0)
	})

	it("the Castellan's keeper writes only the world's stats", async () => {
		const b = await book({ trustNarrator: false })
		const { receipt } = await turn(b)
		const { changes, refused } = resolved(receipt, "keep.played.keeperResolve")
		expect(changes.length).toBeGreaterThan(0)
		for (const c of changes) expect(["session", "session_location"]).toContain(c.owner.kind)
		expect(changes.some((c) => c.slotId === "core:slot/gold@1")).toBe(true)
		expect(refused.length).toBeGreaterThanOrEqual(2)
	})

	it("the Castellan speaking for the party keeps the world's books and those of the delvers it voiced", async () => {
		const b = await book({ trustNarrator: false, partySpeech: "castellan" })
		const { receipt } = await turn(b)
		const { changes } = resolved(receipt, "keep.played.keeperResolve")
		const owners = changes.map((c) => [c.owner.kind, c.owner.id, c.slotId])
		expect(owners).toContainEqual(["session_cast", b.cast.Verity, "core:slot/hp@1"])
		expect(owners).toContainEqual(["session_cast", b.cast.Brask, "core:slot/hp@1"])
		expect(changes.some((c) => c.slotId === "core:slot/gold@1")).toBe(true)
	})
})

describe("the Castellan speaking for the party sees the party's reach", () => {
	it("its prompt holds the stats of the party's room and the rooms one way from it, and no other room's", async () => {
		const b = await book({ trustNarrator: false, partySpeech: "castellan" })
		const { receipt } = await turn(b)
		expect(`${receipt.outcome} ${receipt.haltReason ?? ""}`.trim()).toBe("ok")
		const prompt = promptAt(receipt, `${PARTY}.prompt`)
		expect(prompt).toContain(HERE_ITEM)
		expect(prompt).toContain(AHEAD_ITEM)
		expect(prompt).not.toContain(FAR_ITEM)
	})

	it("a character turn still sees its own room's stats alone", async () => {
		const b = await book({ trustNarrator: false })
		await turn(b)
		const { receipt } = await turn(b, b.cast.Verity!)
		const summary = String(ran(receipt, `${CT}.context`)[0]?.output?.templateContext?.stateSummary ?? "")
		expect(summary).toContain(HERE_ITEM)
		expect(summary).not.toContain(AHEAD_ITEM)
		expect(summary).not.toContain(FAR_ITEM)
	})
})
