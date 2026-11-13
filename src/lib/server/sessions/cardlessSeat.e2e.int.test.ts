/**
 * 🚧 A card-less seat plays, end to end (seat-cast S4, lane s4-seat-live, w7).
 *
 * One session, one book. Member M is card-less and was seated by a GUEST;
 * N is card-less and seated; B is a member nobody is seated as; C is a
 * carded seat. Each of M, N and B holds a private lore entry; M holds a
 * sprite set. The ten `it`s drive M through the same entry points
 * production uses — `fireTurnEntry` (a turn-order fire), the real
 * `sessionMessages:regenerate` handler, the state write door
 * (`state:set`), `canActOnMessage`, `writeSeatName` — and only the model
 * (and the embedding calls) are faked.
 *
 * ⚠ Card ids and member ids share one id range: a card is made whose id
 * equals M's when the ranges let one exist, and nothing may cross to it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import { PNG } from "pngjs"
import { defineAttributeSlot } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { characterLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { insertCastMember } from "$lib/server/characters/versions"
import { seatCast } from "$lib/server/sessions/seats"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "cardless-e2e-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	autoEnqueueLorebook: vi.fn(async () => {}),
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock(
	"$lib/server/sockets/utils/broadcastHelpers",
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		emitToUserRedacted: async () => {},
		broadcastToSessionUsers: async () => {}
	})
)
// The sprite picker's embedding is not under test: the host's choices are.
vi.mock("$lib/server/sprites/vectors", () => ({
	spriteVectors: async () => ({ lineVector: null, labelVectors: null })
}))

/** Every host the road built: its scope and what each lore read returned. */
const hosts: Array<{ scope: any; loreNames: string[] }> = []
vi.mock("$lib/server/pipelines/runtime/host", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/pipelines/runtime/host")
		>()
	return {
		...actual,
		createHost: (...args: Parameters<typeof actual.createHost>) => {
			const host = actual.createHost(...args)
			const rec = { scope: args[1], loreNames: [] as string[] }
			hosts.push(rec)
			const read = host.read?.bind(host)
			if (read)
				host.read = (async (kind: string, q: any, node: any) => {
					const rows = await read(kind as any, q, node)
					if (kind === "lorebook_entries" && Array.isArray(rows))
						for (const r of rows as any[])
							if (r.source === "characterLore")
								rec.loreNames.push(String(r.name))
					return rows
				}) as any
			return host
		}
	}
})

