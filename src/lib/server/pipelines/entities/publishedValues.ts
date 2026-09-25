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
 *   session: { generating: boolean, fields: <sessions.genre_fields, declared keys> },
 *   state:   <ResolvedState — world · cast · possessions · slots · version, from stateFor>,
 *   sprites: { byId: { <characterId>: { set, label } }, <castKey>: { set, label } },
 *   item?:   { id, isNewest, hidden, generating, role, mine, hasSwipes, greeting }
 * }
 * ```
 *
 * `sprites` is each cast member's **current sprite** (DESIGN-sprites §6):
 * the label on their newest visible line, in the set the session overrides
 * them into if it does. Derived here, never stored — so `sprites.verity.label
 * equals 'armoured'` gates an action on a face, keyed exactly as
 * `state.cast` is.
 *
 * `state` is the resolver's answer (`state/resolve.ts`), keyed as a template
 * reads it — `state.world.location`, `state.cast.verity.hp`, and
 * `state.version`, the session's state version (U5f) — never a second
 * resolver. `session.fields` is what the inlet hands a run (`genreFieldsFor`:
 * the stored values of the keys the genre declares; a declared field never
 * set reads `undefined`, as it does in a run). `session.generating` is true
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
import { stateFor, type ResolvedState } from "$lib/server/state/resolve"
import { genreFieldsFor } from "$lib/server/pipelines/entities/sessionGenres"
import * as runRegistry from "$lib/server/pipelines/runtime/runRegistry"
import { canActOnMessage } from "$lib/server/messages/permissions"
import { MAX_RUN_DEPTH, type RunLineage } from "$lib/server/pipelines/runtime/lineage"
import { itemValuesOf, type ItemValues } from "$lib/shared/actions/itemValues"

export {
	itemValuesOf,
	type ItemValues,
	type ItemRow
} from "$lib/shared/actions/itemValues"

export interface PublishedValues {
	session: {
		generating: boolean
		fields: Record<string, unknown>
	}
	state: ResolvedState
	/** Each cast member's current sprite — see the module comment. */
	sprites: PublishedSprites
	item?: ItemValues
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
	const entries = Object.values(state.cast.byId ?? {}) as {
		id: number
		key: string
	}[]
	if (entries.length === 0) return out
	const { asShownSprite } = await import("$lib/shared/sprites")
	const { spriteSetOverridesFor } = await import("$lib/server/sprites/choices")
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
	opts: { lineage?: RunLineage } = {}
): Promise<boolean> {
	const own = await ownTree(db, opts.lineage)
	if (
		runRegistry
			.active()
			.some(
				(h) =>
					h.sessionId === sessionId &&
					h.kind !== "maintenance" &&
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
	opts: { lineage?: RunLineage } = {}
): Promise<PublishedValues> {
	const [generating, fields, state] = await Promise.all([
		sessionGenerating(db, sessionId, opts),
		genreFieldsFor(db, sessionId),
		stateFor(db, sessionId)
	])
	const sprites = await publishedSprites(db, sessionId, state)
	return { session: { generating, fields }, state, sprites }
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
