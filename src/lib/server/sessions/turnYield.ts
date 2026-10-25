/**
 * The **turn yield** (lair pass R2, owner 2026-09-28): every message row one
 * turn's run created — on every channel, hidden rows included — and never a
 * person's own line.
 *
 * It is what Regenerate the last turn (`core#retake`) deletes, and what the
 * row regenerate reads to tell a one-row reply (which keeps its swipes) from
 * a turn that wrote several (which is retaken whole). Keyed on facts the host
 * already records — `pipeline_run_artifacts` (`kind = 'message'`, `action =
 * 'created'`), recorded at every host commit — never on a genre, a speaker or
 * a row's position: the same reading answers for any genre whose turn writes
 * more than one row.
 *
 * **A planned turn's rows are the planning turn's** (🚧 Lair character
 * turns, owner ruling 2026-09-30): a character turn fired off a standing
 * turn plan (`via: 'plan'`) is the rest of the turn that planned it, and
 * the rows it writes carry that plan row as `metadata.planRowId`. So the
 * plan row's run yields them too (`turnYieldOf`), and the newest planned
 * row's turn is the planning run's (`turnRunOf`).
 *
 * 🚧 **A form's answer row is the asking turn's** (Lair rewrite D3,
 * 2026-10-21): a row that answers a form on one of the turn's rows
 * (`metadata.answersForm` — the Lair's dice row, answering a roll form the
 * plan asked) is that turn's work too; its turn is the asking row's
 * (`turnRunOf`) and the yield holds it, so Regenerate the last turn takes the
 * roll forms and the dice with the plan.
 *
 * What is NOT in it:
 *  - **a person's line** (`role: 'user'`), even one the run wrote for them —
 *    a retake never deletes what somebody said;
 *  - **rows any other child run wrote** (an action the turn fired): each
 *    run's artifacts are its own, so the parent's yield never holds them;
 *  - **rows already deleted**: an artifact names an id, with no key, so a gone
 *    row is simply not found.
 *
 * Not *footprint* (`slotFootprint`, the layout ladder's) and not *span*
 * (layout `span`).
 */

import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { actionsOf, envoySlugOfRef, i18nText, resolveTurnControls, type I18n } from "@serene-pub/sdk"
import { ownVoiceName } from "$lib/shared/sessions/ownVoiceName"
import * as schema from "$lib/server/db/schema"

/** One row of a turn's yield, as the confirm dialog names it. */
export interface TurnYieldRow {
	messageId: number
	channel: string
	role: string
	characterId: number | null
	/**
	 * Who wrote it, for a person to read: the delver's name, an envoy's
	 * name (the row's `speaker`), a narration's stamped narrator name, else
	 * the pipeline's own voice (`ownVoiceName` — the Lair's _Castellan_).
	 */
	name: string
}

/** The run that took a turn, and what it left. */
export interface TurnYield {
	/** `pipeline_runs.id`. */
	runId: number
	/** The run's own id (`pipeline_runs.run_id`). */
	runUuid: string
	specSlug: string
	rows: TurnYieldRow[]
	/**
	 * 🚧 Every run whose rows the yield holds — the turn's own run first,
	 * then each planned turn's (Lair character turns): their writes are the
	 * turn's own work, and a retake takes them with it.
	 */
	runs: Array<{ runId: number; runUuid: string }>
	/**
	 * The entry the turn was fired with, read back off the run's inlet: the
	 * speaker it was fired for (`character:<id>`, an envoy's reference, or
	 * null — the pipeline's own voice) and its `via` off the inlet's `via`
	 * port (R8): a narration retakes as a narration. Absent `via` retakes as
	 * a pick.
	 */
	entry: { ref: string | null; via: string }
}

/** Why there is no turn to retake, as a sentence a person can act on. */
export type LastTurnVerdict =
	| { ok: true; yield: TurnYield }
	| { ok: false; reason: "empty" | "own-line" | "action" | "not-a-turn"; refusal: string }

/**
 * The run that CREATED a message — not the latest run to touch it (a
 * regenerate's run records the row `updated`), and never a preview.
 */
export async function creatingRunOf(
	db: Db,
	messageId: number
): Promise<typeof schema.pipelineRuns.$inferSelect | null> {
	const [hit] = await db
		.select({ run: schema.pipelineRuns })
		.from(schema.pipelineRunArtifacts)
		.innerJoin(
			schema.pipelineRuns,
			eq(schema.pipelineRuns.id, schema.pipelineRunArtifacts.runId)
		)
		.where(
			and(
				eq(schema.pipelineRunArtifacts.kind, "message"),
				eq(schema.pipelineRunArtifacts.action, "created"),
				eq(schema.pipelineRunArtifacts.entityId, messageId)
			)
		)
		.orderBy(asc(schema.pipelineRuns.isPreview), desc(schema.pipelineRuns.id))
		.limit(1)
	return hit?.run ?? null
}

