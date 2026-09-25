/**
 * The conversation widget's own model (C0b): what its parts read, derived
 * from the widget context alone, and what they do, through its verbs alone.
 *
 * `MessagesWidget` creates one and provides it; the log, each message, its
 * controls and the composer read it (`useConversation`) instead of taking the
 * page's callbacks as props. So the widget's state — which line is being
 * edited, whose menu is open, what is selected for a summary — is the
 * widget's, and every effect is an `invoke` (core's verbs, a contributed
 * action) or a `request` (something the host opens). Nothing here imports a
 * store, the socket or the page: the same source runs in a UI worker.
 */
import { getContext, setContext } from "svelte"
import { SvelteSet } from "svelte/reactivity"
import { useWidgetContext, type WidgetContextRef } from "$lib/shared/widgets/context"
import {
	NO_LINE,
	type ConversationDossierV1,
	type ConversationLineV1
} from "$lib/shared/widgets/conversation"
import type { WidgetRequestKind, WidgetRequests } from "@serene-pub/sdk"
import { canAnswerForm } from "$lib/client/utils/formAnswer"
import { setStatusTextResolver, statusTextIn } from "./text"
import type { StatusText } from "@serene-pub/sdk"

const KEY = Symbol("sp-conversation")

export type Conversation = ReturnType<typeof createConversation>

/** What a verb's subject is: a message, by id. */
type Subject = { id: number }

export function createConversation(widget: WidgetContextRef) {
	const ctx = () => widget.current
	const warn = (what: string) => (e: unknown) =>
		console.warn(`conversation: ${what} — ${e instanceof Error ? e.message : String(e)}`)

	let editingId = $state<number | null>(null)
	let menuFor = $state<number | undefined>(undefined)
	let selecting = $state(false)
	/** The lane the composer writes to, and the log shows (`main` by default). */
	let lane = $state("main")
	const selected = new SvelteSet<number>()

	// Status sentences in this widget's language (`text.ts`).
	setStatusTextResolver(
		() => ctx().locale.v1,
		(source) => ctx().t(source)
	)

	const dossier = $derived(
		((ctx() as unknown as { session_full?: { v1?: ConversationDossierV1 } }).session_full?.v1 ??
			null) as ConversationDossierV1 | null
	)

	// The host's summary finished: the selection it was handed ends.
	let summaryEnded: number | null = null
	$effect(() => {
		const n = dossier?.summaryEnded ?? 0
		if (summaryEnded !== null && n !== summaryEnded) {
			selecting = false
			selected.clear()
		}
		summaryEnded = n
	})

	function invoke(key: string, subject?: Subject, payload?: Record<string, unknown>) {
		try {
			ctx().invoke(key, { messageId: subject?.id, payload })
		} catch (e) {
			warn(key)(e)
		}
	}

	function request<K extends WidgetRequestKind>(kind: K, params: WidgetRequests[K]["params"]) {
		return ctx().request(kind, params).catch(warn(kind))
	}

	return {
		get ctx() {
			return ctx()
		},
		get dossier() {
			return dossier
		},
		/** The page's word on one line; nothing when it has none. */
		line(id: number): ConversationLineV1 {
			return dossier?.lines[id] ?? NO_LINE
		},
		t: (source: string) => ctx().t(source),
		/** A status sentence in the viewer's language. */
		statusText: (status: StatusText | null | undefined) =>
			statusTextIn(status, ctx().locale.v1, (source) => ctx().t(source)),

		/** May the viewer answer a form put to `addressee`? */
		canAnswer(addressee: string | undefined) {
			const f = dossier
			return canAnswerForm(
				addressee,
				{ userId: ctx().viewer.v1.userId, isOwner: !!f?.isOwner, isAdmin: ctx().viewer.v1.isAdmin },
				f?.cast
			)
		},

		// ── verbs ────────────────────────────────────────────────────────────
		invoke,
		/** A reply swiped: to the newer alternative (right) or the older (left). */
		swipe(subject: Subject, direction: "left" | "right") {
			invoke("swipe", subject, { direction })
		},
		request,

		// ── editing: the widget's own state; saving is the `edit` verb ───────
		edit: {
			get id() {
				return editingId
			},
			start(subject: Subject) {
				editingId = subject.id
				menuFor = undefined
			},
			cancel() {
				editingId = null
			},
			save(subject: Subject, content: string) {
				invoke("edit", subject, { content })
				editingId = null
			}
		},

		/** The lane the composer writes to; the log shows that lane's rows. */
		lane: {
			get current() {
				return lane
			},
			set(next: string) {
				lane = next || "main"
			}
		},

		/** Whose ⋮ menu is open — one at a time across the log. */
		menu: {
			get open() {
				return menuFor
			},
			set(id: number | undefined) {
				menuFor = id
			}
		},

		// ── selecting lines for a summary ────────────────────────────────────
		select: {
			get active() {
				return selecting
			},
			get ids() {
				return selected
			},
			start(subject?: Subject) {
				selecting = true
				selected.clear()
				if (subject) selected.add(subject.id)
				menuFor = undefined
			},
			stop() {
				selecting = false
				selected.clear()
			},
			toggle(subject: Subject) {
				// A line a scene already captured cannot join another.
				if (dossier?.scened.includes(subject.id)) return
				if (selected.has(subject.id)) selected.delete(subject.id)
				else selected.add(subject.id)
			},
			set(ids: number[]) {
				selected.clear()
				for (const id of ids) selected.add(id)
			},
			/**
			 * From a line toward one end, up to the nearest line already
			 * selected — never through a line a scene has already captured.
			 */
			range(index: number, toward: "above" | "below") {
				const rows = ctx().messages.v1 as Array<{ id: number }>
				const taken = new Set(dossier?.scened ?? [])
				const step = toward === "above" ? -1 : 1
				for (let i = index; i >= 0 && i < rows.length; i += step) {
					const id = rows[i].id
					if (taken.has(id)) break
					if (selected.has(id) && i !== index) break
					selected.add(id)
				}
			},
			/**
			 * Hand the selection to the host's summarizer. It stays until the host
			 * says the summary finished (`summaryEnded`): a cancelled or failed
			 * create keeps a hand-picked selection.
			 */
			commit(kind: "scene" | "world" | "character") {
				ctx().request("summarize", { kind, messageIds: [...selected] }).catch(warn("summarize"))
			}
		}
	}
}

export function setConversation(c: Conversation): Conversation {
	return setContext(KEY, c)
}

export function useConversation(): Conversation {
	const c = getContext<Conversation | undefined>(KEY)
	if (!c) throw new Error("a conversation part rendered outside MessagesWidget")
	return c
}

/**
 * The widget's `t` for a part that may also render outside a widget (a
 * block view in a test): the English source there.
 */
export function useT(): (source: string) => string {
	const w = useWidgetContext()
	return (source) => w?.current.t?.(source) ?? source
}