/** What each model call was handed: its stops and the compiled prompt. */
const modelCalls: Array<{ stops: any; prompt: string }> = []
const REPLY = "Mira turns the lantern low."
class FakeAdapter {
	stops: any
	injected: any
	constructor(_p: any) {}
	abort() {}
	async preflight() {}
	withStops(s: any) {
		this.stops = s
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	withStreaming() {
		return this
	}
	async generateText() {
		modelCalls.push({
			stops: this.stops,
			prompt: JSON.stringify(this.injected ?? "")
		})
		return {
			compiledPrompt: this.injected ?? {
				prompt: "p",
				messages: undefined,
				meta: {} as any
			},
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent(REPLY)
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

const GRIT = "test:slot/cardless-e2e-grit@1"
const GRIT_KEY = "cardless-e2e-grit"
const grit = defineAttributeSlot(GRIT, {
	type: "integer",
	label: { en: "Grit" },
	descriptor: "How much is left in the tank.",
	appliesTo: ["cast"],
	config: { min: 0, max: 20 },
	default: 10
})

function png(seed: number): Buffer {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(0)
	img.data[0] = seed % 256
	img.data[1] = Math.floor(seed / 256) % 256
	img.data[3] = 255
	return PNG.sync.write(img)
}

const D = () => db as unknown as Db
const fakeSocket = (uid: number) =>
	({ user: { id: uid }, io: { to: () => ({ emit: () => {} }) } }) as any

type Member = typeof schema.lorebookBindings.$inferSelect
let owner: { id: number }
let guest: { id: number }
let guest2: { id: number }
let sessionId: number
/** The second session, on a genre that tracks the test slot (step 8). */
let stateSessionId: number
let bookId: number
let M: Member
let N: Member
let B: Member
let C: Member
let cardId: number
/** A card whose id equals M's, when the ranges let one exist. */
let twin: { id: number } | null = null
const SPEAKER = () => `seated-member:${M.id}`

/** The host the fired turn's run built, and the model call it made. */
let firstRun: { scope: any; loreNames: string[] } | undefined
let firstCall: { stops: any; prompt: string } | undefined
let replyRow: typeof schema.sessionMessages.$inferSelect | undefined

const messagesOf = () =>
	db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(schema.sessionMessages.id)

const runHost = () =>
	hosts.filter((h) => h.scope?.specId === "core:spec/story-respond").at(-1)

/** The wire stop values, whatever shape the adapter was handed. */
const stopValues = (stops: any): string[] => {
	const list = Array.isArray(stops)
		? stops
		: (stops?.sent ?? stops?.stops ?? [])
	return (list as any[]).map((s) => (typeof s === "string" ? s : s.value))
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-cardless-e2e-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	owner = await createTestUser(db, "e2e-owner")
	guest = await createTestUser(db, "e2e-guest")
	guest2 = await createTestUser(db, "e2e-guest2")

	// The model: one text connection, one sampling, the capability default.
	const [textConn] = await db
		.insert(schema.connections)
		.values({
			name: "Text",
			type: "koboldcpp",
			baseUrl: "http://text",
			// A completion wire: speaker labels are the transcript, so the stop
			// list and the seed line are sent rather than dropped.
			capabilities: { overrides: { wire_chat: false } }
		} as any)
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const modelId = (await ensureConnectionModel(
		db,
		textConn!.id,
		"default-7b"
	))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "e2e sampling",
			isImmutable: false,
			values: {
				contextTokens: 8192,
				responseTokens: 200,
				temperature: 0.1
			},
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn!.id,
		connectionModelId: modelId,
		samplingConfigId: sampling!.id
	})

	const [card] = await db
		.insert(schema.characters)
		.values({
			userId: owner.id,
			name: "Cardo",
			description: "A card."
		} as any)
		.returning()
	cardId = card!.id

	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: "E2E Book" } as any)
		.returning()
	bookId = book!.id
	const member = async (
		name: string,
		characterId: number | null,
		description: string | null
	) =>
		(
			await insertCastMember(db, {
				lorebookId: bookId,
				binding: `{{char:${name}}}`,
				characterId,
				name,
				ownName: characterId == null ? name : null,
				description
			} as any)
		).member
	M = await member("Mira", null, "A lantern-keeper of the marsh.")
	N = await member("Nox", null, "A quiet ferryman.")
	B = await member("Bede", null, "A clerk nobody has seated.")
	C = await member("Cardo", cardId, null)

	genreKeeping("test:genre/cardless-e2e", {
		name: { en: "Cardless e2e" },
		family: "test",
		slots: [grit],
		events: {}
	})
	const [minimal] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-story-minimal"))
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: "Cardless e2e",
			presetId: minimal!.id,
			lorebookId: bookId
		} as any)
		.returning()
	sessionId = session!.id
	await db.insert(schema.sessionGuests).values([
		{ sessionId, userId: guest.id, isPlayer: true },
		{ sessionId, userId: guest2.id, isPlayer: true }
	])
	const seat = async (input: Record<string, unknown>) => {
		const out = await db.transaction(async (tx) =>
			seatCast(tx as unknown as Db, { sessionId, ...input } as any)
		)
		if (!out.ok) throw new Error(`not seated: ${JSON.stringify(out)}`)
	}
	await seat({ castMemberId: M.id, seatedBy: guest.id })
	await seat({ castMemberId: N.id, seatedBy: owner.id })
	await seat({ cardId, seatedBy: owner.id })

	// The state door only writes slots the session's genre tracks, and a test
	// genre is not installed for a turn: the same members, seated the same way,
	// in a second session on the test genre carry step 8.
	const [stateSession] = await db
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: "Cardless e2e state",
			genreId: "test:genre/cardless-e2e",
			lorebookId: bookId
		} as any)
		.returning()
	stateSessionId = stateSession!.id
	await seat({
		sessionId: stateSessionId,
		castMemberId: M.id,
		seatedBy: guest.id
	})
	await seat({
		sessionId: stateSessionId,
		castMemberId: N.id,
		seatedBy: owner.id
	})
	await seat({ sessionId: stateSessionId, cardId, seatedBy: owner.id })

	await db.insert(schema.sessionMessages).values({
		sessionId,
		userId: owner.id,
		role: "user",
		content: "who keeps the lantern?"
	} as any)
	await db.insert(schema.lorebookEntries).values(
		characterLoreValues(
			[M, N, B].map((m) => ({
				lorebookId: bookId,
				name: `secret of ${m.name}`,
				keys: "",
				content: `${m.name} keeps a secret.`,
				lorebookBindingId: m.id
			}))
		)
	)
	const { importSprites } = await import("$lib/server/sprites")
	await importSprites(
		db as never,
		owner.id,
		{ castMemberId: M.id },
		[{ label: "joy", bytes: png(31337) }],
		"upload"
	)
	// A card whose id equals M's, when the id ranges let one exist.
	for (let i = 0; i < 200 && !twin; i++) {
		const [c] = await db
			.insert(schema.characters)
			.values({
				userId: owner.id,
				name: `Twin ${i}`,
				description: ""
			} as any)
			.returning()
		if (c!.id === M.id) twin = c!
		if (c!.id > M.id) break
	}
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

