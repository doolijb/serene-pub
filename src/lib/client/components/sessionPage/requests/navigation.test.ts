import { describe, expect, test, vi } from "vitest"

const opened: number[] = []
vi.mock("$lib/client/shell/openJumpHit", () => ({
	openSessionPage: async (_c: unknown, id: number) => void opened.push(id)
}))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({ useTypedSocket: () => ({ emit() {} }) }))
vi.mock("$lib/client/utils/awaitReply", () => ({ awaitReply: vi.fn() }))

import {
	answerCreateSession,
	answerDeleteSession,
	answerOpenSession,
	answerOpenSessions
} from "./navigation"

function setup(row: any = { id: 5, userId: 1, genreId: "acme:genre/x" }) {
	const panels: any = { digest: {}, calls: [] as any[], openPanel(a: any) { this.calls.push(a) } }
	return {
		panels,
		deps: {
			panelsCtx: panels,
			viewerId: () => 1,
			readSession: async () => row,
			readGenreFieldKeys: async (id: string) => (id === "acme:genre/x" ? ["a", "b"] : null),
			readGenreIds: async () => ["acme:genre/x", "acme:genre/y", "core:genre/story", "other:genre/z"]
		}
	}
}
const from = { owner: "acme" }

describe("open-session", () => {
	test("opens an accessible session", async () => {
		opened.length = 0
		const { deps } = setup()
		await answerOpenSession({ sessionId: 5 }, from, deps)
		expect(opened).toEqual([5])
	})
	test("refuses when the server says no", async () => {
		const { deps } = setup(null)
		await expect(answerOpenSession({ sessionId: 5 }, from, deps)).rejects.toThrow("That session cannot be opened.")
	})
})

describe("open-sessions", () => {
	test("none given: all of the plugin's genres", async () => {
		const { deps, panels } = setup()
		await answerOpenSessions({}, from, deps)
		expect(panels.digest.sessionsGenres).toEqual(["acme:genre/x", "acme:genre/y"])
		expect(panels.calls).toEqual([{ key: "sessions", toggle: false }])
	})
	test("a foreign or core genre is refused", async () => {
		const { deps } = setup()
		await expect(answerOpenSessions({ genre: "core:genre/story" }, from, deps)).rejects.toThrow(
			"'core:genre/story' is not one of this package's genres."
		)
		await expect(answerOpenSessions({ genre: "other:genre/z" }, from, deps)).rejects.toThrow()
	})
})

describe("create-session", () => {
	test("sets the digest, creates nothing", async () => {
		const { deps, panels } = setup()
		await answerCreateSession({ genre: "acme:genre/x", fields: { a: 1 }, lorebookId: 3 }, from, deps)
		expect(panels.digest.createSession).toEqual({
			genreId: "acme:genre/x",
			fields: { a: 1 },
			lorebookId: 3,
			fromApplet: "acme"
		})
		expect(panels.calls).toHaveLength(1)
	})
	test("refuses foreign genres, non-object and oversize fields", async () => {
		const { deps } = setup()
		await expect(answerCreateSession({ genre: "other:genre/z" }, from, deps)).rejects.toThrow()
		await expect(answerCreateSession({ genre: "acme:genre/x", fields: [1] as any }, from, deps)).rejects.toThrow()
		await expect(
			answerCreateSession({ genre: "acme:genre/x", fields: { big: "x".repeat(70_000) } }, from, deps)
		).rejects.toThrow("too large")
	})
})

describe("create-session: fields are checked at the request (★48)", () => {
	test("an undeclared key is refused with the server's sentence; nothing is written or opened", async () => {
		const { deps, panels } = setup()
		await expect(
			answerCreateSession({ genre: "acme:genre/x", fields: { a: 1, nope: 2 } }, from, deps)
		).rejects.toThrow("'nope' is not a field of the genre 'acme:genre/x'.")
		expect(panels.digest.createSession).toBeUndefined()
		expect(panels.calls).toEqual([])
	})
	test("declared keys pass", async () => {
		const { deps, panels } = setup()
		await answerCreateSession({ genre: "acme:genre/x", fields: { a: 1, b: 2 } }, from, deps)
		expect(panels.digest.createSession.fields).toEqual({ a: 1, b: 2 })
		expect(panels.calls).toHaveLength(1)
	})
	test("no fields: no key read at all", async () => {
		const { deps } = setup()
		const readGenreFieldKeys = vi.fn(async () => ["a"])
		await answerCreateSession({ genre: "acme:genre/x" }, from, { ...deps, readGenreFieldKeys })
		expect(readGenreFieldKeys).not.toHaveBeenCalled()
	})
	test("an unknown genre refuses its first key", async () => {
		const { deps, panels } = setup()
		await expect(
			answerCreateSession({ genre: "acme:genre/unknown", fields: { a: 1 } }, from, deps)
		).rejects.toThrow("'a' is not a field of the genre 'acme:genre/unknown'.")
		expect(panels.calls).toEqual([])
	})
})

