/**
 * 🚧 The **boundary watcher** (PROPOSAL-live-scenes §4, lane D, 2026-10-13):
 * where a session's scene boundaries come from while it is played, read off
 * what a person or a fixed tick already wrote — never a model.
 *
 * When a line lands (`message-completed`, through `emitSessionEvent`) the
 * watcher reads the session's **scene settings** and evaluates the boundary
 * triggers it has on against the line and the line before it on the same
 * channel lane:
 *
 *  · **day crossed** — the two lines' story-clock stamps fall on different
 *    days (or months, or years, on a coarser clock);
 *  · **time action** — a *Time passes…* press, or a person's step of the
 *    clock, moved it since the line before: `noteTimeAction` left a
 *    `pending` cue on each lane, and this line takes it;
 *  · **place changed** — the place the genre's state names
 *    (`SessionShape.scenes.place`, `scenePlaceOf`: Adventure's and the
 *    Lair's `location`) differs between the two lines — each read off the
 *    state ledger as it stood when that line was written — and from where
 *    the lane's open scene opened (live scenes §15 G2). Any write moves it:
 *    the keeper's, a person's edit, an accepted proposal, a lorebook edit,
 *    and a retraction un-moves it, with no call site to keep in step;
 *  · **narration** — the line is a narrator's or the system's;
 *  · **length** — the scene reached its `lines` lines, or about `tokens`
 *    tokens, before this one;
 *  · **pause** — more than `hours` real hours passed since the line before;
 *  · 🚧 the genre's own **declared triggers** (★9, live scenes §15 G1) —
 *    its summarize-scene spec's `contributes.boundaryTriggers`
 *    (`summarizeScene(…, { boundaries })`): every predicate a trigger states
 *    holds of the line — its `channel`, a `narration`, its `speaker`, the
 *    `actionKey` of the run that wrote it (`runRegistry.actionOf`), a
 *    `stateKey` that changed since the line before. Each is a session
 *    switch (`triggers[key]`, on by default), its cue says its label.
 *
 * What fired becomes **scene cues** at the line (`scene_cues`). In
 * **Suggested** mode they wait as the conversation's *New scene?* chip, and
 * `decideSceneCue` accepts (opens a scene there) or dismisses (*Not here* —
 * the unique index keeps the same trigger at that line from being offered
 * again). In **Automatic** mode the watcher opens the scene at the line
 * itself (`openScene`, which closes the lane's open scene at the line
 * before) and marks the cues `placed`. In **Manual** mode nothing is
 * recorded.
 *
 * Quiet by construction: a session that may not place a scene (no lorebook,
 * a genre that writes none, lore writes Off) records nothing, and nothing
 * here ever fails the write that called it — every entry point catches.
 * Only `main`'s lanes are watched, and any other lane a scene was already
 * placed on (`watchesLane`): a side channel such as the Lair's Sanctum
 * raises no cue of its own — unless a declared trigger names its channel,
 * and then that trigger alone is evaluated there.
 *
 * 🚧 And the open scene's **stored cast** follows the lines (live scenes §15
 * G3): every landed line on a lane with an open scene proposes its cast
 * again (`refreshOpenSceneCast`, no model) and writes it only when it moved
 * — in every mode, Manual included, since a person's own scene has a cast
 * too.
 *
 * ⚠ Not the reply tick (Chat's fixed tick is not a time action: it moves
 * the clock on every reply, so it only ever crosses days) and not a scene
 * write of its own: Automatic mode places through the same `openScene` a
 * person's *Start scene here* does.
 */
