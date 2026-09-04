/**
 * The prompt pool key — what a prompt is scoped to now that it follows the node.
 *
 * A prompt belongs to `(node type, slot)`, so an action that reuses the reply
 * pipeline's context node inherits its prompts for free and a pipeline built
 * from other nodes is correctly offered none of them. Both halves are load
 * bearing: a type may declare more than one prompts slot with different field
 * sets, and one pool for both would offer each the other's fields — a prompt
 * missing a field renders a blank, which reads as the model ignoring an
 * instruction rather than as a bad selection.
 *
 * Deliberately free of any database import, for the same reason
 * `contextTemplateDefaults.ts` is: this is imported from the config layer, which
 * the entity modules already import, and `defaults.ts` opens a connection at
 * import time. It imports nothing and cannot be part of a cycle.
 */

/**
 * Re-exported so a caller reaching for the prompt pool does not have to know it
 * shares its version-stripping rule with context templates. It is the same rule
 * for the same reason — which fields a slot declares is a property of the
 * VERSION and is checked at selection, so fragmenting the pool on every @1 → @2
 * would strand every prompt a user wrote — and the two must never drift apart.
 */
export { poolKeyFor } from "./contextTemplateDefaults"

import { poolKeyFor } from "./contextTemplateDefaults"

/**
 * The two halves as one string, for an in-memory `Map` key ONLY.
 *
 * ⚠ Never persist this and never send it as an identifier the database is
 * queried by. `pipeline_prompts` stores the pool as TWO columns, indexed as two
 * columns, and a stringified composite would be a third spelling of the same
 * fact that no index covers — the classic way a pool key quietly stops matching
 * the rows it names. `#` rather than `:` because both halves already contain
 * colons.
 */
export const promptPoolKeyFor = (nodeTypeId: string, slot: string): string =>
	`${poolKeyFor(nodeTypeId)}#${slot}`
