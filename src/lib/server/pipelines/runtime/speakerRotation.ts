/**
 * The next-speaker rules, as pure functions over what the cast and history
 * reads publish (plans/19 §5; the socket pre-pick retired 2026-09-21).
 *
 * One module, no database: the `core:task/turn-*@1` bindings call these
 * inside the run, and the two surfaces that ask "whose turn would it be"
 * without running one — the composer's *next up* line and the `who.next`
 * state key — call the same functions with the session's resolved strategy
 * (`entities/speaker.ts`). That is the whole of the one-decider rule: the
 * answer is computed in one place, and a preview can only agree with the
 * run because it runs the same code on the same rows.
 *
 * ## Round robin — once per turn of the person's
 *
 * Every active seat speaks once, in seat order, after each user message. A
 * seat that has already spoken since the person last did is not due again
 * until the person speaks again; when every seat has spoken, nobody is due
 * and it is the person's turn. Two sends in a row start a fresh round; a
 * manual out-of-turn trigger counts as that seat's turn for the round. A
 * session with no user message yet is one round: a seat that has spoken
 * (its greeting) is not due, a seat that has not is.
 *
 * Replaced the 0.5 lookback ("due when absent from the last N−1 rows"),
 * which counted hidden and narrator rows out but still mis-timed the
 * rotation whenever anything landed outside it — a form answer, an envoy's
 * line, a persona-less send — because a lookback window has no notion of
 * *whose* turn a message opened.
 *
 * ## What is not a turn
 *
 * Hidden rows and narrator responses are outside the rotation entirely; an
 * envoy's reply (`metadata.speaker` = `envoy:<slug>`, no `characterId`) is
 * a reply but not a seat's, so it never marks a character as having spoken.
 */

import type { ParticipantRef } from "@serene-pub/sdk"

/** A seat the rotation may pick: an active, present character. */
export interface RotationSeat {
	characterId: number
	position: number
	/** `characters.userId` — who owns the card, for the user-split rule. */
	ownerUserId: number | null
	name?: string
}

/** A seated in-turn envoy — a candidate when no character is due. */
export interface RotationEnvoy {
	slug: string
	position: number
	name?: unknown
}

/** A persona seat, for the user-split rule: who sent the last user line. */
export interface RotationPersona {
	personaId: number
	ownerUserId: number | null
}

/** The fields of a history row the rules read. */
export interface RotationMessage {
	role: string
	characterId?: number | null
	personaId?: number | null
	isHidden?: boolean | null
	isNarratorResponse?: boolean | null
	metadata?: unknown
	/**
	 * The row's participant reference (`envoy:<slug>`), as `session-history`
	 * publishes it — the host projects rows without `metadata`, so a rule
	 * reading only `metadata.speaker` never saw an envoy's reply (M3 fix).
	 */
	speaker?: string | null
}

/** Who voiced a row, by reference: the projected `speaker`, else the raw `metadata.speaker`. */
const speakerRefOf = (m: RotationMessage): unknown =>
	m.speaker ?? (m.metadata as { speaker?: unknown } | undefined)?.speaker

/** What `turn/select` scripts are handed, and hand back. */
export interface TurnSelection {
	/** The pick, once a link makes one. Null until then. */
	speaker: ParticipantRef | null
	/** Every reference a strategy may seat, in seat order. */
	candidates: Array<{
		speaker: ParticipantRef
		characterId: number | null
		name?: unknown
		position: number
	}>
	/** Who the round-robin rule would seat — the fallback a script may keep. */
	due: ParticipantRef | null
	/** The newest reply's speaker, or null when the person spoke last. */
	lastSpeaker: ParticipantRef | null
	/** Replies since the person last spoke. */
	sinceUser: number
}

/** The cast read's rows, as the strategies consume them. */
export interface CastRead {
	sessionCharacters?: Array<{
		isActive?: boolean | null
		position?: number | null
		removedAt?: unknown
		character?: { id: number; name?: string; userId?: number | null } | null
	}>
	sessionPersonas?: Array<{
		position?: number | null
		removedAt?: unknown
		persona?: { id: number; userId?: number | null } | null
	}>
	envoys?: Array<{
		slug: string
		position?: number | null
		removedAt?: unknown
		speaks?: string
		name?: unknown
	}>
}

/**
 * The seats, in position order — active, present, and with a character
 * behind the row. A missing position sorts by its index, as the cast list
 * displays it.
 */
