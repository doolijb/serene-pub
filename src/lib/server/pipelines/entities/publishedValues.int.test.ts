/**
 * The published-values document an enabled-when reads (plans/29 R-15;
 * plans/30 U5e, 2026-09-17).
 *
 * What is pinned:
 *
 *  1. **`state` is the resolver's answer**, not a hand-built map: an
 *     Adventure session with no location set has no `state.world.location`;
 *     one set through `setValue` carries it under the bare slot key — the
 *     path a genre default over the location would name — and under the
 *     qualified key beside it. A Chat session, whose genre declares no
 *     slots, publishes an empty world.
 *  2. **`session.generating`** is true for a message row that is generating
 *     and for a registered `reply`/`action` run with no row at all; false
 *     once both are gone.
 *  3. **`session.fields`** is what the inlet hands a run — the stored values
 *     of declared keys, nothing else.
 *  4. **`item`** is built from the real row: newest on its channel, hidden,
 *     generating, role, the item rule for the actor, a greeting's swipe to
 *     take, and it is `null` for a row of another session.
 *  5. **`itemValuesOf` is pure and shared** (`shared/actions/itemValues.ts`):
 *     a greeting on its last alternative has no swipe to take; a reply
 *     always has one.
 */

import { beforeAll, describe, expect, it } from "vitest"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { ADVENTURE_GENRE_ID, CHAT_GENRE_ID } from "@serene-pub/core-catalog"
import { genreEnabledWhen } from "@serene-pub/sdk"
import {
	itemValuesFor,
	itemValuesOf,
	publishedValues,
	publishedValuesWithItem,
	sessionGenerating
} from "./publishedValues"
import * as runRegistry from "$lib/server/pipelines/runtime/runRegistry"
import { setValue } from "$lib/server/state/write"

let db: TestDb
let n = 0

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
}, 60_000)

async function session(genreId: string) {
	const tag = `pv-${++n}`
	const user = await createTestUser(db, tag)
	const [row] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: tag, genreId })
		.returning()
	const message = async (
		over: Partial<typeof schema.sessionMessages.$inferInsert> = {}
	) =>
		(
			await db
				.insert(schema.sessionMessages)
				.values({
					sessionId: row.id,
					role: "assistant",
					content: "…",
					isNarratorResponse: true,
					userId: user.id,
					...over
				})
				.returning()
		)[0]!
	return { user, session: row, message }
}

describe("state is the resolver's answer", () => {
	it("an Adventure session publishes state.world.location once set, under the bare slot key a predicate names", async () => {
		const w = await session(ADVENTURE_GENRE_ID)
		const before = await publishedValues(db, w.session.id)
		expect(before.state.world.location).toBeUndefined()
		// No shipped genre declares a default (review W8): Adventure's Look
		// opens a fresh session and must not begin grey.
		expect(genreEnabledWhen(ADVENTURE_GENRE_ID, "look")).toEqual([])

		await setValue(
			db,
			{ sessionId: w.session.id, updatedBy: "user" },
			{
				owner: { kind: "session", id: w.session.id },
				slotId: "core:slot/location@1",
				value: "The Vale"
			}
		)
		const after = await publishedValues(db, w.session.id)
		expect(after.state.world.location).toBe("The Vale")
		expect(after.state.world.core_location).toBe("The Vale")
		// The rest of the resolver's vocabulary rides along.
		expect(after.state.world.weather).toBe("clear")
		expect(after.state.slots.map((s) => s.key)).toContain("location")
	}, 60_000)

	it("a Chat session, whose genre declares no slots, publishes an empty world", async () => {
		const w = await session(CHAT_GENRE_ID)
		const doc = await publishedValues(db, w.session.id)
		expect(doc.state.world).toEqual({})
		expect(doc.state.slots).toEqual([])
		// Chat's own fields, at their declared defaults (B16x) — no world.
		expect(doc.session.fields).toEqual({
			autoAdvance: "round",
			characterDetail: "full",
			turnMode: "rules"
		})
		expect(doc.session.generating).toBe(false)
		expect(doc.item).toBeUndefined()
	}, 60_000)
})

describe("session.generating", () => {
	it("is true for a generating row, true for a registered run with no row, false once both are gone", async () => {
		const w = await session(CHAT_GENRE_ID)
		expect(await sessionGenerating(db, w.session.id)).toBe(false)

		const row = await w.message({ isGenerating: true })
		expect(await sessionGenerating(db, w.session.id)).toBe(true)
		await db
			.update(schema.sessionMessages)
			.set({ isGenerating: false })
			.where(eq(schema.sessionMessages.id, row.id))
		expect(await sessionGenerating(db, w.session.id)).toBe(false)

		const handle = runRegistry.start({
			runId: `pv-run-${w.session.id}`,
			userId: w.user.id,
			sessionId: w.session.id,
			specId: "core:spec/test",
			kind: "action"
		})
		try {
			expect(await sessionGenerating(db, w.session.id)).toBe(true)
			// Another session's run is not this one's.
			const other = await session(CHAT_GENRE_ID)
			expect(await sessionGenerating(db, other.session.id)).toBe(false)
		} finally {
			runRegistry.finish(handle.runId)
		}
		expect(await sessionGenerating(db, w.session.id)).toBe(false)
	}, 60_000)
})

