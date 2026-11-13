/**
 * 🚧 Show hidden stats (lane s4-follow-b): the person who seated an AI character
 * seat may read that seat's holder-only values on request — their own
 * connection only, never anyone else's view. While shown, the seater also edits those
 * values and answers their proposals (★s4-fb-3, owner 2026-11-10); configure stays the
 * session owner's (★s4-rul-a-1, owner 2026-11-10).
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, getAttributeSlot } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormSwitch } from "$lib/server/state/memberForm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
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

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-hidden-stats-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

afterEach(() => {
	memberFormSwitch.on = false
})

const SECRET = "test:slot/hidden-stats-secret@1"
defineAttributeSlot(SECRET, {
	type: "integer",
	label: { en: "Secret" },
	descriptor: "Heard by its holder alone.",
	appliesTo: ["cast"],
	earshot: "holder",
	config: { min: 0, max: 99 },
	default: 10
})
const SECRET_LIST = "test:slot/hidden-stats-pockets@1"
defineAttributeSlot(SECRET_LIST, {
	type: "list",
	label: { en: "Pockets" },
	descriptor: "What only its holder knows they carry.",
	appliesTo: ["cast"],
	earshot: "holder"
} as any)
const HEARD = "test:slot/hidden-stats-heard@1"
defineAttributeSlot(HEARD, {
	type: "integer",
	label: { en: "Heard" },
	descriptor: "Heard by everyone.",
	appliesTo: ["cast"],
	config: { min: 0, max: 99 },
	default: 10
})

let n = 0
const db = () => testDb as unknown as Db

async function user(label: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return (await createTestUser(testDb, `hidden-stats-${label}-${++n}`))!
}

/** One socket per user per world, as a real connection keeps its `data`. */
const sockets = new Map<number, any>()
const socketOf = (userId: number) => {
	if (!sockets.has(userId))
		sockets.set(userId, {
			user: { id: userId },
			data: {},
			io: {
				to: () => ({ emit: () => {} }),
				sockets: { sockets: new Map() }
			}
		})
	return sockets.get(userId)
}

async function call(
	name:
		| "stateGet"
		| "stateSet"
		| "stateLedger"
		| "stateConfigure"
		| "stateProposals"
		| "stateDecide"
		| "stateGivePiece",
	userId: number,
	params: unknown
) {
	const handlers = await import("$lib/server/sockets/state")
	const emitted: Array<{ event: string; data: any }> = []
	const res = await (handlers[name] as any)
		.handler(socketOf(userId), params, (event: string, data: any) =>
			emitted.push({ event, data })
		)
		.then(
			(r: any) => r,
			(e: Error) => ({ thrown: e.message })
		)
	return {
		res,
		errors: emitted
			.filter((e) => e.event.endsWith(":error"))
			.map((e) => e.data.error as string)
	}
}

/** Owner O, guests G (seated a carded and a card-less AI seat) and H. */
async function world() {
	const owner = await user("owner")
	const g = await user("g")
	const h = await user("h")
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Book ${++n}` })
		.returning()
	const [vera] = await testDb
		.insert(schema.characters)
		.values({ userId: owner.id, name: "Vera", description: "…" } as any)
		.returning()
	const carded = (
		await insertCastMember(testDb, {
			lorebookId: book!.id,
			binding: `{{char:v${++n}}}`,
			characterId: vera!.id,
			name: "Vera"
		})
	).member!
	const cardless = (
		await insertCastMember(testDb, {
			lorebookId: book!.id,
			binding: `{{char:a${++n}}}`,
			characterId: null,
			name: "Ash",
			ownName: "Ash"
		} as any)
	).member!
	const genreId = `test:genre/hidden-stats-${++n}`
	genreKeeping(genreId, {
		name: { en: "Hidden stats" },
		family: "test",
		slots: [getAttributeSlot(SECRET)!, getAttributeSlot(HEARD)!, getAttributeSlot(SECRET_LIST)!],
		events: {}
	})
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Run ${n}`,
			genreId,
			genreFields: { playerSheetLatitude: "all-own" },
			lorebookId: book!.id
		} as any)
		.returning()
	const sessionId = session!.id
	await testDb.insert(schema.sessionGuests).values([
		{ sessionId, userId: g.id, isPlayer: true },
		{ sessionId, userId: h.id, isPlayer: true }
	] as any)
	await testDb.insert(schema.sessionCharacters).values([
		{
			sessionId,
			characterId: vera!.id,
			castMemberId: carded.id,
			position: 0,
			seatedByUserId: g.id
		},
		{
			sessionId,
			characterId: null,
			castMemberId: cardless.id,
			position: 1,
			seatedByUserId: g.id
		}
	] as any)
	memberFormSwitch.on = true
	for (const m of [carded, cardless]) {
		const wrote = await call("stateSet", owner.id, {
			sessionId,
			owner: { kind: "seated_member", id: m.id },
			slotId: SECRET,
			value: m === carded ? 71 : 72
		})
		expect(wrote.errors).toEqual([])
	}
	return { owner, g, h, sessionId, carded, cardless }
}

