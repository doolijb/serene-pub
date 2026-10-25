/**
 * A session's **published values** — the one document an action's
 * enabled-when reads (plans/29 R-15 *enabled-when*; plans/30 U5e, built
 * 2026-09-17).
 *
 * Built once per listing and once per fire, by this module alone, so the
 * grey chip and the refusal at the door read the same facts:
 *
 * ```
 * {
 *   session: { generating: boolean, fields: <genreFieldsFor — stored, pinned, default>,
 *              openForm: { action: string | null } | null,
 *              turn, round, lastSpeaker, turnsBy },
 *   state:   <ResolvedState — world · cast · slots · version, from stateFor>,
 *   sprites: { byId: { <characterId>: { set, label } }, <castKey>: { set, label } },
 *   backdrop: { set: boolean, mediaId: number | null },
 *   annex:   { <annex owner, dots → _>: { <key>: value } },
 *   rules:   { invokable: { <function id, dots → _>: true } },
 *   item?:   { id, isNewest, hidden, generating, role, mine, hasSwipes, greeting }
 * }
 * ```
 *
 * 🚧 `rules.invokable` (PLAN-genres-seams S3, 2026-10-23) is each
 * **invokable** function the session's ruleset uses — what its **rules
 * actions** offer at the composer — by the function's id
 * (`rulesInvokableSegment`): what a registration's `when` reads as
 * `s.rules.invokable(restFunction)`, so a genre's own Rest steps aside when
 * the rules offer one (Story's, the Dungeon Crawler's). Absent for a function
 * the rules do not use, so `not(isTrue(…))` holds there.
 *
 * 🚧 `annex` (PLAN-layering D6, lane 2's `sessionOf`) is the session's annex
 * by owner, each owner's id with its dots written `_` (`annexOwnerSegment`) —
 * the path `annex.<owner>.<key>` a typed condition stores. Server-side only,
 * like every other half of this document: a condition is judged here, never
 * shipped. Never the revision points (`annexWithoutPoints`).
 *
 * 🚧 `session.turn` · `round` · `lastSpeaker` · `turnsBy` (R51, R52; lane F1)
 * are the story lane's turn tally (`routines/turnTally.ts`): turns taken so
 * far, the round in progress (from 1), who took the last turn (a participant
 * reference, or `narrator`; null before the first) and each speaker's turns
 * this round — what a registration's `when`, an action's enabled-when and a
 * script read as `sessionOf(genre).turn` and so on.
 *
 * `session.openForm` is the main channel's open form (`openFormOf`: the
 * newest unanswered, un-overtaken question) with the action that answers it,
 * or null — what an action's `presentWhen` reads (W-GATE D3, 2026-09-27:
 * *Answer the door* is present only while the knock is open). Only the
 * action is published: which row and block is the press's business.
 *
 * `sprites` is each cast member's **current sprite** (DESIGN-sprites §6):
 * the label on their newest visible line, in the set the session overrides
 * them into if it does. Derived here, never stored — so `sprites.verity.label
 * equals 'armoured'` gates an action on a face, keyed exactly as
 * `state.cast` is.
 *
 * `backdrop` is the session's **backdrop** (`sessions.backdropMediaId`,
 * DESIGN-image-generation §6.4): whether one is set and its file id — so
 * `backdrop.set equals false` offers an *Illustrate* action only until a
 * picture is there.
 *
 * `state` is the resolver's answer (`state/resolve.ts`), keyed as a template
 * reads it — `state.world.location`, `state.cast.verity.hp`, and
 * `state.version`, the session's state version (U5f) — never a second
 * resolver. `session.fields` is what the inlet hands a run (`genreFieldsFor`:
 * per declared or pinned key, the stored value, else the pin, else the
 * field's declared default — B16x; a key with none of the three reads
 * `undefined`, as it does in a run). `session.generating` is true
 * while a message row of the session is generating or a run of kind
 * `reply`/`action` is registered for it.
 *
 * `item` is the message venue's per-row half, supplied where a message is at
 * hand: the server at the door from the real row, the client per row from
 * what it renders (`shared/actions/itemValues.ts` is the one shape both
 * build, so a field added there is added for both). A listing carries no
 * `item`; it hands the `item.*` predicates to the client instead
 * (`SessionAction.itemPredicates`).
 */

