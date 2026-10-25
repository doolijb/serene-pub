/**
 * Private **conversations** between people on one pub — the store
 * (PLAN-private-messages-2026-10-12 §4).
 *
 * Membership is the ONLY authority. Ids are guessable integers, so every read
 * and write is scoped by a member row for the asker, and a non-member hears
 * `CONVERSATION_NOT_FOUND` — the same sentence as an id that never existed.
 * Administrators get no bypass.
 *
 * Everything refuses while `system_settings.messaging_enabled` is off
 * (`MESSAGING_OFF`) or accounts are off (a single-user pub has nobody to write
 * to). Data stays either way.
 *
 * `db` is passed in, never imported: a test hands its own, and the one
 * transaction (`send`) runs through `tx` only. The attachment gate reads
 * through the app handle, so it runs BEFORE that transaction (§5's race — a
 * guest removed between gate and commit — is the same race the picker has).
 */
import {
	and,
	asc,
	count,
	desc,
	eq,
	ilike,
	inArray,
	isNull,
	lt,
	ne,
	or,
	sql
} from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	CONVERSATION_BODY_MAX,
	CONVERSATION_NOT_FOUND,
	CONVERSATION_PAGE_DEFAULT,
	CONVERSATION_PAGE_MAX,
	MESSAGING_OFF,
	type ConversationAttachmentCard,
	type ConversationAttachmentKind,
	type ConversationAttachmentPick,
	type ConversationMessageRow,
	type ConversationPerson,
	type ConversationSummary,
	type ConversationsAttachableParams,
	type ConversationsMessagePush,
	type ConversationsPersonResponse
} from "$lib/shared/sockets/conversations"
import {
	CONVERSATION_MESSAGE,
	conversationHref,
	regardingFor
} from "$lib/shared/notifications/kinds"
import {
	clearNotifications,
	raiseNotification
} from "$lib/server/notifications/store"
import { pushToUser } from "$lib/server/sockets/utils/userPush"
import { canViewCharacter } from "$lib/server/utils/sessionAccess"
import { canViewLorebook } from "$lib/server/utils/ownedBook"
import { SessionTypes } from "$lib/shared/constants/SessionTypes"
import {
	attachmentCardFor,
	canAttach,
	excerptOf,
	isAttachmentKind,
	joinNames,
	mediaSrc
} from "./gate"

const C = schema.conversations
const M = schema.conversationMembers
const CM = schema.conversationMessages
const CA = schema.conversationAttachments
const U = schema.users

export const ACCOUNTS_OFF = "Accounts are disabled on this pub."
export const PERSON_NOT_AVAILABLE = "That person isn't available."
export const BODY_TOO_LONG = `A message can be at most ${CONVERSATION_BODY_MAX.toLocaleString("en-US")} characters.`
export const BODY_EMPTY = "Write something, or attach something, to send."
export const NOT_HOST = "Only the conversation's host can do that."
export const NOT_GROUP = "Only a group conversation can do that."
export const ATTACHMENT_GONE = "An attachment is no longer available. Send without it."
export const PICKS_MAX = 10
export const NAME_MAX = 100
export const ATTACHABLE_MAX = 25
export const PERSON_TAB_MAX = 100

/* --- guards ------------------------------------------------------------ */

/** Throws unless accounts and messaging are both on. */
export async function assertMessagingOn(db: Db): Promise<void> {
	const [s] = await db
		.select({
			accounts: schema.systemSettings.isAccountsEnabled,
			messaging: schema.systemSettings.messagingEnabled
		})
		.from(schema.systemSettings)
		.where(eq(schema.systemSettings.id, 1))
		.limit(1)
	if (!s?.accounts) throw new Error(ACCOUNTS_OFF)
	if (!s.messaging) throw new Error(MESSAGING_OFF)
}

type MemberRow = typeof M.$inferSelect
type ConversationRow = typeof C.$inferSelect
type MessageRecord = typeof CM.$inferSelect

/** The asker's member row and the conversation, or `CONVERSATION_NOT_FOUND`. */
async function requireMember(
	db: Db,
	conversationId: unknown,
	userId: number
): Promise<{ member: MemberRow; conversation: ConversationRow }> {
	if (!Number.isInteger(conversationId)) throw new Error(CONVERSATION_NOT_FOUND)
	const [row] = await db
		.select({ member: M, conversation: C })
		.from(M)
		.innerJoin(C, eq(C.id, M.conversationId))
		.where(
			and(eq(M.conversationId, conversationId as number), eq(M.userId, userId))
		)
		.limit(1)
	if (!row) throw new Error(CONVERSATION_NOT_FOUND)
	return row
}

async function memberIdsOf(db: Db, conversationId: number): Promise<number[]> {
	const rows = await db
		.select({ userId: M.userId })
		.from(M)
		.where(eq(M.conversationId, conversationId))
		.orderBy(asc(M.joinedAt), asc(M.userId))
	return rows.map((r) => r.userId)
}

