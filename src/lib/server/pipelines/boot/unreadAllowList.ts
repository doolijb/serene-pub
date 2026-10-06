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
 * ⚠ **One, and it names what closes it.** The cap is asserted; adding a
 * line means shipping a control that is inert by construction, and needs the
 * ruling that decided to. (`session-history.params.priority` was the third
 * until U3b landed R-7 P5 on 2026-09-16: it is read now, as the conversation's
 * band intent. `core:oracle/embed-text@1 connection` was the second until
 * 2026-10-05: owner ruling D-c removed the slot — a pipeline never chooses its
 * embedding connection — and the hold it needed moved to
 * `config/heldSlots.ts`, on the one slot that is read.)
 */
export const UNREAD_ALLOW_LIST: readonly AllowedUnread[] = [
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

/**
 * Whether `slot` on the pinned `definition` is a slot no handler reads — and so
 * **not a choice**: the panel offers no option for it and the run drops a value
 * stored there, so it resolves to the instance default like a slot nobody
 * picked (review 2026-09-29).
 *
 * ⚠ The reason is not tidiness. A pick on a slot nothing reads is a setting
 * that changes nothing — except for whoever reads the slot BY REFERENCE, which
 * is how the embed step's connection was read until 2026-10-05 (`query-windows`
 * took `slot.connectionOf('semantic.arm.embed')`). That slot is gone and its
 * hold is policy now (`isHeldConnectionSlot`); no slot line stands, so this
 * answers no for every definition until a ruling adds one.
 */
export const isUnreadSlot = (definition: string, slot: string): boolean =>
	unreadSlotsOf(definition).includes(slot)

/** The slots `isUnreadSlot` answers yes for on one pinned definition. */
export const unreadSlotsOf = (definition: string): string[] =>
	UNREAD_ALLOW_LIST.filter(
		(a) => a.kind === "slot" && a.definition === definition
	).map((a) => a.name)
