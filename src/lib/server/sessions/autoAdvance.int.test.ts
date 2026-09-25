/**
 * Auto-advance (PLAN-turn-order §4.6, unit A7): the `turn-order-changed`
 * listener — whether the head turn fires by itself once the order is
 * written, and how far.
 *
 * The listener's fire path (`fireTurnEntry`) is stubbed to a recorder that
 * keeps the real `entryIsPersons`, so a person's entry still ends the round
 * through the real rule; everything else is the real listener against a real
 * session on the chat genre (which declares `autoAdvance` with default
 * `round`).
 *
 * What is pinned:
 *
 *  1. **`next` fires the head once on a person's send** — and only on that
 *     send: an edit, a settings save, a system recompute and an auto run's
 *     cause all refuse (`reason: 'cause'`).
 *  2. **`round` continues** on an auto run's own cause, **stops at an empty
 *     order**, and **stops at a person's entry** (their turn, shown, budget
 *     handed back).
 *  3. **`off` never fires**, even on a person's send.
 *  4. **The cap** stops a runaway round at `MAX_AUTO_ADVANCE_PER_SEND`.
 *  5. The head passes through untouched: a **narrator entry** (`ref: null`)
 *     is fired as the head, and the respond-with-no-speaker conversion is
 *     the fire road's own (pinned in `fireTurn.int.test.ts`).
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import {
	readTurnOrder,
	type TurnEntryV1,
	type TurnOrderV1
} from "@serene-pub/sdk"
import {
	onTurnOrderChanged,
	MAX_AUTO_ADVANCE_PER_SEND,
	_resetAutoAdvance
} from "./autoAdvance"
import { EMPTY_TURN_ORDER } from "@serene-pub/sdk"

let db: TestDb
let userId: number

/** The entries the listener fired, in order, through the stubbed fire road. */
const fires: TurnEntryV1[] = []

vi.mock("$lib/server/sessions/fireTurn", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/sessions/fireTurn")>()
	return {
		...actual,
		fireTurnEntry: vi.fn(
			async (
				dbin: any,
				opts: { sessionId: number; entry: TurnEntryV1 }
			) => {
				const person = await actual.entryIsPersons(
					dbin,
					opts.sessionId,
					opts.entry
				)
				if (person) return { fired: false, reason: "person" }
				fires.push(opts.entry)
				return { fired: true, runId: `run-auto-${fires.length}` }
			}
		)
	}
})

const entry = (ref: string, via = "strategy"): TurnEntryV1 => ({
	ref: ref as never,
	via
})

const orderWith = (
	head: TurnEntryV1 | null,
	basedOnAt: number
): TurnOrderV1 => ({
	...EMPTY_TURN_ORDER,
	order: head ? [head] : [],
	basedOnAt,
	computedAt: basedOnAt + 1,
	runId: `run-${basedOnAt}`,
	event: "core:event/message-completed@1",
	strategy: "core:task/turn-round-robin@1"
})

async function makeSession(autoAdvance?: "off" | "next" | "round") {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			...(autoAdvance ? { genreFields: { autoAdvance } } : {})
		})
		.returning()
	return session
}

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
	userId = (await createTestUser(db, "auto-advance-owner")).id
}, 60_000)

const sendOf = (id: number) => ({ kind: "user" as const, userId: id })
const autoOf = (id: number) =>
	({
		kind: "run",
		runId: "run-last",
		auto: true,
		userId: id
	}) as const

async function on(sessionId: number, cause: unknown, order: TurnOrderV1) {
	return onTurnOrderChanged(db, {
		sessionId,
		userId,
		cause: cause as any,
		turnOrder: order
	})
}

