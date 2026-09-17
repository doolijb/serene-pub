/**
 * Firing an action — the one server path a press takes (19 §4; plans/29
 * R-15; 30 §U5c, §U5d).
 *
 * `sessions:triggerFunction` used to hold this whole road inside the handler:
 * which declaration was pressed, may THIS person press it, which spec serves
 * it, run it. The form-answer pipeline (U5d, 2026-09-17) needs the same road
 * from a different door — the `answer-form` outlet commits an oracle's answer
 * "exactly as a click would", which is only true if it IS the click's path —
 * so the road lives here and the handler keeps what only a socket has: the
 * session's trigger lock, the frames it emits, the relist afterwards.
 *
 * ## Who fires
 *
 * `actor.userId` is the acting user and the run's owner, always a member.
 * `actor.as`, when present, is the participant the fire is made **as** — a
 * form's addressee, when the answer pipeline answers for a participant the
 * AI portrays. An `as` fire is admitted only for a form (`blockId`) whose
 * addressee is that reference and whose portrayal, resolved now, is the
 * AI's; a person's fire on the same form is admitted only when the resolver
 * says they portray the addressee. **The addressee is the form's audience**
 * (R-15 *Forms*): the declaration's own audience decides an ordinary press,
 * and a form's addressee decides a press on that form.
 *
 * ## The effects line, at the fire
 *
 * A `world` action (its result touches cards, lore, settings, permissions)
 * is never a block's and never an oracle's to answer — refused here whether
 * the fire names a block or an `as`, whatever the write-time checks let
 * through (belt to the validator's braces).
 *
 * ## Lineage
 *
 * A fire dispatched by a run — the answer pipeline's — carries `lineage`, so
 * the action's run is the answer's child and the asking run's grandchild,
 * and the cycle caps (`lineage.ts`) are asked before it starts.
 */

import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import type { ParticipantRef, Receipt, StatusText } from "@serene-pub/sdk"
import { parseParticipantRef } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { RunProgress } from "$lib/shared/sockets/progress"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import * as runRegistry from "$lib/server/pipelines/runtime/runRegistry"
import {
	admitDescendant,
	type RunLineage
} from "$lib/server/pipelines/runtime/lineage"
import {
	participantRowId,
	resolvePortrayals
} from "$lib/server/pipelines/runtime/portrayals"
import { loadFormBlock, type FormFacts } from "$lib/server/messages/blocks"
import { recordSessionChange } from "$lib/server/messages/sessionChanges"

export interface FireActionRequest {
	sessionId: number
	function: string
	/** The declaration pressed — `<spec slug>#<key>`. Absent is the legacy shape: owner floor. */
	action?: string
	/** The message the press was on, when it was on one. */
	messageId?: number
	/** The form the press answers — a block id within `messageId`. */
	blockId?: string
	/** What the press sent: a form's answer, a widget's args. */
	payload?: Record<string, unknown>
	actor: { userId: number; as?: ParticipantRef }
	runId?: string
	io?: SessionIo
	/** The dispatching run's lineage plus one — see the module note. */
	lineage?: RunLineage
	/** A parent's stop reaches this run through its own handle; see `runSpec`. */
	parentSignal?: AbortSignal
	onStarted?: (run: { runId: string; specId: string }) => void
	onProgress?: (event: RunProgress & { runId: string; specId: string }) => void
	onStatus?: (nodeKey: string, status: StatusText, run: { runId: string; specId: string }) => void
}

export type FireActionOutcome =
	/** Not run: the sentence names why, in the handler's voice. */
	| { kind: "refused"; error: string }
	/** Stopped on request — by whom. Not an error. */
	| {
			kind: "stopped"
			by: string
			runId: string
			specId: string
			receipt?: Receipt
	  }
	/** Ran to an outcome; read `receipt.outcome`. */
	| { kind: "ran"; runId: string; specId: string; receipt: Receipt }

