/**
 * The composer's attachment requests — core's own composer only; the page
 * uploads, the widget never touches a socket.
 */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import {
	answerAttachFiles,
	answerRemoveAttachment,
	answerRemoveTrayItem
} from "./attachments"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

function tray() {
	const did: string[] = []
	return {
		did,
		deps: {
			attach: (files: File[]) => did.push(`attach ${files.map((f) => f.name).join(",")}`),
			remove: (id: string) => did.push(`remove tray ${id}`),
			removeFromMessage: (m: number, p: number) => did.push(`remove ${m}/${p}`)
		}
	}
}

const file = (name: string) => new File(["x"], name, { type: "text/plain" })

describe("attachment requests", () => {
	test("attach-files hands the files to the tray, in order", () => {
		const { did, deps } = tray()
		answerAttachFiles({ files: [file("a.md"), file("b.txt")] }, deps)
		expect(did).toEqual(["attach a.md,b.txt"])
	})

	test("attach-files refuses no files, or anything that is not a file", () => {
		const { did, deps } = tray()
		expect(() => answerAttachFiles({ files: [] }, deps)).toThrow("no files to attach")
		expect(() => answerAttachFiles({ files: ["a.md"] }, deps)).toThrow(
			"only files can be attached"
		)
		expect(did).toEqual([])
	})

	test("remove-tray-item and remove-attachment name what they act on", () => {
		const { did, deps } = tray()
		answerRemoveTrayItem({ trayItemId: "t1" }, deps)
		answerRemoveAttachment({ messageId: 4, partId: 9 }, deps)
		expect(() => answerRemoveTrayItem({}, deps)).toThrow("no attachment named")
		expect(() => answerRemoveAttachment({ messageId: "4", partId: 9 }, deps)).toThrow(
			"no attachment named"
		)
		expect(did).toEqual(["remove tray t1", "remove 4/9"])
	})

	test("core only: a plugin's widget is refused in words and nothing uploads", async () => {
		for (const kind of ["attach-files", "remove-tray-item", "remove-attachment"] as const)
			expect(WIDGET_REQUEST_ASKERS[kind]).toBe("core")
		const { did, deps } = tray()
		const ask = guardWidgetRequests((async (_k: string, p: unknown) =>
			answerAttachFiles(p, deps)) as WidgetRequestHandler)
		await expect(
			ask("attach-files", { files: [file("a.md")] }, { widgetId: "acme:x", owner: "acme" })
		).rejects.toThrow("only core's own widgets ask 'attach-files'")
		expect(did).toEqual([])
	})
})
