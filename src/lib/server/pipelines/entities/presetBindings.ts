/**
 * What the session's preset decided (24 §1) — read at run time, not only at
 * write time.
 *
 * A `session_presets` row is the bundle a person chose to start from: for each
 * of the genre's event slots, which pipeline answers and, optionally, with
 * which configuration. Until now that blob was validated on save and then
 * never read again: dispatch resolved the spec off the input lock alone and
 * the config off `resolveSelectedConfig`'s session → instance → shipped chain,
 * so a preset naming a second `message-respond` pipeline, or a tuned
 * configuration, changed nothing about the session it started. This module is
 * the reader that closes that gap, and it is deliberately the *only* one — two
 * places interpreting the same blob is how the picker and the run come to
 * disagree.
 *
 * ## Two questions, deliberately separate
 *
 * **Which spec answers this event** needs the event, so it is asked by the
 * dispatch seams (`resolveSessionEventSpec`, `resolveSubjectSpec`).
 *
 * **Which config that spec runs with** is asked by `resolveSelectedConfig`,
 * which is handed a spec and a session and no event at all — and must stay
 * that way, because it is also the answer for the open `session-action` slot,
 * where the preset curates *presence* through `includedActions` and names the
 * configuration through `configSelections` rather than through an event
 * binding. Keying the config lookup on the spec rather than the event is what
 * lets one rule serve both.
 *
 * ## A binding that no longer resolves falls back, out loud
 *
 * Ruled 2026-09-10: an upgrade or a plugin removal must never stop a session
 * working without an administrator's intervention. So read-time resolution
 * returns a **verdict** rather than throwing — the turn runs on the genre's
 * own answer for that event, which is what a session with no preset would have
 * run all along.
 *
 * The danger the verdict exists to close is the *quiet* substitution: a
 * pipeline the administrator did not choose taking the turn while every screen
 * keeps showing the one they did. That is the failure `selectConfig` refuses
 * for configs — "a selection that silently does nothing is the hardest kind of
 * configuration bug to see". Falling back does not create it; falling back
 * **silently** would. So the fallback is named in four places, and each is a
 * different reader: the run's receipt, the session banner, a persistent notice
 * on the preset, and the admin list.
 *
 * The **save** path stays strict. An administrator naming a pipeline that
 * cannot answer is a mistake to catch while they are looking at the form, not
 * a state to tolerate; `sessionPresets:update` refuses it exactly as before.
 *
 * A *config* that no longer resolves falls through the same way, matching
 * `resolveSelectedConfig`'s existing treatment of a stale selection: a config
 * id is an instance fact that a spec change can legitimately strand, and the
 * shipped default is a correct answer to "which values".
 */

import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/**
 * A preset binds an event to a pipeline that cannot answer it any more.
 *
 * The **save** path's refusal, and only the save path's: `sessionPresets:update`
 * will not store a binding that does not resolve, because an administrator
 * looking at the form is the cheapest possible place to catch it. Read time
 * answers with a verdict instead (see the module note) — a session must keep
 * working when a plugin leaves, and a throw there is the turn refusing.
 */
export class PresetBindingUnresolvableError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "PresetBindingUnresolvableError"
	}
}

type PresetRow = typeof schema.sessionPresets.$inferSelect

/**
 * A preset's binding for one event, evaluated.
 *
 * Three answers, and the callers must keep them apart:
 *
 * · `preset` — the administrator's choice resolves; run it.
 * · `none` — the session is on no preset, or its preset binds nothing here.
 *   The caller's own layers decide, exactly as before presets existed.
 * · `fallback` — the choice does not resolve, so `spec` is the genre's own
 *   answer for the event and everything else on the verdict is what must be
 *   said out loud about that substitution.
 *
 * `spec` is null on a `fallback` only when the genre has no answer either,
 * which is the ordinary "nothing serves" state rather than a second failure.
 */
