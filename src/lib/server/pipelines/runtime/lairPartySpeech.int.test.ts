/**
 * **How the Lair's party speak** — the genre field `partySpeech` (owner
 * ruling 2026-09-30), run on a freshly booted install: the shipped
 * `lair-respond` document, its shipped config and prompts, the real executor
 * and host, the model stubbed at the binding.
 *
 * The book: two delvers, Verity and Brask, each keeping a private secret the
 * line names, a background member (the Cook, no card) with a secret too, and
 * one world entry. The planner names Verity, then Brask.
 *
 *  - **Each delver speaks** (the default): the Castellan's planned turn
 *    voices nobody — its plan row hands the named delvers' turns on — and
 *    each delver's line is a character turn of their own, carrying that
 *    delver's own secret and nobody else's. Pick who speaks gives the
 *    picked delver that same turn. (The turns the plan hands on, through
 *    the turn order: `lairCharacterTurns.int.test.ts`.)
 *  - **Castellan speaks for the party**: ONE call writes every named
 *    delver's lines, from a prompt holding the world entry and no
 *    character's secret — the Castellan is nobody's voice. Pick who speaks
 *    asks it for that delver's line alone, into the delver's own row.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { ok, run } from "@serene-pub/sdk"
import {
	CORE_SPECS,
	LAIR_GENRE_ID,
	LAIR_RESPOND_SPEC_ID
} from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

// No embedding model: retrieval stays on the keyword path.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "lair-party-speech-secret" }
})

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-lair-party-speech-"))
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
const COOK_SECRET = "The cook was paid to forget the ledger."
const WORLD_FACT = "The ledger went missing from the study on the night of the storm."

/** Where the party speech's steps sit in the document. */
const PLAY = "via.turn.channel.story.door.play"
const TURN = `${PLAY}.speech.each.character.turn`
const PARTY = `${PLAY}.speech.castellan.party.speaks`

/** The planner's answer, for every structured step: Verity, then Brask. */
const ANSWER = JSON.stringify({
	beats: ["The party gather round the altar."],
	speakers: [
		{ name: "Verity", intent: "read the ledger aloud" },
		{ name: "Brask", intent: "keep watch on the door" }
	],
	unknownExit: "",
	knockQuestion: "",
	worldHints: { location: "" },
	values: [],
	inventory: []
})

/** The stubbed model, counting its prose calls into `said`. */
const stubbed = (said: string[], answer: string = ANSWER) => {
	const parsed = JSON.parse(answer) as Record<string, unknown>
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
				text: answer,
				connection: { type: "stub" },
				structured: { mode: "schema", capability: "json_schema" }
			})
		}
	}
}

let n = 0

/** A Lair session over a book where Verity and Brask each keep a secret. */
async function book(fields: Record<string, unknown>) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { characterLoreValues, worldLoreValues } = await import(
		"$lib/server/pipelines/testing/fixtures"
	)
	const tag = `lps-${++n}`
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
	const cast: Record<string, number> = {}
	for (const [i, name] of ["Verity", "Brask"].entries()) {
		const [c] = await db
			.insert(schema.characters)
			.values({ userId: user.id, name, description: `${name}, a delver.` })
			.returning()
		cast[name] = c!.id
		await db.insert(schema.sessionCharacters).values({
			sessionId: session!.id,
			characterId: c!.id,
			isActive: true,
			position: i
		} as any)
	}
	const [verity, brask, cook] = await db
		.insert(schema.lorebookBindings)
		.values([
			{ lorebookId: lorebook!.id, binding: "{{char:1}}", name: "Verity", characterId: cast.Verity! },
			{ lorebookId: lorebook!.id, binding: "{{char:2}}", name: "Brask", characterId: cast.Brask! },
			{ lorebookId: lorebook!.id, binding: "{{char:3}}", name: "The Cook", characterId: null }
		])
		.returning()
	await db.insert(schema.lorebookEntries).values([
		...worldLoreValues([
			{ lorebookId: lorebook!.id, name: "The missing ledger", keys: "ledger", content: WORLD_FACT }
		]),
		...characterLoreValues([
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
			},
			{
				lorebookId: lorebook!.id,
				name: "The Cook's secret",
				keys: "ledger",
				content: COOK_SECRET,
				lorebookBindingId: cook!.id
			}
		])
	])
	const [message] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId: session!.id, role: "user", content: MESSAGE } as any)
		.returning()
	await db
		.insert(schema.messages)
		.values({ id: message!.id, sessionId: session!.id, role: "user" } as any)
	return { user, session: session!, cast, fields }
}
type Book = Awaited<ReturnType<typeof book>>

