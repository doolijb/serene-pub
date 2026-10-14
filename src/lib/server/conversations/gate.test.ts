/**
 * The attachment gate (PLAN-private-messages §5) over fixtures: each kind ×
 * every member passes / some are blocked / the subject is gone, and the card
 * a reader is handed in each case. The access helpers are mocked — the gate
 * is pure over them — and `db` is a fake that answers per table.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"

const h = vi.hoisted(() => ({
	session: vi.fn(async (_s: number, _u: number) => ({
		isOwner: false,
		isGuest: false,
		hasAccess: false
	})),
	character: vi.fn(async (_c: number, _u: number) => false),
	lorebook: vi.fn(async (_l: number, _u: number, _o?: unknown) => false),
	media: vi.fn(async (_f: unknown, _u: number, _db?: unknown) => false)
}))

vi.mock("$lib/server/db", () => ({ db: {} }))
vi.mock("$lib/server/utils/sessionAccess", () => ({
	checkSessionAccess: h.session,
	canViewCharacter: h.character
}))
vi.mock("$lib/server/utils/ownedBook", () => ({ canViewLorebook: h.lorebook }))
vi.mock("$lib/server/media/access", () => ({ canViewMedia: h.media }))
vi.mock("$lib/server/pipelines/entities/sessionGenres", () => ({
	getSessionGenre: async () => ({ name: "Adventure" })
}))

import { attachmentCardFor, canAttach, joinNames } from "./gate"

/** A fake db: every query against `table` resolves to `rows.get(table)`. */
function fakeDb(rows: Map<unknown, unknown[]>): Db {
	const chain = (table?: unknown): any => {
		const c: any = {
			from: (t: unknown) => chain(t),
			where: () => c,
			limit: () => c,
			leftJoin: () => c,
			innerJoin: () => c,
			orderBy: () => c,
			then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
				Promise.resolve(rows.get(table) ?? []).then(ok, bad)
		}
		return c
	}
	return { select: () => chain() } as unknown as Db
}

const fileRow = {
	id: 9,
	uuid: "u-9",
	rev: 2,
	kind: "image",
	filename: "map.png",
	displayMime: "image/png",
	displayBytes: 1_258_291,
	userId: 1
}

beforeEach(() => {
	for (const fn of Object.values(h)) fn.mockReset()
	h.session.mockResolvedValue({ isOwner: false, isGuest: false, hasAccess: false })
	h.character.mockResolvedValue(false)
	h.lorebook.mockResolvedValue(false)
	h.media.mockResolvedValue(false)
})

describe("canAttach", () => {
	test("session: every member a guest or owner passes", async () => {
		const db = fakeDb(new Map([[schema.sessions, [{ id: 4 }]]]))
		h.session.mockResolvedValue({ isOwner: false, isGuest: true, hasAccess: true })
		expect(await canAttach("session", 4, [1, 2, 3], db)).toEqual({ ok: true })
		expect(h.session).toHaveBeenCalledTimes(3)
	})

	test("session: names the members who are not guests, in order", async () => {
		const db = fakeDb(new Map([[schema.sessions, [{ id: 4 }]]]))
		h.session.mockImplementation(async (_s, u) => ({
			isOwner: u === 1,
			isGuest: false,
			hasAccess: u === 1
		}))
		expect(await canAttach("session", 4, [1, 3, 2], db)).toEqual({
			ok: false,
			blockedBy: [3, 2]
		})
	})

	test("session: a deleted session is gone for everyone", async () => {
		const db = fakeDb(new Map())
		expect(await canAttach("session", 4, [1, 2], db)).toEqual({
			ok: false,
			blockedBy: [1, 2],
			gone: true
		})
		expect(h.session).not.toHaveBeenCalled()
	})

	test("character: the owner passes without asking; others through canViewCharacter", async () => {
		const db = fakeDb(new Map([[schema.characters, [{ id: 7, userId: 1 }]]]))
		h.character.mockImplementation(async (_c, u) => u === 2)
		expect(await canAttach("character", 7, [1, 2, 3], db)).toEqual({
			ok: false,
			blockedBy: [3]
		})
		expect(h.character).toHaveBeenCalledTimes(2)
	})

	test("lorebook: shared with every member passes", async () => {
		const db = fakeDb(new Map([[schema.lorebooks, [{ id: 5 }]]]))
		h.lorebook.mockResolvedValue(true)
		expect(await canAttach("lorebook", 5, [1, 2], db)).toEqual({ ok: true })
	})

	test("lorebook: not shared blocks", async () => {
		const db = fakeDb(new Map([[schema.lorebooks, [{ id: 5 }]]]))
		h.lorebook.mockImplementation(async (_l, u) => u === 1)
		expect(await canAttach("lorebook", 5, [1, 2], db)).toEqual({
			ok: false,
			blockedBy: [2]
		})
	})

	test("file: asks canViewMedia with the file row", async () => {
		const db = fakeDb(new Map([[schema.files, [fileRow]]]))
		h.media.mockImplementation(async (_f, u) => u !== 2)
		expect(await canAttach("file", 9, [1, 2], db)).toEqual({
			ok: false,
			blockedBy: [2]
		})
		expect(h.media.mock.calls[0][0]).toBe(fileRow)
	})

	test("file: a missing file is gone", async () => {
		expect(await canAttach("file", 9, [1], fakeDb(new Map()))).toEqual({
			ok: false,
			blockedBy: [1],
			gone: true
		})
	})

	test("an unknown kind is gone, never a pass", async () => {
		expect(
			await canAttach("widget" as any, 1, [1], fakeDb(new Map()))
		).toMatchObject({ ok: false, gone: true })
	})
})

