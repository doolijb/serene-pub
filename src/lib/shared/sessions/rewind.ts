/**
 * 🚧 **Back · Forward** — the words and the state both sides share (RF fix 5,
 * owner ruling 2026-10-23; NOMENCLATURE §24 **rewound turn**). The server's
 * half is `server/sessions/rewind.ts`; the page reads the state off the
 * session (`session.rewind`) and hands it to the conversation as
 * `SessionDossierV1.rewind`.
 *
 * Member copy throughout: Back, Forward, "turns ahead" — never the words of
 * the machinery (retract, anchor, imprint).
 *
 * The ONE refusal module (pr-6 D8): the SDK's strip reasons are quoted by
 * import, never retyped.
 */
import { REWIND_STRIP_REASONS } from "@serene-pub/core-catalog/conversation"

/** The sentences a press is refused with. */
export const REWIND_REFUSALS = Object.freeze({
	notOwner: REWIND_STRIP_REASONS.notOwner,
	busy: REWIND_STRIP_REASONS.generating,
	nothing: "There is nothing to go back to yet.",
	fork: "This is where this branch begins. To go further back, open the session it was branched from.",
	noneAhead: "There is nothing ahead to bring back.",
	// 🚧 pr-6 B4 (pass 4, ruled 2026-10-24): Back below the settle line.
	settled: "This part of the story is in the lorebook now.",
	// 🚧 pr-6 G2 (R-m): Back in a genre whose history settles as it is written.
	everyTurnKept: "This story keeps every turn as it is played, so there is no going back.",
	// 🚧 pr-6 R-c: Regenerate's two row-based refusals (A's sentences, server turnUnitOf).
	empty: "Nothing has been written yet, so there is no turn to regenerate.",
	ownLine: "Your line is the newest. Press Continue."
} as const)

/** 🚧 What Back would take now (playtest item 6): how many rows besides the person lines, the names on them, and the newest row id it covers — so the page can tell the count went stale. */
export interface RewindBackTakes {
	/** The unit's rows that are not a person's line (`TurnUnit.rows`). */
	count: number
	/** The names on those rows, oldest first, each once. */
	names: string[]
	/** The newest row id in the unit (`TurnUnit.ids`). */
	throughId: number
	/** 🚧 The person lines the unit holds; present only at a table (2 or more). */
	personLines?: number
	/** 🚧 The one message Back takes, present only when the genre takes one message per press: who wrote it, whether it is the owner's own line, and how many story rows go with it. */
	newestMessage?: { author: string | null; yours: boolean; filed: number }
}

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
	/** 🚧 pr-6: why the turn's Regenerate (`core#retake`) would be refused now; null when it would not. Optional on the type only because the server builds a RewindState without it; every reader here fills it. */
	regenerate?: string | null
	/** 🚧 What Back would take; absent when Back is refused or the count is stale. */
	backTakes?: RewindBackTakes
}

/** A session's `rewind` off its payload, or null for a host that sends none. */
export function rewindStateOf(session: unknown): RewindState | null {
	const r = (session as { rewind?: unknown } | null | undefined)?.rewind
	if (!r || typeof r !== "object") return null
	const { ahead, back, forward, regenerate, backTakes } = r as Record<
		string,
		unknown
	>
	const t = backTakes as
		| Partial<Record<keyof RewindBackTakes, unknown>>
		| null
		| undefined
	const lines = t?.personLines
	const m = t?.newestMessage as Record<string, unknown> | null | undefined
	const message =
		m &&
		typeof m === "object" &&
		typeof m.yours === "boolean" &&
		typeof m.filed === "number" &&
		Number.isInteger(m.filed) &&
		m.filed >= 0
			? {
					author: typeof m.author === "string" ? m.author : null,
					yours: m.yours,
					filed: m.filed
				}
			: null
	const takes: RewindBackTakes | null =
		t &&
		typeof t === "object" &&
		typeof t.count === "number" &&
		Number.isInteger(t.count) &&
		t.count >= 0 &&
		Array.isArray(t.names) &&
		typeof t.throughId === "number"
			? {
					count: t.count,
					names: t.names.filter(
						(n): n is string => typeof n === "string"
					),
					throughId: t.throughId,
					...(typeof lines === "number" &&
					Number.isInteger(lines) &&
					lines >= 0
						? { personLines: lines }
						: {}),
					...(message ? { newestMessage: message } : {})
				}
			: null
	return {
		ahead: typeof ahead === "number" && ahead > 0 ? Math.trunc(ahead) : 0,
		back: typeof back === "string" ? back : null,
		forward: typeof forward === "string" ? forward : null,
		regenerate: typeof regenerate === "string" ? regenerate : null,
		...(takes ? { backTakes: takes } : {})
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
	messages: ReadonlyArray<{ id?: number; role?: string | null; channel?: string | null; metadata?: unknown }>
): RewindState | null {
	const state = rewindStateOf(session)
	if (!state) return null
	const settledLine = (session as { settledLine?: unknown } | null | undefined)?.settledLine
	const line = typeof settledLine === "number" ? settledLine : null
	const story = [...messages].reverse().filter((m) => STORY_LANES.has(m.channel ?? "main"))
	const newestPerson = story.find((m) => m.role === "user")
	const newestStory = story[0]
	// A served `settled` lifts only when the newest person's line is past the settle line.
	const pastLine = line !== null && typeof newestPerson?.id === "number" && newestPerson.id > line

	let back = state.back
	if (newestPerson) {
		const copied = typeof (newestPerson.metadata as { copyOf?: unknown } | null)?.copyOf === "number"
		if (copied) back = REWIND_REFUSALS.fork
		else if (back === REWIND_REFUSALS.nothing || (back === REWIND_REFUSALS.settled && pastLine)) back = null
	}

	let regenerate = state.regenerate ?? null
	if (!newestStory) regenerate = REWIND_REFUSALS.empty
	else if (newestStory.role === "user") regenerate = REWIND_REFUSALS.ownLine
	else if (regenerate === REWIND_REFUSALS.empty || regenerate === REWIND_REFUSALS.ownLine) regenerate = null
	else if (regenerate === REWIND_REFUSALS.settled && newestPerson && pastLine) regenerate = null

	// The served count describes the turn at load time: a newer story row makes it stale.
	const takes = state.backTakes
	const fresh =
		takes !== undefined &&
		back === null &&
		!story.some((m) => typeof m.id === "number" && m.id > takes.throughId)
	return {
		ahead: state.ahead,
		back,
		forward: state.forward,
		regenerate,
		...(fresh ? { backTakes: takes } : {})
	}
}

/** What a new row does to the strip (RF fix 5: a write replaces the forward stack): nothing ahead any more. */
export function withStackReplaced(state: RewindState): RewindState {
	return { ...state, ahead: 0, forward: REWIND_REFUSALS.noneAhead }
}

/**
 * 🚧 pr-6: the header's Regenerate (the turn's, `core#retake`) — null when the genre does not offer it here.
 * Greyed with the first reason that holds: a reply being written; the action list's own verdict; the session's.
 */
export function regeneratePress(input: {
	offered: boolean
	generating: boolean
	listedReason: string | null
	rewind: RewindState | null
}): { disabled: boolean; reason?: string } | null {
	if (!input.offered) return null
	const reason = input.generating ? REWIND_REFUSALS.busy : (input.listedReason ?? input.rewind?.regenerate ?? null)
	return reason ? { disabled: true, reason } : { disabled: false }
}
