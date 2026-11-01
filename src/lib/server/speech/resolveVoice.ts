/**
 * 🚧 The ONE voice resolver (speech build seam S4; design §5). Loads the
 * facts, then lets the pure core (`resolveVoiceCore.ts`) decide:
 * the chain depends on the cue kind (see `resolveVoiceCore.ts`): dialogue =
 * timbre → envoy → other-speakers → auto → the narrator chain; narration in a
 * line = narration-timbre → envoy-narration → the narrator chain; plain
 * narration = the narrator chain (session → loadout voice → loadout's first
 * entry → loadout sampling voice → the service's first voice).
 * An entry speaks on its own loadout's model (the result carries `loadoutId`);
 * the loadout / service arms speak on the fallback pair (the speak step's slot,
 * else the speaking loadout).
 */
import { eq, sql } from "drizzle-orm"
import { readSpeechFacts } from "$lib/shared/connectionAdapters/speechFacts"
import { parseParticipantRef, type ParticipantRef } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { db as appDb, dbReady } from "$lib/server/db"
import { timbreOfExtensions, type CharacterTimbreInput } from "$lib/shared/characters/timbre"
import type { VoiceResolution } from "$lib/shared/speech/voicebank"
import {
	loadoutSamplingVoice,
	entryLoadout,
	speakingLoadout,
	voicebankBySlug,
	loadoutVoiceRows,
	voicebankRefusal,
	type EntryLoadout,
	type VoicebankRow
} from "./voicebank"
import { sessionEnvoySpeech } from "$lib/server/pipelines/speech/sessionSpeech"
import {
	readAllAutoVoices,
	readAllEnvoySpeech,
	speechAutoVoiceKey
} from "$lib/shared/sessions/speechSettings"
import { normaliseLanguage } from "./language"
import { pickAutoVoice, type AutoCasting, type AutoVoicePick } from "./autoVoice"
import {
	narratorChainEntry,
	resolveVoiceFrom,
	type AskedEntry,
	type VoiceEntryFacts
} from "./resolveVoiceCore"

export interface ResolveVoiceInput {
	/** Who speaks; null is the narrator. */
	speakerRef: ParticipantRef | null
	sessionId: number | null
	loadoutId?: number | null
	/**
	 * The fallback pair, when the caller has one (the speak step's explicit
	 * slot): replaces the speaking loadout for `pairModelId` AND the sampling
	 * `voice`. Absent: the speaking loadout.
	 */
	fallback?: { connectionModelId: number | null; samplingConfigId: number | null } | null
	/** The cue group's voice kind; absent = 'speaker' (dialogue). */
	cueVoice?: "speaker" | "narrator"
	/** A cue's language, when the line carried one. */
	cueLanguage?: string | null
	text?: string | null
	/** 🚧 A timbre to use instead of the speaker's card (the voice try-out's draft). Absent: the speaker's card's. */
	timbre?: CharacterTimbreInput | null
	/**
	 * Store Auto's fresh pick for this speaker in the session (dispatch only).
	 * Previews and try-outs never set it: they read a stored pick but write none.
	 */
	rememberAuto?: boolean
}

/** Loads each entry's loadout once per resolution. */
type LoadoutCache = Map<number, Promise<EntryLoadout | null>>

const loadoutOf = (db: Db, cache: LoadoutCache, id: number | null): Promise<EntryLoadout | null> => {
	if (id == null) return Promise.resolve(null)
	let hit = cache.get(id)
	if (!hit) cache.set(id, (hit = entryLoadout(db, id)))
	return hit
}

const factsOf = (r: VoicebankRow, loadout: EntryLoadout | null): VoiceEntryFacts => ({
	slug: r.slug,
	loadoutId: r.loadoutId ?? null,
	connectionModelId: loadout?.filled ? loadout.connectionModelId : null,
	voiceId: r.voiceId,
	language: r.language,
	settings: (r.settings ?? {}) as VoiceEntryFacts["settings"],
	enabled: r.enabled,
	description: r.description ?? null
})

