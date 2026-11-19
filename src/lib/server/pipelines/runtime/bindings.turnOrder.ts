/**
 * Turn-order bindings: the six strategies behind `turnEntries`, the pool, and
 * the mentioned and unprompted orderers. `coreBindings()` spreads this map.
 *
 * Imports helpers from `bindings.shared.ts`, never from `bindings.ts`.
 */

import { isCardlessPlayerSeat } from "$lib/server/sessions/seatName"
import { inPlay } from "$lib/shared/sessions/inPlay"
import { memberFormOn } from "$lib/server/state/memberForm"
import type { Bindings } from "@serene-pub/sdk"
import { ok, reads, type ParticipantRef } from "@serene-pub/sdk"
import { i18nTextIn } from "$lib/shared/i18n/i18nText"
/**
 * The node declarations themselves, as types.
 *
 * `import type`, so `verbatimModuleSyntax` erases it outright: importing
 * contracts for real would run `describeQueryDefinition`'s `register()` for every core
 * type as a side effect of loading the runtime, which is the boot sequence's job
 * and not this file's.
 */
import type * as C from "@serene-pub/contracts"
import type { NodeInput, SharedInput, TaskCtx } from "./bindingTypes"
import {
	inTurnEnvoys,
	mentionedFirst,
	narratorEntries,
	unpromptedEntries,
	rotationTurns,
	senderRefOf,
	seatRefLookupOfCast,
	roundRobinEntries,
	turnOrderSelection,
	userSplitEntries,
	type CastRead,
	type RotationMessage,
	type TurnCandidate,
	type TurnEntry
} from "$lib/server/pipelines/runtime/speakerRotation"
import { seatRefLookupOfCandidates } from "./bindings.shared"

/**
 * One next-speaker implementation behind six type ids (19 §5, U-C4; the one
 * decider since the socket pre-pick retired, 2026-09-21).
 *
 * The rules, in order:
 *
 * 1. **An explicit pick always wins.** `speaker` on the in-port — a
 *    participant reference, `character:<id>` or `envoy:<slug>` (R-18 (3)) —
 *    means the trigger already decided — the "Trigger Character" picker, a
 *    regen — and every strategy's only job then is to record it (`via:
 *    'pick'`). The bare `characterId` in-port says the same one release
 *    longer, and is read when `speaker` is unwired or null.
 * 2. Otherwise the strategy decides, over the rules in `speakerRotation.ts`:
 *    `round-robin` (once per turn of the person's), `user-split` (the
 *    sender's own seats first), `random` (seeded, so a replay seats the
 *    same speaker), `scripted` (the `select` chain, `due` as its fallback).
 *    `manual` and `none` never decide — they differ in what the UI offers
 *    (a picker vs no speaker system at all), not in what the node computes.
 * 3. **A deciding strategy with candidates that seats none halts**
 *    (`NOBODY_DUE`): nothing before this node has an effect, and the
 *    trigger reads the halt as quiet. With nobody to choose from, and under
 *    manual and none, a null pick passes on instead — an action fired with
 *    no speaker, or a genre that seats nobody, still runs, its prompts
 *    naming the voice.
 *
 * Published both ways: `speaker` as a reference — the strategy's own pick
 * spelled `character:<id>` — and `characterId` as the bare id, null for an
 * envoy, for the context and generation consumers that still take the id.
 */
/** The six strategies `turnEntries` serves — one implementation, six ids. */
const TURN_STRATEGIES = [
	"core:task/turn-round-robin@1",
	"core:task/turn-user-split@1",
	"core:task/turn-random@1",
	"core:task/turn-scripted@1",
	"core:task/turn-manual@1",
	"core:task/turn-narrator@1"
] as const

type TurnStrategyName =
	| "round-robin"
	| "user-split"
	| "random"
	| "scripted"
	| "manual"
	| "narrator"

