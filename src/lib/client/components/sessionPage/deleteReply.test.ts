import { describe, expect, test } from "vitest"
import { deleteReplyAction, sessionAddress } from "./deleteReply"

describe("a delete's reply", () => {
	test("a branch moves the page to the branch and leaves this session's rows alone", () => {
		expect(deleteReplyAction({ id: 9, branchedTo: 42 })).toEqual({ kind: "branch", sessionId: 42 })
		expect(sessionAddress(42)).toBe("/sessions/42")
	})
	test("a refusal removes nothing", () => {
		expect(deleteReplyAction({ id: 9, error: "Access denied." })).toEqual({ kind: "refused" })
	})
	test("an ordinary delete drops the row", () => {
		expect(deleteReplyAction({ id: 9 })).toEqual({ kind: "remove", id: 9 })
	})
})
