/**
 * Whether one of core's message verbs is offered on one message right now,
 * and why not when it is not (plans/29 R-15; plans/30 U5c).
 *
 * The server's action list (`sessions:actions`, venue `message`) says which
 * verbs this session offers and who may act; this says what the message's
 * own state permits — a reply still streaming has nothing to regenerate, a
 * hidden line is not edited in place. One table, read by the quick row and
 * the ⋮ menu alike, so the two can never disagree about a verb; it is the
 * client-side half of the per-message gate (`canControl`) the item rule
 * defers to.
 *
 * ⏳ U5e replaces the state half with declared `enabledWhen` predicates; until
 * then the conditions live here, keyed by the verb, and nowhere else.
 */

export interface VerbMessage {
	isGenerating?: boolean | null
	isHidden?: boolean | null
	characterId?: number | null
	isNarratorResponse?: boolean | null
	content?: string | null
}

export interface VerbContext {
	msg: VerbMessage
	isLastMessage: boolean
	canRegenerateLastMessage: boolean
	/** Some message is in edit mode (this one or another). */
	editing: boolean
	hasGeneratingMessage: boolean
	/** The item rule's answer for this message. */
	canControl: boolean
	/** Why Continue is unavailable in this session, when it is. */
	continueRefusal?: string
	/** A swipe can be taken on this message now. */
	canSwipe: boolean
	/** The action list's own answer — `canAct` off `sessions:actions`. */
	canAct: boolean
	/**
	 * The action's `act` names `item` (`itemGated` off `sessions:actions`),
	 * so `canAct` was answered `true` ahead of any message and the message's
	 * own ownership rule (`canControl`) decides here (U5c review, W6). Only
	 * read for a contributed action; core's verbs know their own rule.
	 */
	itemGated?: boolean
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
 */
export const VERB_REASONS = Object.freeze({
	notYours: "not yours to change",
	notYoursToUse: "not yours to use here",
	generating: "wait for the reply to finish",
	editing: "finish the edit first",
	hidden: "unhide it first",
	notNewest: "only the newest reply can be regenerated",
	noSwipe: "nothing to swipe to"
})

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
		if (holds) return { shown: true, disabled: true, ...(reason ? { reason } : {}) }
	return { shown: true, disabled: false }
}

/**
 * The state of a core verb on a message. A key this table does not know is
 * a contributed action and gets the generic answer: shown, disabled while
 * editing or generating, by the audience, and — for an item-gated one — by
 * the message's ownership rule. Every disabled answer carries its reason.
 */
export function coreVerbState(key: string, ctx: VerbContext): VerbState {
	const m = ctx.msg
	const R = VERB_REASONS
	const busy: Array<[boolean, string]> = [
		[ctx.hasGeneratingMessage, R.generating],
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
				off([!ctx.canControl, R.notYours], [!ctx.canRegenerateLastMessage, R.notNewest])
			)
		case "continue":
			return shown(
				isReply(m) && ctx.isLastMessage && !m.isGenerating && !!m.content,
				off(
					[!ctx.canControl, R.notYours],
					[!!ctx.continueRefusal, ctx.continueRefusal],
					[ctx.editing, R.editing]
				)
			)
		case "edit":
			return off([!ctx.canControl, R.notYours], ...busy, [!!m.isHidden, R.hidden])
		case "branch":
			return off([!ctx.canAct, R.notYoursToUse], ...busy)
		case "swipe":
			return shown(
				isReply(m) && !m.isGenerating,
				off([!ctx.canControl, R.notYours], [ctx.editing, R.editing], [!ctx.canSwipe, R.noSwipe])
			)
		case "hide":
		case "delete":
			return off([!ctx.canControl, R.notYours], ...busy)
		default:
			return shown(
				!m.isGenerating,
				off(
					[!ctx.canAct || (!!ctx.itemGated && !ctx.canControl), R.notYoursToUse],
					...busy
				)
			)
	}
}

/** The four fields the row reads off an action — the wire's `Actions.Action` has them. */
export interface RowAction {
	key: string
	specSlug: string
	canAct: boolean
	itemGated: boolean
}

/** The verb-table key for one listed action: core's by key, a contributed one under its own prefix. */
export const verbKeyOf = (a: { key: string; specSlug: string }): string =>
	a.specSlug === "core" ? a.key : `contributed:${a.key}`

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
	ctx: Omit<VerbContext, "canAct" | "itemGated">
): Array<{ action: A; state: VerbState }> {
	return primary
		.filter((a) => !(a.specSlug === "core" && a.key === "stop"))
		.map((a) => ({
			action: a,
			state: coreVerbState(verbKeyOf(a), {
				...ctx,
				canAct: a.canAct,
				itemGated: a.itemGated
			})
		}))
		.filter((q) => q.state.shown && !q.state.disabled)
}