export function rotationSeats(cast: CastRead): RotationSeat[] {
	return (cast.sessionCharacters ?? [])
		.map((cc, index) => ({ cc, position: cc.position ?? index }))
		.filter(({ cc }) => cc.character && cc.isActive && !cc.removedAt)
		.sort((a, b) => a.position - b.position)
		.map(({ cc, position }) => ({
			characterId: cc.character!.id,
			position,
			ownerUserId: cc.character!.userId ?? null,
			name: cc.character!.name
		}))
}

/** The persona seats, for the user-split rule. */
export function rotationPersonas(cast: CastRead): RotationPersona[] {
	return (cast.sessionPersonas ?? [])
		.filter((cp) => cp.persona && !cp.removedAt)
		.map((cp) => ({
			personaId: cp.persona!.id,
			ownerUserId: cp.persona!.userId ?? null
		}))
}

/**
 * The seated envoys that may take a turn (plans/29 R-18, R-21 (6); U5g):
 * live seats declared `in-turn`. An `on-action` envoy is never a candidate —
 * it speaks only through its action's outputs — so it is filtered out here,
 * before any strategy looks, which is the whole of the rule.
 */
export function inTurnEnvoys(cast: CastRead): RotationEnvoy[] {
	return (cast.envoys ?? [])
		.filter((e) => !e.removedAt && e.speaks === "in-turn")
		.map((e) => ({ slug: e.slug, position: e.position ?? 0, name: e.name }))
		.sort((a, b) => a.position - b.position)
}

/** The rows the rotation reads: not hidden, not narration. */
export function rotationTurns<M extends RotationMessage>(messages: readonly M[]): M[] {
	return messages.filter((m) => !m.isHidden && !m.isNarratorResponse)
}

const lastUserIndex = (turns: readonly RotationMessage[]): number => {
	for (let i = turns.length - 1; i >= 0; i--)
		if (turns[i]!.role === "user") return i
	return -1
}

/** The character ids that have replied since index `after` (exclusive). */
const spokenSince = (
	turns: readonly RotationMessage[],
	after: number
): Set<number> => {
	const out = new Set<number>()
	for (let i = after + 1; i < turns.length; i++) {
		const m = turns[i]!
		if (m.role === "assistant" && m.characterId != null)
			out.add(m.characterId)
	}
	return out
}

/**
 * Round robin (the docblock above). `seats` in the order they may speak;
 * the first that has not spoken since the person last did is due.
 */
export function roundRobinSpeaker(
	seats: readonly RotationSeat[],
	messages: readonly RotationMessage[]
): number | null {
	if (!seats.length) return null
	const turns = rotationTurns(messages)
	const spoken = spokenSince(turns, lastUserIndex(turns))
	return seats.find((s) => !spoken.has(s.characterId))?.characterId ?? null
}

/**
 * Round robin by user: the seats the last sender's owner holds complete a
 * turn before anyone else's. Who sent is read off the last user line's
 * persona; a line with no persona, a persona nobody owns, or an owner with
 * no seats falls back to the flat rotation — the rule narrows, it never
 * starves.
 */
export function userSplitSpeaker(
	seats: readonly RotationSeat[],
	personas: readonly RotationPersona[],
	messages: readonly RotationMessage[]
): number | null {
	const turns = rotationTurns(messages)
	const at = lastUserIndex(turns)
	const sender = at >= 0 ? turns[at]!.personaId : null
	const owner =
		sender != null
			? (personas.find((p) => p.personaId === sender)?.ownerUserId ?? null)
			: null
	const own = owner != null ? seats.filter((s) => s.ownerUserId === owner) : []
	return roundRobinSpeaker(own.length ? own : seats, messages)
}

/**
 * Which seated **envoy** is due (plans/29 R-18; U5g), or null.
 *
 * Envoys are not in the character rotation above — an envoy has no persona
 * to alternate with and a guide session has no characters at all — so the
 * rule is the simpler one a user/assistant exchange has: an envoy is due
 * when the newest message is not a reply (the person just spoke, or nobody
 * has yet), and the envoy that goes is the one whose last reply is furthest
 * back, first by seat position for those that never replied. An envoy's
 * reply is recognised by the reference its row carries (`metadata.speaker`,
 * `envoy:<slug>`), which is the row's only identity.
 */
