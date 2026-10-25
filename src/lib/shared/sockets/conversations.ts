/**
 * The `conversations:` socket family — private messages between people on one
 * pub (PLAN-private-messages-2026-10-12). Types shared by the server handlers
 * (`server/sockets/conversations.ts`) and the client's typed-socket map, kept
 * out of the big `Sockets` namespace like `notifications.ts`.
 *
 * Every request replies on its own event name to every tab of the asker;
 * refusals go out as `<event>:error { error }` to the asking socket only.
 * Membership is the only authority: ids are guessable integers, and a
 * non-member gets one wording so a refusal never confirms a conversation exists.
 *
 * Vocabulary (ruled 2026-10-12): **conversation** (direct | group), **message**
 * (`conversation_messages`), **attachment** (a session, character, lorebook or
 * file carried with a message), **share** (the explicit read grant on a
 * character or lorebook), **host** (a group's creator), **people** (the roster).
 */

/** A member as every other member sees them. */
export interface ConversationPerson {
	id: number
	username: string
	displayName: string | null
	isAdmin?: boolean
	/** The account's avatar (`users.avatar_media_id`); drawn by id. Absent
	 *  from a payload that did not read it. */
	avatarMediaId?: number | null
}

export type ConversationKind = "direct" | "group"

export type ConversationAttachmentKind =
	| "session"
	| "character"
	| "lorebook"
	| "file"

/** What the sender asks to carry. */
export interface ConversationAttachmentPick {
	kind: ConversationAttachmentKind
	subjectId: number
}

/**
 * An attachment as the **asking reader** may see it. `available: false` means
 * the gate refused this reader (not shared with them, or the subject is gone);
 * the card is drawn dimmed with `unavailableWhy`.
 */
export type ConversationAttachmentCard =
	| {
			id: number
			kind: "session"
			subjectId: number
			available: true
			title: string
			/** The genre's display name. */
			subtitle: string | null
			/** Up to three cast faces: `/media/<uuid>` thumbs or null for an initial. */
			faces: { name: string; src: string | null }[]
	  }
	| {
			id: number
			kind: "character"
			subjectId: number
			available: true
			title: string
			subtitle: string | null
			avatarSrc: string | null
			isPersona: boolean
	  }
	| {
			id: number
			kind: "lorebook"
			subjectId: number
			available: true
			title: string
			/** "12 entries" */
			subtitle: string | null
	  }
	| {
			id: number
			kind: "file"
			subjectId: number
			available: true
			title: string
			/** "PNG · 1.2 MB" */
			subtitle: string | null
			/** `/media/<uuid>?r=` — the display variant. */
			src: string
			/** The thumb variant, for images. */
			thumbSrc: string | null
			mime: string
			bytes: number
			isImage: boolean
	  }
	| {
			id: number
			kind: ConversationAttachmentKind
			subjectId: number
			available: false
			unavailableWhy: "not-shared" | "gone"
	  }

export interface ConversationMessageRow {
	id: number
	conversationId: number
	/** Null once the author's account is deleted ("Former member"). */
	authorUserId: number | null
	body: string
	isEdited: boolean
	/** A tombstone: body is empty and the row reads "Message removed". */
	deletedAt: string | null
	createdAt: string
	updatedAt: string
	attachments: ConversationAttachmentCard[]
}

/** A row of the Messages list column. */
export interface ConversationSummary {
	id: number
	kind: ConversationKind
	/** Group name; null for a direct conversation (the client shows the other person). */
	name: string | null
	hostUserId: number | null
	/** Every member, the asker included. */
	members: ConversationPerson[]
	lastMessage: {
		authorUserId: number | null
		excerpt: string
		at: string
	} | null
	/** Messages after the asker's read marker, not their own. */
	unread: number
	mutedAt: string | null
	lastMessageAt: string | null
	createdAt: string
}

// ── Requests ────────────────────────────────────────────────────────────────

export interface ConversationsListParams {}
export interface ConversationsListResponse {
	conversations: ConversationSummary[]
}

export interface ConversationsOpenParams {
	conversationId: number
	/** Page backwards: messages with id < before. */
	before?: number
	/** Default 50, max 100. */
	limit?: number
}
export interface ConversationsOpenResponse {
	conversationId: number
	messages: ConversationMessageRow[]
	/** True when older messages exist before the first returned. */
	hasEarlier: boolean
}

