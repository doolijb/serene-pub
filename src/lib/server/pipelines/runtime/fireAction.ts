/**
 * Firing an action — the one server path a press takes (19 §4; plans/29
 * R-15; 30 §U5c, §U5d).
 *
 * One road, two doors. Which declaration was pressed, may THIS person press
 * it, which spec serves it, run it — every press walks this, whether it
 * arrives from `sessions:fireAction` (a person) or from the
 * `answer-form` outlet (U5d, 2026-09-17), which commits an oracle's answer
 * "exactly as a click would" — a promise that holds only because it IS the
 * click's path. The socket handler keeps what only a socket has: the
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
 * the action's run is the answer's child and the asking run's grandchild.
 * The cycle caps (`lineage.ts`) were asked at the door that collected the
 * fire (the `answer-form` commit, U5d review W1/W2), which receipted a
 * refusal against the would-be child; a fire that reaches here is admitted.
 *
 * ## Who portrays the addressee
 *
 * A person's click re-resolves the addressee's portrayal now — membership as
 * it stands when they press. A dispatched fire carries the answer run's
 * **pinned** `portrayals` (W3): the answer was the AI's to give when that run
 * started, and a member joining as the addressee mid-answer does not flip it.
 *
 * ## Answered once
 *
 * A form is answered once (W7): a run that landed stamps `answered` on the
 * stored block, and a second press is refused naming who answered.
 *
 * ## Overtaken (R-15 *Staleness and order*, U5f)
 *
 * A form carries the channel head it was issued at (`head`, stamped by the
 * host's write). The head moving past it — a newer row on the same lane
 * that is not itself an answer to a form on the same row (`stalenessHead`;
 * the answer's row carries `metadata.answersForm`, stamped from
 * `HostScope.answersForm`, which this door sets on the run) — **stales**
 * it: the press is refused with `core:verdict/staleness`'s sentence, whether
 * a person's click or the answer pipeline's dispatched fire (receipted as a
 * halt by `dispatchFires`). Staleness is computed here, never stored; the
 * FIRST time the door sees a block stale it records
 * `core:event/form-superseded@1` in the session's changes, so the next
 * reply's inlet learns the question lapsed — once, not on every render.
 * Answered beats stale: a block answered before the head moved is refused
 * as answered, above, and never as overtaken.
 *
 * ## A parked run answers promptly
 *
 * The run is raced against its own park (U5d review, R-b): the moment its
 * gate parks, this returns `{ kind: 'parked' }` and the run keeps its
 * handle — the gate is unchanged, and resolving it lands the line. What
 * the caller would have awaited arrives on `onSettled` instead. The rule
 * exists because the socket handler holds the session's trigger lock and
 * the ack for as long as this takes: a call that waited for the owner to
 * decide would block every trigger in the session behind one review, and
 * the AI-answer road reaches a gate with nobody having clicked. A park in
 * a **descendant** does not park this run: the descendant's own
 * `fireAction` returns promptly, the tree unwinds, and the fact rides out
 * on the `ran` outcome's `parked` list so an ack can say so.
 */

