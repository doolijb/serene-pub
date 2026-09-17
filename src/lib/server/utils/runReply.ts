/**
 * A reply, generated — the one road (09-B B4, R-17).
 *
 * ## What this replaced
 *
 * There were two. `generateResponse` compiled the turn with a preview halt,
 * took the payload the pipeline stopped with, and let a connection adapter
 * send it and stream into a row the *trigger* had inserted; `create-message`
 * never ran on a chat turn, and four receipt patches wrote afterwards what
 * the run had not seen. `runReplyToCompletion` ran a multi-stage spec to the
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
 * outlet fills it. A regenerate, swipe or continue hands its existing row in on
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
import { spineProviders } from "$lib/server/pipelines/runtime/specShape"
import { announceStateChanges } from "$lib/server/state/announce"
import type { RunProgress } from "$lib/shared/sockets/progress"
import {
	livePresenceIds,
	type SideCharacterFact
} from "$lib/server/pipelines/entities/sideCharacter"
import {
	envoySlugOfRef,
	type EnvoyRef,
	type ParticipantRef,
	type Receipt
} from "@serene-pub/sdk"

/** A node key as a person reads it: `voices.item.say` → "voices say". */
function stageOf(nodeKey: string): string {
	return nodeKey
		.split(".")
		.filter((part) => part !== "item")
		.join(" ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
}

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
	 * it. `continue` keeps the row's text as the prefill the model continues
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
	| { kind: "swipe" | "continue"; messageId: number }

export interface ReplyRequest {
	socket: any
	emitToUser: (event: string, data: any) => void
	sessionId: number
	userId: number
	turn: ReplyTurn
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
 * Which function key and floor spec serve a turn. Three functions since the
 * narrator split (ruling 2026-09-07), and a fourth for the continue verb
 * (ruling 2026-09-08, D-2): a continue is a turn of its own that happens to
 * start from text, keyed separately so a genre can bind it, with `respond`
 * as its floor because that is the spec carrying the `continuationPrefill`
 * port.
 */
async function routeFor(
	turn: ReplyTurn,
	existing: SelectSessionMessage | null
): Promise<{
	functionKey: string
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
			functionKey: "respond",
			floorSpecId: RESPOND_SPEC_ID,
			currentCharacterId: turn.speaker ? null : turn.characterId,
			speaker: null,
			...(turn.speaker ? { speakerRef: turn.speaker } : {}),
			narration: false
		}
	if (turn.kind === "narrate")
		return {
			functionKey: "narrate",
			floorSpecId: NARRATE_SPEC_ID,
			currentCharacterId: null,
			speaker: null,
			narration: true
		}
	if (turn.kind === "narrate-character")
		return {
			functionKey: "narrate-character",
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
					functionKey: "narrate-character",
					floorSpecId: NARRATE_CHARACTER_SPEC_ID,
					currentCharacterId: speaker.characterId,
					speaker,
					narration
				}
			: {
					functionKey: "narrate",
					floorSpecId: NARRATE_SPEC_ID,
					currentCharacterId: null,
					speaker: null,
					narration
				}
	return {
		functionKey: turn.kind === "continue" ? "continue" : "respond",
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
		turn.kind === "continue"
			? ((await db.query.sessionMessages.findFirst({
					where: (m, { eq }) => eq(m.id, turn.messageId)
				})) ?? null)
			: null
	const messageId = existing?.id
	const refuse = async (reason: string): Promise<ReplyOutcome> => {
		if (messageId !== undefined)
			await persistGenerationErrorRow(
				socket.io,
				sessionId,
				messageId,
				new ComposedError(reason)
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
	 * Function routing (19 §3): the trigger names a function, the genre's
	 * contributors answer it. The verdict rather than the slug (ruled
	 * 2026-09-10): a preset binding that stopped resolving must not refuse
	 * the reply, and the run it falls back to has to be able to say what it
	 * substituted. A null resolution falls to the F29 floor.
	 */
	const { resolveFunctionVerdict, STANDARD_GENRE_ID } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const [sessionRow] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!sessionRow) return await refuse("Session not found.")
	const routed = await resolveFunctionVerdict(
		db,
		sessionRow.genreId ?? STANDARD_GENRE_ID,
		route.functionKey,
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
	const label = route.functionKey

	let declaredStages = doc ? spineProviders(doc).length : 0
	let stagesSeen = 0
	const spine = new Set(doc ? spineProviders(doc).map((n) => n.key) : [])
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
		steps: declaredStages
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
			// A narrator turn's triggering text is the instructions the person
			// typed; the narrate specs store them beside the row. An ordinary
			// turn has no separate triggering text on this path — the user's
			// message is a row, read from history like every other row.
			text:
				turn.kind === "narrate" || turn.kind === "narrate-character"
					? (turn.instructions ?? "")
					: "",
			// The partial, on the port that carries it to the seed line the
			// model continues from (ruling 2026-09-08, D-2). Absent on every
			// other turn.
			continuationPrefill:
				turn.kind === "continue" && existing?.content
					? existing.content
					: undefined,
			// The row a verb re-drives, for the placeholder outlet to claim —
			// and which verb, so the finishing write's `message-updated`
			// says so for the next reply's inlet (R-15).
			messageId,
			...(turn.kind === "regenerate" ||
			turn.kind === "swipe" ||
			turn.kind === "continue"
				? { verb: turn.kind }
				: {}),
			// What a regenerate replaced, for its `message-updated` (W3).
			...(turn.kind === "regenerate" && turn.previous
				? { previous: turn.previous }
				: {}),
			specId,
			runId,
			io: socket.io,
			signal: handle.controller.signal,
			cancelSignal: () => runRegistry.cancellation(handle),
			onNode: (event) => {
				if (event.kind !== "oracle" || event.phase !== "start") return
				if (!spine.has(event.nodeKey)) return
				stagesSeen += 1
				declaredStages = Math.max(declaredStages, stagesSeen)
				progress({
					stage: stageOf(event.nodeKey),
					nodeKey: event.nodeKey,
					step: stagesSeen,
					steps: declaredStages
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

		await announceStateChanges(socket.io, sessionId, receipt)

		if (stopped) return { ok: false, stopped: true, receipt }
		if (receipt.outcome !== "ok")
			return {
				ok: false,
				error:
					haltExplanation(receipt) ?? "The turn produced no reply.",
				// The run-end hook failed the row the placeholder made, if the
				// run got that far; a verb's row was there to fail either way.
				shown:
					messageId !== undefined ||
					receipt.nodes.some(
						(n) =>
							n.nodeKey === "placeholder" &&
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
				new ComposedError(reason)
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
	}
}
