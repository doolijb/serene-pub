/**
 * What a press collects before it fires (lair pass R3, owner 2026-09-28:
 * typing and then pressing an action is unintuitive, so an action that needs
 * text opens a modal for it). Replaces B10's `composerText.ts`, which read
 * the composer's draft and greyed the chip with nothing typed.
 *
 * An action declares `collects` (`@serene-pub/sdk` `CollectedText`,
 * `CollectedRecipients`); its listing carries it resolved (`ListedCollects`).
 * Every press of a collecting action opens the **collect modal**
 * (`CollectModal.svelte`), from any venue; S2's slash argument supplies the
 * text instead (`opensModal`'s `argument`). Nothing here reads the composer.
 *
 * Also the page's composer-draft plumbing (D1), which a press whose text
 * came from the draft — S2's slash argument — spends the moment it fires and
 * gets back when its run is refused or fails (note 31);
 * and its narrations (`createNarrations`), whose answers spend or keep what
 * their press carried.
 *
 * Pure, so the modal, the fire and the clear are tested without a page.
 */
import { parseSlashCommand, slashArgumentRefusal } from "@serene-pub/core-catalog/conversation"
import type { ListedCollects } from "$lib/shared/actions/collects"
import { NARRATE_ACTION } from "$lib/shared/actions/identity"

export type { ListedCollects }

/** What the collect modal (or an argument) hands the fire. */
export interface Collected {
	text?: string
	recipients?: string[]
}

/**
 * Whether a press opens the collect modal: the action collects something
 * and the press has not already supplied it. An `argument` — S2's slash
 * argument — supplies the text, so a text-only action fires directly with
 * it; an action that also collects recipients still opens the modal (an
 * argument cannot carry who). A bare press always opens it.
 */
export function opensModal(
	action: { collects?: ListedCollects },
	argument?: string
): boolean {
	const c = action.collects
	if (!c || (!c.text && !c.recipients)) return false
	if (c.recipients) return true
	return !argument?.trim()
}

/**
 * Where one press goes (S2): the page's half of a press that may supply its
 * text (`WidgetInvokeArgs.text` — the composer's slash argument).
 *
 * - **refuse** — text supplied to an action that collects none (`/advance x`;
 *   `/narrator x` — core's Narrate turn control, which a narrator-voiced
 *   genre such as Adventure or the Lair offers, takes no text, while Chat's
 *   `/narrate` does). Nothing fires; the draft stays.
 * - **modal** — the action collects something the press lacks: no text, or
 *   recipients an argument cannot carry (Whisper), prefilled with the text.
 * - **fire** — a text-only action with its argument: fires with it.
 * - **plain** — collects nothing and was given nothing: fires as today.
 *
 * `pressedAs` names an action the page cannot find (a bare key).
 */
export type PressRoute =
	| { route: "refuse"; reason: string }
	| { route: "modal"; initialText: string }
	| { route: "fire"; collected: Collected }
	| { route: "plain" }

export function routePress(
	action: { slash?: string; name?: string; collects?: ListedCollects } | undefined,
	supplied?: Collected,
	pressedAs?: string
): PressRoute {
	const text = supplied?.text?.trim() || null
	if (text && !action?.collects?.text)
		return {
			route: "refuse",
			reason: action?.slash
				? slashArgumentRefusal({ slash: action.slash, collects: action.collects }, text)!
				: `'${action?.name ?? pressedAs ?? "This action"}' takes no text`
		}
	const collects = action?.collects
	if (!collects || (!collects.text && !collects.recipients)) return { route: "plain" }
	if (opensModal({ collects }, text ?? undefined)) return { route: "modal", initialText: text ?? "" }
	return { route: "fire", collected: collectedFire(collects, { ...supplied, ...(text ? { text } : {}) }) }
}

/**
 * Chat's Narrate with its text already supplied (genre uplift C2,
 * 2026-09-29): `/narrate the storm breaks` names the world narrator and says
 * what should happen, so it fires at once with that direction rather than
 * opening the narrator modal, whose first step is *who speaks*. The text to
 * fire with, or null — any other press of the narrator's two actions opens
 * the modal, as the chip's does.
 */
