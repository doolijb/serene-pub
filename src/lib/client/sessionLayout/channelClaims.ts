/**
 * Which channels each placed copy of the conversation shows (lair re-plan S1).
 *
 * A `messages` copy with a `channel` setting **claims** that channel: it shows
 * that channel alone, and its composer writes there. A copy with none is a
 * **primary log**: it shows every channel no placed copy claims. So a layout
 * with one Messages widget is the whole session, exactly as before, and the
 * Lair's `messages#sanctum` takes the Sanctum out of the story's log and its
 * channel strip.
 *
 * Pure, so the rule is tested without a page: `SessionLayout` feeds it the
 * placed ids and each one's stored settings, and hands every copy its
 * channels as the dossier's `composer.channels` (the list the conversation
 * shows rows for and writes on).
 */
import { isInstanceOf, parseChannel, type SessionChannelV1 } from "@serene-pub/sdk"
import { NO_LANE_CHANNEL } from "@serene-pub/core-catalog/conversation"
import {
	effectiveWidgetSettings,
	type WidgetSettingsDecl
} from "$lib/shared/widgets/settings"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"

/** The conversation's widget id — the widget every claiming copy is an instance of. */
export const CONVERSATION_WIDGET = "messages"

/** The conversation's declaration — what a copy's `channel` setting is read against. */
function conversationDecl(): WidgetSettingsDecl {
	const w = CORE_WIDGETS.find((d) => d.id === CONVERSATION_WIDGET)
	return {
		id: CONVERSATION_WIDGET,
		title: w?.title ?? "Messages",
		channels: w?.channels,
		settings: w?.settings
	}
}

/**
 * A copy's claim: the non-empty trimmed `channel` of its EFFECTIVE settings,
 * else none. `stored` is the copy's own stored values (its
 * `widget_settings` row); they are read through the one settings reader
 * (`effectiveWidgetSettings`, against the conversation's declaration), so a
 * value the declaration refuses claims nothing here, exactly as it reaches
 * nothing in the widget.
 */
export function claimOf(stored: unknown): string | null {
	const values = effectiveWidgetSettings({ decl: conversationDecl(), stored })
	const raw = values.channel
	if (typeof raw !== "string" || !raw.trim()) return null
	return raw.trim()
}

/** 🚧 The viewer's annex view (`sessionPageData.annex`): owner → key → value. */
export type AnnexView = Readonly<Record<string, Readonly<Record<string, unknown>>>>

/** 🚧 Who is looking, and what the host says of their channels — a lane claim's inputs. */
export interface LaneContext {
	viewerId: number | null | undefined
	/**
	 * ⏳ The viewer's annex view — what the retired `channelLaneFrom` read a
	 * genre's user→lane map from. Read by nothing now (owner ruling
	 * 2026-10-17: lanes by person, on the server); kept so a caller that
	 * still passes it compiles.
	 */
	annex: AnnexView | null | undefined
	/**
	 * 🚧 The session's channels as this viewer has them
	 * (`SessionV1.channels`, from `sessions:get`): `mine` is the viewer's own
	 * lane on a personal channel. Absent — a caller that does not pass it, a
	 * host that does not say — a `channelLane: 'mine'` copy shows its claimed
	 * channel whole, which the server has already narrowed to the lanes the
	 * viewer may read.
	 */
	channels?: ReadonlyArray<SessionChannelV1> | null
}

/**
 * 🚧 Which lane a claiming copy asks for: `mine`, a lane number, or
 * `undefined` (the whole channel). Its `channelLane` setting; ⏳ a stored
 * `channelLaneFrom` (the retired annex-map claim, declared nowhere) reads
 * as `mine` until the layout is saved again.
 */