/** One Lair turn over `b` — the planner's, or a pick of `characterId`. */
async function turn(b: Book, characterId: number | null = null, answer: string = ANSWER) {
	const entry = CORE_SPECS.find((s) => s.slug === LAIR_RESPOND_SPEC_ID)!
	const said: string[] = []
	const receipt: any = await run(entry.build(), {
		input: {
			text: MESSAGE,
			sessionId: b.session.id,
			characterId,
			channel: "main",
			via: characterId ? "pick" : "send",
			sessionScope: { sessionId: b.session.id },
			fields: b.fields
		},
		seed: "seed:lair-party-speech",
		triggerSource: "event",
		compactHaltReceipts: false,
		bindings: stubbed(said, answer),
		world: await buildWorld(db as any, { sessionId: b.session.id, specId: LAIR_RESPOND_SPEC_ID }),
		host: createHost(db as any, { sessionId: b.session.id, userId: b.user.id })
	} as any)
	return { receipt, said }
}

const ran = (receipt: any, key: string) =>
	(receipt.nodes as any[]).filter((node) => node.nodeKey === key && node.result === "ok")

/** Every prompt text the assemble node at `key` rendered in this run. */
function promptsAt(receipt: any, key: string): string[] {
	const nodes = ran(receipt, key)
	expect(
		nodes.length,
		`${key} did not run (${receipt.outcome} ${receipt.haltReason ?? ""})`
	).toBeGreaterThan(0)
	return nodes.map((node) => {
		const main = node.output?.main ?? node.output
		return typeof main?.rendered === "string"
			? main.rendered
			: JSON.stringify(main?.messages ?? node.output)
	})
}

/** `who`'s secret is in the prompt; nobody else's is. */
function expectOnly(prompt: string, mine: string, others: string[]) {
	expect(prompt).toContain(mine)
	for (const other of others) expect(prompt).not.toContain(other)
}

describe("each delver speaks — the default", () => {
	it("a session that never set the field plans the turns and voices nobody: the plan row hands on each named delver, in order", async () => {
		const b = await book({ trustNarrator: false })
		const { receipt, said } = await turn(b)
		expect(receipt.outcome).toBe("ok")
		// No prose call in the Castellan's run: no character turn, no party call.
		expect(said).toHaveLength(0)
		expect(ran(receipt, `${TURN}.say`)).toHaveLength(0)
		expect(ran(receipt, `${PARTY}.say`)).toHaveLength(0)
		const [planRow] = await db
			.select({ metadata: schema.sessionMessages.metadata })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, b.session.id))
			.orderBy(schema.sessionMessages.id)
			.offset(1)
			.limit(1)
		expect((planRow!.metadata as any)?.turnPlan?.turns).toEqual([
			`character:${b.cast.Verity}`,
			`character:${b.cast.Brask}`
		])
	})

	it("Pick who speaks gives the picked delver their character turn: their own lore alone, their own books", async () => {
		const b = await book({ trustNarrator: false, partySpeech: "each" })
		const { receipt, said } = await turn(b, b.cast.Brask!)
		expect(receipt.outcome).toBe("ok")
		expect(said).toHaveLength(1)
		const [prompt] = promptsAt(receipt, `${TURN}.prompt`)
		expectOnly(prompt!, BRASK_SECRET, [VERITY_SECRET, COOK_SECRET])
		// No planner and no Castellan keeper — the turn keeps its own books.
		expect(ran(receipt, "via.turn.channel.story.pick.planned.planWrite")).toHaveLength(0)
		expect(ran(receipt, "keep.played.keeperWrite")).toHaveLength(0)
		expect(ran(receipt, `${TURN}.keeperWrite`)).toHaveLength(1)
	})
})

