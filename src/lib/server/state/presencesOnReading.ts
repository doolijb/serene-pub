/**
 * The cast's presences as a session reads them — `core:query/cast-presences@1`
 * (plan E-2, owner ruling R4; built 2026-10-02).
 *
 * The HOST resolves the line: a session's line is its own presences plus each
 * ancestor's that begin at or before the fork cut (`presencesOnLine`, the one
 * filter the member page, the roster popover and the Lives lens read through), so
 * no node ever sees another line's spans. What it hands back is the rows and
 * the moment the session reads at; judging a moment is the reader's
 * (`core:task/eligibility@1`, through `holdsAt`).
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { presencesOnLine, type Presence } from "$lib/shared/lorebooks/presence"
import { formatDate, type StoryDate } from "$lib/shared/lorebooks/storyDate"
import { sessionReadingOf } from "$lib/server/state/reading"
import { castOwnerOf } from "$lib/server/state/owners"
import { castLinkKey } from "$lib/server/state/keys"
import { bookCalendarOf, clockOfNow, sessionStoryNowOf } from "$lib/server/state/storyTime"
import { attachedOrOwnBookOf } from "$lib/server/lorebooks/ownBook"
import { getRuleset, storyDayIndex, type FieldDecl } from "@serene-pub/sdk"
import type { ClockTargetV1 } from "@serene-pub/contracts"

/** One presence, in the node's shape: dates as story dates, `until` exclusive. */
export interface PresenceRow {
	bindingId: number
	from: StoryDate
	until: StoryDate | null
	position: number | null
}

export interface PresencesOnReading {
	rows: PresenceRow[]
	/**
	 * The moment the session reads at; null is the head ("now"). Carries
	 * `label`, the moment spelled through the book's calendar, so a sentence
	 * about it reads as every other date of the book does (wave 8 leftover).
	 */
	at: (StoryDate & { label?: string }) | null
	/** 🚧 Where each cast member is at the asked hour (M0, SHAPES L3): see `placementsAt`. */
	placements: { bindingId: number; where: string }[]
}

const date = (
	year: number | null | undefined,
	month: number | null | undefined,
	day: number | null | undefined
): StoryDate | null =>
	year == null
		? null
		: {
				year,
				...(month != null ? { month } : {}),
				...(day != null ? { day } : {})
			}

/**
 * The presences on the session's line, and the moment it reads at. A session
 * with no book reads nothing, at the head.
 */
export async function presencesOnReading(
	db: Db,
	sessionId: number,
	atHour?: ClockTargetV1 | null
): Promise<PresencesOnReading> {
	const placements = await placementsAt(db, sessionId, atHour)
	const reading = await sessionReadingOf(db, sessionId)
	if (!reading) return { rows: [], at: null, placements }
	const stored = await db
		.select()
		.from(schema.castPresences)
		.where(eq(schema.castPresences.lorebookId, reading.lorebookId))
	const presences: Presence[] = stored.map((p) => ({
		id: p.id,
		castId: p.lorebookBindingId,
		branchId: p.branchId,
		personalPosition: p.personalPosition,
		fromYear: p.fromYear,
		fromMonth: p.fromMonth,
		fromDay: p.fromDay,
		untilYear: p.untilYear,
		untilMonth: p.untilMonth,
		untilDay: p.untilDay
	}))
	return {
		placements,
		rows: presencesOnLine(presences, reading.line).map((p) => ({
			bindingId: p.castId,
			from: date(p.fromYear, p.fromMonth, p.fromDay)!,
			until: date(p.untilYear, p.untilMonth, p.untilDay),
			position: p.personalPosition ?? null
		})),
		at: reading.moment
			? {
					...reading.moment,
					label: formatDate(
						reading.moment,
						await bookCalendarOf(db, reading.lorebookId)
					)
				}
			: null
	}
}

type Pair = [number, string]

const pairsOf = (v: unknown): Pair[] | null =>
	Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "string" && p[1].trim())
		? (v as Pair[])
		: null

/**
 * 🚧 **Where each cast member is at an hour** (M0, SHAPES L3): per cast
 * member of the session, the first `schedule` field on the first entry they
 * hold (their zones, as the session reads them) whose entry type declares one;
 * a member with none is left out. The day is the clock target's (`next`: today
 * when the hour is still ahead, else tomorrow; unwired: the present hour,
 * today); a weekend is the last two weekdays of the book calendar's week (a week
 * of 3+ days), with no week every day is a weekday. The pair is the last
 * `[hour, where]` at or before the hour, else the list's last. No clock: nothing.
 */
