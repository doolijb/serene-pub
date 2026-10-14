/**
 * The moment bar, rendered: the book's one time surface.
 *
 * `render` from `svelte/server`, like `managedConnectionView.ssr.test.ts`.
 * What the bar does at each of its three states IS its markup: at now it
 * offers no way back and says nothing about saving; at a moment it takes the
 * warning tint, says what a save does there, and offers exactly one Return to
 * now; compact, it is one line with a closed toggle. The branch chip rides on
 * its left end once the bar is handed a book and `onBranch`.
 *
 * ⚠ Not a design assertion. It checks sentences, the data hooks and the
 * classes that carry meaning (the tint, the filled way back), never layout.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} }),
	setSocket: () => {}
}))

import { timelineCursor } from "../timelineCursor.svelte"
import MomentBar from "./MomentBar.svelte"
import { MOMENT_SAVE_SENTENCE } from "./moment"

const BOOK = 4

const line = {
	lorebookId: BOOK,
	branches: [],
	branchId: null,
	onBranch: () => {},
	onCompare: () => {}
}

afterEach(() => {
	timelineCursor.setAxis(null, [])
})

/** How many times a piece of text appears in the markup. */
const count = (html: string, text: string) => html.split(text).length - 1

describe("the moment bar renders", () => {
	test("at now: the line, 'Reading now', the scrubber, and no way back", () => {
		timelineCursor.setAxis(BOOK, [
			{ id: 1, year: 3, month: null, day: null },
			{ id: 2, year: 5, month: null, day: null }
		])
		const html = render(MomentBar, {
			props: { ...line, onMoment: () => {}, onOpenTimeline: () => {} }
		}).body
		expect(html).toContain('data-lore-moment-at="now"')
		expect(html).toContain("data-lore-branch=")
		expect(html).toContain("Reading now")
		expect(html).toContain('role="slider"')
		expect(html).toContain("Go to date…")
		expect(html).toContain("Open timeline")
		expect(html).toContain("panel-edge")
		expect(html).not.toContain("bg-warning-500/10")
		expect(html).not.toContain("Return to now")
		expect(html).not.toContain(MOMENT_SAVE_SENTENCE)
		expect(html).not.toContain("Make this the present")
	})

	test("at a moment: the warning tint, the save sentence with the pool, one filled Return to now", () => {
		timelineCursor.setAxis(BOOK, [
			{ id: 1, year: 3, month: null, day: null },
			{ id: 2, year: 5, month: null, day: null }
		])
		const html = render(MomentBar, {
			props: {
				...line,
				moment: "Y3",
				asOfCount: { total: 41, notYet: 3 },
				castNotYet: { notYet: 2, total: 7 },
				onMoment: () => {},
				onSetPresent: () => {}
			}
		}).body
		expect(html).toContain('data-lore-moment-at="moment"')
		expect(html).toContain("bg-warning-500/10")
		expect(html).toContain("border-warning-500/40")
		expect(html).toContain("Reading as of Year 3")
		expect(html).toContain(MOMENT_SAVE_SENTENCE)
		expect(html).toContain(
			"41 entries as of this moment, 3 not in the story yet."
		)
		expect(html).toContain("2 of 7 cast not in the story yet.")
		expect(html).toContain("Make this the present")
		expect(count(html, "Return to now")).toBe(1)
		expect(html).toContain("preset-filled-primary-500")
	})

	test("with nothing dated: the empty line in place of the scrubber", () => {
		const html = render(MomentBar, {
			props: { onMoment: () => {} }
		}).body
		expect(html).toContain("Nothing is dated yet")
		expect(html).not.toContain('role="slider"')
		// No book handed in: no branch chip.
		expect(html).not.toContain("data-lore-branch=")
	})

	test("compact: one closed line with the line, the moment and the way back as text", () => {
		const html = render(MomentBar, {
			props: { ...line, moment: "Y3", compact: true, onMoment: () => {} }
		}).body
		expect(html).toContain("data-compact")
		expect(html).toContain('aria-expanded="false"')
		expect(html).toContain("data-lore-branch=")
		expect(html).toContain("Reading as of Year 3")
		expect(html).toContain("bg-warning-500/10")
		// One way back, as text on the line rather than a filled button.
		expect(count(html, "Return to now")).toBe(1)
		expect(html).not.toContain("preset-filled-primary-500")
	})
})