/**
 * 🚧 The run whose **turn** a message belongs to: the run that created its
 * plan row, for a planned turn's row (`metadata.planRowId`), else the run
 * that created the row itself (`creatingRunOf`).
 */
export async function turnRunOf(
	db: Db,
	messageId: number
): Promise<typeof schema.pipelineRuns.$inferSelect | null> {
	const [row] = await db
		.select({ metadata: schema.sessionMessages.metadata })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, messageId))
		.limit(1)
	const meta = row?.metadata as { planRowId?: unknown; answersForm?: { messageId?: unknown } } | null
	const planRowId = meta?.planRowId
	// 🚧 An answer's row is the turn that asked (D3) — never a person's line:
	// `lastTurnOf` stops at those before it asks.
	const asked = Number(meta?.answersForm?.messageId)
	if (Number.isInteger(asked) && asked > 0 && asked !== messageId) return turnRunOf(db, asked)
	return creatingRunOf(db, typeof planRowId === "number" ? planRowId : messageId)
}

/**
 * **`turnYieldOf`** — every message row this run created that still exists,
 * on every channel, oldest first, excluding every `role: 'user'` row — and
 * every row a turn it planned wrote (`metadata.planRowId` naming one of
 * them).
 */
export async function turnYieldOf(db: Db, runId: number): Promise<TurnYieldRow[]> {
	const artifacts = await db
		.select({ entityId: schema.pipelineRunArtifacts.entityId })
		.from(schema.pipelineRunArtifacts)
		.where(
			and(
				eq(schema.pipelineRunArtifacts.runId, runId),
				eq(schema.pipelineRunArtifacts.kind, "message"),
				eq(schema.pipelineRunArtifacts.action, "created")
			)
		)
	const created = [...new Set(artifacts.map((a) => a.entityId))]
	if (!created.length) return []
	const planned = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			inArray(
				sql<string>`${schema.sessionMessages.metadata}->>'planRowId'`,
				created.map(String)
			)
		)
	const turnIds = [...new Set([...created, ...planned.map((r) => r.id)])]
	// 🚧 And the rows that answer a form on one of them (D3): the dice.
	const answers = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			inArray(
				sql<string>`${schema.sessionMessages.metadata}->'answersForm'->>'messageId'`,
				turnIds.map(String)
			)
		)
	const ids = [...new Set([...turnIds, ...answers.map((r) => r.id)])]
	const rows = await db
		.select({
			id: schema.sessionMessages.id,
			sessionId: schema.sessionMessages.sessionId,
			channel: schema.sessionMessages.channel,
			role: schema.sessionMessages.role,
			characterId: schema.sessionMessages.characterId,
			metadata: schema.sessionMessages.metadata,
			characterName: schema.characters.name
		})
		.from(schema.sessionMessages)
		.leftJoin(
			schema.characters,
			eq(schema.characters.id, schema.sessionMessages.characterId)
		)
		.where(
			and(
				inArray(schema.sessionMessages.id, ids),
				ne(schema.sessionMessages.role, "user"),
				// 🚧 Never a row Back took out of the history (RF fix 5).
				isNull(schema.sessionMessages.rewindOrdinal)
			)
		)
		.orderBy(asc(schema.sessionMessages.id))
	const naming = rows.length
		? await rowNaming(db, rows[0]!.sessionId)
		: { envoyName: () => undefined, ownVoice: "" }
	return rows.map((r) => {
		const meta = r.metadata as {
			narratorName?: string
			speaker?: unknown
		} | null
		return {
			messageId: r.id,
			channel: r.channel,
			role: r.role,
			characterId: r.characterId,
			name:
				r.characterName ??
				naming.envoyName(meta?.speaker) ??
				meta?.narratorName ??
				naming.ownVoice
		}
	})
}

/**
 * How a yield row is named when no character claims it (lair pass R5
 * follow-up, R6): an envoy's row by that envoy's declared name, anything
 * else by the pipeline's **own voice** — the genre's fallback envoy, else
 * the session's narrator name, else `UNCLAIMED_LINE_NAME` (`ownVoiceName`,
 * the one rule every reader shares). Read once per yield.
 */
async function rowNaming(
	db: Db,
	sessionId: number
): Promise<{ envoyName: (ref: unknown) => string | undefined; ownVoice: string }> {
	const { sessionDeclaredEnvoys } = await import(
		"$lib/server/pipelines/entities/envoys"
	)
	const { narratorNameFor } = await import(
		"$lib/server/pipelines/runtime/host"
	)
	const [declared, narratorName] = await Promise.all([
		sessionDeclaredEnvoys(db, sessionId).catch(() => []),
		narratorNameFor(db, sessionId, undefined).catch(() => undefined)
	])
	const bySlug = new Map(declared.map((d) => [d.slug, d]))
	return {
		envoyName: (ref) => {
			const slug = envoySlugOfRef(ref)
			const d = slug ? bySlug.get(slug) : undefined
			return d ? i18nText(d.name as I18n) || d.slug : undefined
		},
		ownVoice: ownVoiceName({ envoys: declared, narratorName })
	}
}

