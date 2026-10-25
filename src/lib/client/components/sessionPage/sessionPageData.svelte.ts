/**
 * The session page's data: what the replies in its inbox write
 * (`sessionPageInbox.svelte.ts`) — the session and its pages of lines, who
 * else is typing, the viewer's annex view, the session view
 * (`sessions:view`) and the genre list, the preset verdict, the narrator's
 * name — and what the page derives from them once for every reader: the
 * newest line, whether a reply is generating, the genre's shape, who the
 * viewer is and speaks as.
 */
import { onDestroy, onMount, untrack } from "svelte"
import { runProgress } from "$lib/client/stores/runProgress.svelte"
import type { RunProgress } from "$lib/shared/sockets/progress"
import { createPendingReplies } from "$lib/client/components/sessionPage/pendingReply.svelte"
import { page } from "$app/state"
import { goto, replaceState } from "$app/navigation"
import { deleteReplyAction, sessionAddress } from "$lib/client/components/sessionPage/deleteReply"
import {
	LANDING_SEEK_FRAMES,
	landingTarget,
	nextLandingStep,
	readMessageLanding,
	withoutLanding
} from "$lib/client/sessions/messageLanding"
import { landOn } from "$lib/client/utils/landOn"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import { requestWithInterest } from "$lib/client/sockets/interest.svelte"
import type { ChannelLaneV1 } from "@serene-pub/sdk"
import type { StoryClock as StoryClockParts } from "$lib/shared/lorebooks/storyDate"
import { readStoryCalendar, type StoryCalendar } from "$lib/shared/lorebooks/storyDate"
import { withRevisedAvatar } from "$lib/client/utils/media"
import { lastAuthorLine } from "$lib/client/components/sessionPage/swipeControls"
import { createRerunRefusals, rowAsks } from "$lib/client/components/sessionPage/rerunRefusals.svelte"
import {
	canControlMessageAs,
	characterForRefIn,
	messageCharacterOf,
	personLineOf
} from "$lib/client/components/sessionPage/sessionPageProjections"
import type { SessionPageInbox } from "$lib/client/components/sessionPage/sessionPageInbox.svelte"
import type { MessageV1 } from "@serene-pub/sdk"
import { DEFAULT_CHANNEL, parseChannel } from "@serene-pub/sdk"
import { ownVoiceName } from "$lib/shared/sessions/ownVoiceName"
import { rewindStateOf, withStackReplaced, type RewindState } from "$lib/shared/sessions/rewind"
import { sessionStore } from "$lib/client/sessions/store/sessionStore.svelte"
import { generatingOf, rewindOf } from "$lib/client/sessions/store/derive"
import type { SessionPayload } from "$lib/client/sessions/store/records"
import {
	asksToJoin,
	offersSeat,
	isLivePlayerSeat,
	ownCardlessPlayerSeats
} from "$lib/shared/sessions/playerSeat"
import {
	resolvePlayerLabel,
	storedPlayerLabel
} from "$lib/shared/sessions/playerLabel"
import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"

export interface SessionPageDataDeps {
	socket: TypedSocket
	inbox: SessionPageInbox
	/** The session in the route. */
	sessionId(): number
	/** The loaded session's id (the page's primitive) — what the typing ping and the persona pick key on. */
	loadedSessionId(): number | null
	userCtx: UserCtx
	/** The widgets beside the conversation, told of every line that lands, moves or goes. */
	widgets: SurfaceManager
	/** The composer's draft, as the page holds it. */
	draft(): string
	/** The page's one way to change the draft — the kept draft, on the session's first load. */
	writeDraft(content: string): void
}

/**
 * The loaded session and what the page derives from it. Registers its
 * listeners on the inbox at once; call during the page's init, after the
 * inbox.
 */
