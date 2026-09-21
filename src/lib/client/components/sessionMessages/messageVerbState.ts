/**
 * Whether one action is offered on one message right now, and why not when
 * it is not (plans/29 R-15; plans/30 U5c, U5e).
 *
 * The server's action list (`sessions:actions`, venue `message`) says which
 * actions this session offers, who may act (`canAct`, `itemGated`), and the
 * **enabled-when verdict** over the session's published values (`enabled`,
 * `reason`) — plus the `item.*` predicates it could not judge without a
 * message (`itemPredicates`). This is where those are judged: the row's own
 * `item` document is built here (`shared/actions/itemValues.ts`, the same
 * shape the server builds at the door) and `core:verdict/enablement`'s
 * `judge` (01 §13) runs over it. One table, read by the quick row and the
 * ⋮ menu alike, so the two can never disagree about a verb.
 *
 * What stays client-side, because it is not a published value: an edit in
 * progress (`editing`), the item rule's sentence, and the audience's — which
 * is `core:verdict/audience`'s own sentence, quoted (01 §13), never a
 * paraphrase of it. Every other condition a verb greys on — the newest row,
 * hidden, generating, a swipe to take — is a declared predicate on
 * `CORE_ACTIONS` (U5e), and the sentence beside a grey entry is that
 * predicate's `reason`.
 */

import {
	audienceVerdict,
	enablementVerdict,
	CORE_VERB_REASONS,
	i18nText,
	type EnabledWhen,
	type ParticipantRef
} from "@serene-pub/sdk"
import { statusText } from "$lib/client/i18n/state.svelte"
import { itemValuesOf } from "$lib/shared/actions/itemValues"

export interface VerbMessage {
	id?: number
	isGenerating?: boolean | null
	isHidden?: boolean | null
	characterId?: number | null
	isNarratorResponse?: boolean | null
	content?: string | null
	role?: string | null
	/**
	 * Which channel the row is on (R-C) — read here so an `item.channel`
	 * predicate is answered the same way on both sides. Absent is `main`, the
	 * column's own default, so nothing moves for a session with one channel.
	 */
	channel?: string | null
	metadata?: {
		isGreeting?: boolean
		swipes?: { currentIdx: number | null; history: string[] }
	} | null
}

export interface VerbContext {
	msg: VerbMessage
	isLastMessage: boolean
	/** Some message is in edit mode (this one or another). */
	editing: boolean
	hasGeneratingMessage: boolean
	/** The item rule's answer for this message. */
	canControl: boolean
	/** Why Continue is unavailable in this session, when it is. */
	continueRefusal?: string
	/** The action list's own answer — `canAct` off `sessions:actions`. */
	canAct: boolean
	/** The action's name and `act` audience, off the list — what the audience's sentence names. */
	action: { name: string; act: ReadonlyArray<string> }
	/**
	 * The action's `act` names `item` (`itemGated` off `sessions:actions`),
	 * so `canAct` was answered `true` ahead of any message and the message's
	 * own ownership rule (`canControl`) decides here (U5c review, W6). Only
	 * read for a contributed action; core's verbs know their own rule.
	 */
	itemGated?: boolean
	/**
	 * The enabled-when verdict off the list (U5e): every predicate the
	 * server could evaluate holds. Absent (an older server) reads as
	 * enabled.
	 */
	enabled?: boolean
	/** Why it is grey when `enabled` is false — already resolved to a sentence. */
	reason?: string
	/** The `item.*` predicates, judged here against this message. */
	itemPredicates?: ReadonlyArray<EnabledWhen>
}

export interface VerbState {
	/** Rendered at all on this message. */
	shown: boolean
	/** Rendered, but not pressable. */
	disabled: boolean
	/** The sentence beside a disabled verb, when one exists. */
	reason?: string
}

const isReply = (m: VerbMessage) => !!m.characterId || !!m.isNarratorResponse

/**
 * The sentences beside a disabled verb — the same words the chips and the
 * palette use for the same conditions (`paletteRowState`), so a person
 * meets one vocabulary wherever a control is grey (U5c review, UI nit 2).
 * The state half is the SDK's (`CORE_VERB_REASONS`, the `reason` of each
 * core verb's predicate); the two that are not published values are here.
 * The audience's sentence is not: it is the verdict's (`notYoursToUse`).
 */