/** The ids that are live accounts other than `userId` — the people roster's test. */
async function assertPeople(db: Db, userId: number, ids: unknown): Promise<number[]> {
	if (!Array.isArray(ids)) throw new Error(PERSON_NOT_AVAILABLE)
	const wanted = [...new Set(ids)]
	if (wanted.some((id) => !Number.isInteger(id) || id === userId))
		throw new Error(PERSON_NOT_AVAILABLE)
	if (!wanted.length) return []
	const rows = await db
		.select({ id: U.id })
		.from(U)
		.where(and(inArray(U.id, wanted as number[]), eq(U.isDeleted, false)))
	if (rows.length !== wanted.length) throw new Error(PERSON_NOT_AVAILABLE)
	return wanted as number[]
}

const personOf = (u: {
	id: number
	username: string
	displayName: string | null
	isAdmin: boolean
	avatarMediaId: number | null
}): ConversationPerson => ({
	id: u.id,
	username: u.username,
	displayName: u.displayName,
	isAdmin: u.isAdmin,
	avatarMediaId: u.avatarMediaId
})

const nameOf = (p: { username: string; displayName: string | null }) =>
	p.displayName?.trim() || p.username

/* --- summaries --------------------------------------------------------- */

function lastExcerpt(m: { body: string; deletedAt: Date | null }): string {
	if (m.deletedAt) return "Message removed"
	return excerptOf(m.body, 120) ?? "Sent an attachment"
}

/** The asker's summaries, newest activity first; `onlyIds` narrows. */
async function summariesFor(
	db: Db,
	userId: number,
	onlyIds?: number[]
): Promise<ConversationSummary[]> {
	const mine = await db
		.select()
		.from(M)
		.where(
			onlyIds
				? and(eq(M.userId, userId), inArray(M.conversationId, onlyIds))
				: eq(M.userId, userId)
		)
	if (!mine.length) return []
	const ids = mine.map((m) => m.conversationId)

	const [convs, people, lasts, unread] = await Promise.all([
		db.select().from(C).where(inArray(C.id, ids)),
		db
			.select({
				conversationId: M.conversationId,
				id: U.id,
				username: U.username,
				displayName: U.displayName,
				isAdmin: U.isAdmin,
				avatarMediaId: U.avatarMediaId
			})
			.from(M)
			.innerJoin(U, eq(U.id, M.userId))
			.where(inArray(M.conversationId, ids))
			.orderBy(asc(M.joinedAt), asc(U.id)),
		db
			.selectDistinctOn([CM.conversationId], {
				conversationId: CM.conversationId,
				authorUserId: CM.authorUserId,
				body: CM.body,
				deletedAt: CM.deletedAt,
				createdAt: CM.createdAt
			})
			.from(CM)
			.where(inArray(CM.conversationId, ids))
			.orderBy(CM.conversationId, desc(CM.id)),
		db
			.select({ conversationId: CM.conversationId, n: count() })
			.from(CM)
			.innerJoin(
				M,
				and(eq(M.conversationId, CM.conversationId), eq(M.userId, userId))
			)
			.where(
				and(
					inArray(CM.conversationId, ids),
					sql`${CM.id} > COALESCE(${M.lastReadMessageId}, 0)`,
					sql`${CM.authorUserId} IS DISTINCT FROM ${userId}`,
					isNull(CM.deletedAt)
				)
			)
			.groupBy(CM.conversationId)
	])

	const membersBy = new Map<number, ConversationPerson[]>()
	for (const p of people) {
		const list = membersBy.get(p.conversationId) ?? []
		list.push(personOf(p))
		membersBy.set(p.conversationId, list)
	}
	const lastBy = new Map(lasts.map((l) => [l.conversationId, l]))
	const unreadBy = new Map(unread.map((u) => [u.conversationId, u.n]))
	const mineBy = new Map(mine.map((m) => [m.conversationId, m]))

	return convs
		.map((c): ConversationSummary => {
			const last = lastBy.get(c.id)
			return {
				id: c.id,
				kind: c.kind as ConversationSummary["kind"],
				name: c.name,
				hostUserId: c.hostUserId,
				members: membersBy.get(c.id) ?? [],
				lastMessage: last
					? {
							authorUserId: last.authorUserId,
							excerpt: lastExcerpt(last),
							at: last.createdAt.toISOString()
						}
					: null,
				unread: unreadBy.get(c.id) ?? 0,
				mutedAt: mineBy.get(c.id)?.mutedAt?.toISOString() ?? null,
				lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
				createdAt: c.createdAt.toISOString()
			}
		})
		.sort((a, b) =>
			(b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)
		)
}

export async function listFor(db: Db, userId: number): Promise<ConversationSummary[]> {
	await assertMessagingOn(db)
	return summariesFor(db, userId)
}

/** One summary as `userId` sees it (they must be a member). */
export async function summaryFor(
	db: Db,
	userId: number,
	conversationId: number
): Promise<ConversationSummary> {
	const [s] = await summariesFor(db, userId, [conversationId])
	if (!s) throw new Error(CONVERSATION_NOT_FOUND)
	return s
}

/* --- message rows ------------------------------------------------------ */

type AttachmentRecord = typeof CA.$inferSelect

async function attachmentsByMessage(
	db: Db,
	messageIds: number[]
): Promise<Map<number, AttachmentRecord[]>> {
	const by = new Map<number, AttachmentRecord[]>()
	if (!messageIds.length) return by
	const rows = await db
		.select()
		.from(CA)
		.where(inArray(CA.messageId, messageIds))
		.orderBy(asc(CA.messageId), asc(CA.ordinal))
	for (const r of rows) {
		const list = by.get(r.messageId) ?? []
		list.push(r)
		by.set(r.messageId, list)
	}
	return by
}