import { and, desc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { channelHead } from "$lib/server/messages/channels"
import { openFormOf } from "$lib/server/messages/blocks"
import { stateFor, type ResolvedState } from "$lib/server/state/resolve"
import { genreFieldsFor } from "$lib/server/pipelines/entities/sessionGenres"
import * as runRegistry from "$lib/server/pipelines/runtime/runRegistry"
import { canActOnMessage } from "$lib/server/messages/permissions"
import { MAX_RUN_DEPTH, type RunLineage } from "$lib/server/pipelines/runtime/lineage"
import { itemValuesOf, type ItemValues } from "$lib/shared/actions/itemValues"
import { publishedBackdrop, type PublishedBackdrop } from "$lib/server/sessions/backdrop"
import * as spriteChoices from "$lib/server/sprites/choices"
import * as sharedSprites from "$lib/shared/sprites"
import { annexOwnerSegment } from "@serene-pub/sdk"
import { annexWithoutPoints } from "$lib/server/sessions/annexChanges"
import { annexForPipelines, coreAnnexIn } from "$lib/server/sessions/coreAnnex"
import { publishedTurns } from "$lib/server/pipelines/routines/turnTally"

export {
	itemValuesOf,
	type ItemValues,
	type ItemRow
} from "$lib/shared/actions/itemValues"

export interface PublishedValues {
	session: {
		generating: boolean
		fields: Record<string, unknown>
		/** The open form on the main channel and the action it is answered by — see the module note. */
		openForm: { action: string | null } | null
		/** 🚧 Turns taken on the story's lane (R51) — see the module note. */
		turn: number
		/** 🚧 The round in progress on the story's lane, from 1 (R52). */
		round: number
		/** 🚧 Who took the last turn on the story's lane: a participant reference, `narrator`, or null before any. */
		lastSpeaker: string | null
		/** 🚧 Each speaker's turns this round. */
		turnsBy: Record<string, number>
	}
	state: ResolvedState
	/** Each cast member's current sprite — see the module comment. */
	sprites: PublishedSprites
	/** The session's backdrop — see the module comment. */
	backdrop: PublishedBackdrop
	/** 🚧 The session's annex by owner (dots → `_`) — see the module comment. */
	annex: Record<string, Record<string, unknown>>
	/** 🚧 What the session's rules offer — see the module comment (S3). */
	rules: PublishedRules
	item?: ItemValues
}

/** 🚧 The session's rules, as a condition reads them (S3): each invokable function they use, by its id's segment. */
export interface PublishedRules {
	invokable: Record<string, true>
}

/**
 * 🚧 The invokable functions a ruleset uses, published (S3): the same reading
 * the rules actions are made from (`rulesActionsOf` — a use whose function
 * header says `invokable`), keyed by the function's id
 * (`rulesInvokableSegment`). Empty for no ruleset.
 */
export async function publishedRulesOf(ruleset: ({ id: string } & object) | undefined): Promise<PublishedRules> {
	const invokable: Record<string, true> = {}
	if (!ruleset) return { invokable }
	const { functionUsesOf } = await import("$lib/server/rulesets/functionRun")
	const { rulesInvokableSegment } = await import("@serene-pub/sdk")
	for (const use of functionUsesOf(ruleset))
		if (use.decl?.invokable && typeof use.ref?.ref === "string") invokable[rulesInvokableSegment(use.ref.ref)] = true
	return { invokable }
}

/** 🚧 The session's primary ruleset's invokable functions (one indexed read). */
async function rulesOf(db: Db, sessionId: number): Promise<PublishedRules> {
	const [row] = await db
		.select({ primaryRuleset: schema.sessions.primaryRuleset })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!row?.primaryRuleset) return { invokable: {} }
	const { getRuleset } = await import("@serene-pub/sdk")
	return publishedRulesOf(getRuleset(row.primaryRuleset) as ({ id: string } & object) | undefined)
}

/**
 * 🚧 The annex as a condition reads it (lane 2): `{ <owner with dots → _>:
 * { <key>: value } }`, revision points left out and the core runtime keys
 * (`annexForPipelines`) never shown. An owner's document that is
 * not an object is not published.
 */
export function publishedAnnex(annex: unknown): Record<string, Record<string, unknown>> {
	const out: Record<string, Record<string, unknown>> = {}
	for (const [owner, doc] of Object.entries(annexForPipelines(annexWithoutPoints(annex))))
		if (doc && typeof doc === "object" && !Array.isArray(doc))
			out[annexOwnerSegment(owner)] = doc as Record<string, unknown>
	return out
}

