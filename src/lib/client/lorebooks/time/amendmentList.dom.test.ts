/** The Changes list's words for a member's cast versions. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import AmendmentList from "./AmendmentList.svelte"

let app: ReturnType<typeof mount> | null = null

afterEach(() => {
	if (app) unmount(app)
	app = null
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

function mountList(subject: "entry" | "cast", fields: Record<string, unknown>) {
	setSocket({
		connected: true,
		id: "t",
		on() {},
		off() {},
		emit() {}
	} as never)
	setInterestUser({ id: 1, isAdmin: false })
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(AmendmentList, {
		target,
		props: {
			lorebookId: 1,
			subject,
			amendments: [
				{
					id: 1,
					lorebookId: 1,
					castId: 3,
					entryId: 3,
					branchId: null,
					year: 4,
					month: null,
					day: null,
					fields
				}
			] as never
		}
	})
	flushSync()
}

describe("AmendmentList, cast", () => {
	test("names the version columns in the reader's words, greetings once", () => {
		mountList("cast", {
			description: "x",
			firstMessage: "y",
			alternateGreetings: ["z"],
			retold: {},
			ownName: "N",
			timbre: "t",
			faceMediaId: 4
		})
		const text = document.body.textContent ?? ""
		expect(text).toContain(
			"description, greetings, what is told in their own words, name in this book, voice, face"
		)
	})

	test("the delete question speaks of a change and of them", () => {
		mountList("cast", { description: "x" })
		document
			.querySelector<HTMLButtonElement>(
				'button[aria-label^="Delete the amendment"]'
			)!
			.click()
		flushSync()
		expect((document.body.textContent ?? "").replace(/\s+/g, " ")).toMatch(
			/Delete the change dated .*\? They read as they did without it, from then on/
		)
	})

	test("an entry's question stays word for word", () => {
		mountList("entry", { content: "x" })
		document
			.querySelector<HTMLButtonElement>(
				'button[aria-label^="Delete the amendment"]'
			)!
			.click()
		flushSync()
		expect((document.body.textContent ?? "").replace(/\s+/g, " ")).toMatch(
			/Delete the amendment dated .*\? The entry reads as it did without it/
		)
	})
})
