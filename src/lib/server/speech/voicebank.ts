/**
 * 🚧 Voicebank helpers (speech build seam S4, lane C). The rules around
 * `voicebank_voices`: which loadout speaks, which entry is usable (its own loadout, voice loadouts), how a
 * row becomes a view, how a slug stays unique, and the one-time default seed.
 * Every function takes `db` explicitly (callers inside a transaction pass `tx`).
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defaultLoadoutFor, isFilled, loadoutById, mergeChain } from "$lib/server/loadouts"
import { readSpeechFacts } from "$lib/shared/connectionAdapters/speechFacts"
import type {
	VoicebankLabels,
	VoicebankLoadoutOption,
	VoicebankSettings,
	VoicebankVoiceView
} from "$lib/shared/speech/voicebank"

export type VoicebankRow = typeof schema.voicebankVoices.$inferSelect

/**
 * A voicebank entry's loadout, as the speech code reads it. The pair is the
 * loadout's merge ROOT's, with no unfilled fallback: a voice id belongs to one
 * model, so a loadout with no model yet is `filled: false` (its model null).
 */
export interface EntryLoadout {
	loadoutId: number
	name: string
	connectionId: number | null
	connectionModelId: number | null
	samplingConfigId: number | null
	filled: boolean
	/** The loadout row's own **loadout voice** (not the merge root's); null = first entry. */
	defaultVoiceId: number | null
	/** The row's own **other speakers** entry; null = Auto. */
	otherSpeakersVoiceId: number | null
}

/** The loadout that speaks by default (same shape as an entry's). */
export type SpeakingLoadout = EntryLoadout

/** The shipped Narration loadout (`core:loadout/tts@1`) by seed key, or null. */
async function narrationLoadoutBySeed(db: Db) {
	const [row] = await db
		.select()
		.from(schema.loadouts)
		.where(eq(schema.loadouts.seedKey, "core:loadout/tts@1"))
		.limit(1)
	return row ?? null
}

type LoadoutRowT = typeof schema.loadouts.$inferSelect

async function entryLoadoutOf(db: Db, row: LoadoutRowT): Promise<EntryLoadout> {
	const chain = await mergeChain(db, row)
	const root = chain[chain.length - 1]!
	const filled = isFilled(root) && root.connectionModelId != null
	return {
		loadoutId: row.id,
		name: row.name,
		connectionId: root.connectionId ?? null,
		connectionModelId: root.connectionModelId ?? null,
		samplingConfigId: root.samplingConfigId ?? null,
		filled,
		defaultVoiceId: row.defaultVoiceId ?? null,
		otherSpeakersVoiceId: row.otherSpeakersVoiceId ?? null
	}
}

/** An entry's loadout (merge root's pair), or null when none is assigned / it is gone. */
export async function entryLoadout(
	db: Db,
	loadoutId: number | null | undefined
): Promise<EntryLoadout | null> {
	if (loadoutId == null) return null
	const row = await loadoutById(db, loadoutId)
	return row ? entryLoadoutOf(db, row) : null
}

/** One `entryLoadout` per distinct id, for a request that shows many rows. */
export async function entryLoadouts(
	db: Db,
	ids: Iterable<number | null | undefined>
): Promise<Map<number, EntryLoadout>> {
	const out = new Map<number, EntryLoadout>()
	for (const id of new Set(ids)) {
		if (id == null) continue
		const l = await entryLoadout(db, id)
		if (l) out.set(id, l)
	}
	return out
}

/**
 * The loadout that speaks when nothing else names one: the given one, else the
 * default loadout for `text->audio` (the Narration loadout). Null when neither
 * exists.
 */
export async function speakingLoadout(
	db: Db,
	loadoutId?: number | null
): Promise<SpeakingLoadout | null> {
	const row =
		loadoutId != null
			? await loadoutById(db, loadoutId)
			: ((await defaultLoadoutFor(db, "text->audio")) ??
				// A fresh pub has no `text->audio` default until Loadouts → Defaults
				// is touched (lane E finding F1, 2026-10-28): the shipped Narration
				// loadout answers by its seed key so the resolver has a pair as
				// soon as Narration is filled.
				(await narrationLoadoutBySeed(db)))
	return row ? entryLoadoutOf(db, row) : null
}

