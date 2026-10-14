/**
 * The `conversations:` family — private messages between people on one pub
 * (PLAN-private-messages-2026-10-12 §4; types: `shared/sockets/conversations.ts`).
 *
 * Every request replies on its own event name to every tab of the asker, and
 * refuses as `<event>:error { error }` to the asking socket only (`refusable`).
 * The store scopes every read and write by membership and words every refusal;
 * these handlers only unpack the socket. Pushes (`conversations:message`,
 * `conversations:changed`) go out from the store through `pushToUser`.
 */
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import type {
	ConversationsAddMembersParams,
	ConversationsAttachableParams,
	ConversationsAttachableResponse,
	ConversationsCreateParams,
	ConversationsCreateResponse,
	ConversationsEditParams,
	ConversationsLeaveParams,
	ConversationsLeaveResponse,
	ConversationsListParams,
	ConversationsListResponse,
	ConversationsMessageResponse,
	ConversationsMuteParams,
	ConversationsOpenParams,
	ConversationsOpenResponse,
	ConversationsPeopleParams,
	ConversationsPeopleResponse,
	ConversationsPersonParams,
	ConversationsPersonResponse,
	ConversationsReadParams,
	ConversationsReadResponse,
	ConversationsRemoveMemberParams,
	ConversationsRemoveParams,
	ConversationsRenameParams,
	ConversationsSendParams,
	ConversationsSendResponse,
	ConversationsSummaryResponse
} from "$lib/shared/sockets/conversations"
import * as store from "$lib/server/conversations/store"
import { askerOf, refusable } from "./refusable"

const dbh = () => db as unknown as Db

const conversationOf = (raw: unknown) => {
	const id = (raw as { conversationId?: unknown } | undefined)?.conversationId
	return Number.isInteger(id) ? { conversationId: id as number } : {}
}

export const conversationsList: Handler<ConversationsListParams, ConversationsListResponse> =
	refusable(
		"conversations:list",
		async (socket, _params, emitToUser) => {
			const res: ConversationsListResponse = {
				conversations: await store.listFor(dbh(), socket.user!.id)
			}
			emitToUser("conversations:list", res)
			return res
		},
		"Your conversations could not be loaded."
	)

export const conversationsOpen: Handler<ConversationsOpenParams, ConversationsOpenResponse> =
	refusable(
		"conversations:open",
		async (socket, params, emitToUser) => {
			const res: ConversationsOpenResponse = await store.open(dbh(), socket.user!.id, params)
			emitToUser("conversations:open", res)
			return res
		},
		"That conversation could not be opened.",
		undefined,
		conversationOf
	)

export const conversationsCreate: Handler<ConversationsCreateParams, ConversationsCreateResponse> =
	refusable(
		"conversations:create",
		async (socket, params, emitToUser) => {
			const res: ConversationsCreateResponse = await store.create(
				dbh(),
				socket.user!.id,
				params
			)
			emitToUser("conversations:create", res)
			return res
		},
		"The conversation could not be started."
	)

export const conversationsSend: Handler<ConversationsSendParams, ConversationsSendResponse> =
	refusable(
		"conversations:send",
		async (socket, params, emitToUser) => {
			const sent = await store.send(dbh(), socket.user!.id, params)
			const res: ConversationsSendResponse = { ...sent, ...askerOf(params) }
			emitToUser("conversations:send", res)
			return res
		},
		"The message could not be sent.",
		undefined,
		(raw) => ({ ...conversationOf(raw), ...askerOf(raw) })
	)

export const conversationsEdit: Handler<ConversationsEditParams, ConversationsMessageResponse> =
	refusable(
		"conversations:edit",
		async (socket, params, emitToUser) => {
			const res: ConversationsMessageResponse = await store.edit(dbh(), socket.user!.id, params)
			emitToUser("conversations:edit", res)
			return res
		},
		"The message could not be changed."
	)

