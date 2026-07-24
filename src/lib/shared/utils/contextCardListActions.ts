import {
	type Card,
	type InsertableKind,
	removeCard,
	reorderCards,
	insertCard
} from "./contextConfigCards"

/**
 * Move/remove/insert/reorder for one sibling list (the root card list, or a
 * block card's own `children`/`elseChildren`) — identical logic needed at
 * every nesting level, factored out once instead of repeated in
 * ContextSidebar (root) and ContextCardNode (nested, twice — children and
 * elseChildren).
 */
export function makeCardListActions({
	template,
	siblings,
	parentBodyStart,
	parentBodyEnd,
	onTemplateChange
}: {
	template: string
	siblings: Card[]
	parentBodyStart: number
	parentBodyEnd: number
	onTemplateChange: (template: string) => void
}) {
	return {
		remove(index: number) {
			onTemplateChange(removeCard(template, siblings[index]))
		},
		moveUp(index: number) {
			if (index <= 0) return
			const ids = siblings.map((c) => c.id)
			;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
			onTemplateChange(reorderCards(template, siblings, ids))
		},
		moveDown(index: number) {
			if (index >= siblings.length - 1) return
			const ids = siblings.map((c) => c.id)
			;[ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]
			onTemplateChange(reorderCards(template, siblings, ids))
		},
		insertAt(
			index: number,
			spec: InsertableKind
		): { error?: string; insertedId?: string } {
			const { template: next, error, insertedId } = insertCard(
				template,
				{ parentBodyStart, parentBodyEnd, siblings },
				index,
				spec
			)
			if (!error) onTemplateChange(next)
			return { error, insertedId }
		},
		reorder(orderedIds: string[]) {
			onTemplateChange(reorderCards(template, siblings, orderedIds))
		}
	}
}

export type CardListActions = ReturnType<typeof makeCardListActions>
