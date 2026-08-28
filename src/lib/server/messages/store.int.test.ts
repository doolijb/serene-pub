import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	insertLegacy,
	insertLegacyMany,
	updateLegacy,
	deleteLegacy,
	migrateMessages,
	getMessage,
	listMessages,
	messageText,
	checkMapInvariant
} from "./store"
import { eq } from "drizzle-orm"

/**
 * The store's phase-1 posture (20 §13): the legacy row leads, the mirror
 * derives — one id, two tables, byte parity through `textOf`. Plus the boot
 * migration's idempotency and the map invariant (20 §1).
 */

let db: TestDb
let sessionId: number

beforeAll(async () => {
	db = await createTestDb()
	const user = await createTestUser(db, "msg-store-user")
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	sessionId = session.id
}, 60_000)

describe("the phase-1 write path", () => {
	it("insert lands in both worlds under one id, at parity", async () => {
		const row = await insertLegacy(db, {
			sessionId,
			role: "assistant",
			content: "The rain persists.",
			metadata: {}
		})
		const projected = await getMessage(db, row.id)
		expect(projected).toBeTruthy()
		expect(projected!.id).toBe(row.id)
		expect(projected!.version).toBe("1.0")
		expect(checkMapInvariant(projected!)).toEqual([])
		expect(messageText(projected!)).toBe("The rain persists.")
	})

	it("a swipe-shaped update grows revisions and moves the cursor", async () => {
		const row = await insertLegacy(db, {
			sessionId,
			role: "assistant",
			content: "first",
			metadata: { swipes: { currentIdx: 0, history: ["first"] } }
		})
		await updateLegacy(db, row.id, {
			content: "second",
			metadata: {
				swipes: { currentIdx: 1, history: ["first", "second"] }
			}
		})
		const projected = (await getMessage(db, row.id))!
		expect(projected.activeRevisions).toEqual({ "0": 1 })
		expect(
			projected.parts.filter((p) => p.type === "core:markdown").length
		).toBe(2)
		expect(checkMapInvariant(projected)).toEqual([])
		expect(messageText(projected)).toBe("second")
	})

	it("delete removes both worlds", async () => {
		const row = await insertLegacy(db, {
			sessionId,
			role: "user",
			content: "gone soon"
		})
		await deleteLegacy(db, row.id)
		expect(await getMessage(db, row.id)).toBeUndefined()
		const [legacy] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, row.id))
		expect(legacy).toBeUndefined()
	})

	it("bulk insert (the importer's path) mirrors every row", async () => {
		const rows = await insertLegacyMany(db, [
			{ sessionId, role: "user", content: "one" },
			{ sessionId, role: "assistant", content: "two" }
		])
		for (const r of rows)
			expect(messageText((await getMessage(db, r.id))!)).toBe(
				r.content
			)
	})
})

describe("the boot migration (20 §5)", () => {
	it("projects unmigrated legacy rows, byte-parity, then finds nothing", async () => {
		// Bypass the store — these rows simulate a pre-upgrade database.
		const inserted = await db
			.insert(schema.sessionMessages)
			.values([
				{
					sessionId,
					role: "assistant",
					content: "swiped current",
					metadata: {
						swipes: {
							currentIdx: 1,
							history: ["swiped past", "swiped current"],
							thinkingHistory: [null, "reasoning"]
						},
						thinking: "reasoning"
					}
				},
				{
					sessionId,
					role: "assistant",
					isNarratorResponse: true,
					content: "The docks empty out.",
					metadata: {
						narratorName: "Narrator",
						narratorInstructions: "Focus on mood."
					}
				}
			])
			.returning()

		const first = await migrateMessages(db)
		expect(first.migrated).toBe(2)

		for (const legacy of inserted) {
			const projected = (await getMessage(db, legacy.id))!
			expect(checkMapInvariant(projected)).toEqual([])
			// The gate: textOf(migrated) === legacy content, byte for byte.
			expect(messageText(projected)).toBe(legacy.content)
		}
		const narration = (await getMessage(db, inserted[1].id))!
		expect(narration.kind).toBe("core:narration")
		expect(narration.speakerLabel).toBe("Narrator")

		// Idempotent: the second pass has nothing to do.
		expect((await migrateMessages(db)).migrated).toBe(0)
	}, 60_000)
})

describe("native reads", () => {
	it("lists by session and filters by channel", async () => {
		const all = await listMessages(db, sessionId)
		expect(all.length).toBeGreaterThan(0)
		// Everything legacy lives on 'main'; a foreign channel is empty.
		expect(await listMessages(db, sessionId, { channel: "map" })).toEqual(
			[]
		)
		const main = await listMessages(db, sessionId, { channel: "main" })
		expect(main.length).toBe(all.length)
		// Chronology is the pk (ruled): ids ascend.
		const ids = all.map((m) => m.id)
		expect(ids).toEqual([...ids].sort((a, b) => a - b))
	})
})