const entryOf = (state: any, memberId: number) =>
	state?.cast?.byId?.[`seated_member:${memberId}`]
const secretOf = (state: any, memberId: number) =>
	entryOf(state, memberId)?.["hidden-stats-secret"]
const rowOf = (res: any, memberId: number) =>
	res.owners.find((o: any) => o.kind === "seated_member" && o.id === memberId)

describe("Show hidden stats — the seater reads their own AI seat's holder-only values", () => {
	for (const which of ["carded", "cardless"] as const) {
		test(`${which} seat: off by default, on by request, off again`, async () => {
			const w = await world()
			const m = w[which]
			const ref = `seated-member:${m.id}`
			const want = which === "carded" ? 71 : 72

			// Off: no param, and an empty list.
			for (const params of [
				{ sessionId: w.sessionId },
				{ sessionId: w.sessionId, showHiddenStats: [] }
			]) {
				const { res } = await call("stateGet", w.g.id, params)
				expect(secretOf(res.state, m.id)).toBeUndefined()
				expect(rowOf(res, m.id).showingHiddenStats).toBe(false)
			}
			// H seated nothing: no flag on the row.
			const asH = (
				await call("stateGet", w.h.id, { sessionId: w.sessionId })
			).res
			expect(rowOf(asH, m.id).showingHiddenStats).toBeUndefined()

			// On.
			const on = (
				await call("stateGet", w.g.id, {
					sessionId: w.sessionId,
					showHiddenStats: [ref]
				})
			).res
			expect(secretOf(on.state, m.id)).toBe(want)
			expect(rowOf(on, m.id).showingHiddenStats).toBe(true)
			// Absent param leaves the set as it is.
			const kept = (
				await call("stateGet", w.g.id, { sessionId: w.sessionId })
			).res
			expect(secretOf(kept.state, m.id)).toBe(want)
			// A write's reply (settled) still carries it.
			const wrote = await call("stateSet", w.g.id, {
				sessionId: w.sessionId,
				owner: { kind: "seated_member", id: m.id },
				slotId: HEARD,
				value: 3
			})
			expect(wrote.errors).toEqual([])
			expect(secretOf(wrote.res.state, m.id)).toBe(want)
			// The ledger is a read too: it never throws for the viewer showing hidden stats.
			expect(
				(await call("stateLedger", w.g.id, { sessionId: w.sessionId }))
					.errors
			).toEqual([])

			// Off again.
			const off = (
				await call("stateGet", w.g.id, {
					sessionId: w.sessionId,
					showHiddenStats: []
				})
			).res
			expect(secretOf(off.state, m.id)).toBeUndefined()
			expect(rowOf(off, m.id).showingHiddenStats).toBe(false)
		})
	}

	test("someone who did not seat it never reads it, and no flag appears", async () => {
		const w = await world()
		const ref = `seated-member:${w.cardless.id}`
		const { res } = await call("stateGet", w.h.id, {
			sessionId: w.sessionId,
			showHiddenStats: [ref]
		})
		expect(secretOf(res.state, w.cardless.id)).toBeUndefined()
		expect(rowOf(res, w.cardless.id).showingHiddenStats).toBeUndefined()
	})

	test("the session's owner reads everything and has no flag", async () => {
		const w = await world()
		const { res } = await call("stateGet", w.owner.id, {
			sessionId: w.sessionId,
			showHiddenStats: [`seated-member:${w.cardless.id}`]
		})
		expect(secretOf(res.state, w.cardless.id)).toBe(72)
		expect(rowOf(res, w.cardless.id).showingHiddenStats).toBeUndefined()
	})

	describe("while shown, the seater also edits and answers (★s4-fb-3)", () => {
		const show = (
			w: Awaited<ReturnType<typeof world>>,
			userId: number,
			m: { id: number }
		) =>
			call("stateGet", userId, {
				sessionId: w.sessionId,
				showHiddenStats: [`seated-member:${m.id}`]
			})
		const hide = (w: Awaited<ReturnType<typeof world>>, userId: number) =>
			call("stateGet", userId, {
				sessionId: w.sessionId,
				showHiddenStats: []
			})
		const ask = (
			w: Awaited<ReturnType<typeof world>>,
			m: { id: number },
			value = 5
		) => ({
			sessionId: w.sessionId,
			owner: { kind: "seated_member", id: m.id },
			slotId: SECRET,
			value
		})
		const propose = async (
			w: Awaited<ReturnType<typeof world>>,
			m: { id: number },
			value: number
		) => {
			const { proposeChange } = await import("$lib/server/state/write")
			return proposeChange(
				testDb as any,
				{ sessionId: w.sessionId, updatedBy: "model" },
				{
					owner: { kind: "seated_member", id: m.id },
					slotId: SECRET,
					value
				} as any
			)
		}
		const listed = async (
			w: Awaited<ReturnType<typeof world>>,
			userId: number
		) =>
			(
				(
					await call("stateProposals", userId, {
						sessionId: w.sessionId
					})
				).res.proposals ?? []
			).map((p: any) => p.id)

		for (const which of ["carded", "cardless"] as const) {
			test(`${which} seat, view on: set is written, proposals are listed and decided, configure stays the owner's`, async () => {
				const w = await world()
				const m = w[which]
				await show(w, w.g.id, m)

				const set = await call("stateSet", w.g.id, ask(w, m, 5))
				expect(set.errors).toEqual([])
				expect(secretOf(set.res.state, m.id)).toBe(5)

				const accepted = await propose(w, m, 21)
				const rejected = await propose(w, m, 22)
				expect(await listed(w, w.g.id)).toEqual(
					expect.arrayContaining([accepted, rejected])
				)
				const yes = await call("stateDecide", w.g.id, {
					proposalId: accepted,
					accept: true
				})
				expect(yes.errors).toEqual([])
				expect(yes.res.status).toBe("accepted")
				expect(secretOf(yes.res.state, m.id)).toBe(21)
				const no = await call("stateDecide", w.g.id, {
					proposalId: rejected,
					accept: false
				})
				expect(no.errors).toEqual([])
				expect(no.res.status).toBe("rejected")

				// Configure stays the session owner's (★s4-rul-a-1, owner 2026-11-10).
				const conf = await call("stateConfigure", w.g.id, {
					sessionId: w.sessionId,
					owner: { kind: "seated_member", id: m.id },
					slotId: SECRET,
					config: { max: 50 }
				})
				expect(conf.errors).toEqual([
					"Only the session owner changes how a stat is set up."
				])
			})

			test(`${which} seat, view off or never asked: set is refused, the proposal is not listed, decide answers not found`, async () => {
				const w = await world()
				const m = w[which]
				const pid = await propose(w, m, 31)
				for (const phase of ["never", "on-then-off"]) {
					if (phase === "on-then-off") {
						await show(w, w.g.id, m)
						await hide(w, w.g.id)
					}
					const set = await call("stateSet", w.g.id, ask(w, m, 6))
					expect(set.errors.length).toBe(1)
					expect(await listed(w, w.g.id)).not.toContain(pid)
					const dec = await call("stateDecide", w.g.id, {
						proposalId: pid,
						accept: true
					})
					expect(dec.errors).toEqual(["Proposal not found."])
				}
				// Nothing was written: the owner still reads the first value.
				const o = (
					await call("stateGet", w.owner.id, {
						sessionId: w.sessionId
					})
				).res
				expect(secretOf(o.state, m.id)).toBe(
					which === "carded" ? 71 : 72
				)
			})

			test(`${which} seat: a third user gains nothing, whether the seater's view is on or off`, async () => {
				const w = await world()
				const m = w[which]
				const pid = await propose(w, m, 41)
				for (const seaterShows of [true, false]) {
					if (seaterShows) await show(w, w.g.id, m)
					else await hide(w, w.g.id)
					await show(w, w.h.id, m)
					const set = await call("stateSet", w.h.id, ask(w, m, 7))
					expect(set.errors.length).toBe(1)
					expect(await listed(w, w.h.id)).not.toContain(pid)
					const dec = await call("stateDecide", w.h.id, {
						proposalId: pid,
						accept: true
					})
					expect(dec.errors).toEqual(["Proposal not found."])
				}
			})

			test(`${which} seat: the session's owner sets and decides as before`, async () => {
				const w = await world()
				const m = w[which]
				const set = await call("stateSet", w.owner.id, ask(w, m, 8))
				expect(set.errors).toEqual([])
				expect(secretOf(set.res.state, m.id)).toBe(8)
				const pid = await propose(w, m, 42)
				expect(await listed(w, w.owner.id)).toContain(pid)
				const dec = await call("stateDecide", w.owner.id, {
					proposalId: pid,
					accept: true
				})
				expect(dec.errors).toEqual([])
				expect(secretOf(dec.res.state, m.id)).toBe(42)
			})
		}
	})
})

