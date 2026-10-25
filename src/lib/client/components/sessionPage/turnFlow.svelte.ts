/**
 * The session page's turns: the stored turn order and who is next, the turn
 * controls' presses (Continue, Pick who speaks, the narrator's turn,
 * Regenerate, Stop), the retake confirm, the narrator's modal, adding a
 * persona — and the in-flight flag that keeps the next-speaker block from
 * flashing between a send and its reply's first row.
 */
import { untrack } from "svelte"
import { goto } from "$app/navigation"
import { toaster } from "$lib/client/utils/toaster"
import { sessionAddress } from "$lib/client/components/sessionPage/deleteReply"
import {
	EMPTY_TURN_ORDER,
	readTurnOrder,
	type TurnOrderV1
} from "@serene-pub/sdk"
import { actionIdentity, NARRATE_ACTION } from "$lib/shared/actions/identity"
import {
	fireTurn,
	fireTurnRefusal,
	pushSaysNoReply
} from "$lib/client/components/sessionPage/turnControls"
import {
	createRetake,
	retakeQuietly,
	RETAKE_QUIETLY,
	type RetakeRow
} from "$lib/client/components/sessionPage/retake"
import type {
	Narrations,
	NarratorRequest
} from "$lib/client/components/sessionPage/collects"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import type { SessionPageInbox } from "$lib/client/components/sessionPage/sessionPageInbox.svelte"
import type { SessionPageData } from "$lib/client/components/sessionPage/sessionPageData.svelte"
import type { ActionList } from "$lib/client/components/sessionPage/actionList.svelte"

/** One press, as the page's one `sessions:fireAction` emit names it as a run. */
export interface FiredPress {
	/** The action's bare key — what the server resolves when no identity rides (⏳, plans/31 V2). */
	fn: string
	/**
	 * `<spec slug>#<key>`, when the press named a declaration (W1): the
	 * server checks THAT action's audience and enablement and runs THAT
	 * spec. Absent, the server resolves `fn` to its sole declarer.
	 */
	identity?: string | null
	messageId?: number
	payload?: Record<string, unknown>
	/**
	 * The form this press answers (U5d): the server reads the block off
	 * the row and holds the press to its addressee.
	 */
	blockId?: string
	/** The text the press collected (lair pass R3): the collect modal's, or S2's slash argument. */
	text?: string
	/** The cast members the press collected (R3), `character:<id>`. */
	recipients?: string[]
	/** 🚧 The clock step the press collected (live scenes §6): `{ by, unit }`, back negative. */
	clockStep?: { by: number; unit: string }
}

/** The one fire a press becomes (`emitFireAction` on the page). */
export type EmitFireAction = (p: FiredPress) => void

export interface TurnFlowDeps {
	socket: TypedSocket
	inbox: SessionPageInbox
	/** The session in the route. */
	sessionId(): number
	data: SessionPageData
	actions: ActionList
	/** The composer's draft, as the page holds it. */
	draft(): string
	/** The page's narrations (`createNarrations`): the modal's press goes there. */
	narrations: Narrations
	/** The page's one `sessions:fireAction` emit — the retake's "don't ask again" rides it. */
	emitFireAction: EmitFireAction
}

