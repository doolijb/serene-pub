/**
 * 🚧 The admin lift list and **Follow the card's greetings** (owner ruling
 * 2026-11-05, "Own list, noted"): `admin:castLiftNotes` lists the members the
 * upgrade lifted with a note, admin only; following the card's greetings makes
 * the member's lift copy of the mixed list follow the card, drops the note's
 * greetings line (null when nothing else is left), shrinks the list, moves the
 * Overview's `castLiftCount` with it, and a second follow is refused — over a
 * real database, the members lifted by the real boot pass.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { parseLiftNote } from "$lib/server/characters/versionsLift"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-admin-cast-lift-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const V = schema.characterVersions
const admin = { user: { id: 1, isAdmin: true } } as any
const member = { user: { id: 2, isAdmin: false } } as any

async function ask(
	which: "notes" | "follow",
	socket: any,
	castMemberId = 0
): Promise<{
	res: Sockets.Admin.CastLiftNotes.Response | null
	error: string | null
	emitted: string[]
}> {
	const { adminCastLiftNotes, adminCastLiftFollowGreetings } = await import(
		"$lib/server/sockets/adminCastLift"
	)
	const emitted: string[] = []
	const errors: any[] = []
	const emit = async (event: string, data: unknown) => {
		emitted.push(event)
		if (event.endsWith(":error")) errors.push(data)
	}
	try {
		const res =
			which === "notes"
				? await adminCastLiftNotes.handler(socket, {}, emit as any)
				: await adminCastLiftFollowGreetings.handler(
						socket,
						{ castMemberId },
						emit as any
					)
		return { res, error: null, emitted }
	} catch (e: any) {
		return { res: null, error: errors[0]?.error ?? e.message, emitted }
	}
}

const baseOf = async (memberId: number) =>
	(await testDb.select().from(V).where(eq(V.castMemberId, memberId))).find(
		(v) => v.branchId == null && v.year == null
	)!

describe("the admin lift list", () => {
	test("lists lifted members, follows the card's greetings, agrees with the Overview", async () => {
		const [u] = await testDb
			.insert(schema.users)
			.values({ username: "lift-admin-user" })
			.returning()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: "Lift Book" })
			.returning()
		const shape = {
			firstMessage: "Card hello.",
			alternateGreetings: ["Card alt."]
		}
		const [mixedCard] = await testDb
			.insert(schema.characters)
			.values({ userId: u.id, name: "Mixed", description: "m", ...shape })
			.returning()
		const [plainCard] = await testDb
			.insert(schema.characters)
			.values({ userId: u.id, name: "Plain", description: "p", ...shape })
			.returning()
		const mixed = (
			await testDb
				.insert(schema.lorebookBindings)
				.values({
					lorebookId: book.id,
					binding: "{{char:mixed}}",
					characterId: mixedCard.id,
					name: "",
					retold: { firstMessage: true },
					firstMessage: "Own hello."
				})
				.returning()
		)[0]
		const plain = (
			await testDb
				.insert(schema.lorebookBindings)
				.values({
					lorebookId: book.id,
					binding: "{{char:plain}}",
					characterId: plainCard.id,
					name: ""
				})
				.returning()
		)[0]
		const { liftCharacterVersions } = await import(
			"$lib/server/characters/versionsLift"
		)
		await liftCharacterVersions(testDb as unknown as Db)
		expect(parseLiftNote((await baseOf(mixed.id)).note)).toEqual({
			v: 1,
			differences: [],
			mixedGreetings: true
		})
		// A member with a difference and nothing else: the note as the lift writes it.
		const difference = {
			branchId: null,
			line: "main",
			at: { kind: "before-first-change" },
			appearance: null,
			fields: ["description"]
		}
		await testDb
			.update(V)
			.set({ note: JSON.stringify({ v: 1, differences: [difference] }) })
			.where(eq(V.id, (await baseOf(plain.id)).id))

		// A member is refused.
		const refused = await ask("notes", member)
		expect(refused.res).toBeNull()
		expect(refused.error).toBe("Unauthorized")
		expect((await ask("follow", member, mixed.id)).error).toBe(
			"Unauthorized"
		)

		const listed = await ask("notes", admin)
		expect(listed.emitted).toContain("admin:castLiftNotes")
		expect(listed.res!.count).toBe(2)
		expect(listed.res!.members).toEqual([
			{
				castMemberId: mixed.id,
				lorebookId: book.id,
				lorebookName: "Lift Book",
				memberName: "Mixed",
				note: { v: 1, differences: [], mixedGreetings: true }
			},
			{
				castMemberId: plain.id,
				lorebookId: book.id,
				lorebookName: "Lift Book",
				memberName: "Plain",
				note: { v: 1, differences: [difference] }
			}
		])
		const { buildAdminOverview } = await import(
			"$lib/server/sockets/adminOverview"
		)
		expect((await buildAdminOverview()).data.castLiftCount).toBe(2)

		// A member with no mixed greetings has nothing to follow.
		const nothing = await ask("follow", admin, plain.id)
		expect(nothing.error).toBe(
			"This cast member's greetings were not changed by the upgrade."
		)

		const before = await baseOf(mixed.id)
		expect(before.follows).not.toContain("greetings")
		const followed = await ask("follow", admin, mixed.id)
		expect(followed.error).toBeNull()
		expect(followed.res!.count).toBe(1)
		expect(followed.res!.members.map((m) => m.castMemberId)).toEqual([
			plain.id
		])
		expect(followed.emitted).toEqual(
			expect.arrayContaining([
				"admin:castLiftNotes",
				"admin:castLiftFollowGreetings"
			])
		)
		const after = await baseOf(mixed.id)
		expect(after.follows).toContain("greetings")
		expect(after.note).toBeNull()
		expect((await buildAdminOverview()).data.castLiftCount).toBe(1)

		const again = await ask("follow", admin, mixed.id)
		expect(again.res).toBeNull()
		expect(again.error).toBe(
			"This cast member's greetings were not changed by the upgrade."
		)
	})
})