describe("giving from a shown seat's holder-only list (★s4-fb-3, lead 2026-11-10)", () => {
	const pockets = async (w: Awaited<ReturnType<typeof world>>) => {
		const { applyChange } = await import("$lib/server/state/write")
		await testDb.transaction(async (tx: any) => {
			await applyChange(
				tx,
				{ sessionId: w.sessionId, updatedBy: "user", userId: w.owner.id } as any,
				{
					owner: { kind: "seated_member", id: w.carded.id },
					slotId: SECRET_LIST,
					op: "add",
					items: ["Locket"]
				} as any
			)
		})
	}
	const give = (w: Awaited<ReturnType<typeof world>>, userId: number) =>
		call("stateGivePiece", userId, {
			sessionId: w.sessionId,
			from: { kind: "seated_member", id: w.carded.id },
			to: { kind: "seated_member", id: w.cardless.id },
			slotId: SECRET_LIST,
			index: 0
		})
	const showBoth = (w: Awaited<ReturnType<typeof world>>, userId: number, on: boolean) =>
		call("stateGet", userId, {
			sessionId: w.sessionId,
			showHiddenStats: on
				? [`seated-member:${w.carded.id}`, `seated-member:${w.cardless.id}`]
				: []
		})

	test("the seater, showing both seats, gives the hidden thing at once", async () => {
		const w = await world()
		await pockets(w)
		await showBoth(w, w.g.id, true)
		const res = await give(w, w.g.id)
		expect(res.errors).toEqual([])
		expect(res.res.given).toBe("direct")
	})

	test("with the view off, the same give is refused", async () => {
		const w = await world()
		await pockets(w)
		await showBoth(w, w.g.id, false)
		const res = await give(w, w.g.id)
		expect(res.errors.length).toBe(1)
		expect(res.res.given).toBeUndefined()
	})

	test("someone who did not seat them gains nothing by asking to show them", async () => {
		const w = await world()
		await pockets(w)
		await showBoth(w, w.h.id, true)
		const res = await give(w, w.h.id)
		expect(res.errors.length).toBe(1)
	})
})