export type PresetEventVerdict =
	| { via: "preset"; spec: string; preset: string; presetId: number }
	| { via: "none"; spec: null }
	| ({ via: "fallback"; spec: string | null } & PresetFallback)

/**
 * The substitution, in the shape every surface repeats it in.
 *
 * One shape rather than each reader composing its own sentence: the receipt,
 * the session banner, the admin notice and the preset list are four places
 * saying the same thing, and four hand-written versions of it is how they come
 * to say different things.
 */
export interface PresetFallback {
	presetId: number
	/** The preset's name, because that is what an administrator recognises. */
	preset: string
	event: string
	/** The slug the preset still names. */
	bound: string
	/** Why it does not resolve, as a sentence. */
	reason: string
}

/**
 * The preset a session was born on, or null.
 *
 * Null covers three states that need no telling apart here: the session named
 * no preset, the session is gone, and the preset was deleted (which is
 * allowed — "sessions born from it keep running; they simply reference
 * nothing").
 */
export async function sessionPreset(
	db: Db,
	sessionId: number | null | undefined
): Promise<PresetRow | null> {
	if (sessionId == null) return null
	const [session] = await db
		.select({ presetId: schema.sessions.presetId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (session?.presetId == null) return null
	const [preset] = await db
		.select()
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.id, session.presetId))
		.limit(1)
	return (preset as PresetRow | undefined) ?? null
}

const bindingsOf = (preset: PresetRow) =>
	(preset.bindings ?? {}) as Record<string, { spec: string; config?: number }>

/**
 * Does this version's inlet lock answer `event` (PLAN-turn-order §4.1)?
 *
 * Two spellings, one question: the ordinary one-event lock stores
 * `input_event`, and a lock over several stores `input_events` and leaves
 * the singular null. Asked in one place so read-time resolution and the
 * boot reconcile cannot come to disagree — the same reason
 * `presetBindingRefusal` exists.
 */
export function answersEvent(
	version: { inputEvent?: string | null; inputEvents?: string[] | null },
	event: string
): boolean {
	if (version.inputEvent === event) return true
	return Array.isArray(version.inputEvents)
		? version.inputEvents.includes(event)
		: false
}

/**
 * The one published spec whose active version declares (genre, event).
 *
 * The genre's own answer — what a session on no preset runs, and therefore what
 * a stale binding falls back to. It lives here rather than in `sessionEvents`
 * because the verdict below has to state it, and two copies of "which pipeline
 * does this genre use for this event" is how the fallback and the run come to
 * disagree about what the fallback was.
 *
 * ⚠ Filtered in memory rather than in SQL: the lock columns are nullable and
 * the active-version check compares two tables' columns, so the predicate is
 * cheaper to read here than as a join condition. Genres and specs are both
 * small, closed sets.
 *
 * ⚠ **Ordered by spec id**, for the reason `resolveSubjectSpec` states about
 * its own tie-break: more than one published spec can declare (genre,
 * `message-respond`), and an unordered SELECT makes "the first one" whatever
 * order the heap returns. Two installs with identical data would then name
 * different fallbacks, and only one of them would ever look wrong.
 */
export async function lockedEventSpec(
	db: Db,
	genreId: string,
	event: string
): Promise<string | null> {
	const rows = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId,
			versionId: schema.pipelineSpecVersions.id,
			status: schema.pipelineSpecVersions.status,
			inputGenre: schema.pipelineSpecVersions.inputGenre,
			inputEvent: schema.pipelineSpecVersions.inputEvent,
			inputEvents: schema.pipelineSpecVersions.inputEvents
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
		)
		.orderBy(asc(schema.pipelineSpecs.id))
	const hit = (rows as any[]).find(
		(r) =>
			r.activeVersionId === r.versionId &&
			r.status === "published" &&
			r.inputGenre === genreId &&
			answersEvent(r, event)
	)
	return (hit?.slug as string | undefined) ?? null
}

