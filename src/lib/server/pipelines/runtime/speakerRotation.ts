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
import {
	countedTurns,
	DEFAULT_CHANNEL,
	formatChannel,
	parseChannel,
	roundRobinOrder,
	senderRefOf,
	spokenRefsSince as sdkSpokenRefsSince,
	type TurnHistoryMessage
} from "@serene-pub/sdk"

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

/**
 * The fields of a history row the rules read — the SDK's
 * `TurnHistoryMessage`, the shape the public round-robin rule reads — plus
 * the row's `channel` (lair re-plan R5), which only the narrator rule reads:
 * its entry spans channels. Absent is `main`.
 */
export type RotationMessage = TurnHistoryMessage & {
	channel?: string | null
	/** The history row's id, when the read carries it. */
	id?: number
	/**
	 * 🚧 The **turn plan** a planner's row carries (Lair character turns,
	 * `create-message@1`'s `turnPlan`, stored as `metadata.turnPlan`): the
	 * participant references it plans a character turn for, in order. Only
	 * on such a row.
	 */
	turnPlan?: { turns?: unknown; waits?: unknown; rolls?: unknown; skipped?: unknown } | null
	/** The row was stopped while it was written (`generationOutcome: 'stopped'`). Only when it was. */
	stopped?: boolean
	/**
	 * 🚧 The form this row answers (`metadata.answersForm`, U5f) — what holds
	 * a plan's turns while its roll forms are open (Lair rewrite D3). Only on
	 * an answer's row.
	 */
	answersForm?: { messageId?: unknown; blockId?: unknown } | null
}

/** Who voiced a row, by reference: the projected `speaker`, else the raw `metadata.speaker`. */
const speakerRefOf = (m: RotationMessage): unknown =>
	m.speaker ?? (m.metadata as { speaker?: unknown } | undefined)?.speaker