export function nextEnvoyTurn(
	envoys: readonly RotationEnvoy[],
	messages: readonly RotationMessage[]
): string | null {
	if (!envoys.length) return null
	const visible = messages.filter((m) => !m.isHidden)
	const newest = visible[visible.length - 1]
	if (newest && newest.role !== "user") return null
	const lastReplyAt = new Map<string, number>()
	visible.forEach((m, i) => {
		const ref = speakerRefOf(m)
		if (typeof ref === "string" && ref.startsWith("envoy:"))
			lastReplyAt.set(ref.slice("envoy:".length), i)
	})
	const ordered = [...envoys].sort((a, b) => a.position - b.position)
	const never = ordered.find((e) => !lastReplyAt.has(e.slug))
	if (never) return never.slug
	return ordered.reduce((oldest, e) =>
		(lastReplyAt.get(e.slug) ?? -1) < (lastReplyAt.get(oldest.slug) ?? -1)
			? e
			: oldest
	).slug
}

/** The newest reply's speaker as a reference, or null when the person spoke last. */
export function lastSpeakerRef(
	messages: readonly RotationMessage[]
): ParticipantRef | null {
	const turns = rotationTurns(messages)
	const newest = turns[turns.length - 1]
	if (!newest || newest.role !== "assistant") return null
	if (newest.characterId != null) return `character:${newest.characterId}`
	const ref = speakerRefOf(newest)
	return typeof ref === "string" && ref.startsWith("envoy:")
		? (ref as ParticipantRef)
		: null
}

/**
 * The selection a `turn/select` chain is handed: the candidates, the
 * round-robin answer as `due`, and the two facts a script most often wants.
 */
export function turnSelection(
	seats: readonly RotationSeat[],
	envoys: readonly RotationEnvoy[],
	messages: readonly RotationMessage[]
): TurnSelection {
	const turns = rotationTurns(messages)
	const dueId = roundRobinSpeaker(seats, messages)
	const dueEnvoy = dueId == null ? nextEnvoyTurn(envoys, messages) : null
	return {
		speaker: null,
		candidates: [
			...seats.map((s) => ({
				speaker: `character:${s.characterId}` as ParticipantRef,
				characterId: s.characterId,
				name: s.name,
				position: s.position
			})),
			...envoys.map((e) => ({
				speaker: `envoy:${e.slug}` as ParticipantRef,
				characterId: null,
				name: e.name,
				position: e.position
			}))
		],
		due:
			dueId != null
				? `character:${dueId}`
				: dueEnvoy
					? `envoy:${dueEnvoy}`
					: null,
		lastSpeaker: lastSpeakerRef(turns),
		sinceUser: turns.length - 1 - lastUserIndex(turns)
	}
}

/* ------------------------------------------------------------------ *
 * Turn order over candidates (PLAN-turn-order §4.4, A6)
 * ------------------------------------------------------------------ */

/**
 * The rules above answer "who is due" with a character id, because they were
 * written for a decider that seated one speaker inside the reply run. Turn
 * order is state now: a pool publishes **candidates**, orderers rewrite their
 * order, and a strategy turns them into **entries**. The rules below are the
 * same rules over that vocabulary — one module still, still no database.
 *
 * Two things change with the vocabulary, and both are §4.4's:
 *
 * - **A persona is a candidate** (R15). A person's entry is shown as their
 *   turn and never fired, which is how a session knows it is the user's
 *   turn. Round robin treats a persona as having spoken when a user row
 *   after the previous user row carries its `personaId`.
 * - **Nobody due is an empty order**, never a halt. A strategy that seats
 *   nobody has answered the question.
 */

/** A prepared turn, as a strategy publishes it (`TurnEntryV1`). */
export interface TurnEntry {
	ref: ParticipantRef | null
	channel?: string
	subject?: string
	via: string
	[k: string]: unknown
}

/** A candidate the pool admitted (`TurnCandidateV1`). */
export interface TurnCandidate {
	ref: ParticipantRef
	kind: string
	name: string
	nickname?: string
	position: number
	ownerUserId?: number
	[k: string]: unknown
}

/**
 * Which candidates have already spoken since the person last did.
 *
 * Three readings, one per kind, and each is the fact that kind leaves in the
 * history: a character's id on a reply row, an envoy's reference in
 * `metadata.speaker`, a persona's id on a user row. The window is the same
 * one round robin has always used — everything after the last user row —
 * except for personas, whose own send IS the boundary, so they are read
 * against the row that opened it.
 */