import { and, asc, desc, eq, getTableColumns, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm"
import type { ProposedSceneCue, JudgedSceneCheck } from "@serene-pub/contracts"
import { routineRunOf } from "$lib/server/pipelines/routines/runs"
import { routineLog } from "$lib/server/pipelines/routines/log"
import { liveMessageWhere } from "$lib/server/messages/store"
import * as schema from "$lib/server/db/schema"
import { canonicalChannel } from "$lib/server/messages/channels"
import { parseChannel, JUDGED_SCENE_TRIGGER } from "@serene-pub/sdk"
import { clockOf } from "$lib/server/state/storyTime"
import { compareDates, type StoryClock } from "$lib/shared/lorebooks/storyDate"
import { sceneCueReason } from "$lib/shared/sessions/sceneSettings"
import { actionOf } from "$lib/server/pipelines/runtime/runRegistry"
import {
	sessionSceneContext,
	type SessionSceneContext
} from "$lib/server/sessions/sceneSettings"

type CueRow = typeof schema.sceneCues.$inferSelect

/** A refusal worded for the person who decided a cue. */
export class SceneCueRefusal extends Error {}

/** What a scene cue's chip is told, one per line and lane (`ConversationSceneCueV1`). */
export interface OfferedSceneCue {
	id: number
	channel: string
	messageId: number
	triggers: string[]
	reason: string
}

/** What the watcher did at one line. */
export interface WatchResult {
	sessionId: number
	channel: string
	messageId: number
	/** The triggers that fired at the line, in settings order. */
	triggers: string[]
	/** `suggested`: cues recorded; `automatic`: the boundary placed; `refused`: Automatic could not place it, so the cue waits. */
	outcome: "suggested" | "placed" | "refused"
	/** The scene Automatic mode opened, and the one it closed. */
	openedSceneId?: number
	closedSceneId?: number
}

/**
 * 🚧 The cue trigger a person's *End scene here* leaves at the lane's next
 * line (lane E) — not a setting (it cannot be switched off): the person
 * already said the scene ended there.
 */
export const ENDED_HERE_TRIGGER = "endedHere"

const TRIGGER_ORDER = [
	ENDED_HERE_TRIGGER,
	"dayCrossed",
	"timeAction",
	"placeChanged",
	"narration",
	"length",
	"pause"
] as const

/** Core's triggers in settings order, then the genre's declared ones in theirs. */
function triggerOrder(declared: ReadonlyArray<{ key: string }>): string[] {
	return [...TRIGGER_ORDER, ...declared.map((t) => t.key)]
}

/** A declared trigger as the session holds it: its switch and its words. */
type DeclaredTrigger = SessionSceneContext["declaredTriggers"][number]

/** Who voiced a line, as a declared trigger's `speaker` reads it (`BOUNDARY_TRIGGER_SPEAKERS`). */
function speakerOf(line: LineRow): "person" | "character" | "narrator" {
	if (line.role === "user") return "person"
	if (line.characterId != null && line.isNarratorResponse !== true && line.role !== "system")
		return "character"
	return "narrator"
}

/** A narrator or system line — core's *narration* trigger, and a declared trigger's `narration`. */
const isNarrationLine = (line: LineRow) =>
	line.isNarratorResponse === true || line.role === "system"

/**
 * A declared trigger's `channel` names this lane: a slug every lane of it
 * (`sanctum` ≡ `sanctum:2`), a lane that one.
 */
function namesLane(predicate: string, channel: string): boolean {
	return predicate.includes(":")
		? canonicalChannel(predicate) === channel
		: parseChannel(channel).slug === parseChannel(predicate).slug
}

const dayOf = (c: StoryClock) => ({
	year: c.year,
	month: c.month ?? null,
	day: c.month != null ? (c.day ?? null) : null
})

/** The two stamps fall on different days — or months, or years, as precise as both are. */
export function crossesDay(
	before: StoryClock | null,
	after: StoryClock | null
): boolean {
	if (!before || !after) return false
	return compareDates(dayOf(before), dayOf(after)) !== 0
}

/** About how many tokens a line is — four characters each, deterministic. */
const roughTokens = (text: string | null | undefined) =>
	Math.ceil((text ?? "").length / 4)

const LINE_COLUMNS = {
	id: schema.sessionMessages.id,
	sessionId: schema.sessionMessages.sessionId,
	channel: schema.sessionMessages.channel,
	role: schema.sessionMessages.role,
	characterId: schema.sessionMessages.characterId,
	content: schema.sessionMessages.content,
	isNarratorResponse: schema.sessionMessages.isNarratorResponse,
	isHidden: schema.sessionMessages.isHidden,
	isGenerating: schema.sessionMessages.isGenerating,
	storyClockYear: schema.sessionMessages.storyClockYear,
	storyClockMonth: schema.sessionMessages.storyClockMonth,
	storyClockDay: schema.sessionMessages.storyClockDay,
	storyClockHour: schema.sessionMessages.storyClockHour,
	storyClockMinute: schema.sessionMessages.storyClockMinute
} as const

/** One line as the watcher reads it. */
type LineRow = NonNullable<Parameters<typeof clockOf>[0]> & {
	id: number
	role: string
	characterId: number | null
	isNarratorResponse: boolean | null
}

/** When a line was written, to the millisecond — the native row's (the legacy column holds a day). */
async function writtenAt(db: Db, messageId: number): Promise<number | null> {
	const [row] = await db
		.select({ createdAt: schema.messages.createdAt })
		.from(schema.messages)
		.where(eq(schema.messages.id, messageId))
		.limit(1)
	const t = row?.createdAt ? new Date(row.createdAt as any).getTime() : NaN
	return Number.isFinite(t) ? t : null
}

/**
 * Where the lane's current scene began for the length trigger: the open
 * scene's first line, else the line after the latest closed scene's last,
 * else the lane's first line (0).
 */
async function sceneStartOf(
	db: Db,
	sessionId: number,
	channel: string
): Promise<number> {
	const rows = await db
		.select({
			opened: schema.scenes.openedAtMessageId,
			closed: schema.scenes.closedAtMessageId
		})
		.from(schema.scenes)
		.where(
			and(
				eq(schema.scenes.sessionId, sessionId),
				eq(schema.scenes.channel, channel),
				sql`${schema.scenes.openedAtMessageId} IS NOT NULL`
			)
		)
	let start = 0
	for (const r of rows) {
		if (r.closed == null) return r.opened!
		start = Math.max(start, r.closed + 1)
	}
	return start
}

/** The open range scene on a lane, if any — where *place changed* compares from. */
async function openSceneOn(
	db: Db,
	sessionId: number,
	channel: string
): Promise<{ id: number; openedAtMessageId: number } | null> {
	const [row] = await db
		.select({ id: schema.scenes.id, openedAtMessageId: schema.scenes.openedAtMessageId })
		.from(schema.scenes)
		.where(
			and(
				eq(schema.scenes.sessionId, sessionId),
				eq(schema.scenes.channel, channel),
				sql`${schema.scenes.openedAtMessageId} IS NOT NULL`,
				sql`${schema.scenes.closedAtMessageId} IS NULL`
			)
		)
		.limit(1)
	return row ? { id: row.id, openedAtMessageId: row.openedAtMessageId! } : null
}

/**
 * The triggers that fire at `line`, given the line before it on its lane:
 * core's (only on a lane `watchesLane` watches — `core`) and the genre's
 * declared ones that apply here (`declared`, already switched on and
 * matched to the lane), in `triggerOrder`.
 */
async function firedTriggers(
	db: Db,
	ctx: SessionSceneContext,
	line: LineRow,
	channel: string,
	opts: { core: boolean; declared: readonly DeclaredTrigger[]; runIds: readonly string[] }
): Promise<string[]> {
	const t = ctx.settings.triggers
	const fired = new Set<string>()
	const [prev] = await db
		.select(LINE_COLUMNS)
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, ctx.sessionId),
				eq(schema.sessionMessages.channel, channel),
				eq(schema.sessionMessages.isHidden, false),
				lt(schema.sessionMessages.id, line.id)
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)

	// One reader of the world's state keys for every read at this line — the
	// place's and the declared triggers' — so the session's links and
	// vocabulary are read once.
	let reader: Awaited<ReturnType<typeof import("$lib/server/scenes/liveScenes").worldStateReader>> | null = null
	const stateAt = async (key: string, messageId: number) => {
		if (!reader) {
			const { worldStateReader } = await import("$lib/server/scenes/liveScenes")
			reader = await worldStateReader(db, ctx.sessionId)
		}
		return reader(key, { messageId })
	}

	if (opts.core) {
		{
			// The pending cue an *End scene here* at the lane's newest line left
			// is this line's now, whatever triggers are on.
			const ended = await db
				.update(schema.sceneCues)
				.set({ atMessageId: line.id, state: "open" })
				.where(
					and(
						eq(schema.sceneCues.sessionId, ctx.sessionId),
						eq(schema.sceneCues.channel, channel),
						eq(schema.sceneCues.trigger, ENDED_HERE_TRIGGER),
						isNull(schema.sceneCues.atMessageId)
					)
				)
				.returning({ id: schema.sceneCues.id })
			if (ended.length) fired.add(ENDED_HERE_TRIGGER)
		}
		if (t.timeAction) {
			// The pending cue a time action left on this lane is this line's now.
			const bound = await db
				.update(schema.sceneCues)
				.set({ atMessageId: line.id, state: "open" })
				.where(
					and(
						eq(schema.sceneCues.sessionId, ctx.sessionId),
						eq(schema.sceneCues.channel, channel),
						eq(schema.sceneCues.trigger, "timeAction"),
						isNull(schema.sceneCues.atMessageId)
					)
				)
				.returning({ id: schema.sceneCues.id })
			if (bound.length) fired.add("timeAction")
		}
		if (prev) {
			if (t.dayCrossed && crossesDay(clockOf(prev), clockOf(line)))
				fired.add("dayCrossed")
			if (t.placeChanged && ctx.placeKey) {
				// 🚧 G2: the place as it stood when each line was written,
				// and where the lane's open scene opened — a move and back
				// again inside one scene is no new scene.
				const key = ctx.placeKey
				const [before, now] = [await stateAt(key, prev.id), await stateAt(key, line.id)]
				if (before && now && before !== now) {
					const open = await openSceneOn(db, ctx.sessionId, channel)
					const openedAt =
						open && open.openedAtMessageId !== line.id
							? await stateAt(key, open.openedAtMessageId)
							: null
					if (openedAt === null || openedAt !== now) fired.add("placeChanged")
				}
			}
			if (t.pause) {
				const [a, b] = await Promise.all([
					writtenAt(db, prev.id),
					writtenAt(db, line.id)
				])
				if (a != null && b != null && b - a > t.pause.hours * 3_600_000)
					fired.add("pause")
			}
			if (t.length) {
				const start = await sceneStartOf(db, ctx.sessionId, channel)
				const before = await db
					.select({ content: schema.sessionMessages.content })
					.from(schema.sessionMessages)
					.where(
						and(
							eq(schema.sessionMessages.sessionId, ctx.sessionId),
							eq(schema.sessionMessages.channel, channel),
							eq(schema.sessionMessages.isHidden, false),
							gte(schema.sessionMessages.id, start),
							lt(schema.sessionMessages.id, line.id)
						)
					)
					.orderBy(asc(schema.sessionMessages.id))
				const n = before.length
				const { lines, tokens } = t.length
				// The scene already holds a multiple of `lines` lines: this one
				// would be the first of the next.
				if (lines && n > 0 && n % lines === 0) fired.add("length")
				if (tokens && n > 0) {
					const total = before.reduce((sum, r) => sum + roughTokens(r.content), 0)
					const last = roughTokens(before[n - 1]?.content)
					if (Math.floor(total / tokens) > Math.floor((total - last) / tokens))
						fired.add("length")
				}
			}
		}
		if (t.narration && isNarrationLine(line)) fired.add("narration")
	}

	// 🚧 G1 (★9): the genre's declared triggers — every predicate stated holds.
	if (opts.declared.length) {
		const actionKeys = opts.declared.some((d) => d.when.actionKey !== undefined)
			? await actionKeysOf(opts.runIds)
			: []
		for (const d of opts.declared) {
			const w = d.when
			if (w.channel !== undefined && !namesLane(w.channel, channel)) continue
			if (w.narration !== undefined && isNarrationLine(line) !== w.narration) continue
			if (w.speaker !== undefined && speakerOf(line) !== w.speaker) continue
			if (w.actionKey !== undefined && !actionKeys.includes(w.actionKey)) continue
			if (w.stateKey !== undefined) {
				if (!prev) continue
				const [before, now] = [await stateAt(w.stateKey, prev.id), await stateAt(w.stateKey, line.id)]
				if (!before || !now || before === now) continue
			}
			fired.add(d.key)
		}
	}
	return triggerOrder(ctx.declaredTriggers).filter((k) => fired.has(k))
}

