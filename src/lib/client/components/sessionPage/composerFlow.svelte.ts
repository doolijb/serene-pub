/**
 * The session page's half of core's composer: the send, the draft's autosave,
 * the viewer's attachment tray and what the reply can read, and the prompt
 * the draft would compile to — its token count, and the Prompt Details report
 * (the draft's, or a finished reply's).
 */
import { onDestroy, onMount, untrack } from "svelte"
import { toaster } from "$lib/client/utils/toaster"
import { declareInterest, onConnect } from "$lib/client/sockets/interest.svelte"
import { createComposerTray } from "$lib/client/components/sessionPage/attachments/composerTray.svelte"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import type { SessionPageInbox } from "$lib/client/components/sessionPage/sessionPageInbox.svelte"
import type { SessionPageData } from "$lib/client/components/sessionPage/sessionPageData.svelte"
import type { TurnFlow } from "$lib/client/components/sessionPage/turnFlow.svelte"
import { createPendingSend } from "$lib/client/components/sessionPage/pendingSend"

export interface ComposerFlowDeps {
	socket: TypedSocket
	inbox: SessionPageInbox
	/** The session in the route. */
	sessionId(): number
	/** The loaded session's id and genre (the page's primitives). */
	loadedSessionId(): number | null
	loadedGenreId(): string | null
	data: SessionPageData
	/** The send raises the in-flight flag the next-speaker block waits on. */
	turns: TurnFlow
	systemSettingsCtx: SystemSettingsCtx
	/** The composer's draft, as the page holds it. */
	draft(): string
	/** Sets the page's draft without a composer write: the composer cleared it itself on Send. */
	setNewMessage(content: string): void
	/**
	 * 🚧 Writes the composer's draft (the page's `writeDraft`): a refused send's
	 * text going back in the box.
	 */
	restoreDraft(content: string): void
	/** The viewer's user id — whose pushed row is their own send landing. */
	userId(): number | null
}

