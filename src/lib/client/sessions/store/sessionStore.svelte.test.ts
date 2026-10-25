import { describe, expect, it } from "vitest"
import { createSessionStore } from "./sessionStore.svelte"

const card = (id: number, extra: Record<string, unknown> = {}) => ({ id, name: `C${id}`, ...extra }) as any
const row = (id: number, extra: Record<string, unknown> = {}) =>
	({ id, sessionId: 1, channel: "main", content: `m${id}`, ...extra }) as any
const pag = { hasMore: true, olderIn: [] } as any

function payload(id = 1, rows = [row(2), row(1)], extra: Record<string, unknown> = {}) {
	return {
		id,
		name: "S",
		sessionMessages: rows,
		sessionCharacters: [{ sessionId: id, characterId: 10, character: card(10) }],
		sessionPersonas: [{ sessionId: id, personaId: 11, persona: card(11) }],
		...extra
	} as any
}

function opened(rows?: any[]) {
	const s = createSessionStore()
	s.open(1)
	s.load(payload(1, rows), pag)
	return s
}

describe("open / load", () => {
	it("ignores a load for a session that is not open", () => {
		const s = createSessionStore()
		expect(s.load(payload(1), pag)).toBe(false)
		s.open(2)
		expect(s.load(payload(1), pag)).toBe(false)
		expect(s.session(1)).toBeUndefined()
	})

	it("loads rows ascending with the window's pagination", () => {
		const s = opened()
		expect(s.session(1)?.name).toBe("S")
		expect(s.messagesOf(1).map((m) => m.id)).toEqual([1, 2])
		expect(s.windowOf(1)?.pagination).toEqual(pag)
		expect(s.castOf(1)?.sessionCharacters[0].character?.id).toBe(10)
	})

	it("drops rows the reload no longer holds", () => {
		const s = opened()
		s.load(payload(1, [row(2)]), pag)
		expect(s.messagesOf(1).map((m) => m.id)).toEqual([2])
	})

	it("opening another session drops every record", () => {
		const s = opened()
		s.mergeSceneList({ sessionId: 1, sceneList: [{ id: 5, sessionId: 1 }] } as any)
		s.mergeScenedMessageIds({ sessionId: 1, scenedMessageIds: [1] } as any)
		s.mergeRunStatus({ sessionId: 1, runId: "r", kind: "reply", status: "x" } as any)
		s.mergeGenreOf({ sessionId: 1, genre: { name: "G" } } as any)
		s.open(2)
		expect(s.openSessionId).toBe(2)
		expect(s.session(1)).toBeUndefined()
		expect(s.messagesOf(1)).toEqual([])
		expect(s.windowOf(1)).toBeUndefined()
		expect(s.castOf(1)).toBeUndefined()
		expect(s.scenesOf(1)).toEqual([])
		expect(s.scenedOf(1)).toEqual([])
		expect(s.runsOf(1)).toEqual([])
		expect(s.genreOf(1)).toBeUndefined()
		s.open(1)
		s.mergeCard(card(10, { name: "x" }))
		expect(s.castOf(1)).toBeUndefined() // cards cleared whole
	})
})

describe("merge", () => {
	it("keeps pagination, replaces a pushed row and drops an absent row at or past coversFromId", () => {
		const s = opened([row(1), row(2), row(3)])
		const added = s.merge({ id: 1, name: "T", sessionMessages: [row(2, { content: "new" }), row(4)] } as any, 2)
		expect(s.session(1)?.name).toBe("T")
		expect(s.windowOf(1)?.pagination).toEqual(pag)
		expect(s.messagesOf(1).map((m) => [m.id, m.content])).toEqual([
			[1, "m1"],
			[2, "new"],
			[4, "m4"]
		])
		expect(added.map((m) => m.id)).toEqual([4])
	})

	it("leaves members alone when the push carries none, and replaces a list it carries", () => {
		const s = opened()
		s.merge({ id: 1, name: "T" } as any, null)
		expect(s.castOf(1)?.sessionCharacters).toHaveLength(1)
		expect(s.messagesOf(1)).toHaveLength(2)
		s.merge(
			{ id: 1, sessionCharacters: [{ sessionId: 1, characterId: 12, character: card(12) }] } as any,
			null
		)
		expect(s.castOf(1)?.sessionCharacters.map((c) => c.characterId)).toEqual([12])
		expect(s.castOf(1)?.sessionPersonas).toHaveLength(1)
	})

	it("does nothing for a session not held", () => {
		const s = opened()
		expect(s.merge({ id: 9, name: "Z" } as any, null)).toEqual([])
		expect(s.session(9)).toBeUndefined()
	})
})

describe("messages", () => {
	it("upsert replaces and returns the previous row", () => {
		const s = opened()
		const r = s.upsertMessage(row(2, { content: "edited" }))
		expect(r?.added).toBe(false)
		expect(r?.previous?.content).toBe("m2")
		expect(s.messagesOf(1).find((m) => m.id === 2)?.content).toBe("edited")
	})

	it("upsert adds in order", () => {
		const s = opened([row(1), row(5)])
		expect(s.upsertMessage(row(3))).toEqual({ added: true })
		expect(s.messagesOf(1).map((m) => m.id)).toEqual([1, 3, 5])
	})

	it("upsert of a row whose session is not held is null", () => {
		const s = opened()
		expect(s.upsertMessage(row(9, { sessionId: 4 }))).toBeNull()
	})

	it("removeMessage drops the row and returns it", () => {
		const s = opened()
		expect(s.removeMessage(1, 2)?.id).toBe(2)
		expect(s.messagesOf(1).map((m) => m.id)).toEqual([1])
		expect(s.removeMessage(1, 99)).toBeUndefined()
		expect(s.removeMessage(4, 1)).toBeUndefined()
	})

	it("prependMessages skips ids already held", () => {
		const s = opened([row(5), row(6)])
		const added = s.prependMessages(1, [row(3), row(5, { content: "dup" }), row(4)])
		expect(added.map((m) => m.id)).toEqual([3, 4])
		expect(s.messagesOf(1).map((m) => m.id)).toEqual([3, 4, 5, 6])
		expect(s.messagesOf(1).find((m) => m.id === 5)?.content).toBe("m5")
		expect(s.prependMessages(9, [row(1)])).toEqual([])
	})

	it("setPagination replaces the window's pagination", () => {
		const s = opened()
		s.setPagination(1, { hasMore: false, olderIn: [] } as any)
		expect(s.windowOf(1)?.pagination?.hasMore).toBe(false)
		expect(s.windowOf(1)?.ids).toEqual([1, 2])
	})
})