export function laneAskOf(stored: unknown): "mine" | number | undefined {
	const values = effectiveWidgetSettings({ decl: conversationDecl(), stored })
	const raw = values.channelLane
	if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1) return raw
	if (typeof raw === "string") {
		const text = raw.trim()
		if (text === "mine") return "mine"
		if (/^[1-9][0-9]*$/.test(text)) return Number(text)
	}
	const legacy =
		stored && typeof stored === "object" && !Array.isArray(stored)
			? (stored as Record<string, unknown>).channelLaneFrom
			: undefined
	if (typeof legacy === "string" && legacy.trim()) return "mine"
	return undefined
}

/**
 * 🚧 A claiming copy's lane for this viewer (`channelLane`): an explicit lane
 * string (`parley:2`, and `parley:1` for lane 1 — the lane alone, never the
 * whole channel). `mine` reads the host's `SessionV1.channels[].mine` for
 * the claimed channel; `undefined` (the whole channel, server-narrowed) while
 * the viewer has no lane there, when the host said nothing or the channel is
 * shared. A number is that lane. `undefined` when the copy claims no
 * channel or asks for no lane. Privacy is the server's — this narrows what
 * the viewer may already read (the session's owner reads every lane).
 */
export function laneClaimOf(stored: unknown, ctx: LaneContext): string | undefined {
	const channel = claimOf(stored)
	if (!channel) return undefined
	const ask = laneAskOf(stored)
	if (ask === undefined) return undefined
	const slug = parseChannel(channel).slug
	if (typeof ask === "number") return `${slug}:${ask}`
	const list = ctx.channels
	if (!Array.isArray(list)) return undefined
	const entry = list.find((c) => c && c.slug === slug)
	if (!entry || entry.lanes !== "personal") return undefined
	// 🚧 No lane yet, as this view was told (the 100-turn walk, B2): the
	// whole claimed channel, which the server narrowed to the lanes the
	// viewer may read — a lane opened after the page loaded shows its rows
	// as they arrive, and a line written on the bare slug lands on the
	// sender's own lane. Showing nothing left a guest with no way in.
	if (typeof entry.mine !== "string" || !entry.mine.trim()) return undefined
	const ref = parseChannel(entry.mine)
	if (ref.warning || ref.slug !== slug) return NO_LANE_CHANNEL
	return `${ref.slug}:${ref.lane}`
}

/**
 * 🚧 Every lane claim in a layout (`laneClaimOf`): placed conversation copy →
 * the lane it shows this viewer, for the copies that read one.
 */
export function laneClaims(
	placed: Iterable<string>,
	storedOf: (id: string) => unknown,
	ctx: LaneContext
): Map<string, string> {
	const out = new Map<string, string>()
	for (const id of placed) {
		if (!isInstanceOf(id, CONVERSATION_WIDGET)) continue
		const lane = laneClaimOf(storedOf(id), ctx)
		if (lane) out.set(id, lane)
	}
	return out
}

/**
 * Every claim in a layout: placed conversation copy → the channel it claims.
 * A placed id that is not a conversation copy claims nothing, whatever its
 * settings say. `storedOf` answers each copy's stored values (`claimOf`).
 */
export function channelClaims(
	placed: Iterable<string>,
	storedOf: (id: string) => unknown
): Map<string, string> {
	const out = new Map<string, string>()
	for (const id of placed) {
		if (!isInstanceOf(id, CONVERSATION_WIDGET)) continue
		const claim = claimOf(storedOf(id))
		if (claim) out.set(id, claim)
	}
	return out
}

/**
 * The layout's **primary log**: the first placed instance of `widgetId` (the
 * conversation, or an R71 genre's own primary) that claims no channel, in the
 * reading order the caller passes — middle, left, right; by row, then by
 * column. Else the first placed instance at all, claiming or not; else null.
 *
 * Free placement (brief 7a) is why this is a question: the conversation may
 * sit in a side, and a layout whose every copy claims a channel has no
 * unclaimed log. The phone's stage and Stage only draw this one (./placementRules
 * `stageOf`), and when it is a claiming copy it also shows what no copy claims
 * (`channelsForCopy`), so `main` never vanishes from the session.
 */
