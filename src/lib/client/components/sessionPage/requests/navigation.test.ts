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
