/**
 * A receipt's reasons are read by people — the run card, the reply row, a
 * summary's failure card, the support report — so a failed query quoted in
 * any of them (drizzle-orm 0.44+: its SQL and every value it bound) becomes
 * the plain sentence before the row is finished or the run is stored.
 */
import { describe, expect, test, vi } from "vitest"
import { DrizzleQueryError } from "drizzle-orm"
import { QUERY_FAILED_SENTENCE } from "$lib/server/db/errors"
import { receiptWithoutQueryText } from "./receipts"

const SECRET = "SECRET-PROSE-k8"
const quoted = new DrizzleQueryError(
	'insert into "session_messages" ("content") values ($1)',
	[SECRET],
	new Error("boom")
).message

describe("receiptWithoutQueryText", () => {
	test("cleans the halt reason, notes, node reasons and script reasons, in place", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const receipt: any = {
				runId: "r1",
				haltReason: `history: ${quoted}`,
				notes: ["kept", `the host's run-end hook failed: ${quoted}`],
				nodes: [
					{
						nodeKey: "history",
						reason: quoted,
						notes: [quoted],
						scripts: [{ reason: `script: ${quoted}` }],
						output: { text: "the reply" }
					},
					{ nodeKey: "save", result: "ok" }
				]
			}
			const out = receiptWithoutQueryText(receipt)
			expect(out).toBe(receipt)
			expect(JSON.stringify(receipt)).not.toMatch(new RegExp(`Failed query|insert into|${SECRET}`))
			expect(receipt.haltReason).toBe(`history: ${QUERY_FAILED_SENTENCE}`)
			expect(receipt.notes[0]).toBe("kept")
			expect(receipt.nodes[0].reason).toBe(QUERY_FAILED_SENTENCE)
			expect(receipt.nodes[1]).toEqual({ nodeKey: "save", result: "ok" })
			// Each original went to the server log.
			expect(warn.mock.calls.some((c) => String(c[1]).includes(SECRET))).toBe(true)
		} finally {
			warn.mockRestore()
		}
	})

	test("a clean receipt is left exactly as it was", () => {
		const receipt: any = { runId: "r2", nodes: [{ nodeKey: "a", reason: "timeout after 3000ms" }] }
		const before = JSON.stringify(receipt)
		receiptWithoutQueryText(receipt)
		expect(JSON.stringify(receipt)).toBe(before)
		expect("haltReason" in receipt).toBe(false)
	})
})