/**
 * The four functions with a lifecycle of their own — a streaming row, a
 * modal, a prefill — that this road cannot run right and says so by name.
 */
const BESPOKE = new Set(["respond", "narrate", "narrate-character", "continue"])

export async function fireAction(
	db: Db,
	req: FireActionRequest
): Promise<FireActionOutcome> {
	const refused = (error: string): FireActionOutcome => ({ kind: "refused", error })

	const { checkSessionAccess } = await import("$lib/server/utils/sessionAccess")
	const access = await checkSessionAccess(req.sessionId, req.actor.userId)
	if (!access.hasAccess) return refused("Session not found.")

	if (BESPOKE.has(req.function))
		return refused(
			`'${req.function}' has its own trigger event — this route serves contributed functions.`
		)

	const {
		resolveFunctionVerdict,
		STANDARD_GENRE_ID,
		genreFieldsFor,
		sessionGenreAvailable,
		listSessionFunctions
	} = await import("$lib/server/pipelines/entities/sessionGenres")
	const modeCheck = await sessionGenreAvailable(db, req.sessionId)
	if (!modeCheck.available) return refused(modeCheck.reason!)
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, req.sessionId))
		.limit(1)
	const genreId = session?.genreId ?? STANDARD_GENRE_ID

	// A menu trigger's subject (19 §4): verified against the session before
	// it rides the input — a forged id reaching a spec as data would make
	// the control surface decoration.
	if (req.messageId != null) {
		const [subject] = await db
			.select({ sessionId: schema.sessionMessages.sessionId })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, req.messageId))
			.limit(1)
		if (!subject || subject.sessionId !== req.sessionId)
			return refused("That message is not part of this session.")
	}

	/**
	 * The form, when the press answers one (R-15 *Forms*). Read off the ROW:
	 * the block's function, identity and addressee are what the writing run
	 * stamped, and a press that disagrees with them is refused rather than
	 * believed. An `as` fire — the answer pipeline's — is only ever a form's
	 * answer.
	 */
	let form: FormFacts | undefined
	let actionId = req.action
	let addressed = false
	if (req.actor.as && !req.blockId)
		return refused("An answer made as a participant names the form it answers.")
	if (req.blockId) {
		if (req.messageId == null) return refused("A form is named with its message.")
		const block = await loadFormBlock(db, req.messageId, req.blockId)
		if (!block) return refused("That question is no longer here to answer.")
		// Which option: by its key when the press named one; a keyless
		// button (a row of actions, not a question) by the function and
		// identity the press carries.
		const option =
			block.kind === "choices"
				? req.payload?.choice !== undefined
					? block.actions.find(
							(o) => o.choice !== undefined && o.choice === req.payload?.choice
						)
					: block.actions.find(
							(o) =>
								o.choice === undefined &&
								o.fn === req.function &&
								(req.action === undefined || o.action === req.action)
						)
				: undefined
		if (block.kind === "choices" && !option)
			return refused("That is not one of the choices offered.")
		const fn = block.kind === "choices" ? option!.fn : block.fn
		const stamped = block.kind === "choices" ? option!.action : block.action
		if (fn !== req.function)
			return refused(`That question is answered by '${fn}', not '${req.function}'.`)
		if (actionId !== undefined && stamped !== undefined && actionId !== stamped)
			return refused(`That question is not '${actionId}' to answer.`)
		actionId = stamped ?? actionId
		if (block.addressee) {
			// The addressee is the audience: resolved now, for the acting
			// user — the same resolver the listing and the run-start pin use.
			const portrayals = await resolvePortrayals(db, {
				sessionId: req.sessionId,
				runOwnerUserId: req.actor.userId,
				refs: [block.addressee]
			})
			const who = portrayals[block.addressee] ?? { by: "none" }
			if (req.actor.as) {
				if (req.actor.as !== block.addressee)
					return refused(
						`That question was put to ${block.addressee}, not to ${req.actor.as}.`
					)
				if (who.by !== "ai")
					return refused(
						`${block.addressee} is ${who.by === "person" ? "portrayed by a person" : "nobody's"} ` +
							`this turn, so the answer is not the AI's to give.`
					)
			} else if (!(who.by === "person" && who.userId === String(req.actor.userId)))
				return refused(
					`That question was put to ${block.addressee}, and it is theirs to answer.`
				)
			addressed = true
		} else if (req.actor.as)
			return refused("That question was put to nobody in particular; there is no one to answer as.")
		const parsed = block.addressee ? parseParticipantRef(block.addressee) : null
		form = {
			blockId: req.blockId,
			messageId: req.messageId,
			kind: block.kind,
			question: block.question ?? null,
			addressee: block.addressee ?? null,
			characterId:
				parsed?.kind === "character" ? participantRowId(parsed.id) : null,
			...(option ? { choice: option.choice!, label: option.label } : {})
		}
	}

	/**
	 * Which declaration was pressed (U5c review, W1): THAT action's
	 * enablement, THAT action's audience, THAT spec. A fire naming none is
	 * the legacy shape and gets the owner floor and the companion spec.
	 */
	const { parseActionIdentity } = await import("$lib/shared/actions/identity")
	const { audienceVerdict } = await import(
		"$lib/server/pipelines/entities/sessionActions"
	)
	const { canActOnMessage } = await import("$lib/server/messages/permissions")
	const offered = await listSessionFunctions(db, req.sessionId, genreId, req.actor.userId)
	const forFunction = offered.filter((f) => f.function === req.function)
	const turnedOff = (name: string) =>
		refused(
			`'${name}' is turned off for this session. Turn it back on in session settings, under Actions.`
		)
	const notYours = (name: string, act: ReadonlyArray<string>) =>
		refused(`'${name}' is not yours to use here — its audience is ${act.join(", ")}.`)

	let chosenSpec: string | null = null
	if (actionId != null) {
		const parsed = parseActionIdentity(actionId)
		if (!parsed)
			return refused(`'${String(actionId)}' is not an action — one is named '<spec slug>#<key>'.`)
		const chosen = forFunction.find(
			(f) => f.specSlug === parsed.specSlug && f.key === parsed.key
		)
		if (!chosen) return refused(`No action '${actionId}' serves '${req.function}' for this session.`)
		if (!chosen.enabled) return turnedOff(chosen.name)
		// The effects line (R-15, F39): an out-of-fiction effect is never a
		// block's to carry nor an oracle's to answer.
		if (chosen.effects === "world" && (req.blockId || req.actor.as))
			return refused(
				`'${chosen.name}' changes something outside the story, so it is the owner's to ` +
					`invoke from the composer — never a question's answer.`
			)
		if (!addressed) {
			const verdict = await audienceVerdict(
				db,
				req.sessionId,
				{ userId: req.actor.userId },
				chosen.audience
			)
			const admitted =
				verdict.canAct ||
				(verdict.itemGated &&
					req.messageId != null &&
					(await canActOnMessage(db, req.messageId, req.actor.userId)))
			if (!admitted) return notYours(chosen.name, chosen.audience.act)
		}
		chosenSpec = chosen.specSlug
	} else if (!addressed && !access.isOwner) {
		// Legacy: the owner floor, whatever any declaration widened its
		// audience to — a fire that cannot say which button it is gets the
		// narrowest answer.
		const first = forFunction[0]
		return first ? notYours(first.name, ["owner"]) : refused("Session not found.")
	}

	const routed = await resolveFunctionVerdict(db, genreId, req.function, {
		sessionId: req.sessionId,
		spec: chosenSpec
	})
	const specId = routed.spec
	if (!specId) return refused(`Nothing serves '${req.function}' for this session's mode.`)
	if (actionId == null) {
		const governing = forFunction.filter((f) => f.specSlug === specId)
		if (governing.length && !governing.some((f) => f.enabled))
			return turnedOff(governing[0]!.name)
	}

	// A dispatched fire stands in a tree: the caps are asked once, here,
	// before anything starts (01 §8). A refusal is the caller's to receipt.
	if (req.lineage) {
		const cap = admitDescendant(req.lineage)
		if (cap) return refused(cap)
	}

	const { runSpec } = await import("$lib/server/pipelines/runtime/runTurn")
	const runId = req.runId || randomUUID()
	const handle = runRegistry.start({
		runId,
		userId: req.actor.userId,
		sessionId: req.sessionId,
		specId,
		kind: "action"
	})
	// A parent's stop is this run's stop: the fact crosses in the shape this
	// boundary speaks — a stop on the child's own handle.
	const onParentAbort = () =>
		runRegistry.cancelAs(runId, "system:parent-stopped", "the run that dispatched this one was stopped")
	if (req.parentSignal?.aborted) {
		runRegistry.finish(runId)
		return { kind: "stopped", by: "system:parent-stopped", runId, specId }
	}
	req.parentSignal?.addEventListener("abort", onParentAbort, { once: true })
	req.onStarted?.({ runId, specId })

	let receipt: Receipt | undefined
	let stopped: { by: string; reason: string } | undefined
	// A stopped run that came out as a throw is still a stopped run: the
	// throw is held until the handle has been read, and rethrown only when
	// nobody stopped it.
	let failure: unknown
	try {
		receipt = await runSpec({
			db,
			sessionId: req.sessionId,
			userId: req.actor.userId,
			specId,
			runId,
			io: req.io,
			signal: handle.controller.signal,
			cancelSignal: () => runRegistry.cancellation(handle),
			lineage: req.lineage,
			...(routed.fallback
				? { meta: { preset: { via: "fallback", ...routed.fallback } } }
				: {}),
			sink: {
				onProgress: (event) => req.onProgress?.({ ...event, runId, specId })
			},
			onStatus: (nodeKey, status) => req.onStatus?.(nodeKey, status, { runId, specId }),
			// The same input shape a turn supplies: no text, no pick — the
			// function was the whole instruction. `payload` and `form` are
			// what the inlet declares for a press (U5d).
			input: {
				text: "",
				sessionId: req.sessionId,
				characterId: null,
				...(req.messageId != null ? { messageId: req.messageId } : {}),
				...(req.payload && typeof req.payload === "object" ? { payload: req.payload } : {}),
				...(form ? { form } : {}),
				sessionScope: { sessionId: req.sessionId, currentCharacterId: null },
				fields: await genreFieldsFor(db, req.sessionId)
			}
		})
	} catch (e) {
		failure = e
	} finally {
		req.parentSignal?.removeEventListener("abort", onParentAbort)
		stopped = runRegistry.cancellation(handle)
		runRegistry.finish(runId)
	}

	if (stopped) return { kind: "stopped", by: stopped.by, runId, specId, receipt }
	if (failure !== undefined || !receipt) throw failure ?? new Error("the run returned no receipt")

	/**
	 * A form was answered (R-15): recorded for the next reply's inlet, once,
	 * here — by a click or by the answer pipeline, the same row with
	 * `answeredBy` saying which. Only when the action's run went to the
	 * end: an answer whose action did not land is not an answer the story
	 * has.
	 */
	if (form && receipt.outcome === "ok")
		await recordSessionChange(db, {
			event: "core:event/form-answered@1",
			sessionId: req.sessionId,
			messageId: form.messageId,
			blockId: form.blockId,
			...(actionId ? { action: actionId } : {}),
			...(form.addressee ? { addressee: form.addressee } : {}),
			answer: req.payload ?? {},
			answeredBy: req.actor.as ? "oracle" : "click",
			runId
		})

	return { kind: "ran", runId, specId, receipt }
}
