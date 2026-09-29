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
 * came from the draft — S2's slash argument — spends once its run lands.
 *
 * Pure, so the modal, the fire and the clear are tested without a page.
 */
import { parseSlashCommand, slashArgumentRefusal } from "@serene-pub/core-catalog/conversation"
import type { ListedCollects } from "$lib/shared/actions/collects"

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
 * - **refuse** — text supplied to an action that collects none (`/advance x`,
 *   `/narrator x`: Narrate takes no text). Nothing fires; the draft stays.
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
 * Whether a run's answer spends the draft its press carried: only a run that
 * landed or parked at a review gate (a cancel or an error keeps it), and only
 * while the composer still holds what was sent — text typed while the run
 * went is the person's next line, not this one. A slash command whose
 * argument was sent (`/nudge go north`, S2) holds what was sent.
 */
export function shouldClearDraft(
	outcome: { success?: boolean; parked?: boolean },
	sent: string,
	draftNow: string
): boolean {
	if (!(outcome.success || outcome.parked) || !sent) return false
	const now = draftText(draftNow)
	// A slash command (S2) spent its argument: `/nudge go north` sent `go north`.
	return now === sent || parseSlashCommand(now)?.argument === sent
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
