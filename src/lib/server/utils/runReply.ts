/**
 * A reply, generated — the one road (09-B B4, R-17).
 *
 * ## What this replaced
 *
 * There were two. `generateResponse` compiled the turn with a preview halt,
 * took the payload the pipeline stopped with, and let a connection adapter
 * send it and stream into a row the *trigger* had inserted; `create-message`
 * never ran on a chat turn, and four receipt patches wrote afterwards what
 * the run had not seen. `runReplyToCompletion` ran a multi-step spec to the
 * end and redirected its first `create-message` into the trigger's row through
 * a fill-in id on the host scope. Either way the pipeline's outlet was bypassed or
 * aimed at a row it had not made, and 01 §7's "one primary write" was an
 * imperative insert in a socket handler.
 *
 * ## What runs now
 *
 * Every reply runs end to end: inlet → placeholder → … → oracle → update. The
 * spec creates its own row at its placeholder outlet — the composer's
 * placeholder IS that row, announced from the commit — the oracle's binding
 * runs and its stream is routed by core to that row, and the spec's last
 * outlet fills it. A regenerate, swipe or extend hands its existing row in on
 * the inlet's `messageId` and the same outlet claims it instead of inserting.
 * Nothing here inserts a message.
 *
 * ## One stop, one guarantee
 *
 * The run is registered with `runRegistry`, so it can be stopped from either
 * surface a person has: the message's own Stop (`sessionMessages:cancel`) and
 * the progress card's X (`pipelines:cancelRun`). Both end at the ONE
 * `AbortController`, the registry's; from there the fact travels in each
 * boundary's own shape — the adapter gets the signal as an event, the LLM queue
 * as a cancel, and the executor polls `cancellation()` between nodes and
 * converts an oracle that halted on its abort into a cancelled run. Stop is
 * then a run-level guarantee: the executor tells the host once when the run
 * ends, and a row the run created but never filled is finalised there with the
 * partial text (`liveRow.ts`). No node has to run to keep that promise.
 */

import { eq } from "drizzle-orm"
import { v4 as uuidv4 } from "uuid"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { ComposedError } from "$lib/server/connections/visibility"
import { persistGenerationErrorRow } from "./generationStatus"
import { turnDirectionText } from "$lib/server/sessions/turnDirection"
import { spineProviders } from "$lib/server/pipelines/runtime/specShape"
import { announceStateChanges } from "$lib/server/state/announce"
import type { RunProgress } from "$lib/shared/sockets/progress"
import {
	livePresenceIds,
	type SideCharacterFact
} from "$lib/server/pipelines/entities/sideCharacter"
import {
	envoySlugOfRef,
	sessionEvents,
	type EnvoyRef,
	type ParticipantRef,
	type Receipt
} from "@serene-pub/sdk"
import { CORE_ACTION_SPEC } from "$lib/shared/actions/identity"

/**
 * The progress card's step word when a step has said nothing yet — generic
 * and sentence-cased, **never a node key** (lair pass B18, owner D5). A key
 * is an address in a document, not copy: `planWrite` once reached the card
 * as "Plan Write". What a step IS arrives as its declared status
 * (`expose.status`) through the status relay, and is shown in place of this.
 */
export const STEP_WORD = "Thinking"

/**
 * What kind of reply this is — the trigger's own decision, and the only thing
 * the trigger still decides. Who portrays it is resolved before the run
 * because the answer is data the inlet carries (U5a moves it to run start).
 */