/** The seat a person's line was sent from — the SDK's one reading (`senderRefOf`). */
export { senderRefOf }

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
		/** False for a seat switched off in the cast list — the read carries it. */
		enabled?: boolean | null
		position?: number | null
		removedAt?: unknown
		character?: { id: number; name?: string; userId?: number | null } | null
	}>
	sessionPersonas?: Array<{
		position?: number | null
		removedAt?: unknown
		/** Null for 🚧 a seat that voices no card — addressed `player-seat:<seatId>`. */
		persona?: { id: number; name?: string; userId?: number | null } | null
		seatId?: number
		seatName?: string | null
		seatUserId?: number | null
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
		.filter(({ cc }) => cc.character && cc.enabled === true && !cc.removedAt)
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

/** The rows the rotation reads: not hidden, not narration (the SDK's `countedTurns`). */
export function rotationTurns<M extends RotationMessage>(messages: readonly M[]): M[] {
	return countedTurns(messages)
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
 *   after the previous user row carries its `personaId` — 🚧 a card-less
 *   seat (`player-seat:<id>`, still `kind: 'persona'`) when it carries its
 *   `player-seat:` speaker (`senderRefOf`).
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
 * Which candidates have already spoken since the person last did — the
 * SDK's public rule (`spokenRefsSince` in `@serene-pub/sdk`), which a
 * plugin's strategy reads too, so core and plugins cannot drift.
 */
export function spokenRefsSince(
	messages: readonly RotationMessage[]
): Set<string> {
	return sdkSpokenRefsSince(messages)
}

/** Whether a row is a person's line on `main` (a row with no channel, or a `main` lane, is `main`'s). */
const isPersonsMainLine = (row: RotationMessage): boolean =>
	row.role === "user" &&
	parseChannel(row.channel ?? DEFAULT_CHANNEL).slug === DEFAULT_CHANNEL

/** A row's turn plan's references, or null when the row plans nothing. */
const plannedRefsOf = (row: RotationMessage): ParticipantRef[] | null => {
	const plan = row.turnPlan
	if (!plan || typeof plan !== "object") return null
	const turns = Array.isArray(plan.turns) ? plan.turns : []
	return turns.filter((t): t is ParticipantRef => typeof t === "string" && t.length > 0)
}

/** 🚧 A plan's string list (`waits`, `skipped`), empty when absent. */
const planList = (row: RotationMessage, key: "waits" | "skipped"): string[] => {
	const list = (row.turnPlan as Record<string, unknown> | null | undefined)?.[key]
	return Array.isArray(list) ? list.filter((t): t is string => typeof t === "string" && !!t) : []
}

/**
 * 🚧 Whether a plan's turns are **held** (Lair rewrite D3): it names a roll
 * row (`turnPlan.rolls`) and at least one of that row's roll forms has no
 * answer yet — no visible row after it stamped `answersForm` for that form.
 * Read off the history, so the recompute a roll's answer row sets off
 * already sees it answered, whenever the press's own stamp lands.
 */
const heldOn = (
	plan: RotationMessage,
	after: readonly RotationMessage[]
): boolean => {
	const rolls = (plan.turnPlan as { rolls?: unknown } | null | undefined)?.rolls as
		| { messageId?: unknown; forms?: unknown }
		| undefined
	if (!rolls || typeof rolls !== "object") return false
	const forms = Array.isArray(rolls.forms) ? rolls.forms.filter((f): f is string => typeof f === "string") : []
	if (!forms.length) return false
	const answered = new Set<string>()
	for (const row of after) {
		if (!row || row.isHidden) continue
		const a = row.answersForm
		if (a && Number(a.messageId) === Number(rolls.messageId) && typeof a.blockId === "string")
			answered.add(a.blockId)
	}
	return forms.some((f) => !answered.has(f))
}

/**
 * 🚧 **The standing turn plan** (Lair character turns, owner ruling
 * 2026-09-30): the newest visible row that carries a turn plan, unless a
 * person's line on `main` after it moved the story past it. `before`, a row
 * id: only rows older than it count (a regenerate or swipe re-voicing that
 * row reads the plan it was played from). Null when no plan stands. `index`
 * is the plan row's place in `messages`.
 *
 * 🚧 **A seat's own turn is no direction** (Lair rewrite D5, 2026-10-21): a
 * person's line from a seat the plan still waits for — the persona or
 * card-less seat it names, not yet spoken, not skipped — is that seat's
 * planned turn, and the plan stands through it. Any other person's line on
 * `main` (the GM's direction, a seat speaking out of turn) moves past it.
 *
 * The one reading of "which plan stands": the narrator strategy prepares the
 * plan's turns from it, and `core:query/turn-plan@1` hands a character turn
 * its plan from it.
 */
export function standingTurnPlan(
	messages: readonly RotationMessage[],
	before?: number
): { index: number; turns: ParticipantRef[]; row: RotationMessage } | null {
	const counts = (row: RotationMessage | null | undefined): row is RotationMessage =>
		!!row && !row.isHidden && !(before !== undefined && typeof row.id === "number" && row.id >= before)
	for (let i = messages.length - 1; i >= 0; i--) {
		const row = messages[i]
		if (!counts(row)) continue
		if (isPersonsMainLine(row) && senderRefOf(row) === null) return null
		const turns = plannedRefsOf(row)
		if (!turns) continue
		// The person lines after it, oldest first: each a seat's own turn.
		const waiting = new Set(planList(row, "waits").filter((r) => turns.includes(r as ParticipantRef)))
		for (const ref of planList(row, "skipped")) waiting.delete(ref)
		for (const later of messages.slice(i + 1)) {
			if (!counts(later) || !isPersonsMainLine(later)) continue
			const sender = senderRefOf(later)
			if (!sender || !waiting.has(sender)) return null
			waiting.delete(sender)
		}
		return { index: i, turns, row }
	}
	return null
}

/**
 * 🚧 **The planned turns** still to be taken: the standing plan's references,
 * in its order, less every one whose seat has a visible row on `main` after
 * the plan row (a character's reply, or a person's own line from the seat)
 * and every waiting player the GM moved past (`turnPlan.skipped`) — each
 * `{ ref, via: 'plan' }`. A row after the plan that was stopped ends the plan
 * (R34, "a Stop ends the round"): nothing is left to take. A reference named
 * twice is one turn. While the plan's roll forms are open (`heldOn`, Lair
 * rewrite D3) nothing is prepared yet. `planned` is whether a plan stands at
 * all — one naming nobody still answered the person's line.
 */
function plannedTurns(messages: readonly RotationMessage[]): {
	planned: boolean
	entries: TurnEntry[]
} {
	const standing = standingTurnPlan(messages)
	if (!standing) return { planned: false, entries: [] }
	const after = messages.slice(standing.index + 1)
	if (heldOn(standing.row, after)) return { planned: true, entries: [] }
	const spoken = new Set<string>(planList(standing.row, "skipped"))
	for (const row of after) {
		if (!row || row.isHidden) continue
		if (row.stopped === true) return { planned: true, entries: [] }
		if (parseChannel(row.channel ?? DEFAULT_CHANNEL).slug !== DEFAULT_CHANNEL) continue
		if (typeof row.characterId === "number") spoken.add(`character:${row.characterId}`)
		if (row.role === "user") {
			const sender = senderRefOf(row)
			if (sender) spoken.add(sender)
		}
	}
	const seen = new Set<string>()
	const entries: TurnEntry[] = []
	for (const ref of standing.turns) {
		if (seen.has(ref) || spoken.has(ref)) continue
		seen.add(ref)
		entries.push({ ref, via: "plan" })
	}
	return { planned: true, entries }
}

/**
 * The narrator strategy's entries (§4.4; lair re-plan R5): the pipeline's
 * own voice (`ref: null`) is due on every channel whose **newest visible
 * row** is a person's — one entry per such channel, **newest line first**,
 * so a line on a side channel (the Lair's Sanctum) puts its entry at the
 * head and auto-advance answers it.
 *
 * 🚧 **Then the planned turns** (Lair character turns, owner ruling
 * 2026-09-30): while a turn plan stands (`standingTurnPlan`), each turn it
 * names that is not yet taken, in its order, `via: 'plan'`. A standing plan
 * has answered the person's line on `main`, so `main` prepares no own-voice
 * entry beside it — the Castellan's turn is being taken, by its delvers. A
 * history with no plan row reads exactly as it did.
 *
 * "The newest row", not the newest turn in the rotation: the voice's own
 * reply is exactly what this strategy produced, so it has to count as the
 * turn being taken (`countedTurns` drops narration, and reading through it
 * would prepare a second entry after every reply, forever). A hidden row
 * counts for nobody.
 *
 * `main`'s entry carries **no** `channel` (a row with none, or `main:1`, is
 * `main`'s): a genre whose turn-order history reads only `main` — Adventure,
 * Whodunit — gets the order it always got, byte for byte. Any other entry
 * names its channel canonically (`formatChannel`), which is what a fire
 * hands the reply road.
 */
export function narratorEntries(
	messages: readonly RotationMessage[]
): TurnEntry[] {
	const newest = new Map<string, { index: number; row: RotationMessage }>()
	messages.forEach((row, index) => {
		if (!row || row.isHidden) return
		newest.set(formatChannel(parseChannel(row.channel ?? DEFAULT_CHANNEL)), {
			index,
			row
		})
	})
	const plan = plannedTurns(messages)
	const voices: TurnEntry[] = [...newest]
		.filter(([, { row }]) => row.role === "user")
		.filter(([channel]) => !(plan.planned && channel === DEFAULT_CHANNEL))
		.sort(([, a], [, b]) => b.index - a.index)
		.map(([channel]) =>
			channel === DEFAULT_CHANNEL
				? { ref: null, via: "voice" }
				: { ref: null, via: "voice", channel }
		)
	return [...voices, ...plan.entries]
}

/**
 * Round robin (§4.4): every candidate not yet spoken, in candidate order —
 * the SDK's `roundRobinOrder`, the one public implementation.
 */
export function roundRobinEntries(
	candidates: readonly TurnCandidate[],
	messages: readonly RotationMessage[]
): TurnEntry[] {
	return roundRobinOrder(candidates, messages)
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
	const sender = at >= 0 ? senderRefOf(turns[at]!) : null
	const owner =
		sender != null
			? (candidates.find((c) => c.ref === sender)?.ownerUserId ?? null)
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
	/**
	 * 🚧 What the narrator strategy would prepare over the same history
	 * (`narratorEntries`): one own-voice entry per channel whose newest
	 * visible row is a person's, and a standing plan's turns. Handed so a
	 * script can answer a side channel's talk without seating anybody —
	 * Dungeon Crawler's round script answers each Planner lane with it
	 * (2026-10-15). Read-only advice: what the chain returns is the order.
	 */
	voiceEntries: TurnEntry[]
	/**
	 * 🚧 Who has written on each channel since that channel's newest visible
	 * reply (any row that is not a person's): the senders' seat references
	 * (`senderRefOf` — `character:<id>` for a seat with a card,
	 * `player-seat:<id>` for one without), newest first, each once, keyed by
	 * canonical channel (`main`, `parley:2`). A channel whose newest row is a
	 * reply is absent. Handed so a script can wait for everyone at the table
	 * — Dungeon Crawler's round (2026-10-15) — without seeing the rows.
	 */
	sentSinceReply: Record<string, string[]>
}

/**
 * 🚧 The senders of the person rows on each channel after its newest visible
 * reply — `TurnOrderSelection.sentSinceReply`. Hidden rows and narration
 * (`isNarratorResponse`, a side note) are skipped; a row from no seat (no persona, no `player-seat:` speaker) is counted by nobody.
 */
export function sentSinceReply(
	messages: readonly RotationMessage[]
): Record<string, string[]> {
	const out: Record<string, string[]> = {}
	const closed = new Set<string>()
	for (let i = messages.length - 1; i >= 0; i--) {
		const row = messages[i]
		// Narration is a side note, outside the rotation (`countedTurns`):
		// it neither closes the window nor counts in it.
		if (!row || row.isHidden || row.isNarratorResponse) continue
		const channel = formatChannel(parseChannel(row.channel ?? DEFAULT_CHANNEL))
		if (closed.has(channel)) continue
		if (row.role !== "user") {
			closed.add(channel)
			continue
		}
		const ref = senderRefOf(row)
		if (!ref) continue
		const list = (out[channel] ??= [])
		if (!list.includes(ref)) list.push(ref)
	}
	return out
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
		sinceUser: turns.length - 1 - lastUserIndex(turns),
		voiceEntries: narratorEntries(messages),
		sentSinceReply: sentSinceReply(messages)
	}
}

/**
 * 🚧 **Unprompted turns** (`core:task/turn-unprompted@1`; PLAN-genre-restructure
 * §4 voices group, lane 2, 2026-10-19): the order the strategy prepared,
 * with at most ONE entry put at its head once the round is over — an AI
 * voice speaking without being asked. Pure: what the session's genre
 * settings switched on (`modes` — Story's *Let others speak up* and
 * *Narrator asides*, read by `core:script/unprompted-modes`) over the
 * history the recompute already read.
 *
 * The round is over when the order holds nothing an AI still has to say —
 * empty, or only people's seats (a persona's or a card-less player seat's
 * entry) — and somebody has answered the person since their newest line on
 * `main`. Before that, or with both off, the order passes through
 * untouched. 🚧 The `modes` are no host task lookup (lane 6): the genre's
 * settings `sideCast` and `narratorInterjections`, mapped onto these keys by
 * the seeded script the turn-order pipeline runs. Each voice comes once a
 * round:
 *
 *  · `side-cast` — a seated character who did not speak last (the
 *    earliest of this round's speakers first) speaks up again; done once
 *    any character has two lines since the person's;
 *  · `narrator-interjections` — the narrator's own line (`narrate`, the
 *    genre's Narrate action; a plain reply in no one's voice when unset);
 *    done once a narration landed since the person's line.
 *
 * The person's next line opens a new round, and the recompute it causes
 * prepares none of these (nobody has answered yet), so an unfired one
 * never outlives its round.
 */
export function unpromptedEntries(
	order: readonly TurnEntry[],
	candidates: readonly TurnCandidate[],
	messages: readonly RotationMessage[],
	modes: Readonly<Record<string, unknown>>,
	opts: { narrate?: string } = {}
): TurnEntry[] {
	const kept = [...order]
	const on = (key: string) => modes[key] === "full" || modes[key] === "review"
	const side = on("side-cast")
	const narrator = on("narrator-interjections")
	if (!side && !narrator) return kept
	const main = messages.filter(
		(m) => !!m && !m.isHidden && parseChannel(m.channel ?? DEFAULT_CHANNEL).slug === DEFAULT_CHANNEL
	)
	let at = -1
	for (let i = main.length - 1; i >= 0; i--)
		if (main[i]!.role === "user") {
			at = i
			break
		}
	if (at < 0) return kept
	const since = main.slice(at + 1)
	const replies = since.filter((m) => m.role === "assistant" && !m.isNarratorResponse)
	if (!replies.length && !since.some((m) => m.isNarratorResponse)) return kept
	const people = new Set(
		candidates.filter((c) => c.kind === "persona").map((c) => String(c.ref))
	)
	const isPersons = (e: TurnEntry) =>
		typeof e.ref === "string" && (people.has(e.ref) || e.ref.startsWith("player-seat:") || e.ref.startsWith("user:"))
	if (kept.some((e) => !isPersons(e))) return kept

	if (side) {
		const lines = new Map<number, number>()
		const firstAt = new Map<number, number>()
		replies.forEach((m, i) => {
			if (m.characterId == null) return
			lines.set(m.characterId, (lines.get(m.characterId) ?? 0) + 1)
			if (!firstAt.has(m.characterId)) firstAt.set(m.characterId, i)
		})
		const spokeTwice = [...lines.values()].some((n) => n > 1)
		const last = replies[replies.length - 1]?.characterId ?? null
		if (!spokeTwice) {
			const idOf = (c: TurnCandidate) => Number(String(c.ref).slice("character:".length))
			const seated = candidates.filter(
				(c) => c.kind === "character" && String(c.ref).startsWith("character:") && idOf(c) !== last
			)
			const pick = [...seated].sort(
				(a, b) =>
					(firstAt.get(idOf(a)) ?? Number.MAX_SAFE_INTEGER) - (firstAt.get(idOf(b)) ?? Number.MAX_SAFE_INTEGER)
			)[0]
			if (pick) return [{ ref: pick.ref, via: "unprompted" }, ...kept]
		}
	}
	if (narrator && !since.some((m) => m.isNarratorResponse))
		return [
			{ ref: null, via: "unprompted", ...(opts.narrate ? { subject: opts.narrate } : {}) },
			...kept
		]
	return kept
}
