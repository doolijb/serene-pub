/**
 * The one rule for a cast member's `parentNodeId` (an alias filed under the
 * person it names), shared by every writer — `lorebooks:updateBinding`,
 * `lorebooks:createBinding` and `narrativeGraph:updateNode`.
 *
 * `lorebook_bindings.parent_node_id` has no constraint of its own, and the
 * graph reads it as a TWO-level tree: a person, and the aliases under them. So
 * a parent must be:
 *  - in the same book (a foreign id is a cross-tenant join waiting to happen),
 *  - not the member itself (a self-parent hides the node from the graph),
 *  - itself top level (its own `parentNodeId` is null — no third level),
 * and the member being filed must have no aliases of its own under it, or
 * they would become that third level.
 *
 * Same refusal sentence for "no such row" and "another book's row", so an id
 * probe learns nothing.
 */

import * as schema from "$lib/server/db/schema"
import { and, eq, count } from "drizzle-orm"

export async function assertValidParentNode(
	dbOrTx: Db,
	bindingId: number | null,
	parentNodeId: number,
	lorebookId: number
): Promise<void> {
	if (bindingId !== null && parentNodeId === bindingId)
		throw new Error("A cast member cannot be filed under themselves.")

	const [parent] = await dbOrTx
		.select({
			lorebookId: schema.lorebookBindings.lorebookId,
			parentNodeId: schema.lorebookBindings.parentNodeId
		})
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.id, parentNodeId))
	if (!parent || parent.lorebookId !== lorebookId)
		throw new Error("Parent node not found.")
	if (parent.parentNodeId !== null)
		throw new Error(
			"That cast member is already filed under someone else; file this one under them directly."
		)

	if (bindingId !== null) {
		const [children] = await dbOrTx
			.select({ n: count() })
			.from(schema.lorebookBindings)
			.where(
				and(
					eq(schema.lorebookBindings.parentNodeId, bindingId),
					eq(schema.lorebookBindings.lorebookId, lorebookId)
				)
			)
		if ((children?.n ?? 0) > 0)
			throw new Error(
				"This cast member has aliases filed under them, so they cannot be filed under someone else."
			)
	}
}