/** The `voice` value in a sampling config's values, or null. */
export async function loadoutSamplingVoice(
	db: Db,
	samplingConfigId: number | null | undefined
): Promise<string | null> {
	if (samplingConfigId == null) return null
	const [row] = await db
		.select({ values: schema.samplingConfigs.values })
		.from(schema.samplingConfigs)
		.where(eq(schema.samplingConfigs.id, samplingConfigId))
		.limit(1)
	const v = (row?.values as Record<string, unknown> | undefined)?.voice
	return typeof v === "string" && v.trim() ? v.trim() : null
}

/**
 * Why an entry cannot speak now, or null when it can: turned off, no loadout
 * (unassigned), or its loadout has no model yet. (A7 is retired: each entry
 * speaks on its own loadout's model.)
 */
export function voicebankRefusal(
	row: Pick<VoicebankRow, "enabled" | "loadoutId">,
	loadout: EntryLoadout | null
): string | null {
	if (!row.enabled) return "This voice is turned off."
	if (row.loadoutId == null || !loadout)
		return "This voice has no loadout; pick one in Loadouts → Voices."
	if (!loadout.filled || loadout.connectionModelId == null)
		return `Its loadout "${loadout.name}" has no model yet.`
	return null
}

/** Prefer owner `pub`, else the lowest id. */
export async function voicebankBySlug(
	db: Db,
	slug: string
): Promise<VoicebankRow | null> {
	const rows = await db
		.select()
		.from(schema.voicebankVoices)
		.where(eq(schema.voicebankVoices.slug, slug))
		.orderBy(asc(schema.voicebankVoices.id))
	return rows.find((r) => r.owner === "pub") ?? rows[0] ?? null
}

/** Every entry on one loadout, by id (its own voices, enabled or not). */
export async function loadoutVoiceRows(db: Db, loadoutId: number): Promise<VoicebankRow[]> {
	return db
		.select()
		.from(schema.voicebankVoices)
		.where(eq(schema.voicebankVoices.loadoutId, loadoutId))
		.orderBy(schema.voicebankVoices.id)
}

export function toVoicebankView(
	row: VoicebankRow,
	loadout: EntryLoadout | null
): VoicebankVoiceView {
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		description: row.description ?? null,
		owner: row.owner,
		seedKey: row.seedKey ?? null,
		loadoutId: row.loadoutId ?? null,
		loadoutName: loadout?.name ?? null,
		connectionModelId: loadout?.connectionModelId ?? null,
		voiceId: row.voiceId,
		language: row.language ?? null,
		settings: (row.settings ?? {}) as VoicebankSettings,
		labels: (row.labels ?? {}) as VoicebankLabels,
		enabled: row.enabled,
		unusableReason: voicebankRefusal(row, loadout),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	}
}

/**
 * Every `text->audio` loadout, as the entry form's Loadout picker lists it:
 * the default first, then by name. Administrators only (members never see
 * loadouts); the pair shown is the merge root's.
 */