describe("the Castellan speaks for the party", () => {
	it("makes ONE call for the whole party, whose prompt names them in order and holds no delver's private lore", async () => {
		const b = await book({ trustNarrator: false, partySpeech: "castellan" })
		const { receipt, said } = await turn(b)
		expect(receipt.outcome).toBe("ok")
		expect(said).toHaveLength(1)
		expect(ran(receipt, `${TURN}.say`)).toHaveLength(0)
		const prompts = promptsAt(receipt, `${PARTY}.prompt`)
		expect(prompts).toHaveLength(1)
		const prompt = prompts[0]!
		// Its own shipped instructions, the delvers named in the plan's order.
		expect(prompt).toContain("This turn you speak for them")
		expect(prompt).toMatch(/Verity — read the ledger aloud\nBrask — keep watch on the door/)
		// Lore everyone may know, and nobody's secret.
		expect(prompt).toContain(WORLD_FACT)
		for (const secret of [VERITY_SECRET, BRASK_SECRET, COOK_SECRET])
			expect(prompt).not.toContain(secret)
		// One row, under the Castellan's name, and the keeper read it.
		expect(ran(receipt, `${PARTY}.row.turn.placeholder`)).toHaveLength(1)
		expect(ran(receipt, "keep.played.keeperWrite")).toHaveLength(1)
	})

	it("Pick who speaks asks it for that delver's line alone, into the delver's own row", async () => {
		const b = await book({ trustNarrator: false, partySpeech: "castellan" })
		const { receipt, said } = await turn(b, b.cast.Brask!)
		expect(receipt.outcome).toBe("ok")
		expect(said).toHaveLength(1)
		const [prompt] = promptsAt(receipt, `${PARTY}.prompt`)
		expect(prompt).toMatch(/in this order:\nBrask\n/)
		for (const secret of [VERITY_SECRET, BRASK_SECRET, COOK_SECRET])
			expect(prompt).not.toContain(secret)
		expect(ran(receipt, `${PARTY}.row.picked.placeholder`)).toHaveLength(1)
		expect(ran(receipt, `${PARTY}.row.turn.placeholder`)).toHaveLength(0)
		// The one row the turn wrote is the picked delver's.
		const rows = await db
			.select({ role: schema.sessionMessages.role, characterId: schema.sessionMessages.characterId })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, b.session.id))
		const written = rows.filter((r) => r.role !== "user")
		expect(written).toHaveLength(1)
		expect(written[0]!.characterId).toBe(b.cast.Brask)
		expect(ran(receipt, "keep.played.keeperWrite")).toHaveLength(0)
	})
})

/**
 * **Whoever writes a delver's line keeps that delver's stats** (owner ruling
 * 2026-09-30). The planner names Verity alone; the keeper reports a change to
 * Verity, to Brask and to the world. While the Castellan speaks for the party
 * it wrote Verity's line, so its keeper keeps the world's books and Verity's —
 * never Brask's, who said nothing this turn. While each delver speaks, the
 * Castellan's keeper keeps the world's alone: Verity's line is her own turn's.
 */
describe("whose stats the Castellan's keeper keeps", () => {
	const KEPT = JSON.stringify({
		beats: ["Verity takes a cut from the trap."],
		speakers: [{ name: "Verity", intent: "spring the trap" }],
		unknownExit: "",
		knockQuestion: "",
		worldHints: { location: "" },
		values: [
			{ owner: "Verity", slot: "hp", value: "12" },
			{ owner: "Brask", slot: "hp", value: "9" },
			{ owner: "world", slot: "floor", value: "2" }
		],
		inventory: []
	})

	async function kept(partySpeech: "castellan" | "each") {
		const b = await book({ trustNarrator: true, partySpeech })
		const { receipt } = await turn(b, null, KEPT)
		expect(receipt.outcome).toBe("ok")
		const [resolve] = ran(receipt, "keep.played.keeperResolve")
		expect(resolve, "the Castellan's keeper did not resolve").toBeDefined()
		return { b, out: resolve.output?.main ?? resolve.output }
	}

	it("Castellan speaks for the party: the world and the delver it voiced land; a delver it did not voice is refused", async () => {
		const { b, out } = await kept("castellan")
		const owners = (out.changes as any[]).map((c) => `${c.owner.kind}:${c.owner.id}:${c.slotId}`)
		expect(owners).toContain(`session_cast:${b.cast.Verity}:core:slot/hp@1`)
		expect(owners).toContain(`session:${b.session.id}:core:slot/floor@1`)
		expect(owners.some((o) => o.startsWith(`session_cast:${b.cast.Brask}:`))).toBe(false)
		expect((out.refused as string[]).join("\n")).toMatch(/Brask/)
		const { valueOf } = await import("$lib/server/state/resolve")
		const hp = (id: number) =>
			valueOf(db as any, {
				sessionId: b.session.id,
				owner: { kind: "session_cast", id },
				slotId: "core:slot/hp@1"
			})
		expect(await hp(b.cast.Verity!)).toBe(12)
		expect(await hp(b.cast.Brask!)).not.toBe(9)
		expect(
			await valueOf(db as any, {
				sessionId: b.session.id,
				owner: { kind: "session", id: b.session.id },
				slotId: "core:slot/floor@1"
			})
		).toBe(2)
	})

	it("each delver speaks: the Castellan's keeper keeps the world alone", async () => {
		const { b, out } = await kept("each")
		const owners = (out.changes as any[]).map((c) => `${c.owner.kind}:${c.owner.id}:${c.slotId}`)
		expect(owners).toEqual([`session:${b.session.id}:core:slot/floor@1`])
		const refused = (out.refused as string[]).join("\n")
		expect(refused).toMatch(/Verity/)
		expect(refused).toMatch(/Brask/)
	})
})