async function loadEntry(
	db: Db,
	cache: LoadoutCache,
	row: VoicebankRow,
	refusals: Map<string, string | null>
): Promise<VoiceEntryFacts> {
	const loadout = await loadoutOf(db, cache, row.loadoutId ?? null)
	refusals.set(row.slug, voicebankRefusal(row, loadout))
	return factsOf(row, loadout)
}

async function asked(
	db: Db,
	cache: LoadoutCache,
	refusals: Map<string, string | null>,
	slug: string | null | undefined
): Promise<AskedEntry | null> {
	const s = typeof slug === "string" ? slug.trim() : ""
	if (!s) return null
	const row = await voicebankBySlug(db, s)
	return { slug: s, entry: row ? await loadEntry(db, cache, row, refusals) : null }
}

async function characterTimbre(db: Db, characterId: number): Promise<CharacterTimbreInput> {
	const [row] = await db
		.select({ extensions: schema.characters.extensions })
		.from(schema.characters)
		.where(eq(schema.characters.id, characterId))
		.limit(1)
	return timbreOfExtensions(row?.extensions)
}

/** The speaker's timbre; users, envoys, roles and the narrator have none. */
async function speakerTimbre(
	db: Db,
	ref: ParticipantRef | null
): Promise<CharacterTimbreInput | null> {
	if (!ref) return null
	let parsed
	try {
		parsed = parseParticipantRef(ref)
	} catch {
		return null
	}
	if (parsed.kind === "character") {
		const id = Number(parsed.id)
		return Number.isInteger(id) ? characterTimbre(db, id) : null
	}
	if (parsed.kind === "player-seat") {
		const id = Number(parsed.id)
		if (!Number.isInteger(id)) return null
		const [seat] = await db
			.select({ personaId: schema.sessionPersonas.personaId })
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, id))
			.limit(1)
		return seat?.personaId != null ? characterTimbre(db, seat.personaId) : null
	}
	return null
}

/**
 * Whether the speaker's card says its lines are never spoken (`timbre.silent`).
 * Users, envoys, roles and the narrator are never silent this way.
 */
export async function speakerSilent(db: Db, ref: ParticipantRef | null): Promise<boolean> {
	const t = await speakerTimbre(db, ref)
	return t?.silent === true
}

/**
 * The ONE read of a session speech setting (`speech.narratorVoice`,
 * `session.language`): genre fields (S7, lane D5) read through the session
 * settings cascade — `sessionSpeechSettings` — so the genre's default and
 * any preset apply. Blank is none (null).
 */
export async function sessionSpeechSetting(
	db: Db,
	sessionId: number | null,
	key: "speech.narratorVoice" | "session.language"
): Promise<string | null> {
	if (sessionId == null) return null
	const { sessionSpeechSettings } = await import("$lib/server/pipelines/speech/sessionSpeech")
	const s = await sessionSpeechSettings(db, sessionId)
	return key === "speech.narratorVoice" ? s.narratorVoice : s.language
}

/** The speaking loadout's voice rows, as facts, with the pointers resolved to entries. */
interface LoadoutVoices {
	names: Map<string, string>
	candidates: Array<{ slug: string; labels: Record<string, unknown> }>
	loadoutVoiceEntry: AskedEntry | null
	loadoutFirstEntry: AskedEntry | null
	otherSpeakersEntry: AskedEntry | null
}

async function loadoutVoices(
	d: Db,
	cache: LoadoutCache,
	refusals: Map<string, string | null>,
	loadout: EntryLoadout | null
): Promise<LoadoutVoices> {
	const out: LoadoutVoices = {
		names: new Map(),
		candidates: [],
		loadoutVoiceEntry: null,
		loadoutFirstEntry: null,
		otherSpeakersEntry: null
	}
	if (!loadout) return out
	const rows = await loadoutVoiceRows(d, loadout.loadoutId)
	const byId = new Map<number, AskedEntry>()
	for (const r of rows) {
		const entry = await loadEntry(d, cache, r, refusals)
		out.names.set(r.slug, r.name)
		byId.set(r.id, { slug: r.slug, entry })
		if (r.enabled && !refusals.get(r.slug)) {
			out.candidates.push({ slug: r.slug, labels: (r.labels ?? {}) as Record<string, unknown> })
			out.loadoutFirstEntry ??= { slug: r.slug, entry }
		}
	}
	out.loadoutVoiceEntry = loadout.defaultVoiceId != null ? (byId.get(loadout.defaultVoiceId) ?? null) : null
	out.otherSpeakersEntry =
		loadout.otherSpeakersVoiceId != null ? (byId.get(loadout.otherSpeakersVoiceId) ?? null) : null
	return out
}