/** The action keys of the runs that wrote a line — the run itself and its tree's root (`RunHandle.action`). */
async function actionKeysOf(runIds: readonly string[]): Promise<string[]> {
	const identities = runIds.map((id) => actionOf(id)).filter((a): a is string => !!a)
	if (!identities.length) return []
	const { parseActionIdentity } = await import("$lib/shared/actions/identity")
	return identities.flatMap((identity) => {
		const key = parseActionIdentity(identity)?.key
		return key ? [key] : []
	})
}

/**
 * Evaluate the boundary triggers at one landed line, and record or place
 * what fired. Null when nothing fired, the session places no scene, its mode
 * is Manual, or the line is hidden, generating or gone. Never throws: a
 * failure is logged and the line stands.
 *
 * `runIds` are the run that wrote the line and its tree's root, when a run
 * did (`message-completed`'s cause): what a declared trigger's `actionKey`
 * reads. 🚧 Then, whatever fired, the lane's open scene's stored cast is
 * brought up to date (live scenes §15 G3, `refreshOpenSceneCast`).
 */
export async function watchSceneBoundaries(
	db: Db,
	params: { sessionId: number; messageId: number; io?: unknown; runIds?: readonly string[] }
): Promise<WatchResult | null> {
	let result: WatchResult | null = null
	try {
		result = await watch(db, params)
	} catch (err) {
		console.warn("[scenes] the boundary watcher skipped a line:", err)
	}
	// A boundary Automatic just placed wrote the new scene's cast already.
	if (result?.outcome !== "placed") await followOpenSceneCast(db, params)
	return result
}