export const VERB_REASONS = Object.freeze({
	notYours: "not yours to change",
	editing: "finish the edit first",
	generating: CORE_VERB_REASONS.generating.en,
	hidden: CORE_VERB_REASONS.hidden.en,
	notNewest: CORE_VERB_REASONS.notNewest.en,
	noSwipe: CORE_VERB_REASONS.noSwipe.en
})

/**
 * The audience's sentence for an action that is not the viewer's to use —
 * `core:verdict/audience`'s own words, the ones the fire refuses with (01
 * §13). Asked once the refusal is decided: the listing answered that the
 * viewer holds none of the references (`canAct: false`), or the row's own
 * ownership rule answered for `item` — so no portrayal is handed to the
 * judge and the item rule's answer is `false`, and the judge says the
 * sentence for the audience as declared.
 */
export function notYoursToUse(action: { name: string; act: ReadonlyArray<string> }): string {
	const heard = audienceVerdict.judge({
		name: action.name,
		refs: action.act as ReadonlyArray<ParticipantRef>,
		portrayals: {},
		viewer: { userId: "" },
		item: false
	})
	return heard.ok ? "" : (i18nText(heard.sentence) ?? "")
}

/**
 * A disabled state with its reason: the first condition that holds names
 * the sentence, in the order the caller lists them — the audience's own
 * word first, as the palette does, so a greyed control does not change its
 * reason because something else is busy.
 */
const off = (
	...conditions: Array<[holds: boolean, reason: string | undefined]>
): VerbState => {
	for (const [holds, reason] of conditions)
		if (holds)
			return {
				shown: true,
				disabled: true,
				...(reason ? { reason } : {})
			}
	return { shown: true, disabled: false }
}

/**
 * The enabled-when half for one message (U5e): the list's verdict over the
 * session's values first (`session.generating`, `state.*` — the server's,
 * re-listed whenever a reply starts or ends or the state changes), then the
 * `item.*` predicates over this row's own document — the same `item` the
 * server builds at the door, so the sentence here is the sentence a press
 * would be refused with.
 */
export function enabledWhenState(
	ctx: Pick<
		VerbContext,
		| "msg"
		| "isLastMessage"
		| "canControl"
		| "enabled"
		| "reason"
		| "itemPredicates"
	>
): [holds: boolean, reason: string | undefined] {
	if (ctx.enabled === false) return [true, ctx.reason]
	if (!ctx.itemPredicates?.length) return [false, undefined]
	const doc = {
		item: itemValuesOf(
			{
				id: ctx.msg.id ?? 0,
				isHidden: ctx.msg.isHidden,
				isGenerating: ctx.msg.isGenerating,
				role: ctx.msg.role,
				channel: ctx.msg.channel,
				metadata: ctx.msg.metadata
			},
			{ isNewest: ctx.isLastMessage, mine: ctx.canControl }
		)
	}
	const heard = enablementVerdict.judge({ preds: ctx.itemPredicates, doc })
	if (heard.ok) return [false, undefined]
	return [true, statusText({ i18n: heard.sentence }) || (i18nText(heard.sentence) ?? "")]
}

/**
 * The state of a core verb on a message. A key this table does not know is
 * a contributed action and gets the generic answer: shown, disabled by the
 * audience, by its enabled-when, while editing, and — for an item-gated one
 * — by the message's ownership rule. Every disabled answer carries its
 * reason. What is *shown* is still the row's own affair (a streaming reply
 * has nothing to regenerate yet); what is *grey* is the audience, the
 * declared predicates, and an edit in progress.
 */
