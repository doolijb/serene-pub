/**
 * 🚧 Where a session's **scene boundaries** come from while it is played
 * (PROPOSAL-live-scenes §4, 2026-10-13; moved to a routine 2026-11-12): read
 * off what a person or a fixed tick already wrote, never a model.
 *
 * **The scenes routine finds them, a couple of rounds late.** A genre that
 * wants scenes handled registers `core:spec/scene-boundaries` (code only, no
 * model; core genres: every 2 rounds). Each run asks
 * `core:query/scene-boundaries@1`, which is `sceneBoundariesOf` below: it
 * reads only the `main` channel's standing lines at least a declared number
 * of rounds old (`depth`; core genres: 2), starting after the channel's
 * latest scene boundary or decided or offered scene cue (a branch: after its
 * last copied line), and finds where a boundary trigger fired among them,
 * checks it still holds, and returns it. The routine then places each one
 * through `core:outlet/propose-scene-cue@1` (`proposeJudgedSceneCue` with a
 * `trigger`): a scene cue at the line, then Suggested offers the *New scene?*
 * chip, Automatic opens the scene there (`openScene`) and marks the cue
 * `placed`, Manual records nothing. A query writes nothing.
 *
 * The triggers evaluated, line by line, against the line before it:
 *
 *  · **opening** — the genre's first scene (`shape.scenes.first`): the
 *    session's first story line on `main`;
 *  · **day crossed** — the two lines' story-clock stamps fall on different
 *    days (or months, or years, on a coarser clock);
 *  · **time action** — a *Time passes…* press, or a person's step of the
 *    clock, moved it since the line before: `noteTimeAction` left a marker
 *    (a `pending` cue) and the next landed line bound it (`watch`); the
 *    routine finds the bound marker and places it;
 *  · **place changed** — the place the genre's state names
 *    (`SessionShape.scenes.place`, `scenePlaceOf`: Adventure's and the
 *    Lair's `location`) differs between the two lines — each read off the
 *    state ledger as it stood when that line was written — and from where
 *    the scene the walk is in began (live scenes §15 G2). It is kept only if
 *    it still holds at the newest line read: out to B and back to A is
 *    nothing, A to B to C is two;
 *  · **narration** — the line is a narrator's or the system's;
 *  · **length** — the scene reached its `lines` lines, or about `tokens`
 *    tokens, before this one;
 *  · **pause** — more than `hours` real hours passed since the line before;
 *  · 🚧 the genre's own **declared triggers** (★9, live scenes §15 G1) —
 *    its summarize-scene spec's `contributes.boundaryTriggers`
 *    (`summarizeScene(…, { boundaries })`): every predicate a trigger states
 *    holds of the line — its `channel`, a `narration`, its `speaker`, a
 *    `stateKey` that changed since the line before. Each is a session
 *    switch (`triggers[key]`, on by default), its cue says its label. A
 *    trigger that states an `actionKey` never fires here: the run that wrote
 *    a line two rounds ago cannot be asked.
 *
 * **What the per-line hook still does** (`watchSceneBoundaries`, when a line
 * lands). It fires no trigger. It keeps what is a person's own act or must be
 * tied to the line that follows it: a person's *End scene here* (the pending
 * `endedHere` cue is bound to the next line, then the scene mode opens the
 * next scene there or offers the chip at once) and a time action's marker
 * (bound to that line, and it stays `pending` until the routine places it).
 * 🚧 And, only for a genre that opts in (`shape.scenes.castRefresh`), the
 * open scene's **stored cast** follows the lines (live scenes §15 G3), in
 * Suggested and Automatic, never Manual. Off in core.
 *
 * ⚠ **A session whose genre or preset registers no scenes routine gets no
 * automatic boundary**: core does not watch each message, and the first
 * line opens no scene by itself. A person's *Start scene*, *End scene* and
 * *Mark as scene* stay immediate.
 *
 * Quiet by construction: a session that may not place a scene (no lorebook,
 * a genre that writes none, lore writes Off) records nothing, and nothing
 * here ever fails the write that called it — every hook entry point catches.
 *
 * ⚠ Not the reply tick (Chat's fixed tick is not a time action: it moves
 * the clock on every reply, so it only ever crosses days) and not a scene
 * write of its own: Automatic mode places through the same `openScene` a
 * person's *Start scene here* does.
 */
import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	gt,
	gte,
	inArray,
	isNull,
	or,
	lt,
	lte,
	sql
} from "drizzle-orm"
import type {
	ProposedSceneCue,
	JudgedSceneCheck,
	SceneBoundary
} from "@serene-pub/contracts"
import { routineRunOf } from "$lib/server/pipelines/routines/runs"
import { routineLog } from "$lib/server/pipelines/routines/log"
import { liveMessageWhere } from "$lib/server/messages/store"
import * as schema from "$lib/server/db/schema"
import { canonicalChannel } from "$lib/server/messages/channels"
import { parseChannel, JUDGED_SCENE_TRIGGER } from "@serene-pub/sdk"
import { SCENE_BOUNDARIES_SPEC_ID } from "@serene-pub/core-catalog"
import { clockOf } from "$lib/server/state/storyTime"
import { compareDates, type StoryClock } from "$lib/shared/lorebooks/storyDate"
import { sceneCueReason } from "$lib/shared/sessions/sceneSettings"
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