/**
 * 🚧 G3: the open scene on the landed line's lane proposes its cast again
 * and stores it when it moved (`refreshOpenSceneCast`), then tells the
 * session's pages (`scenes:list`, whose rows carry the cast the divider's
 * faces draw). A session reading no book has no scene. Never throws.
 */
async function followOpenSceneCast(
	db: Db,
	params: { sessionId: number; messageId: number; io?: unknown }
): Promise<void> {
	try {
		const [line] = await db
			.select({
				channel: schema.sessionMessages.channel,
				isHidden: schema.sessionMessages.isHidden,
				isGenerating: schema.sessionMessages.isGenerating
			})
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.id, params.messageId),
					eq(schema.sessionMessages.sessionId, params.sessionId)
				)
			)
			.limit(1)
		if (!line || line.isHidden || line.isGenerating) return
		const { refreshOpenSceneCast } = await import("$lib/server/scenes/liveScenes")
		const moved = await refreshOpenSceneCast(db, {
			sessionId: params.sessionId,
			channel: canonicalChannel(line.channel),
			messageId: params.messageId
		})
		if (moved && params.io) {
			const [owner] = await db
				.select({ userId: schema.sessions.userId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, params.sessionId))
				.limit(1)
			if (owner) {
				const { pushSceneList } = await import("$lib/server/sockets/scenes")
				await pushSceneList(params.io, { sessionId: params.sessionId, userId: owner.userId })
			}
		}
	} catch (err) {
		console.warn("[scenes] the open scene's cast was not refreshed:", err)
	}
}

/**
 * Which lanes core's triggers watch: `main`'s, and any other lane a scene
 * was already placed on. A genre's side channel — the Lair's Sanctum, the
 * table outside the story — raises no cue of core's until someone has
 * started a scene there; a genre's declared trigger that names a channel
 * (★9) is evaluated on that channel's lanes alone (`watch`).
 */
async function watchesLane(db: Db, sessionId: number, channel: string): Promise<boolean> {
	if (parseChannel(channel).slug === "main") return true
	const [row] = await db
		.select({ id: schema.scenes.id })
		.from(schema.scenes)
		.where(
			and(
				eq(schema.scenes.sessionId, sessionId),
				eq(schema.scenes.channel, channel),
				sql`${schema.scenes.openedAtMessageId} IS NOT NULL`
			)
		)
		.limit(1)
	return !!row
}

async function watch(
	db: Db,
	params: { sessionId: number; messageId: number; io?: unknown; runIds?: readonly string[] }
): Promise<WatchResult | null> {
	const ctx = await sessionSceneContext(db, params.sessionId)
	if (!ctx || !ctx.mayPlace || ctx.settings.mode === "manual") return null
	const [line] = await db
		.select(LINE_COLUMNS)
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.id, params.messageId),
				eq(schema.sessionMessages.sessionId, params.sessionId)
			)
		)
		.limit(1)
	if (!line || line.isHidden || line.isGenerating) return null
	const channel = canonicalChannel(line.channel)
	const core = await watchesLane(db, ctx.sessionId, channel)
	// A declared trigger that names a channel is evaluated on its lanes
	// alone; one that names none, on the lanes core's are.
	const declared = ctx.declaredTriggers.filter(
		(d) =>
			d.on &&
			(d.when.channel !== undefined ? namesLane(d.when.channel, channel) : core)
	)
	if (!core && !declared.length) return null
	const triggers = await firedTriggers(db, ctx, line, channel, {
		core,
		declared,
		runIds: params.runIds ?? []
	})
	if (!triggers.length) return null

	// Record every trigger at the line — the time action's and an *End
	// scene here*'s were bound above.
	const fresh = triggers.filter(
		(t) => t !== "timeAction" && t !== ENDED_HERE_TRIGGER
	)
	if (fresh.length)
		await db
			.insert(schema.sceneCues)
			.values(
				fresh.map((trigger) => ({
					sessionId: ctx.sessionId,
					channel,
					atMessageId: line.id,
					trigger,
					state: "open" as const
				}))
			)
			.onConflictDoNothing()

	const base = {
		sessionId: ctx.sessionId,
		channel,
		messageId: line.id,
		triggers
	}
	if (ctx.settings.mode !== "automatic") {
		await pushSceneCues(params.io, ctx.sessionId)
		return { ...base, outcome: "suggested" }
	}

	// Automatic: the boundary is placed here, as the owner's own *Start
	// scene here* would place it.
	const { openScene, SceneBoundaryRefusal } = await import(
		"$lib/server/scenes/liveScenes"
	)
	let opened
	try {
		opened = await openScene(db, {
			sessionId: ctx.sessionId,
			userId: ctx.ownerId,
			channel,
			atMessageId: line.id,
			// 🚧 The watcher placed it (Automatic), not a person.
			cause: { kind: "system" }
		})
	} catch (err) {
		if (!(err instanceof SceneBoundaryRefusal)) throw err
		// Not placeable here (the line is in a scene captured by
		// selection, say): the cue waits, so the person sees why if they
		// try it.
		await pushSceneCues(params.io, ctx.sessionId)
		return { ...base, outcome: "refused" }
	}
	await markCuesAt(db, ctx.sessionId, channel, line.id, "placed")
	const { afterBoundaryPlaced } = await import("$lib/server/sockets/scenes")
	await afterBoundaryPlaced(params.io, {
		sessionId: ctx.sessionId,
		userId: ctx.ownerId,
		closedSceneIds: opened.closedScene ? [opened.closedScene.id] : []
	})
	return {
		...base,
		outcome: "placed",
		openedSceneId: opened.scene.id,
		...(opened.closedScene ? { closedSceneId: opened.closedScene.id } : {})
	}
}