describe("create-session: the persona draft (M3b)", () => {
	const g = "acme:genre/x"
	const run = (persona: any) => {
		const { deps, panels } = setup()
		return { panels, result: answerCreateSession({ genre: g, persona }, from, deps) }
	}
	const refused = async (persona: any, sentence: string) => {
		const { panels, result } = run(persona)
		await expect(result).rejects.toThrow(sentence)
		expect(panels.digest.createSession).toBeUndefined()
		expect(panels.calls).toEqual([])
	}
	test("null, a non-object and an array are refused", async () => {
		for (const bad of [null, "Mia", 3, true, [{ name: "Mia" }]])
			await refused(bad, "The persona must be an object with a name.")
	})
	test("a cyclic object is refused as not plain JSON", async () => {
		const cyclic: any = { name: "Mia" }
		cyclic.self = cyclic
		await refused(cyclic, "The persona must be plain JSON.")
	})
	test("a missing, non-text or blank name is refused", async () => {
		await refused({}, "The persona needs a name.")
		await refused({ name: 5 }, "The persona needs a name.")
		await refused({ name: "   " }, "The persona needs a name.")
	})
	test("the name: exactly 80 characters after trim passes, 81 refuses", async () => {
		const ok = run({ name: `  ${"n".repeat(80)}  ` })
		await ok.result
		expect(ok.panels.digest.createSession.persona).toEqual({ name: "n".repeat(80) })
		await refused({ name: "n".repeat(81) }, "The persona's name is longer than 80 characters.")
		await refused({ name: ` ${"n".repeat(81)} ` }, "The persona's name is longer than 80 characters.")
	})
	test("a non-text description is refused", async () => {
		await refused({ name: "Mia", description: 5 }, "The persona's description must be text.")
		await refused({ name: "Mia", description: null }, "The persona's description must be text.")
	})
	test("the description: exactly 2,000 characters after trim passes, 2,001 refuses", async () => {
		const ok = run({ name: "Mia", description: `\n${"d".repeat(2000)}\n` })
		await ok.result
		expect(ok.panels.digest.createSession.persona).toEqual({ name: "Mia", description: "d".repeat(2000) })
		await refused(
			{ name: "Mia", description: "d".repeat(2001) },
			"The persona's description is longer than 2,000 characters."
		)
	})
	test("name and description are trimmed", async () => {
		const { result, panels } = run({ name: "  Mia ", description: "  A cartographer.  " })
		await result
		expect(panels.digest.createSession.persona).toEqual({ name: "Mia", description: "A cartographer." })
	})
	test("an empty description is dropped", async () => {
		for (const description of ["", "   "]) {
			const { result, panels } = run({ name: "Mia", description })
			await result
			expect(panels.digest.createSession.persona).toEqual({ name: "Mia" })
			expect("description" in panels.digest.createSession.persona).toBe(false)
		}
	})
	test("other keys are not passed", async () => {
		const { result, panels } = run({ name: "Mia", description: "x", isPersona: true, id: 9 })
		await result
		expect(Object.keys(panels.digest.createSession.persona).sort()).toEqual(["description", "name"])
	})
	test("the draft sits beside fields, the lorebook and the applet; nothing is created", async () => {
		const { deps, panels } = setup()
		await answerCreateSession({ genre: g, fields: { a: 1 }, lorebookId: 3, persona: { name: "Mia" } }, from, deps)
		expect(panels.digest.createSession).toEqual({
			genreId: g,
			fields: { a: 1 },
			lorebookId: 3,
			persona: { name: "Mia" },
			fromApplet: "acme"
		})
		expect(panels.calls).toHaveLength(1)
	})
	test("absent persona: no persona key", async () => {
		const { deps, panels } = setup()
		await answerCreateSession({ genre: g }, from, deps)
		expect("persona" in panels.digest.createSession).toBe(false)
	})
})

describe("delete-session", () => {
	test("own session of the plugin's genre sets the digest", async () => {
		const { deps, panels } = setup()
		await answerDeleteSession({ sessionId: 5 }, from, deps)
		expect(panels.digest.deleteSessionId).toBe(5)
		expect(panels.digest.deleteSessionFromApplet).toBe("acme")
	})
	test("refuses someone else's, a foreign genre, an unreadable session", async () => {
		await expect(answerDeleteSession({ sessionId: 5 }, from, setup({ id: 5, userId: 2, genreId: "acme:genre/x" }).deps)).rejects.toThrow("own sessions")
		await expect(answerDeleteSession({ sessionId: 5 }, from, setup({ id: 5, userId: 1, genreId: "core:genre/story" }).deps)).rejects.toThrow("genres")
		await expect(answerDeleteSession({ sessionId: 5 }, from, setup(null).deps)).rejects.toThrow("cannot be opened")
	})
})