/**
 * Why a bound slug does not answer (genre, event), or null when it does.
 *
 * The predicate, in one place: read-time resolution and the boot reconcile ask
 * the same question about the same blob, and a second copy would let a session
 * fall back over something the admin screen called healthy.
 */
export async function bindingRefusal(
	db: Db,
	opts: { genreId: string; event: string; slug: string }
): Promise<string | null> {
	const rows = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId,
			versionId: schema.pipelineSpecVersions.id,
			status: schema.pipelineSpecVersions.status,
			inputGenre: schema.pipelineSpecVersions.inputGenre,
			inputEvent: schema.pipelineSpecVersions.inputEvent,
			inputEvents: schema.pipelineSpecVersions.inputEvents
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
		)
		.where(eq(schema.pipelineSpecs.slug, opts.slug))
	const hit = (rows as any[]).find(
		(r) => r.activeVersionId === r.versionId && r.status === "published"
	)
	if (!hit)
		return `'${opts.slug}' is not published on this pub — it was removed, retired, or never installed here.`
	if (hit.inputGenre !== opts.genreId || !answersEvent(hit, opts.event))
		return (
			`'${opts.slug}' now answers '${hit.inputEvent ?? "nothing"}' for ` +
			`'${hit.inputGenre ?? "no genre"}', not '${opts.event}' of '${opts.genreId}' (24 §4).`
		)
	return null
}

/**
 * One preset row's verdict for one event — the reconcile's door onto the same
 * predicate the run uses, without a session to read the preset from.
 */
export async function presetBindingVerdict(
	db: Db,
	preset: PresetRow,
	genreId: string,
	event: string
): Promise<PresetEventVerdict> {
	const bound = bindingsOf(preset)[event]
	if (!bound?.spec) return { via: "none", spec: null }
	const reason = await bindingRefusal(db, {
		genreId,
		event,
		slug: bound.spec
	})
	if (!reason)
		return {
			via: "preset",
			spec: bound.spec,
			preset: preset.name,
			presetId: preset.id
		}
	return {
		via: "fallback",
		// The genre's own answer, which is what a session on no preset runs.
		// Null here is "nothing serves", not a second failure.
		spec: await lockedEventSpec(db, genreId, event),
		presetId: preset.id,
		preset: preset.name,
		event,
		bound: bound.spec,
		reason
	}
}

/**
 * What the session's preset decided about this event.
 *
 * Never throws. A binding that stopped resolving comes back as a `fallback`
 * verdict carrying the genre's own answer and everything a surface needs to
 * name the substitution — see the module note for why that is the ruling.
 */
export async function presetEventSpec(
	db: Db,
	opts: {
		sessionId: number | null | undefined
		genreId: string
		event: string
	}
): Promise<PresetEventVerdict> {
	const preset = await sessionPreset(db, opts.sessionId)
	if (!preset) return { via: "none", spec: null }
	return await presetBindingVerdict(db, preset, opts.genreId, opts.event)
}

/**
 * Which config the session's preset names for this spec, or null.
 *
 * Two places state it and this is their order: a binding's own `config`, which
 * is the specific answer an administrator gave for one slot, then
 * `configSelections`, which is the per-pipeline answer that also covers the
 * action specs no event binding can name.
 *
 * Unvalidated on purpose — the caller confirms the row still belongs to the
 * spec, which is the check it already performs for a session's own selection.
 */
export async function presetConfigForSpec(
	db: Db,
	opts: { sessionId: number | null | undefined; specSlug: string }
): Promise<number | null> {
	const preset = await sessionPreset(db, opts.sessionId)
	if (!preset) return null
	for (const bound of Object.values(bindingsOf(preset)))
		if (bound?.spec === opts.specSlug && bound.config != null)
			return Number(bound.config)
	const selections = (preset.configSelections ?? {}) as Record<string, number>
	const selected = selections[opts.specSlug]
	return selected != null ? Number(selected) : null
}