/** The turn controls and what they wait on. Registers its listeners on the inbox at once. */
export function createTurnFlow(d: TurnFlowDeps) {
	const socket = d.socket
	const narrations = d.narrations
	const emitFireAction = d.emitFireAction
	const sessionId = $derived(d.sessionId())
	const session = $derived(d.data.session)
	const newMessage = $derived(d.draft())
	const lastMessage = $derived(d.data.lastMessage)
	const hasGeneratingMessage = $derived(d.data.hasGeneratingMessage)
	const charactersInMode = $derived(d.data.charactersInMode)
	const composerChannel = $derived(d.data.composerChannel)
	const annexView = $derived(d.data.annex)
	const canRegenerateLastMessage = $derived(
		d.actions.canRegenerateLastMessage
	)
	const composerMenuActions = $derived(d.actions.composerMenuActions)
	const extraAction = (key: string) => d.actions.extraAction(key)
	const extraChip: typeof d.actions.extraChip = (t, busy) =>
		d.actions.extraChip(t, busy)
	const characterForRef = (ref: string | null | undefined) =>
		d.data.characterForRef(ref)

	let showPickSpeakerModal = $state(false)
	let pickSpeakerSearch = $state("")
	let showNarratorResponseModal = $state(false)
	/**
	 * The dropdown half of the trigger's first step (ruling 2026-09-07): this
	 * person's characters, minus the cast. Fetched when the modal opens rather
	 * than on every session load — it is a list nobody sees until they ask.
	 */
	let sideCharacterOptions: {
		id: number
		name: string
		nickname: string | null
	}[] = $state([])
	let showAddPersonaModal = $state(false)

	/**
	 * The session's stored turn order (PLAN-turn-order §4.9), as the server
	 * pushes it — on `sessions:view` and whenever it is written. Never
	 * derived here: the order is the strategy's answer, and this page only
	 * shows it.
	 */
	type TurnOrderView = {
		order: Array<{ ref: string | null; [k: string]: unknown }>
		candidates: Array<{
			ref: string
			kind: string
			name: string
			nickname?: string
			ownerUserId?: number
		}>
	}
	let turnOrder = $state<TurnOrderView | null>(null)
	/** The stored document, whole — every widget's `turnOrder.v1` (C5). */
	let turnOrderDoc = $state.raw<TurnOrderV1>(EMPTY_TURN_ORDER)
	let showTurnPicker = $state(false)

	/**
	 * True between dispatching a generation and the server's `isGenerating`
	 * placeholder arriving.
	 *
	 * Without it the next-character block flashes on every send: `handleSend`
	 * clears `newMessage` synchronously, while `isGenerating` is only set after
	 * a socket round trip that additionally queues on the session trigger lock. For
	 * that whole window every other condition below is already satisfied.
	 *
	 * This race is not 1:1-specific — group sessions on the ORDERED strategy have
	 * it too; it was simply invisible while the block was gated to groups.
	 */
	let fireInFlight: boolean = $state(false)
	let fireInFlightTimer: ReturnType<typeof setTimeout> | undefined

	function markFireInFlight() {
		fireInFlight = true
		clearTimeout(fireInFlightTimer)
		// Backstop only: a generation that never starts must not wedge the
		// block off permanently. The real clears are the two below.
		fireInFlightTimer = setTimeout(() => (fireInFlight = false), 15000)
	}

	function clearFireInFlight() {
		fireInFlight = false
		clearTimeout(fireInFlightTimer)
	}

	// Clear as soon as the placeholder lands — the normal path.
	$effect(() => {
		if (hasGeneratingMessage) clearFireInFlight()
	})

	/**
	 * 🚧 The order a reply was played from (PLAN-dc-after-walk3 R1-3, the
	 * walk's NEW-9: "Narrator is ready to continue" after every solo turn).
	 * The stored order says who is due until the recompute that follows the
	 * reply lands — seconds, on a busy table — so the head just played was
	 * offered again. Recorded when a reply starts; while the order in hand is
	 * still that one, its head is not offered: the next push says who is due.
	 */
	let playedFrom = $state<number | null>(null)
	$effect(() => {
		if (!hasGeneratingMessage) return
		const at = untrack(() => turnOrderDoc.basedOnAt)
		untrack(() => {
			if (playedFrom !== at) playedFrom = at
		})
	})
	let headPlayed = $derived(playedFrom !== null && turnOrderDoc.basedOnAt === playedFrom)

	// Determine if we should show the next character block
	let shouldShowNextCharacterBlock: boolean = $derived.by(() => {
		const hasMessageDraft = newMessage.trim().length > 0
		// The head, or — an empty order, a manual strategy waiting to be
		// told — someone to pick.
		const hasNextCharacter =
			!!turnOrder?.order.length || !!turnOrder?.candidates.length

		const shouldShow =
			!fireInFlight &&
			!hasGeneratingMessage &&
			!headPlayed &&
			!hasMessageDraft &&
			hasNextCharacter &&
			// No character system in the mode → nobody's turn to announce.
			charactersInMode &&
			!!session?.sessionMessages?.length // Only show if there are messages

		return shouldShow
	})

	// A single-character session has nobody else to hand the turn to, so the
	// "choose a different character" control is meaningless there. Keyed on cast
	// size rather than `isGroup`, because an isGroup session with one character
	// exists by the server's own definition (sessions.ts: isGroup = count > 1).
	let canChooseDifferentCharacter: boolean = $derived(
		(session?.sessionCharacters?.length || 0) > 1
	)

	// The head of the order, when it is one of the session's characters.
	let nextCharacter: SelectCharacter | undefined = $derived(
		characterForRef(turnOrder?.order[0]?.ref)
	)

	function handleAbortLastMessage(e: Event) {
		e.stopPropagation()
		if (lastMessage)
			socket.emit("sessionMessages:cancel", {
				id: lastMessage.id,
				sessionId
			})
	}
	function handleAdvance(e: Event, channel?: string) {
		e.stopPropagation()
		markFireInFlight()
		// Continue presses the first entry on this composer's channel (§4.7,
		// R5) — the one its turn controls were drawn for (S1), else the page's
		// own; on an empty order the server refuses in words, which
		// `handleFireTurnError` shows.
		fireTurn(socket, sessionId, undefined, channel ?? composerChannel)
	}
	function handlePickSpeaker(e: Event) {
		e.stopPropagation()
		showPickSpeakerModal = true
	}
	function handleRegenerateLastMessage(e: Event) {
		e.stopPropagation()
		if (lastMessage && canRegenerateLastMessage) {
			d.data.rerunRefusals.asked("sessionMessages:regenerate", lastMessage.id)
			socket.emit("sessionMessages:regenerate", { id: lastMessage.id })
		}
	}

	/**
	 * Regenerate the last turn, as a whole (`core#retake`, lair pass R2):
	 * a preview names the turn's rows in the confirm, unless this session's
	 * annex says not to ask (`core:annex#retake-quietly`, set by the
	 * dialog's checkbox and taken back in Edit Session → Settings).
	 */
	let showRetakeConfirm = $state(false)
	let retakeRows = $state<RetakeRow[]>([])
	/** 🚧 The preview's On revision sentence (PLAN-rulesets §28). */
	let retakeRevision = $state<string | null>(null)
	const retake = createRetake({
		sessionId: () => sessionId,
		quiet: () => retakeQuietly(annexView),
		send: (p) => {
			if (!p.preview) {
				markFireInFlight()
				retakeSent = true
			}
			socket.emit("sessions:retakeTurn", p)
		},
		setQuiet: (value) =>
			emitFireAction({
				fn: "retake-quietly",
				identity: RETAKE_QUIETLY,
				payload: { value }
			}),
		ask: (rows, revision) => {
			retakeRows = rows
			retakeRevision = revision
			showRetakeConfirm = true
		}
	})
	function handleRetake(e: Event) {
		e.stopPropagation()
		retake.press()
	}
	/**
	 * 🚧 This tab sent the retake itself (not a preview), until it answers:
	 * the tab that pressed is the one that follows a branch (2026-10-18).
	 */
	let retakeSent = false
	function handleRetakeTurn(msg: Sockets.Sessions.RetakeTurn.Response) {
		if (msg.sessionId !== sessionId) return
		if (retake.hear(msg)) return
		if (!msg.ok) clearFireInFlight()
		const mine = retakeSent
		retakeSent = false
		// 🚧 On revision `branch` (the 100-turn walk, B8): the turn was taken
		// again in a new session — the page goes there, as a delete that
		// branched does, rather than staying on the unchanged original.
		if (mine && typeof msg.branchedTo === "number") {
			clearFireInFlight()
			toaster.info({
				title: "Regenerated in a branch",
				description: "The turn was taken again in a new branch; the old one stays where it was."
			})
			void goto(sessionAddress(msg.branchedTo))
		}
	}
	function handleRetakeTurnError(msg: Sockets.Sessions.RetakeTurn.Response) {
		if (msg.sessionId !== sessionId) return
		if (retake.hear(msg)) return
		retakeSent = false
		clearFireInFlight()
		if (msg.error) toaster.error({ title: msg.error })
	}

	function onPickSpeaker(characterId: number) {
		showPickSpeakerModal = false
		markFireInFlight()
		fireTurn(socket, sessionId, { characterId })
	}

	function openNarrateModal() {
		socket.emit("sessions:sideCharacterOptions", { sessionId })
		showNarratorResponseModal = true
	}

	function handleNarratorResponse(e: Event) {
		e.stopPropagation()
		showPickSpeakerModal = false
		openNarrateModal()
	}

	/**
	 * The narrator row of both pickers (B8): a narrator genre's own turn —
	 * the `narrate` turn control, when the list carries it — else Chat's
	 * narrate function and its instructions modal. Neither listed, no row.
	 */
	let narratorTurn = $derived(extraAction("narrate"))
	let narratorFunction = $derived(
		composerMenuActions.some((a) => actionIdentity(a) === NARRATE_ACTION)
	)
	let narratorRowChip = $derived(
		narratorTurn ? extraChip(narratorTurn) : undefined
	)
	function handleFireNarratorTurn(e?: Event, channel?: string) {
		e?.stopPropagation()
		showPickSpeakerModal = false
		markFireInFlight()
		// Where it was pressed (R8): a Lair narration lands on `main` either
		// way, and the run can tell a Sanctum press from a story one — the
		// Sanctum panel's Narrate names its channel (S1).
		fireTurn(
			socket,
			sessionId,
			{ narrator: true },
			channel ?? composerChannel
		)
	}
	function handleNarratorRow(e: Event) {
		if (narratorRowChip?.disabled) return e.preventDefault()
		if (narratorTurn) handleFireNarratorTurn(e)
		else handleNarratorResponse(e)
	}

	function handleConfirmNarratorResponse(request: NarratorRequest) {
		showNarratorResponseModal = false
		narrations.modal(request)
	}

	function handleCancelNarratorResponse() {
		showNarratorResponseModal = false
	}

	/**
	 * Continue (§4.7): the first entry prepared on the channel of the
	 * composer it was pressed in (lair re-plan R5) — the widget's, when it
	 * says; else this page's own composer channel.
	 */
	function handleContinueWithNextCharacter(channel?: string) {
		if (!turnOrder?.order.length) return
		markFireInFlight()
		fireTurn(socket, sessionId, undefined, channel ?? composerChannel)
	}

	function handlePickTurn(entry: { ref: string | null }) {
		showTurnPicker = false
		// The narrator row: a narrator genre's turn, else Chat's modal.
		if (entry.ref === null && !narratorTurn) {
			openNarrateModal()
			return
		}
		markFireInFlight()
		socket.emit("sessions:fireTurn", {
			sessionId,
			entry: { ref: entry.ref, via: "pick" }
		})
	}

	/**
	 * 🚧 A guest's seat, opened by name (`take-seat`, Lair rewrite D5): the
	 * session's seat-name write, which opens a card-less player seat for a
	 * caller with none. The server sends the updated session to every
	 * member's page, and the composer's offer goes with the seat.
	 */
	function takeSeat(name: string) {
		socket.emit("sessions:update", {
			session: { id: sessionId } as Sockets.Sessions.Update.Params["session"],
			seatName: name
		})
	}

	function handleAddPersona(personaId: number) {
		const req: Sockets.Sessions.AddPersona.Params = {
			sessionId,
			personaId
		}
		socket.emit("sessions:addPersona", req)
		showAddPersonaModal = false
	}

	function handleSessionMessageError(msg: { error?: string }) {
		// A generation that failed before any isGenerating row would otherwise
		// leave the next-character block suppressed for the full settle timeout.
		clearFireInFlight()
		toaster.error({
			title: "Failed to load message",
			description: msg?.error
		})
	}

	function handleTurnOrder(msg: Sockets.Sessions.TurnOrder.Push) {
		if (msg.sessionId !== sessionId) return
		const t = msg.turnOrder as Partial<TurnOrderView> | null
		turnOrder = {
			order: Array.isArray(t?.order) ? t!.order : [],
			candidates: Array.isArray(t?.candidates) ? t!.candidates : []
		}
		turnOrderDoc = readTurnOrder({ turnOrder: msg.turnOrder })
		// The server says no reply is coming from this change (B9): stop
		// waiting on the send, so the next-speaker block shows at once.
		if (pushSaysNoReply(msg, sessionId)) clearFireInFlight()
	}

	/**
	 * A fire that did not start a run — a person's turn, nothing prepared —
	 * answers on the success event with `ok: false`; no placeholder will
	 * land to clear the in-flight flag, so it is cleared here. 🚧 So does the
	 * owner's Continue that only moved past a waiting player with nothing
	 * prepared after them (`reason: 'skipped'`, Lair rewrite D5): it
	 * succeeded, and no run follows it.
	 */
	function handleFireTurn(msg: Sockets.Sessions.FireTurn.Response) {
		if (msg.sessionId !== sessionId) return
		if (msg.ok && msg.reason !== "skipped") return
		clearFireInFlight()
	}

	/** A refused fire: clear the in-flight flag and show the server's sentence. */
	function handleFireTurnError(msg: Sockets.Sessions.FireTurn.Response) {
		if (msg.sessionId !== sessionId) return
		clearFireInFlight()
		const sentence = fireTurnRefusal(msg, sessionId)
		if (sentence) toaster.error({ title: sentence })
	}

	function handleSessionsAddPersona(
		msg: Sockets.Sessions.AddPersona.Response
	) {
		if (msg.success) {
			toaster.success({
				title: "Persona added to session successfully"
			})
		} else if (msg.error) {
			toaster.error({ title: msg.error })
		}
	}

	function handleSessionsSideCharacterOptions(
		msg: Sockets.Sessions.SideCharacterOptions.Response
	) {
		if (msg.sessionId !== sessionId) return
		sideCharacterOptions = msg.characters ?? []
	}

	d.inbox.on("sessions:turnOrder", handleTurnOrder)
	d.inbox.on("sessions:fireTurn:error", handleFireTurnError)
	d.inbox.on("sessions:fireTurn", handleFireTurn)
	// Regenerate the last turn (`core#retake`, R2): the preview the dialog
	// names, the retake's answer, and its refusal in a sentence.
	d.inbox.on("sessions:retakeTurn", handleRetakeTurn)
	d.inbox.on("sessions:retakeTurn:error", handleRetakeTurnError)
	d.inbox.on("sessions:addPersona", handleSessionsAddPersona)
	d.inbox.on(
		"sessions:sideCharacterOptions",
		handleSessionsSideCharacterOptions
	)
	d.inbox.on("sessionMessage:error", handleSessionMessageError)

	return {
		get turnOrder() {
			return turnOrder
		},
		/** The stored document, whole — every widget's `turnOrder.v1` (C5). */
		get turnOrderDoc() {
			return turnOrderDoc
		},
		get showTurnPicker() {
			return showTurnPicker
		},
		set showTurnPicker(open: boolean) {
			showTurnPicker = open
		},
		get showPickSpeakerModal() {
			return showPickSpeakerModal
		},
		set showPickSpeakerModal(open: boolean) {
			showPickSpeakerModal = open
		},
		get pickSpeakerSearch() {
			return pickSpeakerSearch
		},
		set pickSpeakerSearch(search: string) {
			pickSpeakerSearch = search
		},
		get showNarratorResponseModal() {
			return showNarratorResponseModal
		},
		set showNarratorResponseModal(open: boolean) {
			showNarratorResponseModal = open
		},
		get sideCharacterOptions() {
			return sideCharacterOptions
		},
		get showAddPersonaModal() {
			return showAddPersonaModal
		},
		set showAddPersonaModal(open: boolean) {
			showAddPersonaModal = open
		},
		get showRetakeConfirm() {
			return showRetakeConfirm
		},
		set showRetakeConfirm(open: boolean) {
			showRetakeConfirm = open
		},
		get retakeRows() {
			return retakeRows
		},
		get retakeRevision() {
			return retakeRevision
		},
		retake,
		get shouldShowNextCharacterBlock() {
			return shouldShowNextCharacterBlock
		},
		get canChooseDifferentCharacter() {
			return canChooseDifferentCharacter
		},
		get nextCharacter() {
			return nextCharacter
		},
		get narratorTurn() {
			return narratorTurn
		},
		get narratorFunction() {
			return narratorFunction
		},
		get narratorRowChip() {
			return narratorRowChip
		},
		markFireInFlight,
		clearFireInFlight,
		handleAbortLastMessage,
		handleAdvance,
		handlePickSpeaker,
		handleRegenerateLastMessage,
		handleRetake,
		onPickSpeaker,
		openNarrateModal,
		handleNarratorResponse,
		handleFireNarratorTurn,
		handleNarratorRow,
		handleConfirmNarratorResponse,
		handleCancelNarratorResponse,
		handleContinueWithNextCharacter,
		handlePickTurn,
		handleAddPersona,
		takeSeat,
		/** Another session opened in the page: the last one's order goes with it. */
		reset() {
			turnOrder = null
			turnOrderDoc = EMPTY_TURN_ORDER
			playedFrom = null
			showTurnPicker = false
		}
	}
}

/** The session page's turns (`createTurnFlow`). */
export type TurnFlow = ReturnType<typeof createTurnFlow>
