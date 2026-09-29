/** `inspect-run` opens the run that wrote a line — for admins only. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerInspectRun } from "./inspectRun"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

function page(isAdmin = true) {
	const opened: string[] = []
	const looked: number[] = []
	return {
		opened,
		looked,
		deps: {
			isAdmin,
			runOfMessage: async (id: number) => (looked.push(id), id === 1 ? "run-1" : null),
			openRun: (runId: string) => opened.push(runId)
		}
	}
}

describe("answerInspectRun", () => {
	test("opens the run recorded as writing the line", async () => {
		const { opened, deps } = page()
		await answerInspectRun({ messageId: 1 }, deps)
		expect(opened).toEqual(["run-1"])
	})

	test("refuses a viewer who is not an admin, in words, before looking anything up", async () => {
		const { opened, looked, deps } = page(false)
		await expect(answerInspectRun({ messageId: 1 }, deps)).rejects.toThrow("runs are for admins")
		expect(looked).toEqual([])
		expect(opened).toEqual([])
	})

	test("refuses a line no run wrote, in words", async () => {
		const { opened, deps } = page()
		await expect(answerInspectRun({ messageId: 2 }, deps)).rejects.toThrow(
			"no run is recorded as writing that message"
		)
		expect(opened).toEqual([])
	})

	test("anyone may ask: a plugin's widget passes the askers guard", async () => {
		expect(WIDGET_REQUEST_ASKERS["inspect-run"]).toBe("any")
		const { opened, deps } = page()
		const ask = guardWidgetRequests((async (_k: string, p: unknown) => answerInspectRun(p, deps)) as WidgetRequestHandler)
		await ask("inspect-run", { messageId: 1 }, { widgetId: "acme:x", owner: "acme" })
		expect(opened).toEqual(["run-1"])
	})
})