import { randomUUID } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"
import type {
	EnabledWhen,
	FormAnswered,
	ParticipantRef,
	Portrayal,
	Portrayals,
	Receipt,
	StatusText
} from "@serene-pub/sdk"
import {
	checkValues,
	effectsLineVerdict,
	formFireOf,
	parseParticipantRef,
	sentenceText,
	stalenessVerdict
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { RunProgress } from "$lib/shared/sockets/progress"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import * as runRegistry from "$lib/server/pipelines/runtime/runRegistry"
import {
	closeBranch,
	openBranch,
	type RunLineage
} from "$lib/server/pipelines/runtime/lineage"
import {
	ownPresence,
	participantRowId,
	resolvePortrayals
} from "$lib/server/pipelines/runtime/portrayals"
import {
	loadFormBlock,
	markFormAnswered,
	clearFormAnswered,
	openFormOf,
	recordFormSuperseded,
	type FormFacts
} from "$lib/server/messages/blocks"
import { stalenessHead } from "$lib/server/messages/channels"
import { answerStanding } from "$lib/server/pipelines/runtime/reviewGate"
import { NARRATE_ACTION, NARRATE_CHARACTER_ACTION } from "$lib/shared/actions/identity"

export interface FireActionRequest {
	sessionId: number
	/**
	 * The declaration pressed — its identity `<spec slug>#<key>` (plans/31
	 * V2: the one key). A press names one, or names a `key` for the door to
	 * resolve; a press naming neither is refused.
	 */
	action?: string
	/**
	 * ⏳ A bare action **key**, for a press that could not name its
	 * declaration: a block stored before identities, a frame's bare
	 * `{ t: 'action', fn }`. Resolved at the door to the genre's sole
	 * declarer of that key (`soleDeclarer`); several declarers are refused
	 * with their identities, none with a sentence. One release.
	 */
	key?: string
	/** The message the press was on, when it was on one. */
	messageId?: number
	/** The form the press answers — a block id within `messageId`. */
	blockId?: string
	/** What the press sent: a form's answer, a widget's args. */
	payload?: Record<string, unknown>
	/**
	 * The text the press collected (lair pass R3) — the collect modal's, or
	 * (S2) a slash argument; whoever calls says where it came from, and this
	 * door never reads a composer. Reaches the run's `input.text`, trimmed,
	 * for an action declaring `collects.text`, whatever the venue — a chip,
	 * the palette, a message's ⋮, a form's option. A `required` one pressed
	 * with none is refused. Anything else is not handed to the run.
	 */
	text?: string
	/**
	 * The cast members the press collected (lair pass R3), as
	 * `character:<id>` references — for an action declaring
	 * `collects.recipients`, validated here (`recipientsRefusal`) and handed
	 * to the run as `input.recipients`. Ignored for any other action.
	 */
	recipients?: unknown[]
	actor: { userId: number; as?: ParticipantRef }
	runId?: string
	io?: SessionIo
	/** The dispatching run's lineage plus one — see the module note. */
	lineage?: RunLineage
	/**
	 * The dispatching run's pinned portrayals (W3) — who portrays the
	 * addressee as that run decided at its start. Absent for a person's
	 * click, which resolves now.
	 */
	portrayals?: Portrayals
	/** A parent's stop reaches this run through its own handle; see `runSpec`. */
	parentSignal?: AbortSignal
	onStarted?: (run: { runId: string; specId: string }) => void
	onProgress?: (event: RunProgress & { runId: string; specId: string }) => void
	onStatus?: (nodeKey: string, status: StatusText, run: { runId: string; specId: string }) => void
	/**
	 * A run in this tree parked at a review gate — this one or a descendant
	 * (R-b). Relayed upward as it was handed down (`SpecRunRequest.onParked`).
	 */
	onParked?: (run: { runId: string; specId: string }) => void
	/**
	 * Called once, when a run this call answered `parked` for has ended —
	 * what the caller would have been handed had it waited: `ran`, `stopped`,
	 * or `failed` for a throw that has nobody left to catch it. Never called
	 * for a call that did not answer `parked`.
	 */
	onSettled?: (outcome: FireActionSettled) => void
}

export type FireActionOutcome =
	/** Not run: the sentence names why, in the handler's voice. */
	| { kind: "refused"; error: string }
	/** Stopped on request — by whom, and why, as the registry recorded them. Not an error. */
	| {
			kind: "stopped"
			by: string
			reason: string
			runId: string
			specId: string
			receipt?: Receipt
	  }
	/**
	 * Ran to an outcome; read `receipt.outcome`. `parked` lists the runs
	 * dispatched under this one that are waiting at a review gate (R-b):
	 * each keeps its handle, and lands its own receipt when decided.
	 */
	| {
			kind: "ran"
			runId: string
			specId: string
			receipt: Receipt
			parked?: ReadonlyArray<{ runId: string; specId: string }>
	  }
	/**
	 * This run parked at a review gate and was released to its caller (R-b).
	 * It is still running: its handle stands, the owner has the card, and
	 * `onSettled` is told how it ended. No receipt yet.
	 */
	| { kind: "parked"; runId: string; specId: string }

/** What `onSettled` is handed for a run that answered `parked` — see `FireActionRequest`. */
export type FireActionSettled =
	| Extract<FireActionOutcome, { kind: "ran" | "stopped" }>
	/** The run threw after it parked — a throw with nobody left to catch it. */
	| { kind: "failed"; runId: string; specId: string; error: unknown }

/**
 * The actions with a lifecycle of their own — a streaming row, a modal, a
 * prefill — that this road cannot run right and says so by name: the two
 * narrator actions (their own trigger event), and every core verb
 * (`core#…`, the `sessionMessages:*` handlers).
 */
const BESPOKE = new Set([NARRATE_ACTION, NARRATE_CHARACTER_ACTION])

/**
 * The session's **enabled seats** (lair pass R3): the cast members a press
 * may collect as recipients — seated, not removed, and enabled — as
 * `character:<id>` references.
 */
export async function enabledSeats(db: Db, sessionId: number): Promise<Set<string>> {
	const rows = await db
		.select({ characterId: schema.sessionCharacters.characterId })
		.from(schema.sessionCharacters)
		.where(
			and(
				eq(schema.sessionCharacters.sessionId, sessionId),
				eq(schema.sessionCharacters.isActive, true),
				isNull(schema.sessionCharacters.removedAt)
			)
		)
	return new Set(rows.map((r) => `character:${r.characterId}`))
}

/**
 * Why a press's recipients cannot ride (lair pass R3), as the rest of a
 * sentence after the action's name, or null when they can: a list of
 * enabled seats, none twice, within the declaration's `min` and `max`.
 */
export function recipientsRefusal(
	sent: unknown,
	decl: { min: number; max?: number },
	seated: ReadonlySet<string>
): string | null {
	const list = sent === undefined ? [] : sent
	if (!Array.isArray(list) || list.some((r) => typeof r !== "string"))
		return "takes its recipients as a list of cast members."
	const seen = new Set<string>()
	for (const ref of list as string[]) {
		if (seen.has(ref)) return `names ${ref} twice.`
		seen.add(ref)
		if (!seated.has(ref)) return `can only go to an enabled member of this session's cast — ${ref} is not one.`
	}
	const plural = (n: number) => `${n} ${n === 1 ? "recipient" : "recipients"}`
	if (list.length < decl.min) return `needs at least ${plural(decl.min)}.`
	if (decl.max !== undefined && list.length > decl.max) return `takes at most ${plural(decl.max)}.`
	return null
}

export async function fireAction(
	db: Db,
	pressed: FireActionRequest
): Promise<FireActionOutcome> {
	const refused = (error: string): FireActionOutcome => ({ kind: "refused", error })
	/**
	 * A composer press — no message, no form — decided on the request as it
	 * ARRIVED, before any routing below: only such a press is addressed to
	 * the session's open form.
	 */
	const composerPress = pressed.messageId == null && !pressed.blockId
	let req = pressed

	const { checkSessionAccess } = await import("$lib/server/utils/sessionAccess")
	const access = await checkSessionAccess(req.sessionId, req.actor.userId)
	if (!access.hasAccess) return refused("Session not found.")

	const { parseActionIdentity, isCoreActionIdentity, actionIdentity } = await import(
		"$lib/shared/actions/identity"
	)
	if (req.action !== undefined && !parseActionIdentity(req.action))
		return refused(`'${String(req.action)}' is not an action — one is named '<spec slug>#<key>'.`)
	if (req.action === undefined && !req.key)
		return refused("A press names the action it fires — '<spec slug>#<key>'.")
	if (req.action !== undefined && BESPOKE.has(req.action))
		return refused(
			`'${req.action}' has its own event — this route serves contributed actions.`
		)
	if (req.action !== undefined && isCoreActionIdentity(req.action))
		return refused(`'${req.action}' is one of core's verbs, with its own handler — this route serves contributed actions.`)

	const {
		resolveSubjectVerdict,
		STANDARD_GENRE_ID,
		genreFieldsFor,
		sessionGenreAvailable,
		listSessionFunctions,
		soleDeclarer
	} = await import("$lib/server/pipelines/entities/sessionGenres")
	const modeCheck = await sessionGenreAvailable(db, req.sessionId)
	if (!modeCheck.available) return refused(modeCheck.reason!)
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, req.sessionId))
		.limit(1)
	const genreId = session?.genreId ?? STANDARD_GENRE_ID

	/**
	 * The open form answers a composer press (W-GATE D3 follow-up, ruled
	 * 2026-09-27). A press from the composer or the command list names no
	 * form; when the action it names is the one the session's open form
	 * (`openFormOf` — the main channel's newest unanswered, not-overtaken
	 * form, the same fact `presentWhen` reads) is answered by, the press is
	 * addressed to THAT form and walks on exactly as a press on the form's
	 * own button: every check below — answered, overtaken, the option, the
	 * addressee — is the form's. An open form for any other action is not
	 * this press's to answer, and the press goes on as it came.
	 */
	/** Set when the press was routed to the open form: it may name no option (below). */
	let routedToOpenForm = false
	if (composerPress && req.action !== undefined && !req.actor.as) {
		const open = await openFormOf(db, req.sessionId)
		if (open && open.action === req.action) {
			req = { ...req, messageId: open.messageId, blockId: open.blockId }
			routedToOpenForm = true
		}
	}

	// A menu trigger's subject (19 §4): verified against the session before
	// it rides the input — a forged id reaching a spec as data would make
	// the control surface decoration.
	/** The subject row's channel — what a form's head is compared against. */
	let subjectChannel: string | null = null
	if (req.messageId != null) {
		const [subject] = await db
			.select({
				sessionId: schema.sessionMessages.sessionId,
				channel: schema.sessionMessages.channel
			})
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, req.messageId))
			.limit(1)
		if (!subject || subject.sessionId !== req.sessionId)
			return refused("That message is not part of this session.")
		subjectChannel = subject.channel
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
	/** What the run receives as `payload`: a form's answer normalised (W5), else what the press sent. */
	let payload = req.payload
	/** Who the answer is recorded as given by (W7): the addressee, else the presser. */
	let answeredBy: ParticipantRef = `user:${req.actor.userId}`
	/** Whom the BLOCK addressed — what the record of the answer names; null for a question put to nobody. */
	let blockAddressee: ParticipantRef | null = null
	if (req.actor.as && !req.blockId)
		return refused("An answer made as a participant names the form it answers.")
	if (req.blockId) {
		if (req.messageId == null) return refused("A form is named with its message.")
		const block = await loadFormBlock(db, req.messageId, req.blockId)
		if (!block) return refused("That question is no longer here to answer.")
		blockAddressee = block.addressee ?? null
		// Answered once (W7): the row says who already did.
		if (block.answered)
			return refused(
				`That question was already answered by ${await answererName(db, block.answered)}.`
			)
		// Overtaken (U5f): the channel head has moved past the form's. The
		// head is read here, at the door, from the one definition
		// (`stalenessHead`) the write stamped from — answers to this row's
		// own forms do not move it.
		if (subjectChannel !== null) {
			const headNow = await stalenessHead(
				db,
				req.sessionId,
				subjectChannel,
				req.messageId
			)
			const overtaken = stalenessVerdict.judge({ block, headNow })
			if (!overtaken.ok) {
				await recordFormSuperseded(db, {
					sessionId: req.sessionId,
					messageId: req.messageId,
					blockId: req.blockId
				})
				return refused(sentenceText(overtaken))
			}
		}
		/**
		 * The press against the form (W5). A `choices` press naming an option
		 * is normalised to `{ choice }` by `formFireOf` — the one reading the
		 * answer pipeline commits, so a click and an oracle hand the run the
		 * same payload — and a keyless button (a row of actions, not a
		 * question) is matched by the function and identity it carries. A
		 * `form` press is its values, checked field by field against the
		 * block's schema; a press that does not fit is refused with the
		 * faults named.
		 */
		/**
		 * A block's button names its action by identity (`action`, stamped
		 * by the writing outlet) and by key (`fn`). A press matches on
		 * whichever it brought: the identity when it names one, else the key
		 * (plans/31 V2 — a block stored before identities carries only `fn`).
		 */
		const pressedKey = req.action ? parseActionIdentity(req.action)!.key : req.key!
		let fn: string
		let stamped: string | undefined
		if (block.kind === "choices") {
			const picked =
				req.payload?.choice !== undefined ? formFireOf(block, req.payload) : null
			if (req.payload?.choice !== undefined && !picked)
				return refused("That is not one of the choices offered.")
			/**
			 * Routed from the composer with no option named: every option
			 * fires the pressed action (`openFormOf` says so), so the press
			 * answers with none — the spec's own reading of an answer with
			 * no choice decides (the Lair's is *build*).
			 */
			const unpicked = routedToOpenForm && !picked
			const match = picked
				? block.actions.find((o) => o.choice === picked.payload.choice)!
				: unpicked
					? undefined
					: block.actions.find(
							(o) =>
								o.choice === undefined &&
								(req.action !== undefined && o.action !== undefined
									? o.action === req.action
									: o.fn === pressedKey)
						)
			if (!match && !unpicked) return refused("That is not one of the choices offered.")
			fn = match ? match.fn : pressedKey
			stamped = match ? match.action : req.action
			if (picked) payload = picked.payload
			form = {
				blockId: req.blockId,
				messageId: req.messageId,
				kind: block.kind,
				question: block.question ?? null,
				...(typeof block.referent === "string" ? { referent: block.referent } : {}),
				addressee: block.addressee ?? null,
				characterId: null,
				...(match?.choice !== undefined ? { choice: match.choice, label: match.label } : {})
			}
		} else {
			const filled = formFireOf(block, req.payload ?? {})
			if (!filled) return refused("A form is answered with its values.")
			const faults = checkValues(block.fields, filled.payload)
			if (faults.length)
				return refused(
					`That answer does not fit the form: ` +
						faults.map((f) => `${f.message} (${f.fix})`).join("; ") +
						"."
				)
			fn = filled.fn
			stamped = filled.action
			payload = filled.payload
			form = {
				blockId: req.blockId,
				messageId: req.messageId,
				kind: block.kind,
				question: block.question ?? null,
				...(typeof block.referent === "string" ? { referent: block.referent } : {}),
				addressee: block.addressee ?? null,
				characterId: null
			}
		}
		if (fn !== pressedKey)
			return refused(`That question is answered by '${fn}', not '${pressedKey}'.`)
		if (actionId !== undefined && stamped !== undefined && actionId !== stamped)
			return refused(`That question is not '${actionId}' to answer.`)
		actionId = stamped ?? actionId
		if (block.addressee) {
			/**
			 * The addressee is the audience. A dispatched fire reads the
			 * answer run's pinned portrayals (W3); a person's click resolves
			 * now, for the acting user — the same resolver the listing and
			 * the run-start pin use.
			 */
			const who: Portrayal =
				req.portrayals?.[block.addressee] ??
				(
					await resolvePortrayals(db, {
						sessionId: req.sessionId,
						runOwnerUserId: req.actor.userId,
						refs: [block.addressee]
					})
				)[block.addressee] ??
				{ by: "none" }
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
			} else if (who.by === "none") {
				// Nobody portrays the addressee — a removed cast member, a
				// reference naming no one (W4): the block waits, and the
				// owner may answer it (docs/sessions.md, *forms*).
				if (!access.isOwner)
					return refused(
						`That question was put to ${block.addressee}, whom nobody here portrays — ` +
							`it is the owner's to answer.`
					)
			} else if (!(who.by === "person" && who.userId === String(req.actor.userId)))
				return refused(
					`That question was put to ${block.addressee}, and it is theirs to answer.`
				)
			addressed = true
			answeredBy = block.addressee
		} else if (req.actor.as)
			return refused("That question was put to nobody in particular; there is no one to answer as.")
		if (block.addressee) {
			const parsed = parseParticipantRef(block.addressee)
			form.characterId = parsed.kind === "character" ? participantRowId(parsed.id) : null
		} else {
			/**
			 * A question put to nobody in particular, pressed by a person:
			 * the answer is THEIRS. Spoken through their own presence in
			 * this session where they have one — `character:<id>`, so the
			 * line lands as their persona's (the commit reads the pinned
			 * portrayal and writes the persona columns) — else as themselves,
			 * `user:<id>`: a persona-less line is its author's, `role: user`
			 * under their id and no persona (handover 2026-09-17 §4). Before
			 * this the form carried no addressee and no character, and the
			 * line was written with no author at all (2026-09-17). The
			 * block's own addressee stays what it was — none — on the record
			 * of the answer below; this fills only what the answer's line is
			 * spoken as.
			 */
			const own = await ownPresence(db, req.sessionId, req.actor.userId)
			form.addressee = own !== null ? `character:${own}` : `user:${req.actor.userId}`
			form.characterId = own
		}
	}

	/**
	 * Which declaration was pressed (U5c review, W1): THAT action's
	 * enablement, THAT action's audience, THAT spec. A press that brought a
	 * bare key (⏳ `req.key`, or a block stamped with none) is resolved to
	 * the genre's sole declarer of that key — the same rule presets and the
	 * boot's re-projection use — and refused with the identities when
	 * several declare it: a press has to be about one thing (plans/31 V2).
	 */
	const { audienceVerdict, enablementVerdict, reasonSentence } = await import(
		"$lib/server/pipelines/entities/sessionActions"
	)
	const { canActOnMessage } = await import("$lib/server/messages/permissions")
	/**
	 * Enabled-when (R-15; U5e): the second door, after the audience and
	 * before routing. The declaration's effective predicate set — the
	 * session's override, else its own, else the genre's default — over the
	 * session's published values with the named message's `item`, read by
	 * the same `enablementOf` the listing uses, so a grey chip and this
	 * refusal can never disagree. A form's answer walks it too (an oracle
	 * answering a question whose predicate fails is refused like a click
	 * would be), and a hand-made `sessions:fireAction` cannot step
	 * around it. The sentence is the failing predicate's reason, in the
	 * actor's language.
	 */
	const notNow = async (
		action: { specSlug: string; key: string; enabledWhen?: ReadonlyArray<EnabledWhen> }
	): Promise<FireActionOutcome | null> => {
		const gate = await enablementVerdict(
			db,
			req.sessionId,
			genreId,
			{ userId: req.actor.userId },
			action,
			req.messageId,
			// A dispatched fire's own tree is not "something else generating"
			// (review W1): the AI road is admitted as the click road is.
			{ lineage: req.lineage }
		)
		if (gate.enabled) return null
		return refused(await reasonSentence(gate.reason!, { userId: req.actor.userId }))
	}
	/**
	 * May THIS press fire a `world` action — the effects line at the door
	 * (R-15, F41; the exception ruled 2026-09-17 as L1), heard from
	 * `core:verdict/effects-line` as a `press` (01 §13).
	 *
	 * An out-of-fiction effect is the owner's, from the composer or the
	 * review gate, and never a question's answer. Two exceptions to the
	 * refusal, and only two:
	 *
	 *  · an ordinary press that names no block at all — the composer's
	 *    own button, which is where such an action lives;
	 *  · a press on a block **addressed to `owner`**. The gate above has
	 *    already held the presser to that addressee (a person who is not the
	 *    owner was refused there), so reaching here means the owner pressed
	 *    their own button — the same act, wearing a message's clothes.
	 *
	 * `req.actor.as` is refused in BOTH cases and has no exception: that is
	 * the answer pipeline answering **as a participant**, and an oracle
	 * granting a permission is the thing the line exists to make impossible.
	 */
	const acrossTheLine = (action: { name: string; effects: string }): FireActionOutcome | null => {
		const heard = effectsLineVerdict.judge({
			kind: "press",
			name: action.name,
			effects: action.effects,
			as: !!req.actor.as,
			onBlock: !!req.blockId,
			blockAddressee: blockAddressee
		})
		return heard.ok ? null : refused(sentenceText(heard))
	}
	const offered = await listSessionFunctions(db, req.sessionId, genreId, req.actor.userId)
	const turnedOff = (name: string) =>
		refused(
			`'${name}' is turned off for this session. Turn it back on in session settings, under Actions.`
		)

	if (actionId == null) {
		const key = req.key!
		const sole = soleDeclarer(offered, key)
		if (!sole) {
			const several = offered.filter((f) => f.key === key)
			return refused(
				several.length
					? `'${key}' names ${several.length} actions here — ${several.map(actionIdentity).join(", ")}. Say which.`
					: `No action '${key}' is offered to this session.`
			)
		}
		actionId = actionIdentity(sole)
	}
	const parsed = parseActionIdentity(actionId)!
	const chosen = offered.find((f) => f.specSlug === parsed.specSlug && f.key === parsed.key)
	/** An annex field's press (`<owner>:annex#<key>`, 2026-09-26) — judged by its declaration below. */
	const { parseAnnexFieldAction } = await import("@serene-pub/sdk")
	const annexTarget = parseAnnexFieldAction(actionId)
	if (!chosen && annexTarget) {
		// Declared but pipeline-written only (no `act`, ruling 2026-09-26):
		// never offered, and a press says why rather than "not declared".
		const { annexFieldFor } = await import("$lib/server/sessions/annexFields")
		const declared = await annexFieldFor(db, genreId, actionId)
		if (declared && !declared.decl.act?.length)
			return refused(
				`'${annexTarget.key}' is set by '${annexTarget.owner}''s pipelines only — its declaration names nobody who may set it.`
			)
	}
	if (!chosen && annexTarget)
		return refused(
			`'${annexTarget.key}' is not an annex field '${annexTarget.owner}' declares for this session — ` +
				`a package sets only the keys it declared, in its own annex.`
		)
	if (!chosen) return refused(`No action '${actionId}' is offered to this session.`)
	if (!chosen.enabled) return turnedOff(chosen.name)
	// A disabled plugin's action is not offered, so it is not fired either
	// — the same answer the listing gives (R67): its code is not loaded.
	{
		const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
		if ((await disabledPlugins(db)).ownsId(chosen.specSlug))
			return refused(`'${chosen.name}' is not available while its plugin is turned off.`)
	}
	// The effects line (R-15, F41): an out-of-fiction effect is never a
	// block's to carry nor an oracle's to answer — unless the block was
	// put to the owner, who is that action's whole audience anyway.
	const crossed = acrossTheLine(chosen)
	if (crossed) return crossed
	if (!addressed) {
		// The item rule's answer, settled here where the message is, and
		// handed to the audience verdict beside the portrayals: a mixed
		// audience admits either way (S-A).
		const item =
			chosen.audience.act.includes("item") &&
			req.messageId != null &&
			(await canActOnMessage(db, req.messageId, req.actor.userId))
		const verdict = await audienceVerdict(
			db,
			req.sessionId,
			{ userId: req.actor.userId },
			chosen,
			item
		)
		if (!verdict.canAct) return refused(verdict.refusal)
	}
	const grey = await notNow(chosen)
	if (grey) return grey
	/**
	 * Present-when (W-GATE D3): an action with nothing to act on is hidden
	 * from every listing, and a press that reaches it anyway — a slash name,
	 * a hand-made fire — is refused with the same verdict. A press on a form
	 * is judged by that form above (answered, overtaken), which is its own
	 * evidence there is something to act on.
	 */
	if (!req.blockId) {
		const { absentRefusal } = await import("$lib/server/pipelines/entities/sessionActions")
		const absent = await absentRefusal(
			db,
			req.sessionId,
			chosen,
			{ userId: req.actor.userId },
			{ lineage: req.lineage }
		)
		if (absent) return refused(absent)
	}

	/**
	 * What the press collected (lair pass R3; was B10's composer text): the
	 * instruction of an action that declares it collects it — Nudge's
	 * direction, Whisper's line, Build room's name — from any venue, a
	 * form's option included. An action collecting nothing gets "" and no
	 * recipients, whatever the press sent.
	 */
	const collects = chosen.collects
	const typed = collects?.text && typeof req.text === "string" ? req.text.trim() : ""
	if (collects?.text?.need === "required" && !typed)
		return refused(`'${chosen.name}' needs text.`)
	let recipients: string[] | undefined
	if (collects?.recipients) {
		const seated = await enabledSeats(db, req.sessionId)
		const fault = recipientsRefusal(req.recipients, collects.recipients, seated)
		if (fault) return refused(`'${chosen.name}' ${fault}`)
		recipients = req.recipients as string[]
	}

	/**
	 * An annex field (2026-09-26) is served by core's one pipeline, never by a
	 * binding: the declaration is judged here, at the door — the value
	 * against its shape (the validator's own sentence), the audience it will
	 * be stored under — and the run is handed `{ field, value }`. The outlet
	 * reads the declaration again rather than trusting this payload.
	 */
	let annexFieldRun: { field: string; value: unknown } | undefined
	if (annexTarget) {
		const { annexFieldFor } = await import("$lib/server/sessions/annexFields")
		const { annexFieldValueRefusal, dataAudienceFindings } = await import("@serene-pub/sdk")
		const field = await annexFieldFor(db, genreId, actionId)
		if (!field)
			return refused(
				`'${annexTarget.key}' is not an annex field '${annexTarget.owner}' declares for this session.`
			)
		const audienceFault = dataAudienceFindings(field.decl.see)
		if (audienceFault) return refused(`'${annexTarget.key}' cannot be stored: ${audienceFault}.`)
		const valueFault = annexFieldValueRefusal(field.decl, payload)
		if (valueFault) return refused(valueFault)
		annexFieldRun = { field: actionId, value: (payload as { value: unknown }).value }
	}

	// Routing by identity (plans/31 V2): the declarer, if it still serves —
	// the verdict is the eligibility check, and nothing else selects.
	const routed: { spec: string | null; fallback?: Awaited<ReturnType<typeof resolveSubjectVerdict>>["fallback"] } =
		annexFieldRun
			? { spec: (await import("@serene-pub/sdk")).ANNEX_FIELD_SPEC_ID }
			: await resolveSubjectVerdict(db, genreId, actionId, {
					sessionId: req.sessionId,
					spec: chosen.specSlug
				})
	if (annexFieldRun) payload = annexFieldRun
	const specId = routed.spec
	if (!specId) return refused(`Nothing serves '${actionId}' for this session's genre.`)

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
	const PARENT_STOPPED = "the run that dispatched this one was stopped"
	const onParentAbort = () => runRegistry.cancelAs(runId, "system:parent-stopped", PARENT_STOPPED)
	if (req.parentSignal?.aborted) {
		runRegistry.finish(runId)
		return { kind: "stopped", by: "system:parent-stopped", reason: PARENT_STOPPED, runId, specId }
	}
	req.parentSignal?.addEventListener("abort", onParentAbort, { once: true })
	req.onStarted?.({ runId, specId })

	/**
	 * The park signal (R-b): settled the moment THIS run's gate parks. A
	 * park in a descendant is not this run's — it is collected for the
	 * outcome and relayed up — because the descendant's own `fireAction`
	 * has already returned for it, and this run is still walking to its
	 * end.
	 */
	let parkHere!: () => void
	const parkedHere = new Promise<"parked">((resolve) => {
		parkHere = () => resolve("parked")
	})
	const parkedBelow: Array<{ runId: string; specId: string }> = []
	const onParked = (run: { runId: string; specId: string }) => {
		if (run.runId === runId) parkHere()
		else parkedBelow.push(run)
		req.onParked?.(run)
	}

	/**
	 * Who **pressed** — the inlet's `presser` port (G9, 2026-09-17).
	 *
	 * `req.actor.as` when an **answer pipeline** pressed on a participant's
	 * behalf: that run is answering as that participant, so the presser is
	 * them and not the machinery that spoke for them. Otherwise the acting
	 * person, through their own presence in this session where they have one
	 * (`character:<id>` — a persona IS a character), else
	 * themselves. The same resolution a form addressed to nobody in
	 * particular already performs, so the two cannot disagree about who a
	 * person is here.
	 *
	 * Read once, before the run: it is a fact about the press, not about the
	 * attempt, and a retry must not re-resolve it.
	 */
	const presserPresence = await ownPresence(db, req.sessionId, req.actor.userId)
	const presser: ParticipantRef =
		req.actor.as ??
		(presserPresence !== null
			? `character:${presserPresence}`
			: `user:${req.actor.userId}`)

	// The run's tree is held from before the run until after `form-answered`
	// is emitted below (E1c): that event's listeners are this run's children,
	// dispatched after its `runSpec` has returned, and the tree's count must
	// still be there when they are.
	const treeRoot = req.lineage?.rootRunId ?? runId
	const settle = async (): Promise<Extract<FireActionOutcome, { kind: "ran" | "stopped" }>> => {
		openBranch(treeRoot)
		try {
			return await settleHeld()
		} finally {
			closeBranch(treeRoot)
		}
	}
	const settleHeld = async (): Promise<Extract<FireActionOutcome, { kind: "ran" | "stopped" }>> => {
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
				// The form this run answers (U5f): the commit stamps it on the
				// answer's row so the row is an answer, not the conversation
				// moving on from the form's row.
				...(form
					? {
							answersForm: {
								messageId: form.messageId,
								blockId: form.blockId,
								// Put to the session's owner (the Lair's knock): the
								// owner's answer lands as a send (lair pass B12).
								...(form.addressee === "owner" ? { toOwner: true } : {})
							}
						}
					: {}),
				...(routed.fallback
					? { meta: { preset: { via: "fallback", ...routed.fallback } } }
					: {}),
				sink: {
					onProgress: (event) => req.onProgress?.({ ...event, runId, specId })
				},
				onStatus: (nodeKey, status) => req.onStatus?.(nodeKey, status, { runId, specId }),
				onParked,
				// The same input shape a turn supplies, and no pick. `text` and
				// `recipients` are what the press collected, for an action
				// declaring it collects them (R3) — else empty: the function
				// was the whole instruction.
				// `payload` and `form` are what the inlet declares for a press
				// (U5d).
				input: {
					text: typed,
					...(recipients ? { recipients } : {}),
					sessionId: req.sessionId,
					characterId: null,
					// Who pressed — see `presser` above.
					presser,
					...(req.messageId != null ? { messageId: req.messageId } : {}),
					...(payload && typeof payload === "object" ? { payload } : {}),
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

		if (stopped)
			return { kind: "stopped", by: stopped.by, reason: stopped.reason, runId, specId, receipt }
		if (failure !== undefined || !receipt) throw failure ?? new Error("the run returned no receipt")

		/**
		 * How the answer stands (lair pass R9, `answerStanding` in
		 * `reviewGate.ts`): landed — or rejected at review after it had
		 * already written something — is answered; rejected at review having
		 * written nothing is **no answer**, and the form is open again.
		 */
		const standing = form ? await answerStanding(db, receipt) : "unsettled"

		/**
		 * A form was answered (R-15): recorded for the next reply's inlet, once,
		 * here — by a click or by the answer pipeline, the same row with
		 * `answeredBy` saying which. Only when the action's run went to the
		 * end, or its effects happened before a reviewer stopped it: an answer
		 * whose action did not land is not an answer the story has.
		 */
		if (form && standing === "answered") {
			const { emitSessionEvent } = await import(
				"$lib/server/pipelines/runtime/sessionEvents"
			)
			const { childLineage } = await import(
				"$lib/server/pipelines/runtime/lineage"
			)
			// The cause (PLAN-turn-order §4.1): a click is the person's —
			// `{ kind: 'user' }` — an oracle's answer is the answer run's.
			// Either way the action's run wrote it, so `runId` is its.
			await emitSessionEvent(db, {
				sessionId: req.sessionId,
				userId: req.actor.userId,
				event: "core:event/form-answered@1",
				payload: {
					sessionId: req.sessionId,
					messageId: form.messageId,
					blockId: form.blockId,
					...(actionId ? { action: actionId } : {}),
					...(blockAddressee ? { addressee: blockAddressee } : {}),
					answer: payload ?? {},
					answeredBy: req.actor.as ? "oracle" : "click",
					cause: req.actor.as
						? { kind: "run", runId }
						: { kind: "user", userId: req.actor.userId, runId },
					...(req.lineage ? { lineage: req.lineage } : {})
				},
				lineage: childLineage({ runId, lineage: req.lineage }),
				io: req.io,
				signal: req.parentSignal
			})
			// Answered once (W7): the stored block says so from here on — a
			// second press is refused above, and the row goes out with its parts
			// so every client greys the block without a reload.
			const answered: FormAnswered = {
				by: answeredBy,
				at: new Date().toISOString(),
				...(form.choice !== undefined ? { choice: form.choice } : {})
			}
			await markFormAnswered(db, form.messageId, form.blockId, answered)
			if (req.io) await announceAnswered(db, req.io, form.messageId)
			// Its `open-form` notification, for whoever holds one, is done
			// with (PLAN-notifications §5) — after the answer is recorded,
			// and never able to fail it.
			try {
				const { clearAnsweredForm } = await import(
					"$lib/server/notifications/openForm"
				)
				await clearAnsweredForm(db, req.sessionId, form.messageId, form.blockId)
			} catch (err) {
				console.warn(`[fireAction] clearing the open-form notification failed:`, err)
			}
		} else if (form && standing === "no-answer") {
			/**
			 * **No answer: the form is open again** (R9). Any `answered` mark
			 * comes off, the row goes out again so every client shows the
			 * block live, and its open-form notification is raised again for
			 * the person who pressed — the question still waits on them. An
			 * AI's answer (`as`) raises nothing: a form put to the AI is never
			 * a person's notification.
			 */
			await clearFormAnswered(db, form.messageId, form.blockId)
			if (req.io) await announceAnswered(db, req.io, form.messageId)
			if (!req.actor.as) {
				const { raiseOpenForms } = await import("$lib/server/notifications/openForm")
				await raiseOpenForms(db, req.sessionId, [
					{ messageId: form.messageId, blockId: form.blockId, userId: req.actor.userId }
				])
			}
		}

		return parkedBelow.length
			? { kind: "ran", runId, specId, receipt, parked: [...parkedBelow] }
			: { kind: "ran", runId, specId, receipt }
	}

	const running = settle()
	// Held, so a throw after the park is never an unhandled rejection: the
	// parked branch below hands it to `onSettled`, and the other branch is
	// awaiting `running` itself through the race.
	running.catch(() => {})
	const first = await Promise.race([running, parkedHere])
	if (first !== "parked") return first
	// Parked: the run keeps going under its own handle; the caller is
	// released with the run id it can cancel and the gate it can watch.
	running
		.then(
			(outcome) => req.onSettled?.(outcome),
			(error) => req.onSettled?.({ kind: "failed", runId, specId, error })
		)
		.catch((err) => console.warn(`[fireAction] onSettled for run ${runId} threw:`, err))
	return { kind: "parked", runId, specId }
}

