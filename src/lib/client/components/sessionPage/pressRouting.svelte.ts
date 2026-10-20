/**
 * Where a press goes on the session page: core's verbs to their handlers
 * (`coreVerbs`), everything else to the audited fire — the ONE routing rule
 * (`actionDispatch`, threaded down to every widget and frame mount), the
 * collect modal a collecting action opens, the draft a slash argument spends,
 * and what a fire's answer says. The emit itself is the page's
 * (`emitFireAction`), and so is the narrator's divert (`narrate`).
 */
import * as Icons from "@lucide/svelte"
import { toaster } from "$lib/client/utils/toaster"
import { runProgress } from "$lib/client/stores/runProgress.svelte"
import { failureOnProgressCard } from "$lib/client/components/sessionPage/fireFailure"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import {
	actionIdentity,
	isCoreActionIdentity,
	NARRATE_ACTION,
	NARRATE_CHARACTER_ACTION,
	parseActionIdentity
} from "$lib/shared/actions/identity"
import {
	dispatchAction,
	type ActionDispatch,
	type CoreVerbHandlers,
	type InvokeArgs
} from "$lib/shared/widgets/invokeAction"
import {
	collectedFire,
	draftHolds,
	draftToGiveBack,
	holdsOf,
	routePress,
	type Collected,
	type ListedCollects,
	type SpentDraft
} from "$lib/client/components/sessionPage/collects"
import type { SessionStateHandle } from "$lib/client/state/sessionState.svelte"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import type { SessionPageInbox } from "$lib/client/components/sessionPage/sessionPageInbox.svelte"
import type { SessionPageData } from "$lib/client/components/sessionPage/sessionPageData.svelte"
import type { ActionList } from "$lib/client/components/sessionPage/actionList.svelte"
import type {
	EmitFireAction,
	TurnFlow
} from "$lib/client/components/sessionPage/turnFlow.svelte"
import type { MessageControls } from "$lib/client/components/sessionPage/messageControls.svelte"

/** What a press supplied (S2's slash argument), and whether it was the draft. */
export type SuppliedPress = (Collected & { fromDraft?: boolean }) | undefined

export interface PressRoutingDeps {
	socket: TypedSocket
	inbox: SessionPageInbox
	/** The session in the route. */
	sessionId(): number
	data: SessionPageData
	actions: ActionList
	turns: TurnFlow
	controls: MessageControls
	/** The session state store: what a collecting action's overwritten slot holds now. */
	stateStore: SessionStateHandle
	/** The composer's draft, as the page holds it. */
	draft(): string
	/** The page's one way to change the draft. */
	writeDraft(content: string): void
	/** The page's one `sessions:fireAction` emit. */
	emitFireAction: EmitFireAction
	/** A press of the narrator's: a directed narration fires, else the modal opens (the page's `narrations`). */
	narrate(
		identity: string | null,
		route: ReturnType<typeof routePress>,
		supplied: SuppliedPress
	): void
}