describe("attachmentCardFor", () => {
	test("a reader who cannot see it gets not-shared", async () => {
		const db = fakeDb(new Map([[schema.lorebooks, [{ id: 5, name: "Atlas" }]]]))
		expect(await attachmentCardFor("lorebook", 5, 2, db, 31)).toEqual({
			id: 31,
			kind: "lorebook",
			subjectId: 5,
			available: false,
			unavailableWhy: "not-shared"
		})
	})

	test("a deleted subject is gone", async () => {
		expect(await attachmentCardFor("character", 7, 2, fakeDb(new Map()), 3)).toMatchObject({
			available: false,
			unavailableWhy: "gone"
		})
	})

	test("lorebook card: name and entry count", async () => {
		const db = fakeDb(
			new Map<unknown, unknown[]>([
				[schema.lorebooks, [{ id: 5, name: "Atlas" }]],
				[schema.lorebookEntries, [{ n: 12 }]]
			])
		)
		h.lorebook.mockResolvedValue(true)
		expect(await attachmentCardFor("lorebook", 5, 2, db, 31)).toEqual({
			id: 31,
			kind: "lorebook",
			subjectId: 5,
			available: true,
			title: "Atlas",
			subtitle: "12 entries"
		})
	})

	test("character card: nickname, excerpt, thumb avatar, persona flag", async () => {
		const db = fakeDb(
			new Map([
				[
					schema.characters,
					[
						{
							id: 7,
							userId: 2,
							name: "Nia Vance",
							nickname: "Nia",
							description: "A  cartographer\nof storms.",
							isPersona: true,
							uuid: "a-1",
							rev: 4
						}
					]
				]
			])
		)
		expect(await attachmentCardFor("character", 7, 2, db, 1)).toEqual({
			id: 1,
			kind: "character",
			subjectId: 7,
			available: true,
			title: "Nia",
			subtitle: "A cartographer of storms.",
			avatarSrc: "/media/a-1?v=thumb&r=4",
			isPersona: true
		})
	})

	test("session card: title, genre and up to three faces", async () => {
		const db = fakeDb(
			new Map<unknown, unknown[]>([
				[schema.sessions, [{ id: 4, name: "The Long Night", genreId: "g" }]],
				[
					schema.sessionCharacters,
					[
						{ name: "A", nickname: null, uuid: "x", rev: 1 },
						{ name: "B", nickname: "Bee", uuid: null, rev: null },
						{ name: "C", nickname: null, uuid: null, rev: null },
						{ name: "D", nickname: null, uuid: null, rev: null }
					]
				]
			])
		)
		h.session.mockResolvedValue({ isOwner: true, isGuest: false, hasAccess: true })
		expect(await attachmentCardFor("session", 4, 1, db, 2)).toEqual({
			id: 2,
			kind: "session",
			subjectId: 4,
			available: true,
			title: "The Long Night",
			subtitle: "Adventure",
			faces: [
				{ name: "A", src: "/media/x?v=thumb&r=1" },
				{ name: "Bee", src: null },
				{ name: "C", src: null }
			]
		})
	})

	test("file card: display and thumb variants, size label", async () => {
		const db = fakeDb(new Map([[schema.files, [fileRow]]]))
		h.media.mockResolvedValue(true)
		expect(await attachmentCardFor("file", 9, 1, db, 8)).toEqual({
			id: 8,
			kind: "file",
			subjectId: 9,
			available: true,
			title: "map.png",
			subtitle: "PNG · 1.2 MB",
			src: "/media/u-9?r=2",
			thumbSrc: "/media/u-9?v=thumb&r=2",
			mime: "image/png",
			bytes: 1_258_291,
			isImage: true
		})
	})
})

test("joinNames reads as a sentence", () => {
	expect(joinNames(["Nia"])).toBe("Nia")
	expect(joinNames(["Nia", "Tomas"])).toBe("Nia and Tomas")
	expect(joinNames(["Nia", "Tomas", "Ash"])).toBe("Nia, Tomas and Ash")
})