describe("session.fields", () => {
	it("is the stored value of a declared key, else its default, and nothing else", async () => {
		const w = await session(ADVENTURE_GENRE_ID)
		await db
			.update(schema.sessions)
			.set({ genreFields: { tone: "grim", smuggled: "no" } })
			.where(eq(schema.sessions.id, w.session.id))
		const doc = await publishedValues(db, w.session.id)
		// Stored wins; unstored declared keys resolve to their defaults
		// (B16x); the undeclared key never arrives.
		expect(doc.session.fields).toEqual({
			tone: "grim",
			difficulty: "normal",
			trustNarrator: false,
			characterDetail: "full"
		})
	}, 60_000)
})

describe("item", () => {
	it("is built from the real row — newest on its channel, hidden, generating, role, the item rule", async () => {
		const w = await session(CHAT_GENRE_ID)
		const older = await w.message()
		const newer = await w.message({ isHidden: true })
		const stranger = await createTestUser(db, `pv-stranger-${n}`)

		const o = await itemValuesFor(db, w.session.id, older.id, {
			userId: w.user.id
		})
		expect(o).toEqual({
			id: older.id,
			isNewest: false,
			hidden: false,
			generating: false,
			role: "assistant",
			mine: true,
			hasSwipes: true,
			greeting: false,
			// Which channel the row is on (R-C) — `main` for a chat, which is
			// every row a genre with one channel ever writes.
			channel: "main",
			// Who spoke it (lair re-plan R11): a narrator row is nobody in
			// particular, and no character's line.
			speaker: null,
			characterLine: false
		})
		const nw = await itemValuesFor(db, w.session.id, newer.id, {
			userId: stranger.id
		})
		expect(nw).toMatchObject({
			id: newer.id,
			isNewest: true,
			hidden: true,
			mine: false
		})

		// A lane of its own: the newest on `phone` is newest there, whatever `main` holds.
		const phone = await w.message({ channel: "phone" })
		await w.message()
		expect(
			(
				await itemValuesFor(db, w.session.id, phone.id, {
					userId: w.user.id
				})
			)?.isNewest
		).toBe(true)

		// Another session's row is not this session's item.
		const other = await session(CHAT_GENRE_ID)
		const theirs = await other.message()
		expect(
			await itemValuesFor(db, w.session.id, theirs.id, {
				userId: w.user.id
			})
		).toBeNull()
		const doc = await publishedValuesWithItem(db, w.session.id, theirs.id, {
			userId: w.user.id
		})
		expect(doc.item).toBeUndefined()
		const withItem = await publishedValuesWithItem(
			db,
			w.session.id,
			older.id,
			{ userId: w.user.id }
		)
		expect(withItem.item?.id).toBe(older.id)
	}, 60_000)

	it("itemValuesOf: a greeting on its last alternative has nothing to swipe to; a reply always has", () => {
		const greeting = (idx: number) =>
			itemValuesOf(
				{
					id: 1,
					metadata: {
						isGreeting: true,
						swipes: { currentIdx: idx, history: ["a", "b", "c"] }
					}
				},
				{ isNewest: true, mine: true }
			)
		expect(greeting(0).hasSwipes).toBe(true)
		expect(greeting(2).hasSwipes).toBe(false)
		expect(greeting(2).greeting).toBe(true)
		expect(
			itemValuesOf(
				{ id: 2, metadata: { isGreeting: true } },
				{ isNewest: true, mine: true }
			).hasSwipes
		).toBe(false)
		expect(
			itemValuesOf({ id: 3 }, { isNewest: false, mine: false })
		).toEqual({
			id: 3,
			isNewest: false,
			hidden: false,
			generating: false,
			role: "",
			mine: false,
			hasSwipes: true,
			greeting: false,
			// A row with no channel reads as `main`, the column's own default.
			channel: "main",
			speaker: null,
			characterLine: false
		})
		// Who spoke (R11): a character's reply is theirs and a character's
		// line; an envoy's line is the envoy's; a persona line is the
		// person's, voiced as that character.
		expect(
			itemValuesOf({ id: 4, role: "assistant", characterId: 7 }, { isNewest: false, mine: false })
		).toMatchObject({ speaker: "character:7", characterLine: true })
		expect(
			itemValuesOf(
				{ id: 5, role: "assistant", metadata: { speaker: "envoy:castellan" } },
				{ isNewest: false, mine: false }
			)
		).toMatchObject({ speaker: "envoy:castellan", characterLine: false })
		expect(
			itemValuesOf({ id: 6, role: "user", personaId: 9 }, { isNewest: false, mine: true })
		).toMatchObject({ speaker: "character:9", characterLine: false })
	})
})
