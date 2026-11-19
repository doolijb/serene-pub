/**
 * 🚧 `entryKnowledge:*` — the door through which a lorebook's owner reads who
 * knows each entry and writes the mark and the hand ties
 * (`not_common_knowledge`, `knows` / `kept_from` ties).
 *
 * **Owns** nothing but the door: the params' checks, the refusals, the reply.
 * The data, the judgement and every write are `lorebooks/entryKnowledge.ts`'s;
 * this file holds no SQL.
 *
 * **Gate.** The book's row owner only (a session's other members, a share
 * recipient and an administrator who is not the owner are refused, in the
 * helpers' own sentences). A write refuses a primer book.
 *
 * **Scope.** Every reply carries `lorebookId` (the scope key of
 * `SCOPED_EVENTS`) and the asker's `requestId`; a refusal echoes both.
 */

import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import { primerRowEditProblem } from "$lib/server/plugins/providedMarks"
import {
	readBookKnowledge,
	setBookCommonKnowledge,
	setHandKnowledgeTie
} from "$lib/server/lorebooks/entryKnowledge"
import { storyDateFrom } from "$lib/server/state/reading"
import { refusable } from "./refusable"

type ListParams = Sockets.EntryKnowledge.List.Params
type ListReply = Sockets.EntryKnowledge.List.Response
type MarkParams = Sockets.EntryKnowledge.SetCommonKnowledge.Params
type MarkReply = Sockets.EntryKnowledge.SetCommonKnowledge.Response
type TieParams = Sockets.EntryKnowledge.SetTie.Params
type TieReply = Sockets.EntryKnowledge.SetTie.Response

const requestIdOf = (raw: unknown): string | undefined =>
	typeof raw === "string" && raw.length <= 128 ? raw : undefined

/** The ids a refusal carries back: the book and the caller's `requestId`. */
function aboutRequest(raw: unknown): { lorebookId?: number; requestId?: string } {
	const params = raw as { lorebookId?: unknown; requestId?: unknown } | undefined
	const lorebookId = Number(params?.lorebookId)
	const requestId = requestIdOf(params?.requestId)
	return {
		...(Number.isInteger(lorebookId) ? { lorebookId } : {}),
		...(requestId !== undefined ? { requestId } : {})
	}
}

const withRequest = (requestId: string | undefined) =>
	requestId !== undefined ? { requestId } : {}

/** The book and the reading every call names, checked. */
function readingOf(params: {
	lorebookId?: unknown
	branchId?: unknown
	moment?: unknown
}): { lorebookId: number; branchId: number | null; moment: Sockets.EntryKnowledge.Moment | null } {
	const lorebookId = Number(params?.lorebookId)
	if (!Number.isInteger(lorebookId)) throw new Error("Lorebook not found.")
	const branchId = params?.branchId ?? null
	if (branchId !== null && !Number.isInteger(branchId))
		throw new Error("That is not a line of this lorebook.")
	const date = params?.moment ? storyDateFrom(params.moment) : null
	return {
		lorebookId,
		branchId: branchId as number | null,
		moment: date
			? { year: date.year, month: date.month ?? null, day: date.day ?? null }
			: null
	}
}

const optionalId = (raw: unknown): number | undefined =>
	typeof raw === "number" && Number.isInteger(raw) ? raw : undefined

async function refusePrimer(lorebookId: number) {
	const problem = await primerRowEditProblem(db, lorebookId)
	if (problem) throw new Error(problem)
}

export const entryKnowledgeList: Handler<ListParams, ListReply> = refusable(
	"entryKnowledge:list",
	async (socket, params: ListParams, emitToUser) => {
		const at = readingOf(params)
		const entryId = optionalId(params.entryId)
		const castMemberId = optionalId(params.castMemberId)
		const read = await readBookKnowledge(db, {
			userId: socket.user!.id,
			...at,
			entryId,
			castMemberId
		})
		const res: ListReply = {
			lorebookId: at.lorebookId,
			...(entryId !== undefined ? { entryId } : {}),
			...(castMemberId !== undefined ? { castMemberId } : {}),
			branchId: at.branchId,
			moment: at.moment,
			markedEntryIds: read.markedEntryIds,
			rows: read.rows,
			...withRequest(requestIdOf(params.requestId))
		}
		emitToUser("entryKnowledge:list", res)
		return res
	},
	"Who knows this entry could not be read.",
	undefined,
	aboutRequest
)

export const entryKnowledgeSetCommonKnowledge: Handler<MarkParams, MarkReply> =
	refusable(
		"entryKnowledge:setCommonKnowledge",
		async (socket, params: MarkParams, emitToUser) => {
			const { lorebookId } = readingOf(params)
			await refusePrimer(lorebookId)
			const entryIds = Array.isArray(params.entryIds) ? params.entryIds : []
			const notCommonKnowledge = params.notCommonKnowledge === true
			const markedEntryIds = await setBookCommonKnowledge(db, {
				userId: socket.user!.id,
				lorebookId,
				entryIds,
				notCommonKnowledge
			})
			const res: MarkReply = {
				lorebookId,
				entryIds,
				notCommonKnowledge,
				markedEntryIds,
				...withRequest(requestIdOf(params.requestId))
			}
			emitToUser("entryKnowledge:setCommonKnowledge", res)
			return res
		},
		"The entries could not be marked.",
		undefined,
		aboutRequest
	)

export const entryKnowledgeSetTie: Handler<TieParams, TieReply> = refusable(
	"entryKnowledge:setTie",
	async (socket, params: TieParams, emitToUser) => {
		const at = readingOf(params)
		await refusePrimer(at.lorebookId)
		const castMemberId = optionalId(params.castMemberId)
		const entryId = optionalId(params.entryId)
		if (castMemberId === undefined)
			throw new Error("That cast member is not in this lorebook.")
		if (entryId === undefined) throw new Error("That entry is not in this lorebook.")
		const userId = socket.user!.id
		await setHandKnowledgeTie(db, {
			userId,
			lorebookId: at.lorebookId,
			castMemberId,
			entryId,
			hand: (params.hand ?? null) as TieParams["hand"]
		})
		const read = await readBookKnowledge(db, { userId, ...at, entryId, castMemberId })
		const res: TieReply = {
			lorebookId: at.lorebookId,
			castMemberId,
			entryId,
			branchId: at.branchId,
			moment: at.moment,
			row: read.rows[0]!,
			...withRequest(requestIdOf(params.requestId))
		}
		emitToUser("entryKnowledge:setTie", res)
		return res
	},
	"Who knows this entry could not be saved.",
	undefined,
	aboutRequest
)

export function registerEntryKnowledgeHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, entryKnowledgeList, emitToUser)
	register(socket, entryKnowledgeSetCommonKnowledge, emitToUser)
	register(socket, entryKnowledgeSetTie, emitToUser)
}
