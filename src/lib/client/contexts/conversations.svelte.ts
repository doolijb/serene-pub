/**
 * The conversations context: the ONE subscriber to the `conversations:`
 * socket family (PLAN-private-messages-2026-10-12 §6.1). Private messages
 * between people on one pub.
 *
 * It holds the person's conversations (the Messages list), the message pages
 * the Messages view has opened, the people roster, and the unread count the
 * rail's Messages dot reads. Views never listen to the socket themselves:
 * they call the methods below, and register `onMessage` / `onChanged`
 * listeners for whatever else they do with a push (scroll, mark read).
 *
 * It toasts NOTHING. A new message is a notification row (Activity) and a
 * dot, never a toast. A refused request rejects the promise its method
 * returned; which `:error` siblings the shell's catch-all toast skips is
 * listed in Layout's `HANDLED_ERROR_EVENTS`.
 *
 * Live only while messaging can exist: accounts on, the pub's **Messages
 * between people** switch on, a signed-in user, and not the Android app
 * (single-user). Otherwise it holds no interests and empty state. Re-lists on
 * every reconnect (`onConnect`), like `notifications.connect()`: a push sent
 * while the socket was down is gone for good.
 *
 * Provided by both shells (Layout.svelte, AccessibleShell.svelte) at init.
 */
import { getContext, setContext, untrack } from "svelte"
import { SvelteMap } from "svelte/reactivity"
import {
	declareInterest,
	onConnect,
	requestWithInterest,
	type InterestEvent
} from "$lib/client/sockets/interest.svelte"
import {
	typedSocketOrNull,
	type SocketEventMap
} from "$lib/client/sockets/typedSocket"
import { awaitReply } from "$lib/client/utils/awaitReply"
import { messagesHref } from "$lib/client/shell/viewLinks"
import type {
	ConversationMessageRow,
	ConversationPerson,
	ConversationSummary,
	ConversationsAttachableParams,
	ConversationsAttachableResponse,
	ConversationsChangedPush,
	ConversationsCreateResponse,
	ConversationsLeaveResponse,
	ConversationsMessagePush,
	ConversationsMessageResponse,
	ConversationsOpenResponse,
	ConversationsPersonResponse,
	ConversationsReadResponse,
	ConversationsSendParams,
	ConversationsSendResponse,
	ConversationsSummaryResponse
} from "$lib/shared/sockets/conversations"

export const CONVERSATIONS_CONTEXT = "conversationsCtx"

/** One conversation's loaded messages, oldest first. */
export interface ConversationPage {
	messages: ConversationMessageRow[]
	/** Older messages exist before the first loaded one. */
	hasEarlier: boolean
}

export interface ConversationsDeps {
	systemSettings: SystemSettingsCtx
	userCtx: { user: SelectUser | undefined }
}

/** How long a list row's excerpt is when the client writes one itself. */
const EXCERPT_LENGTH = 140

let requestSeq = 0
/**
 * A send's correlation id. Not `crypto.randomUUID`: that exists only in a
 * secure context, and a pub reached over LAN http is not one.
 */
