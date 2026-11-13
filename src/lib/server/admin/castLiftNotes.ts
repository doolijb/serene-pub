/**
 * 🚧 The admin list of cast members the character-versions upgrade lifted with
 * a note (`LiftNoteV1` on the member's base version): they read differently
 * since the upgrade, or their greetings became their own list (owner ruling
 * 2026-11-05, "Own list, noted"). Reads only; the one write that clears a
 * greetings line is `followCardGreetingsAfterLift` in the versions module.
 *
 * The rule lives here once: the Overview's `data.castLiftCount` is this list's
 * `count`, so the two cannot disagree.
 *
 * Which versions count is the base's shape (`isBaseVersion`: cast, main,
 * undated, no life point, no source session) whose `note` parses as a lift
 * note with a difference or `mixedGreetings`. `written_by` is not asked: a
 * member's edit of its base is an edit in place that keeps `note`.
 *
 * Two reads however many members there are: the bases with their book and
 * binding names, and the names as main reads them now (`membersAsRead`).
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { membersAsRead } from "$lib/server/cast/memberAsRead"
import { parseLiftNote } from "$lib/server/characters/versionsLift"

export async function castLiftNotes(
	db: Db
): Promise<Sockets.Admin.CastLiftNotes.Response> {
	const V = schema.characterVersions
	const rows = await db
		.select({
			castMemberId: V.castMemberId,
			lorebookId: schema.lorebookBindings.lorebookId,
			lorebookName: schema.lorebooks.name,
			bindingName: schema.lorebookBindings.name,
			note: V.note
		})
		.from(V)
		.innerJoin(
			schema.lorebookBindings,
			eq(schema.lorebookBindings.id, V.castMemberId)
		)
		.innerJoin(
			schema.lorebooks,
			eq(schema.lorebooks.id, schema.lorebookBindings.lorebookId)
		)
		.where(
			and(
				isNotNull(V.castMemberId),
				isNotNull(V.note),
				isNull(V.branchId),
				isNull(V.year),
				isNull(V.personalPosition),
				isNull(V.sourceSessionId),
				isNull(V.retiredOrder)
			)
		)
	const noted = rows.flatMap((r) => {
		const note = parseLiftNote(r.note)
		return note && (note.differences.length > 0 || note.mixedGreetings)
			? [{ row: r, note }]
			: []
	})
	const read = await membersAsRead(
		db,
		noted.map((n) => n.row.castMemberId!)
	)
	const members = noted
		.map(({ row, note }) => ({
			castMemberId: row.castMemberId!,
			lorebookId: row.lorebookId,
			lorebookName: row.lorebookName,
			memberName:
				read.get(row.castMemberId!)?.shownName || row.bindingName,
			note: note as Sockets.Admin.CastLiftNotes.Member["note"]
		}))
		.sort(
			(a, b) =>
				cmp(a.lorebookName, b.lorebookName) ||
				cmp(a.memberName, b.memberName) ||
				a.castMemberId - b.castMemberId
		)
	return { count: members.length, members }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
