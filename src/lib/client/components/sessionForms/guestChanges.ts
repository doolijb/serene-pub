/**
 * What Save has to send for the Guests list (note 34, 2026-10-02).
 *
 * Adding or removing a guest in the edit form is a pending change, like the
 * cast: the form holds the list it wants and commits the difference from the
 * saved list only when the person saves. `sessions:update` does not carry
 * guests, so the difference goes as one `sessions:addGuest` /
 * `sessions:removeGuest` per user — this is that difference, each side in the
 * order the ids were given, duplicates collapsed.
 */
export function guestChanges(
	savedIds: readonly number[],
	wantedIds: readonly number[]
): { add: number[]; remove: number[] } {
	const saved = new Set(savedIds)
	const wanted = new Set(wantedIds)
	return {
		add: [...wanted].filter((id) => !saved.has(id)),
		remove: [...saved].filter((id) => !wanted.has(id))
	}
}