export type ReplyTurn =
	/**
	 * The next speaker's turn — the composer's reply, or "Trigger Character".
	 * A library character by id, or a seated **envoy** by reference
	 * (`envoy:<slug>`, R-18; U5g) — the genre's speaker, which no id can
	 * name. Exactly one of the two.
	 */
	| { kind: "respond"; characterId: number; speaker?: undefined }
	| { kind: "respond"; characterId?: null; speaker: EnvoyRef }
	/**
	 * Nobody named: the pipeline's own voice — a narrator entry
	 * (`{ ref: null }`, PLAN-turn-order §4.4). The spec's prompts say whose
	 * voice that is; no node decides anything about turn-taking.
	 */
	| { kind: "respond"; characterId?: null; speaker?: undefined }
	/** World narration, on the narrator's own button. */
	| { kind: "narrate"; instructions?: string }
	/** A side character speaks once, and joins nothing. */
	| {
			kind: "narrate-character"
			speaker: SideCharacterFact
			instructions?: string
	  }
	/**
	 * A message verb re-driving a row that already exists — the row is
	 * already generating, as the verb's handler left it, and what it was
	 * (a character's reply, narration, a side character's line) is read off
	 * it. `extend` keeps the row's text as the prefill the model continues
	 * from; the other two cleared it — and a regenerate's handler, the only
	 * party that saw the text before clearing it, hands it in as `previous`
	 * so the finishing write can record what the regenerate replaced (U5b
	 * review W3).
	 */
	| {
			kind: "regenerate"
			messageId: number
			previous?: { content: string }
	  }
	| { kind: "swipe" | "extend"; messageId: number }

export interface ReplyRequest {
	socket: any
	emitToUser: (event: string, data: any) => void
	sessionId: number
	userId: number
	turn: ReplyTurn
	/**
	 * Which channel this reply is being asked for on — the stored string,
	 * lane included (`main`, `manuscript`, `phone:3`). Absent means `main`,
	 * which is every session whose genre declares no channel of its own, and
	 * every trigger that has not grown a per-channel composer yet.
	 *
	 * ⚠ A **verb** does not take it from here: the row it re-drives is the
	 * trigger, and that row already stores which channel it is on. A caller
	 * that passed a different one would be asking to regenerate a line of the
	 * manuscript into the conversation, so the row wins and this is read only
	 * on a fresh turn.
	 */
	channel?: string
	/**
	 * How the fired entry was reached (lair pass R8): `narrate` for the
	 * `core#narrate` press, else the entry's own `via`. A **verb** does not
	 * take it from here either: it re-drives a row, and the row's creating
	 * run recorded how it was reached — so a regenerated narration narrates
	 * again (`recordedViaOf`).
	 */
	via?: string
	/**
	 * This run was started by auto-advance (PLAN-turn-order §4.6), not by a
	 * press. Carried onto the run so every write it makes says so, which is
	 * what lets the recompute that follows tell an automatic turn from a
	 * person's and continue — or stop — a `round`.
	 */
	auto?: boolean
}

export interface ReplyOutcome {
	/** The run went to the end and wrote its reply. */
	ok: boolean
	/** Somebody stopped it. */
	stopped?: boolean
	/** Why there was no reply, in a sentence the trigger may answer with. */
	error?: string
	/**
	 * The error is already on a message row the person can see — the run's
	 * own placeholder, or the row a verb re-drove. A trigger tells the client
	 * only when it is not: a fresh turn refused before it made a row has no
	 * other way to be heard.
	 */
	shown?: boolean
	receipt?: Receipt
}

/**
 * Which **subject** and floor spec serve a turn (plans/31 V2: one identity).
 * The primary turn is the core event `message-respond`, which a preset or a
 * session binding routes among the bucket. The two narrator turns (the
 * narrator split, ruling 2026-09-07) are the narrator actions by identity —
 * their declarer serves them. The extend verb (ruling 2026-09-08, D-2) is
 * a turn of its own that happens to start from text: its subject is the
 * verb's identity `core#extend`, which no spec declares, so it always
 * takes its floor — `respond`, the spec carrying the `continuationPrefill`
 * port. `label` is the short word the progress card shows.
 */
