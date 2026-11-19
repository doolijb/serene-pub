/**
 * The host's summarize reads: `summarize_source` (the messages a summary is
 * drawn from, with sender names) and `summarize_span` (a scene's span).
 */

import { and, asc, eq, gte, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { envoySlugOfRef, UNCLAIMED_LINE_NAME, i18nText } from "@serene-pub/sdk"
import { noteMessagesRead } from "$lib/server/pipelines/runtime/loreSources"
import { resolvePersonaName } from "$lib/shared/utils/resolveCharacterName"
import { cardsAsSeatsRead } from "$lib/server/pipelines/prompt/seatCards"
import { cardsNow } from "$lib/server/cast/seatedCast"
import {
	DEFAULT_CHANNEL,
	byLaneThenTime,
	canonicalChannel,
	channelPrefixWhere,
	channelSpansLanes,
	channelWhere,
	parseChannel
} from "$lib/server/messages/channels"
import { assertScoped, toMessage } from "./host.helpers"
import type { HostReadArgs } from "./host.types"

export async function readSummarizeSource(
	{ db, scope, node, q }: HostReadArgs
): Promise<unknown> {
	/**
	 * The messages a summary is drawn from, with sender *names*.
	 *
	 * A separate read from `session_messages` because the two want
	 * different things: retrieval wants the recent window in
	 * reading order; a summary wants a chosen range — possibly
	 * the whole session — and it wants `senderName` resolved, since
	 * the drafting prompt renders speakers and a batch of
	 * "Unknown: ..." lines summarizes a conversation nobody had.
	 *
	 * The selection rule mirrors the legacy handler exactly: an
	 * explicit id list is taken as given (a person picked those
	 * messages, hidden or not); "everything" filters hidden.
	 *
	 * "Everything" means everything *on one channel* (20 §7):
	 * a summary that quietly folded a side conversation into
	 * the account of the main one would be wrong in a way
	 * nothing downstream could detect. A picked list is still
	 * taken as given — the person picked those rows, lane and
	 * all.
	 */
	const sessionId = q.sessionId ?? scope.sessionId
	assertScoped(node, q.sessionId, scope.sessionId)
	if (sessionId === undefined) return []

	const messageIds: number[] | undefined = Array.isArray(
		q.messageIds
	)
		? q.messageIds.map(Number).filter(Number.isFinite)
		: undefined

	const rows = await db
		.select()
		.from(schema.sessionMessages)
		.where(
			messageIds
				? and(
						eq(
							schema.sessionMessages.sessionId,
							sessionId
						),
						inArray(
							schema.sessionMessages.id,
							messageIds
						)
					)
				: and(
						eq(
							schema.sessionMessages.sessionId,
							sessionId
						),
						eq(
							schema.sessionMessages.isHidden,
							false
						),
						channelWhere(
							schema.sessionMessages.channel,
							q.channel
						)
					)
		)
		.orderBy(asc(schema.sessionMessages.id))
		.limit(Math.min(q.limit ?? 5000, 5000))

	const charIds: number[] = [
		...new Set<number>(
			rows
				.filter((m) => m.characterId)
				.map((m) => Number(m.characterId))
		)
	]
	const personaIds: number[] = [
		...new Set<number>(
			rows
				.filter((m) => m.personaId)
				.map((m) => Number(m.personaId))
		)
	]
	// The cards as their current card version has them (never the ⏳ copies).
	const characters = [
		...(await cardsNow(db, charIds)).values()
	]
	const personas = [
		...(await cardsNow(db, personaIds)).values()
	]
	// The cast member's own name wins over the card's (§0-D, 2026-11-04; seat-cast S2).
	const read = await cardsAsSeatsRead(db, sessionId, characters)
	const characterName = new Map(
		// The plain name (the member's own when it gives one), as the card read before — never nickname-first here.
		read.map((c) => [c.id, c.name])
	)
	const personaName = new Map(
		personas.map((p) => [p.id, resolvePersonaName(p)])
	)
	/**
	 * An envoy's line names it by reference and holds no
	 * character (U5g), and a line nobody claimed names nobody:
	 * both are named here — the envoy's declared name, the
	 * narrator name the row carries, else the generic
	 * `UNCLAIMED_LINE_NAME` (ruled 2026-09-26, never "Unknown").
	 */
	const envoyName = new Map<string, string>()
	if (rows.some((m) => envoySlugOfRef((m.metadata as any)?.speaker))) {
		const { sessionDeclaredEnvoys } = await import(
			"$lib/server/pipelines/entities/envoys"
		)
		for (const d of await sessionDeclaredEnvoys(db, sessionId))
			envoyName.set(d.slug, i18nText(d.name, "en") || d.slug)
	}
	const unclaimedName = (m: (typeof rows)[number]): string => {
		const slug = envoySlugOfRef((m.metadata as any)?.speaker)
		return (
			(slug && (envoyName.get(slug) ?? slug)) ||
			(m.metadata as any)?.narratorName ||
			i18nText(UNCLAIMED_LINE_NAME, "en")
		)
	}

	/**
	 * Lane-grouped, like every other whole-channel read — see
	 * the `messages` case above for the rule. A bare slug is the
	 * whole channel (ruling 2026-09-09), and five private
	 * conversations under one slug are five conversations: a
	 * summary of them interleaved by timestamp is an account of
	 * a conversation nobody had.
	 *
	 * Applied AFTER the query, over exactly the rows it
	 * returned, so the window itself is untouched. And not at
	 * all for a picked id list: `channelWhere` never ran for
	 * one, and the person picked those rows lane and all.
	 */
	const ordered =
		!messageIds && channelSpansLanes(q.channel)
			? byLaneThenTime(rows)
			: rows

	const handed = ordered.map((m) => ({
		...toMessage(m),
		senderName:
			(m.characterId &&
				characterName.get(m.characterId)) ||
			(m.personaId && personaName.get(m.personaId)) ||
			(m.role === "user" ? "User" : unclaimedName(m))
	}))
	noteMessagesRead(scope, handed)
	return handed
}

export async function readSummarizeSpan(
	{ db, scope, host, node, q }: HostReadArgs
): Promise<unknown> {
	/**
	 * 🚧 A scene's span, for `core:query/summarize-source@2`
	 * (PROPOSAL-live-scenes §12.2, §14 B): the **story** rows
	 * — one lane, exact, by id between the boundaries — and
	 * the **aside** rows of the named aside channels over the
	 * same ids (every lane of each, prefix-matched), each
	 * attached to the story line it follows.
	 *
	 * Both by message id, the order key of every session read;
	 * hidden rows are left out of a range. A picked id list
	 * (a scene captured by selection) is taken as given for the
	 * story, as `summarize_source` takes it, and its asides are
	 * read over the list's id span.
	 *
	 * Names are `summarize_source`'s, read through it, so the
	 * two cannot name a line differently.
	 */
	const sessionId = q.sessionId ?? scope.sessionId
	assertScoped(node, q.sessionId, scope.sessionId)
	if (sessionId === undefined) return { messages: [], asides: [] }
	const limit = Math.min(Number(q.limit) || 5000, 5000)

	let channel: string | null =
		typeof q.channel === "string" && q.channel
			? canonicalChannel(q.channel)
			: null
	let openedAt: number | null = Number.isInteger(q.openedAt)
		? q.openedAt
		: null
	let closedAt: number | null = Number.isInteger(q.closedAt)
		? q.closedAt
		: null
	let picked: number[] | undefined = Array.isArray(q.messageIds)
		? q.messageIds.map(Number).filter(Number.isFinite)
		: undefined

	// A scene id names its own range — read from the row, and
	// only a scene of THIS session.
	if (q.sceneId != null) {
		const [scene] = await db
			.select({
				sessionId: schema.scenes.sessionId,
				channel: schema.scenes.channel,
				openedAt: schema.scenes.openedAtMessageId,
				closedAt: schema.scenes.closedAtMessageId,
				selected: schema.scenes.selectedMessageIds
			})
			.from(schema.scenes)
			.where(eq(schema.scenes.id, Number(q.sceneId)))
			.limit(1)
		if (!scene || scene.sessionId !== sessionId)
			return { messages: [], asides: [] }
		channel = canonicalChannel(scene.channel)
		if (scene.openedAt != null) {
			openedAt = scene.openedAt
			closedAt = scene.closedAt ?? closedAt
			picked = undefined
		} else if (!picked?.length)
			picked = (scene.selected ?? []) as number[]
	}
	channel ??= DEFAULT_CHANNEL

	let storyIds: number[]
	if (openedAt != null) {
		const rows = await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, sessionId),
					eq(schema.sessionMessages.channel, channel),
					eq(schema.sessionMessages.isHidden, false),
					gte(schema.sessionMessages.id, openedAt),
					closedAt != null
						? sql`${schema.sessionMessages.id} <= ${closedAt}`
						: undefined
				)
			)
			.orderBy(asc(schema.sessionMessages.id))
			.limit(limit)
		storyIds = rows.map((r) => r.id)
	} else storyIds = picked ?? []

	const story = storyIds.length
		? ((await host.read!(
				"summarize_source",
				{ sessionId, messageIds: storyIds, limit },
				node
			)) as Array<Record<string, any>>)
		: []

	// The asides, over the story's id span.
	const asideSlugs: string[] = (
		Array.isArray(q.asides) ? q.asides : []
	).filter(
		(a: unknown): a is string => typeof a === "string" && !!a
	)
	const from = openedAt ?? (storyIds.length ? Math.min(...storyIds) : null)
	const to =
		closedAt ??
		(openedAt == null && storyIds.length
			? Math.max(...storyIds)
			: null)
	let asides: Array<Record<string, any>> = []
	if (asideSlugs.length && from != null) {
		const asideRows = await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, sessionId),
					eq(schema.sessionMessages.isHidden, false),
					gte(schema.sessionMessages.id, from),
					to != null
						? sql`${schema.sessionMessages.id} <= ${to}`
						: undefined,
					sql`(${sql.join(
						asideSlugs.map((slug) =>
							channelPrefixWhere(
								schema.sessionMessages.channel,
								parseChannel(slug).slug
							)
						),
						sql` OR `
					)})`
				)
			)
			.orderBy(asc(schema.sessionMessages.id))
			.limit(limit)
		const named = asideRows.length
			? ((await host.read!(
					"summarize_source",
					{
						sessionId,
						messageIds: asideRows.map((r) => r.id),
						limit
					},
					node
				)) as Array<Record<string, any>>)
			: []
		// Attach each to the story line with the greatest id
		// below it (null: before the first story line), then
		// lane-then-time within each gap.
		const sortedStory = [...storyIds].sort((a, b) => a - b)
		const afterOf = (id: number): number | null => {
			let after: number | null = null
			for (const s of sortedStory) {
				if (s < id) after = s
				else break
			}
			return after
		}
		const gaps = new Map<number | null, Array<Record<string, any>>>()
		for (const row of named) {
			const key = afterOf(Number(row.id))
			const gap = gaps.get(key) ?? []
			gap.push({ ...row, afterMessageId: key })
			gaps.set(key, gap)
		}
		asides = [...gaps.values()].flatMap((gap) =>
			byLaneThenTime(gap as Array<{ channel?: string | null }>)
		) as Array<Record<string, any>>
	}
	// Each row's story-clock stamp (`clock`, null when it has
	// none) — what a transcript's day marks read. Only on this
	// read: the prompt reads stay byte-identical.
	// A lorebook that keeps no timeline gives a transcript no day marks:
	// stored stamps are not read.
	const { sessionTimelineOf } = await import("$lib/server/lorebooks/timeline")
	const stampIds = (await sessionTimelineOf(db, sessionId))
		? [...story, ...asides].map((r) => Number(r.id))
		: []
	if (stampIds.length) {
		const { clockOf } = await import("$lib/server/state/storyTime")
		const stamps = await db
			.select({
				id: schema.sessionMessages.id,
				storyClockYear: schema.sessionMessages.storyClockYear,
				storyClockMonth: schema.sessionMessages.storyClockMonth,
				storyClockDay: schema.sessionMessages.storyClockDay,
				storyClockHour: schema.sessionMessages.storyClockHour,
				storyClockMinute: schema.sessionMessages.storyClockMinute
			})
			.from(schema.sessionMessages)
			.where(inArray(schema.sessionMessages.id, stampIds))
		const clockById = new Map(stamps.map((r) => [r.id, clockOf(r)]))
		for (const row of [...story, ...asides])
			row.clock = clockById.get(Number(row.id)) ?? null
	}
	noteMessagesRead(scope, story)
	noteMessagesRead(scope, asides)
	return { messages: story, asides }
}