/** The page's press routing. Registers its listener on the inbox at once. */
export function createPressRouting(d: PressRoutingDeps) {
	const socket = d.socket
	const stateStore = d.stateStore
	const emitFireAction = d.emitFireAction
	const sessionId = $derived(d.sessionId())
	const session = $derived(d.data.session)
	const newMessage = $derived(d.draft())
	const formCollects = $derived(d.actions.formCollects)
	const writeDraft = (content: string) => d.writeDraft(content)
	const listedAction = (identity: string) => d.actions.listedAction(identity)
	const extraAction = (key: string) => d.actions.extraAction(key)
	const runActionTitle = (action: string | undefined) =>
		d.actions.runActionTitle(action)
	const { retake } = d.turns
	const handleAdvance = (e: Event) => d.turns.handleAdvance(e)
	const handlePickSpeaker = (e: Event) => d.turns.handlePickSpeaker(e)
	const handleFireNarratorTurn = (e: Event) =>
		d.turns.handleFireNarratorTurn(e)
	const handleRetake = (e: Event) => d.turns.handleRetake(e)
	const handleRegenerateLastMessage = (e: Event) =>
		d.turns.handleRegenerateLastMessage(e)
	const handleAbortLastMessage = (e: Event) =>
		d.turns.handleAbortLastMessage(e)
	const {
		handleExtendMessage,
		handleRegenerateMessage,
		handleAbortMessage,
		handleBranchMessage,
		handleHideMessage,
		handleDeleteMessage,
		swipeLeft,
		swipeRight
	} = d.controls

	/**
	 * Frame and widget actions ride the same audited path as every
	 * contributed button — with the pressed declaration's identity when the
	 * caller named one (`invoke`; W1), and the block a form's press answers
	 * when it answers one (U5d).
	 *
	 * One of core's verbs named that way is routed to its real handler here
	 * too (W4). The hosts between this page and a mount now carry the whole
	 * `actionDispatch` down, so a widget's `invoke('extend')` is resolved at
	 * the mount and never reaches this function; a frame or widget that still
	 * arrives here naming `core#extend` (a bare `{ t: "action" }`, or a host
	 * wired without the dispatch) must not be sent to
	 * `sessions:fireAction`, which refuses it by name.
	 *
	 * Everything else goes to `fireOfferedAction` — the offered-action wrapper — or,
	 * when the press answers a form, straight to `emitFireAction` beneath it. A
	 * press arriving from a frame or a widget is the same press as the chip or
	 * the form button beside it, so it is named as a run on the same terms; an
	 * emit of its own here would be a second, lesser fire for whoever pressed
	 * from the wrong place.
	 */
	function handleFrameAction(
		fn: string,
		messageId?: number,
		payload?: Record<string, unknown>,
		action?: string,
		blockId?: string
	) {
		const parsed = action ? parseActionIdentity(action) : null
		if (action && parsed && isCoreActionIdentity(action)) {
			dispatchAction(
				{ specSlug: parsed.specSlug, key: parsed.key },
				actionDispatch,
				{ messageId, payload, ...(blockId ? { blockId } : {}) }
			)
			return
		}
		// A press naming a block answers a form already on the row, so it goes
		// straight to the emit, for the reason a form's own button does: no
		// divert, and the block's stamped identity carried verbatim rather
		// than read as a declaration this session offers.
		if (blockId) {
			emitFireAction({
				fn,
				identity: action,
				messageId,
				payload,
				blockId
			})
			return
		}
		// A press that named no well-formed identity (a bare `{ t: "action" }`)
		// carries its bare key onward, and the server resolves it to the one
		// declaration of that key or refuses it (plans/31 V2).
		fireOfferedAction(parsed ?? { key: fn }, { messageId, payload })
	}

	/** The message an invocation named, when it is one this page holds. */
	const messageById = (id?: number) =>
		id == null
			? undefined
			: session?.sessionMessages?.find((m) => m.id === id)

	/**
	 * Core's verbs, as this page implements them (W4): what a widget's
	 * `invoke('extend')`, a frame's `{ t: "invoke", key: "core#edit" }`
	 * and the palette's `/advance` all land on. A verb named with a message
	 * acts on that message; `retry` named with none acts on the newest reply
	 * and `advance` fires the turn order's head (the turn controls); the rest
	 * need a subject and say so rather than guessing one.
	 */
	const needsSubject = (key: string) => {
		throw new Error(`'${key}' acts on a message — name one`)
	}
	const withMessage = (
		key: string,
		args: InvokeArgs | undefined,
		fn: (m: SelectSessionMessage) => void
	) => {
		const m = messageById(args?.messageId)
		if (!m) return needsSubject(key)
		fn(m)
	}
	const coreVerbs: CoreVerbHandlers = {
		// The prefill extend carries ONE reply on, so it names it (B7); the
		// composer's Continue — fire the turn order's head — is `advance`.
		extend: (args) =>
			withMessage("extend", args, (m) =>
				handleExtendMessage(new Event("invoke"), m)
			),
		advance: () => handleAdvance(new Event("invoke")),
		// Pick who speaks and the narrator's turn (B8): the chips' own
		// handlers — the list decided they are here.
		pick: () => handlePickSpeaker(new Event("invoke")),
		narrate: () => handleFireNarratorTurn(new Event("invoke")),
		// Regenerate the last turn, as a whole (R2): the confirm first.
		retake: () => handleRetake(new Event("invoke")),
		retry: (args) =>
			args?.messageId != null
				? withMessage("retry", args, (m) => {
						const regenerate = () =>
							handleRegenerateMessage(new Event("invoke"), m)
						// In a retake genre a row that is not a delver's may be
						// one part of a several-row turn: the whole turn is
						// regenerated then, else the row as always (R2).
						if (
							extraAction("retake") &&
							m.characterId == null &&
							m.role !== "user"
						)
							retake.pressRow(
								m.id,
								regenerate,
								// 🚧 No row retry in this genre: even a one-row
								// turn — a failed reply — is retaken whole (B7).
								d.data.messageVerbs?.retry === false
							)
						else regenerate()
					})
				: handleRegenerateLastMessage(new Event("invoke")),
		// `edit` COMMITS (C0b): edit mode is the widget's own state, and the
		// verb carries the new text.
		edit: (args) =>
			withMessage("edit", args, (m) => {
				const content = args?.payload?.content
				if (typeof content !== "string" || !content.trim())
					throw new Error("'edit' carries the new text — { content }")
				socket.emit("sessionMessages:update", { ...m, content })
			}),
		stop: (args) =>
			args?.messageId != null
				? withMessage("stop", args, (m) =>
						handleAbortMessage(new Event("invoke"), m)
					)
				: handleAbortLastMessage(new Event("invoke")),
		branch: (args) =>
			withMessage("branch", args, (m) =>
				handleBranchMessage(new Event("invoke"), m)
			),
		// A reply swiped to the newer alternative, or back (`{ direction }`).
		swipe: (args) =>
			withMessage("swipe", args, (m) =>
				args?.payload?.direction === "left"
					? swipeLeft(m)
					: swipeRight(m)
			),
		hide: (args) =>
			withMessage("hide", args, (m) =>
				handleHideMessage(new Event("invoke"), m)
			),
		delete: (args) =>
			withMessage("delete", args, (m) =>
				handleDeleteMessage(new Event("invoke"), m)
			)
	}
	/**
	 * ONE routing rule (`dispatchAction`): core's verbs above, the rest the
	 * audited fire.
	 *
	 * Threaded down to every widget and frame mount (`actionDispatch`), so a
	 * press inside one resolves here and not in a lesser copy: `fire` is this
	 * page's own `fireOfferedAction`, which names the run and opens the narrator's
	 * modal, and the chip, the menu row and the widget are then one lane.
	 */
	const actionDispatch: ActionDispatch = {
		// A core verb takes no text (S2): `/advance x` is refused, never run.
		core: Object.fromEntries(
			Object.entries(coreVerbs).map(([key, handler]) => [
				key,
				(args?: InvokeArgs) => {
					if (args?.text?.trim()) {
						const identity = actionIdentity({
							specSlug: "core",
							key
						})
						const route = routePress(
							listedAction(identity),
							{ text: args.text },
							key
						)
						if (route.route === "refuse")
							return refusePress(route.reason, identity)
					}
					handler?.(args)
				}
			])
		),
		// The text a press supplies (S2's slash argument) is the draft's:
		// the run spends it (D1) when the composer still holds it.
		fire: (a, args) =>
			fireOfferedAction(
				a,
				args,
				args?.text !== undefined
					? { text: args.text, fromDraft: true }
					: undefined
			)
	}

	/** A press refused before it fired (S2): said, and nothing runs; the draft stays. */
	function refusePress(reason: string, identity?: string | null) {
		toaster.error({
			title: runActionTitle(identity ?? undefined),
			description: reason
		})
	}

	function handleSessionsFireAction(
		msg: Sockets.Sessions.FireAction.Response
	) {
		if (msg.sessionId !== sessionId) return
		// The draft a text-taking press spent when it fired (note 31) comes
		// back when its run was refused, failed or was stopped — into an
		// empty composer only, never over what the person has typed since.
		if (draftSent && msg.action === draftSent.identity) {
			const giveBack = draftToGiveBack(msg, draftSent.draft, newMessage)
			if (giveBack !== null) writeDraft(giveBack)
			draftSent = null
		}
		// Cancelled FIRST, and never as an error. Somebody pressing Cancel is
		// a deliberate act; it gets no red toast for doing exactly what was
		// asked.
		if (msg.cancelled) {
			// A supersede is bookkeeping — the client re-sent the same run id,
			// so the run this replaces is one nobody watched and nobody
			// stopped. Its replacement is what the person is looking at, and a
			// notice about the one it displaced would be noise blaming them
			// for a cancel they did not make.
			if (msg.cancelledBy !== "system:superseded")
				toaster.info({
					title: runActionTitle(msg.action),
					description: "Cancelled."
				})
			// Still re-read: a run stops BETWEEN nodes, so a consumer earlier
			// in the spec may already have written. "Cancelled" is all this
			// knows; "nothing happened" is a claim it cannot make.
			socket.emit("sessions:get", { id: sessionId })
		} else if (msg.error) {
			// Said once (D4): a run that failed is on the progress card above the
			// composer already, Inspect beside it, and its terminal frame
			// arrived before this answer. Only a press refused before any run
			// started, which has no card, is said here.
			if (!failureOnProgressCard(msg, runProgress.lastFinished(sessionId)))
				toaster.error({
					title: runActionTitle(msg.action),
					description: msg.error
				})
		} else if (msg.success) {
			// The spec's consumers wrote whatever they wrote — re-read the session
			// so it shows.
			socket.emit("sessions:get", { id: sessionId })
		}
	}

	/**
	 * The generic fire (19 §4) for an OFFERED action, named by the declaration
	 * that was pressed (W1). A subject message, entered values and the block a
	 * press answers ride when there are any.
	 *
	 * The wrapper every offered press takes, and the reason
	 * `actionDispatch.fire` is it: the chips, the `/` palette, a message's ⋮
	 * menu, a widget's `invoke(key)`, a frame's `{ t: "invoke" }` and a bare
	 * frame action all arrive here, so the divert below is had by all of them
	 * or by none.
	 *
	 * The spec is optional because a caller may have no declaration to give
	 * — a frame's bare `{ t: "action", fn }` — and then the key alone rides.
	 */
	function fireOfferedAction(
		a: {
			specSlug?: string
			key: string
		},
		args?: InvokeArgs,
		/**
		 * What the press already collected (lair pass R3) — S2's slash
		 * argument, say. `fromDraft` when that text is the composer's draft,
		 * which the run then spends (D1). Absent, a collecting action opens
		 * the collect modal.
		 */
		supplied?: Collected & { fromDraft?: boolean },
		/** 🚧 The person already answered this action's question (`confirm`). */
		confirmed = false
	) {
		// The functions with a bespoke client flow: both halves of the narrator
		// split open the same modal — whose first step *is* the choice between
		// them — and fire the dedicated event. Everything else is the generic
		// fire (19 §4).
		//
		// Never for a press that carries a `blockId`, whatever it is named: a
		// form answer answers its form. `handleFrameAction` sends one straight
		// to `emitFireAction` for exactly that reason, but it is not the only way
		// a block's press arrives — a widget's `invoke(key, { blockId })` and a
		// frame's `{ t: "invoke", blockId }` come through this wrapper — so the
		// rule belongs here too, or a form whose action is one of the
		// narrator's two opens the modal and leaves its question unanswered and
		// still answerable.
		const identity = a.specSlug
			? actionIdentity({ specSlug: a.specSlug, key: a.key })
			: null
		// What the press collects (lair pass R3) and what it supplied (S2's
		// slash argument): ONE routing (`routePress`). Text to an action that
		// collects none — `/narrator x` among them, before the narrator's
		// divert — is refused and nothing fires; the draft stays.
		const listedRow = identity ? listedAction(identity) : undefined
		// 🚧 An action that asks first (`confirm`, 2026-10-18): the question,
		// then this same press again. A form's press is not asked again — the
		// form was the question.
		if (listedRow?.confirm && !args?.blockId && !confirmed) {
			confirming = {
				asking: listedRow.confirm,
				go: () => fireOfferedAction(a, args, supplied, true)
			}
			return
		}
		const listed = identity
			? (listedRow ?? formCollects[identity])
			: undefined
		const route = routePress(
			listed
				? {
						slash: listedRow?.slash,
						name: listed.name,
						collects: listed.collects
					}
				: undefined,
			supplied,
			a.key
		)
		if (route.route === "refuse") {
			refusePress(route.reason, identity ?? a.key)
			return
		}
		if (
			!args?.blockId &&
			(identity === NARRATE_ACTION ||
				identity === NARRATE_CHARACTER_ACTION ||
				(!identity &&
					(a.key === "narrate" || a.key === "narrate-character")))
		) {
			// The page's narrations decide (`narrate`): a directed narration
			// fires, else the narrator's modal opens.
			d.narrate(identity, route, supplied)
			return
		}
		// A collecting action opens the collect modal, from any venue — a
		// chip, the palette, a message's ⋮, a widget's invoke, a form's
		// option — unless the press already supplied what it collects; an
		// argument cannot carry recipients (Whisper), so that modal opens
		// prefilled with it. Nothing reads the draft.
		if (route.route === "modal") {
			collecting = {
				action: listed!,
				identity: identity!,
				fn: a.key,
				args,
				initialText: route.initialText,
				fromDraft: !!supplied?.fromDraft
			}
			return
		}
		if (route.route === "fire") {
			if (supplied?.fromDraft && route.collected.text)
				spendDraft(identity!, route.collected.text)
			emitFireAction({
				fn: a.key,
				identity,
				messageId: args?.messageId,
				payload: args?.payload,
				blockId: args?.blockId,
				...route.collected
			})
			return
		}
		emitFireAction({
			fn: a.key,
			identity,
			messageId: args?.messageId,
			payload: args?.payload,
			blockId: args?.blockId
		})
	}
	/**
	 * The draft the last press spent, until its run answers (D1, note 31) —
	 * set only when the collected text was the composer's draft (S2's slash
	 * argument). The composer empties the moment the press fires; a refused
	 * or failed run gives the draft back.
	 */
	let draftSent: SpentDraft | null = null
	function spendDraft(identity: string, sent: string) {
		if (!draftHolds(sent, newMessage)) return
		draftSent = { identity, draft: newMessage }
		writeDraft("")
	}

	/** What the collect modal needs of a pressed action: its name, description and fields. */
	type CollectingAction = {
		name: string
		description?: string
		collects?: ListedCollects
	}

	/** The press the collect modal is open for (lair pass R3), until submit or Cancel. */
	/** 🚧 A press waiting on its action's question (`confirm`), until answered. */
	let confirming = $state<{
		asking: { question: string; description?: string; confirmLabel: string }
		go: () => void
	} | null>(null)

	let collecting = $state<{
		action: CollectingAction
		identity: string
		fn: string
		args?: InvokeArgs
		initialText: string
		/** The prefilled text was the composer's draft (S2): the run spends it (D1). */
		fromDraft?: boolean
	} | null>(null)

	/**
	 * Who a collecting action may pick: the session's enabled cast members —
	 * each with what the action's overwritten slot holds for them now (lair
	 * re-plan R10: a delver's current whisper), so a replace is visible.
	 */
	let collectCast = $derived.by(() => {
		const overwrites = collecting?.action.collects?.recipients?.overwrites
		const slotKey = overwrites
			? stateStore.slots.get(overwrites)?.key
			: undefined
		return (session?.sessionCharacters ?? [])
			.filter((cc) => cc.character && cc.isActive && !cc.removedAt)
			.map((cc) => {
				const holds = holdsOf(
					stateStore.state,
					slotKey,
					cc.character.id
				)
				return {
					ref: `character:${cc.character.id}`,
					name: resolveCharacterName(cc.character, cc.character.name),
					...(holds ? { holds } : {})
				}
			})
	})

	function submitCollected(got: Collected) {
		const press = collecting
		collecting = null
		if (!press?.action.collects) return
		if (press.fromDraft && press.initialText)
			spendDraft(press.identity, press.initialText)
		emitFireAction({
			fn: press.fn,
			identity: press.identity,
			messageId: press.args?.messageId,
			payload: press.args?.payload,
			blockId: press.args?.blockId,
			...collectedFire(press.action.collects, got)
		})
	}

	/** `book-open-text` → `BookOpenText`, resolved against the lucide set. */
	function actionIcon(name?: string) {
		const pascal = (name ?? "")
			.split("-")
			.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
			.join("")
		return (Icons as any)[pascal] ?? Icons.Play
	}

	d.inbox.on("sessions:fireAction", handleSessionsFireAction)

	return {
		coreVerbs,
		actionDispatch,
		handleFrameAction,
		fireOfferedAction,
		/** The press the collect modal is open for (lair pass R3), until submit or Cancel. */
		/** 🚧 The question an action asks before it fires, while it waits (`ActionConfirm`). */
		get confirming() {
			return confirming
		},
		/** The question answered: the press goes on. */
		confirmPress() {
			const asked = confirming
			confirming = null
			asked?.go()
		},
		/** The question declined: nothing fires. */
		cancelPress() {
			confirming = null
		},
		get collecting() {
			return collecting
		},
		set collecting(press: typeof collecting) {
			collecting = press
		},
		get collectCast() {
			return collectCast
		},
		submitCollected,
		actionIcon
	}
}

/** The session page's press routing (`createPressRouting`). */
export type PressRouting = ReturnType<typeof createPressRouting>