export function narrateDirectly(identity: string | null, route: PressRoute): string | null {
	if (identity !== NARRATE_ACTION || route.route !== "fire") return null
	return route.collected.text || null
}

/** What the narrator modal fires (`sessions:fireNarratorResponse`'s text and speaker). */
export interface NarratorRequest {
	instructions: string
	speaker?: { characterId: number | null; name: string | null }
}

/**
 * A narration the page fired and has not heard back about (C2 follow-up,
 * 2026-09-29): where its text came from, which decides what its answer
 * spends or keeps. `draft` — `/narrate <text>` typed in the composer;
 * `modal` — the narrator modal's press; `invoke` — a widget's or a frame's
 * invoke that carried its own text, which spends nothing.
 */
export type NarrationPress = { sessionId: number } & (
	/** `draft` — the whole draft the press spent, `/narrate …` included, for giving back. */
	| { from: "draft"; draft: string }
	| { from: "modal"; request: NarratorRequest }
	| { from: "invoke" }
)

/** What one narration's answer does to the page. */
export interface NarrationLanding {
	/**
	 * The draft its press spent, given back (note 31): the press did not land
	 * and the composer is empty.
	 */
	giveBack?: string
	/**
	 * The modal's press did not land — refused before its run, stopped, or
	 * failed: what it held, for its next opening.
	 */
	unlandedPress?: NarratorRequest
}

/**
 * One `sessions:fireNarratorResponse` answer, matched to the oldest press
 * still waiting on its session (`pending`, which it removes from). The server
 * answers every press exactly once — a refusal before the run included — and
 * a session's narrations run one at a time, in the order they were pressed,
 * so that press is the one answered. Matched per session because the page
 * outlives a switch of session: an answer for the session left behind is
 * not this one's. A draft press spent its draft when it fired; a refusal, a
 * stop or an error gives it back (`draftToGiveBack`), and keeps the modal's
 * text for its next opening the same way.
 */
export function landNarration(
	pending: NarrationPress[],
	outcome: { sessionId?: number; success?: boolean },
	draftNow: string
): NarrationLanding {
	const at = pending.findIndex((p) => p.sessionId === outcome.sessionId)
	const press = at === -1 ? undefined : pending.splice(at, 1)[0]
	if (press?.from === "draft") {
		const giveBack = draftToGiveBack(outcome, press.draft, draftNow)
		return giveBack === null ? {} : { giveBack }
	}
	if (press?.from === "modal" && !outcome.success) return { unlandedPress: press.request }
	return {}
}

/**
 * What the page lends its narrations (C2 follow-up, 2026-09-29): its own
 * state, read and written through these, so `+page.svelte` only wires
 * `createNarrations` and the tests run the page's bodies, not copies.
 */
export interface NarrationDeps {
	/** The session the page shows now. */
	sessionId: () => number
	/** What the composer holds now. */
	draft: () => string
	writeDraft: (content: string) => void
	/**
	 * The narrator modal's press that did not land, for the modal's next
	 * opening; null opens it empty.
	 */
	keepUnlanded: (press: NarratorRequest | null) => void
	/** Says why a narration was refused or failed — the page's toast. */
	say: (error: string) => void
	/** `sessions:fireNarratorResponse`. */
	send: (params: Sockets.Sessions.FireNarratorResponse.Params) => void
}

/** The page's narrations: its two presses, and its two answers' handlers. */
export interface Narrations {
	/** Narrations fired and not yet answered, oldest first (`landNarration`). */
	readonly pending: NarrationPress[]
	/**
	 * `/narrate <text>`, or an invoke that carried its own text: the world
	 * narrator, directed, fired at once. `fromDraft` when the text is the
	 * composer's draft, which the press spends at once and a refused or
	 * failed answer gives back (note 31).
	 */
	directed(instructions: string, fromDraft: boolean): void
	/**
	 * The narrator modal's press: it joins `pending`, and the unlanded press
	 * the modal kept is cleared — one press is either pending or unlanded.
	 */
	modal(request: NarratorRequest): void
	/**
	 * A `sessions:fireNarratorResponse` answer: removed from `pending`
	 * whichever session it answers, acted on only on the session the page
	 * shows — it gives back the draft of a press that did not land, and
	 * keeps the modal's press that did not.
	 */
	answered(msg: Sockets.Sessions.FireNarratorResponse.Response): void
	/**
	 * A `sessions:fireNarratorResponse:error` — why a press was refused or
	 * its run failed: said, never silent, on its own session's page. No
	 * `sessionId` is the socket layer's generic fallback, said anywhere.
	 */
	error(msg: Sockets.Sessions.FireNarratorResponse.ErrorResponse): void
}

