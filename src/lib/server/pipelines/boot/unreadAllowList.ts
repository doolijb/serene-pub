/**
 * The allow-list for declared-but-unread names — a LEAF module.
 *
 * Split out of `declaredReads.ts` (2026-09-16, U2 residual) so that a unit
 * test deriving its ledger from this list — `paramsSlotWiring.test.ts` — can
 * import it without pulling `runtime/bindings.ts` and everything behind it
 * into a unit run. The walk that applies the list stays in `declaredReads.ts`.
 *
 * A finding may stand only with a **reason** — a sentence naming what closes
 * it. The list is asserted in both directions by `declaredReads.test.ts` (an
 * entry that stops applying fails as loudly as a new finding does), capped,
 * and printed on every run so it stays visible.
 */

/** What a declared name is — decides which ledger an allowance feeds. */
export type UnreadKind = "port" | "slot" | "param"

/** A declared name no handler reads, allowed to stand — with the reason. */
export interface AllowedUnread {
	/** The definition, pinned (`core:query/session-history@1`). */
	definition: string
	/**
	 * `params.<field>` for a parameter; the bare name for an in-port or a
	 * slot, which arrive on `input` indistinguishably (see `HandlerRequires`).
	 */
	name: string
	/**
	 * Which of the three a `name` is. `paramsSlotWiring.test.ts` derives its
	 * per-node ledger from the `slot` entries alone — a parameter is a control
	 * inside a slot the spec does name, and an in-port is not a slot at all —
	 * and it filters on this rather than on the spelling of `name`.
	 */
	kind: UnreadKind
	/** Why it stands, and what closes it. Mandatory. */
	reason: string
}

/**
 * ⚠ **Two, and each names what closes it.** The cap is asserted; adding a
 * line means shipping a control that is inert by construction, and needs the
 * ruling that decided to. (`session-history.params.priority` was the third
 * until U3b landed R-7 P5 on 2026-09-16: it is read now, as the conversation's
 * band intent.)
 */
export const UNREAD_ALLOW_LIST: readonly AllowedUnread[] = [
	{
		definition: "core:oracle/embed-text@1",
		name: "connection",
		kind: "slot",
		reason:
			"awaiting embeddings-as-connections (DESIGN-embedding-ner-connections): " +
			"the host embeds through the local model (`embeddingApi()` in " +
			"host.ts), so the slot resolves a value into a port nobody reads. Its " +
			"fix is a reader, which that design supplies — six spec nodes carry " +
			"the unwired slot meanwhile (paramsSlotWiring.test.ts derives them " +
			"from this line)."
	},
	{
		definition: "core:task/build-keeper-context@1",
		name: "afterWrite",
		kind: "port",
		reason:
			"an ORDERING edge, declared for sequencing alone: the reply write's " +
			"result, taken on a port so the keeper runs AFTER the write rather " +
			"than beside it, and never looked inside — a write result in a " +
			"prompt is a row id the model reads as prose. Closes when the " +
			"executor grows an ordering edge that is not a data port."
	}
]

/** The allow-list, keyed the way findings are. */
export const allowKey = (definition: string, name: string) =>
	`${definition} ${name}`
