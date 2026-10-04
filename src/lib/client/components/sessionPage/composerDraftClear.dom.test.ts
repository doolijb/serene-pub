/**
 * Lair pass D1: a press that spends the composer's draft empties core's
 * composer — not just the page's copy — and a reload agrees with it. Since
 * note 31 (2026-10-02) the draft leaves at the press, and a run that is
 * refused or fails gives it back. Since
 * R3 (2026-09-28) no press reads the draft; S2's slash argument is the one
 * that will, so this models its press: the draft's text is what was sent.
 *
 * Core's conversation is the BUILT module, mounted by the SDK's harness in
 * core's box. The page's half is its own helpers, as `+page.svelte` wires
 * them: `draftHolds` on the press, `draftToGiveBack` on the run's
 * answer, `nextDraftWrite` for the write it posts in the dossier
 * (`composer.draft`), and `answerDraft` for the draft the composer reports —
 * the page's `newMessage`, which it autosaves and a reload opens with.
 * Compared as text: the field's written value and the reported draft.
 */
import { describe, expect, test } from "vitest"
import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import { mountComponent, type MountedComponent } from "@serene-pub/cli/testing"
import { componentParitySections } from "@serene-pub/conformance"
import {
	draftHolds,
	draftText,
	draftToGiveBack,
	nextDraftWrite,
	type DraftWrite
} from "./collects"
import { answerDraft } from "./requests/draft"

const CORE_CATALOG = realpathSync(resolve(process.cwd(), "node_modules/@serene-pub/core-catalog"))
const FIELD = "sp-composer-field"

/** The page, as far as the draft goes. */
class Page {
	newMessage = ""
	draft: DraftWrite = { content: "", write: 0 }
	view!: MountedComponent
	constructor(saved: string) {
		if (saved) this.writeDraft(saved)
	}
	writeDraft(content: string) {
		this.newMessage = content
		this.draft = nextDraftWrite(this.draft, content)
	}
	dossier() {
		const sections = componentParitySections() as { scoped: { session_full: Record<string, unknown> } }
		const full = sections.scoped.session_full
		return { ...full, composer: { ...(full.composer as object), draft: this.draft } }
	}
	async open() {
		const sections = componentParitySections() as Record<string, unknown>
		this.view = await mountComponent({
			root: CORE_CATALOG,
			entry: "dist/components/messages.js",
			owner: "core",
			coreConversation: true,
			timeoutMs: 60_000,
			requests: (kind, params) => {
				if (kind === "draft") return answerDraft(params, { setDraft: (c) => (this.newMessage = c) })
				return new Promise(() => {})
			},
			context: { ...sections, scoped: { session_full: this.dossier() } } as never
		})
		await this.quiet()
		return this
	}
	/** The composer's draft reports are debounced (150 ms): let them land. */
	async quiet() {
		await new Promise((r) => setTimeout(r, 400))
		await this.view.settle()
	}
	field() {
		return this.view.query(FIELD)!.getAttribute("value")
	}
	async type(text: string) {
		await this.view.dispatch(FIELD, "input", { value: text })
		await this.quiet()
	}
	/** Press an action with the draft as its text (Nudge): the page spends the draft. */
	async press() {
		const sent = draftText(this.newMessage)
		expect(sent).not.toBe("")
		expect(draftHolds(sent, this.newMessage)).toBe(true)
		const spent = this.newMessage
		this.writeDraft("")
		await this.post()
		return spent
	}
	/** Its run's answer: a refusal or failure gives the draft back. */
	async answer(spent: string, outcome: { success?: boolean; parked?: boolean }) {
		const back = draftToGiveBack(outcome, spent, this.newMessage)
		if (back !== null) this.writeDraft(back)
		await this.post()
	}
	async nudge(outcome: { success?: boolean; parked?: boolean }) {
		const spent = await this.press()
		await this.answer(spent, outcome)
	}
	/** The page re-posts its dossier on any change; this is that post. */
	async post() {
		await this.view.push("scoped", { session_full: this.dossier() } as never)
		await this.quiet()
	}
}

describe("D1 · a composer action spends its draft at the press (note 31)", () => {
	test("after a successful Nudge the composer's draft is empty, and a reload agrees", async () => {
		const page = await new Page("").open()
		let saved = ""
		try {
			await page.type("The torches gutter.")
			expect(page.newMessage).toBe("The torches gutter.")
			await page.nudge({ success: true })
			expect(page.field()).toBe("")
			expect(page.newMessage).toBe("")
			saved = page.newMessage
		} finally {
			await page.view.unmount()
		}
		const reloaded = await new Page(saved).open()
		try {
			expect(reloaded.field()).toBe("")
			expect(reloaded.newMessage).toBe("")
		} finally {
			await reloaded.view.unmount()
		}
	}, 120_000)

	test("an action parked at its review gate spends the draft too", async () => {
		const page = await new Page("").open()
		try {
			await page.type("A crypt of echoes.")
			await page.nudge({ success: false, parked: true })
			expect(page.field()).toBe("")
			expect(page.newMessage).toBe("")
		} finally {
			await page.view.unmount()
		}
	}, 120_000)

	test("the press empties the composer before its run answers", async () => {
		const page = await new Page("").open()
		try {
			await page.type("The torches gutter.")
			await page.press()
			expect(page.field()).toBe("")
			expect(page.newMessage).toBe("")
		} finally {
			await page.view.unmount()
		}
	}, 120_000)

	test("an error gives the draft back, and a reload shows it", async () => {
		const page = await new Page("The torches gutter.").open()
		let saved = ""
		try {
			expect(page.field()).toBe("The torches gutter.")
			await page.nudge({ success: false })
			expect(page.field()).toBe("The torches gutter.")
			expect(page.newMessage).toBe("The torches gutter.")
			saved = page.newMessage
		} finally {
			await page.view.unmount()
		}
		const reloaded = await new Page(saved).open()
		try {
			expect(reloaded.field()).toBe("The torches gutter.")
			expect(reloaded.newMessage).toBe("The torches gutter.")
		} finally {
			await reloaded.view.unmount()
		}
	}, 120_000)
})