export function createSessionPageData(d: SessionPageDataDeps) {
	const socket = d.socket
	const userCtx = d.userCtx
	const surfaceManager = d.widgets
	const sessionId = $derived(d.sessionId())
	const loadedSessionId = $derived(d.loadedSessionId())
	const newMessage = $derived(d.draft())
	const writeDraft = (content: string) => d.writeDraft(content)

	// 🚧 The session is the store's records composed back (pr-6s2 G3): the row, its
	// message rows and its cast (each a record of its own). The cast keeps its identity
	// across streamed chunks — it reads no message.
	/** The session this page last opened in the store (plain: bookkeeping, never read by a derived). */
	let openedId: number | null = null
	const record = $derived(sessionStore.session(sessionId))
	const rows = $derived(record ? sessionStore.messagesOf(sessionId) : [])
	const cast = $derived(record ? sessionStore.castOf(sessionId) : undefined)
	const session: SessionPayload | undefined = $derived(
		record && cast ? ({ ...record, ...cast, sessionMessages: rows } as SessionPayload) : undefined
	)
	const pagination = $derived(sessionStore.windowOf(sessionId)?.pagination)
	let sessionNotFound = $state(false)
	let loadingOlderMessages = $state(false)

	// ── Typing indicator ──────────────────────────────────────────────────────
	// Other participants' personas currently typing, keyed by personaId. Purely
	// client-expired — there's no "stopped typing" event, entries just drop
	// off 10s after the last ping (matches how the composer's own throttled
	// ping below only re-fires every ~2.5s while text keeps changing).
	let typingPersonas: Map<number, { name: string; lastTypingAt: number }> =
		$state(new Map())
	let lastTypingEmitAt = 0
	let typingPruneInterval: ReturnType<typeof setInterval> | null = null
	/**
	 * Who of the session's people has it open (W10): the server's last
	 * `sessions:attendance` push for this session — `attendance.v1` is built
	 * over it (`projections/attendance.ts`).
	 */
	let attendance = $state.raw<Sockets.Sessions.Attendance.Response | null>(
		null
	)

	$effect(() => {
		const content = newMessage
		if (!sessionId || loadedSessionId === null || !content.trim()) return
		const now = Date.now()
		if (now - lastTypingEmitAt < 2500) return
		lastTypingEmitAt = now
		// Untracked: the ping answers the draft changing, never a streamed
		// chunk replacing `session` — which would tell the room this person
		// is typing for as long as a reply streams with text in the box.
		const personaId = untrack(
			() =>
				currentUserPersona?.personaId ||
				session?.sessionPersonas?.[0]?.personaId
		)
		if (personaId) socket.emit("sessions:typing", { sessionId, personaId })
	})
	onMount(() => {
		// "sessions:userTyping" is a scoped interest, held by the inbox.
		typingPruneInterval = setInterval(() => {
			const cutoff = Date.now() - 10_000
			let changed = false
			for (const [id, info] of typingPersonas) {
				if (info.lastTypingAt < cutoff) {
					typingPersonas.delete(id)
					changed = true
				}
			}
			if (changed) typingPersonas = new Map(typingPersonas)
		}, 1000)
		return () => {
			if (typingPruneInterval) clearInterval(typingPruneInterval)
		}
	})

	// Resolved display name for Narrator responses (session override -> user active
	// -> system default -> "Narrator"); labels the trigger button/
	// modal/character-picker option before any message exists.
	let narratorName = $state("Narrator")
	// Asked once per session. On the id, not `session`: reading through the
	// object would re-ask per token.
	$effect(() => {
		if (sessionId) {
			socket.emit("sessions:getNarratorName", { sessionId })
		}
	})

	// The session's frame surfaces (20 §12): a mode-declared session-view
	// replaces core's log wholesale (the total-conversion lane); panels are
	// every enabled plugin's declared side frames. Presence is data — a
	// disabled plugin takes its frames with it, and a missing view-plugin
	// falls back to core's log with no error.
	let sessionFrames = $state<Sockets.Sessions.View.Response | null>(null)
	const sessionViewFrame = $derived(sessionFrames?.sessionView ?? null)
	/**
	 * 🚧 The story calendar of the book this session reads, as the server
	 * last said it (`sessions:storyClock`'s `calendar`; PROPOSAL-live-scenes
	 * §15 G9) — what the conversation spells its dates through. Null: free-
	 * form, or not read yet. Which session it is for rides beside it, so a
	 * switch never spells one session's dates by another's book.
	 */
	let storyCalendar = $state<{ sessionId: number; calendar: StoryCalendar | null } | null>(null)
	/**
	 * What the pipeline's own voice is called (lair re-plan R5): the null
	 * turn entry and every line nobody claims — the genre's fallback envoy
	 * (declared, seated or not: the Lair's Castellan), else the narrator
	 * name above, else `UNCLAIMED_LINE_NAME`. The one rule
	 * (`ownVoiceName`) the ready line, the pickers' narrator row and the
	 * message names read; the server's seed line and progress card read it
	 * too. Chat's narrate *function* keeps `narratorName`.
	 */
	let ownVoice = $derived(
		ownVoiceName(
			{ envoys: sessionFrames?.envoys, narratorName },
			sessionFrames?.language ?? "en"
		)
	)
	/**
	 * Why Extend is unavailable on this session's messages, when it is.
	 *
	 * Off `sessions:view`, which the page already fetches once when a session
	 * opens and which already reads the genre — half the answer (`messageVerbs`)
	 * was there anyway, and the other half is the connection the replies resolve
	 * to. Session-level, so the button is disabled with the same sentence on
	 * every message rather than asking per row.
	 *
	 * ⚠ An affordance, not the enforcement. `sessionMessagesExtendHandler`
	 * refuses with this same sentence from the same resolution, so a stale value
	 * (an admin repointing the instance default while this page is open) costs a
	 * refusal message and never a wrong generation.
	 */
	const extendRefusal = $derived(sessionFrames?.extendRefusal)
	/**
	 * Which forbiddable message verbs this session's genre offers (R-15) —
	 * off the action list's message venue (U5c), the ONE list every verb
	 * control renders from: a forbidden opt-in built-in (`delete`, `hide`,
	 * `swipe`) or a forbidden `retry` is simply not listed, and the floors
	 * always are. Until the list has arrived, `sessions:view`'s
	 * `messageVerbs` answers, so the controls do not flash off and on while
	 * the page loads. An affordance, like `extendRefusal`: the handler
	 * refuses the verb regardless.
	 */
	const messageVerbs = $derived(sessionFrames?.messageVerbs)
	/**
	 * What this session may write beyond messages (R-B) — off `sessions:view`,
	 * resolved from the same declaration the write sites refuse with.
	 *
	 * An affordance, like `messageVerbs`: an absent answer (an older server, or
	 * the view not back yet) reads as on, and the summarize handler, the scene
	 * create handler and the lore-entry outlet each refuse independently. So a
	 * stale value costs a refusal message, never a write the genre forbade.
	 */
	const writes = $derived(sessionFrames?.writes)
	const offersWrite = (write: "lore" | "scenes") => writes?.[write] !== false

	/**
	 * The session's channels (20 §7; R-C) — off `sessions:view`, `main` first,
	 * and `[main]` for every session whose genre declares none.
	 */
	const sessionChannels = $derived(
		sessionFrames?.channels ?? [DEFAULT_CHANNEL]
	)
	/**
	 * Which of them the composer is writing on, and the log is showing.
	 *
	 * Held here rather than in the composer because BOTH halves answer to it:
	 * the send carries it to the server, where the row is stored on it and the
	 * reply is asked for on it, and the log hides what is not on it. One
	 * answer, in the one place that can hand it to both.
	 */
	let composerChannel = $state(DEFAULT_CHANNEL)
	$effect(() => {
		// A session whose genre lacks the chosen channel — a preset
		// changed under an open page, or the view arrived after a guess —
		// falls back to `main`, which every session has.
		// By slug: a lane (`parley:2`) is its channel's, and lanes are never
		// listed — only the channels the genre declares.
		const slug = parseChannel(composerChannel).slug
		if (!sessionChannels.some((c) => parseChannel(c).slug === slug))
			composerChannel = DEFAULT_CHANNEL
	})

	// The mode's shape (19 §1–§2): what capabilities exist for this session at
	// all. Null — an unknown mode, or a registry that never synced — means
	// today's behaviour exactly, the F29 posture the creation form shares.
	const genreRow = $derived(sessionStore.genreOf(sessionId) ?? null)
	const genreReplied = $derived(sessionStore.genreOf(sessionId) !== undefined)
	let modeShape = $derived(genreRow?.shape ?? null)
	// `composer: 'none'` — a purely trigger-driven mode: the tabs (triggers,
	// lore, stats) stay; the text input and send affordance go.
	let composerHidden = $derived(modeShape?.composer === "none")
	// Read-only (19 §6, ruled): a non-standard mode this build does not
	// register means the session's history stays readable and nothing starts a
	// new turn. Requires a reply for this session's genre to have arrived and
	// held no row — an in-flight fetch must not flash the banner over a healthy session.
	let modeMissing = $derived(
		genreReplied &&
			genreRow === null &&
			!!(session as any)?.genreId &&
			(session as any).genreId !== "core:genre/story"
	)
	// A capability the shape omits (or caps at zero) does not exist for the
	// session: no persona requirement on send, no character-response mechanics.
	let personasInMode = $derived(
		!modeShape ||
			(!!modeShape.personas && (modeShape.personas.max ?? 1) !== 0)
	)
	/**
	 * Whether a send needs a persona. The persona system existing is not
	 * the same as one being required: a genre declaring `personas: { min:
	 * 0 }` — the Guide, where a person asks as themselves — takes bare
	 * prose (19 §1), which the server has always stored. The standard
	 * chat keeps its historical requirement whatever its shape says, on
	 * the same parity footing as the creation form's floor.
	 */
	let personaRequiredOnSend = $derived(
		personasInMode &&
			// No special case for Chat any more (2026-10-19): a Story session with
			// `personas.min` 0 sends from a card-less seat under the person's name.
			(!modeShape ||
				(session as any)?.genreId == null ||
				(modeShape.personas?.min ?? 0) >= 1)
	)
	let charactersInMode = $derived(
		!modeShape ||
			(!!modeShape.characters && (modeShape.characters.max ?? 1) !== 0)
	)
	/**
	 * Whether this session runs what its preset says (ruled 2026-09-10).
	 *
	 * A binding whose pipeline has gone never stops the turn — the genre's
	 * default runs — so the only thing standing between that and silence is
	 * this banner. Sourced from the same verdict the run resolves against, by
	 * way of `sessions:presetStatus`, so the sentence and the substitution
	 * cannot disagree.
	 */
	let presetStatus: Sockets.Sessions.PresetStatus.Response | undefined =
		$state()
	/**
	 * Dismissed for this view only, deliberately.
	 *
	 * Nothing is written down: the condition is still true tomorrow, and a
	 * dismissal that outlived the tab would let a person hide a session
	 * running a pipeline nobody chose. Cleared on every session change below,
	 * because a dismissal is about the banner you just read.
	 */
	let presetBannerDismissed = $state(false)
	let presetStale = $derived(presetStatus?.stale ?? [])

	const handlePresetStatus = (
		res: Sockets.Sessions.PresetStatus.Response
	) => {
		if (res.sessionId !== sessionId) return
		presetStatus = res
	}

	/**
	 * What this viewer may see of the session annex (R57): the server's
	 * merged view, never the annex — every widget's `annex.v1`, read by the
	 * page's `sessionAnnex` context.
	 */
	let annexView = $state<Record<string, Record<string, unknown>>>({})
	const handleAnnex = (res: Sockets.Sessions.Annex.Response) => {
		if (res.sessionId !== sessionId) return
		const next = res.annex ?? {}
		// The same view again re-posts nothing to a frame and rebuilds no
		// widget context.
		if (JSON.stringify(next) === JSON.stringify(annexView)) return
		annexView = next
	}
	// The viewer's annex view (R57): asked for each session, its key held by
	// the inbox; the reply and the push every annex write makes land above.
	$effect(() => {
		if (!Number.isFinite(sessionId)) return
		annexView = {}
		socket.emit("sessions:annex", { sessionId })
	})

	// ── The waiting row (`pendingReply.ts`) ───────────────────────────────────
	// A reply run on its way whose own row is not open yet — a Dungeon
	// Crawler story turn through the Planner's call and the dice — is drawn
	// as a generating row of the page's own, with the run's status, so the
	// Story, the composer's Stop and the chips read "a reply is on its way"
	// from the first moment, as Chat's do. `opened`: the runs whose row has
	// been seen generating — never drawn again, whatever they do after.
	const pending = createPendingReplies({
		sessionId: () => sessionId,
		rows: () => session?.sessionMessages,
		runs: () => sessionStore.runsOf(sessionId)
	})
	const pendingRows = $derived(pending.rows)
	/**
	 * The session as every reader of this page sees it: the loaded session,
	 * plus the waiting rows after its own. The same object when there are
	 * none, so a session with no waiting reply re-renders nothing new.
	 */
	const sessionView = $derived(
		session && pendingRows.length
			? {
					...session,
					sessionMessages: [
						...session.sessionMessages,
						...(pendingRows as unknown as SelectSessionMessage[])
					]
				}
			: session
	)

	let lastMessage: SelectSessionMessage | undefined = $derived.by(() => {
		if (sessionView && sessionView.sessionMessages.length > 0) {
			return sessionView.sessionMessages[
				sessionView.sessionMessages.length - 1
			]
		}
		return undefined
	})

	/**
	 * Whether the session is generating, as the page's presses read it (a
	 * chip, the legend, the header): no session yet, its newest row writing,
	 * or a reply run still in flight after its row finished — the run the
	 * server's door (`sessionBusy`) waits on, read off the `sessions:runStatus`
	 * frames the page already hears. A `reply` or `action` run counts, by its
	 * kind (`generatingOf`); a routine run does not, though the door waits on
	 * it (the owner's open question, F option (a)). Read from the session
	 * store's rows and runs.
	 */
	const generating = $derived(!session || generatingOf(rows, sessionStore.runsOf(sessionId)))

	// The author's newest line — keyed on role, never on a persona (F1): a
	// persona-less genre's user line has no personaId (`swipeControls.ts`).
	/**
	 * The newest line once it has finished — its id and text — or null while
	 * it streams. A string, so what reads it re-runs when a line lands or is
	 * edited, never per streamed chunk (`lastMessage` is new on every one).
	 */
	const lastSettledMessageKey: string | null = $derived(
		lastMessage && !lastMessage.isGenerating
			? `${lastMessage.id}:${lastMessage.content}`
			: null
	)

	let lastAuthorMessage: SelectSessionMessage | undefined = $derived(
		lastAuthorLine(session?.sessionMessages)
	)

	// Check if any message is currently generating
	let hasGeneratingMessage: boolean = $derived.by(() => {
		return (
			sessionView?.sessionMessages?.some((msg) => msg.isGenerating) ||
			false
		)
	})

	/** What the header calls this session's genre; null while the list loads. */
	let genreName: string | null = $derived(genreRow?.name ?? null)

	/** 🚧 Back · Forward · Regenerate (RF fix 5, pr-6 D8): the strip's state, computed ONCE — the dossier and the header read this. */
	const rewind: RewindState | null = $derived(rewindOf(record, rows))

	// Whether the viewer is a guest (not the session owner). Read through
	// the owner id alone: `session` is reassigned on every streamed chunk,
	// and a primitive derived stops that churn here.
	const sessionOwnerId: number | null = $derived(session?.userId ?? null)
	let isGuest: boolean = $derived(
		sessionOwnerId != null && userCtx.user?.id != null
			? sessionOwnerId !== userCtx.user.id
			: false
	)

	/**
	 * 🚧 The viewer's own named card-less player seat, when they have one
	 * (`ownCardlessPlayerSeats`, first by position): a line they send with
	 * no persona is sent from it — the server stamps `player-seat:<id>`.
	 */
	let ownCardlessSeat = $derived(
		ownCardlessPlayerSeats(session?.sessionPersonas, userCtx.user?.id)[0] ??
			null
	)

	// Whether to show the add persona CTA: a guest with no voice here — no
	// card and no named card-less seat (`asksToJoin`, the one rule). A mode
	// with no persona system has nothing to add.
	let showAddPersonaCTA: boolean = $derived(
		asksToJoin({
			isGuest,
			personasInMode,
			seats: session?.sessionPersonas,
			userId: userCtx.user?.id,
			playerLabel: sessionFrames?.genrePlayerLabel,
			isPlayer: (session?.sessionGuests as Array<{ userId?: number; isPlayer?: boolean }> | undefined)?.find(
				(g) => g.userId === userCtx.user?.id
			)?.isPlayer
		})
	)

	/**
	 * 🚧 Whether the story's composer offers this guest a seat — name the
	 * character they will play, or bring a persona (`offersSeat`, Lair
	 * rewrite D5): a guest who plays, in a genre of player seats, with no
	 * voice here yet. The other half of `asksToJoin`'s rule.
	 */
	let showTakeSeatCTA: boolean = $derived(
		offersSeat({
			isGuest,
			personasInMode,
			seats: session?.sessionPersonas,
			userId: userCtx.user?.id,
			playerLabel: sessionFrames?.genrePlayerLabel,
			isPlayer: (session?.sessionGuests as Array<{ userId?: number; isPlayer?: boolean }> | undefined)?.find(
				(g) => g.userId === userCtx.user?.id
			)?.isPlayer
		})
	)

	// All of the current user's personas in this session. 🚧 A seat that
	// retired (a new character after a death, PLAN-dc-after-walk2 Q0-2,
	// owner ruling ★2) keeps its card, but nobody writes as it any more:
	// the person's composer moves to their new seat.
	let userPersonasInSession = $derived.by(() => {
		if (!session?.sessionPersonas || !userCtx.user?.id) return []
		return session.sessionPersonas.filter(
			(cp) => cp.persona?.userId === userCtx.user?.id && !cp.removedAt
		)
	})

	// Manually selected persona ID — null means auto-select (first in list)
	let selectedPersonaId = $state<number | null>(null)

	// Reset selection when navigating to a different session — keyed on the
	// id, not `session`, which a streamed chunk replaces: reading through it
	// would reset the person's pick on every token of a reply.
	$effect(() => {
		const _watchSessionId = loadedSessionId
		selectedPersonaId = null
	})

	// Get the current user's active persona in this session
	let currentUserPersona = $derived.by(() => {
		if (!userPersonasInSession.length) return undefined
		if (selectedPersonaId) {
			const found = userPersonasInSession.find(
				(cp) => cp.personaId === selectedPersonaId
			)
			if (found) return found
		}
		return userPersonasInSession[0]
	})

	function switchPersona(personaId: number) {
		selectedPersonaId = personaId
	}

	/** No session yet, or a persona genre with nobody seated as one: a turn needs a persona first. */
	const needsPersona = $derived.by(
		() =>
			!session ||
			(personasInMode &&
				!(session.sessionPersonas ?? []).some((s) => isLivePlayerSeat(s)))
	)

	/**
	 * What a person's own lines are called (lair re-plan R4): the session's
	 * override on its row, else the genre's `playerLabel` off the view —
	 * resolved at render, never stamped, so a rename relabels history.
	 */
	let sessionPlayerLabel = $derived(
		resolvePlayerLabel({
			declared: sessionFrames?.genrePlayerLabel,
			stored: storedPlayerLabel(session?.metadata)
		})
	)

	/**
	 * May the viewer edit or control this line — `canActOnMessage`'s rule
	 * (`server/messages/permissions.ts`), branch for branch; an affordance
	 * only, the server refuses regardless (`canControlMessageAs`).
	 */
	const canControlMessage = (msg: SelectSessionMessage): boolean =>
		canControlMessageAs(userCtx, isGuest, session, msg)
	/** The page's rerun refusals, registered on the inbox (`rerunRefusals.svelte.ts`). */
	const rerunRefusals = createRerunRefusals(d.inbox)
	/**
	 * May the viewer rerun (swipe, retry, extend) this line — the same rule,
	 * widened for an envoy's line in a channel lane the viewer is the member
	 * of (ruled 2026-10-15; `canActOnMessage(…, "rerun")`).
	 */
	const canRerunMessage = (msg: SelectSessionMessage): boolean =>
		// 🚧 A rerun the server refused (a question, not a reply) stays
		// refused; a greeting that asks is a question no run made
		// (`questionRowRefusal`) — 2026-10-16.
		!rerunRefusals.isRefused(msg.id) &&
		!(msg.metadata?.isGreeting && rowAsks(msg)) &&
		canControlMessageAs(userCtx, isGuest, session, msg, "rerun", annexView)

	/** A person speaking as themselves — named by `personLineOf`. */
	const personLine = (msg: SelectSessionMessage) =>
		personLineOf(userCtx, session, sessionPlayerLabel, msg)

	/** Who spoke a line (`messageCharacterOf`): the envoys ride the view payload (U5g). */
	const getMessageCharacter = (
		msg: SelectSessionMessage
	): SelectCharacter | undefined =>
		messageCharacterOf(session, sessionFrames, msg, personLine)

	/** A face for a turn ref, from the loaded cast (`character:<id>`). */
	const characterForRef = (
		ref: string | null | undefined
	): SelectCharacter | undefined => characterForRefIn(session, ref)

	/** The session's genre id, when it has one. */
	function sessionGenreId(): string | undefined {
		const g = (session as any)?.genreId
		return typeof g === "string" ? g : undefined
	}

	/** Resolves once an older page has landed (or nothing more is coming). */
	async function olderPage(): Promise<{
		rows: MessageV1[]
		nextCursor?: string
	}> {
		if (!session || !pagination?.hasMore) return { rows: [] }
		const before = new Set(session.sessionMessages.map((m) => m.id))
		await loadOlderMessages()
		for (
			let waited = 0;
			loadingOlderMessages && waited < 15_000;
			waited += 100
		)
			await new Promise((r) => setTimeout(r, 100))
		const rows = (session?.sessionMessages ?? []).filter(
			(m) => !before.has(m.id)
		)
		const oldest = session?.sessionMessages.length
			? Math.min(...session.sessionMessages.map((m) => m.id))
			: undefined
		return {
			rows: rows as unknown as MessageV1[],
			nextCursor:
				pagination?.hasMore && oldest != null
					? String(oldest)
					: undefined
		}
	}

	/**
	 * One page of this session's lines for ONE widget (`messages` request, D7
	 * ruling A): asked of the server (`sessions:messagesPage`), matched to its
	 * reply by `requestId`, and never merged into the page's own window.
	 */
	function messagesPage(ask: { beforeId?: number; limit?: number; channel?: string }): Promise<{
		rows: readonly Record<string, unknown>[]
		nextCursor?: string
		error?: string
	}> {
		const id = sessionId
		if (!Number.isFinite(id)) return Promise.resolve({ rows: [], error: "the session is not loaded" })
		const requestId = `mp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
		return new Promise((resolve) => {
			let release = () => {}
			const timer = setTimeout(() => {
				release()
				resolve({ rows: [], error: "the page did not arrive in time" })
			}, 15_000)
			release = requestWithInterest(
				"sessions:messagesPage",
				{ sessionId: id, requestId, ...ask },
				(res) => {
					if (res.sessionId !== id || res.requestId !== requestId) return
					clearTimeout(timer)
					release()
					resolve({ rows: res.rows as unknown as Record<string, unknown>[], nextCursor: res.nextCursor, error: res.error })
				}
			)
		})
	}

	/** The channel lanes under one channel, for one widget (`channel-lanes`), matched to its reply by `requestId`. */
	function channelLanes(ask: { channel: string }): Promise<{ lanes: ChannelLaneV1[]; error?: string }> {
		const id = sessionId
		if (!Number.isFinite(id)) return Promise.resolve({ lanes: [], error: "the session is not loaded" })
		const requestId = `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
		return new Promise((resolve) => {
			let release = () => {}
			const timer = setTimeout(() => {
				release()
				resolve({ lanes: [], error: "the lanes did not arrive in time" })
			}, 15_000)
			release = requestWithInterest("sessions:channelLanes", { sessionId: id, requestId, channel: ask.channel }, (res) => {
				if (res.sessionId !== id || res.requestId !== requestId) return
				clearTimeout(timer)
				release()
				resolve({ lanes: res.lanes, error: res.error })
			})
		})
	}

	/**
	 * 🚧 **Read to here** on one channel lane (2026-10-17): moves the viewer's
	 * last-read mark on the server and adopts the channels view it answers
	 * (`SessionV1.channels` — `unseen`, `waitingOnYou`), so a panel tab's dot
	 * clears. `messageId` absent: the lane's newest line.
	 */
	function laneRead(channel: string, messageId?: number): Promise<{ error?: string }> {
		const id = sessionId
		if (!Number.isFinite(id)) return Promise.resolve({ error: "the session is not loaded" })
		return new Promise((resolve) => {
			let release = () => {}
			const timer = setTimeout(() => {
				release()
				resolve({ error: "the answer did not arrive in time" })
			}, 15_000)
			release = requestWithInterest(
				"sessions:laneRead",
				{ sessionId: id, channel, ...(messageId !== undefined ? { messageId } : {}) },
				(res) => {
					if (res.sessionId !== id) return
					clearTimeout(timer)
					release()
					if (res.channels && session && session.id === id)
						sessionStore.patchSession(id, { channels: res.channels })
					resolve({ error: res.error })
				}
			)
		})
	}

	/**
	 * 🚧 The next older page of the log **per channel** (PLAN-dc-after-walk2
	 * Q1-1, owner ruling ★7): 25 more lines of each of `channels` that still
	 * holds older ones (`pagination.olderIn`) — absent, of every such channel
	 * — each asked on its own (`sessions:messagesPage`, before that channel's
	 * oldest line in the log) and merged in. A channel whose page says nothing
	 * older remains leaves `olderIn`. What the conversation's `load-older`
	 * asks.
	 */
	/** 🚧 A copy's listed channel holds a stored row's: a bare slug every lane of it, a lane only itself. */
	const listedHolds = (listed: string, stored: string): boolean => {
		const l = parseChannel(listed)
		const r = parseChannel(stored)
		return l.slug === r.slug && (!l.explicit || l.lane === r.lane)
	}
	/** 🚧 A stored channel as an EXACT ask — `parley` is lane 1, never every lane of it. */
	const exactChannel = (stored: string): string => {
		const r = parseChannel(stored)
		return `${r.slug}:${r.lane}`
	}

	async function loadOlderIn(channels?: readonly string[]) {
		if (loadingOlderMessages || !session) return
		const olderIn = pagination?.olderIn
		if (!Array.isArray(olderIn)) return loadOlderMessages()
		const asked = channels?.length
			? olderIn.filter((c) => channels.some((listed) => listedHolds(listed, c)))
			: olderIn
		if (!asked.length) return
		loadingOlderMessages = true
		const still = new Set(olderIn)
		try {
			for (const channel of asked) {
				const mine = sessionStore.messagesOf(sessionId).filter((m) => (m.channel ?? "main") === channel)
				const oldest = mine.length ? Math.min(...mine.map((m) => m.id)) : undefined
				const page = await messagesPage({ channel: exactChannel(channel), limit: 25, ...(oldest != null ? { beforeId: oldest } : {}) })
				if (page.error || !session) break
				sessionStore.prependMessages(sessionId, page.rows as unknown as SelectSessionMessage[])
				if (!page.nextCursor) still.delete(channel)
			}
		} finally {
			loadingOlderMessages = false
			if (pagination)
				sessionStore.setPagination(sessionId, { ...pagination, olderIn: [...still], hasMore: still.size > 0 })
		}
	}

	async function loadOlderMessages() {
		if (
			loadingOlderMessages ||
			!pagination?.hasMore ||
			!session ||
			session.sessionMessages.length === 0
		)
			return

		loadingOlderMessages = true

		const beforeId = Math.min(...session.sessionMessages.map((m) => m.id))
		socket.emit("sessions:get", { id: sessionId, limit: 25, beforeId })

		// loadingOlderMessages will be set to false in the socket response handler
	}

	/**
	 * Landing on the message a link named (`?message=<id>[&block=<blockId>]`,
	 * `sessionHref` — a notification's link): older pages load until the
	 * message is in the window, then its row (or the named form in it) is
	 * centred, ringed once and focused, and the params leave the address so a
	 * reload or Back does not land again. The log's own pin to its end
	 * (`sp-scroll`) hears the landing and lets go (`landOn`); scrolling back
	 * to the end pins it again. A message that is not there (deleted, never
	 * drawn) leaves the log at its end.
	 */
	const messageLanding = $derived(readMessageLanding(page.url.searchParams))
	const messageLandingStep = $derived.by(() => {
		if (!messageLanding || !session || session.id !== sessionId) return null
		return nextLandingStep(
			messageLanding,
			session.sessionMessages.map((m) => m.id),
			{
				hasOlder: !!pagination?.hasMore,
				loadingOlder: loadingOlderMessages
			}
		)
	})
	function dropMessageLanding() {
		try {
			replaceState(withoutLanding(page.url), page.state)
		} catch {
			// Router not started (cannot happen after a load reply) — the
			// params stay, and the next load lands again; nothing breaks.
		}
	}
	$effect(() => {
		const landing = messageLanding
		const step = messageLandingStep
		if (!landing || !step || step === "wait") return
		if (step === "load-older")
			return void untrack(() => loadOlderMessages())
		if (step === "give-up") return void untrack(dropMessageLanding)
		// `seek`: the row is in the window; its element follows a few frames
		// on (the conversation is drawn by a worker).
		let frames = 0
		let raf = requestAnimationFrame(function seek() {
			const hit = landingTarget(document, landing)
			if (hit) landOn(hit.el, { focus: hit.focus })
			if (hit || ++frames >= LANDING_SEEK_FRAMES)
				untrack(dropMessageLanding)
			else raf = requestAnimationFrame(seek)
		})
		return () => cancelAnimationFrame(raf)
	})

	function handleSessionsUserTyping(
		msg: Sockets.Sessions.UserTyping.Response
	) {
		if (msg.sessionId !== sessionId) return
		const myPersonaId =
			currentUserPersona?.personaId ||
			session?.sessionPersonas?.[0]?.personaId
		if (msg.personaId === myPersonaId) return
		typingPersonas.set(msg.personaId, {
			name: msg.personaName,
			lastTypingAt: Date.now()
		})
		typingPersonas = new Map(typingPersonas)
	}

	function handleSessionsAttendance(
		msg: Sockets.Sessions.Attendance.Response
	) {
		if (msg.sessionId !== sessionId) return
		attendance = msg
	}

	function handleSessionsGet(msg: Sockets.Sessions.Get.Response) {
		if (msg.session === null && !loadingOlderMessages) {
			sessionNotFound = true
			return
		}
		if (msg.session?.id === sessionId) {
			if (record && loadingOlderMessages && msg.beforeId != null) {
				// Load-more: prepend older messages (the store skips rows it holds)
				sessionStore.prependMessages(sessionId, msg.session.sessionMessages)
				sessionStore.setPagination(sessionId, msg.pagination)

				// The log's `sp-scroll` holds the reader's place as the rows land.
				loadingOlderMessages = false
			} else {
				// Initial load or session switch — restore draft only on first load
				const isFirstLoad = !sessionStore.session(sessionId)
				sessionStore.load(msg.session, msg.pagination)
				if (isFirstLoad && msg.userDraft) writeDraft(msg.userDraft)
				loadingOlderMessages = false
				// Autopopulate panels for any channel already present in the
				// loaded history (21 §9) — a session reopened with `tasks`
				// messages shows its Tasks panel without waiting for a new one.
				for (const m of msg.session.sessionMessages)
					surfaceManager.activateForChannel((m as any).channel)
			}
			// Auto-scroll is handled by the $effect
		}
	}

	/**
	 * 🚧 pr-6 (ledger A1): the member push, folded in by row id (`mergeRefreshedRows`) — never a
	 * replace. Pagination, an in-flight load-older and the draft are the `sessions:get` reply's alone.
	 */
	function handleSessionsRefresh(msg: Sockets.Sessions.Refresh.Response) {
		if (msg.session === null) {
			if (msg.sessionId === sessionId) sessionNotFound = true
			return
		}
		if (!msg.session || msg.session.id !== sessionId) return
		if (!session) return
		const coversFromId =
			(msg as { coversFromId?: number | null }).coversFromId ?? null
		const added = sessionStore.merge(msg.session, coversFromId)
		for (const m of added) surfaceManager.activateForChannel((m as any).channel)
	}

	function handleSessionMessage(msg: Sockets.SessionMessage.Response) {
		if (!session || !msg.sessionMessage || msg.sessionMessage.sessionId !== sessionId) return
		const sessionMessage = msg.sessionMessage
		// 🚧 A new row replaced the forward stack (RF fix 5): the server deleted
		// the turns ahead before it wrote this one. Read BEFORE the upsert.
		const served = rewindStateOf(record)
		const done = sessionStore.upsertMessage(sessionMessage)
		if (!done) return
		if (!done.added) {
			// Announced AFTER the state is written, so a widget woken by
			// the event reads the row the event describes. `previous` is the
			// row it REPLACED: the only thing that says whether this push is a
			// streamed chunk, an edit or a run ending (`witnessMessage`).
			surfaceManager.witnessMessage(sessionMessage, done.previous)
		} else {
			if (served && served.ahead > 0)
				sessionStore.patchSession(sessionId, { rewind: withStackReplaced(served) })
			// Channel-driven autopopulation (21 §9): a message on a
			// non-main channel flows in the panel that views that channel.
			surfaceManager.activateForChannel((sessionMessage as any).channel)
			// No previous row: the arrival itself is `message:created`,
			// which every widget's own feed announces. What this adds is
			// `generation:start` for a reply that arrives already filling.
			surfaceManager.witnessMessage(sessionMessage)
		}
		// Auto-scroll is handled by the $effect
	}

	function handleCharactersUpdate(msg: Sockets.Characters.Update.Response) {
		const charId = msg.character?.id
		if (!charId || !session) return
		// The card is one record: every seat wearing it (cast member, persona,
		// or both) sees the new one.
		sessionStore.mergeCard(msg.character as NonNullable<typeof msg.character>)
	}

	/**
	 * A media row whose bytes changed while keeping its id — a re-cut
	 * thumbnail, or a display pointer moved by a cull.
	 *
	 * Nothing was written to the character or persona wearing that file, so no
	 * `characters:update` fires and every avatar on screen keeps the `<img src>`
	 * it already has. Re-addressing the link's entity is what makes the URL
	 * differ, which is the only thing a browser's image cache answers to.
	 */
	function handleMediaChanged(msg: Sockets.Media.Changed.Response) {
		if (!session) return
		sessionStore.reviseAvatars(msg)
	}

	function handleSessionMessagesDelete(
		msg: Sockets.SessionMessages.Delete.Response
	) {
		const action = deleteReplyAction(msg)
		// 🚧 On revision `branch`: nothing was deleted here — the page moves
		// to the branch, and this session keeps its tail.
		if (action.kind === "branch") {
			void goto(sessionAddress(action.sessionId))
			return
		}
		if (action.kind === "refused") return
		if (session) {
			// The row itself, while the page still holds it: the announcement
			// below names the channel it was on so a widget that declared
			// another is not told about it (`witnessMessageDeleted`).
			const deleted = sessionStore.removeMessage(sessionId, msg.id)
			surfaceManager.witnessMessageDeleted(deleted ?? { id: msg.id })
		}
	}

	function handleSpriteSetChanged(
		msg: Sockets.Sessions.SetSpriteSet.Response
	) {
		if (msg.sessionId !== sessionId || !session || msg.error) return
		const next = { ...((record as any)?.spriteSetOverrides ?? {}) }
		if (msg.set) next[msg.characterId] = msg.set
		else delete next[msg.characterId]
		sessionStore.patchSession(sessionId, { spriteSetOverrides: next })
	}

	/**
	 * 🚧 The session's backdrop moved (a pipeline's `set-backdrop`, or a
	 * person's Change or Clear): fold it into the page's session, which
	 * every widget's `session` section is narrowed from.
	 */
	function handleBackdropChanged(
		msg: Sockets.Sessions.BackdropChanged.Response
	) {
		if (msg.sessionId !== sessionId || !session) return
		sessionStore.patchSession(sessionId, { backdropMediaId: msg.backdropMediaId ?? null })
	}

	function handleSessionsGetNarratorName(
		msg: Sockets.Sessions.GetNarratorName.Response
	) {
		if (msg.sessionId !== sessionId) return
		narratorName = msg.narratorName
	}

	function handleSessionsGenreOf(msg: Sockets.Sessions.GenreOf.Response) {
		if (msg.sessionId !== sessionId) return
		sessionStore.mergeGenreOf(msg)
	}

	/**
	 * A long run reporting itself.
	 *
	 * Both events land in the store: `runStarted` is the same shape as a
	 * progress tick, and recording it as one means the card appears the
	 * instant the run does rather than after the backend's first report —
	 * which for an image render can be several seconds of a button that looks
	 * like it did nothing. A start goes through `started`, so what last ended
	 * in the session yields to the new run whether or not a progress card is
	 * mounted to say so.
	 */
	function handleRunProgress(msg: RunProgress) {
		if (msg.sessionId != null && msg.sessionId !== sessionId) return
		runProgress.apply(msg)
	}
	function handleRunStarted(msg: RunProgress) {
		if (msg.sessionId != null && msg.sessionId !== sessionId) return
		runProgress.started(msg)
	}

	/** The session view (20 §12) for this session: its frames, envoys, channels and verbs. */
	function handleSessionsView(res: Sockets.Sessions.View.Response) {
		if (res.sessionId !== sessionId) return
		sessionFrames = res
	}

	/** The session's book, as Summarize just set it. */
	/**
	 * The session's own story clock as the server last said it (Chronicle,
	 * W3): its row's five clock columns, written only when they moved, so a
	 * read that changed nothing re-derives nothing. What the page's
	 * Summarize dates by.
	 */
	function setStoryClock(own: StoryClockParts | null) {
		if (!session) return
		const next = {
			storyClockYear: own?.year ?? null,
			storyClockMonth: own?.month ?? null,
			storyClockDay: own?.month != null ? (own?.day ?? null) : null,
			storyClockHour: own?.hour ?? null,
			storyClockMinute: own?.hour != null ? (own?.minute ?? 0) : null
		}
		const row = record as unknown as Record<string, unknown>
		if (
			(Object.keys(next) as (keyof typeof next)[]).every(
				(k) => (row[k] ?? null) === next[k]
			)
		)
			return
		sessionStore.patchSession(sessionId, next)
	}

	/** 🚧 The session's book's calendar, as a story clock reading carried it (§15 G9). */
	function setStoryCalendar(forSessionId: number, calendar: unknown) {
		const next = readStoryCalendar(calendar ?? null)
		if (
			storyCalendar?.sessionId === forSessionId &&
			JSON.stringify(storyCalendar.calendar) === JSON.stringify(next)
		)
			return
		storyCalendar = { sessionId: forSessionId, calendar: next }
	}

	function setLorebook(newLorebookId: number) {
		if (session) sessionStore.patchSession(sessionId, { lorebookId: newLorebookId })
	}

	d.inbox.on("sessions:get", handleSessionsGet)
	d.inbox.on("sessions:refresh", handleSessionsRefresh)
	d.inbox.on("sessionMessage", handleSessionMessage)
	d.inbox.on("sessions:userTyping", handleSessionsUserTyping)
	d.inbox.on("sessions:attendance", handleSessionsAttendance)
	d.inbox.on("characters:update", handleCharactersUpdate)
	d.inbox.on("media:changed", handleMediaChanged)
	d.inbox.on("sessionMessages:delete", handleSessionMessagesDelete)
	// A session's sprite-set switch (DESIGN-sprites §2.3): pushed to every
	// member, so faces redraw in the new set before the character's next line
	// records it.
	d.inbox.on("sessions:spriteSetChanged", handleSpriteSetChanged)
	d.inbox.on("sessions:backdropChanged", handleBackdropChanged)
	d.inbox.on("sessions:annex", handleAnnex)
	d.inbox.on("sessions:view", handleSessionsView)
	d.inbox.on("sessions:genreOf", handleSessionsGenreOf)
	d.inbox.on("sessions:presetStatus", handlePresetStatus)
	d.inbox.on("sessions:getNarratorName", handleSessionsGetNarratorName)
	// The run-progress pushes, SCOPED to this session: every emitter puts
	// `sessionId` on the payload, so a tab on another session is not sent this
	// one's ticks — and an image run emits one preview frame per tick. The
	// handlers' own id check stays as belt and braces.
	d.inbox.on("pipelines:runStarted", handleRunStarted)
	// Each run's status, to every user of the session (every frame carries its
	// `kind`; a reply's says its channel): the session store keeps it — the
	// waiting rows and `generating` read it there.
	d.inbox.on("sessions:runStatus", (msg) => sessionStore.mergeRunStatus(msg))
	d.inbox.on("pipelines:progress", handleRunProgress)
	// Runs belonging to a session nobody is looking at any more. The server
	// keeps running them; the card is what goes away.
	onDestroy(() => {
		runProgress.clearAll()
		// Closed only while it is still this page's: a session page that
		// replaces this one may already have opened its own.
		if (sessionStore.openSessionId === openedId) sessionStore.open(null)
	})

	return {
		/**
		 * The loaded session; undefined while it loads or after a switch.
		 * With the waiting rows after its own (`sessionView`).
		 */
		get session() {
			return sessionView
		},
		get pagination() {
			return pagination
		},
		get sessionNotFound() {
			return sessionNotFound
		},
		get loadingOlderMessages() {
			return loadingOlderMessages
		},
		/** Other participants' personas typing now, by persona id (client-expired after 10s). */
		get typingPersonas() {
			return typingPersonas
		},
		/** The server's last word on who of the session's people has it open (W10). */
		get attendance() {
			return attendance
		},
		get narratorName() {
			return narratorName
		},
		get sessionFrames() {
			return sessionFrames
		},
		get sessionViewFrame() {
			return sessionViewFrame
		},
		get ownVoice() {
			return ownVoice
		},
		get extendRefusal() {
			return extendRefusal
		},
		get messageVerbs() {
			return messageVerbs
		},
		offersWrite,
		get sessionChannels() {
			return sessionChannels
		},
		get composerChannel() {
			return composerChannel
		},
		set composerChannel(channel: string) {
			composerChannel = channel
		},
		get composerHidden() {
			return composerHidden
		},
		get modeMissing() {
			return modeMissing
		},
		get personasInMode() {
			return personasInMode
		},
		get personaRequiredOnSend() {
			return personaRequiredOnSend
		},
		get charactersInMode() {
			return charactersInMode
		},
		get presetStatus() {
			return presetStatus
		},
		get presetStale() {
			return presetStale
		},
		get presetBannerDismissed() {
			return presetBannerDismissed
		},
		set presetBannerDismissed(dismissed: boolean) {
			presetBannerDismissed = dismissed
		},
		get annex() {
			return annexView
		},
		get lastMessage() {
			return lastMessage
		},
		get generating() {
			return generating
		},
		get lastSettledMessageKey() {
			return lastSettledMessageKey
		},
		get lastAuthorMessage() {
			return lastAuthorMessage
		},
		get hasGeneratingMessage() {
			return hasGeneratingMessage
		},
		get genreName() {
			return genreName
		},
		get rewind() {
			return rewind
		},
		get isGuest() {
			return isGuest
		},
		get ownCardlessSeat() {
			return ownCardlessSeat
		},
		get showAddPersonaCTA() {
			return showAddPersonaCTA
		},
		get showTakeSeatCTA() {
			return showTakeSeatCTA
		},
		get userPersonasInSession() {
			return userPersonasInSession
		},
		get currentUserPersona() {
			return currentUserPersona
		},
		switchPersona,
		get needsPersona() {
			return needsPersona
		},
		get sessionPlayerLabel() {
			return sessionPlayerLabel
		},
		canControlMessage,
		canRerunMessage,
		rerunRefusals,
		personLine,
		getMessageCharacter,
		characterForRef,
		sessionGenreId,
		olderPage,
		loadOlderIn,
		messagesPage,
		channelLanes,
		laneRead,
		loadOlderMessages,
		setLorebook,
		setStoryClock,
		setStoryCalendar,
		/** 🚧 The session's book's calendar (§15 G9); null when free-form or not read yet. */
		get storyCalendar(): StoryCalendar | null {
			return storyCalendar?.sessionId === sessionId ? storyCalendar.calendar : null
		},
		/** A scene read was refused: the session is not this viewer's to see. */
		markNotFound() {
			sessionNotFound = true
		},
		/** Another session opened in the page: what the last one loaded goes. */
		reset() {
			// The store drops every record of the last session (the genre row, the
			// rows, the cast, the runs) and opens this one.
			sessionStore.open(sessionId)
			openedId = sessionId
			sessionNotFound = false
			loadingOlderMessages = false
			presetStatus = undefined
			presetBannerDismissed = false
		}
	}
}

/** The session page's data store (`createSessionPageData`). */
export type SessionPageData = ReturnType<typeof createSessionPageData>