export function createNarrations(deps: NarrationDeps): Narrations {
	const pending: NarrationPress[] = []
	return {
		pending,
		directed(instructions, fromDraft) {
			const sessionId = deps.sessionId()
			// The draft goes with the press (note 31): spent now, given back
			// if the answer says it did not land.
			const draft = deps.draft()
			if (fromDraft && draftHolds(instructions, draft)) {
				pending.push({ sessionId, from: "draft", draft })
				deps.writeDraft("")
			} else pending.push({ sessionId, from: "invoke" })
			deps.send({ sessionId, instructions })
		},
		modal(request) {
			const sessionId = deps.sessionId()
			deps.keepUnlanded(null)
			pending.push({ sessionId, from: "modal", request })
			deps.send({
				sessionId,
				instructions: request.instructions || undefined,
				// Absent means world narration, which is what this trigger has
				// always sent — the server reads its absence, not a mode flag.
				...(request.speaker ? { speaker: request.speaker } : {})
			})
		},
		answered(msg) {
			const landed = landNarration(pending, msg, deps.draft())
			if (msg.sessionId !== deps.sessionId()) return
			if (landed.giveBack !== undefined) deps.writeDraft(landed.giveBack)
			if (landed.unlandedPress) deps.keepUnlanded(landed.unlandedPress)
		},
		error(msg) {
			if (msg.sessionId != null && msg.sessionId !== deps.sessionId()) return
			deps.say(msg.error)
		}
	}
}

/** Whether the modal's submit may be pressed: required text written, recipients within bounds. */
export function collectReady(collects: ListedCollects, got: Collected): boolean {
	if (collects.text?.need === "required" && !got.text?.trim()) return false
	if (collects.recipients) {
		const n = got.recipients?.length ?? 0
		if (n < collects.recipients.min) return false
		if (collects.recipients.max !== undefined && n > collects.recipients.max) return false
	}
	return true
}

/** What the fire sends for what was collected: trimmed text when there is any, recipients when collected. */
export function collectedFire(collects: ListedCollects, got: Collected): Collected {
	const text = collects.text ? (got.text ?? "").trim() : ""
	return {
		...(text ? { text } : {}),
		...(collects.recipients ? { recipients: [...(got.recipients ?? [])] } : {})
	}
}

/**
 * One cast member the collect modal may pick (R3), with what the action's
 * overwritten slot holds for them now (R10 — a delver's current whisper), so
 * an overwrite is visible before it happens.
 */
export interface CollectMember {
	ref: string
	name: string
	holds?: string
}

/**
 * What `overwrites` holds for one cast member now, from the session state as
 * the page holds it (`state.cast.byId[<characterId>][<slot key>]`): a
 * non-empty string, else nothing.
 */
export function holdsOf(
	state: { cast?: Record<string, unknown> } | null | undefined,
	slotKey: string | undefined,
	characterId: number
): string | undefined {
	if (!slotKey) return undefined
	const byId = (state?.cast as { byId?: Record<string, Record<string, unknown>> } | undefined)?.byId
	const value = byId?.[String(characterId)]?.[slotKey]
	return typeof value === "string" && value.trim() ? value : undefined
}

/** A run of the reach sentence: plain text, or a name (drawn strong). */
export type ReachRun = { text: string; name?: true }

/**
 * **Who will and won't hear it** (lair re-plan R10, owner ruling 5: make it
 * clear who does and doesn't get the hint): the picked members, the members
 * left out, and — never a recipient, since recipients are cast members — the
 * pipeline's own voice (`ownVoice`, the Lair's Castellan: its planner, its
 * books, its narration). As runs, so the page draws the names strong.
 *
 * - nobody picked: "Pick who hears it. Nobody else will, not even the Castellan."
 * - some: "**Brannoc** and **Vell** will hear this. **Isolde** will not, and nor will the Castellan."
 * - everyone: "**Brannoc** and **Vell** will hear this. The Castellan will not."
 */