export interface ConversationsCreateParams {
	/** The other people; the asker is always a member. One id and no name → direct. */
	userIds: number[]
	name?: string
}
export interface ConversationsCreateResponse {
	conversation: ConversationSummary
	/** True when a direct conversation already existed and was returned. */
	existing: boolean
}

export interface ConversationsSendParams {
	conversationId: number
	body: string
	attachments?: ConversationAttachmentPick[]
	/** Ready tray items (uploads) to carry as `file` attachments. */
	trayItemIds?: string[]
	/** Echoed in the reply so the composer can match its own send. */
	requestId?: string
}
export interface ConversationsSendResponse {
	conversationId: number
	message: ConversationMessageRow
	requestId?: string
}

export interface ConversationsEditParams {
	messageId: number
	body: string
}
export interface ConversationsRemoveParams {
	messageId: number
}
/** `edit` and `remove` answer with the changed row. */
export interface ConversationsMessageResponse {
	conversationId: number
	message: ConversationMessageRow
}

export interface ConversationsReadParams {
	conversationId: number
	/** The highest message id now seen. */
	upTo: number
}
export interface ConversationsReadResponse {
	conversationId: number
	lastReadMessageId: number
}

export interface ConversationsRenameParams {
	conversationId: number
	name: string
}
export interface ConversationsAddMembersParams {
	conversationId: number
	userIds: number[]
}
export interface ConversationsRemoveMemberParams {
	conversationId: number
	userId: number
}
export interface ConversationsLeaveParams {
	conversationId: number
}
export interface ConversationsMuteParams {
	conversationId: number
	muted: boolean
}
/** rename · addMembers · removeMember · mute answer with the fresh summary. */
export interface ConversationsSummaryResponse {
	conversation: ConversationSummary
}
export interface ConversationsLeaveResponse {
	conversationId: number
	left: true
}

export interface ConversationsPeopleParams {}
export interface ConversationsPeopleResponse {
	/** Every other non-deleted account on the pub (ruled 2026-10-12 Q2). */
	people: ConversationPerson[]
}

export interface ConversationsAttachableParams {
	/** Omit while composing a new conversation: gate for the picked `userIds` instead. */
	conversationId?: number
	userIds?: number[]
	kind: Exclude<ConversationAttachmentKind, "file">
	q?: string
}
export interface ConversationsAttachableResponse {
	kind: ConversationAttachmentKind
	candidates: ConversationAttachmentCard[]
}

/** One person's detail as another member sees it (§6.6). */
export interface ConversationsPersonParams {
	userId: number
}
export interface ConversationsPersonResponse {
	person: ConversationPerson
	/** Owned by them, in which the asker is owner or guest. */
	sessions: { id: number; title: string; subtitle: string | null; faces: { name: string; src: string | null }[] }[]
	/** Owned by them and visible to the asker (shared, or cast in a shared session). */
	characters: { id: number; title: string; subtitle: string | null; avatarSrc: string | null; isPersona: boolean }[]
	/** Owned by them and shared with the asker. */
	lorebooks: { id: number; title: string; subtitle: string | null }[]
	/** The direct conversation between the two, if one exists. */
	directConversationId: number | null
}

// ── Pushes ──────────────────────────────────────────────────────────────────

/** A new, edited or removed message in a conversation the receiver is in. */
export interface ConversationsMessagePush {
	conversationId: number
	message: ConversationMessageRow
	change: "new" | "edited" | "removed"
}

/** Membership, name or host changed, or the receiver was removed/left: re-list. */
export interface ConversationsChangedPush {
	conversationId: number
	/** Set when the receiver is not a member any more. */
	removed?: true
}

// ── Shares (characters / lorebooks) ─────────────────────────────────────────

export interface CharactersShareParams {
	characterId: number
	/** Replace-set: the full list of recipients after this call. */
	userIds: number[]
}
export interface CharactersShareResponse {
	characterId: number
	sharedWith: ConversationPerson[]
}
export interface LorebooksShareParams {
	lorebookId: number
	userIds: number[]
}
export interface LorebooksShareResponse {
	lorebookId: number
	sharedWith: ConversationPerson[]
}

/** The one wording for every membership refusal. */
export const CONVERSATION_NOT_FOUND = "That conversation isn't available."
export const MESSAGING_OFF = "Messages between people are turned off on this pub."
export const CONVERSATION_BODY_MAX = 8_000
export const CONVERSATION_PAGE_DEFAULT = 50
export const CONVERSATION_PAGE_MAX = 100
