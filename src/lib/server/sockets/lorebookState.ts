/**
 * 🚧 `lorebookState:*` — the stats a lorebook itself holds, read and written
 * with no session (plan places-graph L4, owner answer Q5 2026-09-29).
 *
 * Only a place's, so far: the place editor's **Stats** section, where an
 * author puts the key in the crypt before play. The rules — which stats a
 * place is offered, where on the book a value stands, who may write it —
 * are `state/placeStats.ts`'s; this file is the door: the book's owner or
 * "Lorebook not found." (the enumeration rule every `entries:*` verb keeps),
 * a refusal in the state layer's own sentence — every failure answered by
 * `refusable()`, naming the request — and a reply that is the fresh read
 * rather than a patch, as `state:*` replies are.
 *
 * ⚠ Not `state:*`. That family is session-scoped by design (its header):
 * a caller there reads what a value IS in one session. This one reads what
 * the BOOK says, which is what every session on it inherits.
 *
 * A write tells every session on the book that its state moved
 * (`state:changed`, gated per session): a session that has not changed the
 * value reads the new one at once.
 */

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { SlotValue } from "@serene-pub/sdk"
import type { Handler } from "$lib/shared/events"
import { storyDateFrom } from "$lib/server/state/reading"
import { placeStatsFor, setPlaceStat, type PlaceStats } from "$lib/server/state/placeStats"
import { StateRefusal } from "$lib/server/state/write"
import { describeSlot } from "./state"
import { broadcastToSessionUsers } from "./utils/broadcastHelpers"
import { refusable } from "./refusable"
import { assertOwnedBook } from "$lib/server/utils/ownedBook"

type GetParams = Sockets.LorebookState.Get.Params
type SetParams = Sockets.LorebookState.Set.Params
type Reply = Sockets.LorebookState.Get.Response

const requestIdOf = (raw: unknown): string | undefined =>
	typeof raw === "string" && raw.length <= 128 ? raw : undefined

/**
 * The ids a refusal carries back (`refusable`'s echo): the book, when the
 * caller named one, and the caller's `requestId`, so the one stat's save that
 * asked claims it (`refusalFor`) and another stat's does not.
 */
function aboutRequest(raw: unknown): { lorebookId?: number; requestId?: string } {
	const params = raw as { lorebookId?: unknown; requestId?: unknown } | undefined
	const lorebookId = Number(params?.lorebookId)
	const requestId = requestIdOf(params?.requestId)
	return {
		...(Number.isInteger(lorebookId) ? { lorebookId } : {}),
		...(requestId !== undefined ? { requestId } : {})
	}
}

/** The params every call carries, checked; refuses anything that is not them. */
async function scoped(
	socket: any,
	params: GetParams | undefined
): Promise<{ lorebookId: number; placeId: number; branchId: number | null; moment: GetParams["moment"]; requestId?: string }> {
	const requestId = requestIdOf(params?.requestId)
	const lorebookId = Number(params?.lorebookId)
	// Another user's book reads exactly as a missing one (plan B3's helper).
	await assertOwnedBook(db, socket.user?.id, lorebookId)
	const owner = params?.owner as { kind?: unknown; id?: unknown } | undefined
	if (owner?.kind !== "location")
		throw new Error("Only a place's stats are set in the lorebook, for now.")
	if (typeof owner.id !== "number" || !Number.isInteger(owner.id))
		throw new Error("That is not a place of this lorebook.")
	const branchId = params?.branchId ?? null
	if (branchId !== null && !Number.isInteger(branchId))
		throw new Error("That is not a line of this lorebook.")
	const date = params?.moment ? storyDateFrom(params.moment) : null
	return {
		lorebookId,
		placeId: owner.id as number,
		branchId,
		moment: date ? { year: date.year, month: date.month ?? null, day: date.day ?? null } : null,
		requestId
	}
}