function nextRequestId(): string {
	requestSeq += 1
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${requestSeq}`
}

function excerptOf(body: string): string {
	const flat = body.replace(/\s+/g, " ").trim()
	return flat.length > EXCERPT_LENGTH
		? `${flat.slice(0, EXCERPT_LENGTH - 1)}…`
		: flat
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
	if (a.length !== b.length) return false
	const sa = [...a].sort((x, y) => x - y)
	const sb = [...b].sort((x, y) => x - y)
	return sa.every((v, i) => v === sb[i])
}

/** Newest activity first; a conversation with no message sorts by when it was made. */
function byRecent(a: ConversationSummary, b: ConversationSummary): number {
	const at = (c: ConversationSummary) => c.lastMessageAt ?? c.createdAt
	return at(b).localeCompare(at(a))
}

/** Subscribes (while messaging can exist) and sets the context. Call during a shell's init. */
export function provideConversations(
	deps: ConversationsDeps
): ConversationsCtx {
	const ctx = createConversations(deps)
	setContext(CONVERSATIONS_CONTEXT, ctx)
	return ctx
}

/** The context. Call during component initialisation. */
export function useConversations(): ConversationsCtx {
	return getContext<ConversationsCtx>(CONVERSATIONS_CONTEXT)
}

/** The state, the subscriptions and the listener sets. Call during component init. */
export function createConversations(deps: ConversationsDeps) {
	let conversations = $state<ConversationSummary[]>([])
	let loaded = $state(false)
	let people = $state<ConversationPerson[]>([])
	let peopleLoaded = $state(false)
	/** Loaded message pages, by conversation id. Each value is replaced, never mutated. */
	const pages = new SvelteMap<number, ConversationPage>()
	/** The conversation the Messages view has on screen (`setViewing`). */
	let viewingId = $state<number | null>(null)
	/** The person whose detail the Messages view has on screen. */
	let viewingPersonId = $state<number | null>(null)

	const messageListeners = new Set<(push: ConversationsMessagePush) => void>()
	const changedListeners = new Set<(push: ConversationsChangedPush) => void>()

	let me = $derived<number | null>(deps.userCtx.user?.id ?? null)
	let enabled = $derived(
		!!deps.userCtx.user &&
			!!deps.systemSettings.settings?.isAccountsEnabled &&
			deps.systemSettings.settings?.messagingEnabled !== false &&
			!deps.systemSettings.settings?.isAndroidWrapper
	)

	/** Unmuted conversations with something unread. */
	let unreadIds = $derived(
		conversations
			.filter((c) => c.unread > 0 && !c.mutedAt)
			.map((c) => c.id)
	)
	/** Unread messages across unmuted conversations: the rail dot's count. */
	let unreadTotal = $derived(
		conversations.reduce(
			(sum, c) => (c.mutedAt ? sum : sum + Math.max(0, c.unread)),
			0
		)
	)

	// ── state updates ───────────────────────────────────────────────────────

	function upsertSummary(summary: ConversationSummary) {
		const i = conversations.findIndex((c) => c.id === summary.id)
		const next =
			i === -1
				? [...conversations, summary]
				: conversations.map((c, j) => (j === i ? summary : c))
		conversations = next.sort(byRecent)
	}

	function dropConversation(conversationId: number) {
		conversations = conversations.filter((c) => c.id !== conversationId)
		pages.delete(conversationId)
	}

	/** Put a message into its loaded page, replacing a row with its id. */
	function upsertMessage(row: ConversationMessageRow) {
		const page = pages.get(row.conversationId)
		if (!page) return
		const i = page.messages.findIndex((m) => m.id === row.id)
		const messages =
			i === -1
				? [...page.messages, row].sort((a, b) => a.id - b.id)
				: page.messages.map((m, j) => (j === i ? row : m))
		pages.set(row.conversationId, { ...page, messages })
	}

	/**
	 * A new message moves its conversation to the top and becomes its excerpt.
	 * Unread grows only for someone else's message in a conversation not on
	 * screen; the view marks the one on screen read itself.
	 */
	function noteNewMessage(row: ConversationMessageRow, countUnread: boolean) {
		const summary = conversations.find((c) => c.id === row.conversationId)
		if (!summary) {
			// A conversation this person was just added to: the list knows it.
			refresh()
			return
		}
		const alreadyNewer =
			summary.lastMessageAt !== null &&
			summary.lastMessageAt > row.createdAt
		const mine = me !== null && row.authorUserId === me
		const bump =
			countUnread && !mine && viewingId !== row.conversationId ? 1 : 0
		upsertSummary({
			...summary,
			lastMessage: alreadyNewer
				? summary.lastMessage
				: {
						authorUserId: row.authorUserId,
						excerpt: excerptOf(row.body),
						at: row.createdAt
					},
			lastMessageAt: alreadyNewer ? summary.lastMessageAt : row.createdAt,
			unread: summary.unread + bump
		})
	}

	function reset() {
		conversations = []
		loaded = false
		people = []
		peopleLoaded = false
		pages.clear()
	}

	// ── socket handlers ─────────────────────────────────────────────────────

	function handleList(msg: SocketEventMap["conversations:list"]["response"]) {
		conversations = [...msg.conversations].sort(byRecent)
		loaded = true
	}

	function handleListError() {
		// Nothing to show for: the switch was turned off, or the server is
		// restarting. The list stays as it was; a reconnect asks again.
		loaded = true
	}

	function handleMessage(push: ConversationsMessagePush) {
		upsertMessage(push.message)
		if (push.change === "new") noteNewMessage(push.message, true)
		for (const listener of messageListeners) listener(push)
	}

	/** Every tab of the sender hears its own send: the same row, never counted unread. */
	function handleSend(msg: ConversationsSendResponse) {
		upsertMessage(msg.message)
		noteNewMessage(msg.message, false)
	}

	function handleEdited(msg: ConversationsMessageResponse) {
		upsertMessage(msg.message)
	}

	function handleChanged(push: ConversationsChangedPush) {
		if (push.removed) {
			dropConversation(push.conversationId)
			if (viewingId === push.conversationId) viewingId = null
		} else refresh()
		for (const listener of changedListeners) listener(push)
	}

	/** Another tab (or this one) read up to a message: nothing unread here any more. */
	function handleRead(msg: ConversationsReadResponse) {
		const summary = conversations.find((c) => c.id === msg.conversationId)
		if (summary && summary.unread !== 0)
			upsertSummary({ ...summary, unread: 0 })
	}

	function handleSummary(msg: ConversationsSummaryResponse) {
		upsertSummary(msg.conversation)
	}

	function handleLeave(msg: ConversationsLeaveResponse) {
		dropConversation(msg.conversationId)
		if (viewingId === msg.conversationId) viewingId = null
	}

	// ── held interests ──────────────────────────────────────────────────────

	let releaseList: () => void = () => {}

	/** Ask for the list again. A no-op while messaging cannot exist. */
	function refresh(): void {
		if (!enabled) return
		releaseList()
		releaseList = requestWithInterest<"conversations:list">(
			"conversations:list",
			{},
			handleList
		)
	}

	$effect(() => {
		if (!enabled) {
			untrack(reset)
			return
		}
		const releases = [
			declareInterest<"conversations:list:error">(
				"conversations:list:error",
				handleListError
			),
			declareInterest<"conversations:message">(
				"conversations:message",
				handleMessage
			),
			declareInterest<"conversations:changed">(
				"conversations:changed",
				handleChanged
			),
			declareInterest<"conversations:send">("conversations:send", handleSend),
			declareInterest<"conversations:edit">(
				"conversations:edit",
				handleEdited
			),
			declareInterest<"conversations:remove">(
				"conversations:remove",
				handleEdited
			),
			declareInterest<"conversations:read">("conversations:read", handleRead),
			declareInterest<"conversations:rename">(
				"conversations:rename",
				handleSummary
			),
			declareInterest<"conversations:addMembers">(
				"conversations:addMembers",
				handleSummary
			),
			declareInterest<"conversations:removeMember">(
				"conversations:removeMember",
				handleSummary
			),
			declareInterest<"conversations:mute">(
				"conversations:mute",
				handleSummary
			),
			declareInterest<"conversations:leave">(
				"conversations:leave",
				handleLeave
			),
			onConnect(() => refresh())
		]
		untrack(refresh)
		return () => {
			for (const release of releases) release()
			releaseList()
			releaseList = () => {}
		}
	})

	// ── requests ────────────────────────────────────────────────────────────

	/** One request, settled by its own reply (`awaitReply`). */
	function ask<K extends InterestEvent>(
		event: K,
		params: SocketEventMap[K]["params"],
		match: (data: SocketEventMap[K]["response"]) => boolean
	): Promise<SocketEventMap[K]["response"]> {
		const socket = typedSocketOrNull()
		if (!socket || !enabled)
			return Promise.reject(new Error("Messages aren't available right now."))
		return awaitReply({
			socket,
			event,
			params,
			errorEvent: `${event}:error` as InterestEvent,
			match
		})
	}

	/**
	 * Load a conversation's newest page, or (with `before`) the page before
	 * that message id, prepended to what is loaded.
	 */
	async function open(
		conversationId: number,
		before?: number
	): Promise<ConversationsOpenResponse> {
		const reply = await ask(
			"conversations:open",
			{ conversationId, ...(before !== undefined ? { before } : {}) },
			(r) => r.conversationId === conversationId
		)
		const loadedPage = pages.get(conversationId)
		if (before !== undefined && loadedPage) {
			const have = new Set(loadedPage.messages.map((m) => m.id))
			pages.set(conversationId, {
				messages: [
					...reply.messages.filter((m) => !have.has(m.id)),
					...loadedPage.messages
				].sort((a, b) => a.id - b.id),
				hasEarlier: reply.hasEarlier
			})
		} else {
			pages.set(conversationId, {
				messages: [...reply.messages].sort((a, b) => a.id - b.id),
				hasEarlier: reply.hasEarlier
			})
		}
		return reply
	}

	/**
	 * Start a conversation with `userIds` (the asker is always a member). One
	 * id and no name is a direct conversation, which the server returns as it
	 * is when the pair already has one (`existing`).
	 */
	async function create(
		userIds: number[],
		name?: string
	): Promise<ConversationsCreateResponse> {
		const wanted = me === null ? userIds : [...new Set([...userIds, me])]
		const reply = await ask(
			"conversations:create",
			{ userIds, ...(name ? { name } : {}) },
			(r) =>
				sameIds(
					r.conversation.members.map((m) => m.id),
					wanted
				)
		)
		upsertSummary(reply.conversation)
		return reply
	}

	/** Send a message; resolves with the stored row (matched by `requestId`). */
	async function send(
		params: Omit<ConversationsSendParams, "requestId">
	): Promise<ConversationsSendResponse> {
		const requestId = nextRequestId()
		const reply = await ask(
			"conversations:send",
			{ ...params, requestId },
			(r) => r.requestId === requestId
		)
		handleSend(reply)
		return reply
	}

	async function edit(
		messageId: number,
		body: string
	): Promise<ConversationsMessageResponse> {
		const reply = await ask(
			"conversations:edit",
			{ messageId, body },
			(r) => r.message.id === messageId
		)
		upsertMessage(reply.message)
		return reply
	}

	async function remove(
		messageId: number
	): Promise<ConversationsMessageResponse> {
		const reply = await ask(
			"conversations:remove",
			{ messageId },
			(r) => r.message.id === messageId
		)
		upsertMessage(reply.message)
		return reply
	}

	/**
	 * Mark a conversation read up to a message id. Fire and forget: the count
	 * clears here at once, and the reply clears it in every other tab.
	 */
	function markRead(conversationId: number, upTo: number): void {
		const summary = conversations.find((c) => c.id === conversationId)
		if (summary && summary.unread !== 0)
			upsertSummary({ ...summary, unread: 0 })
		if (!enabled) return
		typedSocketOrNull()?.emit("conversations:read", { conversationId, upTo })
	}

	const bySummary =
		(conversationId: number) => (r: ConversationsSummaryResponse) =>
			r.conversation.id === conversationId

	async function rename(conversationId: number, name: string) {
		const reply = await ask(
			"conversations:rename",
			{ conversationId, name },
			bySummary(conversationId)
		)
		upsertSummary(reply.conversation)
		return reply
	}

	async function addMembers(conversationId: number, userIds: number[]) {
		const reply = await ask(
			"conversations:addMembers",
			{ conversationId, userIds },
			bySummary(conversationId)
		)
		upsertSummary(reply.conversation)
		return reply
	}

	async function removeMember(conversationId: number, userId: number) {
		const reply = await ask(
			"conversations:removeMember",
			{ conversationId, userId },
			bySummary(conversationId)
		)
		upsertSummary(reply.conversation)
		return reply
	}

	async function leave(conversationId: number) {
		const reply = await ask(
			"conversations:leave",
			{ conversationId },
			(r) => r.conversationId === conversationId
		)
		handleLeave(reply)
		return reply
	}

	async function mute(conversationId: number, muted: boolean) {
		const reply = await ask(
			"conversations:mute",
			{ conversationId, muted },
			bySummary(conversationId)
		)
		upsertSummary(reply.conversation)
		return reply
	}

	/** The roster to pick from: every other account on the pub. */
	async function loadPeople(): Promise<ConversationPerson[]> {
		const reply = await ask("conversations:people", {}, () => true)
		people = reply.people
		peopleLoaded = true
		return reply.people
	}

	/** One person's detail as this member sees them (§6.6). */
	function person(userId: number): Promise<ConversationsPersonResponse> {
		return ask(
			"conversations:person",
			{ userId },
			(r) => r.person.id === userId
		)
	}

	/** What may be attached to a message here (the attachment gate, §5). */
	function attachable(
		params: ConversationsAttachableParams
	): Promise<ConversationsAttachableResponse> {
		return ask("conversations:attachable", params, (r) => r.kind === params.kind)
	}

	/** A member or roster person by id, from what is already loaded. */
	function whoIs(userId: number | null): ConversationPerson | null {
		if (userId === null) return null
		for (const c of conversations) {
			const m = c.members.find((p) => p.id === userId)
			if (m) return m
		}
		return people.find((p) => p.id === userId) ?? null
	}

	function listen<T>(set: Set<T>, listener: T): () => void {
		set.add(listener)
		return () => {
			set.delete(listener)
		}
	}

	return {
		/** Messaging can exist for this person here (accounts, the switch, not Android). */
		get enabled() {
			return enabled
		},
		/** The person's conversations, newest activity first. */
		get conversations() {
			return conversations
		},
		/** True after the first list reply (or its refusal). */
		get loaded() {
			return loaded
		},
		/** The roster from `loadPeople()`. */
		get people() {
			return people
		},
		get peopleLoaded() {
			return peopleLoaded
		},
		/** Unread messages across unmuted conversations (the rail dot). */
		get unreadTotal() {
			return unreadTotal
		},
		/** Unmuted conversations with something unread. */
		get unreadIds() {
			return unreadIds
		},
		/** The conversation the Messages view has on screen. */
		get viewingId() {
			return viewingId
		},
		/** The person whose detail the Messages view has on screen. */
		get viewingPersonId() {
			return viewingPersonId
		},
		/**
		 * The Messages view's address: `/messages/<id>`, `/messages/people/<id>`
		 * or `/messages` (Focus, the viewing snapshot).
		 */
		get address() {
			return messagesHref({
				conversationId: viewingId,
				personId: viewingPersonId
			})
		},
		/** A loaded conversation's messages, or undefined before `open`. */
		messagesOf(conversationId: number): ConversationPage | undefined {
			return pages.get(conversationId)
		},
		summaryOf(conversationId: number): ConversationSummary | undefined {
			return conversations.find((c) => c.id === conversationId)
		},
		/**
		 * The view says which conversation is on screen (null for none). A
		 * message arriving there does not count as unread.
		 */
		setViewing(conversationId: number | null) {
			viewingId = conversationId
			if (conversationId !== null) viewingPersonId = null
		},
		/** The view says whose detail is on screen (null for none). */
		setViewingPerson(userId: number | null) {
			viewingPersonId = userId
			if (userId !== null) viewingId = null
		},
		whoIs,
		refresh,
		open,
		create,
		send,
		edit,
		remove,
		markRead,
		rename,
		addMembers,
		removeMember,
		leave,
		mute,
		loadPeople,
		person,
		attachable,
		/** Every message push, after the state is updated. Returns the release. */
		addMessageListener: (listener: (push: ConversationsMessagePush) => void) =>
			listen(messageListeners, listener),
		/** Every changed push, after the state is updated. Returns the release. */
		addChangedListener: (listener: (push: ConversationsChangedPush) => void) =>
			listen(changedListeners, listener)
	}
}

export type ConversationsCtx = ReturnType<typeof createConversations>

/** Runs `listener` for every message push while the calling view is mounted. */
export function onMessage(
	listener: (push: ConversationsMessagePush) => void
): void {
	const ctx = useConversations()
	$effect(() => ctx.addMessageListener(listener))
}

/** Runs `listener` for every changed push while the calling view is mounted. */
export function onChanged(
	listener: (push: ConversationsChangedPush) => void
): void {
	const ctx = useConversations()
	$effect(() => ctx.addChangedListener(listener))
}