describe("a card-less seat plays through the real handlers", () => {
	it("1. firing M's seated-member entry runs a turn as M, not as the narrator", async () => {
		const { fireTurnEntry } = await import("$lib/server/sessions/fireTurn")
		hosts.length = 0
		modelCalls.length = 0
		const out = await fireTurnEntry(D(), {
			sessionId,
			userId: owner.id,
			entry: { ref: SPEAKER(), via: "pick" } as any,
			cause: { kind: "user", userId: owner.id } as any,
			socket: fakeSocket(owner.id),
			emitToUser: () => {}
		})
		expect(out.fired, out.reason).toBe(true)
		firstRun = runHost()
		firstCall = modelCalls.at(-1)
		expect(firstRun).toBeDefined()
		expect(firstRun!.scope.currentCastMemberId).toBe(M.id)
		expect(firstRun!.scope.currentCharacterId ?? null).toBeNull()
		expect(firstCall).toBeDefined()
	})

	it("2. the compiled prompt names M on the seed line, carries M's description, not as the narrator", async () => {
		const prompt = firstCall!.prompt
		expect(prompt).toContain("Mira")
		expect(prompt).toContain("A lantern-keeper of the marsh.")
		// The seed line: the prompt ends on M's label, never the narrator's.
		// (`prompt` is the JSON-encoded payload: newlines read as `\n`.)
		expect(prompt).toMatch(/Assistant:\\nMira: (\\n)?"/)
		expect(prompt).not.toContain("Narrator:")
		// M is the speaker, so the prompt does not write the whole cast.
		expect(prompt).not.toContain("You write Mira, Nox, and Cardo")
	})

	it("3. the run's retrieved private lore includes M's entry and not N's or B's", async () => {
		const seen = new Set(firstRun!.loreNames)
		expect(seen.has("secret of Mira")).toBe(true)
		expect(seen.has("secret of Nox")).toBe(false)
		expect(seen.has("secret of Bede")).toBe(false)
	})

	it("4. the stop list sent to the model has no `Mira:` and has `Nox:`", async () => {
		const sent = stopValues(firstCall!.stops)
		expect(sent.length).toBeGreaterThan(0)
		expect(sent).not.toContain("Mira:")
		expect(sent).toContain("Nox:")
	})

	it("5. the written reply row is M's: character_id null, cast_member_id M, speaker stamped, content is the reply", async () => {
		replyRow = (await messagesOf())
			.filter((m) => m.role === "assistant")
			.at(-1)
		expect(replyRow).toBeDefined()
		expect(replyRow!.characterId).toBeNull()
		expect(replyRow!.castMemberId).toBe(M.id)
		expect((replyRow!.metadata as any).speaker).toBe(SPEAKER())
		expect(replyRow!.content).toBe(REPLY)
	})

	it("6. regenerating that row re-drives it as M and keeps all three stamps", async () => {
		const { sessionMessagesRegenerateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		hosts.length = 0
		modelCalls.length = 0
		const emitted: Array<[string, any]> = []
		const res: any = await sessionMessagesRegenerateHandler.handler(
			fakeSocket(guest.id),
			{ id: replyRow!.id } as any,
			((event: string, data: any) => emitted.push([event, data])) as any
		)
		expect(res.error, JSON.stringify(emitted)).toBeUndefined()
		const run = runHost()
		expect(run?.scope.currentCastMemberId).toBe(M.id)
		expect(run?.scope.currentCharacterId ?? null).toBeNull()
		expect(modelCalls.length).toBeGreaterThan(0)
		const [row] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, replyRow!.id))
		expect(row!.characterId).toBeNull()
		expect(row!.castMemberId).toBe(M.id)
		expect((row!.metadata as any).speaker).toBe(SPEAKER())
		expect(row!.content).toBe(REPLY)
		const rows = await messagesOf()
		expect(rows.filter((m) => m.castMemberId === M.id)).toHaveLength(1)
	})

	it("7. the sprite pick for M's line comes from M's own sprite set (castMemberId path)", async () => {
		const { coreBindings } = await import(
			"$lib/server/pipelines/runtime/bindings"
		)
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const speaker = (replyRow!.metadata as any).speaker as string
		const calls: Array<Record<string, unknown>> = []
		const results: any[] = []
		const ctx = {
			call: async (payload: Record<string, unknown>) => {
				calls.push(payload)
				const result = await createHost(D(), { sessionId }).call!(
					payload as any,
					{
						key: "pick",
						definitionId: "core:oracle/pick-sprite"
					} as any,
					{} as any,
					{} as any
				)
				results.push(result)
				return { choices: null }
			},
			log: () => {}
		}
		await (coreBindings() as any)["core:oracle/pick-sprite@1"](
			{ scope: { sessionId }, speaker, text: REPLY, params: {} },
			ctx
		)
		expect(calls).toHaveLength(1)
		expect(calls[0]).toEqual(
			expect.objectContaining({ castMemberId: M.id })
		)
		expect("characterId" in calls[0]!).toBe(false)
		expect(results[0].choices.castMemberId).toBe(M.id)
		expect(results[0].choices.labels).toEqual(["joy"])
	})

	it("8. a state write on the seated_member owner lands, and stateFor shows it on M's entry only", async () => {
		const { stateSet } = await import("$lib/server/sockets/state")
		const errors: string[] = []
		const outcome = await stateSet
			.handler(
				fakeSocket(owner.id),
				{
					sessionId: stateSessionId,
					owner: { kind: "seated_member", id: M.id },
					slotId: GRIT,
					value: 3
				} as any,
				(event: string, data: any) => {
					if (event.endsWith(":error")) errors.push(data.error)
				}
			)
			.then(
				() => "written" as const,
				(e: Error) => e.message
			)
		expect({ outcome, errors }).toEqual({ outcome: "written", errors: [] })
		const rows = await db
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.sessionId, stateSessionId),
					eq(schema.attributeValues.slotId, GRIT)
				)
			)
		expect(rows.map((r) => [r.ownerKind, r.ownerId])).toEqual([
			["seated_member", M.id]
		])
		const { stateFor, valueOf } = await import("$lib/server/state/resolve")
		const state = await stateFor(D(), stateSessionId)
		expect(state.cast.byId[`seated_member:${M.id}`]![GRIT_KEY]).toBe(3)
		expect(state.cast.byId[`seated_member:${N.id}`]![GRIT_KEY]).toBe(10)
		expect(state.cast.byId[`seated_member:${C.id}`]![GRIT_KEY]).toBe(10)
		expect(state.cast.byId[String(M.id)]).toBeUndefined()
		if (twin) {
			const read = await valueOf(D(), {
				sessionId: stateSessionId,
				owner: { kind: "session_cast", id: twin.id },
				slotId: GRIT
			})
			expect(read).toBe(10)
		}
	})

	it("9. canActOnMessage on M's line: the seating guest and the owner may, a second guest may not", async () => {
		const { canActOnMessage } = await import(
			"$lib/server/messages/permissions"
		)
		expect(await canActOnMessage(D(), replyRow!.id, guest.id)).toBe(true)
		expect(await canActOnMessage(D(), replyRow!.id, owner.id)).toBe(true)
		expect(await canActOnMessage(D(), replyRow!.id, guest2.id)).toBe(false)
	})

	it("10. a named Take a seat mints exactly one card-less member in the session's book and a player seat holding it", async () => {
		const { writeSeatName } = await import("$lib/server/sessions/seatName")
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(D(), sessionId)
		const membersOf = (lorebookId: number) =>
			db
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
		const [attachedBefore, ownBefore] = [
			(await membersOf(bookId)).length,
			(await membersOf(own.id)).length
		]
		const seatId = await writeSeatName(D(), {
			sessionId,
			userId: guest2.id,
			isOwner: false,
			name: "Ann"
		})
		expect(seatId).not.toBeNull()
		const minted = await membersOf(own.id)
		expect(minted.length - ownBefore).toBe(1)
		expect((await membersOf(bookId)).length).toBe(attachedBefore)
		const member = minted.at(-1)!
		expect(member.characterId).toBeNull()
		const [seat] = await db
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, seatId!))
		expect(seat).toMatchObject({
			sessionId,
			personaId: null,
			seatName: "Ann",
			userId: guest2.id,
			castMemberId: member.id
		})
	})
})