/** A message as ONE reader sees it: its attachments gated for them (Q6). */
async function rowFor(
	db: Db,
	m: MessageRecord,
	attachments: AttachmentRecord[],
	viewerId: number
): Promise<ConversationMessageRow> {
	const cards: ConversationAttachmentCard[] = []
	for (const a of attachments)
		cards.push(
			await attachmentCardFor(
				a.kind as ConversationAttachmentKind,
				a.subjectId,
				viewerId,
				db,
				a.id
			)
		)
	return {
		id: m.id,
		conversationId: m.conversationId,
		authorUserId: m.authorUserId,
		body: m.body,
		isEdited: m.isEdited,
		deletedAt: m.deletedAt?.toISOString() ?? null,
		createdAt: m.createdAt.toISOString(),
		updatedAt: m.updatedAt.toISOString(),
		attachments: cards
	}
}

async function messageRowFor(
	db: Db,
	messageId: number,
	viewerId: number
): Promise<ConversationMessageRow> {
	const [m] = await db.select().from(CM).where(eq(CM.id, messageId)).limit(1)
	if (!m) throw new Error(CONVERSATION_NOT_FOUND)
	const atts = (await attachmentsByMessage(db, [m.id])).get(m.id) ?? []
	return rowFor(db, m, atts, viewerId)
}

/** Push a changed message to every member, each with their own cards. */
function pushMessage(
	db: Db,
	memberIds: number[],
	conversationId: number,
	messageId: number,
	change: ConversationsMessagePush["change"]
): void {
	for (const memberId of memberIds)
		pushToUser(memberId, "conversations:message", async () => {
			const payload: ConversationsMessagePush = {
				conversationId,
				message: await messageRowFor(db, messageId, memberId),
				change
			}
			return payload
		})
}

/** `conversations:changed` to each of `memberIds` (and `removed` to the gone). */
export function pushChangedTo(
	memberIds: number[],
	conversationId: number,
	removedIds: number[] = []
): void {
	for (const id of memberIds)
		pushToUser(id, "conversations:changed", { conversationId })
	for (const id of removedIds)
		pushToUser(id, "conversations:changed", { conversationId, removed: true })
}

/* --- open -------------------------------------------------------------- */

export async function open(
	db: Db,
	userId: number,
	params: { conversationId: number; before?: number; limit?: number }
): Promise<{ conversationId: number; messages: ConversationMessageRow[]; hasEarlier: boolean }> {
	await assertMessagingOn(db)
	const { conversation } = await requireMember(db, params?.conversationId, userId)
	const raw = Number(params.limit)
	const limit = Number.isInteger(raw) && raw > 0
		? Math.min(raw, CONVERSATION_PAGE_MAX)
		: CONVERSATION_PAGE_DEFAULT
	const before = Number.isInteger(params.before) ? (params.before as number) : null
	const rows = await db
		.select()
		.from(CM)
		.where(
			before != null
				? and(eq(CM.conversationId, conversation.id), lt(CM.id, before))
				: eq(CM.conversationId, conversation.id)
		)
		.orderBy(desc(CM.id))
		.limit(limit + 1)
	const hasEarlier = rows.length > limit
	const page = rows.slice(0, limit).reverse()
	const atts = await attachmentsByMessage(db, page.map((m) => m.id))
	const messages: ConversationMessageRow[] = []
	for (const m of page) messages.push(await rowFor(db, m, atts.get(m.id) ?? [], userId))
	return { conversationId: conversation.id, messages, hasEarlier }
}

/* --- create ------------------------------------------------------------ */

export function pairKeyOf(a: number, b: number): string {
	return a < b ? `${a}:${b}` : `${b}:${a}`
}

export async function create(
	db: Db,
	userId: number,
	params: { userIds: number[]; name?: string }
): Promise<{ conversation: ConversationSummary; existing: boolean }> {
	await assertMessagingOn(db)
	const others = await assertPeople(db, userId, params?.userIds)
	if (!others.length) throw new Error("Pick at least one person.")
	const name = typeof params.name === "string" ? params.name.trim() : ""
	if (name.length > NAME_MAX)
		throw new Error(`A conversation name can be at most ${NAME_MAX} characters.`)

	if (others.length === 1 && !name) {
		const other = others[0]
		const pairKey = pairKeyOf(userId, other)
		const { id, existing } = await db.transaction(async (tx) => {
			const t = tx as unknown as Db
			const inserted = await t
				.insert(C)
				.values({ kind: "direct", pairKey })
				.onConflictDoNothing({ target: C.pairKey })
				.returning({ id: C.id })
			let id = inserted[0]?.id
			const existing = id == null
			if (id == null) {
				const [row] = await t
					.select({ id: C.id })
					.from(C)
					.where(eq(C.pairKey, pairKey))
					.limit(1)
				id = row.id
			}
			// Either half may have left; opening the pair again brings both back.
			await t
				.insert(M)
				.values([
					{ conversationId: id, userId },
					{ conversationId: id, userId: other }
				])
				.onConflictDoNothing()
			return { id, existing }
		})
		if (!existing) pushChangedTo([other], id)
		return { conversation: await summaryFor(db, userId, id), existing }
	}

	const id = await db.transaction(async (tx) => {
		const t = tx as unknown as Db
		const [row] = await t
			.insert(C)
			.values({ kind: "group", name: name || null, hostUserId: userId })
			.returning({ id: C.id })
		await t
			.insert(M)
			.values([userId, ...others].map((u) => ({ conversationId: row.id, userId: u })))
		return row.id
	})
	pushChangedTo(others, id)
	return { conversation: await summaryFor(db, userId, id), existing: false }
}