export const conversationsRemove: Handler<ConversationsRemoveParams, ConversationsMessageResponse> =
	refusable(
		"conversations:remove",
		async (socket, params, emitToUser) => {
			const res: ConversationsMessageResponse = await store.remove(
				dbh(),
				socket.user!.id,
				params
			)
			emitToUser("conversations:remove", res)
			return res
		},
		"The message could not be removed."
	)

export const conversationsRead: Handler<ConversationsReadParams, ConversationsReadResponse> =
	refusable(
		"conversations:read",
		async (socket, params, emitToUser) => {
			const res: ConversationsReadResponse = await store.markRead(
				dbh(),
				socket.user!.id,
				params
			)
			emitToUser("conversations:read", res)
			return res
		},
		"The conversation could not be marked read.",
		undefined,
		conversationOf
	)

function summaryVerb<P>(
	event: string,
	run: (db: Db, userId: number, params: P) => Promise<ConversationsSummaryResponse["conversation"]>,
	fallback: string
): Handler<P, ConversationsSummaryResponse> {
	return refusable(
		event,
		async (socket, params: P, emitToUser) => {
			const res: ConversationsSummaryResponse = {
				conversation: await run(dbh(), socket.user!.id, params)
			}
			emitToUser(event, res)
			return res
		},
		fallback,
		undefined,
		conversationOf
	)
}

export const conversationsRename = summaryVerb<ConversationsRenameParams>(
	"conversations:rename",
	store.rename,
	"The conversation could not be renamed."
)
export const conversationsAddMembers = summaryVerb<ConversationsAddMembersParams>(
	"conversations:addMembers",
	store.addMembers,
	"Those people could not be added."
)
export const conversationsRemoveMember = summaryVerb<ConversationsRemoveMemberParams>(
	"conversations:removeMember",
	store.removeMember,
	"That person could not be removed."
)
export const conversationsMute = summaryVerb<ConversationsMuteParams>(
	"conversations:mute",
	store.mute,
	"The conversation could not be muted."
)

export const conversationsLeave: Handler<ConversationsLeaveParams, ConversationsLeaveResponse> =
	refusable(
		"conversations:leave",
		async (socket, params, emitToUser) => {
			const { conversationId } = await store.leave(dbh(), socket.user!.id, params)
			const res: ConversationsLeaveResponse = { conversationId, left: true }
			emitToUser("conversations:leave", res)
			return res
		},
		"You could not leave the conversation.",
		undefined,
		conversationOf
	)

export const conversationsPeople: Handler<ConversationsPeopleParams, ConversationsPeopleResponse> =
	refusable(
		"conversations:people",
		async (socket, _params, emitToUser) => {
			const res: ConversationsPeopleResponse = {
				people: await store.people(dbh(), socket.user!.id)
			}
			emitToUser("conversations:people", res)
			return res
		},
		"The people on this pub could not be loaded."
	)

export const conversationsAttachable: Handler<
	ConversationsAttachableParams,
	ConversationsAttachableResponse
> = refusable(
	"conversations:attachable",
	async (socket, params, emitToUser) => {
		const res: ConversationsAttachableResponse = await store.attachable(
			dbh(),
			socket.user!.id,
			params
		)
		emitToUser("conversations:attachable", res)
		return res
	},
	"What you can attach could not be loaded.",
	undefined,
	conversationOf
)

export const conversationsPerson: Handler<ConversationsPersonParams, ConversationsPersonResponse> =
	refusable(
		"conversations:person",
		async (socket, params, emitToUser) => {
			const res: ConversationsPersonResponse = await store.person(
				dbh(),
				socket.user!.id,
				params
			)
			emitToUser("conversations:person", res)
			return res
		},
		"That person's detail could not be loaded."
	)

export function registerConversationHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	for (const handler of [
		conversationsList,
		conversationsOpen,
		conversationsCreate,
		conversationsSend,
		conversationsEdit,
		conversationsRemove,
		conversationsRead,
		conversationsRename,
		conversationsAddMembers,
		conversationsRemoveMember,
		conversationsLeave,
		conversationsMute,
		conversationsPeople,
		conversationsAttachable,
		conversationsPerson
	])
		register(socket, handler as Handler<any, any>, emitToUser)
}