export function spokenRefsSince(
	messages: readonly RotationMessage[]
): Set<string> {
	const turns = rotationTurns(messages)
	const at = lastUserIndex(turns)
	const out = new Set<string>()
	for (let i = at + 1; i < turns.length; i++) {
		const m = turns[i]!
		if (m.role !== "assistant") continue
		if (m.characterId != null) out.add(`character:${m.characterId}`)
		const ref = speakerRefOf(m)
		if (typeof ref === "string" && ref.startsWith("envoy:")) out.add(ref)
	}
	// The person's own line is their turn, consumed: with one persona and
	// `next` or `round`, a fresh send is that persona's turn spent, so the
	// order opens with the characters (§4.4).
	if (at >= 0) {
		const sender = turns[at]!.personaId
		if (sender != null) out.add(`character:${sender}`)
	}
	return out
}

/** Round robin (§4.4): every candidate not yet spoken, in candidate order. */
export function roundRobinEntries(
	candidates: readonly TurnCandidate[],
	messages: readonly RotationMessage[]
): TurnEntry[] {
	const spoken = spokenRefsSince(messages)
	return candidates
		.filter((c) => !spoken.has(c.ref))
		.map((c) => ({ ref: c.ref, via: "strategy" }))
}

/**
 * Round robin by user (§4.4): the last sender's own candidates first, and
 * only them. Plain round robin when that person holds none — the rule
 * narrows, it never starves.
 */
export function userSplitEntries(
	candidates: readonly TurnCandidate[],
	messages: readonly RotationMessage[]
): TurnEntry[] {
	const turns = rotationTurns(messages)
	const at = lastUserIndex(turns)
	const sender = at >= 0 ? turns[at]!.personaId : null
	const owner =
		sender != null
			? (candidates.find((c) => c.ref === `character:${sender}`)
					?.ownerUserId ?? null)
			: null
	const own =
		owner != null ? candidates.filter((c) => c.ownerUserId === owner) : []
	return roundRobinEntries(own.length ? own : candidates, messages)
}

/**
 * The mentioned orderer (R8): candidates named in the scanned text move to
 * the front, ordered by first mention; the rest keep the order they came in.
 *
 * `lookback` counts the most recent **user** rows, not rows — the question
 * is who the person named, and a reply naming somebody is the model's
 * business. Whole-word and case-insensitive over `name` and `nickname`; a
 * name that is a substring of a longer word is not a mention.
 */
export function mentionedFirst(
	candidates: readonly TurnCandidate[],
	messages: readonly RotationMessage[],
	lookback = 1
): { candidates: TurnCandidate[]; mentioned: string[] } {
	const userText = rotationTurns(messages)
		.filter((m) => m.role === "user")
		.slice(-Math.max(1, lookback))
		.map((m) => String((m as { content?: unknown }).content ?? ""))
		.join("\n")
	if (!userText.trim()) return { candidates: [...candidates], mentioned: [] }
	const haystack = userText.toLowerCase()
	/** The first index at which this candidate is named, or -1. */
	const firstMention = (c: TurnCandidate): number => {
		let best = -1
		for (const raw of [c.name, c.nickname]) {
			const needle = String(raw ?? "").trim().toLowerCase()
			if (!needle) continue
			// Whole word: the name may hold spaces and punctuation, so the
			// boundary is "not a word character" on either side rather than
			// `\b`, which does not fire beside a non-word character.
			const re = new RegExp(
				`(?<![\\p{L}\\p{N}_])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`,
				"u"
			)
			const at = haystack.search(re)
			if (at >= 0 && (best < 0 || at < best)) best = at
		}
		return best
	}
	const scored = candidates.map((c, index) => ({
		c,
		index,
		at: firstMention(c)
	}))
	const named = scored
		.filter((s) => s.at >= 0)
		.sort((a, b) => a.at - b.at || a.index - b.index)
	const rest = scored.filter((s) => s.at < 0)
	return {
		candidates: [...named, ...rest].map((s) => s.c),
		mentioned: named.map((s) => s.c.ref)
	}
}

/** What a `turn/select` chain is handed and hands back (§4.4, scripted). */
export interface TurnOrderSelection {
	order: TurnEntry[]
	candidates: TurnCandidate[]
	lastSpeaker: ParticipantRef | null
	sinceUser: number
}

/** The selection a scripted strategy builds before it calls its chain. */
export function turnOrderSelection(
	candidates: readonly TurnCandidate[],
	messages: readonly RotationMessage[]
): TurnOrderSelection {
	const turns = rotationTurns(messages)
	return {
		order: roundRobinEntries(candidates, messages),
		candidates: [...candidates],
		lastSpeaker: lastSpeakerRef(turns),
		sinceUser: turns.length - 1 - lastUserIndex(turns)
	}
}
