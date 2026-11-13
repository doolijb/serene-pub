/**
 * 🚧 (s22-V) Book settings' Rules card says how the genres rate the book's
 * rules, and for a book on Freeform that the session chooses.
 *
 * ⚠ No DOM node is ever handed to `expect`: booleans, strings and plain data.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { socket } = vi.hoisted(() => ({
	socket: { emit: () => {}, on: () => {}, off: () => {} }
}))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => {
	const declareInterest = () => () => {}
	return {
		declareInterest,
		useInterest: declareInterest,
		requestWithInterest: declareInterest
	}
})
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		error: () => {},
		warning: () => {},
		info: () => {},
		success: () => {}
	}
}))
// The Rules picker asks with `awaitReply`; answered at once with two rules.
vi.mock("$lib/client/utils/awaitReply", () => ({
	awaitReply: async () => ({
		choices: [
			{ id: "core:ruleset/freeform@1", name: "Freeform", subtitle: "" },
			{
				id: "core:ruleset/vis-itineris@1",
				name: "Vis Itineris",
				subtitle: ""
			}
		],
		defaultId: "core:ruleset/freeform@1"
	})
}))

import BookRulesCard from "./BookRulesCard.svelte"
import type { RulesetGenreFit } from "./rulesFitWords"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const FITS: RulesetGenreFit[] = [
	{
		genreId: "story",
		genreName: "Story",
		rating: "great",
		reason: "everything it plays best with is here"
	},
	{
		genreId: "lair",
		genreName: "Lair",
		rating: "good",
		reason: "a health-like number — told in words"
	}
]

const render = async (props: Record<string, unknown>) => {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(BookRulesCard, {
		target: host,
		props: { lorebookId: 1, current: "core:ruleset/freeform@1", ...props }
	})
	await tick()
	await Promise.resolve()
	flushSync()
	return host
}
const said = (el: Element | null | undefined) =>
	el?.textContent?.replace(/\s+/g, " ").trim() ?? ""

describe("Book settings › Rules › genre fit", () => {
	test("a book on Freeform says the session chooses the rules", async () => {
		const host = await render({ current: "core:ruleset/freeform@1" })
		expect(said(host.querySelector('[data-rules-fit="freeform"]'))).toBe(
			"Freeform — the session chooses the rules"
		)
		expect(host.querySelector("details[data-rules-fit]") === null).toBe(
			true
		)
	})

	test("a book on rated rules reads each genre's word, with its why unfolded", async () => {
		const host = await render({
			current: "core:ruleset/vis-itineris@1",
			fits: FITS
		})
		expect(
			said(host.querySelector("details[data-rules-fit] summary"))
		).toBe("Story: Great · Lair: Good")
		expect(host.querySelector('[data-rules-fit="freeform"]') === null).toBe(
			true
		)
		expect(said(host.querySelector('[data-rules-fit-genre="lair"]'))).toBe(
			"Lair: Good (a health-like number — told in words)"
		)
	})

	test("rules no genre rates say nothing", async () => {
		const host = await render({ current: "core:ruleset/vis-itineris@1" })
		expect(host.querySelector("[data-rules-fit]") === null).toBe(true)
	})
})