/** Mark every open cue at one line of a lane. */
async function markCuesAt(
	db: Db,
	sessionId: number,
	channel: string,
	messageId: number,
	state: "accepted" | "dismissed" | "placed"
): Promise<void> {
	await db
		.update(schema.sceneCues)
		.set({ state, decidedAt: new Date() })
		.where(
			and(
				eq(schema.sceneCues.sessionId, sessionId),
				eq(schema.sceneCues.channel, channel),
				eq(schema.sceneCues.atMessageId, messageId),
				eq(schema.sceneCues.state, "open")
			)
		)
}

/**
 * A **time action** moved the session's clock — a *Time passes…* press, a
 * person's step or set: leave a `pending` cue on each lane that may take it
 * (every lane with an open scene, and `main`), for that lane's next line to
 * take (`watchSceneBoundaries`). Nothing when the session places no scene,
 * is Manual, or has the trigger off. Never throws.
 */
export async function noteTimeAction(
	db: Db,
	params: {
		sessionId: number
		/**
		 * 🚧 Who moved the clock (live scenes §15, for lane H's call sites):
		 * an action run's *Advance story clock* (`action`), the keeper's
		 * proposal accepted or applied (`keeper`), a person's step or set
		 * (`person`) — each a time action — or a fixed tick (`tick`: Chat's
		 * reply tick, which moves the clock on every reply and so is never
		 * one). Absent counts, as before.
		 */
		cause?: "action" | "keeper" | "person" | "tick"
	}
): Promise<void> {
	if (params.cause === "tick") return
	try {
		const ctx = await sessionSceneContext(db, params.sessionId)
		if (!ctx || !ctx.mayPlace || ctx.settings.mode === "manual") return
		if (!ctx.settings.triggers.timeAction) return
		const open = await db
			.select({ channel: schema.scenes.channel })
			.from(schema.scenes)
			.where(
				and(
					eq(schema.scenes.sessionId, params.sessionId),
					sql`${schema.scenes.openedAtMessageId} IS NOT NULL`,
					sql`${schema.scenes.closedAtMessageId} IS NULL`
				)
			)
		const channels = [...new Set(["main", ...open.map((r) => r.channel)])]
		await db
			.insert(schema.sceneCues)
			.values(
				channels.map((channel) => ({
					sessionId: params.sessionId,
					channel,
					atMessageId: null,
					trigger: "timeAction",
					state: "pending" as const
				}))
			)
			.onConflictDoNothing()
	} catch (err) {
		console.warn("[scenes] a time action was not noted:", err)
	}
}

/**
 * 🚧 What follows a person's *End scene here* (live scenes §7, lane E): the
 * scene closed at `endedAt`; the session's scene mode decides the next.
 *
 *  · **Automatic** — the next scene opens at the lane's following line
 *    (`openScene`, as the owner's *Start scene here* would);
 *  · **Suggested** — a scene cue waits at the following line, the
 *    conversation's *New scene?* chip (trigger `endedHere`);
 *  · **Manual** — nothing: the close was all.
 *
 * With no following line yet, a `pending` cue waits for the lane's next line
 * (`watchSceneBoundaries` binds it, then opens or offers as the mode says).
 * A following line Automatic cannot open at (captured by selection, say)
 * gets the cue instead, so the person sees why. Never throws: the close
 * stands either way.
 */
