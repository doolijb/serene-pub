/**
 * Regenerate the last turn, confirmed (lair pass R2, owner 2026-09-28):
 * the dialog names the rows the server's preview listed; its "Don't ask
 * again for this session" checkbox writes core's annex field; and once the
 * viewer's annex view carries it, the next press skips the dialog.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import RetakeConfirm from "./RetakeConfirm.svelte"
import { createRetake, retakeQuietly, type RetakeRow } from "./retake"

const ROWS: RetakeRow[] = [
	{ messageId: 11, channel: "main", characterId: null, name: "the narrator" },
	{ messageId: 12, channel: "main", characterId: 1, name: "Brannoc" },
	{ messageId: 13, channel: "main", characterId: 2, name: "Vell" }
]

let apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps) unmount(app)
	apps = []
	document.body.innerHTML = ""
})

async function openDialog(onConfirm: (quietly: boolean) => void) {
	const host = document.createElement("div")
	document.body.append(host)
	apps.push(
		mount(RetakeConfirm, {
			target: host,
			props: { open: true, rows: ROWS, onConfirm, onCancel: () => {} }
		})
	)
	flushSync()
	await tick()
}

const button = (name: string) =>
	[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === name)

describe("RetakeConfirm", () => {
	test("is a titled dialog that names every row of the last turn", async () => {
		await openDialog(() => {})
		const dialog = document.querySelector("[role=alertdialog]")
		expect(dialog).not.toBeNull()
		expect(document.body.textContent).toContain("Regenerate the last turn?")
		expect(document.querySelector("[data-retake-rows]")?.textContent?.trim()).toBe(
			"This deletes and rewrites: the narrator, Brannoc, and Vell."
		)
	})

	test("the checkbox rides on Regenerate", async () => {
		const confirmed: boolean[] = []
		await openDialog((q) => confirmed.push(q))
		button("Regenerate")!.click()
		const box = document.querySelector<HTMLInputElement>("[data-retake-quietly]")!
		box.click()
		flushSync()
		button("Regenerate")!.click()
		expect(confirmed).toEqual([false, true])
	})
})

describe("the press: preview, ask, and 'don't ask again'", () => {
	test("the checkbox writes the annex, and the next press skips the dialog", async () => {
		const sent: Sockets.Sessions.RetakeTurn.Params[] = []
		const annexWrites: boolean[] = []
		let annex: Record<string, Record<string, unknown>> = {}
		let asked: RetakeRow[] | null = null
		const retake = createRetake({
			sessionId: () => 7,
			quiet: () => retakeQuietly(annex),
			send: (p) => sent.push(p),
			setQuiet: (value) => {
				annexWrites.push(value)
				// The server's annex push, as the page hears it.
				annex = { core: { "retake-quietly": value } }
			},
			ask: (rows) => (asked = rows)
		})

		// First press: a preview, and the dialog names its rows.
		retake.press()
		expect(sent).toEqual([{ sessionId: 7, preview: true }])
		expect(retake.hear({ sessionId: 7, ok: true, preview: true, rows: ROWS })).toBe(true)
		expect(asked).toEqual(ROWS)

		// Confirmed with the box ticked: the annex is written, then the retake.
		await openDialog((quietly) => retake.confirm(quietly))
		document.querySelector<HTMLInputElement>("[data-retake-quietly]")!.click()
		flushSync()
		button("Regenerate")!.click()
		expect(annexWrites).toEqual([true])
		expect(sent.at(-1)).toEqual({ sessionId: 7 })

		// The next press: no preview, no dialog.
		asked = null
		const before = sent.length
		retake.press()
		expect(sent.slice(before)).toEqual([{ sessionId: 7 }])
		expect(asked).toBeNull()
	})

	test("a row's ⋮ Regenerate: the whole turn when the row is one of several, else the row", () => {
		const sent: Sockets.Sessions.RetakeTurn.Params[] = []
		let asked: RetakeRow[] | null = null
		let rowRegenerated = 0
		const retake = createRetake({
			sessionId: () => 7,
			quiet: () => false,
			send: (p) => sent.push(p),
			setQuiet: () => {},
			ask: (rows) => (asked = rows)
		})
		retake.pressRow(11, () => rowRegenerated++)
		retake.hear({ sessionId: 7, ok: true, preview: true, rows: ROWS })
		expect(asked).toEqual(ROWS)
		expect(rowRegenerated).toBe(0)

		// A one-row turn (a narration) keeps its row regenerate.
		asked = null
		retake.pressRow(21, () => rowRegenerated++)
		retake.hear({ sessionId: 7, ok: true, preview: true, rows: [{ ...ROWS[0]!, messageId: 21 }] })
		expect(asked).toBeNull()
		expect(rowRegenerated).toBe(1)
	})
})

describe("On revision's sentence (PLAN-rulesets §28)", () => {
	test("the preview's revision sentence reaches the ask, and the dialog says it", async () => {
		let said: string | null = null
		const retake = createRetake({
			sessionId: () => 7,
			quiet: () => false,
			send: () => {},
			setQuiet: () => {},
			ask: (_rows, revision) => (said = revision)
		})
		retake.press()
		retake.hear({
			sessionId: 7,
			ok: true,
			preview: true,
			rows: ROWS,
			revision: { mode: "overwrite", turns: 3, sentence: "This will overwrite the last 3 turns." }
		})
		expect(said).toBe("This will overwrite the last 3 turns.")

		const host = document.createElement("div")
		document.body.append(host)
		apps.push(
			mount(RetakeConfirm, {
				target: host,
				props: { open: true, rows: ROWS, revision: said, onConfirm: () => {}, onCancel: () => {} }
			})
		)
		flushSync()
		await tick()
		expect(document.querySelector("[data-revision-sentence]")?.textContent?.trim()).toBe(
			"This will overwrite the last 3 turns."
		)
	})

	test("the delete confirmation shows the server's sentence, and nothing without one", async () => {
		const { default: DeleteMessageDialog } = await import("./DeleteMessageDialog.svelte")
		const host = document.createElement("div")
		document.body.append(host)
		apps.push(
			mount(DeleteMessageDialog, {
				target: host,
				props: {
					open: true,
					onOpenChange: () => {},
					onConfirm: () => {},
					onCancel: () => {},
					revision: "This will branch here; the old turns stay on the old branch."
				}
			})
		)
		flushSync()
		await tick()
		expect(document.querySelector("[data-revision-sentence]")?.textContent?.trim()).toBe(
			"This will branch here; the old turns stay on the old branch."
		)
		// One sentence per mode: the plain delete's "no undo" never sits beside a branch.
		expect(document.body.textContent).not.toContain("There is no undo")
		for (const app of apps.splice(0)) unmount(app)
		document.body.innerHTML = ""
		const bare = document.createElement("div")
		document.body.append(bare)
		apps.push(
			mount(DeleteMessageDialog, {
				target: bare,
				props: { open: true, onOpenChange: () => {}, onConfirm: () => {}, onCancel: () => {} }
			})
		)
		flushSync()
		await tick()
		expect(document.body.textContent).toContain("Delete this message?")
		expect(document.querySelector("[data-revision-sentence]")).toBeNull()
		expect(document.body.textContent).toContain("There is no undo.")
	})
})
