/**
 * 🚧 **Back · Forward** — the words and the state both sides share (RF fix 5,
 * owner ruling 2026-10-23; NOMENCLATURE §24 **rewound turn**). The server's
 * half is `server/sessions/rewind.ts`; the page reads the state off the
 * session (`session.rewind`) and hands it to the conversation as
 * `SessionDossierV1.rewind`.
 *
 * Member copy throughout: Back, Forward, "turns ahead" — never the words of
 * the machinery (retract, anchor, imprint).
 */

/** The sentences a press is refused with. */
export const REWIND_REFUSALS = Object.freeze({
	notOwner: "Only the session's owner can go back or forward.",
	busy: "Wait for the reply to finish.",
	nothing: "There is nothing to go back to yet.",
	fork: "This is where this branch begins. To go further back, open the session it was branched from.",
	noneAhead: "There is nothing ahead to bring back."
} as const)

/** Forward's reason with nothing ahead — what the page shows once a write replaced the stack. */
export const REWIND_NONE_AHEAD = REWIND_REFUSALS.noneAhead

/**
 * The Back · Forward strip's state: how many turns are ahead, and why each
 * press would be refused now — null when it would not. The same for every
 * viewer: who may press is the page's to add (the owner's alone), and so is
 * "a reply is being written".
 */
export interface RewindState {
	ahead: number
	back: string | null
	forward: string | null
}

/** "1 turn ahead" · "2 turns ahead" — the strip's count, and the composer note's. */
export const turnsAhead = (n: number): string => `${n} ${n === 1 ? "turn" : "turns"} ahead`

/** The composer's note while rewound: what a new line does to the turns ahead. */
export const replaceNote = (n: number): string =>
	`${turnsAhead(n)} will be replaced if you write now.`

/** A session's `rewind` off its payload, or null for a host that sends none. */
export function rewindStateOf(session: unknown): RewindState | null {
	const r = (session as { rewind?: unknown } | null | undefined)?.rewind
	if (!r || typeof r !== "object") return null
	const { ahead, back, forward } = r as Record<string, unknown>
	return {
		ahead: typeof ahead === "number" && ahead > 0 ? Math.trunc(ahead) : 0,
		back: typeof back === "string" ? back : null,
		forward: typeof forward === "string" ? forward : null
	}
}

/** The story's lanes, as rows store them. */
const STORY_LANES = new Set(["main", "main:1"])

/**
 * 🚧 The strip's state as the page holds it: the session's `rewind`, with
 * Back's reason read again off the lines the page has — the server's own
 * cheap rule (`rewindStateOf`, server): a person's line on the story to go
 * back to, and not a branch's copy. So a line that lands enables Back at
 * once, without a re-read of the session; with no person's line loaded the
 * server's word stands. Pure.
 */
export function rewindStateWith(
	session: unknown,
	messages: ReadonlyArray<{ role?: string | null; channel?: string | null; metadata?: unknown }>
): RewindState | null {
	const state = rewindStateOf(session)
	if (!state) return null
	const newestPerson = [...messages]
		.reverse()
		.find((m) => m.role === "user" && STORY_LANES.has(m.channel ?? "main"))
	if (!newestPerson) return state
	const copied = typeof (newestPerson.metadata as { copyOf?: unknown } | null)?.copyOf === "number"
	return { ...state, back: copied ? REWIND_REFUSALS.fork : null }
}
