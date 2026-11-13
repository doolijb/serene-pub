/**
 * A card-less member's own words (description, personality, scenario,
 * greetings, example dialogues) save through `lorebooks:updateBinding` and
 * read back through `membersAsRead`: for a member that never had a card, for
 * one made card-less by a card delete, and a carded member is unchanged.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { MAIN_HEAD } from "$lib/server/state/entriesOnReading"
import { insertCard, insertCastMember } from "$lib/server/characters/versions"
import {
	memberDraftOf,
	memberPatch
} from "$lib/client/lorebooks/cast/memberDraft"

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
		path.join(os.tmpdir(), "serene-pub-vitest-cardless-words-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `cardless-words-${++n}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${n}`, userId: user.id })
		.returning()
	const bindingOf = () => `{{char:${++n}}}`
	const updateOf =
		(id: number) => async (fields: Record<string, unknown>) => {
			const { updateLorebookBindingHandler } = await import(
				"$lib/server/sockets/lorebooks"
			)
			return (await updateLorebookBindingHandler.handler(
				{ user: { id: user.id } } as any,
				{ lorebookBinding: { id, ...fields } } as any,
				(async () => {}) as any
			)) as Sockets.Lorebooks.UpdateBinding.Response
		}
	const readOf = (id: number) => async () => {
		const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
		return (await membersAsRead(db(), [id], { reading: MAIN_HEAD })).get(
			id
		)!
	}
	return { user, book: book!, bindingOf, updateOf, readOf }
}

describe("a card-less member's own words through lorebooks:updateBinding", () => {
	test("a member that never had a card edits each of the five and reads them back", async () => {
		const w = await world()
		const { member } = await insertCastMember(db(), {
			lorebookId: w.book.id,
			binding: w.bindingOf(),
			characterId: null,
			name: "Loner",
			description: "Starting description.",
			personality: "Starting personality.",
			scenario: "Starting scenario.",
			firstMessage: "Starting hello.",
			alternateGreetings: ["Starting swipe."],
			exampleDialogues: "Starting example."
		})
		const update = w.updateOf(member.id)
		const read = w.readOf(member.id)
		const first = await read()
		expect(first.description).toBe("Starting description.")

		const draft = {
			...memberDraftOf({
				id: member.id,
				name: "Loner",
				description: "Starting description.",
				personality: "Starting personality.",
				scenario: "Starting scenario.",
				firstMessage: "Starting hello.",
				alternateGreetings: ["Starting swipe."],
				exampleDialogues: "Starting example."
			}),
			description: "A new description.",
			personality: "A new personality.",
			scenario: "A new scenario.",
			firstMessage: "A new hello.",
			alternateGreetings: ["A new swipe.", "A second swipe."],
			groupOnlyGreetings: ["A new group hello."],
			exampleDialogues: "A new example."
		}
		const patch = memberPatch(draft, false)
		for (const key of [
			"description",
			"personality",
			"scenario",
			"firstMessage",
			"alternateGreetings",
			"groupOnlyGreetings",
			"exampleDialogues"
		])
			expect(patch).toHaveProperty(key)
		const res = await update(patch)

		const expected = {
			description: "A new description.",
			personality: "A new personality.",
			scenario: "A new scenario.",
			firstMessage: "A new hello.",
			alternateGreetings: ["A new swipe.", "A second swipe."],
			groupOnlyGreetings: ["A new group hello."]
		}
		expect(res.lorebookBinding).toMatchObject(expected)
		const as = await read()
		expect(as).toMatchObject(expected)
		// The read splits example dialogues into a list.
		expect(as.exampleDialogues.join("\n")).toContain("A new example.")
		expect(res.lorebookBinding.exampleDialogues).toContain("A new example.")
	})

	test("a member made card-less by a card delete keeps the card's words and can edit them", async () => {
		const w = await world()
		const { card } = await insertCard(db(), {
			userId: w.user.id,
			name: `Verity ${n}`,
			description: "The card's description.",
			personality: "The card's personality.",
			scenario: "The card's scenario.",
			firstMessage: "The card's hello.",
			alternateGreetings: ["The card's swipe."],
			exampleDialogues: ["The card's example."]
		})
		const { member } = await insertCastMember(db(), {
			lorebookId: w.book.id,
			binding: w.bindingOf(),
			characterId: card.id,
			name: `Maren ${n}`
		})
		const read = w.readOf(member.id)
		const before = await read()
		expect(before.description).toBe("The card's description.")

		const { makeMemberCardless } = await import("$lib/server/cast/cardless")
		await testDb.transaction(async (tx) => {
			await makeMemberCardless(tx as unknown as Db, member.id, {
				cause: "card-delete"
			})
		})
		const [row] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, member.id))
		expect(row.characterId).toBeNull()

		const kept = await read()
		expect(kept).toMatchObject({
			description: "The card's description.",
			personality: "The card's personality.",
			scenario: "The card's scenario.",
			firstMessage: "The card's hello.",
			alternateGreetings: ["The card's swipe."]
		})
		expect(kept.exampleDialogues.join("\n")).toContain(
			"The card's example."
		)

		const draft = {
			...memberDraftOf({
				id: member.id,
				name: kept.name,
				description: kept.description,
				personality: kept.personality,
				scenario: kept.scenario,
				firstMessage: kept.firstMessage,
				alternateGreetings: kept.alternateGreetings,
				groupOnlyGreetings: kept.groupOnlyGreetings,
				exampleDialogues: kept.exampleDialogues.join("\n")
			} as any),
			description: "Her own description now."
		}
		await w.updateOf(member.id)(memberPatch(draft, false))
		const after = await read()
		expect(after.description).toBe("Her own description now.")
		expect(after).toMatchObject({
			personality: "The card's personality.",
			scenario: "The card's scenario.",
			firstMessage: "The card's hello.",
			alternateGreetings: ["The card's swipe."]
		})
		expect(after.exampleDialogues.join("\n")).toContain(
			"The card's example."
		)
	})

	test("a carded member's retold description still reads back as before", async () => {
		const w = await world()
		const { card } = await insertCard(db(), {
			userId: w.user.id,
			name: `Verity ${n}`,
			description: "The card's description."
		})
		const { member } = await insertCastMember(db(), {
			lorebookId: w.book.id,
			binding: w.bindingOf(),
			characterId: card.id,
			name: `Maren ${n}`
		})
		const read = w.readOf(member.id)
		expect((await read()).description).toBe("The card's description.")
		const res = await w.updateOf(member.id)({
			retold: { description: true },
			description: "Her own description."
		})
		expect(res.lorebookBinding.description).toBe("Her own description.")
		expect((await read()).description).toBe("Her own description.")
	})
})

describe("group-only greetings sent on create (lead check, 2026-11-10)", () => {
	const createIn = (w: Awaited<ReturnType<typeof world>>) =>
		async (fields: Record<string, unknown>) => {
			const { createLorebookBindingHandler } = await import(
				"$lib/server/sockets/lorebooks"
			)
			return (await createLorebookBindingHandler.handler(
				{ user: { id: w.user.id } } as any,
				{ lorebookBinding: { lorebookId: w.book.id, ...fields } } as any,
				(async () => {}) as any
			)) as Sockets.Lorebooks.CreateBinding.Response
		}

	test("a card-less member created with group-only greetings keeps them", async () => {
		const w = await world()
		const res = await createIn(w)({
			characterId: null,
			name: `Wren ${n}`,
			firstMessage: "Hello.",
			retold: { firstMessage: true, alternateGreetings: true },
			groupOnlyGreetings: ["Hello, all of you."]
		})
		const as = await w.readOf(res.lorebookBinding.id)()
		expect(as.groupOnlyGreetings).toEqual(["Hello, all of you."])
	})

	test("a card-less member created with post-history instructions keeps them", async () => {
		const w = await world()
		const res = await createIn(w)({
			characterId: null,
			name: `Ash ${n}`,
			postHistoryInstructions: "Stay in character."
		})
		const as = await w.readOf(res.lorebookBinding.id)()
		expect(as.postHistoryInstructions).toBe("Stay in character.")
	})

	test("a carded member created with retold greetings keeps its group-only greetings", async () => {
		const w = await world()
		const { card } = await insertCard(db(), {
			userId: w.user.id,
			name: `Verity ${n}`,
			description: "The card's description.",
			firstMessage: "The card's hello."
		})
		const res = await createIn(w)({
			characterId: card.id,
			retold: { firstMessage: true, alternateGreetings: true },
			firstMessage: "Her own hello.",
			alternateGreetings: [],
			groupOnlyGreetings: ["Her own group hello."]
		})
		const as = await w.readOf(res.lorebookBinding.id)()
		expect(as.firstMessage).toBe("Her own hello.")
		expect(as.groupOnlyGreetings).toEqual(["Her own group hello."])
	})
})
