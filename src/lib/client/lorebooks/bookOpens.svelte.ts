import { untrack } from "svelte"

/**
 * Runs `read` once each time the workspace turns to a book (null: closed) —
 * never on a navigation inside the book it already has open.
 *
 * ⚠ **Two halves, and both are load-bearing** (places-graph B3 review, fixed
 * in B5). The workspace's route is a new object on every navigation, so the
 * key must be the book id as a primitive (`openBookId`), never
 * `route.lorebookId` read here. And `read` runs **untracked**: the whole-book
 * read (`refreshBook`) reads the route for the id itself, and an effect that
 * called it straight subscribed to every navigation all over again — the
 * rail's rows were emptied and ten requests went out on each click.
 */
export function whenBookOpens(
	bookId: () => number | null,
	read: (lorebookId: number | null) => void
): void {
	$effect(() => {
		const id = bookId()
		untrack(() => read(id))
	})
}
