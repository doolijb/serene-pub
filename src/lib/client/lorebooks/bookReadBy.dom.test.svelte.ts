/**
 * 🚧 The reading line with no reading session open (DC walk 6): a book a
 * session reads says so — "Read by Crawl Six" — never "Not read by a
 * session" because that session is not the open one.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import BookReadBy from "./BookReadBy.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const render = (readers: { id: number; name: string | null }[]) => {
	const host = document.createElement("p")
	document.body.append(host)
	app = mount(BookReadBy, { target: host, props: { readers } })
	flushSync()
	return host
}
const said = (host: HTMLElement) => host.textContent?.replace(/\s+/g, " ").trim()

describe("the reading line, no reader open", () => {
	test("a session that reads the book is named and linked", () => {
		const host = render([{ id: 1, name: "Crawl Six" }])
		expect(said(host)).toBe("Read by Crawl Six")
		expect(host.querySelector("[data-lore-read-by]")?.getAttribute("href")).toBe("/sessions/1")
	})

	test("more than one: the newest, then how many others", () => {
		expect(said(render([{ id: 2, name: "B" }, { id: 1, name: "A" }]))).toBe("Read by B and 1 other session")
	})

	test("an unnamed session reads as untitled; none reads as none", () => {
		expect(said(render([{ id: 3, name: null }]))).toBe("Read by Untitled session")
		if (app) unmount(app)
		app = null
		expect(said(render([]))).toBe("Not read by a session")
	})
})