export function coreVerbState(key: string, ctx: VerbContext): VerbState {
	const m = ctx.msg
	const R = VERB_REASONS
	const when = enabledWhenState(ctx)
	const busy: Array<[boolean, string | undefined]> = [
		when,
		[ctx.editing, R.editing]
	]
	const shown = (visible: boolean, state: VerbState): VerbState =>
		visible ? state : { ...state, shown: false }
	switch (key) {
		case "stop":
			return { shown: !!m.isGenerating, disabled: false }
		case "retry":
			return shown(
				isReply(m) && ctx.isLastMessage && !m.isGenerating,
				off([!ctx.canControl, R.notYours], when)
			)
		case "continue":
			return shown(
				isReply(m) &&
					ctx.isLastMessage &&
					!m.isGenerating &&
					!!m.content,
				off(
					[!ctx.canControl, R.notYours],
					[!!ctx.continueRefusal, ctx.continueRefusal],
					...busy
				)
			)
		case "edit":
			return off([!ctx.canControl, R.notYours], ...busy)
		case "branch":
			return off([!ctx.canAct, ctx.canAct ? undefined : notYoursToUse(ctx.action)], ...busy)
		case "swipe":
			return shown(
				isReply(m) && !m.isGenerating,
				off(
					[!ctx.canControl, R.notYours],
					[ctx.editing, R.editing],
					when
				)
			)
		case "hide":
		case "delete":
			return off([!ctx.canControl, R.notYours], ...busy)
		default: {
			// An item-gated action's audience is decided on this row: the
			// item rule's answer rides into the verdict beside the list's.
			const notMine = !ctx.canAct || (!!ctx.itemGated && !ctx.canControl)
			return shown(
				!m.isGenerating,
				off(
					[
						notMine,
						notMine ? notYoursToUse(ctx.action) : undefined
					],
					...busy,
					// A contributed action declares no busy rule of its own
					// unless its author wrote one; the composer's guard
					// (nothing runs while a reply streams, S5) holds here too.
					[ctx.hasGeneratingMessage, R.generating]
				)
			)
		}
	}
}

/** The fields the row reads off an action — the wire's `Actions.Action` has them. */
export interface RowAction {
	key: string
	specSlug: string
	name: string
	audience: { act: string[] }
	canAct: boolean
	itemGated: boolean
	enabled?: boolean
	reason?: {
		i18n: { en: string } & Record<string, string>
		vars?: Record<string, string | number>
	}
	itemPredicates?: EnabledWhen[]
}

/** The verb-table key for one listed action: core's by key, a contributed one under its own prefix. */
export const verbKeyOf = (a: { key: string; specSlug: string }): string =>
	a.specSlug === "core" ? a.key : `contributed:${a.key}`

/** The listed verdict's half of the context, off one action — resolved to a sentence. */
export const verdictOf = (
	a: RowAction
): Pick<
	VerbContext,
	"canAct" | "itemGated" | "action" | "enabled" | "reason" | "itemPredicates"
> => ({
	canAct: a.canAct,
	itemGated: a.itemGated,
	action: { name: a.name, act: a.audience.act },
	...(a.enabled !== undefined ? { enabled: a.enabled } : {}),
	...(a.reason ? { reason: statusText(a.reason) || a.reason.i18n.en } : {}),
	...(a.itemPredicates?.length ? { itemPredicates: a.itemPredicates } : {})
})

/**
 * The message row's quick icons: the message venue's **primary set** (R-15
 * `quick`), core's and a plugin's alike (U5c review, S8 — a contributed
 * `quick` message action is in the primary set per the law, not only in the
 * ⋮ menu), each shown on exactly the messages the ⋮ menu offers it on and
 * only while the menu would have it enabled, through the one verb table
 * both read. Stop is the primary set's too, but it has its own pill rather
 * than an icon.
 */
export function quickRowActions<A extends RowAction>(
	primary: ReadonlyArray<A>,
	ctx: Omit<
		VerbContext,
		"canAct" | "itemGated" | "action" | "enabled" | "reason" | "itemPredicates"
	>
): Array<{ action: A; state: VerbState }> {
	return primary
		.filter((a) => !(a.specSlug === "core" && a.key === "stop"))
		.map((a) => ({
			action: a,
			state: coreVerbState(verbKeyOf(a), { ...ctx, ...verdictOf(a) })
		}))
		.filter((q) => q.state.shown && !q.state.disabled)
}
