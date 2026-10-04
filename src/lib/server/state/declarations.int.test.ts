/**
 * The authored half of the vocabulary: rows as a **source** the registry is
 * loaded from, never as a second answer.
 *
 * Five claims, and each one is a way an "add your own stat" feature ships
 * broken:
 *
 *  1. **Write-through.** The row and the registry entry are made together, so
 *     there is never a moment where validation consults one and a panel the
 *     other — and a boot reloads exactly what was written.
 *  2. **The author owns a namespace, and cannot claim somebody else's.** A slug
 *     colliding with an installed package would be redefined underneath the
 *     values already filed against it.
 *  3. **Retire is not delete.** Nothing new is written, everything already
 *     written stays and still resolves, and a hard delete is a separate step
 *     that shows the counts first.
 *  4. **A cycle is refused where the person who wrote it is standing** — at
 *     save, not at read.
 *  5. **The last-seen record survives the code.** A declaration this build has
 *     seen is a row, so a panel can still name it after the package is gone and
 *     `owner_sheets` has something to key against.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	defineAttributeSlot,
	defineAttributeSheet,
	getAttributeSlot,
	reserveAttributeOwner,
	_clearAttributeSheets,
	_clearAttributeSlots,
	_clearReservedAttributeOwners,
	type AttributeSlotProps
} from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-state-decls-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const HP = "core:slot/hp@1"

function reset() {
	_clearAttributeSlots()
	_clearAttributeSheets()
	_clearReservedAttributeOwners()
}

const tension: AttributeSlotProps = {
	type: "integer",
	label: { en: "Tension" },
	descriptor: "How close the hunt is.",
	appliesTo: ["world"],
	config: { min: 0, max: 10 },
	default: 0
}

let n = 0
const user = async () => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return await createTestUser(db, `decl-${++n}`)
}

describe("authoring a slot", () => {
	test("the id freezes the author's namespace and the name", async () => {
		reset()
		const { slotIdFor } = await import("$lib/server/state/declarations")
		expect(slotIdFor("Jody Doolittle", "Hit Points")).toBe(
			"jody-doolittle:slot/hit-points@1"
		)
		expect(slotIdFor("jody", "tension", 2)).toBe("jody:slot/tension@2")
	})

	test("a reserved namespace is refused by name", async () => {
		reset()
		reserveAttributeOwner("acme.rp")
		const { slotIdFor, StateRefusal } = await import(
			"$lib/server/state/declarations"
		)
		expect(() => slotIdFor("core", "hp")).toThrow(StateRefusal)
		// ⚠ The dot survives the slug, so a username matching a dotted plugin
		// id lands on the SAME namespace the install reserved — which is the
		// whole point of reserving it.
		expect(() => slotIdFor("acme.rp", "tension")).toThrow(/reserved/)
		expect(() => slotIdFor("Acme RP", "tension")).not.toThrow()
	})

	test("declaring writes the row AND loads the registry, in one call", async () => {
		reset()
		const u = await user()
		const { declareSlot } = await import("$lib/server/state/declarations")
		const id = `author${n}:slot/tension@1`
		await declareSlot(db, u.id, id, tension)

		expect(getAttributeSlot(id)?.origin).toBe("stored")
		const [row] = await db
			.select()
			.from(schema.attributeDeclarations)
			.where(eq(schema.attributeDeclarations.id, id))
		expect(row.origin).toBe("stored")
		expect(row.userId).toBe(u.id)
		expect((row.props as any).descriptor).toBe("How close the hunt is.")
	})

	test("an edit replaces — one author finishing a sentence", async () => {
		reset()
		const u = await user()
		const { declareSlot, updateSlot } = await import(
			"$lib/server/state/declarations"
		)
		const id = `author${n}:slot/tension@1`
		await declareSlot(db, u.id, id, tension)
		await updateSlot(db, id, { ...tension, config: { min: 0, max: 20 } })
		expect(getAttributeSlot(id)?.config?.max).toBe(20)
		const [row] = await db
			.select()
			.from(schema.attributeDeclarations)
			.where(eq(schema.attributeDeclarations.id, id))
		expect((row.props as any).config.max).toBe(20)
	})

	test("an expression that will not parse is refused at save", async () => {
		reset()
		const u = await user()
		const { declareSlot, StateRefusal } = await import(
			"$lib/server/state/declarations"
		)
		await expect(
			declareSlot(db, u.id, `author${n}:slot/danger@1`, {
				type: "derived",
				descriptor: "How bad it is.",
				appliesTo: ["world"],
				derive: "world.tension | nosuchfilter"
			})
		).rejects.toBeInstanceOf(StateRefusal)
	})

	test("a derivation that closes a circle is refused at save, not at read", async () => {
		reset()
		const u = await user()
		const { declareSlot, StateRefusal } = await import(
			"$lib/server/state/declarations"
		)
		const a = `author${n}:slot/alpha@1`
		const b = `author${n}:slot/beta@1`
		await declareSlot(db, u.id, a, {
			type: "derived",
			descriptor: "Alpha.",
			appliesTo: ["world"],
			derive: "owner.beta | plus: 1"
		})
		// Beta reading alpha closes the ring; the second one is where it is seen.
		await expect(
			declareSlot(db, u.id, b, {
				type: "derived",
				descriptor: "Beta.",
				appliesTo: ["world"],
				derive: "owner.alpha | plus: 1"
			})
		).rejects.toBeInstanceOf(StateRefusal)
		await expect(
			declareSlot(db, u.id, b, {
				type: "derived",
				descriptor: "Beta.",
				appliesTo: ["world"],
				derive: "owner.alpha | plus: 1"
			})
		).rejects.toThrow(/circle/)
	})
})

describe("retire, then purge", () => {
	test("a retired slot keeps its rows and refuses a new write", async () => {
		reset()
		const u = await user()
		const { declareSlot, retireSlot, reviveSlot } = await import(
			"$lib/server/state/declarations"
		)
		const { checkSlotValue } = await import("@serene-pub/sdk")
		const id = `author${n}:slot/tension@1`
		await declareSlot(db, u.id, id, tension)
		await db.insert(schema.attributeValues).values({
			ownerKind: "lorebook",
			ownerId: 1,
			slotId: id,
			value: { v: 3 }
		})

		await retireSlot(db, id)
		expect(getAttributeSlot(id)?.retired).toBe(true)
		expect(checkSlotValue(getAttributeSlot(id)!, 4)).toMatch(/is retired/)
		// The row is exactly where it was — that is the whole difference.
		expect(
			await db
				.select()
				.from(schema.attributeValues)
				.where(eq(schema.attributeValues.slotId, id))
		).toHaveLength(1)

		await reviveSlot(db, id)
		expect(getAttributeSlot(id)?.retired).toBeUndefined()
		expect(checkSlotValue(getAttributeSlot(id)!, 4)).toBeNull()
	})

	test("a slot a code sheet names cannot be retired", async () => {
		reset()
		const u = await user()
		const { declareSlot, retireSlot } = await import(
			"$lib/server/state/declarations"
		)
		const id = `author${n}:slot/tension@1`
		await declareSlot(db, u.id, id, tension)
		defineAttributeSheet("core:sheet/hunt@1", {
			label: { en: "Hunt" },
			slots: [{ id }]
		})
		await expect(retireSlot(db, id)).rejects.toThrow(
			/declared in code|named by the sheet/
		)
	})

	test("a code declaration is never retired by hand", async () => {
		reset()
		defineAttributeSlot(HP, {
			type: "integer",
			descriptor: "How much punishment they can still take.",
			appliesTo: ["cast"]
		})
		const { recordLastSeen, retireSlot } = await import(
			"$lib/server/state/declarations"
		)
		await recordLastSeen(db)
		await expect(retireSlot(db, HP)).rejects.toThrow(/declared in code/)
	})

	test("purging is a separate step, refused while the slot is live", async () => {
		reset()
		const u = await user()
		const { declareSlot, purgeSlotValues, retireSlot, slotFootprint } =
			await import("$lib/server/state/declarations")
		const id = `author${n}:slot/tension@1`
		await declareSlot(db, u.id, id, tension)
		for (const owner of [
			{ ownerKind: "cast_member", ownerId: 11 },
			{ ownerKind: "cast_member", ownerId: 12 },
			{ ownerKind: "lorebook", ownerId: 3 }
		])
			await db
				.insert(schema.attributeValues)
				.values({ ...owner, slotId: id, value: { v: 1 } })

		// The counts are shown BEFORE anything is deleted — what is being
		// removed is somebody's play, not a definition.
		expect(await slotFootprint(db, id)).toEqual({
			characters: 2,
			worlds: 1,
			values: 3
		})
		await expect(purgeSlotValues(db, id)).rejects.toThrow(/still live/)

		await retireSlot(db, id)
		expect(await purgeSlotValues(db, id)).toEqual({
			characters: 2,
			worlds: 1,
			values: 3
		})
		expect(
			await db
				.select()
				.from(schema.attributeValues)
				.where(eq(schema.attributeValues.slotId, id))
		).toHaveLength(0)
		expect(
			await db
				.select()
				.from(schema.attributeDeclarations)
				.where(eq(schema.attributeDeclarations.id, id))
		).toHaveLength(0)
	})
})

describe("loading at boot", () => {
	test("stored rows come back, retirement included, and code is mirrored", async () => {
		reset()
		const u = await user()
		const { declareSlot, loadStoredDeclarations, retireSlot } = await import(
			"$lib/server/state/declarations"
		)
		const live = `author${n}:slot/tension@1`
		const gone = `author${n}:slot/dread@1`
		await declareSlot(db, u.id, live, tension)
		await declareSlot(db, u.id, gone, { ...tension, label: { en: "Dread" } })
		await retireSlot(db, gone)
		defineAttributeSlot(HP, {
			type: "integer",
			descriptor: "How much punishment they can still take.",
			appliesTo: ["cast"]
		})

		// The registry is emptied the way a fresh process starts it.
		_clearAttributeSlots()
		_clearAttributeSheets()
		defineAttributeSlot(HP, {
			type: "integer",
			descriptor: "How much punishment they can still take.",
			appliesTo: ["cast"]
		})
		const report = await loadStoredDeclarations(db)

		expect(getAttributeSlot(live)?.origin).toBe("stored")
		// Defined first and retired second: a retired slot is still a
		// declaration, because its values still resolve.
		expect(getAttributeSlot(gone)?.retired).toBe(true)
		expect(report.slotsLoaded).toBeGreaterThanOrEqual(2)
		expect(report.reserved).toContain("core")

		const [seen] = await db
			.select()
			.from(schema.attributeDeclarations)
			.where(eq(schema.attributeDeclarations.id, HP))
		expect(seen.origin).toBe("code")
		expect(seen.lastSeenAt).toBeInstanceOf(Date)
	})

	test("a stored row this build refuses costs itself and nothing else", async () => {
		reset()
		const u = await user()
		// Written straight to the table, the way an older build with looser
		// rules could have left one: an enum with no options.
		await db.insert(schema.attributeDeclarations).values({
			id: `author${++n}:slot/broken@1`,
			userId: u.id,
			origin: "stored",
			props: { type: "enum", descriptor: "…", appliesTo: ["world"] }
		})
		const { loadStoredDeclarations } = await import(
			"$lib/server/state/declarations"
		)
		const report = await loadStoredDeclarations(db)
		expect(report.refused.some((r) => r.id.endsWith("broken@1"))).toBe(true)
	})
})

describe("which sheets an owner has", () => {
	test("the whole set at once, in order, scoped to its session", async () => {
		reset()
		const u = await user()
		const { declareSheet, ownerSheets, setOwnerSheets } = await import(
			"$lib/server/state/declarations"
		)
		const { declareSlot } = await import("$lib/server/state/declarations")
		const slot = `author${n}:slot/tension@1`
		await declareSlot(db, u.id, slot, tension)
		const first = `author${n}:sheet/hunt@1`
		const second = `author${n}:sheet/weather@1`
		await declareSheet(db, u.id, first, {
			label: { en: "Hunt" },
			slots: [{ id: slot }]
		})
		await declareSheet(db, u.id, second, {
			label: { en: "Weather" },
			slots: []
		})
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId: u.id, isGroup: false, name: "Run" })
			.returning()

		await setOwnerSheets(
			db,
			{ kind: "session", id: session.id },
			[second, first],
			{ userId: u.id, sessionId: session.id }
		)
		expect(
			(
				await ownerSheets(
					db,
					{ kind: "session", id: session.id },
					session.id
				)
			).map((r) => r.sheetId)
		).toEqual([second, first])

		// A whole-set write, because the ORDER is content.
		await setOwnerSheets(
			db,
			{ kind: "session", id: session.id },
			[first],
			{ userId: u.id, sessionId: session.id }
		)
		expect(
			(
				await ownerSheets(
					db,
					{ kind: "session", id: session.id },
					session.id
				)
			).map((r) => r.sheetId)
		).toEqual([first])
	})

	test("a session-layer owner without its session is refused", async () => {
		reset()
		const { setOwnerSheets, StateRefusal } = await import(
			"$lib/server/state/declarations"
		)
		await expect(
			setOwnerSheets(db, { kind: "session_cast", id: 1 }, [], { userId: 1 })
		).rejects.toBeInstanceOf(StateRefusal)
	})

	test("a lorebook's sheets are its owner's to say; a stranger is refused and nothing moves", async () => {
		reset()
		const owner = await user()
		const stranger = await user()
		const { declareSheet, ownerSheets, setOwnerSheets, StateRefusal } =
			await import("$lib/server/state/declarations")
		const sheet = `author${n}:sheet/world@1`
		await declareSheet(db, owner.id, sheet, { label: { en: "World" }, slots: [] })
		const [book] = await db
			.insert(schema.lorebooks)
			.values({ name: "Vale", userId: owner.id })
			.returning()
		const owned = { kind: "lorebook" as const, id: book.id }

		await expect(
			setOwnerSheets(db, owned, [sheet], { userId: stranger.id })
		).rejects.toBeInstanceOf(StateRefusal)
		expect(await ownerSheets(db, owned)).toEqual([])

		await setOwnerSheets(db, owned, [sheet], { userId: owner.id })
		expect((await ownerSheets(db, owned)).map((r) => r.sheetId)).toEqual([sheet])
	})

	test("a session's sheets are its owner's, as what it tracks is; a guest is refused", async () => {
		reset()
		const host = await user()
		const guest = await user()
		const { declareSheet, ownerSheets, setOwnerSheets } = await import(
			"$lib/server/state/declarations"
		)
		const sheet = `author${n}:sheet/hunt@1`
		await declareSheet(db, host.id, sheet, { label: { en: "Hunt" }, slots: [] })
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId: host.id, isGroup: true, name: "Table" })
			.returning()
		await db.insert(schema.sessionGuests).values({ sessionId: session.id, userId: guest.id })
		const owned = { kind: "session" as const, id: session.id }

		await expect(
			setOwnerSheets(db, owned, [sheet], { userId: guest.id, sessionId: session.id })
		).rejects.toThrow(/session's owner/)
		expect(await ownerSheets(db, owned, session.id)).toEqual([])

		// A run names no person: it writes as the session's own user.
		await setOwnerSheets(db, owned, [sheet], { userId: null, sessionId: session.id })
		expect((await ownerSheets(db, owned, session.id)).map((r) => r.sheetId)).toEqual([sheet])
	})

	test("a run reaches only its own session's owners: another book of the same person is refused, and nothing moves", async () => {
		reset()
		const host = await user()
		const { declareSheet, ownerSheets, setOwnerSheets, StateRefusal } = await import(
			"$lib/server/state/declarations"
		)
		const sheet = `author${n}:sheet/reach@1`
		await declareSheet(db, host.id, sheet, { label: { en: "Reach" }, slots: [] })
		const [read, other] = await db
			.insert(schema.lorebooks)
			.values([
				{ name: "Read", userId: host.id },
				{ name: "Other", userId: host.id }
			])
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId: host.id, isGroup: false, name: "Run", lorebookId: read!.id } as any)
			.returning()
		const run = { userId: null, sessionId: session!.id }

		const elsewhere = { kind: "lorebook" as const, id: other!.id }
		await expect(setOwnerSheets(db, elsewhere, [sheet], run)).rejects.toBeInstanceOf(StateRefusal)
		expect(await ownerSheets(db, elsewhere)).toEqual([])

		// Its own book is the run's to say, as its user's.
		const own = { kind: "lorebook" as const, id: read!.id }
		await setOwnerSheets(db, own, [sheet], run)
		expect((await ownerSheets(db, own)).map((r) => r.sheetId)).toEqual([sheet])

		// A person may still say another book of theirs, with no session in it.
		await setOwnerSheets(db, elsewhere, [sheet], { userId: host.id })
		expect((await ownerSheets(db, elsewhere)).map((r) => r.sheetId)).toEqual([sheet])
	})

	test("an owner that does not exist gets no sheets", async () => {
		reset()
		const u = await user()
		const { declareSheet, setOwnerSheets, StateRefusal } = await import(
			"$lib/server/state/declarations"
		)
		const sheet = `author${n}:sheet/ghost@1`
		await declareSheet(db, u.id, sheet, { label: { en: "Ghost" }, slots: [] })
		const [book] = await db
			.insert(schema.lorebooks)
			.values({ name: "Gone", userId: u.id })
			.returning()
		await db.delete(schema.lorebooks).where(eq(schema.lorebooks.id, book.id))
		const gone = [
			{ kind: "lorebook" as const, id: book.id },
			{ kind: "cast_member" as const, id: 2_000_000_000 },
			{ kind: "location" as const, id: 2_000_000_000 },
			{ kind: "card" as const, id: 2_000_000_000 }
		]
		for (const owner of gone)
			await expect(
				setOwnerSheets(db, owner, [sheet], { userId: u.id })
			).rejects.toBeInstanceOf(StateRefusal)
		const rows = await db
			.select({ id: schema.ownerSheets.id })
			.from(schema.ownerSheets)
			.where(eq(schema.ownerSheets.sheetId, sheet))
		expect(rows).toEqual([])
	})

	test("an owner cannot have a sheet this install has no record of", async () => {
		reset()
		const u = await user()
		const { setOwnerSheets } = await import(
			"$lib/server/state/declarations"
		)
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId: u.id, isGroup: false, name: "Run" })
			.returning()
		await expect(
			setOwnerSheets(
				db,
				{ kind: "session", id: session.id },
				["nobody:sheet/ghost@1"],
				{ userId: u.id, sessionId: session.id }
			)
		).rejects.toThrow(/no record of/)
	})
})
