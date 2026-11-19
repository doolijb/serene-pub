/**
 * The delete confirm of a book a session plays on (D50): the sentence, the
 * sessions as links, how many more, the way out.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import BookDeleteRefusal from "./BookDeleteRefusal.svelte"
import { bookDeleteWords } from "$lib/shared/lorebooks/sessionNotes"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const readers = (n: number) =>
	Array.from({ length: n }, (_, i) => ({
		id: i + 1,
		name: i === 0 ? null : `S${i + 1}`
	}))

const render = (n: number, onOpen?: () => void) => {
	const words = bookDeleteWords("Umber City", {
		named: readers(n),
		others: 0
	})
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(BookDeleteRefusal, { target: host, props: { words, onOpen } })
	flushSync()
	return { host, words }
}

describe("the refused delete", () => {
	test("says the sentence, links each session, and gives the way out", () => {
		const { host, words } = render(2)
		const root = host.querySelector("[data-book-delete-refusal]")!
		expect(root.textContent).toContain(words.lead)
		expect(root.textContent).toContain(words.wayOut!)
		const links = [...host.querySelectorAll("[data-book-delete-reader]")]
		expect(links.map((a) => a.textContent?.trim())).toEqual([
			"Untitled session",
			"S2"
		])
		expect(links.map((a) => a.getAttribute("href"))).toEqual([
			"/sessions/1",
			"/sessions/2"
		])
		expect(root.textContent).not.toContain("more")
	})

	test("seven sessions: five shown and 'and 2 more'", () => {
		const { host } = render(7)
		expect(host.querySelectorAll("[data-book-delete-reader]")).toHaveLength(
			5
		)
		expect(host.textContent).toContain("and 2 more")
	})

	test("opening a session calls onOpen", () => {
		const onOpen = vi.fn()
		const { host } = render(1, onOpen)
		const a = host.querySelector<HTMLAnchorElement>(
			"[data-book-delete-reader]"
		)!
		a.addEventListener("click", (e) => e.preventDefault())
		a.click()
		expect(onOpen).toHaveBeenCalledTimes(1)
	})
})