/** 🚧 The story lane's turn tally, published (R51, R52; one indexed read). */
async function turnsOf(db: Db, sessionId: number) {
	const [row] = await db
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return publishedTurns(coreAnnexIn(row?.annex ?? null))
}

/** The session row's annex column, published (one indexed read). */
async function annexOf(db: Db, sessionId: number): Promise<Record<string, Record<string, unknown>>> {
	const [row] = await db
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return publishedAnnex(row?.annex)
}

export type PublishedSprites = {
	byId: Record<string, { set: string; label: string }>
} & Record<string, unknown>

/**
 * Each cast member's current sprite, keyed by id and by the cast key the
 * state index uses. One query over the session's recent lines.
 */
export async function publishedSprites(
	db: Db,
	sessionId: number,
	state: ResolvedState
): Promise<PublishedSprites> {
	const out: PublishedSprites = { byId: {} }
	// A card-less player seat's entry (`id: 0`) has no card, so no sprites.
	const entries = (
		Object.values(state.cast.byId ?? {}) as {
			id: number
			key: string
		}[]
	).filter((e) => e.id > 0)
	if (entries.length === 0) return out
	// Static imports, both (2026-10-19): a dynamic import on the action-list
	// build path stalls in the module runner while a run's own imports are
	// in flight, and the start push then lands after the run has ended —
	// Retry read "enabled" mid-generation. Both modules are already on the
	// sessions socket's static graph, so nothing new loads.
	const { asShownSprite, spriteSetOverridesFor } = { ...sharedSprites, ...spriteChoices }
	const ids = entries.map((e) => e.id)
	const overrides = await spriteSetOverridesFor(db, sessionId, ids)
	const rows = await db
		.select({
			characterId: schema.sessionMessages.characterId,
			metadata: schema.sessionMessages.metadata,
			isHidden: schema.sessionMessages.isHidden
		})
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(desc(schema.sessionMessages.id))
		.limit(400)
	const seen = new Set<number>()
	for (const r of rows) {
		if (r.isHidden || r.characterId == null || seen.has(r.characterId)) continue
		const sprite = asShownSprite((r.metadata as any)?.sprite)
		if (!sprite) continue
		seen.add(r.characterId)
		out.byId[String(r.characterId)] = {
			set: overrides[r.characterId] ?? sprite.set,
			label: sprite.label
		}
	}
	for (const e of entries) {
		const current = out.byId[String(e.id)]
		if (current && !(e.key in out)) out[e.key] = current
	}
	return out
}

/**
 * Is anything generating in this session — a message row, or a registered
 * `reply` / `action` run (an action run may have no live row at all; an
 * image render or a summary is the session being busy as much as a reply).
 *
 * A fire made **by a run** — the oracle answering a form (U5d) — carries
 * `lineage`, and the runs above it are its own tree, not "something else
 * generating" (review W1): the root and every ancestor up the parent chain
 * (walked through `pipeline_runs.parent_run_id`, saved before a run
 * dispatches) are set aside, so a form-answerable action with a
 * `session.generating` predicate is admitted on the AI road exactly as on
 * the click road. Nothing else is: a second root running beside the tree
 * still counts.
 */
export async function sessionGenerating(
	db: Db,
	sessionId: number,
	opts: { lineage?: RunLineage; starting?: boolean } = {}
): Promise<boolean> {
	// 🚧 The start push (W-A1) says a run is generating because it IS the
	// start: a list built a beat after a fast run ended must not read
	// "enabled" for the push that announced the run (2026-10-19).
	if (opts.starting) return true
	const own = await ownTree(db, opts.lineage)
	if (
		runRegistry
			.active()
			.some(
				(h) =>
					h.sessionId === sessionId &&
					h.kind !== "maintenance" &&
					// 🚧 A routine never makes the session busy (R13): a
					// person's work goes ahead of it, never behind it.
					h.kind !== "routine" &&
					!own.has(h.runId)
			)
	)
		return true
	const [row] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.isGenerating, true)
			)
		)
		.limit(1)
	return !!row
}

