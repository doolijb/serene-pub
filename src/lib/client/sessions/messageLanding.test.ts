import { describe, expect, test } from "vitest"
import { sessionHref } from "$lib/shared/notifications/kinds"
import {
	landingSelectors,
	nextLandingStep,
	readMessageLanding,
	withoutLanding
} from "./messageLanding"

const params = (href: string) => new URL(href, "http://x").searchParams

describe("readMessageLanding", () => {
	test("reads what sessionHref writes", () => {
		expect(readMessageLanding(params(sessionHref(3, 42)))).toEqual({ messageId: 42, blockId: null })
		expect(readMessageLanding(params(sessionHref(3, 42, "form-1")))).toEqual({
			messageId: 42,
			blockId: "form-1"
		})
		expect(readMessageLanding(params(sessionHref(3)))).toBeNull()
	})

	test("a message param that is not a positive whole id names nothing", () => {
		for (const bad of ["", "abc", "0", "-3", "4.5", "1e3", "99999999999999999999"])
			expect(readMessageLanding(new URLSearchParams({ message: bad }))).toBeNull()
	})

	test("an empty block names no block", () => {
		expect(readMessageLanding(new URLSearchParams({ message: "7", block: " " }))).toEqual({
			messageId: 7,
			blockId: null
		})
	})
})

describe("withoutLanding", () => {
	test("drops message and block, keeps everything else", () => {
		const url = withoutLanding(new URL("http://x/sessions/3?message=4&block=b&view=doc#top"))
		expect(url.pathname + url.search + url.hash).toBe("/sessions/3?view=doc#top")
	})
})

describe("nextLandingStep", () => {
	const at = { messageId: 10, blockId: null }
	test("loaded → seek, even while an older page is on its way", () => {
		expect(nextLandingStep(at, [9, 10, 11], { hasOlder: true, loadingOlder: true })).toBe("seek")
	})
	test("older than the window with more to load → load-older; while loading → wait", () => {
		expect(nextLandingStep(at, [20, 21], { hasOlder: true, loadingOlder: false })).toBe("load-older")
		expect(nextLandingStep(at, [20, 21], { hasOlder: true, loadingOlder: true })).toBe("wait")
	})
	test("not here and nothing more to bring it → give-up", () => {
		expect(nextLandingStep(at, [20, 21], { hasOlder: false, loadingOlder: false })).toBe("give-up")
		expect(nextLandingStep(at, [], { hasOlder: true, loadingOlder: false })).toBe("give-up")
		// Newer than anything loaded, or a gap inside the window (deleted).
		expect(nextLandingStep(at, [1, 2, 3], { hasOlder: true, loadingOlder: false })).toBe("give-up")
		expect(nextLandingStep(at, [8, 9, 11], { hasOlder: true, loadingOlder: false })).toBe("give-up")
	})
})

describe("landingSelectors", () => {
	test("the row by its id, the block by its data-block-id, both quoted", () => {
		expect(landingSelectors({ messageId: 5, blockId: 'we"ird\\id' })).toEqual({
			message: '[id="message-5"]',
			block: '[data-block-id="we\\"ird\\\\id"]'
		})
		expect(landingSelectors({ messageId: 5, blockId: null }).block).toBeNull()
	})
})
