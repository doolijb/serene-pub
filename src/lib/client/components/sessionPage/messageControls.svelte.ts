/**
 * A message's controls, as the session page implements them: regenerate,
 * extend, hide, delete (its confirm), branch (its dialog), stop, swipe and
 * the swipe row's verdicts; the sprite picker a line asks for; and the two
 * viewers a line opens — the avatar gallery and the media lightbox.
 */
import { goto } from "$app/navigation"
import { toaster } from "$lib/client/utils/toaster"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import {
	canSwipeRight as swipeRightAllowed,
	showSwipeControls as swipeRowShown
} from "$lib/client/components/sessionPage/swipeControls"
import {
	lightboxStateOf,
	type LightboxState
} from "$lib/client/components/sessionPage/mediaLightbox"
import type { ViewImageGallery } from "$lib/client/components/sessionPage/requests/viewImage"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import type { SessionPageInbox } from "$lib/client/components/sessionPage/sessionPageInbox.svelte"
import type { SessionPageData } from "$lib/client/components/sessionPage/sessionPageData.svelte"
import type { ActionList } from "$lib/client/components/sessionPage/actionList.svelte"

export interface MessageControlsDeps {
	socket: TypedSocket
	inbox: SessionPageInbox
	/** The session in the route. */
	sessionId(): number
	data: SessionPageData
	/** Whether the genre offers `retry` and `swipe`, and the newest reply's regenerate verdict. */
	actions: ActionList
}

