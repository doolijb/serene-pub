/**
 * **Held connection slots** — a connection slot the host holds at the
 * install's active connection, by policy. Never a person's choice: the panel
 * offers no pick for one (`declarations`), and the run drops a stored one
 * (`applyPipelineLayer`), so the executor resolves the slot as if nobody had
 * picked — to `world.activeConnection` under the slot's own `shape`.
 *
 * ## Which slots, and why it is policy rather than a list
 *
 * A pipeline never chooses its embedding connection (owner ruling 2026-10-05,
 * D-c): the host embeds through the one active embedding connection, so
 * `embed-text` and the sprite picker declare no connection at all. A node that
 * still declares one — `core:task/query-windows@1`, which reads it for the one
 * fact *Automatic* needs, whether an embedding model is set up — declares it
 * as `requires: ['text->embedding']`, and that declaration is what this
 * reads. A plugin's node declaring the same is held the same way.
 *
 * ⚠ The reason is not tidiness. A pick there would make *Automatic* decide
 * about a connection the embed never uses — searching with nothing active, or
 * a stale pick hiding the active one (review 2026-09-29). Held, the two cannot
 * disagree. INTEGRATING.md Step 3 names the duty: "hold that slot at the
 * connection the host embeds through".
 *
 * ⚠ Not `isUnreadSlot` (`boot/unreadAllowList.ts`), which held the embed
 * step's slot until 2026-10-05: that one is a slot NO handler reads, allowed
 * to stand with a reason. A held slot IS read — `query-windows` reads it — so
 * it is no inert control and no ledger line; it is simply not the person's to
 * set.
 *
 * Pure and leaf-level, so the panel and the world builder ask one question.
 */

import type { SlotDecl } from "@serene-pub/sdk"
import { EMBEDDING_CAPABILITY } from "$lib/shared/constants/embeddings"

/** The capabilities whose connection is the host's, never a pipeline's. */
const HELD_CAPABILITIES: readonly string[] = [EMBEDDING_CAPABILITY]

/** Whether a declared slot is a held connection slot (see the file header). */
export const isHeldConnectionSlot = (
	decl: Pick<SlotDecl, "kind" | "requires"> | null | undefined
): boolean =>
	decl?.kind === "connection" &&
	Array.isArray(decl.requires) &&
	decl.requires.some((c) => HELD_CAPABILITIES.includes(String(c)))