describe("native writes and the parts-address armistice (20 §13)", () => {
	it("appended native parts survive a legacy re-mirror", async () => {
		const row = await insertLegacy(db, {
			sessionId,
			role: "assistant",
			content: "The lock bars the door.",
			metadata: {}
		})
		const { appendParts } = await import("./store")
		await appendParts(db, row.id, [
			{
				type: "chariot.dice:roll",
				data: { blocks: [{ kind: "stat", label: "DC", value: 14 }] }
			}
		])

		// A legacy edit re-mirrors the body slots…
		await updateLegacy(db, row.id, { content: "The lock STILL bars it." })
		const after = (await getMessage(db, row.id))!
		// …and the native part is untouched, at a native ordinal.
		const native = after.parts.filter((p) => p.type === "chariot.dice:roll")
		expect(native).toHaveLength(1)
		expect(native[0].ordinal).toBeGreaterThanOrEqual(10)
		expect(messageText(after)).toBe("The lock STILL bars it.")
		expect(checkMapInvariant(after)).toEqual([])
	})

	it("appendParts refuses markdown while the body is legacy-led", async () => {
		const row = await insertLegacy(db, {
			sessionId,
			role: "assistant",
			content: "x"
		})
		const { appendParts } = await import("./store")
		await expect(
			appendParts(db, row.id, [{ type: "core:markdown", content: "y" }])
		).rejects.toThrow(/legacy-led/)
	})

	it("appendStep opens step N+1, moves the cursor, and refreshes legacy text", async () => {
		const row = await insertLegacy(db, {
			sessionId,
			role: "assistant",
			content: "Roll for it.",
			metadata: { swipes: { currentIdx: 0, history: ["Roll for it."] } }
		})
		const { appendStep, hasNativeSteps } = await import("./store")
		const step = await appendStep(db, row.id, [
			{ type: "core:markdown", content: "The lock clicks open." }
		])
		expect(step).toBe(1)
		const after = (await getMessage(db, row.id))!
		expect(after.activeRevisions).toEqual({ "0": 0, "1": 0 })
		expect(checkMapInvariant(after)).toEqual([])
		// Both steps project, in order — and the legacy column was refreshed
		// so unmigrated readers see the whole activity.
		expect(messageText(after)).toBe("Roll for it.\n\nThe lock clicks open.")
		const [legacy] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, row.id))
		expect(legacy.content).toBe("Roll for it.\n\nThe lock clicks open.")
		expect(await hasNativeSteps(db, row.id)).toBe(true)

		// The armistice holds across another mirror: step 1 survives, and the
		// selection map keeps its step-1 key.
		await updateLegacy(db, row.id, { isEdited: true })
		const again = (await getMessage(db, row.id))!
		expect(again.activeRevisions["1"]).toBe(0)
		expect(
			again.parts.some(
				(p) => p.step === 1 && p.content === "The lock clicks open."
			)
		).toBe(true)
	})
})

describe("the no-swipes stepped message stays stable", () => {
	it("pins the step-0 body so a later legacy patch cannot double the text", async () => {
		const row = await insertLegacy(db, {
			sessionId,
			role: "assistant",
			content: "Step zero.",
			metadata: {}
		})
		const { appendStep } = await import("./store")
		await appendStep(db, row.id, [
			{ type: "core:markdown", content: "Step one." }
		])
		// The killer sequence: any legacy patch after the step opened.
		await updateLegacy(db, row.id, { isEdited: true })
		const after = (await getMessage(db, row.id))!
		expect(messageText(after)).toBe("Step zero.\n\nStep one.")
		expect(checkMapInvariant(after)).toEqual([])
	})
})

describe("the mirror survives concurrent updates (streaming)", () => {
	it("overlapping updateLegacyWhere calls do not collide on the parts index", async () => {
		const { updateLegacyWhere } = await import("./store")
		const { eq: eqf } = await import("drizzle-orm")
		const row = await insertLegacy(db, {
			sessionId,
			role: "assistant",
			content: "",
			isGenerating: true,
			metadata: {}
		})
		// Fire many re-projections at once — the streaming write pattern that
		// interleaves delete/insert and collided on message_parts_addr_idx.
		await Promise.all(
			Array.from({ length: 12 }, (_, i) =>
				updateLegacyWhere(
					db,
					eqf(schema.sessionMessages.id, row.id),
					{ content: `token ${i}` }
				)
			)
		)
		const after = (await getMessage(db, row.id))!
		expect(checkMapInvariant(after)).toEqual([])
		// Exactly one markdown part at the mirror address — no duplicates.
		expect(
			after.parts.filter(
				(p) => p.type === "core:markdown" && p.step === 0
			)
		).toHaveLength(1)
	})

	it("a shrunk swipe history deletes the orphaned revision's parts", async () => {
		const row = await insertLegacy(db, {
			sessionId,
			role: "assistant",
			content: "c",
			metadata: {
				swipes: { currentIdx: 2, history: ["a", "b", "c"] }
			}
		})
		let m = (await getMessage(db, row.id))!
		expect(new Set(m.parts.map((p) => p.revision))).toEqual(
			new Set([0, 1, 2])
		)
		// Regenerate collapses history — the higher revisions must go.
		await updateLegacy(db, row.id, {
			content: "only",
			metadata: { swipes: { currentIdx: 0, history: ["only"] } }
		})
		m = (await getMessage(db, row.id))!
		expect(new Set(m.parts.map((p) => p.revision))).toEqual(new Set([0]))
		expect(messageText(m)).toBe("only")
		expect(checkMapInvariant(m)).toEqual([])
	})
})

describe("the mirror preserves a set channel (20 §7 greetings)", () => {
	it("a non-main channel survives later legacy updates", async () => {
		const row = await insertLegacy(db, {
			sessionId,
			role: "assistant",
			content: "Welcome, traveller.",
			metadata: { isGreeting: true }
		})
		// Redirect natively — as the greeting-on-creation path does.
		await db
			.update(schema.messages)
			.set({ channel: "intro" })
			.where(eq(schema.messages.id, row.id))
		expect((await getMessage(db, row.id))!.channel).toBe("intro")

		// A later legacy update (e.g. an edit) must not reset it to 'main'.
		await updateLegacy(db, row.id, { isEdited: true })
		expect((await getMessage(db, row.id))!.channel).toBe("intro")
	})
})
