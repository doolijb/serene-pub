/**
 * Retold fields at the read seams (PLAN-cast-retold-fields-2026-10-13).
 *
 *  1. `applyRetold` is the card itself when nothing is retold.
 *  2. `session_cast` with `retold = {}` hands out the card row untouched.
 *  3. A retold description reaches the prompt's card, and drops the strokes.
 *  4. A retold first message is the greeting.
 *  5. `retoldMembersForSession` carries a retold face; `faceMediaProblem`
 *     accepts a book upload or a gallery image of the card, nothing else.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { applyRetold } from "./retold"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-retold-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
const node = { key: "read", definitionId: "core:query/session-cast@1" } as any
let n = 0

async function cast(retold: Record<string, boolean> = {}, member: Partial<typeof schema.lorebookBindings.$inferInsert> = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `retold-${suffix}`)
	const [card] = await testDb
		.insert(schema.characters)
		.values({
			userId: user.id,
			name: `Verity ${suffix}`,
			description: "The card's description.",
			personality: "The card's personality.",
			firstMessage: "The card says hello.",
			alternateGreetings: ["The card's other hello."],
			strokes: [{ kind: "description", text: "A stroke.", trigger: "always" } as any]
		})
		.returning()
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [binding] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			characterId: card.id,
			binding: `{{char:${suffix}}}`,
			name: card.name,
			description: "The member's description.",
			firstMessage: "The member says hello.",
			retold,
			...member
		})
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, lorebookId: lorebook.id })
		.returning()
	await testDb.insert(schema.sessionCharacters).values({ sessionId: session.id, characterId: card.id })
	return { user, card, lorebook, binding, session }
}

async function readCast(sessionId: number) {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return (await createHost(db(), { sessionId }).read!("session_cast", { sessionId }, node)) as any
}

describe("applyRetold", () => {
	test("nothing retold is the card itself", () => {
		const card = { description: "d", strokes: [] }
		expect(applyRetold(card, { retold: {} })).toBe(card)
		expect(applyRetold(card, { retold: { description: false, face: true } })).toBe(card)
	})
	test("a retold field reads the member's, empty as empty", () => {
		const card = { description: "d", personality: "p", scenario: "s", strokes: [1] }
		const out = applyRetold(card, {
			retold: { personality: true, scenario: true, alternateGreetings: true },
			personality: "mine",
			scenario: null,
			alternateGreetings: ["a"]
		})
		expect(out).toEqual({
			description: "d",
			personality: "mine",
			scenario: "",
			alternateGreetings: ["a"],
			groupOnlyGreetings: [],
			strokes: null
		})
	})
	test("retold greetings replace the card's group-only ones too, so a group session uses the member's", () => {
		const card = { firstMessage: "card", groupOnlyGreetings: ["group"] }
		expect(
			applyRetold(card, { retold: { firstMessage: true }, firstMessage: "mine" })
		).toEqual({ firstMessage: "mine", groupOnlyGreetings: [] })
		// Greetings left to the card keep its group-only ones.
		expect(
			applyRetold(card, { retold: { scenario: true }, scenario: "s" })
		).toEqual({ firstMessage: "card", groupOnlyGreetings: ["group"], scenario: "s" })
	})
	test("retold example dialogues split on <START> into the card's array shape", () => {
		const card = { exampleDialogues: ["card"] }
		expect(
			applyRetold(card, {
				retold: { exampleDialogues: true },
				exampleDialogues: "<START>\nA: hi\nB: hey\n\n<START>\nA: bye"
			}).exampleDialogues
		).toEqual(["A: hi\nB: hey", "A: bye"])
		expect(
			applyRetold(card, { retold: { exampleDialogues: true }, exampleDialogues: null })
				.exampleDialogues
		).toEqual([])
	})
})

describe("session_cast", () => {
	test("retold = {} hands out the card row untouched", async () => {
		const c = await cast()
		const [row] = await testDb.select().from(schema.characters).where(eq(schema.characters.id, c.card.id))
		const read = await readCast(c.session.id)
		expect(read.sessionCharacters).toHaveLength(1)
		expect(read.sessionCharacters[0].character).toEqual(row)
	})

	test("a retold description reaches the prompt's card and drops the strokes", async () => {
		const c = await cast({ description: true })
		const read = await readCast(c.session.id)
		const character = read.sessionCharacters[0].character
		expect(character.description).toBe("The member's description.")
		expect(character.personality).toBe("The card's personality.")
		expect(character.strokes).toBeNull()
		const { resolveContextInput } = await import("$lib/server/pipelines/prompt/promptFields")
		const resolved: any = resolveContextInput({
			sessionCharacters: read.sessionCharacters,
			sessionPersonas: [],
			promptConfig: {} as any,
			currentCharacterId: c.card.id
		} as any)
		expect(JSON.stringify(resolved)).toContain("The member's description.")
		expect(JSON.stringify(resolved)).not.toContain("The card's description.")
	})
})

describe("greetings", () => {
	test("a retold first message is the greeting", async () => {
		const { collectSessionGreetings } = await import("$lib/server/sessions/greetings")
		const plain = await cast()
		expect((await collectSessionGreetings(db(), plain.session.id)).entries[0].texts).toEqual([
			"The card says hello.",
			"The card's other hello."
		])
		const c = await cast({ firstMessage: true, alternateGreetings: true })
		expect((await collectSessionGreetings(db(), c.session.id)).entries[0].texts).toEqual([
			"The member says hello."
		])
	})
})

describe("faces", () => {
	test("a retold face is carried; only a book upload or a gallery image may be worn", async () => {
		const { retoldMembersForSession, faceMediaProblem } = await import("./retold")
		const c = await cast()
		const file = async (values: Partial<typeof schema.files.$inferInsert>) =>
			(
				await testDb
					.insert(schema.files)
					.values({ userId: c.user.id, kind: "image", hash: `h${++n}`, ...values })
					.returning()
			)[0]
		const upload = await file({ lorebookId: c.lorebook.id })
		const gallery = await file({ characterId: c.card.id })
		const personal = await file({})
		const privateOne = await file({ visibility: "private" })
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const other = await createTestUser(testDb, `retold-other-${++n}`)
		const stranger = await file({ userId: other.id })
		await testDb
			.update(schema.lorebookBindings)
			.set({ faceMediaId: upload.id, retold: { face: true } })
			.where(eq(schema.lorebookBindings.id, c.binding.id))
		const members = await retoldMembersForSession(db(), c.session.id, [c.card.id])
		expect(members.get(c.card.id)?.faceMediaId).toBe(upload.id)

		const ask = (fileId: number) =>
			faceMediaProblem(db(), {
				fileId,
				lorebookId: c.lorebook.id,
				characterId: c.card.id,
				userId: c.user.id
			})
		expect(await ask(upload.id)).toBeNull()
		expect(await ask(gallery.id)).toBeNull()
		// The asker's own picture (what an upload re-uses) may be worn; a
		// private one may not, nor anyone else's.
		expect(await ask(personal.id)).toBeNull()
		expect(await ask(privateOne.id)).toMatch(/not one this cast member can wear/)
		expect(await ask(stranger.id)).toMatch(/not one this cast member can wear/)
	})
})

describe("amendments", () => {
	test("retold fields are amendable at a date, and refused when malformed", async () => {
		const { amendmentsCreateHandler } = await import("$lib/server/sockets/amendments")
		const { retoldMembersForSession } = await import("./retold")
		const c = await cast()
		const socket = { user: { id: c.user.id } } as any
		const noop = () => {}
		await amendmentsCreateHandler.handler(
			socket,
			{
				lorebookId: c.lorebook.id,
				castId: c.binding.id,
				year: 5,
				fields: { description: "Older now.", retold: { description: true } }
			} as any,
			noop as any
		)
		// Before the date nobody retells; after it, the dated text is read.
		await testDb.update(schema.sessions).set({ storyClockYear: 4 }).where(eq(schema.sessions.id, c.session.id))
		expect((await retoldMembersForSession(db(), c.session.id)).size).toBe(0)
		await testDb.update(schema.sessions).set({ storyClockYear: 6 }).where(eq(schema.sessions.id, c.session.id))
		expect((await retoldMembersForSession(db(), c.session.id)).get(c.card.id)).toMatchObject({
			description: "Older now.",
			retold: { description: true }
		})

		await expect(
			amendmentsCreateHandler.handler(
				socket,
				{
					lorebookId: c.lorebook.id,
					castId: c.binding.id,
					year: 7,
					fields: { retold: { age: true } }
				} as any,
				noop as any
			)
		).rejects.toThrow(/not a field a cast member can retell/)
	})
})

describe("sockets", () => {
	test("updateBinding refuses a malformed retold and a stranger's picture; uploadMemberFace sets the face", async () => {
		const { PNG } = await import("pngjs")
		const { updateLorebookBindingHandler, uploadMemberFaceHandler, lorebookBindingsForCharacterHandler } =
			await import("$lib/server/sockets/lorebooks")
		const c = await cast()
		const socket = { user: { id: c.user.id } } as any
		const noop = (() => {}) as any
		await expect(
			updateLorebookBindingHandler.handler(
				socket,
				{ lorebookBinding: { id: c.binding.id, retold: { description: "yes" } } } as any,
				noop
			)
		).rejects.toThrow(/must be true or false/)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const other = await createTestUser(testDb, `retold-other-${++n}`)
		const [stranger] = await testDb
			.insert(schema.files)
			.values({ userId: other.id, kind: "image", hash: `h${++n}` })
			.returning()
		await expect(
			updateLorebookBindingHandler.handler(
				socket,
				{ lorebookBinding: { id: c.binding.id, faceMediaId: stranger.id } } as any,
				noop
			)
		).rejects.toThrow(/not one this cast member can wear/)

		const p = new PNG({ width: 2, height: 2 })
		p.data.fill(200)
		const res = await uploadMemberFaceHandler.handler(
			socket,
			{ castId: c.binding.id, imageFile: PNG.sync.write(p), mimeType: "image/png" },
			noop
		)
		// The upload only STORES the picture: the member is untouched until a
		// save picks it (owner 2026-10-13).
		expect(res).toMatchObject({ castId: c.binding.id, lorebookId: c.lorebook.id })
		const [face] = await testDb
			.select()
			.from(schema.files)
			.where(eq(schema.files.id, res.mediaId))
		expect(face.lorebookId).toBe(c.lorebook.id)
		const [unchanged] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, c.binding.id))
		expect(unchanged.faceMediaId).toBeNull()
		expect(unchanged.retold).toEqual({})
		// It is listed among the book's pictures, and a save may pick it.
		const { listMemberFacesHandler } = await import("$lib/server/sockets/lorebooks")
		const listed = await listMemberFacesHandler.handler(
			socket,
			{ lorebookId: c.lorebook.id },
			noop
		)
		expect(listed.mediaIds).toContain(res.mediaId)
		await updateLorebookBindingHandler.handler(
			socket,
			{ lorebookBinding: { id: c.binding.id, faceMediaId: res.mediaId, retold: { face: true } } } as any,
			noop
		)

		// The banner's members, with what each retells.
		const banner = await lorebookBindingsForCharacterHandler.handler(
			socket,
			{ characterId: c.card.id },
			noop
		)
		expect(banner.members).toEqual([
			{ lorebookId: c.lorebook.id, lorebookName: c.lorebook.name, castId: c.binding.id, retold: ["face"] }
		])
	})
})

describe("review fixes 2026-10-13", () => {
	test("a gallery image of a card the member is drawn with at a date may be worn there", async () => {
		const { amendmentsCreateHandler } = await import("$lib/server/sockets/amendments")
		const c = await cast()
		const [older] = await testDb
			.insert(schema.characters)
			.values({ userId: c.user.id, name: "Verity, older", description: "Older." })
			.returning()
		const [olderGallery] = await testDb
			.insert(schema.files)
			.values({ userId: c.user.id, kind: "image", hash: `h${++n}`, characterId: older.id })
			.returning()
		const socket = { user: { id: c.user.id } } as any
		const noop = (() => {}) as any
		// Y20: the member is drawn with the older card.
		await amendmentsCreateHandler.handler(
			socket,
			{ lorebookId: c.lorebook.id, castId: c.binding.id, year: 20, fields: { characterId: older.id } } as any,
			noop
		)
		// Y25: a face from the older card's gallery, sent alone (as the form does).
		await expect(
			amendmentsCreateHandler.handler(
				socket,
				{
					lorebookId: c.lorebook.id,
					castId: c.binding.id,
					year: 25,
					fields: { faceMediaId: olderGallery.id, retold: { face: true } }
				} as any,
				noop
			)
		).resolves.not.toThrow()
	})

	test("an upload reusing a personal file never re-stamps it, a private one is refused, and only its own reply is sent", async () => {
		const { PNG } = await import("pngjs")
		const { uploadMemberFaceHandler } = await import("$lib/server/sockets/lorebooks")
		const { createMedia } = await import("$lib/server/media")
		const { MediaVisibility } = await import("$lib/shared/constants/MediaVisibility")
		const c = await cast()
		const socket = { user: { id: c.user.id } } as any
		const picture = (shade: number) => {
			const p = new PNG({ width: 2, height: 2 })
			p.data.fill(shade)
			return PNG.sync.write(p)
		}

		// A personal file with the same bytes is reused as is: still personal.
		const mine = picture(17)
		const personal = await createMedia(db(), { userId: c.user.id, bytes: mine })
		const emitted: string[] = []
		const res = await uploadMemberFaceHandler.handler(
			socket,
			{ castId: c.binding.id, imageFile: mine, mimeType: "image/png" },
			((event: string) => emitted.push(event)) as any
		)
		expect(res.mediaId).toBe(personal.file.id)
		const [still] = await testDb.select().from(schema.files).where(eq(schema.files.id, personal.file.id))
		expect(still.lorebookId).toBeNull()
		expect(emitted).toEqual(["lorebooks:uploadMemberFace"])
		// The re-used picture is still listed for this book once a member wears it.
		const { listMemberFacesHandler, updateLorebookBindingHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		await updateLorebookBindingHandler.handler(
			socket,
			{ lorebookBinding: { id: c.binding.id, faceMediaId: res.mediaId, retold: { face: true } } } as any,
			(() => {}) as any
		)
		const listed = await listMemberFacesHandler.handler(
			socket,
			{ lorebookId: c.lorebook.id },
			(() => {}) as any
		)
		expect(listed.mediaIds).toContain(res.mediaId)

		// A private file with the same bytes cannot become a face.
		const secret = picture(33)
		const priv = await createMedia(db(), { userId: c.user.id, bytes: secret })
		await testDb
			.update(schema.files)
			.set({ visibility: MediaVisibility.PRIVATE })
			.where(eq(schema.files.id, priv.file.id))
		await expect(
			uploadMemberFaceHandler.handler(
				socket,
				{ castId: c.binding.id, imageFile: secret, mimeType: "image/png" },
				(() => {}) as any
			)
		).rejects.toThrow(/private files/)

		// Not a picture: refused before anything is written.
		const before = (await testDb.select().from(schema.files)).length
		await expect(
			uploadMemberFaceHandler.handler(
				socket,
				{ castId: c.binding.id, imageFile: Buffer.from("plain text, not a picture"), mimeType: "text/plain" },
				(() => {}) as any
			)
		).rejects.toThrow()
		expect((await testDb.select().from(schema.files)).length).toBe(before)
	})

	test("a face worn in a book is visible to that book's readers whatever the file is stamped with", async () => {
		const { canViewMedia } = await import("$lib/server/media/access")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const a = await cast()
		const b = await cast()
		// One file, stamped with A's book, worn in B (same owner in real life;
		// here B's member simply wears it).
		const [file] = await testDb
			.insert(schema.files)
			.values({ userId: a.user.id, kind: "image", hash: `h${++n}`, lorebookId: a.lorebook.id })
			.returning()
		await testDb
			.update(schema.lorebookBindings)
			.set({ faceMediaId: file.id, retold: { face: true } })
			.where(eq(schema.lorebookBindings.id, b.binding.id))
		// B's owner can read B, not A: the face is visible through B.
		expect(await canViewMedia(file, b.user.id, db())).toBe(true)
		// A stranger reads neither book.
		const stranger = await createTestUser(testDb, `retold-stranger-${++n}`)
		expect(await canViewMedia(file, stranger.id, db())).toBe(false)
	})
})