export function reachSentence(
	cast: readonly { ref: string; name: string }[],
	picked: readonly string[],
	ownVoice?: string
): ReachRun[] {
	const voice = ownVoice?.trim()
	const will = cast.filter((m) => picked.includes(m.ref)).map((m) => m.name)
	const wont = cast.filter((m) => !picked.includes(m.ref)).map((m) => m.name)
	if (!will.length)
		return [{ text: voice ? `Pick who hears it. Nobody else will, not even the ${voice}.` : "Pick who hears it. Nobody else will." }]
	const names = (list: string[]): ReachRun[] =>
		list.flatMap((name, i) => [
			...(i === 0 ? [] : [{ text: i === list.length - 1 ? " and " : ", " }]),
			{ text: name, name: true as const }
		])
	const runs: ReachRun[] = [...names(will), { text: " will hear this." }]
	if (wont.length)
		runs.push(
			{ text: " " },
			...names(wont),
			{ text: voice ? ` will not, and nor will the ${voice}.` : " will not." }
		)
	else runs.push({ text: voice ? ` The ${voice} will not.` : " Nobody else will." })
	return runs
}

/** The reach sentence as plain text (its runs joined). */
export const reachText = (runs: readonly ReachRun[]): string => runs.map((r) => r.text).join("")

/** The line the action legend says about what an action asks for, or nothing. */
export function collectsNote(collects: ListedCollects | undefined): string | undefined {
	if (!collects) return undefined
	const parts: string[] = []
	if (collects.recipients) parts.push("Asks who hears it")
	if (collects.text?.need === "required") parts.push("Asks for text")
	if (collects.text?.need === "optional") parts.push("Asks for text, if you have any")
	return parts.length ? parts.join(" · ") : undefined
}

/**
 * The draft as text an action can take: trimmed, and a slash query (`/nudge`,
 * the palette's filter) is not text — it is how the action was named.
 */
export function draftText(draft: string): string {
	const text = draft.trim()
	return /^\/\S*$/.test(text) ? "" : text
}

/**
 * Whether the composer's draft is the text a press is sending (D1): the
 * draft itself, or a slash command whose argument it is (`/nudge go north`
 * sent `go north`, S2). Only such a draft is spent by the press.
 */
export function draftHolds(sent: string, draftNow: string): boolean {
	if (!sent) return false
	const now = draftText(draftNow)
	return now === sent || parseSlashCommand(now)?.argument === sent
}

/**
 * A draft a press spent the moment it fired (next-pass note 31, 2026-10-02:
 * a slash command that runs leaves the composer at once, not when its run
 * lands — a long run left `/narrate …` sitting in the field as if nothing
 * happened). `draft` is the whole draft as it stood, `/nudge go north`
 * included, for giving back.
 */
export interface SpentDraft {
	/** The pressed action's identity, which its run's answer names. */
	identity: string
	/** The draft as it stood when the press spent it. */
	draft: string
}

/**
 * The draft a run's answer gives back (note 31): its press spent it when it
 * fired, and a run that did not land — refused before it ran, failed, or
 * stopped — returns it, so a refusal costs nothing typed. Only into an empty
 * composer: text written since is the person's next line, never overwritten.
 * Null when the run landed or parked at a review gate, or the composer holds
 * something.
 */
export function draftToGiveBack(
	outcome: { success?: boolean; parked?: boolean },
	spent: string,
	draftNow: string
): string | null {
	if (outcome.success || outcome.parked || !spent.trim()) return null
	return draftNow.trim() ? null : spent
}

/**
 * The page's write to core's composer draft (D1, `ConversationComposerV1.draft`):
 * the composer owns the draft between writes, and takes a write — whatever
 * its field holds — only when its number is new. The one way the page
 * replaces or clears what the composer shows.
 */
export interface DraftWrite {
	content: string
	write: number
}

/** The next write after `last`: `content`, under a new number. */
export function nextDraftWrite(last: DraftWrite, content: string): DraftWrite {
	return { content, write: last.write + 1 }
}
