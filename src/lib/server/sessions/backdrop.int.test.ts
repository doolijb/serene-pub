/**
 * 🚧 A session's backdrop (DESIGN-image-generation §6.4, ruling §9.4):
 * `sessions.backdropMediaId`, written by `core:outlet/set-backdrop@1` and by
 * a person's `sessions:setBackdrop`.
 *
 *  1. The outlet points the session at the first image of `media`, records
 *     the session as the run's artifact, and raises `backdrop-set` under the
 *     run's cause; an empty list writes nothing and raises nothing; another
 *     user's private file is refused.
 *  2. The socket: the owner sets and clears it (a cast member's gallery
 *     image included); a guest is refused; an admin may; every set raises
 *     `backdrop-set` under the `settings` cause.
 *  3. `backdrop` is a published value enabled-when reads.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

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
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-backdrop-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
async function user(admin = false) {
	const [u] = await testDb
		.insert(schema.users)
		.values({ username: `backdrop-user-${++n}`, isAdmin: admin } as any)
		.returning()
	return u
}

async function session(userId: number) {
	const [s] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false } as any)
		.returning()
	return s
}

async function file(userId: number, over: Record<string, unknown> = {}) {
	const [f] = await testDb
		.insert(schema.files)
		.values({
			userId,
			kind: "image",
			hash: `backdrop-${++n}`,
			...over
		} as any)
		.returning()
	return f
}

async function backdropOf(sessionId: number) {
	const [row] = await testDb
		.select({ id: schema.sessions.backdropMediaId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return row.id
}

async function changes(sessionId: number) {
	return testDb
		.select()
		.from(schema.sessionChanges)
		.where(
			and(
				eq(schema.sessionChanges.sessionId, sessionId),
				eq(schema.sessionChanges.event, "core:event/backdrop-set@1")
			)
		)
}

const NODE = {
	key: "backdrop",
	definitionId: "core:outlet/set-backdrop",
	definitionVersion: 1
} as any

function fakeSocket(userId: number, isAdmin = false) {
	return { user: { id: userId, isAdmin }, io: undefined } as any
}

describe("1 · core:outlet/set-backdrop@1", () => {
	test("writes the pointer from the first image, records the session, raises backdrop-set", async () => {
		const owner = await user()
		const s = await session(owner.id)
		const audio = await file(owner.id, { kind: "audio", sessionId: s.id })
		const pic = await file(owner.id, { sessionId: s.id })
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const artifacts: any[] = []
		const host = createHost(
			testDb as any,
			{
				sessionId: s.id,
				userId: owner.id,
				specId: "test:spec/backdrop",
				runId: "run-backdrop",
				artifacts
			} as any
		)
		const out: any = await host.commit!(
			{
				media: [
					{ uuid: audio.uuid, kind: "audio" },
					{ uuid: pic.uuid, kind: "image", key: "scene" }
				]
			},
			NODE
		)
		expect(out).toMatchObject({
			id: s.id,
			sessionId: s.id,
			mediaId: pic.id
		})
		expect(await backdropOf(s.id)).toBe(pic.id)
		expect(artifacts).toEqual([
			{
				kind: "session",
				entityId: s.id,
				action: "updated",
				nodeKey: "backdrop"
			}
		])
		const raised = await changes(s.id)
		expect(raised).toHaveLength(1)
		expect(raised[0].runId).toBe("run-backdrop")
		expect(raised[0].payload).toMatchObject({
			backdropMediaId: pic.id,
			previousBackdropMediaId: null,
			cause: { kind: "run" }
		})

		// The same picture again moves nothing and raises nothing.
		const again: any = await host.commit!({ media: [pic.uuid] }, NODE)
		expect(again.written).toBe(false)
		expect(await changes(s.id)).toHaveLength(1)
	})

	test("an empty list writes nothing — it never clears", async () => {
		const owner = await user()
		const s = await session(owner.id)
		const pic = await file(owner.id, { sessionId: s.id })
		await testDb
			.update(schema.sessions)
			.set({ backdropMediaId: pic.id })
			.where(eq(schema.sessions.id, s.id))
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(
			testDb as any,
			{ sessionId: s.id, userId: owner.id } as any
		)
		const out: any = await host.commit!({ media: [] }, NODE)
		expect(out).toMatchObject({ written: false, mediaId: null })
		expect(await backdropOf(s.id)).toBe(pic.id)
		expect(await changes(s.id)).toHaveLength(0)
	})

	test("another user's private picture is refused", async () => {
		const owner = await user()
		const stranger = await user()
		const s = await session(owner.id)
		const theirs = await file(stranger.id)
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(
			testDb as any,
			{ sessionId: s.id, userId: owner.id } as any
		)
		await expect(
			host.commit!({ media: [theirs.uuid] }, NODE)
		).rejects.toThrow(/refused/)
		expect(await backdropOf(s.id)).toBeNull()
	})

	test("a guest's run is refused without halting, the reason on the run; an admin's writes", async () => {
		const owner = await user()
		const guest = await user()
		const admin = await user(true)
		const s = await session(owner.id)
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: s.id, userId: guest.id } as any)
		const pic = await file(guest.id, { sessionId: s.id })
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const asGuest = createHost(
			testDb as any,
			{ sessionId: s.id, userId: guest.id } as any
		)
		const out: any = await asGuest.commit!({ media: [pic.uuid] }, NODE)
		expect(out).toMatchObject({ written: false, mediaId: null })
		expect(out.notes).toEqual([
			"refused: Only the session's owner or an admin can change its backdrop."
		])
		expect(await backdropOf(s.id)).toBeNull()
		expect(await changes(s.id)).toHaveLength(0)

		const asAdmin = createHost(
			testDb as any,
			{ sessionId: s.id, userId: admin.id } as any
		)
		const ok: any = await asAdmin.commit!({ media: [pic.uuid] }, NODE)
		expect(ok).toMatchObject({ sessionId: s.id, mediaId: pic.id })
		expect(await backdropOf(s.id)).toBe(pic.id)
	})
})

describe("2 · sessions:setBackdrop", () => {
	test("the owner sets a cast member's gallery image, then clears it", async () => {
		const owner = await user()
		const castOwner = await user()
		const s = await session(owner.id)
		const [character] = await testDb
			.insert(schema.characters)
			.values({
				userId: castOwner.id,
				name: "Verity",
				description: ""
			} as any)
			.returning()
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: s.id, characterId: character.id } as any)
		const pic = await file(castOwner.id, { characterId: character.id })
		const { sessionsSetBackdrop } = await import(
			"$lib/server/sockets/backdrop"
		)

		const emits: Array<[string, any]> = []
		const res: any = await sessionsSetBackdrop.handler(
			fakeSocket(owner.id),
			{ sessionId: s.id, mediaRef: pic.uuid, request: "t1" },
			(e: string, d: any) => emits.push([e, d])
		)
		expect(res).toEqual({
			sessionId: s.id,
			request: "t1",
			backdropMediaId: pic.id
		})
		expect(emits).toEqual([["sessions:setBackdrop", res]])
		expect(await backdropOf(s.id)).toBe(pic.id)
		const raised = await changes(s.id)
		expect(raised).toHaveLength(1)
		expect(raised[0].payload).toMatchObject({
			cause: { kind: "settings", userId: owner.id }
		})

		const cleared: any = await sessionsSetBackdrop.handler(
			fakeSocket(owner.id),
			{ sessionId: s.id, mediaRef: null },
			() => {}
		)
		expect(cleared.backdropMediaId).toBeNull()
		expect(await backdropOf(s.id)).toBeNull()
		expect(await changes(s.id)).toHaveLength(2)
	})

	test("a guest is refused; an admin may", async () => {
		const owner = await user()
		const guest = await user()
		const admin = await user(true)
		const s = await session(owner.id)
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: s.id, userId: guest.id } as any)
		const pic = await file(owner.id, { sessionId: s.id })
		const { sessionsSetBackdrop } = await import(
			"$lib/server/sockets/backdrop"
		)

		const emits: Array<[string, any]> = []
		const refused: any = await sessionsSetBackdrop.handler(
			fakeSocket(guest.id),
			{ sessionId: s.id, mediaRef: pic.uuid, request: "g" },
			(e: string, d: any) => emits.push([e, d])
		)
		expect(refused.error).toMatch(/owner/)
		expect(emits[0][0]).toBe("sessions:setBackdrop:error")
		expect(emits[0][1].request).toBe("g")
		expect(await backdropOf(s.id)).toBeNull()

		const ok: any = await sessionsSetBackdrop.handler(
			fakeSocket(admin.id, true),
			{ sessionId: s.id, mediaRef: pic.uuid },
			() => {}
		)
		expect(ok.error).toBeUndefined()
		expect(await backdropOf(s.id)).toBe(pic.id)
	})

	test("a picture the session may not show, or no picture at all, is refused in words", async () => {
		const owner = await user()
		const stranger = await user()
		const s = await session(owner.id)
		const theirs = await file(stranger.id)
		const { sessionsSetBackdrop } = await import(
			"$lib/server/sockets/backdrop"
		)
		const notTheirs: any = await sessionsSetBackdrop.handler(
			fakeSocket(owner.id),
			{ sessionId: s.id, mediaRef: theirs.uuid },
			() => {}
		)
		expect(notTheirs.error).toMatch(/belongs to neither/)
		const nothing: any = await sessionsSetBackdrop.handler(
			fakeSocket(owner.id),
			{ sessionId: s.id, mediaRef: "not-a-uuid" },
			() => {}
		)
		expect(nothing.error).toMatch(/not an image/)
		expect(await backdropOf(s.id)).toBeNull()
	})
})

describe("2c · a cast image is the seated member's too", () => {
	async function seatedWorld() {
		const owner = await user()
		const castOwner = await user()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: owner.id, name: `Book ${++n}` } as any)
			.returning()
		const [s] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false, lorebookId: book.id } as any)
			.returning()
		return { owner, castOwner, book, s }
	}
	const who = (sessionId: number, userId: number) => ({
		sessionId,
		userId,
		castImages: true
	})

	test("a card-less member's gallery file counts for the session it is seated in, on either seat table, and not for another", async () => {
		const { insertCastMember } = await import("$lib/server/characters/versions")
		const { backdropFileFor, BackdropRefusal } = await import(
			"$lib/server/sessions/backdrop"
		)
		const w = await seatedWorld()
		const mk = async (name: string) =>
			(
				await insertCastMember(testDb as any, {
					lorebookId: w.book.id,
					characterId: null,
					binding: `{{char:bd${++n}}}`,
					name
				} as any)
			).member
		const seated = await mk("Seated")
		const voiced = await mk("Voiced")
		const stranger = await mk("Stranger")
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: w.castOwner.id, name: "Held", description: "" } as any)
			.returning()
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: w.s.id, characterId: card.id, castMemberId: seated.id } as any)
		await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: w.s.id, personaId: null, castMemberId: voiced.id } as any)
		const picSeated = await file(w.castOwner.id)
		const picVoiced = await file(w.castOwner.id)
		const picStranger = await file(w.castOwner.id)
		for (const [m, pic] of [
			[seated, picSeated],
			[voiced, picVoiced],
			[stranger, picStranger]
		] as const)
			await testDb
				.insert(schema.castMemberFiles)
				.values({ castMemberId: m.id, fileId: pic.id })

		expect(
			await backdropFileFor(testDb as any, picSeated.uuid, who(w.s.id, w.owner.id))
		).toEqual({ id: picSeated.id })
		expect(
			await backdropFileFor(testDb as any, picVoiced.uuid, who(w.s.id, w.owner.id))
		).toEqual({ id: picVoiced.id })
		await expect(
			backdropFileFor(testDb as any, picStranger.uuid, who(w.s.id, w.owner.id))
		).rejects.toBeInstanceOf(BackdropRefusal)
		// A run (castImages false) may not use a gallery image at all.
		await expect(
			backdropFileFor(testDb as any, picSeated.uuid, {
				...who(w.s.id, w.owner.id),
				castImages: false
			})
		).rejects.toBeInstanceOf(BackdropRefusal)
	})

	test("a dated card change written as a version makes that card's gallery count", async () => {
		const { insertCastMember } = await import("$lib/server/characters/versions")
		const { insertDatedCardVersion } = await import("$lib/server/pipelines/testing/fixtures")
		const { backdropFileFor, BackdropRefusal } = await import(
			"$lib/server/sessions/backdrop"
		)
		const w = await seatedWorld()
		const [a] = await testDb
			.insert(schema.characters)
			.values({ userId: w.castOwner.id, name: "Held card", description: "" } as any)
			.returning()
		const [b] = await testDb
			.insert(schema.characters)
			.values({ userId: w.castOwner.id, name: "Later card", description: "" } as any)
			.returning()
		const m = (
			await insertCastMember(testDb as any, {
				lorebookId: w.book.id,
				characterId: a.id,
				binding: `{{char:bd${++n}}}`,
				name: "Dated"
			} as any)
		).member
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: w.s.id, characterId: a.id, castMemberId: m.id } as any)
		const picB = await file(w.castOwner.id, { characterId: b.id })
		await expect(
			backdropFileFor(testDb as any, picB.uuid, who(w.s.id, w.owner.id))
		).rejects.toBeInstanceOf(BackdropRefusal)
		await insertDatedCardVersion(testDb, m.id, b.id, 30)
		expect(
			await backdropFileFor(testDb as any, picB.uuid, who(w.s.id, w.owner.id))
		).toEqual({ id: picB.id })
	})
})

describe("2b · a picture named by its file id (From this session)", () => {
	test("the session's own picture by id is set; a stranger's by id is refused the same way", async () => {
		const owner = await user()
		const stranger = await user()
		const s = await session(owner.id)
		const ours = await file(owner.id, { sessionId: s.id })
		const theirs = await file(stranger.id)
		const { sessionsSetBackdrop } = await import(
			"$lib/server/sockets/backdrop"
		)
		const ok: any = await sessionsSetBackdrop.handler(
			fakeSocket(owner.id),
			{ sessionId: s.id, mediaRef: String(ours.id) },
			() => {}
		)
		expect(ok.error).toBeUndefined()
		expect(await backdropOf(s.id)).toBe(ours.id)
		const refused: any = await sessionsSetBackdrop.handler(
			fakeSocket(owner.id),
			{ sessionId: s.id, mediaRef: String(theirs.id) },
			() => {}
		)
		expect(refused.error).toMatch(/belongs to neither/)
		const none: any = await sessionsSetBackdrop.handler(
			fakeSocket(owner.id),
			{ sessionId: s.id, mediaRef: "999999999" },
			() => {}
		)
		expect(none.error).toMatch(/not an image/)
		expect(await backdropOf(s.id)).toBe(ours.id)
	})
})

describe("3 · published for enabled-when", () => {
	test("backdrop.set and backdrop.mediaId follow the pointer", async () => {
		const owner = await user()
		const s = await session(owner.id)
		const { publishedBackdrop } = await import(
			"$lib/server/sessions/backdrop"
		)
		expect(await publishedBackdrop(testDb as any, s.id)).toEqual({
			set: false,
			mediaId: null
		})
		const pic = await file(owner.id, { sessionId: s.id })
		await testDb
			.update(schema.sessions)
			.set({ backdropMediaId: pic.id })
			.where(eq(schema.sessions.id, s.id))
		expect(await publishedBackdrop(testDb as any, s.id)).toEqual({
			set: true,
			mediaId: pic.id
		})
	})
})