describe("patchSession", () => {
	it("patches a held session and writes nothing for an unheld id", () => {
		const s = opened()
		s.patchSession(1, { name: "P" })
		expect(s.session(1)?.name).toBe("P")
		s.patchSession(9, { name: "Q" })
		expect(s.session(9)).toBeUndefined()
	})
})

describe("cards", () => {
	it("mergeCard replaces only a held card, and both seats see it", () => {
		const s = createSessionStore()
		s.open(1)
		s.load(
			payload(1, [], {
				sessionPersonas: [{ sessionId: 1, personaId: 10, persona: card(10) }]
			}),
			pag
		)
		s.mergeCard(card(10, { name: "Renamed" }))
		s.mergeCard(card(77, { name: "Stranger" }))
		const cast = s.castOf(1)!
		expect(cast.sessionCharacters[0].character?.name).toBe("Renamed")
		expect(cast.sessionPersonas[0].persona?.name).toBe("Renamed")
		expect(JSON.stringify(cast).includes("Stranger")).toBe(false)
	})

	it("reviseAvatars re-addresses only the card wearing the changed file", () => {
		const s = createSessionStore()
		s.open(1)
		s.load(
			payload(1, [], {
				sessionCharacters: [
					{ sessionId: 1, characterId: 10, character: card(10, { avatarMediaId: 5, avatarMedia: { uuid: "u", rev: 1 } }) },
					{ sessionId: 1, characterId: 12, character: card(12, { avatarMediaId: 6, avatarMedia: { uuid: "v", rev: 1 } }) }
				]
			}),
			pag
		)
		const before12 = s.castOf(1)!.sessionCharacters[1].character
		s.reviseAvatars({ id: 5, uuid: "u", rev: 2 } as any)
		const cast = s.castOf(1)!
		expect((cast.sessionCharacters[0].character as any).avatarMedia.rev).toBe(2)
		expect(cast.sessionCharacters[1].character === before12).toBe(true)
	})
})

describe("scenes and runs and genre", () => {
	it("mergeSceneList replaces, deletes unlisted, and ignores another session", () => {
		const s = opened()
		s.mergeSceneList({ sessionId: 1, sceneList: [{ id: 5, sessionId: 1 }, { id: 6, sessionId: 1 }] } as any)
		expect(s.scenesOf(1).map((x) => x.id)).toEqual([5, 6])
		s.mergeSceneList({ sessionId: 1, sceneList: [{ id: 6, sessionId: 1, title: "t" }] } as any)
		expect(s.scenesOf(1).map((x) => x.id)).toEqual([6])
		s.mergeSceneList({ sessionId: 2, sceneList: [{ id: 9, sessionId: 2 }] } as any)
		expect(s.scenesOf(1).map((x) => x.id)).toEqual([6])
		expect(s.scenesOf(2)).toEqual([])
	})

	it("mergeScenedMessageIds follows the open session only", () => {
		const s = opened()
		s.mergeScenedMessageIds({ sessionId: 1, scenedMessageIds: [3, 4] } as any)
		s.mergeScenedMessageIds({ sessionId: 2, scenedMessageIds: [9] } as any)
		expect(s.scenedOf(1)).toEqual([3, 4])
		expect(s.scenedOf(2)).toEqual([])
	})

	it("mergeRunStatus sets, deletes on the end frame and ignores another session", () => {
		const s = opened()
		s.mergeRunStatus({ sessionId: 1, runId: "a", kind: "reply", status: "s", reply: { channel: "main" } } as any)
		s.mergeRunStatus({ sessionId: 1, runId: "b", kind: "routine", status: "s" } as any)
		expect(s.runsOf(1).map((r) => [r.runId, r.reply?.channel])).toEqual([
			["a", "main"],
			["b", undefined]
		])
		s.mergeRunStatus({ sessionId: 2, runId: "c", kind: "reply", status: "s" } as any)
		expect(s.runsOf(2)).toEqual([])
		s.mergeRunStatus({ sessionId: 1, runId: "a", kind: "reply", status: null } as any)
		expect(s.runsOf(1).map((r) => r.runId)).toEqual(["b"])
	})

	it("mergeGenreOf goes undefined, then null, then a row", () => {
		const s = opened()
		expect(s.genreOf(1)).toBeUndefined()
		s.mergeGenreOf({ sessionId: 1, genre: null } as any)
		expect(s.genreOf(1)).toBeNull()
		s.mergeGenreOf({ sessionId: 1, genre: { name: "G" } } as any)
		expect(s.genreOf(1)?.name).toBe("G")
		s.mergeGenreOf({ sessionId: 2, genre: { name: "H" } } as any)
		expect(s.genreOf(2)).toBeUndefined()
	})
})