export async function voicebankLoadoutOptions(db: Db): Promise<VoicebankLoadoutOption[]> {
	const rows = await db
		.select()
		.from(schema.loadouts)
		.where(eq(schema.loadouts.transform, "text->audio"))
	const def = await defaultLoadoutFor(db, "text->audio")
	const resolved = await Promise.all(rows.map((r) => entryLoadoutOf(db, r)))
	const connIds = [...new Set(resolved.map((r) => r.connectionId).filter((v): v is number => v != null))]
	const modelIds = [...new Set(resolved.map((r) => r.connectionModelId).filter((v): v is number => v != null))]
	const conns = connIds.length
		? await db
				.select({ id: schema.connections.id, name: schema.connections.name })
				.from(schema.connections)
				.where(inArray(schema.connections.id, connIds))
		: []
	const models = modelIds.length
		? await db
				.select({ id: schema.connectionModels.id, name: schema.connectionModels.name })
				.from(schema.connectionModels)
				.where(inArray(schema.connectionModels.id, modelIds))
		: []
	const connName = new Map(conns.map((c) => [c.id, c.name]))
	const modelName = new Map(models.map((m) => [m.id, m.name]))
	const options = resolved.map((r): VoicebankLoadoutOption => ({
		id: r.loadoutId,
		name: r.name,
		connectionId: r.connectionId,
		connectionModelId: r.connectionModelId,
		connectionName: r.connectionId != null ? (connName.get(r.connectionId) ?? null) : null,
		modelName: r.connectionModelId != null ? (modelName.get(r.connectionModelId) ?? null) : null,
		filled: r.filled,
		isDefault: def?.id === r.loadoutId,
		defaultVoiceId: r.defaultVoiceId,
		otherSpeakersVoiceId: r.otherSpeakersVoiceId
	}))
	return options.sort(
		(a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)
	)
}

export function slugifyVoicebank(name: string): string {
	return (
		name
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60) || "voice"
	)
}

/** A slug from `name` (or the wanted slug), unique for `owner`: numeric suffix on collision. */
export async function uniqueVoicebankSlug(
	db: Db,
	owner: string,
	name: string,
	exceptId?: number
): Promise<string> {
	const base = slugifyVoicebank(name)
	const rows = await db
		.select({ id: schema.voicebankVoices.id, slug: schema.voicebankVoices.slug })
		.from(schema.voicebankVoices)
		.where(eq(schema.voicebankVoices.owner, owner))
	const taken = new Set(rows.filter((r) => r.id !== exceptId).map((r) => r.slug))
	if (!taken.has(base)) return base
	for (let n = 2; ; n++) {
		const candidate = `${base}-${n}`
		if (!taken.has(candidate)) return candidate
	}
}

/**
 * Keep the speaking loadout's **loadout voice** set.
 *
 * 1. When the voicebank has **no rows at all** and the speaking loadout (the
 *    Narration loadout) has a model, insert "Narrator" on it (owner `pub`, no
 *    star; voice id = the loadout's sampling voice, else the first voice the
 *    model's speech facts list) and point the loadout's `default_voice_id` at it,
 *    in one transaction under an advisory lock. No voice known → nothing.
 * 2. Else, when that loadout has entries and a null `default_voice_id`, set it
 *    to its first enabled, usable entry (lowest id).
 *
 * Returns the row it seeded, else null. ⚠ deleting every row re-seeds on the
 * next call.
 */
