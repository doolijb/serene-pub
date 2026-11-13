/** The cast line under a card's name: the lead, each lorebook's name, nothing for a card in none of your lorebooks. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

import CastLine from "./CastLine.svelte"
import type { CastBannerMember } from "./castBannerWords"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const member = (
	lorebookId: number,
	lorebookName: string,
	retold: CastBannerMember["retold"] = []
): CastBannerMember => ({
	lorebookId,
	lorebookName,
	castId: lorebookId * 10,
	retold,
	followsCard: [],
	memberName: "Bianca"
})

const render = (members: CastBannerMember[]) => {
	app = mount(CastLine, { target: document.body, props: { members } })
	flushSync()
	return document.querySelector("[data-cast-line]")
}

describe("CastLine", () => {
	test("a card in one lorebook leads with it and names it", () => {
		const line = render([member(1, "Porto Alto")])!
		expect(line.textContent).toContain("In 1 lorebook:")
		expect(line.textContent).toContain("Porto Alto")
	})

	test("a card in two lorebooks names both, and the title carries the counts", () => {
		const line = render([
			member(1, "Porto Alto", ["face"]),
			member(2, "The Shared House")
		])!
		expect(line.textContent).toContain("In 2 lorebooks:")
		expect(line.textContent).toContain("Porto Alto")
		expect(line.textContent).toContain("(retells face)")
		expect(line.textContent).toContain("The Shared House")
		expect(line.getAttribute("title")).toContain(
			"Represents 2 cast members in 2 lorebooks."
		)
	})

	test("a card in none of your lorebooks renders nothing", () => {
		expect(render([])).toBeNull()
		expect(document.body.textContent?.trim()).toBe("")
	})
})