/** What a run's inlet published, off its receipt. */
function inletOutputOf(receipt: unknown): {
	speaker?: unknown
	characterId?: unknown
	via?: unknown
} {
	const nodes = (receipt as { nodes?: Array<{ kind?: string; output?: unknown }> } | null)
		?.nodes
	const inlet = Array.isArray(nodes) ? nodes.find((n) => n?.kind === "inlet") : undefined
	return (inlet?.output ?? {}) as { speaker?: unknown; characterId?: unknown; via?: unknown }
}

/**
 * How the run that CREATED a message was reached — its inlet's `via` (lair
 * pass R8) — or undefined when it recorded none. What a verb re-driving that
 * row fires with, so a regenerated narration narrates again.
 */
export async function recordedViaOf(
	db: Db,
	messageId: number
): Promise<string | undefined> {
	const run = await creatingRunOf(db, messageId)
	const via = run ? inletOutputOf(run.receipt).via : undefined
	return typeof via === "string" && via ? via : undefined
}

/**
 * The entry a run was fired with, off its receipt's inlet: whom the turn was
 * for and how it was reached. The inlet's own published values, so nothing
 * here re-decides whose turn it was.
 */
function entryOf(receipt: unknown): TurnYield["entry"] {
	const out = inletOutputOf(receipt)
	const ref =
		typeof out.speaker === "string" && out.speaker
			? out.speaker
			: typeof out.characterId === "number"
				? `character:${out.characterId}`
				: null
	return {
		ref,
		via: typeof out.via === "string" && out.via ? out.via : "pick"
	}
}

/**
 * The newest turn on a channel, resolved to its yield — or why there is none
 * to retake (R2):
 *
 * 1. the newest row on the channel is the person's own → nothing to retake;
 * 2. else the newest row that is not the person's, and the run whose turn
 *    it is (`turnRunOf`: a planned turn's row is its planning run's);
 * 3. that run must be a **reply run** — a fired turn. A run whose spec
 *    contributes an action (Trigger trap, Reveal, a room answer) is refused
 *    by the action's name; a run that is neither (a greeting's create run, a
 *    row no run recorded) is no turn;
 * 4. the yield: every row that run created, on every channel, and every
 *    row the turns it planned wrote.
 */
export async function lastTurnOf(
	db: Db,
	sessionId: number,
	channel = "main"
): Promise<LastTurnVerdict> {
	const [newest] = await db
		.select({ id: schema.sessionMessages.id, role: schema.sessionMessages.role })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.channel, channel),
				// 🚧 The live history (RF fix 5): the newest turn is the
				// newest one Back left.
				isNull(schema.sessionMessages.rewindOrdinal)
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)
	if (!newest)
		return {
			ok: false,
			reason: "empty",
			refusal: "Nothing has been written yet, so there is no turn to regenerate."
		}
	if (newest.role === "user")
		return {
			ok: false,
			reason: "own-line",
			refusal: "Your line is the newest. Press Continue."
		}
	return turnOfRow(db, newest.id)
}

/**
 * The turn one row belongs to, resolved to its yield — steps 2–4 of
 * `lastTurnOf`, for a row that is not a person's: the run whose turn it is
 * must be a reply run (an action's row, a greeting's, a row no run recorded
 * is no turn). 🚧 Also what `latestStoryTurnOf` reads (owner rulings
 * 2026-10-15, deletions and retry).
 */