export async function ensureLoadoutVoice(db: Db): Promise<VoicebankRow | null> {
	const loadout = await speakingLoadout(db)
	if (!loadout) return null
	const [any] = await db
		.select({ id: schema.voicebankVoices.id })
		.from(schema.voicebankVoices)
		.limit(1)
	if (any) {
		if (loadout.defaultVoiceId != null) return null
		const first = (await loadoutVoiceRows(db, loadout.loadoutId)).find(
			(r) => voicebankRefusal(r, loadout) === null
		)
		if (first)
			await db
				.update(schema.loadouts)
				.set({ defaultVoiceId: first.id })
				.where(
					and(
						eq(schema.loadouts.id, loadout.loadoutId),
						isNull(schema.loadouts.defaultVoiceId)
					)
				)
		return null
	}
	if (!loadout.filled || !loadout.connectionModelId) return null
	const modelId = loadout.connectionModelId

	let voiceId = await loadoutSamplingVoice(db, loadout.samplingConfigId)
	if (!voiceId) {
		const [model] = await db
			.select({ facts: schema.connectionModels.facts })
			.from(schema.connectionModels)
			.where(eq(schema.connectionModels.id, modelId))
			.limit(1)
		const facts = readSpeechFacts(model?.facts)
		voiceId = facts?.voices[0]?.id ?? null
		// A voice-designing model lists no voices: the entry's description is
		// the voice, and its id stays blank (owner report 2026-10-29).
		if (!voiceId && facts?.controls.designsVoice) voiceId = ""
	}
	if (voiceId == null) return null

	return db.transaction(async (tx) => {
		// Re-check inside the transaction: two readers must not both seed.
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext('voicebank_seed'))`)
		const [again] = await tx
			.select({ id: schema.voicebankVoices.id })
			.from(schema.voicebankVoices)
			.limit(1)
		if (again) return null
		const slug = await uniqueVoicebankSlug(tx as unknown as Db, "pub", "Narrator")
		const [row] = await tx
			.insert(schema.voicebankVoices)
			.values({
				slug,
				name: "Narrator",
				owner: "pub",
				seedKey: null,
				loadoutId: loadout.loadoutId,
				voiceId,
				...(voiceId === "" ? { description: "A calm, clear narrator with an even pace." } : {})
			})
			.returning()
		if (row)
			await tx
				.update(schema.loadouts)
				.set({ defaultVoiceId: row.id })
				.where(eq(schema.loadouts.id, loadout.loadoutId))
		return row ?? null
	})
}

const num = (v: unknown, lo: number, hi: number, what: string): number => {
	if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi)
		throw new Error(`${what} must be a number from ${lo} to ${hi}.`)
	return v
}

/** Validate a settings object off the wire; throws a sentence a person can act on. */
export function cleanSettings(raw: unknown): VoicebankSettings {
	const out: VoicebankSettings = {}
	if (raw == null) return out
	if (typeof raw !== "object" || Array.isArray(raw))
		throw new Error("Voice settings must be an object.")
	const r = raw as Record<string, unknown>
	if (r.seed != null) {
		const n = Number(r.seed)
		if (!Number.isInteger(n) || n < 0 || n > 2147483647)
			throw new Error("Seed must be a whole number from 0 to 2147483647.")
		out.seed = n
	}
	if (r.speed != null) out.speed = num(r.speed, 0.25, 4, "Speed")
	if (r.stability != null) out.stability = num(r.stability, 0, 1, "Stability")
	if (r.similarity != null) out.similarity = num(r.similarity, 0, 1, "Similarity")
	if (r.style != null) out.style = num(r.style, 0, 1, "Style")
	if (r.speakerBoost != null) {
		if (typeof r.speakerBoost !== "boolean")
			throw new Error("Speaker boost must be on or off.")
		out.speakerBoost = r.speakerBoost
	}
	return out
}

/**
 * Whether this pub can speak a line at all: the speaking loadout's pair
 * resolves to a usable `text->audio` target, or any enabled entry's loadout is
 * filled. A boolean and a sentence, nothing of the plumbing — every member's
 * speak icons read it (dossier `speech`).
 */
export async function speechAvailability(
	db: Db
): Promise<{ canSpeak: boolean; reason?: string }> {
	try {
		const { resolveCapabilityTarget } = await import("$lib/server/connections/capabilityTarget")
		const speaking = await speakingLoadout(db)
		const target = await resolveCapabilityTarget(db, {
			capability: "text->audio",
			pipelineConfig: {
				connectionId: speaking?.connectionId ?? null,
				connectionModelId: speaking?.connectionModelId ?? null,
				samplingConfigId: speaking?.samplingConfigId ?? null
			}
		})
		if (target.ok) return { canSpeak: true }
		const enabled = await db
			.select({ loadoutId: schema.voicebankVoices.loadoutId })
			.from(schema.voicebankVoices)
			.where(eq(schema.voicebankVoices.enabled, true))
		const loadouts = await entryLoadouts(db, enabled.map((e) => e.loadoutId))
		if ([...loadouts.values()].some((l) => l.filled)) return { canSpeak: true }
		return { canSpeak: false, reason: "no voice is set up on this pub yet" }
	} catch {
		return { canSpeak: true }
	}
}
