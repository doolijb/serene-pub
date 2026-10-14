/**
 * The progress card's reason, with the admin screen it names made a link for an
 * administrator and left as text for a member (PLAN-less-confusing D1).
 */
import { describe, expect, it } from "vitest"
import { adminScreenSegments } from "./adminScreenLink"

const noImageModel =
	"No model is set for Images, and one is never picked automatically. An admin chooses it in Admin › Models › Loadouts."

describe("adminScreenSegments", () => {
	it("links Loadouts for an administrator, the sentence around it intact", () => {
		const segs = adminScreenSegments(noImageModel, { linked: true })
		expect(segs).toEqual([
			{
				text: "No model is set for Images, and one is never picked automatically. An admin chooses it in "
			},
			{ text: "Admin › Models › Loadouts", href: "/admin/defaults" },
			{ text: "." }
		])
		expect(segs.map((s) => s.text).join("")).toBe(noImageModel)
	})

	it("a member gets the same words and no link", () => {
		expect(adminScreenSegments(noImageModel, { linked: false })).toEqual([
			{ text: noImageModel }
		])
	})

	it("the older spelling the other refusals use is linked too", () => {
		const s =
			"The connection set for Image generation in Admin → Defaults no longer exists. Choose another in Admin → Defaults."
		const segs = adminScreenSegments(s, { linked: true })
		expect(segs.filter((x) => x.href).map((x) => x.text)).toEqual([
			"Admin → Defaults",
			"Admin → Defaults"
		])
		expect(segs.map((x) => x.text).join("")).toBe(s)
	})

	it("a sentence that names no screen is one text segment", () => {
		expect(
			adminScreenSegments("The run stopped without saying why.", {
				linked: true
			})
		).toEqual([{ text: "The run stopped without saying why." }])
	})

	it("an empty reason draws nothing", () => {
		expect(adminScreenSegments("", { linked: true })).toEqual([])
		expect(adminScreenSegments("", { linked: false })).toEqual([])
	})
})
