/**
 * 🚧 The admin lift list (Admin › Data and backups): the cast members the
 * character-versions upgrade lifted with a note, and the one-click **Follow
 * the card's greetings** for a member the upgrade gave its own greetings list
 * (owner ruling 2026-11-05, "Own list, noted").
 *
 * Both events are admin only; `admin:` is a restricted interest prefix as
 * well. The list is `admin/castLiftNotes.ts` (reads only); the write is the
 * versions module's `followCardGreetingsAfterLift`, under the member's book
 * lock. After a follow, every tab of the admin gets the refreshed list and the
 * Overview is told it is stale (its `castLiftCount` moved).
 */
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq, sql } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { castLiftNotes } from "$lib/server/admin/castLiftNotes"
import { markAdminOverviewStale } from "$lib/server/admin/overviewStale"
import { followCardGreetingsAfterLift } from "$lib/server/characters/versions"
import { refusable } from "./refusable"

export const adminCastLiftNotes: Handler<
	Sockets.Admin.CastLiftNotes.Params,
	Sockets.Admin.CastLiftNotes.Response
> = {
	event: "admin:castLiftNotes",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const res = await castLiftNotes(db)
		emitToUser("admin:castLiftNotes", res)
		return res
	}
}

export const adminCastLiftFollowGreetings: Handler<
	Sockets.Admin.CastLiftFollowGreetings.Params,
	Sockets.Admin.CastLiftFollowGreetings.Response
> = refusable(
	"admin:castLiftFollowGreetings",
	async (
		socket,
		params: Sockets.Admin.CastLiftFollowGreetings.Params,
		emitToUser
	): Promise<Sockets.Admin.CastLiftFollowGreetings.Response> => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const castMemberId = Number(params?.castMemberId)
		const [member] = Number.isInteger(castMemberId)
			? await db
					.select({ lorebookId: schema.lorebookBindings.lorebookId })
					.from(schema.lorebookBindings)
					.where(eq(schema.lorebookBindings.id, castMemberId))
			: []
		if (!member) throw new Error("That cast member does not exist.")
		await db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(${member.lorebookId})`
			)
			await followCardGreetingsAfterLift(tx, castMemberId)
		})
		const res = await castLiftNotes(db)
		emitToUser("admin:castLiftNotes", res)
		markAdminOverviewStale()
		emitToUser("admin:castLiftFollowGreetings", res)
		return res
	},
	"The greetings could not be set to follow the card."
)

export function registerAdminCastLiftHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, adminCastLiftNotes, emitToUser)
	register(socket, adminCastLiftFollowGreetings, emitToUser)
}