/** A place's stats, as the wire carries them. */
function replyOf(
	stats: PlaceStats,
	at: { lorebookId: number; branchId: number | null; moment: GetParams["moment"]; requestId?: string }
): Reply {
	return {
		lorebookId: at.lorebookId,
		owner: { kind: "location", id: stats.place.entryId },
		branchId: at.branchId,
		moment: at.moment,
		slots: stats.decls.map((decl) => describeSlot(decl)),
		values: stats.values,
		configs: stats.configs as Record<string, Record<string, unknown>>,
		heldSince: Object.fromEntries(
			Object.entries(stats.heldSince).map(([slotId, d]) => [slotId, momentOf(d.date)])
		),
		writeDatedBy: stats.writeDatedBy
			? { historyEntryId: stats.writeDatedBy.historyEntryId, date: momentOf(stats.writeDatedBy.date) }
			: null,
		...(at.requestId !== undefined ? { requestId: at.requestId } : {})
	}
}

/** A story date as the wire spells it. */
const momentOf = (date: { year: number; month?: number | null; day?: number | null }) => ({
	year: date.year,
	month: date.month ?? null,
	day: date.day ?? null
})

/**
 * A refusal from the state layer is a sentence a person wrote; it is passed
 * through (`refusable`'s translate). Its sentences start lower-case, to follow
 * a subject; a refusal on its own does not.
 */
const stateRefusal = (e: unknown): string | undefined =>
	e instanceof StateRefusal ? capitalized(e.message) : undefined

const capitalized = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)

/**
 * The write landed and its reply could not be read. Not "could not be saved":
 * the value is on the book (the book's sessions are told, as after any
 * write), and a retry would be refused as made from a value that has moved
 * since.
 */
const SAVED_BUT_UNREAD =
	"The stat was saved, but this place's stats could not be read back. Reopen the place to see them."

export const lorebookStateGet: Handler<GetParams, Reply> = refusable(
	"lorebookState:get",
	async (socket, params: GetParams, emitToUser) => {
		const at = await scoped(socket, params)
		const stats = await placeStatsFor(db, {
			lorebookId: at.lorebookId,
			placeId: at.placeId,
			branchId: at.branchId,
			moment: at.moment
		})
		const res = replyOf(stats, at)
		emitToUser("lorebookState:get", res)
		return res
	},
	"This place's stats could not be read.",
	stateRefusal,
	aboutRequest
)

export const lorebookStateSet: Handler<SetParams, Reply> = refusable(
	"lorebookState:set",
	async (socket, params: SetParams, emitToUser) => {
		const at = await scoped(socket, params)
		if (typeof params?.slotId !== "string" || !params.slotId)
			throw new Error("Name the stat to set.")
		await setPlaceStat(db, {
			lorebookId: at.lorebookId,
			placeId: at.placeId,
			branchId: at.branchId,
			moment: at.moment,
			slotId: params.slotId,
			value: (params.value ?? null) as SlotValue,
			...("readValue" in params ? { readValue: (params.readValue ?? null) as SlotValue } : {}),
			userId: socket.user!.id
		})
		let stats: PlaceStats
		try {
			stats = await placeStatsFor(db, {
				lorebookId: at.lorebookId,
				placeId: at.placeId,
				branchId: at.branchId,
				moment: at.moment
			})
		} catch (e) {
			// The value is on the book all the same: every session on it
			// re-reads now, as after any write that landed.
			await tellSessions(socket, at.lorebookId)
			throw new Error(SAVED_BUT_UNREAD, { cause: e })
		}
		const res = replyOf(stats, at)
		emitToUser("lorebookState:set", res)
		await tellSessions(socket, at.lorebookId)
		return res
	},
	"The stat could not be saved.",
	stateRefusal,
	aboutRequest
)

/**
 * Every session on the book re-reads its state: one that has not changed
 * the value inherits the new one now. Gated per session, so a session no
 * tab has open costs nothing; a failure here is logged, never a refusal of
 * a write that landed.
 */
async function tellSessions(socket: any, lorebookId: number): Promise<void> {
	try {
		const sessions = await db
			.select({ id: schema.sessions.id })
			.from(schema.sessions)
			.where(eq(schema.sessions.lorebookId, lorebookId))
		for (const s of sessions)
			await broadcastToSessionUsers(socket.io, s.id, "state:changed", {
				sessionId: s.id
			} satisfies Sockets.State.Changed.Response)
	} catch (e) {
		console.error("lorebookState:set: telling the book's sessions failed:", e)
	}
}

export function registerLorebookStateHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, lorebookStateGet, emitToUser)
	register(socket, lorebookStateSet, emitToUser)
}