const usable = (a: AskedEntry | null | undefined, refusals: Map<string, string | null>): boolean =>
	!!a?.entry && a.entry.enabled && !refusals.get(a.slug)

/** The genre's casting tags for an envoy speaker (genre envoys only), read defensively. */
async function castingOf(d: Db, sessionId: number | null, ref: string): Promise<AutoCasting | null> {
	if (sessionId == null) return null
	try {
		const parsed = parseParticipantRef(ref as ParticipantRef)
		if (parsed.kind !== "envoy") return null
		const [row] = await d
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!row?.genreId) return null
		const { getSessionGenre } = await import("$lib/server/pipelines/entities/sessionGenres")
		const genre = await getSessionGenre(d, row.genreId)
		const decl = (genre?.envoys ?? []).find((e) => e.key === parsed.slug) as
			| { casting?: unknown }
			| undefined
		const c = decl?.casting
		if (!c || typeof c !== "object") return null
		const o = c as Record<string, unknown>
		return {
			...(o.role === "narrator-like" || o.role === "speaker" ? { role: o.role } : {}),
			...(typeof o.gender === "string" ? { gender: o.gender } : {}),
			...(typeof o.age === "string" ? { age: o.age } : {})
		}
	} catch {
		return null
	}
}

/**
 * Every slug already spoken for in the session: the cast cards' own
 * `timbre.voice` (seated characters AND persona seats), the envoys' voice
 * overrides, and the OTHER speakers' stored Auto picks.
 */
async function usedVoiceSlugs(
	d: Db,
	sessionId: number,
	genreFields: unknown,
	exceptRef: string
): Promise<string[]> {
	const used: string[] = []
	const characterIds = new Set<number>()
	const seats = await d
		.select({ id: schema.sessionCharacters.characterId })
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))
	for (const r of seats) if (r.id != null) characterIds.add(r.id)
	const personas = await d
		.select({ id: schema.sessionPersonas.personaId })
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.sessionId, sessionId))
	for (const r of personas) if (r.id != null) characterIds.add(r.id)
	for (const id of characterIds) {
		const v = (await characterTimbre(d, id)).voice
		if (typeof v === "string" && v.trim()) used.push(v.trim())
	}
	for (const e of Object.values(readAllEnvoySpeech(genreFields))) {
		if (e.voice) used.push(e.voice)
		if (e.narrationVoice) used.push(e.narrationVoice)
	}
	for (const [ref, slug] of Object.entries(readAllAutoVoices(genreFields)))
		if (ref !== exceptRef) used.push(slug)
	return used
}

interface AutoOutcome {
	pick: AutoVoicePick
	candidateSlugs: string[]
	narratorSlug: string | null
}

async function autoFor(
	d: Db,
	args: {
		sessionId: number | null
		speakerRef: string
		voices: LoadoutVoices
		narratorSlug: string | null
	}
): Promise<AutoOutcome> {
	let genreFields: unknown = null
	if (args.sessionId != null) {
		const [row] = await d
			.select({ genreFields: schema.sessions.genreFields })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, args.sessionId))
			.limit(1)
		genreFields = row?.genreFields ?? null
	}
	const stored = readAllAutoVoices(genreFields)[args.speakerRef] ?? null
	const used =
		args.sessionId != null
			? await usedVoiceSlugs(d, args.sessionId, genreFields, args.speakerRef)
			: []
	const pick = pickAutoVoice({
		candidates: args.voices.candidates,
		narratorSlug: args.narratorSlug,
		usedSlugs: used,
		stored,
		casting: await castingOf(d, args.sessionId, args.speakerRef),
		speakerRef: args.speakerRef,
		sessionId: args.sessionId
	})
	return {
		pick,
		candidateSlugs: args.voices.candidates.map((c) => c.slug),
		narratorSlug: args.narratorSlug
	}
}