async function routeFor(
	turn: ReplyTurn,
	existing: SelectSessionMessage | null
): Promise<{
	subject: string
	label: string
	floorSpecId: string
	currentCharacterId: number | null
	/** The side-character fact, on a narrate-character turn. */
	speaker: SideCharacterFact | null
	/**
	 * The turn's speaker as a participant reference, when it is one no id
	 * can carry — an envoy's (`envoy:<slug>`). Absent on every other road,
	 * where `runTurn` derives `character:<id>` from `currentCharacterId`.
	 */
	speakerRef?: ParticipantRef
	narration: boolean
}> {
	const { NARRATE_SPEC_ID, NARRATE_CHARACTER_SPEC_ID } = await import(
		"$lib/server/pipelines/specs/narrate"
	)
	const { RESPOND_SPEC_ID } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	if (turn.kind === "respond")
		return {
			subject: sessionEvents.messageRespond,
			label: "respond",
			floorSpecId: RESPOND_SPEC_ID,
			currentCharacterId: turn.speaker ? null : (turn.characterId ?? null),
			speaker: null,
			...(turn.speaker ? { speakerRef: turn.speaker } : {}),
			narration: false
		}
	if (turn.kind === "narrate")
		return {
			subject: `${NARRATE_SPEC_ID}#narrate`,
			label: "narrate",
			floorSpecId: NARRATE_SPEC_ID,
			currentCharacterId: null,
			speaker: null,
			narration: true
		}
	if (turn.kind === "narrate-character")
		return {
			subject: `${NARRATE_CHARACTER_SPEC_ID}#narrate-character`,
			label: "narrate-character",
			floorSpecId: NARRATE_CHARACTER_SPEC_ID,
			// The side character's id reaches the RUN but never the row: it
			// is what makes character lore bound to them visible, while the
			// row stays narration with a null `characterId`.
			currentCharacterId: turn.speaker.characterId,
			speaker: turn.speaker,
			narration: true
		}
	// A verb: what the row was decides which pipeline re-drives it. Read off
	// the row rather than recomputed — the trigger that made it resolved the
	// speaker, and a second resolution here would be free to disagree with the
	// name already snapshotted on it.
	const narration = !!existing?.isNarratorResponse
	const speaker =
		(narration &&
			((existing?.metadata as any)?.sideCharacter as
				| SideCharacterFact
				| undefined)) ||
		null
	// An envoy's row carries its reference and no `characterId` (U5g): the
	// verb re-drives it as the envoy's turn, which nothing else could say.
	const envoySlug = envoySlugOfRef((existing?.metadata as any)?.speaker)
	if (narration)
		return speaker
			? {
					subject: `${NARRATE_CHARACTER_SPEC_ID}#narrate-character`,
					label: "narrate-character",
					floorSpecId: NARRATE_CHARACTER_SPEC_ID,
					currentCharacterId: speaker.characterId,
					speaker,
					narration
				}
			: {
					subject: `${NARRATE_SPEC_ID}#narrate`,
					label: "narrate",
					floorSpecId: NARRATE_SPEC_ID,
					currentCharacterId: null,
					speaker: null,
					narration
				}
	return {
		subject: turn.kind === "extend" ? `${CORE_ACTION_SPEC}#extend` : sessionEvents.messageRespond,
		label: turn.kind === "extend" ? "extend" : "respond",
		floorSpecId: RESPOND_SPEC_ID,
		currentCharacterId: existing?.characterId ?? null,
		speaker: null,
		...(envoySlug ? { speakerRef: `envoy:${envoySlug}` as EnvoyRef } : {}),
		narration
	}
}