describe("auto-advance — the listener", () => {
	beforeEach(() => {
		fires.length = 0
	})

	it("`next` fires the head once on a person's send, and refuses every other cause", async () => {
		const s = await makeSession("next")
		const head = entry("character:3")
		const first = await on(s.id, sendOf(userId), orderWith(head, 1000))
		expect(first).toMatchObject({ fired: true, mode: "next" })
		expect(fires).toEqual([head])

		// A recompute that is not the send never fires under `next` — an
		// edit, a settings save, a system turn, or the continuation of a
		// round an auto run's own completion triggered.
		for (const [label, cause] of [
			["edit", { kind: "edit", userId }],
			["settings", { kind: "settings", userId }],
			["system", { kind: "system" }],
			["auto run", autoOf(userId)]
		] as const) {
			fires.length = 0
			const out = await on(
				s.id,
				cause as any,
				orderWith(entry("character:3"), 1100)
			)
			expect(out, label).toMatchObject({ fired: false, reason: "cause" })
			expect(fires, label).toEqual([])
		}
	})

	it("`round` continues on an auto run's own cause and stops at an empty order", async () => {
		const s = await makeSession("round")
		const bella = entry("character:3")
		const carla = entry("character:4")
		await on(s.id, sendOf(userId), orderWith(bella, 2000))
		const continued = await on(s.id, autoOf(userId), orderWith(carla, 2100))
		expect(continued).toMatchObject({ fired: true, mode: "round" })
		expect(fires).toEqual([bella, carla])
		// Empty order: the round ends — not a fault, just nothing left.
		const done = await on(s.id, autoOf(userId), orderWith(null, 2200))
		expect(done).toMatchObject({
			fired: false,
			mode: "round",
			reason: "empty"
		})
		expect(fires).toEqual([bella, carla])
	})

	it("`round` stops at a person's entry, and the budget is handed back", async () => {
		const [persona] = await db
			.insert(schema.characters)
			.values({
				userId,
				name: "a persona",
				description: "…",
				metadata: {}
			})
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId,
				isGroup: false,
				genreFields: { autoAdvance: "round" }
			})
			.returning()
		await db
			.insert(schema.sessionPersonas)
			.values({ sessionId: session.id, personaId: persona.id })

		const bella = entry("character:3")
		await on(session.id, sendOf(userId), orderWith(bella, 3000))
		expect(fires).toEqual([bella])
		const theirs = entry(`character:${persona.id}`)
		const stopped = await on(
			session.id,
			autoOf(userId),
			orderWith(theirs, 3100)
		)
		expect(stopped).toMatchObject({
			fired: false,
			mode: "round",
			reason: "person"
		})
		expect(fires).toEqual([bella])
		// Their turn spent, the next send starts with a full budget again.
		const again = await on(
			session.id,
			sendOf(userId),
			orderWith(entry("character:5"), 3200)
		)
		expect(again).toMatchObject({ fired: true, mode: "round" })
		expect(fires).toEqual([bella, entry("character:5")])
	})

	it("`off` never fires, even on a person's send", async () => {
		const s = await makeSession("off")
		const out = await on(
			s.id,
			sendOf(userId),
			orderWith(entry("character:3"), 4000)
		)
		expect(out).toMatchObject({ fired: false, mode: "off", reason: "off" })
		expect(fires).toEqual([])
	})

	it("a narrator entry passes through as the head and is fired untouched", async () => {
		const s = await makeSession("next")
		const narrator: TurnEntryV1 = { ref: null, via: "voice" }
		const out = await on(s.id, sendOf(userId), orderWith(narrator, 5000))
		expect(out).toMatchObject({ fired: true, mode: "next" })
		expect(fires).toEqual([narrator])
	})

	it("a Stop ends the round, whichever release wins the fence (R34)", async () => {
		const s = await makeSession("round")
		const sessionId = s.id
		const order = orderWith(entry("character:1", "strategy"), 1)
		// The run's own finalisation (liveRow.finish): a run cause with no auto.
		const byRun = await onTurnOrderChanged(db, {
			sessionId,
			userId,
			cause: { kind: "run", runId: "run-stopped" },
			turnOrder: order
		})
		// The person's release (sessionMessages:cancel): an edit cause.
		const byPerson = await onTurnOrderChanged(db, {
			sessionId,
			userId,
			cause: { kind: "edit", userId },
			turnOrder: order
		})
		expect(byRun.fired).toBe(false)
		expect(byPerson.fired).toBe(false)
		expect(fires).toEqual([])
	})

	it("a runaway round stops at the cap", async () => {
		const s = await makeSession("round")
		_resetAutoAdvance(s.id)
		let last: { reason?: string } = {}
		for (let i = 0; i < MAX_AUTO_ADVANCE_PER_SEND; i++)
			last = await on(
				s.id,
				autoOf(userId),
				orderWith(entry(`character:${i}`), 6000 + i)
			)
		expect(last).toMatchObject({ fired: true, mode: "round" })
		const cap = await on(
			s.id,
			autoOf(userId),
			orderWith(entry("character:99"), 7000)
		)
		expect(cap).toMatchObject({
			fired: false,
			mode: "round",
			reason: "cap"
		})
		expect(fires).toHaveLength(MAX_AUTO_ADVANCE_PER_SEND)
		_resetAutoAdvance(s.id)
	})

	it("the order it fires is the stored order — the listener reads state, it writes nothing", async () => {
		const s = await makeSession("next")
		const head = entry("character:3")
		await on(s.id, sendOf(userId), orderWith(head, 8000))
		const [row] = await db
			.select({ metadata: schema.sessions.metadata })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, s.id))
		// The listener wrote no order of its own — the recompute did.
		expect(readTurnOrder(row!.metadata).order).toEqual([])
	})
})