export async function followEndedScene(
	db: Db,
	params: { sessionId: number; channel: string; endedAt: number; userId: number }
): Promise<{
	opened?: import("$lib/server/scenes/liveScenes").LiveSceneResult
	cued: boolean
}> {
	try {
		const ctx = await sessionSceneContext(db, params.sessionId)
		if (!ctx || !ctx.mayPlace || ctx.settings.mode === "manual")
			return { cued: false }
		const channel = canonicalChannel(params.channel)
		const [next] = await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, params.sessionId),
					eq(schema.sessionMessages.channel, channel),
					eq(schema.sessionMessages.isHidden, false),
					sql`${schema.sessionMessages.id} > ${params.endedAt}`
				)
			)
			.orderBy(asc(schema.sessionMessages.id))
			.limit(1)
		if (next && ctx.settings.mode === "automatic") {
			const { openScene, SceneBoundaryRefusal } = await import(
				"$lib/server/scenes/liveScenes"
			)
			try {
				const opened = await openScene(db, {
					sessionId: params.sessionId,
					userId: params.userId,
					channel,
					atMessageId: next.id
				})
				return { opened, cued: false }
			} catch (err) {
				if (!(err instanceof SceneBoundaryRefusal)) throw err
			}
		}
		await db
			.insert(schema.sceneCues)
			.values({
				sessionId: params.sessionId,
				channel,
				atMessageId: next?.id ?? null,
				trigger: ENDED_HERE_TRIGGER,
				state: next ? ("open" as const) : ("pending" as const)
			})
			.onConflictDoNothing()
		return { cued: true }
	} catch (err) {
		console.warn("[scenes] what follows an ended scene was skipped:", err)
		return { cued: false }
	}
}

/**
 * The scene cues a session offers now — `open` cues at a line past the
 * lane's latest scene boundary (a scene opened at or after the line makes
 * its cue moot) — one per line and lane, the triggers together, oldest
 * first.
 */
export async function offeredSceneCues(
	db: Db,
	sessionId: number
): Promise<OfferedSceneCue[]> {
	// The genre's declared triggers say their own words, after core's (★9).
	const { sessionBoundaryTriggers } = await import("$lib/server/scenes/liveScenes")
	const declared = await sessionBoundaryTriggers(db, sessionId).catch(() => [])
	const order = triggerOrder(declared)
	const { i18nText } = await import("@serene-pub/sdk")
	const labels = Object.fromEntries(declared.map((d) => [d.key, i18nText(d.label) ?? d.key]))
	// A cue at a rewound row is not offered (pr-6 A2).
	const cues = await db
		.select(getTableColumns(schema.sceneCues))
		.from(schema.sceneCues)
		.innerJoin(
			schema.sessionMessages,
			eq(schema.sessionMessages.id, schema.sceneCues.atMessageId)
		)
		.where(
			and(
				eq(schema.sceneCues.sessionId, sessionId),
				eq(schema.sceneCues.state, "open"),
				liveMessageWhere()
			)
		)
		.orderBy(asc(schema.sceneCues.atMessageId), asc(schema.sceneCues.id))
	if (!cues.length) return []
	const scenes = await db
		.select({
			channel: schema.scenes.channel,
			opened: schema.scenes.openedAtMessageId,
			closed: schema.scenes.closedAtMessageId
		})
		.from(schema.scenes)
		.where(
			and(
				eq(schema.scenes.sessionId, sessionId),
				sql`${schema.scenes.openedAtMessageId} IS NOT NULL`
			)
		)
	const latest = new Map<string, number>()
	for (const s of scenes) {
		const edge = Math.max(s.opened ?? 0, s.closed ?? 0)
		latest.set(s.channel, Math.max(latest.get(s.channel) ?? 0, edge))
	}
	const byLine = new Map<string, OfferedSceneCue>()
	const judgedReason = new Map<string, string>()
	for (const c of cues as CueRow[]) {
		const at = c.atMessageId!
		if (at <= (latest.get(c.channel) ?? 0)) continue
		const key = `${c.channel}#${at}`
		if (c.trigger === JUDGED_SCENE_TRIGGER)
			judgedReason.set(key, c.reason?.trim() || JUDGED_CUE_FALLBACK_REASON)
		const had = byLine.get(key)
		if (had) {
			if (!had.triggers.includes(c.trigger)) had.triggers.push(c.trigger)
			continue
		}
		byLine.set(key, {
			id: c.id,
			channel: c.channel,
			messageId: at,
			triggers: [c.trigger],
			reason: ""
		})
	}
	const rank = (t: string) => {
		const i = order.indexOf(t)
		return i === -1 ? order.length : i
	}
	return [...byLine.values()].map((cue) => {
		cue.triggers.sort((a, b) => rank(a) - rank(b))
		const judged = judgedReason.get(`${cue.channel}#${cue.messageId}`)
		return {
			...cue,
			reason: sceneCueReason(
				cue.triggers,
				judged === undefined ? labels : { ...labels, [JUDGED_SCENE_TRIGGER]: judged }
			)
		}
	})
}

/**
 * Decide one scene cue, as the session's owner: accept opens a scene at its
 * line (the lane's open scene closing at the line before); dismiss (*Not
 * here*) marks every cue at the line dismissed, so none is offered there
 * again. Refuses a cue that is gone, decided, or not the asker's session's.
 */
