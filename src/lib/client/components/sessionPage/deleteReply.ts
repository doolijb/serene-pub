/**
 * 🚧 What the page does with a `sessionMessages:delete` reply (On revision,
 * PLAN-rulesets §28):
 *
 * - `branch` — the turn was not deleted: the session forked before it, the
 *   old tail stays on this session, and the page moves to the branch (the
 *   path `sessions:branch` already takes);
 * - `refused` — nothing changed; the row stays where it is;
 * - `remove` — the row is gone; the page drops it.
 */
export type DeleteReplyAction =
	| { kind: "branch"; sessionId: number }
	| { kind: "refused" }
	| { kind: "remove"; id: number }

export function deleteReplyAction(msg: {
	id: number
	error?: string
	branchedTo?: number
}): DeleteReplyAction {
	if (msg.error) return { kind: "refused" }
	if (typeof msg.branchedTo === "number") return { kind: "branch", sessionId: msg.branchedTo }
	return { kind: "remove", id: msg.id }
}

/** The branch's own page — where `sessions:branch` lands too. */
export const sessionAddress = (sessionId: number): string => `/sessions/${sessionId}`