export async function placementsAt(
	db: Db,
	sessionId: number,
	atHour?: ClockTargetV1 | null
): Promise<{ bindingId: number; where: string }[]> {
	const now = await sessionStoryNowOf(db, sessionId)
	if (!now) return []
	const clock = clockOfNow(now)
	const nowMinutes = (clock.hour ?? 0) * 60 + (clock.minute ?? 0)
	const hour = atHour ? atHour.hour : (clock.hour ?? 0)
	let tomorrow = false
	if (atHour) {
		const day = atHour.day ?? "next"
		tomorrow = day === "tomorrow" || (day === "next" && atHour.hour * 60 + (atHour.minute ?? 0) <= nowMinutes)
	}
	const book = await attachedOrOwnBookOf(db, sessionId)
	const calendar = book == null ? null : await bookCalendarOf(db, book)
	let weekend = false
	const week = calendar?.weekdays ?? []
	if (calendar && week.length >= 3) {
		const index = storyDayIndex({ year: clock.year, month: clock.month ?? undefined, day: clock.day ?? undefined }, calendar)
		if (index !== null) {
			const weekday = (((index + (tomorrow ? 1 : 0) + (calendar.firstWeekday ?? 0)) % week.length) + week.length) % week.length
			weekend = weekday >= week.length - 2
		}
	}
	const [session] = await db
		.select({ rulesetId: schema.sessions.primaryRuleset })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const ruleset = session ? getRuleset(session.rulesetId) : undefined
	if (!ruleset) return []
	const { sessionLinks } = await import("$lib/server/state/resolve")
	const { zonesFor, entryTypesOf, fieldsOf, CARRIED } = await import("$lib/server/rulesets/zones")
	const links = await sessionLinks(db, sessionId)
	const members = links.cast.filter((c) => typeof c.castMemberId === "number")
	// 🚧 ⏳ Flip on (`memberForm.ts`): a seat's own owner and key (`castOwnerOf`, `castLinkKey`); off, its card's.
	// 🚧 ⏳ S4 (flip on): a card-less character seat whose member lives in the read book is read as its member (`seated_member:<id>`), with no card.
	const seated = (links.seatedMembers ?? []).filter(
		(s) => typeof s.castMemberId === "number"
	)
	const seatedKey = (s: { seatMemberId: number }) =>
		`seated_member:${s.seatMemberId}`
	const owners = [
		...members.map((m) => ({ key: castLinkKey(m), owner: castOwnerOf(m) })),
		...seated.map((s) => ({
			key: seatedKey(s),
			owner: { kind: "seated_member" as const, id: s.seatMemberId }
		}))
	]
	const zones = await zonesFor(db, sessionId, ruleset.id, owners)
	const types = entryTypesOf(ruleset)
	const out: { bindingId: number; where: string }[] = []
	const readers = [
		...members.map((m) => ({ key: castLinkKey(m), bindingId: m.castMemberId as number })),
		...seated.map((s) => ({
			key: seatedKey(s),
			bindingId: s.castMemberId as number
		}))
	]
	for (const m of readers) {
		const held = zones[m.key] ?? {}
		const zoneTypes = [CARRIED, ...Object.keys(held).filter((z) => z !== CARRIED)]
		let pairs: Pair[] | null = null
		scan: for (const z of zoneTypes)
			for (const entry of held[z] ?? []) {
				const fields = fieldsOf(types.get(entry.entryType) ?? ({} as never)) as Record<string, FieldDecl>
				const key = Object.keys(fields).find((k) => fields[k]?.type === "schedule")
				if (key === undefined) continue
				const value = entry.fields[key] as { weekday?: unknown; weekend?: unknown } | undefined
				pairs = pairsOf(weekend ? value?.weekend : value?.weekday)
				break scan
			}
		if (!pairs?.length) continue
		const fit = [...pairs].reverse().find(([h]) => h <= hour) ?? pairs[pairs.length - 1]!
		out.push({ bindingId: m.bindingId, where: fit[1] })
	}
	return out
}