/** The row, with its parts, to every user of the session — the block now carries `answered`. */
async function announceAnswered(db: Db, io: SessionIo, messageId: number): Promise<void> {
	const [row] = await db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, messageId))
		.limit(1)
	if (!row) return
	const { attachParts } = await import("$lib/server/messages/store")
	const { broadcastToSessionUsers } = await import(
		"$lib/server/sockets/utils/broadcastHelpers"
	)
	const [withParts] = await attachParts(db, [row])
	await broadcastToSessionUsers(io, row.sessionId, "sessionMessage", {
		sessionMessage: withParts ?? row
	})
}

/**
 * Who answered, for the refusal's sentence: a character's name, an envoy's
 * slug, a user's name — never a bare reference where a person reads it.
 */
async function answererName(db: Db, answered: FormAnswered): Promise<string> {
	const ref = parseParticipantRef(answered.by)
	if (ref.kind === "character") {
		const id = participantRowId(ref.id)
		if (id !== null) {
			const [c] = await db
				.select({ name: schema.characters.name, nickname: schema.characters.nickname })
				.from(schema.characters)
				.where(eq(schema.characters.id, id))
				.limit(1)
			if (c) return c.nickname?.trim() || c.name
		}
	} else if (ref.kind === "user") {
		const id = participantRowId(ref.id)
		if (id !== null) {
			const [u] = await db
				.select({ username: schema.users.username, displayName: schema.users.displayName })
				.from(schema.users)
				.where(eq(schema.users.id, id))
				.limit(1)
			if (u) return u.displayName?.trim() || u.username
		}
	} else if (ref.kind === "envoy") return ref.slug
	return answered.by
}