/** A message's controls and the dialogs they open. Registers its listener on the inbox at once. */
export function createMessageControls(d: MessageControlsDeps) {
	const socket = d.socket
	const sessionId = $derived(d.sessionId())
	const session = $derived(d.data.session)
	const lastMessage = $derived(d.data.lastMessage)
	const lastAuthorMessage = $derived(d.data.lastAuthorMessage)
	const canRegenerateLastMessage = $derived(
		d.actions.canRegenerateLastMessage
	)
	const offersVerb = (verb: "retry" | "swipe") => d.actions.offersVerb(verb)

	let showDeleteMessageModal = $state(false)
	let deleteSessionMessage: SelectSessionMessage | undefined = $state()
	let showBranchSessionModal = $state(false)
	let branchFromMessage: SelectSessionMessage | undefined = $state()
	/** The line whose sprite is being changed (`change-sprite`), while the picker is open. */
	let spriteLine = $state<SelectSessionMessage | null>(null)

	let showAvatarModal = $state(false)
	let avatarModalEntity = $state<{
		type: "character" | "persona"
		id: number
		name: string
		avatarMediaId: number | null
	} | null>(null)

	let showImageModal = $state(false)
	/** What the media lightbox shows: one image, or a message's media strip. */
	let lightboxState = $state<LightboxState | null>(null)

	/**
	 * 🚧 The server's sentence for what this delete does to the timeline
	 * (PLAN-rulesets §28, `sessions:revisionNotice`): null until it answers,
	 * and for a delete that is no revision.
	 */
	let deleteRevision = $state<string | null>(null)
	function openDeleteMessageModal(message: SelectSessionMessage) {
		deleteSessionMessage = message
		deleteRevision = null
		showDeleteMessageModal = true
		socket.emit("sessions:revisionNotice", {
			sessionId,
			messageId: message.id
		})
	}
	d.inbox.on("sessions:revisionNotice", (res) => {
		if (res.sessionId !== sessionId || res.messageId !== deleteSessionMessage?.id) return
		deleteRevision = res.revision?.sentence ?? null
	})

	function onOpenMessageDeleteChange(details: OpenChangeDetails) {
		showDeleteMessageModal = details.open
		if (!showDeleteMessageModal) {
			deleteSessionMessage = undefined
		}
	}

	/**
	 * 🚧 The row this tab asked to delete, until the server answers (the
	 * 100-turn walk, B9): a refusal ("Honour mode is off: turns can only be
	 * retaken…") is said once, in the tab that pressed — a refused delete
	 * must never close its confirmation on nothing at all.
	 */
	let deleteAsked: number | null = null
	d.inbox.on("sessionMessages:delete", (res) => {
		if (deleteAsked === null || res.id !== deleteAsked) return
		deleteAsked = null
		if (res.error) toaster.error({ title: "Not deleted", description: res.error })
	})

	function onDeleteMessageConfirm() {
		if (!deleteSessionMessage) return
		deleteAsked = deleteSessionMessage.id
		socket.emit("sessionMessages:delete", {
			id: deleteSessionMessage.id
		})
		deleteSessionMessage = undefined
		showDeleteMessageModal = false
	}

	function onDeleteMessageCancel() {
		deleteSessionMessage = undefined
		showDeleteMessageModal = false
	}

	function onBranchSessionConfirm(title: string) {
		if (branchFromMessage && session) {
			socket.emit("sessions:branch", {
				sessionId,
				messageId: branchFromMessage.id,
				title
			})
		}
		branchFromMessage = undefined
		showBranchSessionModal = false
	}

	function onBranchSessionCancel() {
		branchFromMessage = undefined
		showBranchSessionModal = false
	}

	function handleRegenerateMessage(e: Event, msg: SelectSessionMessage) {
		e.stopPropagation()
		d.data.rerunRefusals.asked("sessionMessages:regenerate", msg.id)
		socket.emit("sessionMessages:regenerate", { id: msg.id })
	}

	function handleExtendMessage(e: Event, msg: SelectSessionMessage) {
		e.stopPropagation()
		// Extend carries the reply on from its existing content (prefill);
		// the server keeps the partial and runs the turn from it.
		d.data.rerunRefusals.asked("sessionMessages:extend", msg.id)
		socket.emit("sessionMessages:extend", { id: msg.id })
	}

	function handleHideMessage(e: Event, msg: SelectSessionMessage) {
		e.stopPropagation()
		// Toggle isHidden status by updating the message
		socket.emit("sessionMessages:update", {
			id: msg.id,
			isHidden: !msg.isHidden
		})
	}

	function handleDeleteMessage(e: Event, msg: SelectSessionMessage) {
		e.stopPropagation()
		openDeleteMessageModal(msg)
	}

	function handleAbortMessage(e: Event, msg: SelectSessionMessage) {
		e.stopPropagation()
		socket.emit("sessionMessages:cancel", { id: msg.id, sessionId })
	}

	function handleBranchMessage(e: Event, msg: SelectSessionMessage) {
		e.stopPropagation()
		branchFromMessage = msg
		showBranchSessionModal = true
	}

	function swipeRight(msg: SelectSessionMessage): void {
		const req: Sockets.SessionMessages.SwipeRight.Params = {
			id: msg.id
		}
		d.data.rerunRefusals.asked("sessionMessages:swipeRight", msg.id)
		socket.emit("sessionMessages:swipeRight", req)
	}

	function swipeLeft(msg: SelectSessionMessage): void {
		const req: Sockets.SessionMessages.SwipeLeft.Params = {
			id: msg.id
		}
		d.data.rerunRefusals.asked("sessionMessages:swipeLeft", msg.id)
		socket.emit("sessionMessages:swipeLeft", req)
	}

	function canSwipeRight(
		msg: SelectSessionMessage,
		isGreeting: boolean
	): boolean {
		return swipeRightAllowed(msg, isGreeting, lastAuthorMessage)
	}

	// NOTE: this intentionally does not return true for
	// `openMsgControlsMenu === msg.id`. That would make opening a message's
	// "..." popover add the swipe row to that message, growing it by a whole
	// row while the popover was anchored to it — the message would jump and
	// the popover reposition. The trade is that swipe arrows on mid-history
	// assistant messages are unreachable; if that needs restoring, add
	// a labelled swipe entry to the popover rather than re-coupling the two.
	function showSwipeControls(
		msg: SelectSessionMessage,
		isGreeting: boolean
	): boolean {
		// The author's line never swipes, in any genre (F1) — see
		// `swipeControls.ts`, which checks the role before "newest".
		return swipeRowShown(msg, {
			isGreeting,
			isNewest: msg.id === lastMessage?.id,
			swipeOffered: offersVerb("swipe"),
			canRegenerateNewest: canRegenerateLastMessage,
			lastAuthor: lastAuthorMessage
		})
	}

	function handleSessionsBranch(msg: Sockets.Sessions.Branch.Response) {
		if (msg.session) {
			toaster.success({
				title: "Session branched successfully"
			})
			// Navigate to the new branched session
			goto(`/sessions/${msg.session.id}`)
		} else if (msg.error) {
			toaster.error({ title: msg.error })
		}
	}

	function handleAvatarClick(char: SelectCharacter | undefined) {
		if (!char) return
		const isPersona = session?.sessionPersonas?.some(
			(cp) => cp.persona?.id === char.id
		)
		avatarModalEntity = {
			type: isPersona ? "persona" : "character",
			id: char.id,
			// resolveCharacterName uses `||` (not `??`) deliberately — a blank
			// nickname is commonly stored as "" rather than null, and ""
			// isn't nullish, so `??` wouldn't fall through to the character's
			// real name, leaving the modal title empty.
			name: resolveCharacterName(char, ""),
			// The id, not a resolved URL: the modal shows this large, and a
			// pre-resolved thumbnail URL is not something it can undo.
			avatarMediaId: char.avatarMediaId ?? null
		}
		showAvatarModal = true
	}

	function handleImageClick(src: string, gallery?: ViewImageGallery) {
		lightboxState = lightboxStateOf({ src, gallery })
		showImageModal = true
	}

	d.inbox.on("sessions:branch", handleSessionsBranch)

	return {
		get deleteRevision() {
			return deleteRevision
		},
		get showDeleteMessageModal() {
			return showDeleteMessageModal
		},
		onOpenMessageDeleteChange,
		onDeleteMessageConfirm,
		onDeleteMessageCancel,
		get showBranchSessionModal() {
			return showBranchSessionModal
		},
		set showBranchSessionModal(open: boolean) {
			showBranchSessionModal = open
		},
		onBranchSessionConfirm,
		onBranchSessionCancel,
		/** The line whose sprite is being changed (`change-sprite`), while the picker is open. */
		get spriteLine() {
			return spriteLine
		},
		set spriteLine(line: SelectSessionMessage | null) {
			spriteLine = line
		},
		get showAvatarModal() {
			return showAvatarModal
		},
		set showAvatarModal(open: boolean) {
			showAvatarModal = open
		},
		get avatarModalEntity() {
			return avatarModalEntity
		},
		get showImageModal() {
			return showImageModal
		},
		set showImageModal(open: boolean) {
			showImageModal = open
		},
		get lightboxState() {
			return lightboxState
		},
		handleRegenerateMessage,
		handleExtendMessage,
		handleHideMessage,
		handleDeleteMessage,
		handleAbortMessage,
		handleBranchMessage,
		swipeRight,
		swipeLeft,
		canSwipeRight,
		showSwipeControls,
		handleAvatarClick,
		handleImageClick
	}
}

/** A session page's message controls (`createMessageControls`). */
export type MessageControls = ReturnType<typeof createMessageControls>
