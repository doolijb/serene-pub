/**
 * The session page's **inbox**: the ONE subscriber to every reply and push
 * the page reads, and where its stores and views hear them.
 *
 * It declares each event once on the interest registry: the bare ones for
 * the page's lifetime, the scoped ones keyed on the session (its book, each
 * authored owner) in effects that release the old scope as they take the new.
 * A store or a view registers a listener with `on(event, listener)` and is
 * handed every reply of that event, in the order the listeners registered.
 * Two keys are not the inbox's: the narration's answer and refusal, which the
 * page declares beside its `createNarrations`; and a per-ask table
 * (`pageAsks.ts`, the page's `runOfMessage`) declares its reply only while an
 * ask waits.
 */
import { getContext, setContext } from "svelte"
import {
	declareInterest,
	type InterestEvent
} from "$lib/client/sockets/interest.svelte"
import type { SocketEventMap } from "$lib/client/sockets/typedSocket"
import { interestKey } from "$lib/shared/sockets/interest"
import { hearLoreRanked } from "$lib/client/components/sessionPage/loreRanked"
import { hearLoreMarked } from "$lib/client/components/sessionPage/loreMarked"
import { hearGenreFieldsChanged } from "$lib/client/components/sessionPage/genreFieldsChanged"
import { hearStoryMoved } from "$lib/client/components/sessionPage/storyMoved"
import { authoredReloadKeys } from "$lib/client/components/sessionPage/authoredReload"
import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"

/**
 * The page-level replies and pushes, every one BARE — none of them has an
 * entry in `SCOPED_EVENTS`, and a `#<id>` key for an event the shared table
 * does not scope matches NO payload at all. Each listener's own
 * `msg.sessionId !== sessionId` check stays the filter. Never gated or not,
 * each for its own reason:
 *
 * · `sessionMessage:error` is a refusal with no id on it, never gated
 *   (plan ruling 2), and page-level on purpose: the modals tear their own
 *   listeners down on close, so a run that failed while minimized would
 *   otherwise report nothing at all. A failed scene summarize is not
 *   heard here: the Process scene window says it, or Layout does once
 *   the window is closed (`sceneRunShown.ts`).
 * · `media:changed` IS scoped — on the media row's id — and this page
 *   wants every one of them: it repaints whichever avatar or scene image
 *   changed, wherever it changed. A bare key is the request for "all
 *   scopes", which is exactly right here.
 * · `sessionMessages:delete` answers with a message ROW and no session
 *   beside it, so it has no `SCOPED_EVENTS` entry at all; the data's own
 *   check against the rows on screen stays the filter.
 * · `characters:update` is a page-level push with NO id filter of its own:
 *   whichever character changed, the page folds the new row into the
 *   session it is showing if it is in the cast — as a character, as a
 *   persona, or as both, since a persona IS a character. It is also what
 *   `characters:setAvatar` cascades, which is how a new portrait reaches an
 *   open session.
 * · The two scene refusals carry no id; their success halves are scoped.
 * · `sessions:summarize:error` and the other `:error` halves are never gated
 *   (plan ruling 2 — errors are not outputs to skip), but the registry is the
 *   only listener path, so they are declared like the rest.
 */
const BARE_EVENTS = [
	"sessionMessages:sendPersonaMessage",
	"attachments:removeFromMessage:error",
	"sessions:presetStatus",
	"sessions:promptTokenCount",
	"sessions:turnOrder",
	"sessions:spriteSetChanged",
	"sessions:setSpriteSet",
	"sessions:fireTurn:error",
	"sessions:fireTurn",
	// 🚧 A rerun verb's answer — its refusal is `{ error }` on the verb's own
	// event, with no id (`rerunRefusals.svelte.ts`).
	"sessionMessages:swipeRight",
	"sessionMessages:swipeLeft",
	"sessionMessages:regenerate",
	"sessionMessages:extend",
	"sessions:retakeTurn",
	"sessions:retakeTurn:error",
	"sessions:addPersona",
	"sessions:branch",
	"sessions:getNarratorName",
	"sessions:sideCharacterOptions",
	"sessions:view",
	"sessions:panelLayout:get",
	"sessions:panelLayout:startFrom",
	"sessions:panelLayout:startFrom:error",
	"sessions:layoutPreset:save",
	"sessions:layoutPreset:rename",
	"sessions:layoutPreset:delete",
	"sessions:layoutPreset:usage",
	"sessions:layoutPreset:share",
	"sessions:layoutPreset:clone",
	"sessions:layoutPreset:update",
	"sessions:layoutPreset:share:error",
	"sessions:layoutPreset:clone:error",
	"sessions:layoutPreset:update:error",
	"sessions:layoutPreset:setNewSessionLayout:error",
	"sessions:layoutPreset:setNewSessionLayout",
	"sessions:surfaceIntent",
	"sessions:fireAction",
	"sessions:summarize:error",
	"sessionMessage:error",
	"media:changed",
	"sessionMessages:delete",
	"sessions:revisionNotice",
	"scenes:scenedMessageIds:error",
	"scenes:list:error",
	"characters:update"
] as const satisfies readonly InterestEvent[]