export async function decideSceneCue(
	db: Db,
	params: { cueId: number; userId: number; accept: boolean }
): Promise<{
	sessionId: number
	sceneId: number | null
	opened?: import("$lib/server/scenes/liveScenes").LiveSceneResult
}> {
	const [cue] = await db
		.select()
		.from(schema.sceneCues)
		.where(eq(schema.sceneCues.id, Number(params.cueId)))
		.limit(1)
	if (!cue || cue.atMessageId == null)
		throw new SceneCueRefusal("That suggestion is gone.")
	const [live] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(and(eq(schema.sessionMessages.id, cue.atMessageId), liveMessageWhere()))
		.limit(1)
	if (!live) throw new SceneCueRefusal("That suggestion is gone.")
	const [session] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, cue.sessionId))
		.limit(1)
	if (!session || session.userId !== params.userId)
		throw new SceneCueRefusal("Only the session's owner decides where its scenes begin.")
	if (cue.state !== "open")
		throw new SceneCueRefusal(
			cue.state === "dismissed"
				? "That suggestion was already set aside."
				: "That suggestion was already taken."
		)
	if (!params.accept) {
		await markCuesAt(db, cue.sessionId, cue.channel, cue.atMessageId, "dismissed")
		return { sessionId: cue.sessionId, sceneId: null }
	}
	const { openScene } = await import("$lib/server/scenes/liveScenes")
	const opened = await openScene(db, {
		sessionId: cue.sessionId,
		userId: params.userId,
		channel: cue.channel,
		atMessageId: cue.atMessageId
	})
	await markCuesAt(db, cue.sessionId, cue.channel, cue.atMessageId, "accepted")
	return { sessionId: cue.sessionId, sceneId: opened.scene.id, opened }
}

/**
 * Tell the session's open pages its cues and settings moved (`scenes:cues`,
 * lazily — paid only when a page holds the key). A no-op with no socket
 * server (a test, a script).
 */
export async function pushSceneCues(io: unknown, sessionId: number): Promise<void> {
	if (!io) return
	try {
		const [{ broadcastToSessionUsers }, { buildSceneCuesReply }] = await Promise.all([
			import("$lib/server/sockets/utils/broadcastHelpers"),
			import("$lib/server/sockets/scenes")
		])
		await broadcastToSessionUsers(io as any, sessionId, "scenes:cues", () =>
			buildSceneCuesReply(sessionId)
		)
	} catch (err) {
		console.warn("[scenes] the scene cues were not pushed:", err)
	}
}

/**
 * 🚧 The judged scene check's length condition (pr-6s2, pass 7: "default 6"):
 * a scene shorter than this is never worth a call.
 */
export const JUDGED_SCENE_MIN_LINES = 6

/** What a judged cue's chip says when its stored reason is empty (defensive: the commit refuses a blank reason). */
export const JUDGED_CUE_FALLBACK_REASON = "the story moved on"

/** The live lines of a session on one lane: the rows the judged duty reads and places a cue at. */
function liveLinesWhere(sessionId: number, channel: string) {
	return and(
		eq(schema.sessionMessages.sessionId, sessionId),
		eq(schema.sessionMessages.channel, channel),
		liveMessageWhere(),
		eq(schema.sessionMessages.isHidden, false),
		eq(schema.sessionMessages.isGenerating, false)
	)
}

/**
 * 🚧 The judged scene check, asked before the model is (pass 7, R-i;
 * pr6s2-G-shapes.md §G-5a, I's §I-4 conditions). Read-only: due with the
 * lines the model reads, or not due with a receipt note.
 */
export async function judgedSceneCheckOf(
	db: Db,
	sessionId: number,
	opts: { runId?: string | null }
): Promise<JudgedSceneCheck> {
	const channel = "main"
	const ctx = await sessionSceneContext(db, sessionId)
	if (!ctx || !ctx.mayPlace) return { due: false, why: "off: this session places no scenes" }
	if (ctx.settings.mode === "manual") return { due: false, why: "off: scenes are Manual here" }

	const open = await openSceneOn(db, sessionId, channel)
	let base: number
	let inclusive: boolean
	if (open) {
		base = open.openedAtMessageId
		inclusive = true
	} else {
		const rows = await db
			.select({ closed: schema.scenes.closedAtMessageId })
			.from(schema.scenes)
			.where(
				and(
					eq(schema.scenes.sessionId, sessionId),
					eq(schema.scenes.channel, channel),
					sql`${schema.scenes.openedAtMessageId} IS NOT NULL`
				)
			)
		base = rows.reduce((m, r) => Math.max(m, r.closed ?? 0), 0)
		inclusive = false
	}
	const live = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(liveLinesWhere(sessionId, channel))
		.orderBy(asc(schema.sessionMessages.id))
	const sinceBase = live.map((r) => r.id).filter((id) => (inclusive ? id >= base : id > base))
	if (sinceBase.length < JUDGED_SCENE_MIN_LINES)
		return { due: false, why: `off: fewer than ${JUDGED_SCENE_MIN_LINES} lines since the scene began` }

	// The routine's previous firing bounds what the model has already seen.
	let lastLook = 0
	let lastLookAt: Date | null = null
	const key = routineRunOf(opts.runId)?.registrationKey
	if (key) {
		const log = await routineLog(db, sessionId, { limit: 50 })
		const prev = log.find(
			(e) => e.registrationKey === key && e.kind === "ran" && e.runId !== opts.runId
		)
		if (prev) {
			const at = new Date(prev.startedAt)
			const [row] = await db
				.select({ id: schema.sessionMessages.id })
				.from(schema.sessionMessages)
				.innerJoin(schema.messages, eq(schema.messages.id, schema.sessionMessages.id))
				.where(and(liveLinesWhere(sessionId, channel), lte(schema.messages.createdAt, at)))
				.orderBy(desc(schema.sessionMessages.id))
				.limit(1)
			if (row) {
				lastLook = row.id
				lastLookAt = await writtenAt(db, row.id).then((t) => (t == null ? null : new Date(t)))
			}
		}
	}
	// A new scene begins after the open one's opening (or the last boundary), never at it.
	const from = Math.max(base, lastLook)
	const lines = sinceBase.filter((id) => id > from).slice(-20)
	if (!lines.length) return { due: false, why: "off: nothing new since the last look" }

	const cues = await db
		.select({
			atMessageId: schema.sceneCues.atMessageId,
			trigger: schema.sceneCues.trigger,
			state: schema.sceneCues.state,
			decidedAt: schema.sceneCues.decidedAt
		})
		.from(schema.sceneCues)
		.where(
			and(eq(schema.sceneCues.sessionId, sessionId), eq(schema.sceneCues.channel, channel))
		)
	const inLines = new Set(lines)
	if (cues.some((c) => c.trigger !== JUDGED_SCENE_TRIGGER && c.atMessageId != null && inLines.has(c.atMessageId)))
		return { due: false, why: "off: a scene trigger already fired in these lines" }
	if (cues.some((c) => c.state === "open" || c.state === "pending"))
		return { due: false, why: "off: a scene cue is already waiting" }
	if (
		cues.some(
			(c) =>
				c.trigger === JUDGED_SCENE_TRIGGER &&
				c.state === "dismissed" &&
				(lastLook === 0 ||
					(c.decidedAt != null && lastLookAt != null && c.decidedAt.getTime() > lastLookAt.getTime()))
		)
	)
		return { due: false, why: "off: the last suggestion was set aside" }
	return { due: true, channel, lines }
}