/**
 * The six strategies (PLAN-turn-order §4.4, A6): candidates in, **entries**
 * out, one implementation behind six ids.
 *
 * Every one of them reads the same two ports — the candidates the pool
 * admitted (through any orderers) and the session's visible history — and
 * publishes the same shape: a list of prepared turns. None of them halts.
 * An empty order is the answer when nobody is due, which is the ordinary
 * state of a cast that has all spoken since the person did; the halt this
 * replaced (`nobody is due`) made an ordinary state look like a failure and
 * made the trigger learn about turn-taking to read it.
 *
 * There is no `speaker` in-port any more either. An explicit pick never
 * enters a strategy: a person's press fires the entry directly (§4.6) and
 * the next recompute sees the row it produced.
 */
function turnEntries(strategy: TurnStrategyName) {
	return reads<
		[
			typeof C.turnRoundRobin,
			typeof C.turnUserSplit,
			typeof C.turnRandom,
			typeof C.turnScripted,
			typeof C.turnManual,
			typeof C.turnNarrator
		]
	>(
		async (
			input: SharedInput<
				[
					typeof C.turnRoundRobin,
					typeof C.turnUserSplit,
					typeof C.turnRandom,
					typeof C.turnScripted,
					typeof C.turnManual,
					typeof C.turnNarrator
				]
			>,
			ctx: TaskCtx
		) => {
			const candidates = (input?.candidates ?? []) as TurnCandidate[]
			const messages = (input?.messages ?? []) as RotationMessage[]
			const done = (order: TurnEntry[]) => ok({ main: order, order })
			// ⏳ The cast lookup, from the candidates (member form once on).
			const refOfMember = seatRefLookupOfCandidates(candidates)

			// Manual prepares nothing: every turn here is a press (§4.4).
			if (strategy === "manual") return done([])

			/**
			 * The narrator strategy (§4.4): one entry in the pipeline's own
			 * voice after a person's line, none after a reply — per channel
			 * the history holds, newest line first (lair re-plan R5;
			 * `narratorEntries`). This is how a planner genre gets exactly
			 * one reply per send — its pool admits nobody, so there is no
			 * seat for the entry to name.
			 */
			if (strategy === "narrator") return done(narratorEntries(messages))

			if (strategy === "round-robin")
				return done(roundRobinEntries(candidates, messages, refOfMember))
			if (strategy === "user-split")
				return done(userSplitEntries(candidates, messages, refOfMember))
			if (strategy === "random") {
				// One seeded draw over the not-yet-spoken candidates. The seed
				// is the run's, so a replay re-rolls identically and an
				// unrelated recompute may not — documented, not prevented.
				const due = roundRobinEntries(candidates, messages, refOfMember)
				if (!due.length) return done([])
				const random: () => number = ctx?.random ?? (() => 0)
				return done([due[Math.floor(random() * due.length)]!])
			}

			/**
			 * Scripted: round robin, with the `select` point free to rewrite
			 * it. A chain that returns nothing usable leaves the order as it
			 * was; an entry naming a ref the pool did not admit is dropped
			 * with a note, because a script may reorder the turn but may not
			 * invent a participant. Entries the chain changed carry
			 * `via: 'script'`.
			 */
			const selection = turnOrderSelection(candidates, messages, refOfMember)
			const out = (await ctx?.scripts?.apply("select", selection)) ?? selection
			const returned =
				out && typeof out === "object"
					? (out as { order?: unknown }).order
					: undefined
			if (!Array.isArray(returned)) return done(selection.order)
			const admitted = new Set<string>(candidates.map((c) => String(c.ref)))
			const kept: TurnEntry[] = []
			for (const raw of returned) {
				if (!raw || typeof raw !== "object") continue
				const entry = raw as TurnEntry
				if (entry.ref !== null && !admitted.has(String(entry.ref))) {
					ctx?.log(
						"warn",
						`the select chain named '${String(entry.ref)}', which is not a candidate — dropped`
					)
					continue
				}
				kept.push({ ...entry, via: entry.via ?? "script" })
			}
			return done(kept)
		},
		{ ports: ["candidates", "messages"] }
	)
}