/**
 * The replies and pushes SCOPED to the session in the route, keyed on its id
 * so a client-side navigation between sessions releases `#41` as it takes
 * `#42`. Every emitter puts `sessionId` on the payload (see `SCOPED_EVENTS`),
 * so a tab on another session is not sent this one's chunks, ticks, lists or
 * views — and the server builds nothing for it.
 *
 * No BARE `sessions:get` alongside them: the not-found reply carries the
 * requested id on `sessionId`, so `scopeOfPayload` gives it this very scope.
 * A bare key would have matched every OTHER session's reply too — which on
 * the server means the gate passing for every id while this page is open.
 *
 * `scenes:list` and `scenes:scenedMessageIds` are STANDING rather than
 * one-shot: both are cascade targets, re-sent when a scene is created,
 * processed or deleted, which is how the scene markers on the transcript stay
 * honest. `sessions:actions` is the reply to the page's own request and the
 * push every finished run makes (U5e review W-A4).
 */
const SESSION_SCOPED_EVENTS = [
	"state:changed",
	"sessionMessage",
	"sessions:get",
	// 🚧 pr-6: the member push, split from the reply.
	"sessions:refresh",
	"sessions:userTyping",
	// Who of the session's people has it open (W10). Holding this key IS this
	// tab having the session open, to the server's attendance push.
	"sessions:attendance",
	"sessions:recordedEvent",
	"sessions:actions",
	"sessions:genreOf",
	"sessions:annex",
	// 🚧 The session's backdrop moved — folded into the page's session.
	"sessions:backdropChanged",
	"sessions:panelLayout:startedFromUpdated",
	"pipelines:runStarted",
	"pipelines:progress",
	// Each run's status (R-19) — a reply's carries its channel, which is
	// what the page's waiting row is drawn from (`pendingReply.ts`).
	"sessions:runStatus",
	"scenes:scenedMessageIds",
	"scenes:list",
	// 🚧 Live scenes, lane D: the session's scene cues and scene settings,
	// pushed when a line raises a cue, one is decided, a boundary moves or
	// the settings are saved (`sceneCuesFlow.svelte.ts`).
	"scenes:cues"
] as const satisfies readonly InterestEvent[]

/** Every event the inbox holds the session page's one interest in. */
export type SessionPageEvent =
	| (typeof BARE_EVENTS)[number]
	| (typeof SESSION_SCOPED_EVENTS)[number]
	| "lorebooks:bindingList"
	| "components:changed"

/** What a listener of one event is handed. */
export type SessionPageReply<K extends SessionPageEvent> =
	SocketEventMap[K]["response"]

/** The session page's inbox: where a store or a view hears a reply. */
export interface SessionPageInbox {
	/** Registers `listener` for every reply of `event`; returns its release. */
	on<K extends SessionPageEvent>(
		event: K,
		listener: (msg: SessionPageReply<K>) => void
	): () => void
}

/** What the inbox's scoped keys are keyed on, read as they move. */
export interface SessionPageInboxScope {
	/** The session in the route. */
	sessionId(): number
	/** The session's book — whose entries' marks the widgets hear (plan A14). */
	lorebookId(): number | null
	/**
	 * The session's book for its OWNER only, else null — whose cast
	 * (`lorebooks:bindingList`) the page reads; the server refuses anyone
	 * else's ask.
	 */
	ownLorebookId(): number | null
	/** The authored owners the page offers, space-joined (`authoredOwnersOf`). */
	authoredOwners(): string
	/** The page's widgets, told when the session's lore is ranked or marked, its genre fields move, or its story moves. */
	widgets: SurfaceManager
}

export const SESSION_PAGE_INBOX_CONTEXT = "sessionPageInbox"

/**
 * The inbox, declared during the page's init. Created ahead of every store
 * that registers on it and ahead of the page's session-load effect: effects
 * run in declaration order, so every key is held before the first request
 * group goes out (whose typed `emit` flushes the interest sync ahead of it —
 * plan ruling 3).
 */