/**
 * 🚧 Wait — up to `ms` — while the session is busy only with runs nobody is
 * watching stream: registered action runs (a turn's children settling, a
 * background step), with no reply run and no row being written. A real
 * reply returns at once, and the caller refuses as before; so does a wait
 * that runs out. What a Regenerate pressed a beat after a turn waits on
 * (PLAN-dc-after-walk2 Q1-4: it was refused "wait for the reply to finish"
 * with nothing running).
 */
export async function settleBackgroundRuns(db: Db, sessionId: number, ms = 8000): Promise<void> {
	const end = Date.now() + ms
	for (;;) {
		const busy = runRegistry
			.active()
			.filter((h) => h.sessionId === sessionId && h.kind !== "maintenance" && h.kind !== "routine")
		if (!busy.length || busy.some((h) => h.kind === "reply")) return
		const [row] = await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(and(eq(schema.sessionMessages.sessionId, sessionId), eq(schema.sessionMessages.isGenerating, true)))
			.limit(1)
		if (row || Date.now() > end) return
		await new Promise((r) => setTimeout(r, 150))
	}
}

/** The run ids of a fire's own tree — its root and the parent chain — or none for a person's press. */
async function ownTree(db: Db, lineage?: RunLineage): Promise<Set<string>> {
	const own = new Set<string>()
	if (!lineage) return own
	own.add(lineage.rootRunId)
	let cur: string | null = lineage.parentRunId
	// Bounded by the depth cap: a chain longer than that was refused at its door.
	for (let i = 0; cur && !own.has(cur) && i <= MAX_RUN_DEPTH; i++) {
		own.add(cur)
		const [row] = await db
			.select({ parentRunId: schema.pipelineRuns.parentRunId })
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.runId, cur))
			.limit(1)
		cur = row?.parentRunId ?? null
	}
	return own
}

/**
 * The session half: `session` and `state`, with no `item`. One document per
 * listing; the fire builds the same and adds the row it names. `lineage`
 * is the fire's own, when a run made it — see `sessionGenerating`.
 */
export async function publishedValues(
	db: Db,
	sessionId: number,
	opts: { lineage?: RunLineage; starting?: boolean } = {}
): Promise<PublishedValues> {
	const [generating, fields, state, open, backdrop, annex, turns, rules] = await Promise.all([
		sessionGenerating(db, sessionId, opts),
		genreFieldsFor(db, sessionId),
		stateFor(db, sessionId),
		openFormOf(db, sessionId),
		publishedBackdrop(db, sessionId),
		annexOf(db, sessionId),
		turnsOf(db, sessionId),
		rulesOf(db, sessionId)
	])
	const sprites = await publishedSprites(db, sessionId, state)
	const openForm = open ? { action: open.action } : null
	return { session: { generating, fields, openForm, ...turns }, state, sprites, backdrop, annex, rules }
}

/**
 * The `item` document for a real row, for the actor — what the door reads.
 * `null` when the message is not this session's.
 */
export async function itemValuesFor(
	db: Db,
	sessionId: number,
	messageId: number,
	actor: { userId: number }
): Promise<ItemValues | null> {
	const [row] = await db
		.select({
			id: schema.sessionMessages.id,
			sessionId: schema.sessionMessages.sessionId,
			channel: schema.sessionMessages.channel,
			isHidden: schema.sessionMessages.isHidden,
			isGenerating: schema.sessionMessages.isGenerating,
			role: schema.sessionMessages.role,
			// Who spoke it (`item.speaker`, lair re-plan R11) — the same
			// columns the widget's row carries, never the user id.
			characterId: schema.sessionMessages.characterId,
			personaId: schema.sessionMessages.personaId,
			metadata: schema.sessionMessages.metadata
		})
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, messageId))
		.limit(1)
	if (!row || row.sessionId !== sessionId) return null
	// Newest = this row IS the channel head — the one definition of "the
	// head" (`channelHead`, U5f), lane-scoped like the column it reads.
	const head = await channelHead(db, sessionId, row.channel)
	return itemValuesOf(row, {
		isNewest: head === row.id,
		mine: await canActOnMessage(db, messageId, actor.userId)
	})
}

/** The session document with one row's `item` — the fire's whole reading. */
export async function publishedValuesWithItem(
	db: Db,
	sessionId: number,
	messageId: number | undefined,
	actor: { userId: number }
): Promise<PublishedValues> {
	const doc = await publishedValues(db, sessionId)
	if (messageId == null) return doc
	const item = await itemValuesFor(db, sessionId, messageId, actor)
	return item ? { ...doc, item } : doc
}