export function turnOrderBindings(): Bindings {
	return {
		// The six turn strategies (PLAN-turn-order §4.4). One implementation,
		// six ids — see `turnEntries` above.
		"core:task/turn-round-robin@1": turnEntries("round-robin"),
		"core:task/turn-user-split@1": turnEntries("user-split"),
		"core:task/turn-random@1": turnEntries("random"),
		"core:task/turn-scripted@1": turnEntries("scripted"),
		"core:task/turn-manual@1": turnEntries("manual"),
		"core:task/turn-narrator@1": turnEntries("narrator"),
		/**
		 * The pool (§4.4): who may be seated at all, from the settings
		 * document's cast. Floors no param overrides — a seat out of play
		 * (removed or benched, `inPlay`) and an `on-action` envoy are never
		 * candidates — and an output order of
		 * characters, then personas, then envoys, each by position.
		 */
		"core:task/turn-pool@1": reads<typeof C.turnPool>(
			async (input: NodeInput<typeof C.turnPool>) => {
				const cast = (input?.cast ?? {}) as CastRead
				const params = (input?.params ?? {}) as {
					characters?: string
					personas?: string
					envoys?: string
					envoySlugs?: unknown
				}
				const messages = (input?.messages ?? []) as RotationMessage[]
				const out: TurnCandidate[] = []

				const characters = params.characters ?? "active"
				if (characters !== "none")
					for (const cc of (cast.sessionCharacters ?? [])
						.map((cc, index) => ({ cc, position: cc.position ?? index }))
						.filter(
							({ cc }) =>
								cc.character &&
								// The bench is read by `inPlay`, the one rule (owner
								// 2026-11-10): a removed or benched seat is never a
								// candidate, whatever `characters` says.
								inPlay(cc) &&
								// A candidate needs a ref: the host's, else a card's;
								// a seat with neither is nobody addressable.
								(cc.ref || cc.character.id != null)
						)
						.sort((a, b) => a.position - b.position)) {
						// ⚠ Owner: a seat's card owns it only when it HAS a card;
						// a card-less seat is acted for by whoever seated it
						// (`seatedByUserId`, ★S2b-1) — never a card's `userId`.
						const ownerUserId =
							cc.cc.character!.id != null
								? cc.cc.character!.userId
								: cc.cc.seatedByUserId
						out.push({
							// ⏳ The row's host-filled ref (member form once
							// `state/memberForm.ts` is on), else the card form.
							ref: ((cc.cc.ref as ParticipantRef | null | undefined) ||
								`character:${cc.cc.character!.id}`) as ParticipantRef,
							kind: "character",
							name: cc.cc.character!.name ?? "",
							position: cc.position,
							...(ownerUserId != null ? { ownerUserId } : {}),
							// ⏳ Member form only: the seat's member, so the turn rules
							// can read a transcript row's `castMemberId` as this seat.
							...(memberFormOn() && cc.cc.castMemberId != null
								? { castMemberId: cc.cc.castMemberId }
								: {})
						})
					}

				// Personas are candidates (R15): a person's entry is shown as
				// their turn and never fired — that is how a session says it
				// is your turn. `others` leaves out whoever just wrote.
				const personas = params.personas ?? "all"
				if (personas !== "none") {
					const turns = rotationTurns(messages)
					let lastSender: ParticipantRef | null = null
					// 🚧 The sender named by the cast in hand (seat-cast S3): a row
					// with a `castMemberId` the cast answers is that seat's ref.
					const refOfMember = seatRefLookupOfCast(cast)
					for (let i = turns.length - 1; i >= 0; i--)
						if (turns[i]!.role === "user") {
							lastSender = senderRefOf(turns[i]!, refOfMember)
							break
						}
					for (const { cp, position } of (cast.sessionPersonas ?? [])
						.map((cp, index) => ({ cp, position: cp.position ?? index }))
						// A seat with a card, or 🚧 a card-less one with a
						// name; a departed card's leftover row is nobody, and a
						// benched seat is never a candidate (`inPlay`).
						.filter(
							({ cp }) => inPlay(cp) && (cp.persona ? true : isCardlessPlayerSeat(cp))
						)
						.sort((a, b) => a.position - b.position)) {
						// A participant is addressed by its card when it has
						// one: a persona IS a character row (0132), so
						// `character:<id>`; a card-less player seat is `player-seat:<id>`.
						// `kind` is the role either way (PLAN §8 (8)).
						// ⏳ The row's host-filled ref (`player-seat:<id>` once
						// `state/memberForm.ts` is on), else the card form.
						const ref: ParticipantRef =
							(cp.ref as ParticipantRef | null | undefined) ||
							(cp.persona
								? `character:${cp.persona.id}`
								: `player-seat:${cp.seatId}`)
						if (personas === "others" && ref === lastSender) continue
						// A seat's person is its `user_id`; a row from before that
						// column reads its card's owner.
						const ownerUserId = cp.seatUserId ?? cp.persona?.userId
						out.push({
							ref,
							kind: "persona",
							name: cp.persona?.name ?? cp.seatName ?? "",
							position,
							...(ownerUserId != null ? { ownerUserId } : {}),
							...(memberFormOn() && cp.castMemberId != null
								? { castMemberId: cp.castMemberId }
								: {})
						})
					}
				}

				const envoysParam = params.envoys ?? "in-turn"
				if (envoysParam !== "none") {
					const slugs = new Set(
						(Array.isArray(params.envoySlugs) ? params.envoySlugs : []).map(
							String
						)
					)
					for (const e of inTurnEnvoys(cast)) {
						if (envoysParam === "only" && !slugs.has(e.slug)) continue
						if (envoysParam === "except" && slugs.has(e.slug)) continue
						out.push({
							ref: `envoy:${e.slug}`,
							kind: "envoy",
							name: i18nTextIn(e.name) ?? e.slug,
							position: e.position
						})
					}
				}
				return ok({ main: out })
			},
			{
				ports: ["cast", "messages"],
				params: ["characters", "personas", "envoys", "envoySlugs"]
			}
		),
		/**
		 * The mentioned orderer (R8): whoever the person named goes first.
		 * The receipt records which refs matched, so "why did Bram answer"
		 * is answerable from the run.
		 */
		"core:task/turn-mentioned@1": reads<typeof C.turnMentioned>(
			async (input: NodeInput<typeof C.turnMentioned>, ctx: TaskCtx) => {
				const lookback = Number(
					(input?.params as { lookback?: unknown })?.lookback ?? 1
				)
				const { candidates, mentioned } = mentionedFirst(
					(input?.candidates ?? []) as TurnCandidate[],
					(input?.messages ?? []) as RotationMessage[],
					Number.isFinite(lookback) ? lookback : 1
				)
				if (mentioned.length)
					ctx?.log("info", `mentioned: ${mentioned.join(", ")}`)
				return ok({ main: candidates, mentioned })
			},
			{ ports: ["candidates", "messages"], params: ["lookback"] }
		),
		/**
		 * 🚧 Unprompted turns (lane 2, 2026-10-19): the voices group's tasks
		 * over the order a strategy prepared — at most one entry at its head
		 * once the round is over (`unpromptedEntries`). Pure.
		 */
		"core:task/turn-unprompted@1": reads<typeof C.turnUnprompted>(
			async (input: NodeInput<typeof C.turnUnprompted>, ctx: TaskCtx) => {
				const before = (input?.order ?? []) as TurnEntry[]
				const modes =
					input?.modes && typeof input.modes === "object" && !Array.isArray(input.modes)
						? (input.modes as Record<string, unknown>)
						: {}
				const narrate = (input?.params as { narrate?: unknown } | undefined)?.narrate
				const order = unpromptedEntries(
					before,
					(input?.candidates ?? []) as TurnCandidate[],
					(input?.messages ?? []) as RotationMessage[],
					modes,
					typeof narrate === "string" && narrate.trim() ? { narrate: narrate.trim() } : {}
				)
				if (order.length > before.length)
					ctx?.log("info", `unprompted: ${order[0]!.ref ?? "the narrator"}`)
				return ok({ main: order, order })
			},
			{ ports: ["order", "candidates", "messages", "modes"], params: ["narrate"] }
		),
	}
}

export { TURN_STRATEGIES }