export function primaryLogOf(
	readingOrder: Iterable<string>,
	claims: ReadonlyMap<string, string>,
	widgetId: string = CONVERSATION_WIDGET
): string | null {
	const instances = [...readingOrder].filter((id) => isInstanceOf(id, widgetId))
	return instances.find((id) => !claims.has(id)) ?? instances[0] ?? null
}

/**
 * The channels one copy shows. A claiming copy: its channel alone. A primary
 * log: the session's channels less every claimed one — and all of them if
 * that would leave none, because a log with no channel is a log nobody can
 * write in.
 *
 * `primaryLog` is `primaryLogOf`'s answer. When it is a CLAIMING copy — no
 * unclaimed copy is placed — that copy also shows every unclaimed channel,
 * after its own, so removing the story's log from the Lair leaves the story
 * readable in the Sanctum panel rather than nowhere (plan M.3.9).
 */
export function channelsForCopy(
	all: readonly string[],
	claims: ReadonlyMap<string, string>,
	id: string,
	primaryLog: string | null = null,
	lanes: ReadonlyMap<string, string> = new Map()
): string[] {
	const claim = claims.get(id)
	// 🚧 A lane claim (`laneClaims`) narrows the claimed channel to the
	// viewer's lane, or to nothing; the channel stays claimed either way.
	const own = claim ? (lanes.get(id) ?? claim) : undefined
	const claimed = new Set(claims.values())
	const rest = all.filter((c) => !claimed.has(c))
	if (own) return id === primaryLog ? [own, ...rest] : [own]
	return rest.length ? rest : [...all]
}

/**
 * The conversation mounts that hold the page's message ids (`#message-<id>`,
 * which j/k, links and notifications land on) — brief 7b, plan §M.3.8 as
 * amended by its review: every Messages copy whose channels share none with a
 * mount already holding them, taken primary log first, then in reading order.
 *
 * So every row a layout draws is reachable by its page id, and none is on the
 * page twice: the story's log and the Lair's Sanctum both keep their ids (they
 * show different channels), while a second Sanctum or a second view of the
 * story takes its box's prefix (`ComponentMount`'s `pageIds`). A rule of ONE
 * mount — the first draft — left every row only a claiming copy draws (the
 * Sanctum's, Castellan's greeting included) with a prefixed id alone, so a
 * notification aimed at one never landed.
 *
 * `all` is the session's channels (the dossier's `composer.channels`), each
 * copy's own list read through `channelsForCopy`. Before the dossier arrives
 * (`all` empty) an unclaimed copy counts as showing "whatever no copy claims",
 * which is what it shows once the channels are known in every layout but one
 * whose every channel is claimed — so a box is not remounted as the page loads.
 *
 * Always the CONVERSATION's: an R71 genre's own primary is a widget like any
 * other, whose ids are its box's.
 */
export function pageIdsHolders(
	readingOrder: Iterable<string>,
	claims: ReadonlyMap<string, string>,
	all: readonly string[]
): Set<string> {
	const order = [...readingOrder].filter((id) => isInstanceOf(id, CONVERSATION_WIDGET))
	const log = primaryLogOf(order, claims, CONVERSATION_WIDGET)
	const held = new Set<string>()
	if (!log) return held
	const shown = new Set<string>()
	for (const id of [log, ...order.filter((id) => id !== log)]) {
		const mine = channelsShownBy(all, claims, id, log)
		if (mine.some((c) => shown.has(c))) continue
		held.add(id)
		for (const c of mine) shown.add(c)
	}
	return held
}

/** Stands for "every channel no copy claims" while the session's channels are unknown. */
const UNCLAIMED = "\u0000unclaimed"

/** `channelsForCopy`, or — with no channels known yet — the same answer in outline. */
function channelsShownBy(
	all: readonly string[],
	claims: ReadonlyMap<string, string>,
	id: string,
	log: string
): string[] {
	if (all.length) return channelsForCopy(all, claims, id, log)
	const own = claims.get(id)
	if (!own) return [UNCLAIMED]
	return id === log ? [own, UNCLAIMED] : [own]
}