/* --- send -------------------------------------------------------------- */

function normaliseBody(raw: unknown): string {
	const body = typeof raw === "string" ? raw.trim() : ""
	if (body.length > CONVERSATION_BODY_MAX) throw new Error(BODY_TOO_LONG)
	return body
}

function normalisePicks(raw: unknown): ConversationAttachmentPick[] {
	if (raw == null) return []
	if (!Array.isArray(raw)) throw new Error(ATTACHMENT_GONE)
	const picks: ConversationAttachmentPick[] = []
	for (const p of raw) {
		if (!p || !isAttachmentKind(p.kind) || !Number.isInteger(p.subjectId))
			throw new Error(ATTACHMENT_GONE)
		if (!picks.some((q) => q.kind === p.kind && q.subjectId === p.subjectId))
			picks.push({ kind: p.kind, subjectId: p.subjectId })
	}
	if (picks.length > PICKS_MAX)
		throw new Error(`A message can carry at most ${PICKS_MAX} attachments.`)
	return picks
}

/** The sentence a refused pick gets, naming the people it would leave out. */
async function gateRefusal(
	db: Db,
	pick: ConversationAttachmentPick,
	senderId: number,
	blockedBy: number[]
): Promise<string> {
	const card = await attachmentCardFor(pick.kind, pick.subjectId, senderId, db)
	if (!card.available) return ATTACHMENT_GONE
	const people = await db
		.select({ id: U.id, username: U.username, displayName: U.displayName })
		.from(U)
		.where(inArray(U.id, blockedBy))
	const names = blockedBy
		.map((id) => people.find((p) => p.id === id))
		.filter((p): p is NonNullable<typeof p> => !!p)
		.map(nameOf)
	const who = joinNames(names.length ? names : ["Someone here"])
	const how =
		pick.kind === "session"
			? "Add them as guests first, or send without it."
			: pick.kind === "file"
				? "Send without it."
				: "Share it with them first, or send without it."
	return `${who} can't see “${card.title}”. ${how}`
}

export interface SendInput {
	conversationId: number
	body: string
	attachments?: ConversationAttachmentPick[]
	trayItemIds?: string[]
}