/**
 * 🚧 The cue trigger of a genre's **first scene** (`shape.scenes.first`): the
 * session's first story line on `main`. Not a setting — the genre's shape
 * switches it on.
 */
export const OPENING_TRIGGER = "opening"

const TRIGGER_ORDER = [
	OPENING_TRIGGER,
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
	if (
		line.characterId != null &&
		line.isNarratorResponse !== true &&
		line.role !== "system"
	)
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
		.select({
			id: schema.scenes.id,
			openedAtMessageId: schema.scenes.openedAtMessageId
		})
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
	return row
		? { id: row.id, openedAtMessageId: row.openedAtMessageId! }
		: null
}

/**
 * Is `line` the lane's first story line of a new session: no earlier line of
 * any kind (hidden rows included), no scene ever placed on the lane, and no
 * `opening` cue in any state — so a removed or dismissed opening is never
 * offered or placed again.
 */
async function isOpeningLine(
	db: Db,
	sessionId: number,
	channel: string,
	lineId: number
): Promise<boolean> {
	const [earlier] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.channel, channel),
				lt(schema.sessionMessages.id, lineId)
			)
		)
		.limit(1)
	if (earlier) return false
	const [scene] = await db
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
	if (scene) return false
	const [cue] = await db
		.select({ id: schema.sceneCues.id })
		.from(schema.sceneCues)
		.where(
			and(
				eq(schema.sceneCues.sessionId, sessionId),
				eq(schema.sceneCues.channel, channel),
				eq(schema.sceneCues.trigger, OPENING_TRIGGER)
			)
		)
		.limit(1)
	return !cue
}

/** The scene the walk is in: where it began and the place it began at (null: no place is tracked). */
interface WalkScene {
	start: number
	place: string | null
}

/**
 * The triggers that fire at `line`, given the line before it on `main` and
 * the scene the walk is in. The ONE evaluator of the per-trigger tests:
 * read-only — it records nothing and binds nothing. Core's triggers, then
 * the genre's declared ones that apply to `main` (switched on, no `actionKey`
 * stated), in `triggerOrder`.
 */