/**
 * Store Auto's fresh pick (and drop a stale one). In ONE transaction under a
 * per-session advisory lock: re-read the fields, write the key only when
 * absent or stale, delete a stale key. `tx` only.
 */
async function rememberAutoPick(
	d: Db,
	sessionId: number,
	speakerRef: string,
	o: AutoOutcome,
	write: boolean
): Promise<void> {
	const key = speechAutoVoiceKey(speakerRef)
	await d.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"speech_auto_voice:" + sessionId}))`)
		const [row] = await tx
			.select({ genreFields: schema.sessions.genreFields })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!row) return
		const fields = { ...((row.genreFields ?? {}) as Record<string, unknown>) }
		const cur = typeof fields[key] === "string" ? (fields[key] as string).trim() : ""
		const valid = !!cur && o.candidateSlugs.includes(cur) && cur !== o.narratorSlug
		if (valid) return
		if (write && o.pick.slug) fields[key] = o.pick.slug
		else if (key in fields) delete fields[key]
		else return
		await tx.update(schema.sessions).set({ genreFields: fields }).where(eq(schema.sessions.id, sessionId))
	})
}

export async function resolveVoice(
	input: ResolveVoiceInput,
	db?: Db
): Promise<VoiceResolution> {
	if (!db) await dbReady
	const d: Db = db ?? (appDb as unknown as Db)

	const cache: LoadoutCache = new Map()
	const refusals = new Map<string, string | null>()
	// The speaking loadout owns the voices (default, other speakers, entries);
	// the fallback pair, when the caller has one, replaces only its model + sampling voice.
	const loadout = await speakingLoadout(d, input.loadoutId ?? null)
	const pairModelId = input.fallback
		? input.fallback.connectionModelId
		: (loadout?.connectionModelId ?? null)
	const fallbackSampling = input.fallback ? input.fallback.samplingConfigId : (loadout?.samplingConfigId ?? null)
	const loadoutVoice = await loadoutSamplingVoice(d, fallbackSampling)
	const timbre =
		input.timbre !== undefined ? input.timbre : await speakerTimbre(d, input.speakerRef)
	const sessionNarratorVoice = await sessionSpeechSetting(
		d,
		input.sessionId,
		"speech.narratorVoice"
	)
	const sessionLanguage = normaliseLanguage(
		await sessionSpeechSetting(d, input.sessionId, "session.language")
	)
	const [pub] = await d
		.select({ defaultLanguage: schema.systemSettings.defaultLanguage })
		.from(schema.systemSettings)
		.limit(1)
	const voices = await loadoutVoices(d, cache, refusals, loadout)
	let envoy: Awaited<ReturnType<typeof sessionEnvoySpeech>> | null = null
	if (input.speakerRef) {
		try {
			const parsed = parseParticipantRef(input.speakerRef)
			if (parsed.kind === "envoy")
				envoy = await sessionEnvoySpeech(d, input.sessionId, parsed.slug)
		} catch {
			envoy = null
		}
	}
	let serviceVoice: string | null = null
	if (pairModelId != null) {
		const [model] = await d
			.select({ facts: schema.connectionModels.facts })
			.from(schema.connectionModels)
			.where(eq(schema.connectionModels.id, pairModelId))
			.limit(1)
		serviceVoice = readSpeechFacts(model?.facts)?.voices[0]?.id ?? null
	}

	const sessionEntry = await asked(d, cache, refusals, sessionNarratorVoice)
	const timbreEntry = await asked(d, cache, refusals, timbre?.voice)
	const envoyEntry = await asked(d, cache, refusals, envoy?.voice)
	const dialogue = input.cueVoice !== "narrator"
	const hasSpeaker = input.speakerRef != null

	// Auto: only a speaker with no voice of their own (card, envoy, pinned other speakers) needs it.
	let autoEntry: AskedEntry | null = null
	let auto: AutoOutcome | null = null
	if (
		dialogue &&
		hasSpeaker &&
		!usable(timbreEntry, refusals) &&
		!usable(envoyEntry, refusals) &&
		!usable(voices.otherSpeakersEntry, refusals)
	) {
		const narratorSlug =
			narratorChainEntry({
				sessionEntry,
				loadoutVoiceEntry: voices.loadoutVoiceEntry,
				loadoutFirstEntry: voices.loadoutFirstEntry,
				refusalOf: (e) => refusals.get(e.slug) ?? null
			})?.slug ?? null
		auto = await autoFor(d, {
			sessionId: input.sessionId,
			speakerRef: input.speakerRef as string,
			voices,
			narratorSlug
		})
		const slug = auto.pick.slug
		if (slug) {
			const hit = voices.candidates.find((c) => c.slug === slug)
			if (hit) {
				const row = await voicebankBySlug(d, slug)
				autoEntry = row ? { slug, entry: await loadEntry(d, cache, row, refusals) } : null
			}
		}
	}

	const result = resolveVoiceFrom({
		pairModelId,
		loadoutVoice,
		timbre,
		timbreEntry,
		timbreNarrationEntry: await asked(d, cache, refusals, timbre?.narrationVoice),
		envoyEntry,
		envoyNarrationEntry: await asked(d, cache, refusals, envoy?.narrationVoice),
		otherSpeakersEntry: voices.otherSpeakersEntry,
		autoEntry,
		loadoutVoiceEntry: voices.loadoutVoiceEntry,
		loadoutFirstEntry: voices.loadoutFirstEntry,
		cueVoice: input.cueVoice,
		hasSpeaker,
		sessionEntry,
		sessionNarratorVoice,
		refusalOf: (e) => refusals.get(e.slug) ?? null,
		cueLanguage: input.cueLanguage ?? null,
		text: input.text ?? null,
		sessionLanguage,
		pubLanguage: pub?.defaultLanguage ?? null,
		serviceVoice
	})

	if (auto && input.rememberAuto && input.sessionId != null && input.speakerRef) {
		const write = result.ok && result.from === "auto" && auto.pick.fresh
		if (write || auto.pick.staleStored)
			await rememberAutoPick(d, input.sessionId, input.speakerRef, auto, write)
	}
	return result
}

/**
 * What a speaker with no voice of their own gets, read-only (the Read aloud
 * card's per-envoy line). Same internals as `resolveVoice`; writes nothing.
 */
export async function speakerFallbackVoice(
	db: Db,
	input: { sessionId: number; speakerRef: string; loadoutId?: number | null }
): Promise<{
	kind: "other-speakers" | "auto" | "narrator"
	voiceName: string | null
	slug: string | null
	reason?: "avoids-narrator" | "shared"
}> {
	const cache: LoadoutCache = new Map()
	const refusals = new Map<string, string | null>()
	const loadout = await speakingLoadout(db, input.loadoutId ?? null)
	const voices = await loadoutVoices(db, cache, refusals, loadout)
	const sessionEntry = await asked(
		db,
		cache,
		refusals,
		await sessionSpeechSetting(db, input.sessionId, "speech.narratorVoice")
	)
	const nameOf = (slug: string | null) => (slug ? (voices.names.get(slug) ?? null) : null)
	if (usable(voices.otherSpeakersEntry, refusals)) {
		const slug = voices.otherSpeakersEntry!.slug
		return { kind: "other-speakers", voiceName: nameOf(slug), slug }
	}
	const narrator = narratorChainEntry({
		sessionEntry,
		loadoutVoiceEntry: voices.loadoutVoiceEntry,
		loadoutFirstEntry: voices.loadoutFirstEntry,
		refusalOf: (e: VoiceEntryFacts) => refusals.get(e.slug) ?? null
	})
	const { pick } = await autoFor(db, {
		sessionId: input.sessionId,
		speakerRef: input.speakerRef,
		voices,
		narratorSlug: narrator?.slug ?? null
	})
	if (pick.slug)
		return {
			kind: "auto",
			voiceName: nameOf(pick.slug),
			slug: pick.slug,
			reason: pick.reason === "shared" ? "shared" : "avoids-narrator" // sticky never equals the narrator's
		}
	const slug = narrator?.slug ?? null
	const voiceName = slug ? (nameOf(slug) ?? (await voicebankBySlug(db, slug))?.name ?? slug) : null
	return { kind: "narrator", voiceName, slug }
}