export async function send(
	db: Db,
	userId: number,
	params: SendInput
): Promise<{ conversationId: number; message: ConversationMessageRow }> {
	await assertMessagingOn(db)
	const { conversation } = await requireMember(db, params?.conversationId, userId)
	const body = normaliseBody(params.body)
	const picks = normalisePicks(params.attachments)
	const { normaliseTrayItemIds } = await import("$lib/server/attachments/send")
	const { TRAY_ITEM_GONE } = await import("$lib/server/attachments/tray")
	const trayItemIds = normaliseTrayItemIds(params.trayItemIds)
	if (!body && !picks.length && !trayItemIds.length) throw new Error(BODY_EMPTY)

	const memberIds = await memberIdsOf(db, conversation.id)
	if (conversation.kind === "direct") {
		const otherId = memberIds.find((id) => id !== userId)
		if (otherId != null) {
			const [other] = await db
				.select({ isDeleted: U.isDeleted })
				.from(U)
				.where(eq(U.id, otherId))
				.limit(1)
			if (!other || other.isDeleted)
				throw new Error("That person's account was deleted, so this conversation is read-only.")
		}
	}

	// §5 — every pick, for every current member (the sender included).
	for (const pick of picks) {
		const verdict = await canAttach(pick.kind, pick.subjectId, memberIds, db)
		if (!verdict.ok) {
			if (verdict.gone || verdict.blockedBy.includes(userId))
				throw new Error(ATTACHMENT_GONE)
			throw new Error(await gateRefusal(db, pick, userId, verdict.blockedBy))
		}
	}

	// Uploads: the sender's ready tray items in this conversation.
	const tray = trayItemIds.length
		? await db
				.select()
				.from(schema.trayItems)
				.where(
					and(
						inArray(schema.trayItems.id, trayItemIds),
						eq(schema.trayItems.userId, userId),
						eq(schema.trayItems.conversationId, conversation.id)
					)
				)
		: []
	if (tray.length !== trayItemIds.length) throw new Error(TRAY_ITEM_GONE)
	tray.sort(
		(a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime()
	)
	for (const item of tray) {
		if (item.status === "uploading")
			throw new Error("An attachment is still uploading — wait for it to finish, then send.")
		if (item.status !== "ready" || item.fileId == null)
			throw new Error(item.refusal ?? TRAY_ITEM_GONE)
	}
	const trayFileIds = tray.map((t) => t.fileId!) as number[]
	if (trayFileIds.length) {
		// A dedupe hit already stamped with ANOTHER conversation cannot be
		// re-stamped; it has to pass the gate as it stands.
		const files = await db
			.select({ id: schema.files.id, conversationId: schema.files.conversationId })
			.from(schema.files)
			.where(inArray(schema.files.id, trayFileIds))
		if (files.length !== new Set(trayFileIds).size) throw new Error(TRAY_ITEM_GONE)
		for (const f of files) {
			if (f.conversationId == null || f.conversationId === conversation.id) continue
			const verdict = await canAttach("file", f.id, memberIds, db)
			if (!verdict.ok) throw new Error(ATTACHMENT_GONE)
		}
	}

	const allAttachments: ConversationAttachmentPick[] = [
		...picks,
		...trayFileIds
			.filter((id, i, a) => a.indexOf(id) === i)
			.filter((id) => !picks.some((p) => p.kind === "file" && p.subjectId === id))
			.map((id) => ({ kind: "file" as const, subjectId: id }))
	]

	const messageId = await db.transaction(async (tx) => {
		const t = tx as unknown as Db
		const [still] = await t
			.select({ userId: M.userId })
			.from(M)
			.where(and(eq(M.conversationId, conversation.id), eq(M.userId, userId)))
			.limit(1)
		if (!still) throw new Error(CONVERSATION_NOT_FOUND)
		const now = new Date()
		const [m] = await t
			.insert(CM)
			.values({
				conversationId: conversation.id,
				authorUserId: userId,
				body,
				createdAt: now,
				updatedAt: now
			})
			.returning({ id: CM.id })
		if (allAttachments.length)
			await t.insert(CA).values(
				allAttachments.map((a, ordinal) => ({
					messageId: m.id,
					ordinal,
					kind: a.kind,
					subjectId: a.subjectId
				}))
			)
		if (trayFileIds.length) {
			await t
				.update(schema.files)
				.set({ conversationId: conversation.id })
				.where(
					and(inArray(schema.files.id, trayFileIds), isNull(schema.files.conversationId))
				)
			const gone = await t
				.delete(schema.trayItems)
				.where(inArray(schema.trayItems.id, tray.map((r) => r.id)))
				.returning({ id: schema.trayItems.id })
			if (gone.length !== tray.length) throw new Error(TRAY_ITEM_GONE)
		}
		await t
			.update(C)
			.set({ lastMessageAt: now, updatedAt: now })
			.where(eq(C.id, conversation.id))
		await t
			.update(M)
			.set({ lastReadMessageId: m.id })
			.where(and(eq(M.conversationId, conversation.id), eq(M.userId, userId)))
		return m.id
	})

	pushMessage(db, memberIds, conversation.id, messageId, "new")
	await notifyMembers(db, conversation, userId, body, allAttachments.length > 0)
	return {
		conversationId: conversation.id,
		message: await messageRowFor(db, messageId, userId)
	}
}

async function notifyMembers(
	db: Db,
	conversation: ConversationRow,
	authorId: number,
	body: string,
	hasAttachments: boolean
): Promise<void> {
	const members = await db
		.select({ userId: M.userId, mutedAt: M.mutedAt })
		.from(M)
		.where(eq(M.conversationId, conversation.id))
	const userIds = members
		.filter((m) => m.userId !== authorId && !m.mutedAt)
		.map((m) => m.userId)
	if (!userIds.length) return
	const [author] = await db
		.select({ username: U.username, displayName: U.displayName })
		.from(U)
		.where(eq(U.id, authorId))
		.limit(1)
	const authorName = author ? nameOf(author) : "Someone"
	await raiseNotification(
		{
			userIds,
			kind: CONVERSATION_MESSAGE.id,
			regarding: regardingFor.conversation(conversation.id),
			href: conversationHref(conversation.id),
			vars: {
				author: authorName,
				conversation:
					conversation.kind === "group"
						? conversation.name?.trim() || "a group conversation"
						: authorName,
				excerpt:
					excerptOf(body, 140) ?? (hasAttachments ? "Sent an attachment" : "")
			}
		},
		db
	)
}

/* --- edit / remove ----------------------------------------------------- */

async function ownMessage(db: Db, userId: number, messageId: unknown) {
	if (!Number.isInteger(messageId)) throw new Error(CONVERSATION_NOT_FOUND)
	const [row] = await db
		.select({ message: CM })
		.from(CM)
		.innerJoin(M, and(eq(M.conversationId, CM.conversationId), eq(M.userId, userId)))
		.where(eq(CM.id, messageId as number))
		.limit(1)
	if (!row) throw new Error(CONVERSATION_NOT_FOUND)
	if (row.message.authorUserId !== userId)
		throw new Error("Only the person who wrote a message can change it.")
	if (row.message.deletedAt) throw new Error("That message was removed.")
	return row.message
}

export async function edit(
	db: Db,
	userId: number,
	params: { messageId: number; body: string }
): Promise<{ conversationId: number; message: ConversationMessageRow }> {
	await assertMessagingOn(db)
	const m = await ownMessage(db, userId, params?.messageId)
	const body = normaliseBody(params.body)
	if (!body) {
		const [{ n }] = await db
			.select({ n: count() })
			.from(CA)
			.where(eq(CA.messageId, m.id))
		if (!n) throw new Error(BODY_EMPTY)
	}
	if (body !== m.body)
		await db
			.update(CM)
			.set({ body, isEdited: true, updatedAt: new Date() })
			.where(eq(CM.id, m.id))
	pushMessage(db, await memberIdsOf(db, m.conversationId), m.conversationId, m.id, "edited")
	return { conversationId: m.conversationId, message: await messageRowFor(db, m.id, userId) }
}

/** A tombstone: body emptied, attachments dropped, the row keeps its place. */
export async function remove(
	db: Db,
	userId: number,
	params: { messageId: number }
): Promise<{ conversationId: number; message: ConversationMessageRow }> {
	await assertMessagingOn(db)
	const m = await ownMessage(db, userId, params?.messageId)
	await db.transaction(async (tx) => {
		const t = tx as unknown as Db
		const now = new Date()
		await t.update(CM).set({ body: "", deletedAt: now, updatedAt: now }).where(eq(CM.id, m.id))
		await t.delete(CA).where(eq(CA.messageId, m.id))
	})
	pushMessage(db, await memberIdsOf(db, m.conversationId), m.conversationId, m.id, "removed")
	return { conversationId: m.conversationId, message: await messageRowFor(db, m.id, userId) }
}

/* --- read marker, mute ------------------------------------------------- */

export async function markRead(
	db: Db,
	userId: number,
	params: { conversationId: number; upTo: number }
): Promise<{ conversationId: number; lastReadMessageId: number }> {
	await assertMessagingOn(db)
	const { member, conversation } = await requireMember(db, params?.conversationId, userId)
	const upTo = Number.isInteger(params.upTo) ? params.upTo : 0
	const [{ maxId }] = await db
		.select({ maxId: sql<number | null>`MAX(${CM.id})` })
		.from(CM)
		.where(eq(CM.conversationId, conversation.id))
	const capped = Math.min(upTo, Number(maxId ?? 0))
	const next = Math.max(member.lastReadMessageId ?? 0, capped)
	if (next !== (member.lastReadMessageId ?? 0))
		await db
			.update(M)
			.set({ lastReadMessageId: next })
			.where(and(eq(M.conversationId, conversation.id), eq(M.userId, userId)))
	await clearNotifications(
		{ regarding: regardingFor.conversation(conversation.id), userId },
		"viewed",
		db
	)
	return { conversationId: conversation.id, lastReadMessageId: next }
}

export async function mute(
	db: Db,
	userId: number,
	params: { conversationId: number; muted: boolean }
): Promise<ConversationSummary> {
	await assertMessagingOn(db)
	const { conversation } = await requireMember(db, params?.conversationId, userId)
	await db
		.update(M)
		.set({ mutedAt: params.muted ? new Date() : null })
		.where(and(eq(M.conversationId, conversation.id), eq(M.userId, userId)))
	return summaryFor(db, userId, conversation.id)
}

/* --- group management -------------------------------------------------- */

async function requireHost(db: Db, conversationId: unknown, userId: number) {
	const found = await requireMember(db, conversationId, userId)
	if (found.conversation.kind !== "group") throw new Error(NOT_GROUP)
	if (found.conversation.hostUserId !== userId) throw new Error(NOT_HOST)
	return found
}

export async function rename(
	db: Db,
	userId: number,
	params: { conversationId: number; name: string }
): Promise<ConversationSummary> {
	await assertMessagingOn(db)
	const { conversation } = await requireHost(db, params?.conversationId, userId)
	const name = typeof params.name === "string" ? params.name.trim() : ""
	if (name.length > NAME_MAX)
		throw new Error(`A conversation name can be at most ${NAME_MAX} characters.`)
	await db
		.update(C)
		.set({ name: name || null, updatedAt: new Date() })
		.where(eq(C.id, conversation.id))
	pushChangedTo(await memberIdsOf(db, conversation.id), conversation.id)
	return summaryFor(db, userId, conversation.id)
}

export async function addMembers(
	db: Db,
	userId: number,
	params: { conversationId: number; userIds: number[] }
): Promise<ConversationSummary> {
	await assertMessagingOn(db)
	const { conversation } = await requireHost(db, params?.conversationId, userId)
	const ids = await assertPeople(db, userId, params.userIds)
	if (ids.length)
		await db
			.insert(M)
			.values(ids.map((u) => ({ conversationId: conversation.id, userId: u })))
			.onConflictDoNothing()
	pushChangedTo(await memberIdsOf(db, conversation.id), conversation.id)
	return summaryFor(db, userId, conversation.id)
}

export async function removeMember(
	db: Db,
	userId: number,
	params: { conversationId: number; userId: number }
): Promise<ConversationSummary> {
	await assertMessagingOn(db)
	const { conversation } = await requireHost(db, params?.conversationId, userId)
	const target = params.userId
	if (!Number.isInteger(target)) throw new Error(PERSON_NOT_AVAILABLE)
	if (target === userId) throw new Error("Leave the conversation instead.")
	const gone = await db
		.delete(M)
		.where(and(eq(M.conversationId, conversation.id), eq(M.userId, target)))
		.returning({ userId: M.userId })
	if (!gone.length) throw new Error(PERSON_NOT_AVAILABLE)
	await clearNotifications(
		{ regarding: regardingFor.conversation(conversation.id), userId: target },
		"superseded",
		db
	)
	pushChangedTo(await memberIdsOf(db, conversation.id), conversation.id, [target])
	return summaryFor(db, userId, conversation.id)
}

/**
 * Leave. The host leaving hands the host to the oldest remaining member; the
 * last member leaving deletes the conversation (its messages cascade).
 */
export async function leave(
	db: Db,
	userId: number,
	params: { conversationId: number }
): Promise<{ conversationId: number; left: true; deleted: boolean }> {
	await assertMessagingOn(db)
	const { conversation } = await requireMember(db, params?.conversationId, userId)
	const result = await db.transaction(async (tx) => {
		const t = tx as unknown as Db
		await t
			.delete(M)
			.where(and(eq(M.conversationId, conversation.id), eq(M.userId, userId)))
		const rest = await t
			.select({ userId: M.userId })
			.from(M)
			.where(eq(M.conversationId, conversation.id))
			.orderBy(asc(M.joinedAt), asc(M.userId))
		if (!rest.length) {
			await t.delete(C).where(eq(C.id, conversation.id))
			return { rest: [] as number[], deleted: true }
		}
		if (conversation.kind === "group" && conversation.hostUserId === userId)
			await t
				.update(C)
				.set({ hostUserId: rest[0].userId, updatedAt: new Date() })
				.where(eq(C.id, conversation.id))
		return { rest: rest.map((r) => r.userId), deleted: false }
	})
	await clearNotifications(
		{ regarding: regardingFor.conversation(conversation.id), userId },
		"superseded",
		db
	)
	pushChangedTo(result.rest, conversation.id, [userId])
	return { conversationId: conversation.id, left: true, deleted: result.deleted }
}

/* --- people, attachable, person ---------------------------------------- */

export async function people(db: Db, userId: number): Promise<ConversationPerson[]> {
	await assertMessagingOn(db)
	const rows = await db
		.select({
			id: U.id,
			username: U.username,
			displayName: U.displayName,
			isAdmin: U.isAdmin,
			avatarMediaId: U.avatarMediaId
		})
		.from(U)
		.where(and(eq(U.isDeleted, false), ne(U.id, userId)))
		.orderBy(asc(sql`lower(coalesce(${U.displayName}, ${U.username}))`))
	return rows.map(personOf)
}

/** Subject ids of `kind` the asker can see, newest first, title-filtered. */
async function askerCandidates(
	db: Db,
	userId: number,
	kind: "session" | "character" | "lorebook",
	q: string,
	limit: number
): Promise<number[]> {
	const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
	if (kind === "session") {
		const S = schema.sessions
		const guestOf = db
			.select({ id: schema.sessionGuests.sessionId })
			.from(schema.sessionGuests)
			.where(eq(schema.sessionGuests.userId, userId))
		const rows = await db
			.select({ id: S.id })
			.from(S)
			.where(
				and(
					or(eq(S.userId, userId), inArray(S.id, guestOf)),
					eq(S.sessionType, SessionTypes.ROLEPLAY),
					like ? ilike(S.name, like) : undefined
				)
			)
			.orderBy(desc(S.updatedAt))
			.limit(limit)
		return rows.map((r) => r.id)
	}
	if (kind === "character") {
		const K = schema.characters
		const shared = db
			.select({ id: schema.characterShares.characterId })
			.from(schema.characterShares)
			.where(eq(schema.characterShares.userId, userId))
		const rows = await db
			.select({ id: K.id })
			.from(K)
			.where(
				and(
					or(eq(K.userId, userId), inArray(K.id, shared)),
					like ? or(ilike(K.name, like), ilike(K.nickname, like)) : undefined
				)
			)
			.orderBy(desc(K.updatedAt))
			.limit(limit)
		return rows.map((r) => r.id)
	}
	const L = schema.lorebooks
	const shared = db
		.select({ id: schema.lorebookShares.lorebookId })
		.from(schema.lorebookShares)
		.where(eq(schema.lorebookShares.userId, userId))
	const rows = await db
		.select({ id: L.id })
		.from(L)
		.where(
			and(
				or(eq(L.userId, userId), inArray(L.id, shared)),
				// 🚧 Never a session's own notes (PLAN-rulesets §26).
				sql`${L.sessionId} IS NULL`,
				like ? ilike(L.name, like) : undefined
			)
		)
		.orderBy(desc(L.updatedAt))
		.limit(limit)
	return rows.map((r) => r.id)
}

/**
 * What the picker may offer: subjects the asker can see AND every member (or,
 * composing a new conversation, every picked person) can see — §5's gate, run
 * ahead so the send rarely refuses.
 */
export async function attachable(
	db: Db,
	userId: number,
	params: ConversationsAttachableParams
): Promise<{ kind: ConversationAttachmentKind; candidates: ConversationAttachmentCard[] }> {
	await assertMessagingOn(db)
	const kind = params?.kind
	if (kind !== "session" && kind !== "character" && kind !== "lorebook")
		throw new Error("Pick a session, a character or a lorebook.")
	let audience: number[]
	if (params.conversationId != null) {
		const { conversation } = await requireMember(db, params.conversationId, userId)
		audience = await memberIdsOf(db, conversation.id)
	} else {
		audience = [userId, ...(await assertPeople(db, userId, params.userIds ?? []))]
	}
	const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : ""
	const ids = await askerCandidates(db, userId, kind, q, 200)
	const candidates: ConversationAttachmentCard[] = []
	for (const id of ids) {
		if (candidates.length >= ATTACHABLE_MAX) break
		const verdict = await canAttach(kind, id, audience, db)
		if (!verdict.ok) continue
		const card = await attachmentCardFor(kind, id, userId, db)
		if (card.available) candidates.push(card)
	}
	return { kind, candidates }
}

/** One person's detail as another sees it (§6.6). */
export async function person(
	db: Db,
	viewerId: number,
	params: { userId: number }
): Promise<ConversationsPersonResponse> {
	await assertMessagingOn(db)
	const targetId = params?.userId
	if (!Number.isInteger(targetId) || targetId === viewerId)
		throw new Error(PERSON_NOT_AVAILABLE)
	const [target] = await db
		.select({
			id: U.id,
			username: U.username,
			displayName: U.displayName,
			isAdmin: U.isAdmin,
			avatarMediaId: U.avatarMediaId,
			isDeleted: U.isDeleted
		})
		.from(U)
		.where(eq(U.id, targetId))
		.limit(1)
	if (!target || target.isDeleted) throw new Error(PERSON_NOT_AVAILABLE)

	// Sessions: theirs, where the viewer is a guest.
	const S = schema.sessions
	const sessionRows = await db
		.select({ id: S.id })
		.from(S)
		.innerJoin(
			schema.sessionGuests,
			and(
				eq(schema.sessionGuests.sessionId, S.id),
				eq(schema.sessionGuests.userId, viewerId)
			)
		)
		.where(and(eq(S.userId, targetId), eq(S.sessionType, SessionTypes.ROLEPLAY)))
		.orderBy(desc(S.updatedAt))
		.limit(PERSON_TAB_MAX)
	const sessions: ConversationsPersonResponse["sessions"] = []
	for (const { id } of sessionRows) {
		const card = await attachmentCardFor("session", id, viewerId, db)
		if (card.available && card.kind === "session")
			sessions.push({ id, title: card.title, subtitle: card.subtitle, faces: card.faces })
	}

	// Characters: theirs, that the viewer may see — prefiltered to the ones a
	// share or a session of the viewer's could explain, then confirmed by
	// `canViewCharacter` (the one authority).
	const K = schema.characters
	const viewerSessions = sql`(SELECT ${S.id} FROM ${S} WHERE ${S.userId} = ${viewerId}
		UNION SELECT ${schema.sessionGuests.sessionId} FROM ${schema.sessionGuests} WHERE ${schema.sessionGuests.userId} = ${viewerId})`
	const charRows = await db
		.select({
			id: K.id,
			name: K.name,
			nickname: K.nickname,
			description: K.description,
			isPersona: K.isPersona,
			uuid: schema.files.uuid,
			rev: schema.files.rev
		})
		.from(K)
		.leftJoin(schema.files, eq(schema.files.id, K.avatarMediaId))
		.where(
			and(
				eq(K.userId, targetId),
				or(
					sql`EXISTS (SELECT 1 FROM ${schema.characterShares} WHERE ${schema.characterShares.characterId} = ${K.id} AND ${schema.characterShares.userId} = ${viewerId})`,
					sql`${K.id} IN (SELECT ${schema.sessionCharacters.characterId} FROM ${schema.sessionCharacters} WHERE ${schema.sessionCharacters.sessionId} IN ${viewerSessions})`,
					sql`${K.id} IN (SELECT ${schema.sessionPersonas.personaId} FROM ${schema.sessionPersonas} WHERE ${schema.sessionPersonas.sessionId} IN ${viewerSessions})`
				)
			)
		)
		.orderBy(asc(K.name))
		.limit(PERSON_TAB_MAX * 2)
	const characters: ConversationsPersonResponse["characters"] = []
	for (const c of charRows) {
		if (characters.length >= PERSON_TAB_MAX) break
		if (!(await canViewCharacter(c.id, viewerId))) continue
		characters.push({
			id: c.id,
			title: c.nickname || c.name,
			subtitle: excerptOf(c.description),
			avatarSrc: c.uuid ? mediaSrc(c.uuid, c.rev ?? 0, true) : null,
			isPersona: c.isPersona
		})
	}

	// Lorebooks: theirs, shared with the viewer.
	const L = schema.lorebooks
	const bookRows = await db
		.select({ id: L.id })
		.from(L)
		.innerJoin(
			schema.lorebookShares,
			and(
				eq(schema.lorebookShares.lorebookId, L.id),
				eq(schema.lorebookShares.userId, viewerId)
			)
		)
		.where(eq(L.userId, targetId))
		.orderBy(asc(L.name))
		.limit(PERSON_TAB_MAX)
	const lorebooks: ConversationsPersonResponse["lorebooks"] = []
	for (const { id } of bookRows) {
		if (!(await canViewLorebook(id, viewerId, { db }))) continue
		const card = await attachmentCardFor("lorebook", id, viewerId, db)
		if (card.available && card.kind === "lorebook")
			lorebooks.push({ id, title: card.title, subtitle: card.subtitle })
	}

	const [direct] = await db
		.select({ id: C.id })
		.from(C)
		.innerJoin(M, and(eq(M.conversationId, C.id), eq(M.userId, viewerId)))
		.where(eq(C.pairKey, pairKeyOf(viewerId, targetId)))
		.limit(1)

	return {
		person: personOf(target),
		sessions,
		characters,
		lorebooks,
		directConversationId: direct?.id ?? null
	}
}