/** The page's composer half. Registers its listeners on the inbox at once. */
export function createComposerFlow(d: ComposerFlowDeps) {
	const socket = d.socket
	const systemSettingsCtx = d.systemSettingsCtx
	const sessionId = $derived(d.sessionId())
	const loadedSessionId = $derived(d.loadedSessionId())
	const loadedGenreId = $derived(d.loadedGenreId())
	const newMessage = $derived(d.draft())
	const session = $derived(d.data.session)
	const lastSettledMessageKey = $derived(d.data.lastSettledMessageKey)
	const currentUserPersona = $derived(d.data.currentUserPersona)
	const ownCardlessSeat = $derived(d.data.ownCardlessSeat)
	const isGuest = $derived(d.data.isGuest)
	const personaRequiredOnSend = $derived(d.data.personaRequiredOnSend)
	const composerChannel = $derived(d.data.composerChannel)
	const markFireInFlight = () => d.turns.markFireInFlight()

	let draftCompiledPrompt:
		| Sockets.Sessions.PromptTokenCount.Response
		| undefined = $state()
	let promptTokenCountTimeout: ReturnType<typeof setTimeout> | null = null
	let contextExceeded = $derived(
		draftCompiledPrompt?.meta
			? draftCompiledPrompt.meta.tokenCounts.total >
					draftCompiledPrompt.meta.tokenCounts.limit
			: false
	)
	/**
	 * The message whose report is open, and the report itself.
	 *
	 * Separate from `draftCompiledPrompt` because that is *live*: the composer
	 * recompiles it on a debounce while somebody types, and the footer's own
	 * token readout reads it. Opening a message's report must never overwrite
	 * it: that would show a finished reply's numbers as the draft's until the
	 * next keystroke recompiled — a report about one thing shown as the state
	 * of another.
	 */
	let messageReport:
		| {
				messageId: number
				meta: any
				prompt?: string
				messages?: any[]
		  }
		| undefined = $state()
	/** Whichever of the two the modal is currently reporting on. */
	let promptDetails = $derived(
		messageReport
			? {
					prompt: messageReport.prompt,
					messages: messageReport.messages,
					meta: messageReport.meta
				}
			: draftCompiledPrompt
	)
	/** The modal's own budget verdict — `contextExceeded` is the composer's. */
	let detailsExceeded = $derived(
		promptDetails?.meta
			? promptDetails.meta.tokenCounts.total >
					promptDetails.meta.tokenCounts.limit
			: false
	)
	let showDraftCompiledPromptModal = $state(false)

	/**
	 * The persona picker is open because a Send was refused for want of
	 * someone to speak as (less-confusing E10), so the page can say why it
	 * opened. It lasts while the picker is open, however it closes.
	 */
	let personaAskedBySend = $state(false)
	$effect(() => {
		if (!d.turns.showAddPersonaModal) personaAskedBySend = false
	})

	/**
	 * 🚧 The sent text, held until it is saved (owner ruling 2026-10-15): a
	 * person's message is saved through the session's pipeline, which may
	 * refuse it — then the text comes back. See `pendingSend.ts`.
	 */
	const pendingSend = createPendingSend({
		restore: (content) => d.restoreDraft(content),
		draft: () => untrack(() => newMessage),
		landed: (id) => {
			// The kept draft goes only once the message is saved — unless the
			// person has started the next one meanwhile.
			if (!untrack(() => newMessage).trim())
				socket.emit("sessions:saveDraft", { sessionId: id, content: "" })
		},
		say: (sentence) => toaster.error({ title: "Not sent", description: sentence })
	})

	// ── Draft autosave ────────────────────────────────────────────────────────
	// Debounce-save newMessage to the server as the user types.
	// Only runs when the session is loaded (session !== undefined) to avoid
	// clobbering another user's draft during a session transition.
	$effect(() => {
		const content = newMessage
		const currentSessionId = sessionId
		if (!currentSessionId || loadedSessionId === null) return
		// The box emptied by a Send is not the person clearing their draft:
		// the server keeps it until the message is saved (`pendingSend`).
		if (!content.trim() && pendingSend.inFlight) return
		const timer = setTimeout(() => {
			socket.emit("sessions:saveDraft", {
				sessionId: currentSessionId,
				content
			})
		}, 500)
		return () => clearTimeout(timer)
	})

	/**
	 * The viewer's composer tray and what this session's reply can read
	 * (PLAN-composer-attachments §3.3): kept here, posted to core's composer
	 * in the dossier (`composer.tray`, `composer.attachments`), changed only
	 * through its requests. Guests attach too (D8).
	 */
	const composerTray = createComposerTray(
		{
			emit: (event, data) => socket.emit(event as any, data as any),
			on: (event, handler) => declareInterest(event as any, handler)
		},
		{ sessionId: () => (Number.isFinite(sessionId) ? sessionId : null) }
	)
	// A socket that came back has missed the pushes: ask for the tray again.
	const releaseTrayOnConnect = onConnect(() => composerTray.load())
	onDestroy(() => {
		releaseTrayOnConnect()
		composerTray.destroy()
	})
	$effect(() => {
		if (!Number.isFinite(sessionId)) return
		untrack(() => composerTray.load())
	})
	// What the reply can read moves with the session's genre and the models
	// its calls fall back to (§3.2 "recompute"): ask again when either moves,
	// and when the tab comes back — a model's Vision may have been switched
	// on in Connections meanwhile. The first reading is `load()`'s.
	let readersKey: string | null = null
	$effect(() => {
		const key = JSON.stringify([
			loadedGenreId,
			systemSettingsCtx.capabilityDefaults ?? null
		])
		if (readersKey !== null && key !== readersKey)
			untrack(() => composerTray.refreshReaders())
		readersKey = key
	})
	onMount(() => {
		const onVisible = () => {
			if (document.visibilityState === "visible")
				composerTray.refreshReaders()
		}
		document.addEventListener("visibilitychange", onVisible)
		return () => document.removeEventListener("visibilitychange", onVisible)
	})

	$effect(() => {
		// REPOINTED, not deleted: these two reads exist only to make the effect
		// depend on the instance defaults, so the token count is recomputed when
		// an admin changes which connection or sampling config a reply will use.
		// They now read `connection_defaults`, the only place a default lives
		// (0181) — reading the dropped columns would have made the effect depend
		// on `undefined`, which never changes, and the count would have gone
		// quietly stale on every default change.
		const _connection =
			systemSettingsCtx.capabilityDefaults?.["text->text"]?.connectionId // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		const _samplingConfig =
			systemSettingsCtx.capabilityDefaults?.["text->text"]
				?.samplingConfigId // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		const _newMessage = newMessage // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		if (!sessionId || !lastSettledMessageKey) return
		if (!systemSettingsCtx.settings?.contextDebuggingEnabled) return
		if (promptTokenCountTimeout) clearTimeout(promptTokenCountTimeout)
		promptTokenCountTimeout = setTimeout(() => {
			socket.emit("sessions:promptTokenCount", {
				sessionId,
				content: newMessage,
				personaId:
					session?.sessionPersonas?.[0]?.personaId || undefined,
				role: "user"
			})
		}, 2000)
	})

	function handleSessionsPromptTokenCount(
		msg: Sockets.Sessions.PromptTokenCount.Response
	) {
		draftCompiledPrompt = msg
	}

	/**
	 * Send the draft, with these ready tray items as its attachments; false
	 * when it was refused (nothing to send, no persona). Attachments alone
	 * are a line (composer attachments §3.1).
	 */
	function handleSend(trayItemIds: string[] = []): boolean {
		if (!newMessage.trim() && !trayItemIds.length) return false

		// The viewer's own persona; else their named card-less player seat
		// (no persona — the server stamps the seat, `player-seat:<id>`);
		// else, for the session's owner only, the first seated persona. A
		// guest never borrows another person's card.
		const personaId =
			currentUserPersona?.personaId ||
			(ownCardlessSeat || isGuest
				? undefined
				: session?.sessionPersonas?.[0]?.personaId)

		// A mode whose shape has no persona system submits bare prose (19 §1:
		// "the user is simply prose") — the server already stores a
		// persona-less user message; this guard was the only thing requiring
		// one. Under the standard mode the requirement stands, as ever.
		// Refused, the answer opens rather than a toast (less-confusing E10):
		// the picker of who you play as, saying why. The draft stays.
		if (!personaId && !ownCardlessSeat && personaRequiredOnSend) {
			personaAskedBySend = true
			d.turns.showAddPersonaModal = true
			return false
		}

		const msg: Sockets.SessionMessages.SendPersonaMessage.Params = {
			sessionId,
			personaId: personaId ?? null,
			content: newMessage,
			// Where this line goes, and — through the trigger the handler
			// makes — which channel the reply is asked for on (R-C).
			channel: composerChannel,
			...(trayItemIds.length ? { trayItemIds } : {})
		}
		return sendMessage(msg)
	}

	/**
	 * 🚧 Send one message and hold its text until it is saved. The one place
	 * a message leaves the composer, so a later composer option (another way
	 * to send) shapes `msg` and calls this. False while an earlier send is
	 * still unanswered.
	 */
	function sendMessage(msg: Sockets.SessionMessages.SendPersonaMessage.Params): boolean {
		if (!pendingSend.start(msg.sessionId, msg.content, d.userId())) return false
		socket.emit("sessionMessages:sendPersonaMessage", msg)
		// The box is empty (the composer cleared it on Send); the server's
		// copy of the draft stays until the message is saved.
		d.setNewMessage("")

		// Character response triggering (once every persona has taken their turn)
		// is handled entirely server-side, in sessionMessagesSendPersonaMessageHandler —
		// see that handler for why: deciding this client-side, from a single
		// client's local session state, doesn't hold up with multiple real
		// participants sending messages around the same time.

		// ...but we do need to know whether a generation is *coming*, purely to
		// suppress the next-character block until it lands. Whether one is
		// coming is the run's decision now (the speaker node, under the
		// session's strategy), so the flag is raised on every send and
		// cleared when the placeholder lands, or by the backstop in
		// `markFireInFlight` — rather than guessed here.
		markFireInFlight()

		return true
	}

	// The send's answer: saved, or refused with a sentence (an attachment
	// still uploading, a channel the session lacks, the genre's save pipeline
	// saying no) — then the text comes back and the sentence is said once.
	// The tray stays on a refusal.
	d.inbox.on("sessionMessages:sendPersonaMessage", (res) => pendingSend.answer(res))
	// The saved row reaching the page: the message landed.
	d.inbox.on("sessionMessage", (msg) => pendingSend.pushed(msg?.sessionMessage))
	d.inbox.on("attachments:removeFromMessage:error", (res) => {
		if (res?.sessionId == null || res.sessionId === sessionId)
			toaster.error({
				title: "Couldn't remove the attachment",
				description: res.error
			})
	})
	d.inbox.on("sessions:promptTokenCount", handleSessionsPromptTokenCount)
	onDestroy(() => {
		if (promptTokenCountTimeout) clearTimeout(promptTokenCountTimeout)
	})

	return {
		/** The draft's compiled prompt, recompiled on a debounce while somebody types. */
		get draftCompiledPrompt() {
			return draftCompiledPrompt
		},
		/** The composer's budget verdict. */
		get contextExceeded() {
			return contextExceeded
		},
		/** The message whose report is open, and the report itself. */
		get messageReport() {
			return messageReport
		},
		set messageReport(report: typeof messageReport) {
			messageReport = report
		},
		/** Whichever of the two the Prompt Details modal is reporting on. */
		get promptDetails() {
			return promptDetails
		},
		/** The modal's own budget verdict. */
		get detailsExceeded() {
			return detailsExceeded
		},
		get showDraftCompiledPromptModal() {
			return showDraftCompiledPromptModal
		},
		set showDraftCompiledPromptModal(open: boolean) {
			showDraftCompiledPromptModal = open
		},
		/** The persona picker was opened by a refused Send (E10). */
		get personaAskedBySend() {
			return personaAskedBySend
		},
		composerTray,
		handleSend,
		/** Another session opened in the page: the last one's compiled draft goes. */
		reset() {
			draftCompiledPrompt = undefined
			pendingSend.drop()
		}
	}
}

/** The session page's composer half (`createComposerFlow`). */
export type ComposerFlow = ReturnType<typeof createComposerFlow>