/**
 * 🚧 The judged scene check's answer, committed (pass 7, R-i;
 * pr6s2-G-shapes.md §G-5a): a `judged` scene cue at its line, the scene mode
 * deciding — Automatic places the boundary, Suggested (or `ask`) offers the
 * chip, Manual records nothing.
 */
export async function proposeJudgedSceneCue(
	db: Db,
	params: {
		sessionId: number
		channel: string
		atMessageId: number
		reason: string
		ask?: boolean
		io?: unknown
	}
): Promise<ProposedSceneCue> {
	const { sessionId, atMessageId } = params
	const channel = canonicalChannel(params.channel)
	const reason = String(params.reason ?? "").trim().slice(0, 200)
	const ctx = await sessionSceneContext(db, sessionId)
	if (!ctx || !ctx.mayPlace) return { outcome: "skipped", note: "this session places no scenes" }
	if (ctx.settings.mode === "manual")
		return { outcome: "skipped", note: "the scene mode is Manual, so a judged cue is never placed or offered" }
	if (!reason) return { outcome: "refused", note: "a judged cue needs its reason" }
	const [line] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(and(liveLinesWhere(sessionId, channel), eq(schema.sessionMessages.id, atMessageId)))
		.limit(1)
	if (!line)
		return { outcome: "refused", note: `message ${atMessageId} is not a live line of this lane` }
	const scenes = await db
		.select({
			opened: schema.scenes.openedAtMessageId,
			closed: schema.scenes.closedAtMessageId
		})
		.from(schema.scenes)
		.where(and(eq(schema.scenes.sessionId, sessionId), eq(schema.scenes.channel, channel)))
	const boundary = scenes.reduce((m, s) => Math.max(m, s.opened ?? 0, s.closed ?? 0), 0)
	if (atMessageId <= boundary)
		return { outcome: "refused", note: `message ${atMessageId} is already inside a placed scene` }
	const [waiting] = await db
		.select({ id: schema.sceneCues.id })
		.from(schema.sceneCues)
		.where(
			and(
				eq(schema.sceneCues.sessionId, sessionId),
				eq(schema.sceneCues.channel, channel),
				inArray(schema.sceneCues.state, ["open", "pending"])
			)
		)
		.limit(1)
	if (waiting) return { outcome: "skipped", note: "a scene cue is already waiting on this lane" }

	const [cue] = await db
		.insert(schema.sceneCues)
		.values({ sessionId, channel, atMessageId, trigger: JUDGED_SCENE_TRIGGER, reason, state: "open" })
		.onConflictDoNothing()
		.returning({ id: schema.sceneCues.id })
	if (!cue) return { outcome: "skipped", note: "this line was already judged" }
	const cueId = cue.id
	if (ctx.settings.mode !== "automatic" || params.ask === true) {
		await pushSceneCues(params.io, sessionId)
		return { outcome: "suggested", cueId }
	}

	const { openScene, SceneBoundaryRefusal } = await import("$lib/server/scenes/liveScenes")
	let opened
	try {
		opened = await openScene(db, {
			sessionId,
			userId: ctx.ownerId,
			channel,
			atMessageId,
			cause: { kind: "system" }
		})
	} catch (err) {
		if (!(err instanceof SceneBoundaryRefusal)) throw err
		await pushSceneCues(params.io, sessionId)
		return { outcome: "refused", cueId, note: err.message }
	}
	await markCuesAt(db, sessionId, channel, atMessageId, "placed")
	const { afterBoundaryPlaced } = await import("$lib/server/sockets/scenes")
	await afterBoundaryPlaced(params.io, {
		sessionId,
		userId: ctx.ownerId,
		closedSceneIds: opened.closedScene ? [opened.closedScene.id] : []
	})
	return {
		outcome: "placed",
		cueId,
		openedSceneId: opened.scene.id,
		...(opened.closedScene ? { closedSceneId: opened.closedScene.id } : {})
	}
}

/** Every lane's open-scene ids for a session (the watcher's tests and the Chronicle's read). */
export async function openSceneIds(db: Db, sessionId: number): Promise<number[]> {
	const rows = await db
		.select({ id: schema.scenes.id })
		.from(schema.scenes)
		.where(
			and(
				eq(schema.scenes.sessionId, sessionId),
				sql`${schema.scenes.openedAtMessageId} IS NOT NULL`,
				sql`${schema.scenes.closedAtMessageId} IS NULL`
			)
		)
	return rows.map((r) => r.id)
}

