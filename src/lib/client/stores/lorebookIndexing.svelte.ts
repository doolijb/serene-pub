/**
 * The lorebooks being indexed for Search by meaning, as the shell hears them
 * (`lorebook_indexing` activities; the Activity sidebar draws a card each).
 * A module singleton, like `notifications`: the shell's one `activity:update`
 * listener feeds `receive`, and the sidebar reads `activities`.
 *
 * The server sends an administrator every book's and anyone else only their
 * own books' (`activityStore.getFor`), so nothing is filtered here.
 */

export interface LorebookIndexingState {
	activityId: string
	/** The BOOK's owner. */
	userId: number
	lorebookId: number
	lorebookLabel: string
	indexedCount: number
	total: number
	startedAt: string
}

class LorebookIndexing {
	activities = $state<LorebookIndexingState[]>([])

	/** Replace the list from an `activity:update` payload's activities. */
	receive(activities: any[]): void {
		this.activities = (activities ?? [])
			.filter((a) => a?.kind === "lorebook_indexing")
			.map((a) => ({
				activityId: a.id,
				userId: a.userId,
				lorebookId: a.lorebookId,
				lorebookLabel: a.lorebookLabel,
				indexedCount: a.indexedCount ?? 0,
				total: a.total ?? 0,
				startedAt: a.startedAt
			}))
	}
}

export const lorebookIndexing = new LorebookIndexing()