export async function turnOfRow(db: Db, messageId: number): Promise<LastTurnVerdict> {
	const run = await turnRunOf(db, messageId)
	const notATurn = {
		ok: false as const,
		reason: "not-a-turn" as const,
		refusal: "The newest message did not come from a turn, so there is no turn to regenerate."
	}
	if (!run) return notATurn
	const { loadPublished } = await import("$lib/server/pipelines/boot/bootstrap")
	const doc = await loadPublished(db, run.specSlug).catch(() => null)
	if (!doc) return notATurn
	const [action] = actionsOf(doc as { id: string; contributes?: unknown })
	if (action) {
		const name = i18nText(action.label as I18n | undefined) || action.key
		return {
			ok: false,
			reason: "action",
			refusal: `The newest message came from ${name}. Regenerate it from its own menu.`
		}
	}
	const role = ((doc as { taxonomy?: { role?: unknown } }).taxonomy ?? {}).role
	if (role === "create") return notATurn
	const rows = await turnYieldOf(db, run.id)
	const runs = new Map([[run.id, run.runId]])
	for (const row of rows) {
		const by = await creatingRunOf(db, row.messageId)
		if (by && !runs.has(by.id)) runs.set(by.id, by.runId)
	}
	// 🚧 And every run that wrote a row of the yield again — a swipe, which
	// claims the turn's row and re-applies the turn's rules there
	// (PLAN-rulesets §29): its work is the turn's, and goes with it.
	if (rows.length) {
		const rewrote = await db
			.selectDistinct({ id: schema.pipelineRuns.id, runId: schema.pipelineRuns.runId })
			.from(schema.pipelineRunArtifacts)
			.innerJoin(schema.pipelineRuns, eq(schema.pipelineRuns.id, schema.pipelineRunArtifacts.runId))
			.where(
				and(
					eq(schema.pipelineRunArtifacts.kind, "message"),
					eq(schema.pipelineRuns.isPreview, false),
					inArray(
						schema.pipelineRunArtifacts.entityId,
						rows.map((r) => r.messageId)
					)
				)
			)
		for (const r of rewrote) if (!runs.has(r.id)) runs.set(r.id, r.runId)
	}
	return {
		ok: true,
		yield: {
			runId: run.id,
			runUuid: run.runId,
			specSlug: run.specSlug,
			rows,
			runs: [...runs].map(([runId, runUuid]) => ({ runId, runUuid })),
			entry: entryOf(run.receipt)
		}
	}
}

/**
 * 🚧 The **latest story turn** on a channel (owner rulings 2026-10-15,
 * deletions and retry): its newest visible reply that is not narration
 * (`headId` — a roll line or a reveal's notice is no reply), the turn that
 * row belongs to, and the reply before it that the turn did not write
 * (`previousId`, null when there is none). The person lines between the two
 * are the round that turn answered. Null when the newest reply is no turn
 * (an action's notice, the opening a create wrote) or there is none.
 */
export interface LatestStoryTurn {
	turn: TurnYield
	headId: number
	previousId: number | null
}

export async function latestStoryTurnOf(
	db: Db,
	sessionId: number,
	channel = "main"
): Promise<LatestStoryTurn | null> {
	const replies = await db
		.select({
			id: schema.sessionMessages.id,
			isHidden: schema.sessionMessages.isHidden,
			isNarratorResponse: schema.sessionMessages.isNarratorResponse
		})
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.channel, channel),
				ne(schema.sessionMessages.role, "user"),
				isNull(schema.sessionMessages.rewindOrdinal)
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(200)
	const spoken = replies.filter((r) => !r.isHidden && !r.isNarratorResponse)
	const head = spoken[0]
	if (!head) return null
	const verdict = await turnOfRow(db, head.id)
	if (!verdict.ok) return null
	const own = new Set(verdict.yield.rows.map((r) => r.messageId))
	const previous = spoken.find((r) => r.id < head.id && !own.has(r.id))
	return { turn: verdict.yield, headId: head.id, previousId: previous?.id ?? null }
}

/**
 * 🚧 Where one row stands against the story's turns — what a genre that
 * keeps its turns (`turnDeleteVerdict`, `messages/verbs.ts`) reads before a
 * delete. Only on a channel that offers the retake (Story; a folio the
 * story turn writes to): elsewhere — a Planner lane — every row is `open`.
 *
 *  - `latest` — the row is the latest story turn's: a row its run wrote
 *    (`turn` is that yield: the reply, its roll line, its journal line), or
 *    a line of the round it answered (`turn` null);
 *  - `older` — the row is an earlier turn's, or anything before it;
 *  - `open` — after the latest turn (the next round's lines), or no story
 *    turn has been taken yet.
 */
export type TurnAge =
	| { age: "open" }
	| { age: "older" }
	| { age: "latest"; turn: TurnYield | null }

export async function turnAgeOf(
	db: Db,
	sessionId: number,
	messageId: number,
	shape: unknown,
	storyChannel = "main"
): Promise<TurnAge> {
	const [row] = await db
		.select({
			id: schema.sessionMessages.id,
			sessionId: schema.sessionMessages.sessionId,
			channel: schema.sessionMessages.channel
		})
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, messageId))
		.limit(1)
	if (!row || row.sessionId !== sessionId) return { age: "open" }
	const channel = row.channel || "main"
	if (!resolveTurnControls(shape, channel).retake.offered) return { age: "open" }
	const latest = await latestStoryTurnOf(db, sessionId, storyChannel)
	if (!latest) return { age: "open" }
	if (latest.turn.rows.some((r) => r.messageId === row.id))
		return { age: "latest", turn: latest.turn }
	if (row.id > latest.headId) return { age: "open" }
	if (channel === storyChannel && (latest.previousId === null || row.id > latest.previousId))
		return { age: "latest", turn: null }
	return { age: "older" }
}
