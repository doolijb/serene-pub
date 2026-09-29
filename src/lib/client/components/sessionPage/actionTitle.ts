/**
 * The title a run's toast carries: the pressed action's name, never its
 * identity (lair pass W-GATE, 2026-09-27). `sessions:fireAction` answers
 * with `action` as the wire names it — `<spec slug>#<key>` when a declaration
 * was pressed, else the bare key — and a person pressed "Answer the door", not
 * `core:spec/lair-room-answer#room`.
 */
import { actionIdentity } from "$lib/shared/actions/identity"

export interface TitledAction {
	specSlug?: string
	key: string
	name?: string
}

/** The listed action's name for a run's `action`, else its key, else a plain word. */
export function actionTitle(
	action: string | null | undefined,
	listed: ReadonlyArray<TitledAction>
): string {
	if (!action) return "Action"
	for (const a of listed) {
		const same = a.specSlug
			? actionIdentity({ specSlug: a.specSlug, key: a.key }) === action
			: a.key === action
		if (same && a.name) return a.name
	}
	const hash = action.lastIndexOf("#")
	return hash >= 0 ? action.slice(hash + 1) : action
}
