/**
 * 🚧 A **line-bound run** (speech polish, owner ruling 2026-10-29): speaking
 * one line — `core:spec/speak-message` — shows on that line only (its heading
 * Stop, its strip's *Speaking…*). One server-side marker says so, so no
 * reader matches a spec id: the registry holds it (`RunHandle.lineBound`,
 * decided once by `fireAction`), every `sessions:runStatus` frame carries it
 * and never a `reply` (the page's waiting row, and through it the turn line
 * and the composer's Stop), and the session list's status leaves the run out.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StatusText } from "@serene-pub/sdk"

vi.mock("$lib/server/db", () => ({ db: {} }))
const frames: Array<{ event: string; data: any }> = []
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	broadcastToSessionUsers: async (_io: unknown, _sessionId: number, event: string, data: any) => {
		frames.push({ event, data })
	}
}))

const { createStatusRelay } = await import("./runStatus")
const { start, finish, runLineBoundOf, statusesBySession, _reset } = await import("./runRegistry")

const say = (en: string): StatusText => ({ i18n: { en } })

function relay(runId: string, extra: { lineBound?: boolean; reply?: { channel: string } }) {
	return createStatusRelay({
		db: {} as any,
		io: {} as any,
		sessionId: 5,
		runId,
		kind: extra.lineBound ? "maintenance" : "reply",
		live: { status: async () => {} } as any,
		...extra
	})
}

beforeEach(() => {
	frames.length = 0
	_reset()
})

describe("a line-bound run's status frames", () => {
	it("say lineBound on every frame, the end frame too, and never carry reply", async () => {
		const r = relay("speak-1", { lineBound: true, reply: { channel: "main" } })
		r.set("speak", say("Speaking"))
		await r.end()
		const runStatus = frames.filter((f) => f.event === "sessions:runStatus")
		expect(runStatus.map((f) => f.data.status)).toEqual([say("Speaking"), null])
		for (const f of runStatus) {
			expect(f.data.lineBound).toBe(true)
			expect(f.data).not.toHaveProperty("reply")
			expect(f.data.kind).toBe("maintenance")
		}
	})

	it("a reply's frames carry its channel and no lineBound", async () => {
		const r = relay("reply-1", { reply: { channel: "main" } })
		r.set("generate", say("Wren is typing"))
		await r.end()
		const runStatus = frames.filter((f) => f.event === "sessions:runStatus")
		expect(runStatus).toHaveLength(2)
		for (const f of runStatus) {
			expect(f.data.reply).toEqual({ channel: "main" })
			expect(f.data).not.toHaveProperty("lineBound")
		}
	})
})

describe("the registry's line-bound mark", () => {
	it("is read back by run id, false for any other run", () => {
		start({ runId: "speak-2", userId: 1, sessionId: 5, kind: "maintenance", lineBound: true })
		start({ runId: "reply-2", userId: 1, sessionId: 5, kind: "reply" })
		expect(runLineBoundOf("speak-2")).toBe(true)
		expect(runLineBoundOf("reply-2")).toBe(false)
		expect(runLineBoundOf("nobody")).toBe(false)
		finish("speak-2")
		expect(runLineBoundOf("speak-2")).toBe(false)
	})

	it("the session list's status leaves a line-bound run out, even the newest", async () => {
		start({ runId: "reply-3", userId: 1, sessionId: 5, kind: "reply" })
		const reply = relay("reply-3", { reply: { channel: "main" } })
		reply.set("generate", say("Wren is typing"))
		await new Promise((r) => setTimeout(r, 0))
		await new Promise((r) => setTimeout(r, 5))
		start({ runId: "speak-3", userId: 1, sessionId: 5, kind: "maintenance", lineBound: true })
		const speak = relay("speak-3", { lineBound: true })
		speak.set("speak", say("Speaking"))
		await new Promise((r) => setTimeout(r, 0))
		expect(statusesBySession().get(5)).toEqual(say("Wren is typing"))
		await speak.end()
		await reply.end()
		expect(statusesBySession().has(5)).toBe(false)
	})
})