async function firedTriggers(
	db: Db,
	ctx: SessionSceneContext,
	line: LineRow,
	prev: LineRow | undefined,
	scene: WalkScene,
	stateAt: (key: string, messageId: number) => Promise<string | null>
): Promise<string[]> {
	const channel = "main"
	const t = ctx.settings.triggers
	const fired = new Set<string>()
	if (ctx.first && (await isOpeningLine(db, ctx.sessionId, channel, line.id)))
		fired.add(OPENING_TRIGGER)
	if (t.timeAction) {
		// The marker a time action left, bound to this line by the hook.
		const [marker] = await db
			.select({ id: schema.sceneCues.id })
			.from(schema.sceneCues)
			.where(
				and(
					eq(schema.sceneCues.sessionId, ctx.sessionId),
					eq(schema.sceneCues.channel, channel),
					eq(schema.sceneCues.trigger, "timeAction"),
					eq(schema.sceneCues.atMessageId, line.id),
					eq(schema.sceneCues.state, "pending")
				)
			)
			.limit(1)
		if (marker) fired.add("timeAction")
	}
	if (prev) {
		if (t.dayCrossed && crossesDay(clockOf(prev), clockOf(line)))
			fired.add("dayCrossed")
		if (t.placeChanged && ctx.placeKey) {
			// 🚧 G2: the place as it stood when each line was written, and where
			// the scene the walk is in began — a move and back again inside one
			// scene is no new scene.
			const key = ctx.placeKey
			const [before, now] = [
				await stateAt(key, prev.id),
				await stateAt(key, line.id)
			]
			if (
				before &&
				now &&
				before !== now &&
				(scene.start === line.id || scene.place === null || scene.place !== now)
			)
				fired.add("placeChanged")
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
			const before = await db
				.select({ content: schema.sessionMessages.content })
				.from(schema.sessionMessages)
				.where(
					and(
						liveLinesWhere(ctx.sessionId, channel),
						gte(schema.sessionMessages.id, scene.start),
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

	// 🚧 G1 (★9): the genre's declared triggers — every predicate stated holds.
	// One that states an `actionKey` never fires: the run that wrote the line
	// two rounds ago cannot be asked.
	for (const d of ctx.declaredTriggers) {
		const w = d.when
		if (!d.on || w.actionKey !== undefined) continue
		if (w.channel !== undefined && !namesLane(w.channel, channel)) continue
		if (w.narration !== undefined && isNarrationLine(line) !== w.narration)
			continue
		if (w.speaker !== undefined && speakerOf(line) !== w.speaker) continue
		if (w.stateKey !== undefined) {
			if (!prev) continue
			const [before, now] = [
				await stateAt(w.stateKey, prev.id),
				await stateAt(w.stateKey, line.id)
			]
			if (!before || !now || before === now) continue
		}
		fired.add(d.key)
	}
	return triggerOrder(ctx.declaredTriggers).filter(
		(k) => fired.has(k) && k !== ENDED_HERE_TRIGGER
	)
}

/**
 * 🚧 **Where scenes begin** — the scenes routine's walk
 * (`core:query/scene-boundaries@1`). Read-only: it writes nothing.
 *
 * Looks only at `main`'s standing lines at least `depth` rounds old (a round
 * as the turn order counts it, `replayStoryLane`), from after the channel's
 * latest scene boundary or decided or offered scene cue (a branch: after its
 * last copied line) up to the newest such line, and returns where a boundary
 * trigger fired among them and still holds at the newest line read, in line
 * order. A session with none of those starts `every` rounds before the
 * window, so an old session's whole past is never walked. Where the walk
 * starts is derived, never stored.
 */
/** How many boundaries one run of the scenes routine returns at most (under the spec's each cap of 20). */
const SCENE_BOUNDARIES_PER_RUN = 12

export async function sceneBoundariesOf(
	db: Db,
	sessionId: number,
	opts: { depth: number; every: number }
): Promise<{ boundaries: SceneBoundary[]; why?: string }> {
	const none = (why: string) => ({ boundaries: [] as SceneBoundary[], why })
	const ctx = await sessionSceneContext(db, sessionId)
	if (!ctx || !ctx.mayPlace) return none("this session places no scenes")
	if (ctx.settings.mode === "manual") return none("scenes are Manual here")
	const channel = "main"

	const { replayStoryLane } = await import(
		"$lib/server/pipelines/routines/moments"
	)
	const { tally, lines: replayed } = await replayStoryLane(db, sessionId)
	const cur = tally?.round ?? 1
	const old = replayed.filter((l) => l.round <= cur - opts.depth)
	if (!old.length) return none("no line is old enough yet")
	const end = old.reduce((m, l) => Math.max(m, l.id), 0)

	// Where the walk starts — after the latest boundary, decided or offered
	// cue, or copied line.
	const sceneRows = await db
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
	let anchor = sceneRows.reduce(
		(m, s) => Math.max(m, s.opened ?? 0, s.closed ?? 0),
		0
	)
	const cueRows = await db
		.select({ at: schema.sceneCues.atMessageId })
		.from(schema.sceneCues)
		.where(
			and(
				eq(schema.sceneCues.sessionId, sessionId),
				eq(schema.sceneCues.channel, channel),
				sql`${schema.sceneCues.state} <> 'pending'`
			)
		)
	anchor = cueRows.reduce((m, c) => Math.max(m, c.at ?? 0), anchor)
	const [session] = await db
		.select({ branchOf: schema.sessions.branchOfSessionId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (session?.branchOf != null) {
		const [copied] = await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, sessionId),
					sql`${schema.sessionMessages.metadata} ->> 'copyOf' IS NOT NULL`
				)
			)
			.orderBy(desc(schema.sessionMessages.id))
			.limit(1)
		anchor = Math.max(anchor, copied?.id ?? 0)
	}
	let after = anchor
	if (anchor <= 0) {
		const startRound = cur - opts.depth - opts.every + 1
		if (startRound > 1) {
			const first = replayed.find((l) => l.round >= startRound)
			after = first ? first.id - 1 : 0
		}
	}

	const walked = await db
		.select(LINE_COLUMNS)
		.from(schema.sessionMessages)
		.where(
			and(
				liveLinesWhere(sessionId, channel),
				gt(schema.sessionMessages.id, after),
				lte(schema.sessionMessages.id, end)
			)
		)
		.orderBy(asc(schema.sessionMessages.id))
	if (!walked.length) return none("no line is old enough yet")
	let [prev] = await db
		.select(LINE_COLUMNS)
		.from(schema.sessionMessages)
		.where(
			and(
				liveLinesWhere(sessionId, channel),
				lt(schema.sessionMessages.id, walked[0]!.id)
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)

	// One reader of the world's state keys for the whole walk.
	let reader: Awaited<
		ReturnType<typeof import("$lib/server/scenes/liveScenes").worldStateReader>
	> | null = null
	const stateAt = async (key: string, messageId: number) => {
		if (!reader) {
			const { worldStateReader } = await import("$lib/server/scenes/liveScenes")
			reader = await worldStateReader(db, sessionId)
		}
		return reader(key, { messageId })
	}
	const placeOf = (messageId: number) =>
		ctx.placeKey ? stateAt(ctx.placeKey, messageId) : Promise.resolve(null)

	// The walk carries its own scene start. With no scene open, the place the
	// story stood in just before the walk is where "the scene" began, so a
	// move out and back inside the window is no boundary there either.
	const open = await openSceneOn(db, sessionId, channel)
	let scene: WalkScene = open
		? { start: open.openedAtMessageId, place: await placeOf(open.openedAtMessageId) }
		: {
				start: await sceneStartOf(db, sessionId, channel),
				place: prev ? await placeOf(prev.id) : null
			}

	// One run returns a bounded handful: the start is derived, so the next run
	// carries on from what this one placed.
	const most = SCENE_BOUNDARIES_PER_RUN
	const boundaries: SceneBoundary[] = []
	for (const line of walked) {
		if (boundaries.length >= most) break
		const fired = await firedTriggers(db, ctx, line, prev, scene, stateAt)
		prev = line
		// The re-check: a place that moved and moved back by the newest line
		// read is no boundary.
		const kept: string[] = []
		for (const trigger of fired) {
			if (
				trigger === "placeChanged" &&
				ctx.placeKey &&
				scene.place !== null &&
				(await stateAt(ctx.placeKey, end)) === scene.place
			)
				continue
			kept.push(trigger)
		}
		if (!kept.length) continue
		for (const trigger of kept) {
			const { reason } = await sceneCueWording(ctx.declaredTriggers, [
				{ trigger, reason: null }
			])
			boundaries.push({ at: line.id, trigger, reason })
		}
		scene = { start: line.id, place: await placeOf(line.id) }
	}
	return { boundaries }
}

/**
 * The per-line hook, when a line lands. It fires no boundary trigger (the
 * scenes routine finds those a couple of rounds later, `sceneBoundariesOf`);
 * it only keeps what is tied to this line: a person's *End scene here* is
 * bound to it and the next scene opened or offered at once, and a time
 * action's marker is bound to it and stays `pending` for the routine. Null
 * when nothing was opened or offered, the session places no scene, its mode
 * is Manual, or the line is hidden, generating or gone. Never throws: a
 * failure is logged and the line stands.
 *
 * `runIds` are kept for the caller's signature and are not read.
 * 🚧 Then, whatever happened, the channel's open scene's stored cast is
 * brought up to date (live scenes §15 G3, `refreshOpenSceneCast`).
 */
export async function watchSceneBoundaries(
	db: Db,
	params: {
		sessionId: number
		messageId: number
		io?: unknown
		runIds?: readonly string[]
	}
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

/** The words of the open scene's cast refresh: what did it, and how to stop it. */
export function openSceneCastCause(genreName: string | null): string {
	return `${genreName ?? "This session's genre"} keeps the open scene's cast up to date from its lines. Set How scenes begin to Manual to stop it.`
}

/**
 * 🚧 G3: when the genre opts in (`shape.scenes.castRefresh`) and the scene
 * mode is not Manual, the open scene on the landed line's lane proposes its
 * cast again and stores it when it moved (`refreshOpenSceneCast`), then
 * tells the session's pages (`scenes:list`, whose rows carry the cast the
 * divider's faces draw). Returns the scene and the cause when it rewrote the
 * cast, else null. A session reading no book has no scene. Never throws.
 */
export async function followOpenSceneCast(
	db: Db,
	params: { sessionId: number; messageId: number; io?: unknown }
): Promise<{ sceneId: number; cause: string } | null> {
	try {
		const ctx = await sessionSceneContext(db, params.sessionId)
		if (!ctx || !ctx.castRefresh || ctx.settings.mode === "manual")
			return null
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
		if (!line || line.isHidden || line.isGenerating) return null
		const { refreshOpenSceneCast } = await import(
			"$lib/server/scenes/liveScenes"
		)
		const channel = canonicalChannel(line.channel)
		// The writer returns only whether it wrote: name the scene it wrote to.
		const open = await openSceneOn(db, params.sessionId, channel)
		const moved = await refreshOpenSceneCast(db, {
			sessionId: params.sessionId,
			channel,
			messageId: params.messageId
		})
		if (!moved || !open) return null
		if (params.io) {
			const [owner] = await db
				.select({ userId: schema.sessions.userId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, params.sessionId))
				.limit(1)
			if (owner) {
				const { pushSceneList } = await import(
					"$lib/server/sockets/scenes"
				)
				await pushSceneList(params.io, {
					sessionId: params.sessionId,
					userId: owner.userId
				})
			}
		}
		return { sceneId: open.id, cause: openSceneCastCause(ctx.genreName) }
	} catch (err) {
		console.warn("[scenes] the open scene's cast was not refreshed:", err)
		return null
	}
}

/**
 * Which lanes core's triggers watch: `main`'s, and any other lane a scene
 * was already placed on. A genre's side channel — the Lair's Sanctum, the
 * table outside the story — raises no cue of core's until someone has
 * started a scene there; a genre's declared trigger that names a channel
 * (★9) is evaluated on that channel's lanes alone (`watch`).
 */
async function watchesLane(
	db: Db,
	sessionId: number,
	channel: string
): Promise<boolean> {
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
	params: {
		sessionId: number
		messageId: number
		io?: unknown
		runIds?: readonly string[]
	}
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
	if (!(await watchesLane(db, ctx.sessionId, channel))) return null

	if (ctx.settings.triggers.timeAction) await bindTimeActionMarker(db, ctx, line.id, channel)

	// The pending cue an *End scene here* at the channel's newest line left
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
	if (!ended.length) return null

	const base = {
		sessionId: ctx.sessionId,
		channel,
		messageId: line.id,
		triggers: [ENDED_HERE_TRIGGER]
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
			// 🚧 The hook placed it (Automatic), not a person.
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
		lorebookId: opened.scene.lorebookId ?? null,
		closedSceneIds: opened.closedScene ? [opened.closedScene.id] : []
	})
	return {
		...base,
		outcome: "placed",
		openedSceneId: opened.scene.id,
		...(opened.closedScene ? { closedSceneId: opened.closedScene.id } : {})
	}
}

/**
 * A time action's marker (the `pending` `timeAction` cue with no line on this
 * channel) takes this line and stays `pending`: never offered, never placed
 * here — the scenes routine finds it and places it. A regenerate re-fires the
 * event: when the line already holds the marker, the unbound one is dropped
 * (the unique index would refuse the update).
 */
async function bindTimeActionMarker(
	db: Db,
	ctx: SessionSceneContext,
	lineId: number,
	channel: string
): Promise<void> {
	const [already] = await db
		.select({ id: schema.sceneCues.id })
		.from(schema.sceneCues)
		.where(
			and(
				eq(schema.sceneCues.sessionId, ctx.sessionId),
				eq(schema.sceneCues.channel, channel),
				eq(schema.sceneCues.trigger, "timeAction"),
				eq(schema.sceneCues.atMessageId, lineId)
			)
		)
		.limit(1)
	const unbound = and(
		eq(schema.sceneCues.sessionId, ctx.sessionId),
		eq(schema.sceneCues.channel, channel),
		eq(schema.sceneCues.trigger, "timeAction"),
		isNull(schema.sceneCues.atMessageId)
	)
	if (already) await db.delete(schema.sceneCues).where(unbound)
	else
		await db
			.update(schema.sceneCues)
			.set({ atMessageId: lineId })
			.where(unbound)
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
 * Does the session run the scenes routine (`core:spec/scene-boundaries`): an
 * effective registration of it that is not Off. False on any error.
 */
export async function scenesRoutineOn(
	db: Db,
	sessionId: number
): Promise<boolean> {
	try {
		const { effectiveRegistrations } = await import(
			"$lib/server/pipelines/registrations/resolve"
		)
		const resolved = await effectiveRegistrations(db, sessionId)
		return (
			resolved?.effective.some(
				(r) =>
					r.trigger.family === "routine" &&
					r.pipeline === SCENE_BOUNDARIES_SPEC_ID &&
					(r.mode ?? "full") !== "off"
			) ?? false
		)
	} catch {
		return false
	}
}

/**
 * A **time action** moved the session's clock — a *Time passes…* press, a
 * person's step or set: leave a `pending` marker on `main` for its next line
 * to take (`watchSceneBoundaries`), which the scenes routine then places.
 * Nothing when the session places no scene, is Manual, has the trigger off,
 * or runs no scenes routine (a marker nobody places would stay `pending` for
 * ever, and the judged scene check refuses while any cue is `pending`).
 * Never throws.
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
		if (!(await scenesRoutineOn(db, params.sessionId))) return
		await db
			.insert(schema.sceneCues)
			.values({
				sessionId: params.sessionId,
				channel: "main",
				atMessageId: null,
				trigger: "timeAction",
				state: "pending" as const
			})
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
	params: {
		sessionId: number
		channel: string
		endedAt: number
		userId: number
	}
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
	const { sessionBoundaryTriggers } = await import(
		"$lib/server/scenes/liveScenes"
	)
	const declared = await sessionBoundaryTriggers(db, sessionId).catch(
		() => []
	)
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
	const byLine = new Map<string, CueRow[]>()
	for (const c of cues as CueRow[]) {
		const at = c.atMessageId!
		if (at <= (latest.get(c.channel) ?? 0)) continue
		const key = `${c.channel}#${at}`
		const had = byLine.get(key)
		if (had) had.push(c)
		else byLine.set(key, [c])
	}
	const offered: OfferedSceneCue[] = []
	for (const group of byLine.values()) {
		const first = group[0]
		offered.push({
			id: first.id,
			channel: first.channel,
			messageId: first.atMessageId!,
			...(await sceneCueWording(declared, group))
		})
	}
	return offered
}

/**
 * The words of one line's scene cues, oldest first: their triggers deduped and
 * ordered (core's, then the genre's declared ones), and the sentence the chip
 * says (`sceneCueReason`) — a declared trigger in its own label, a `judged`
 * cue in its own reason (the line's last judged cue's, else the fallback). The
 * ONE wording: the chip (`offeredSceneCues`) and the cause a scene carries
 * (`sceneCauses`, `liveScenes.ts`) both read it here.
 */
export async function sceneCueWording(
	declared: ReadonlyArray<import("@serene-pub/sdk").BoundaryTriggerDecl>,
	cues: ReadonlyArray<{ trigger: string; reason: string | null }>
): Promise<{ triggers: string[]; reason: string }> {
	const order = triggerOrder(declared)
	const { i18nText } = await import("@serene-pub/sdk")
	const labels = Object.fromEntries(
		declared.map((d) => [d.key, i18nText(d.label) ?? d.key])
	)
	const triggers: string[] = []
	let judged: string | undefined
	for (const c of cues) {
		if (c.trigger === JUDGED_SCENE_TRIGGER)
			judged = c.reason?.trim() || JUDGED_CUE_FALLBACK_REASON
		if (!triggers.includes(c.trigger)) triggers.push(c.trigger)
	}
	const rank = (t: string) => {
		const i = order.indexOf(t)
		return i === -1 ? order.length : i
	}
	triggers.sort((a, b) => rank(a) - rank(b))
	return {
		triggers,
		reason: sceneCueReason(
			triggers,
			judged === undefined ? labels : { ...labels, [JUDGED_SCENE_TRIGGER]: judged }
		)
	}
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
		.where(
			and(
				eq(schema.sessionMessages.id, cue.atMessageId),
				liveMessageWhere()
			)
		)
		.limit(1)
	if (!live) throw new SceneCueRefusal("That suggestion is gone.")
	const [session] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, cue.sessionId))
		.limit(1)
	if (!session || session.userId !== params.userId)
		throw new SceneCueRefusal(
			"Only the session's owner decides where its scenes begin."
		)
	if (cue.state !== "open")
		throw new SceneCueRefusal(
			cue.state === "dismissed"
				? "That suggestion was already set aside."
				: "That suggestion was already taken."
		)
	if (!params.accept) {
		await markCuesAt(
			db,
			cue.sessionId,
			cue.channel,
			cue.atMessageId,
			"dismissed"
		)
		return { sessionId: cue.sessionId, sceneId: null }
	}
	const { openScene } = await import("$lib/server/scenes/liveScenes")
	const opened = await openScene(db, {
		sessionId: cue.sessionId,
		userId: params.userId,
		channel: cue.channel,
		atMessageId: cue.atMessageId
	})
	await markCuesAt(
		db,
		cue.sessionId,
		cue.channel,
		cue.atMessageId,
		"accepted"
	)
	return { sessionId: cue.sessionId, sceneId: opened.scene.id, opened }
}

/**
 * Tell the session's open pages its cues and settings moved (`scenes:cues`,
 * lazily — paid only when a page holds the key). A no-op with no socket
 * server (a test, a script).
 */
export async function pushSceneCues(
	io: unknown,
	sessionId: number
): Promise<void> {
	if (!io) return
	try {
		const [{ broadcastToSessionUsers }, { buildSceneCuesReply }] =
			await Promise.all([
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
	if (!ctx || !ctx.mayPlace)
		return { due: false, why: "off: this session places no scenes" }
	if (ctx.settings.mode === "manual")
		return { due: false, why: "off: scenes are Manual here" }

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
	const sinceBase = live
		.map((r) => r.id)
		.filter((id) => (inclusive ? id >= base : id > base))
	if (sinceBase.length < JUDGED_SCENE_MIN_LINES)
		return {
			due: false,
			why: `off: fewer than ${JUDGED_SCENE_MIN_LINES} lines since the scene began`
		}

	// The routine's previous firing bounds what the model has already seen.
	let lastLook = 0
	let lastLookAt: Date | null = null
	const key = routineRunOf(opts.runId)?.registrationKey
	if (key) {
		const log = await routineLog(db, sessionId, { limit: 50 })
		const prev = log.find(
			(e) =>
				e.registrationKey === key &&
				e.kind === "ran" &&
				e.runId !== opts.runId
		)
		if (prev) {
			const at = new Date(prev.startedAt)
			const [row] = await db
				.select({ id: schema.sessionMessages.id })
				.from(schema.sessionMessages)
				.innerJoin(
					schema.messages,
					eq(schema.messages.id, schema.sessionMessages.id)
				)
				.where(
					and(
						liveLinesWhere(sessionId, channel),
						lte(schema.messages.createdAt, at)
					)
				)
				.orderBy(desc(schema.sessionMessages.id))
				.limit(1)
			if (row) {
				lastLook = row.id
				lastLookAt = await writtenAt(db, row.id).then((t) =>
					t == null ? null : new Date(t)
				)
			}
		}
	}
	// A new scene begins after the open one's opening (or the last boundary), never at it.
	const from = Math.max(base, lastLook)
	const lines = sinceBase.filter((id) => id > from).slice(-20)
	if (!lines.length)
		return { due: false, why: "off: nothing new since the last look" }

	const cues = await db
		.select({
			atMessageId: schema.sceneCues.atMessageId,
			trigger: schema.sceneCues.trigger,
			state: schema.sceneCues.state,
			decidedAt: schema.sceneCues.decidedAt
		})
		.from(schema.sceneCues)
		.where(
			and(
				eq(schema.sceneCues.sessionId, sessionId),
				eq(schema.sceneCues.channel, channel)
			)
		)
	const inLines = new Set(lines)
	if (
		cues.some(
			(c) =>
				c.trigger !== JUDGED_SCENE_TRIGGER &&
				c.atMessageId != null &&
				inLines.has(c.atMessageId)
		)
	)
		return {
			due: false,
			why: "off: a scene trigger already fired in these lines"
		}
	// A `pending` cue waits only while it is unbound: a time action's marker
	// bound to its line is the scenes routine's to read, and one it never
	// reads (its line taken Back, a scene started past it) must not switch
	// this check off for good.
	if (
		cues.some(
			(c) => c.state === "open" || (c.state === "pending" && c.atMessageId == null)
		)
	)
		return { due: false, why: "off: a scene cue is already waiting" }
	if (
		cues.some(
			(c) =>
				c.trigger === JUDGED_SCENE_TRIGGER &&
				c.state === "dismissed" &&
				(lastLook === 0 ||
					(c.decidedAt != null &&
						lastLookAt != null &&
						c.decidedAt.getTime() > lastLookAt.getTime()))
		)
	)
		return { due: false, why: "off: the last suggestion was set aside" }
	return { due: true, channel, lines }
}

/**
 * 🚧 A scene cue committed at a line (pass 7, R-i; pr6s2-G-shapes.md §G-5a;
 * 2026-11-12 for the scenes routine): the scene mode deciding — Automatic
 * places the boundary, Suggested (or `ask`) offers the chip, Manual records
 * nothing.
 *
 * With no `trigger` (or blank, or `judged`): the **judged** scene check's
 * answer, a `judged` cue at its line with the model's reason, refused while
 * any cue waits. With a `trigger`: the **scenes routine's** boundary (the one
 * `sceneBoundariesOf` found), a cue for that boundary trigger at `at` — the
 * time action's marker bound there is the one used — its reason left empty
 * (the chip and the divider word it from the trigger). A run stops at its
 * first Suggested offer: while an `open` cue waits at an earlier line, the
 * next boundary is skipped, and the next run continues after the person
 * answers.
 */
export async function proposeJudgedSceneCue(
	db: Db,
	params: {
		sessionId: number
		channel: string
		atMessageId: number
		reason: string
		ask?: boolean
		/** The boundary trigger the cue is for; absent, blank or `judged`: the judged scene check's. */
		trigger?: string
		io?: unknown
	}
): Promise<ProposedSceneCue> {
	const { sessionId, atMessageId } = params
	const channel = canonicalChannel(params.channel)
	const trigger = String(params.trigger ?? "").trim()
	const routine = trigger !== "" && trigger !== JUDGED_SCENE_TRIGGER
	const reason = String(params.reason ?? "")
		.trim()
		.slice(0, 200)
	const ctx = await sessionSceneContext(db, sessionId)
	if (!ctx || !ctx.mayPlace)
		return { outcome: "skipped", note: "this session places no scenes" }
	if (ctx.settings.mode === "manual")
		return {
			outcome: "skipped",
			note: routine
				? "the scene mode is Manual, so a scene cue is never placed or offered"
				: "the scene mode is Manual, so a judged cue is never placed or offered"
		}
	if (routine) {
		if (
			trigger === ENDED_HERE_TRIGGER ||
			!triggerOrder(ctx.declaredTriggers).includes(trigger)
		)
			return {
				outcome: "refused",
				note: `${trigger} is not a boundary trigger of this session`
			}
	} else if (!reason)
		return { outcome: "refused", note: "a judged cue needs its reason" }
	const [line] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				liveLinesWhere(sessionId, channel),
				eq(schema.sessionMessages.id, atMessageId)
			)
		)
		.limit(1)
	if (!line)
		return {
			outcome: "refused",
			note: `message ${atMessageId} is not a live line of this lane`
		}
	const scenes = await db
		.select({
			opened: schema.scenes.openedAtMessageId,
			closed: schema.scenes.closedAtMessageId
		})
		.from(schema.scenes)
		.where(
			and(
				eq(schema.scenes.sessionId, sessionId),
				eq(schema.scenes.channel, channel)
			)
		)
	const boundary = scenes.reduce(
		(m, s) => Math.max(m, s.opened ?? 0, s.closed ?? 0),
		0
	)
	let cueId: number
	if (!routine) {
		if (atMessageId <= boundary)
			return {
				outcome: "refused",
				note: `message ${atMessageId} is already inside a placed scene`
			}
		const [waiting] = await db
			.select({ id: schema.sceneCues.id })
			.from(schema.sceneCues)
			.where(
				and(
					eq(schema.sceneCues.sessionId, sessionId),
					eq(schema.sceneCues.channel, channel),
					or(
						eq(schema.sceneCues.state, "open"),
						and(eq(schema.sceneCues.state, "pending"), isNull(schema.sceneCues.atMessageId))
					)
				)
			)
			.limit(1)
		if (waiting)
			return {
				outcome: "skipped",
				note: "a scene cue is already waiting on this lane"
			}

		const [cue] = await db
			.insert(schema.sceneCues)
			.values({
				sessionId,
				channel,
				atMessageId,
				trigger: JUDGED_SCENE_TRIGGER,
				reason,
				state: "open"
			})
			.onConflictDoNothing()
			.returning({ id: schema.sceneCues.id })
		if (!cue)
			return { outcome: "skipped", note: "this line was already judged" }
		cueId = cue.id
	} else {
		const here = scenes.some((s) => s.opened === atMessageId)
		if (atMessageId < boundary || (atMessageId === boundary && !here))
			return {
				outcome: "refused",
				note: `message ${atMessageId} is already inside a placed scene`
			}
		const forLine = and(
			eq(schema.sceneCues.sessionId, sessionId),
			eq(schema.sceneCues.channel, channel),
			eq(schema.sceneCues.atMessageId, atMessageId),
			eq(schema.sceneCues.trigger, trigger)
		)
		const [had] = await db
			.select({ id: schema.sceneCues.id, state: schema.sceneCues.state })
			.from(schema.sceneCues)
			.where(forLine)
			.limit(1)
		if (atMessageId === boundary) {
			// The same boundary: the scene is already here, so this trigger's
			// cue is recorded as the one that placed it.
			if (had && had.state !== "pending" && had.state !== "open")
				return {
					outcome: "skipped",
					note: "this line's scene cue was already decided"
				}
			let id = had?.id
			if (had)
				await db
					.update(schema.sceneCues)
					.set({ state: "placed", decidedAt: new Date() })
					.where(eq(schema.sceneCues.id, had.id))
			else {
				const [row] = await db
					.insert(schema.sceneCues)
					.values({
						sessionId,
						channel,
						atMessageId,
						trigger,
						state: "placed",
						decidedAt: new Date()
					})
					.onConflictDoNothing()
					.returning({ id: schema.sceneCues.id })
				id = row?.id
			}
			return {
				outcome: "placed",
				...(id !== undefined ? { cueId: id } : {}),
				note: "the scene at this line was already placed"
			}
		}
		const [waiting] = await db
			.select({ id: schema.sceneCues.id })
			.from(schema.sceneCues)
			.where(
				and(
					eq(schema.sceneCues.sessionId, sessionId),
					eq(schema.sceneCues.channel, channel),
					eq(schema.sceneCues.state, "open"),
					lt(schema.sceneCues.atMessageId, atMessageId),
					// Only a cue the chip shows can be answered: one at or before the
					// channel's latest boundary, or at a line taken Back, is never
					// offered again and must not hold the routine up.
					gt(schema.sceneCues.atMessageId, boundary),
					sql`exists (select 1 from ${schema.sessionMessages} where ${schema.sessionMessages.id} = ${schema.sceneCues.atMessageId} and ${liveMessageWhere()})`
				)
			)
			.limit(1)
		if (waiting)
			return {
				outcome: "skipped",
				note: "a scene cue is already waiting on this channel"
			}
		if (had && had.state !== "pending" && had.state !== "open")
			return {
				outcome: "skipped",
				note: "this line's scene cue was already decided"
			}
		if (had) {
			await db
				.update(schema.sceneCues)
				.set({ state: "open" })
				.where(eq(schema.sceneCues.id, had.id))
			cueId = had.id
		} else {
			const [row] = await db
				.insert(schema.sceneCues)
				.values({ sessionId, channel, atMessageId, trigger, state: "open" })
				.onConflictDoNothing()
				.returning({ id: schema.sceneCues.id })
			if (!row)
				return {
					outcome: "skipped",
					note: "this line's scene cue was already decided"
				}
			cueId = row.id
		}
	}
	if (ctx.settings.mode !== "automatic" || params.ask === true) {
		await pushSceneCues(params.io, sessionId)
		return { outcome: "suggested", cueId }
	}

	const { openScene, SceneBoundaryRefusal } = await import(
		"$lib/server/scenes/liveScenes"
	)
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
		lorebookId: opened.scene.lorebookId ?? null,
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
export async function openSceneIds(
	db: Db,
	sessionId: number
): Promise<number[]> {
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
