import { landOn } from "$lib/client/utils/landOn"

/**
 * A plain click on a link to `#id` inside a widget box moves to that element
 * in the same box, without touching the page's URL or history: the element's
 * top is brought into view, and it takes the keyboard when it can
 * (`tabindex`). The receiver gives a box's fragment links the same prefix as
 * its ids, so a link only ever reaches its own widget. Returns whether the
 * click was handled; anything else is left to the browser.
 */
export function followFragmentLink(e: MouseEvent, box: HTMLElement): boolean {
	if (e.defaultPrevented || e.button !== 0) return false
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
	const link = (e.target as Element | null)?.closest?.("a[href^='#']")
	if (!link || !box.contains(link)) return false
	const id = link.getAttribute("href")!.slice(1)
	if (!id) return false
	const target = box.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
	if (!target) return false
	e.preventDefault()
	landOn(target, {
		block: "start",
		ring: false,
		focus: target.hasAttribute("tabindex") ? target : null
	})
	return true
}