export function createSessionPageInbox(
	scope: SessionPageInboxScope
): SessionPageInbox {
	const listeners = new Map<SessionPageEvent, Set<(msg: any) => void>>()
	/** One handler per event — the function every key of that event is declared with. */
	const handlers = new Map<SessionPageEvent, (msg: unknown) => void>()
	const handlerOf = (event: SessionPageEvent) => {
		let handler = handlers.get(event)
		if (!handler) {
			handler = (msg) => {
				for (const listener of listeners.get(event) ?? []) listener(msg)
			}
			handlers.set(event, handler)
		}
		return handler
	}

	$effect(() => {
		const releases = BARE_EVENTS.map((event) =>
			declareInterest(event, handlerOf(event))
		)
		return () => {
			for (const release of releases) release()
		}
	})

	$effect(() => {
		const sessionId = scope.sessionId()
		if (!Number.isFinite(sessionId)) return
		const releases = [
			...SESSION_SCOPED_EVENTS.map((event) =>
				declareInterest(interestKey(event, sessionId), handlerOf(event))
			),
			// This session's lore was ranked (R81), to the widgets that read it.
			hearLoreRanked(sessionId, scope.widgets),
			// Its stored genre fields moved (Edit Session, the Author's note in
			// another tab): to the widgets that show one (2026-10-03).
			hearGenreFieldsChanged(sessionId, scope.widgets)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	/**
	 * A change the viewer makes to an entry of the session's book — a mark
	 * set in a widget, a pin or an Off saved in an editor — to the widgets
	 * that read the lore (plan A14). SCOPED to the book, so its key moves
	 * with the session's book.
	 */
	$effect(() => {
		const lorebookId = scope.lorebookId()
		if (!lorebookId) return
		return hearLoreMarked(lorebookId, scope.widgets)
	})

	/**
	 * 🚧 The session's story moved (Chronicle, W3): a history entry of its
	 * book — the OWNER's book only, whose entry replies reach this page —
	 * and, below, its clock or line (`state:changed`, which every such move
	 * sends) and its scenes (`scenes:list`, the cascade of every scene
	 * write). Widgets hear `story:moved`.
	 */
	$effect(() => {
		const lorebookId = scope.ownLorebookId()
		if (!lorebookId) return
		return hearStoryMoved(lorebookId, scope.widgets)
	})
	const storyMoved = () => scope.widgets.announceStoryMoved()
	listeners.set("state:changed", new Set([storyMoved]))
	listeners.set("scenes:list", new Set([storyMoved]))
	// 🚧 The cues and the scene settings moved: Chronicle's summary mode
	// and *Summarize all (N)* read them (live scenes §7).
	listeners.set("scenes:cues", new Set([storyMoved]))

	/**
	 * The cast of the session's book, SCOPED to that book — the reply carries
	 * `lorebookId` (see `SCOPED_EVENTS`). No bare key alongside it, which
	 * would have matched every other book's reply and kept the server's gate
	 * open for all of them. An effect because the key moves — the session
	 * loads after the page does, and its book can be changed while it is
	 * open. Read through `ownLorebookId`, never the session's book as such.
	 */
	$effect(() => {
		const lorebookId = scope.ownLorebookId()
		if (!lorebookId) return
		return declareInterest<"lorebooks:bindingList">(
			interestKey("lorebooks:bindingList", lorebookId),
			handlerOf("lorebooks:bindingList")
		)
	})

	/**
	 * Live reload of the authored components the page draws (C6, P5,
	 * `authoredReload.ts`): one SCOPED `components:changed` key per authored
	 * owner offered, so a page hears only about its own.
	 */
	$effect(() => {
		const key = scope.authoredOwners()
		const owners = key ? key.split(" ") : []
		const releases = authoredReloadKeys(owners).map((k) =>
			declareInterest<"components:changed">(
				k,
				handlerOf("components:changed")
			)
		)
		return () => releases.forEach((release) => release())
	})

	return {
		on(event, listener) {
			let set = listeners.get(event)
			if (!set) {
				set = new Set()
				listeners.set(event, set)
			}
			set.add(listener)
			return () => {
				set.delete(listener)
			}
		}
	}
}

/** Sets the inbox as the page's context. Call during the page's init. */
export function provideSessionPageInbox(inbox: SessionPageInbox): void {
	setContext(SESSION_PAGE_INBOX_CONTEXT, inbox)
}

/** Runs `listener` for every reply of `event` while the calling view is mounted. */
export function hearOnSessionPage<K extends SessionPageEvent>(
	event: K,
	listener: (msg: SessionPageReply<K>) => void
): void {
	const inbox = getContext<SessionPageInbox>(SESSION_PAGE_INBOX_CONTEXT)
	$effect(() => inbox.on(event, listener))
}
