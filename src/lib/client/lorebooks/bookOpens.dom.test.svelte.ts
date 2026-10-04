/**
 * The whole-book read runs once per book, never once per navigation
 * (places-graph B3 review, fixed in B5).
 *
 * `LorebooksWorkspace`'s route is a new object on every navigation, and the
 * refresh it keyed on emptied the rail's rows and sent ~10 requests per click
 * inside one book. Keying on the book id is not enough on its own: the read
 * (`refreshBook`) reads the route too, so an effect that calls it straight
 * subscribes to every navigation all over again.
 */
import { describe, expect, test } from "vitest"
import { flushSync } from "svelte"
import { whenBookOpens } from "./bookOpens.svelte"

type Route = { lorebookId: number | null; entryId?: number; lens?: string }

/** The workspace's shape: the route replaced whole, the book derived from it. */
function workspace(start: Route) {
	const state = $state({ route: start })
	const asked: { event: string; lorebookId: number | null }[] = []
	let rows: Record<string, unknown[]> = {}
	const stop = $effect.root(() => {
		const openBookId = $derived(state.route.lorebookId)
		whenBookOpens(
			() => openBookId,
			(id) => {
				rows = {}
				if (id === null) return
				// `refreshBook` reads the route for the id, as the workspace's does.
				const bookId = state.route.lorebookId
				for (const typeId of ["world", "history", "location"])
					asked.push({ event: `entries:list:${typeId}`, lorebookId: bookId })
				asked.push({ event: "narrativeGraph:list", lorebookId: bookId })
				rows = { world: [1] }
			}
		)
	})
	flushSync()
	return {
		asked,
		rows: () => rows,
		go(next: Route) {
			state.route = next
			flushSync()
		},
		stop
	}
}

describe("whenBookOpens — one read of the book per book", () => {
	test("navigating inside one book reads nothing again", () => {
		const ws = workspace({ lorebookId: 12 })
		expect(ws.asked).toHaveLength(4)
		ws.go({ lorebookId: 12, entryId: 5 })
		ws.go({ lorebookId: 12, entryId: 6, lens: "graph" })
		ws.go({ lorebookId: 12, entryId: 6, lens: "list" })
		expect(ws.asked).toHaveLength(4)
		// …and the rows it read are still there.
		expect(ws.rows()).toEqual({ world: [1] })
		ws.stop()
	})

	test("another book is read, once", () => {
		const ws = workspace({ lorebookId: 12 })
		ws.go({ lorebookId: 13 })
		ws.go({ lorebookId: 13, entryId: 2 })
		expect(ws.asked.map((a) => a.lorebookId)).toEqual([12, 12, 12, 12, 13, 13, 13, 13])
		ws.stop()
	})

	test("closing the book clears the rows and reads nothing", () => {
		const ws = workspace({ lorebookId: 12 })
		ws.go({ lorebookId: null })
		expect(ws.rows()).toEqual({})
		expect(ws.asked).toHaveLength(4)
		ws.stop()
	})
})