export async function runReply(request: ReplyRequest): Promise<ReplyOutcome> {
	const { socket, emitToUser, sessionId, userId, turn } = request

	/**
	 * The row a verb re-drives, when this is one. Its generating state is
	 * the verb's own write; the run's placeholder claims it. A verb's
	 * failures land on this row, because it exists and is spinning; a fresh
	 * turn that cannot start has no row and answers the trigger instead.
	 */
	const existing =
		turn.kind === "regenerate" ||
		turn.kind === "swipe" ||
		turn.kind === "extend"
			? ((await db.query.sessionMessages.findFirst({
					where: (m, { eq }) => eq(m.id, turn.messageId)
				})) ?? null)
			: null
	const messageId = existing?.id
	/**
	 * The channel this turn is triggered on (R-C, 2026-09-17) — the row's own
	 * when a verb re-drives one, else what the trigger said, else `main`.
	 *
	 * The row first because it *is* the trigger for a verb: a regenerate of a
	 * line of the manuscript is a turn on the manuscript however the caller
	 * spelled its request.
	 */
	const channel = existing?.channel ?? request.channel
	/**
	 * How the turn was reached (R8) — the row's creating run's for a verb
	 * (that run's inlet recorded it), else the trigger's.
	 */
	const via = existing
		? await (
				await import("$lib/server/sessions/turnYield")
			).recordedViaOf(db, existing.id)
		: request.via
	const refuse = async (reason: string): Promise<ReplyOutcome> => {
		if (messageId !== undefined)
			await persistGenerationErrorRow(
				socket.io,
				sessionId,
				messageId,
				new ComposedError(reason),
				{ userId }
			)
		return { ok: false, error: reason, shown: messageId !== undefined }
	}

	// A session whose mode disappeared is read-only (19 §6): every generation
	// path funnels through here, so this one guard is the whole rule. The
	// standard mode is the F29 floor, so ordinary sessions can never trip it.
	{
		const { sessionGenreAvailable } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const modeCheck = await sessionGenreAvailable(db, sessionId)
		if (!modeCheck.available) return await refuse(modeCheck.reason!)
	}

	const route = await routeFor(turn, existing)

	/**
	 * Subject routing (19 §3; plans/31 V2): the turn names its subject — the
	 * primary turn's event, a narrator action's identity — and the genre's
	 * bucket or the declarer answers it. The verdict rather than the slug
	 * (ruled 2026-09-10): a preset binding that stopped resolving must not
	 * refuse the reply, and the run it falls back to has to be able to say
	 * what it substituted. A null resolution falls to the F29 floor.
	 */
	const { resolveSubjectVerdict, STANDARD_GENRE_ID } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const [sessionRow] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!sessionRow) return await refuse("Session not found.")
	const routed = await resolveSubjectVerdict(
		db,
		sessionRow.genreId ?? STANDARD_GENRE_ID,
		route.subject,
		{ sessionId }
	)
	const specId = routed.spec ?? route.floorSpecId
	const runMeta = routed.fallback
		? { meta: { preset: { via: "fallback" as const, ...routed.fallback } } }
		: {}

	const { loadPublished } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	const doc = await loadPublished(db, specId).catch(() => null)

	const runRegistry = await import(
		"$lib/server/pipelines/runtime/runRegistry"
	)
	const runId = uuidv4()
	// A `reply`, so the message's own Stop knows what this run is about — and
	// the verb's row from the start, where there is one; a fresh turn's row is
	// reported by the live row when the placeholder commits.
	const handle = runRegistry.start({
		runId,
		userId,
		sessionId,
		specId,
		kind: "reply",
		liveRow: messageId
	})
	const label = route.label
	// `session.generating` just rose: every member's action list follows
	// (U5e, review W-A1) — once per root at its start, the end push queued
	// behind it on the same session so a fast run cannot overtake it.
	const { pushSessionActions } = await import(
		"$lib/server/sessions/actionsPush"
	)
	void pushSessionActions(socket.io, sessionId)

	let declaredSteps = doc ? spineProviders(doc).length : 0
	let stepsSeen = 0
	const spine = new Set(doc ? spineProviders(doc).map((n) => n.key) : [])
	// `...event` is spread LAST, so it must never carry `runId` (or `specId`):
	// this run's key is decided here, and a frame keyed to another run — a
	// child's step, say — would be a card the client never saw start.
	const progress = (event: Record<string, unknown>) =>
		emitToUser("pipelines:progress", {
			runId,
			sessionId,
			specId,
			label,
			...event
		})
	emitToUser("pipelines:runStarted", {
		runId,
		sessionId,
		specId,
		label,
		steps: declaredSteps
	})

	const { haltExplanation, runTurn } = await import(
		"$lib/server/pipelines/runtime/runTurn"
	)

	/**
	 * A side character's seat as a participant reference — `character:<id>`
	 * for a library character, null for a free-form name — **unless the
	 * character is somebody's live presence in this session.** The picker
	 * never offers a presence (`listSideCharacterOptions`), and this is the
	 * belt to that braces: a presence named as the speaker would be pinned
	 * to its person by the resolver while the model narrates them. Left
	 * unset on every other road, where `runTurn` derives the reference from
	 * the cast member's id.
	 */
	const sideCharacterSeat = async () => {
		const id = route.speaker?.characterId
		if (id == null) return null
		return (await livePresenceIds(db, sessionId)).has(id)
			? null
			: (`character:${id}` as const)
	}

	let stopped: { by: string; reason: string } | undefined
	/**
	 * Hoisted out of `try` so the terminal `pipelines:progress` frame in
	 * `finally` can read the run's own outcome (R-19-adjacent — an outcome,
	 * not a status) rather than the two-flag `cancelled`/`error` reading
	 * that made an errored run's card say "Respond finished ✓".
	 */
	let receipt: Receipt | undefined
	/** Set when `catch` explained a throw that never got a receipt at all. */
	let caughtReason: string | undefined
	try {
		receipt = await runTurn({
			db,
			sessionId,
			userId,
			currentCharacterId: route.currentCharacterId,
			// The side-character fact, for the inlet's `sideCharacter` port;
			// the participant reference rides beside it (see `sideCharacterSeat`).
			sideCharacter: route.speaker
				? {
						...route.speaker,
						character: route.speaker.character as Record<
							string,
							unknown
						> | null
					}
				: null,
			...(route.speaker ? { speaker: await sideCharacterSeat() } : {}),
			// An envoy's turn: the reference is the whole identity (R-18 (3)).
			...(route.speakerRef ? { speaker: route.speakerRef } : {}),
			// The own voice's turn — a fired `{ ref: null }` entry — says so:
			// `null`, not absent, so the status relay names it (the progress
			// card's `{speaker}`, lair re-plan R5). Nothing else reads the
			// difference: `runTurn` derives null here anyway.
			...(turn.kind === "respond" &&
			route.currentCharacterId == null &&
			!route.speakerRef
				? { speaker: null }
				: {}),
			// A narrator turn's triggering text is the instructions the person
			// typed; the narrate specs store them beside the row. A reply's
			// is what the person sent since the last line that was not
			// theirs (lair pass B11): still a row in history too, but also
			// this turn's text, for a spec that reads it as something other
			// than dialogue — the Lair's planner reads it as direction. A
			// verb re-driving a reply reads the rows before that reply.
			text:
				turn.kind === "narrate" || turn.kind === "narrate-character"
					? (turn.instructions ?? "")
					: route.narration
						? ""
						: await turnDirectionText(db, sessionId, {
								channel,
								before: messageId
							}),
			// The partial, on the port that carries it to the seed line the
			// model continues from (ruling 2026-09-08, D-2). Absent on every
			// other turn.
			continuationPrefill:
				turn.kind === "extend" && existing?.content
					? existing.content
					: undefined,
			// Which channel the trigger is on, for the inlet's `channel` port
			// and for the seed line the channel's voice calls for (R-C).
			channel,
			// How the turn was reached, for the inlet's `via` port (R8).
			...(via ? { via } : {}),
			// The row a verb re-drives, for the placeholder outlet to claim —
			// and which verb, so the finishing write's `message-updated`
			// says so for the next reply's inlet (R-15).
			messageId,
			...(turn.kind === "regenerate" ||
			turn.kind === "swipe" ||
			turn.kind === "extend"
				? { verb: turn.kind }
				: {}),
			// What a regenerate replaced, for its `message-updated` (W3).
			...(turn.kind === "regenerate" && turn.previous
				? { previous: turn.previous }
				: {}),
			specId,
			runId,
			// Fired by auto-advance rather than pressed (§4.6).
			...(request.auto ? { auto: true } : {}),
			io: socket.io,
			signal: handle.controller.signal,
			cancelSignal: () => runRegistry.cancellation(handle),
			onNode: (event) => {
				if (event.kind !== "oracle" || event.phase !== "start") return
				if (!spine.has(event.nodeKey)) return
				stepsSeen += 1
				declaredSteps = Math.max(declaredSteps, stepsSeen)
				progress({
					stage: STEP_WORD,
					nodeKey: event.nodeKey,
					step: stepsSeen,
					steps: declaredSteps
				})
			},
			// The run's status (R-19), `{speaker}` already filled by the host,
			// onto the progress card's frame. The live row and the session
			// list were told by the host itself.
			onStatus: (nodeKey, status) => progress({ nodeKey, status }),
			...runMeta
		})

		// Read before `finish`: one projection of the abort, shared by every
		// branch below, so they cannot disagree about whether this turn was
		// stopped. The receipt says so too since the executor converts an
		// oracle that halted on its abort; the registry is still read because
		// it is the source, and it knows who.
		stopped = runRegistry.cancellation(handle)

		if (stopped) return { ok: false, stopped: true, receipt }
		// ⚠ There is no `nobodyDue` any more (PLAN-turn-order §7). A reply
		// run is started by FIRING a prepared entry, so "nobody is due" is
		// answered before a run exists — by an empty order — rather than by
		// a halt inside one. A halt here is a halt like any other.
		if (receipt.outcome !== "ok")
			return {
				ok: false,
				error:
					haltExplanation(receipt) ?? "The turn produced no reply.",
				// The run-end hook failed the row the placeholder made, if the
				// run got that far; a verb's row was there to fail either way.
				shown:
					messageId !== undefined ||
					handle.liveRow !== undefined ||
					// A branch's own placeholder counts (R8: each branch
					// opens the row it fills), wherever it sits.
					receipt.nodes.some(
						(n) =>
							n.nodeKey.split(".").pop() === "placeholder" &&
							n.result === "ok" &&
							!n.dry
					),
				receipt
			}
		return { ok: true, receipt }
	} catch (err) {
		stopped ??= runRegistry.cancellation(handle)
		if (stopped) return { ok: false, stopped: true }
		// The run itself could not start — no published spec, a database
		// that went away — or it threw on its way through. The live row, if
		// the run got as far as making one, was finalised by the executor's
		// run-end hook, which fires on a throw too; a verb's row that the run
		// never reached is failed here, and a fresh turn answers the trigger.
		console.error("[runReply] the reply could not run:", err)
		const reason =
			err instanceof ComposedError
				? err.message
				: err instanceof Error &&
					  /no published version/.test(err.message)
					? err.message
					: "The reply could not be generated."
		caughtReason = reason
		// Defensively, whatever the hook did: the row this run was filling —
		// the verb's, or the placeholder the registry learned of when it
		// opened — must not be left generating by a turn that is over.
		// `persistGenerationErrorRow` is fenced on `isGenerating`, so a row
		// the hook already settled is untouched; this is the backstop for a
		// hook that itself failed, not a second finalisation.
		const row = messageId ?? handle.liveRow
		if (row !== undefined) {
			await persistGenerationErrorRow(
				socket.io,
				sessionId,
				row,
				new ComposedError(reason),
				{ userId }
			)
			return { ok: false, error: reason, shown: true }
		}
		return await refuse(reason)
	} finally {
		// Always: a run left registered is a leak and a stale cancel target,
		// and the client's progress card would never clear.
		runRegistry.finish(runId)
		// `stopped` (the registry's own record) outranks the receipt: a node
		// that throws on abort ends the run as `err` before the executor ever
		// converts it, so a run the registry knows was cancelled must read as
		// cancelled here whatever the receipt says. Absent a receipt at all —
		// the run never started — the catch branch's own reason stands in.
		const outcome: NonNullable<RunProgress["outcome"]> = stopped
			? "cancelled"
			: (receipt?.outcome ?? "err")
		// The terminal frame first (review W-A6), as the trigger road orders
		// it: the card clears, then the list.
		progress({
			done: true,
			outcome,
			...(outcome === "cancelled" ? { cancelled: true } : {}),
			...(outcome === "err" || outcome === "halt"
				? {
						error:
							(receipt && haltExplanation(receipt)) ??
							caughtReason ??
							"The turn produced no reply."
					}
				: {}),
			...(outcome === "halt" && receipt?.haltNodeKey
				? { haltNodeKey: receipt.haltNodeKey }
				: {})
		})
		// The action list follows the run's end (U5e, review C1): the reply
		// is the newest row now and nothing is generating, so every member's
		// verdicts are re-sent by the server, once per finished root.
		try {
			await pushSessionActions(socket.io, sessionId)
		} catch (e) {
			console.warn("[runReply] the action list could not be re-sent:", e)
		}
		// The world's changes are announced AFTER the run has left the
		// registry and the list has gone out (review W-A3): a client that
		// relists on `state:changed` — a hand-set slot's road — then reads
		// `session.generating` false, and cannot race the push above.
		if (receipt) {
			try {
				await announceStateChanges(socket.io, sessionId, receipt)
			} catch (e) {
				console.warn("[runReply] the state changes could not be announced:", e)
			}
		}
	}
}
