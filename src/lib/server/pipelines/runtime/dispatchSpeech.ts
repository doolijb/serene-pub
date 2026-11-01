/**
 * 🚧 The **speak effect** (`core:oracle/speak@1`, seam S3) — a line's speech
 * cues in, one audio file out. The speech twin of `dispatchImage`, and
 * deliberately its shape: the binding hands over ids and gets a `MediaRef`
 * back; the connection, its URL and its key never leave this file.
 *
 *   cues ─ group consecutive cues by (voice kind, speaker, inflection, language)
 *        ─ per group: `renderSpokenGroup` (the line template) → the call's text
 *                     `renderDirection` (prose steering, only where the model takes it)
 *                     `resolveVoice`    (by cue kind: see resolveVoiceCore)
 *                     `synthesizeSpeech` (one call; split at the service's input limit)
 *        ─ `joinAudio` (WAV: sample-exact with `gapMs` between groups)
 *        ─ `storeGeneratedMedia` (`meta.spoken`, owner = the session's owner)
 *        ─ `files.transcript` = the spoken text.
 *
 * ## Failure posture
 * Throws a `SpeechDispatchError` (a `ComposedError`: the sentence names no
 * connection) for anything the person can act on — no speaking model, a
 * refused voice, the service failing. The BINDING turns that into "nothing
 * spoken" plus a run-log note, so a delivered reply is never failed by its
 * read-aloud. A cancelled call returns an empty result.
 *
 * ## Streaming
 * `streaming` is accepted and treated as off (build assumption A5): playback is
 * whole-file in phase 1.
 *
 * ## Who owns the file
 * The SESSION'S OWNER, not the person who pressed Read aloud: the per-user
 * derived cull and the retention sweep look for spoken files by owner (lane C,
 * L4), and a member's reading of the owner's session is the owner's cache.
 */
import { and, eq, isNull } from "drizzle-orm"
import type {
	Cue,
	CueMap,
	CueSpan,
	MediaRef,
	ParticipantRef,
	SpokenAs,
	SpokenMeta
} from "@serene-pub/sdk"
import { SPOKEN_LINE_TEMPLATE_IDS } from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import {
	ComposedError,
	connectionIdentity
} from "$lib/server/connections/visibility"
import type { SpeechRequest } from "$lib/server/adapters/actions"
import type { RunArtifact } from "$lib/server/pipelines/runtime/receipts"
import type { SpeechTargetOk } from "$lib/server/speech/speechTarget"
import { joinAudio, splitForLimit, type AudioPart, trimWav, speechBudgetMs } from "$lib/server/pipelines/speech/audio"
import { inflectionLabelOf } from "$lib/server/pipelines/speech/cueLines"
import { NEUTRAL_INFLECTION_LABEL } from "@serene-pub/sdk"

/** A speak failure with a sentence a person can act on. */
export class SpeechDispatchError extends ComposedError {}

export interface SpeakCall {
	/** The script. Null/empty falls back to `text` read as one cue in the speaker's voice. */
	cues?: readonly Cue[] | null
	/** ⏳ The one-release alias for `cues`. */
	text?: string | null
	/** Whose line it is — a participant reference, or null for no one. */
	speaker?: string | null
	/** ISO 639-1; absent: the chain (script → timbre → session → pub). */
	language?: string | null
	/** The `template` slot as the host holds it (null → the shipped Whole line). */
	template?: unknown
	/** The `prompts` slot (`{ direction }`), raw. */
	prompts?: unknown
	/** The `variables` slot, raw. */
	variables?: unknown
	/** The `connection` slot's resolved pair, when a loadout or the panel set one. */
	connectionId?: number | null
	connectionModelId?: number | null
	/** The `sampling` slot's resolved `sampling_configs` id. */
	samplingId?: number | null
	/** Pause between two groups, ms. Absent = 200. */
	gapMs?: number | null
	/** Accepted; treated as off (A5). */
	streaming?: unknown
	sessionId?: number | null
	/** The person this run acts for — the fallback owner when there is no session. */
	userId?: number | null
	runId?: string
	nodeKey?: string
	artifacts?: RunArtifact[]
	signal?: AbortSignal
	/** Told the plan before the first call, so a failed run still says what it meant to do. */
	onPlan?: (plan: SpeakPlan) => void
}

export type PlanConnection = { id: number | null; name: string | null; type: string | null; model: string | null }

export interface SpeakPlan {
	/** The connection the line was spoken on — for the receipt only (R53: never published on a port). */
	connection: PlanConnection | null
	groups: Array<{
		voice: "speaker" | "narrator"
		speaker: string | null
		inflection: string | null
		cues: number[]
		chars: number
		voiceId: string | null
		calls: number
		/** The connection this group is spoken on (additive; `connection` is the first group's). */
		connection?: PlanConnection | null
	}>
	format: string | null
	joined: "concatenated" | "mp3" | "single" | "first-only" | null
}

export interface SpeakResult {
	audio: MediaRef | null
	cueMap: CueMap
	spokenAs: SpokenAs | null
	meta: SpokenMeta | null
	/** Request keys the service sent / could not honour, unioned over the calls. */
	applied: string[]
	ignored: string[]
	/** Things a person debugging should know that are not failures. */
	notes: string[]
	plan: SpeakPlan | null
	isAborted: boolean
}

const EMPTY_MAP: CueMap = { source: "none", spans: [] }

export const emptySpeakResult = (notes: string[] = [], isAborted = false): SpeakResult => ({
	audio: null,
	cueMap: EMPTY_MAP,
	spokenAs: null,
	meta: null,
	applied: [],
	ignored: [],
	notes,
	plan: null,
	isAborted
})

// ── Grouping (pure) ─────────────────────────────────────────────────────────

export interface SpokenGroup {
	voice: "speaker" | "narrator"
	/** The participant reference the voice resolves for; null = the narrator. */
	speakerRef: string | null
	/** Display name of the speaker, when known. */
	speakerName?: string
	/**
	 * A narrator group inside a character's or envoy's line: that line's
	 * speaker (so the narration can find the card's / envoy's narration voice).
	 * Absent on speaker groups and on plain narration.
	 */
	lineSpeakerRef?: string
	/** The inflection label, `neutral` and blank folded to null. */
	inflection: string | null
	language: string | null
	/** Indexes into the input `Cue[]`. */
	indexes: number[]
	cues: Cue[]
}

const inflectionKey = (label: string | null | undefined): string | null => {
	const l = (label ?? "").trim().toLowerCase()
	return !l || l === NEUTRAL_INFLECTION_LABEL ? null : l
}

/**
 * Group the SPOKEN cues: consecutive cues with the same voice, speaker,
 * inflection and language make one group (one call). `silent` cues and cues
 * with no words are left out — they keep their index in the script and are
 * simply never sent. `refOfName` maps a `Name:` cue's speaker to a participant
 * reference (null = not in the cast, the line's own speaker speaks it).
 */
export function groupCues(
	cues: readonly Cue[],
	opts: {
		lineSpeaker: string | null
		refOfName?: (name: string) => { ref: string; name: string } | null
		language?: string | null
	}
): SpokenGroup[] {
	const groups: SpokenGroup[] = []
	let lastKey = ""
	cues.forEach((cue, index) => {
		if (cue.voice === "silent" || !cue.text || !cue.text.trim()) return
		const narrator = cue.voice === "narrator"
		let ref: string | null = null
		let name: string | undefined
		if (!narrator) {
			const named = cue.speaker ? (opts.refOfName?.(cue.speaker) ?? null) : null
			ref = named?.ref ?? opts.lineSpeaker
			name = named?.name
		}
		const inflection = inflectionKey(cue.inflection)
		const language = opts.language?.trim().toLowerCase() || null
		const key = [narrator ? "n" : "s", ref ?? "", inflection ?? "", language ?? ""].join("|")
		const prev = groups[groups.length - 1]
		if (prev && key === lastKey) {
			prev.indexes.push(index)
			prev.cues.push(cue)
		} else {
			groups.push({
				voice: narrator ? "narrator" : "speaker",
				speakerRef: ref,
				...(name ? { speakerName: name } : {}),
				...(narrator && opts.lineSpeaker ? { lineSpeakerRef: opts.lineSpeaker } : {}),
				inflection,
				language,
				indexes: [index],
				cues: [cue]
			})
			lastKey = key
		}
	})
	return mergeTinyGroups(groups)
}

/** Fewer words than this on their own confuse a voice model (owner report 2026-10-29: Qwen3-TTS given "Or," drags on with noises). */
export const MIN_GROUP_WORDS = 3

const wordCount = (g: SpokenGroup): number =>
	g.cues
		.map((c) => c.text)
		.join(" ")
		.trim()
		.split(/\s+/)
		.filter(Boolean).length

const sameVoice = (a: SpokenGroup, b: SpokenGroup): boolean =>
	a.voice === b.voice && a.speakerRef === b.speakerRef && a.language === b.language

/**
 * A group with fewer than `MIN_GROUP_WORDS` words folds into its neighbour
 * of the same voice (the previous one first, else the next), whatever the
 * neighbour's inflection: the fragment keeps its words and order, the
 * longer group keeps the mood. A fragment with no same-voice neighbour
 * stays its own call (its audio is then length-guarded at synthesis).
 */
export function mergeTinyGroups(groups: SpokenGroup[]): SpokenGroup[] {
	const out: SpokenGroup[] = groups.map((g) => ({ ...g, indexes: [...g.indexes], cues: [...g.cues] }))
	let changed = true
	while (changed) {
		changed = false
		// Neighbours that now share a key (a fragment of another mood folded
		// between them) become one group again.
		for (let i = 1; i < out.length; i++) {
			const a = out[i - 1]!
			const b = out[i]!
			if (sameVoice(a, b) && a.inflection === b.inflection) {
				a.indexes.push(...b.indexes)
				a.cues.push(...b.cues)
				out.splice(i, 1)
				changed = true
				break
			}
		}
		if (changed) continue
		for (let i = 0; i < out.length; i++) {
			const g = out[i]!
			if (wordCount(g) >= MIN_GROUP_WORDS || out.length === 1) continue
			const prev = out[i - 1]
			const next = out[i + 1]
			if (prev && sameVoice(prev, g)) {
				prev.indexes.push(...g.indexes)
				prev.cues.push(...g.cues)
				out.splice(i, 1)
				changed = true
				break
			}
			if (next && sameVoice(next, g)) {
				next.indexes.unshift(...g.indexes)
				next.cues.unshift(...g.cues)
				out.splice(i, 1)
				changed = true
				break
			}
		}
	}
	return out
}

/** The cue map: every cue of a group shares the group's span (the edges are known; the words inside are not). */
export function cueMapOf(
	groups: ReadonlyArray<Pick<SpokenGroup, "indexes"> & Partial<Pick<SpokenGroup, "cues">>>,
	spans: ReadonlyArray<{ startMs: number; endMs: number }>,
	source: "concatenated" | "none"
): CueMap {
	if (source === "none") return EMPTY_MAP
	const out: CueSpan[] = []
	groups.forEach((g, i) => {
		const span = spans[i]
		if (!span) return
		g.indexes.forEach((cue, k) => {
			const text = g.cues?.[k]?.text?.trim()
			out.push({ cue, startMs: span.startMs, endMs: span.endMs, ...(text ? { text } : {}) })
		})
	})
	return { source: "concatenated", spans: out }
}

// ── Message metadata (pure; seam S6) ────────────────────────────────────────

/**
 * Seam S6: a spoken line keeps its `SpokenMeta` on the ACTIVE swipe, the way a
 * shown sprite does — `metadata.swipes.spokenHistory[currentIdx]`, mirrored to
 * `metadata.spoken` — beside its `core:audio` part. Returns the metadata to
 * write; nothing is mutated.
 */
export function nextSpokenMetadata(
	metadata: Record<string, any> | null | undefined,
	spoken: SpokenMeta | null
): Record<string, any> {
	const meta = metadata ?? {}
	const out: Record<string, any> = { ...meta, spoken }
	const swipes = meta.swipes
	if (swipes && Array.isArray(swipes.history)) {
		const idx = typeof swipes.currentIdx === "number" ? swipes.currentIdx : 0
		const history: (SpokenMeta | null)[] = [
			...(Array.isArray(swipes.spokenHistory) ? swipes.spokenHistory : [])
		]
		while (history.length < swipes.history.length) history.push(null)
		history.length = swipes.history.length
		if (idx >= 0 && idx < history.length) history[idx] = spoken
		out.swipes = { ...swipes, spokenHistory: history }
	}
	return out
}

// ── The effect ──────────────────────────────────────────────────────────────

const SPOKEN_TEMPLATE_IDS = new Set<string>(Object.values(SPOKEN_LINE_TEMPLATE_IDS))

/** The template id the line is recorded as spoken with. */
function templateIdOf(template: unknown, sessionTemplateId: string | null): string | null {
	if (sessionTemplateId && SPOKEN_TEMPLATE_IDS.has(sessionTemplateId)) return sessionTemplateId
	if (template == null || template === "") return SPOKEN_LINE_TEMPLATE_IDS.whole
	if (typeof template === "string") return template.startsWith("core:template/") ? template : null
	if (typeof template === "object") {
		const t = template as Record<string, unknown>
		for (const k of ["id", "templateId", "ref"])
			if (typeof t[k] === "string" && (t[k] as string).trim()) return t[k] as string
	}
	return null
}

const finite = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v) ? v : undefined

/** A character's or seat's display name, for the template's `speaker`. */
async function nameOfRef(db: Db, ref: string | null): Promise<string | undefined> {
	if (!ref) return undefined
	const m = /^(character|player-seat):(\d+)$/.exec(ref)
	if (!m) return undefined
	const id = Number(m[2])
	if (m[1] === "character") {
		const [row] = await db
			.select({ name: schema.characters.name })
			.from(schema.characters)
			.where(eq(schema.characters.id, id))
			.limit(1)
		return row?.name
	}
	const [seat] = await db
		.select({ seatName: schema.sessionPersonas.seatName, personaId: schema.sessionPersonas.personaId })
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.id, id))
		.limit(1)
	if (seat?.seatName) return seat.seatName
	if (seat?.personaId == null) return undefined
	const [persona] = await db
		.select({ name: schema.characters.name })
		.from(schema.characters)
		.where(eq(schema.characters.id, seat.personaId))
		.limit(1)
	return persona?.name
}

/** The session's cast by display name (lower-cased) → participant reference. */
async function castRefs(db: Db, sessionId: number | null): Promise<Map<string, { ref: string; name: string }>> {
	const out = new Map<string, { ref: string; name: string }>()
	if (sessionId == null) return out
	const add = (names: Array<string | null | undefined>, ref: string, name: string) => {
		for (const n of names) {
			const key = (n ?? "").trim().toLowerCase()
			if (key && !out.has(key)) out.set(key, { ref, name })
		}
	}
	const chars = await db
		.select({
			id: schema.characters.id,
			name: schema.characters.name,
			nickname: schema.characters.nickname
		})
		.from(schema.sessionCharacters)
		.innerJoin(schema.characters, eq(schema.characters.id, schema.sessionCharacters.characterId))
		.where(
			and(
				eq(schema.sessionCharacters.sessionId, sessionId),
				isNull(schema.sessionCharacters.removedAt)
			)
		)
	for (const c of chars) add([c.name, c.nickname], `character:${c.id}`, c.name)
	const seats = await db
		.select({
			seatId: schema.sessionPersonas.id,
			seatName: schema.sessionPersonas.seatName,
			name: schema.characters.name,
			nickname: schema.characters.nickname
		})
		.from(schema.sessionPersonas)
		.leftJoin(schema.characters, eq(schema.characters.id, schema.sessionPersonas.personaId))
		.where(
			and(eq(schema.sessionPersonas.sessionId, sessionId), isNull(schema.sessionPersonas.removedAt))
		)
	for (const s of seats)
		add([s.seatName, s.name, s.nickname], `player-seat:${s.seatId}`, s.seatName ?? s.name ?? "")
	return out
}

/** The session's owner — who the spoken file belongs to. */
async function sessionOwner(db: Db, sessionId: number | null): Promise<number | null> {
	if (sessionId == null) return null
	const [row] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return row?.userId ?? null
}

/** Speak a line. See the file header. */
export async function dispatchSpeech(db: Db, call: SpeakCall): Promise<SpeakResult> {
	call.signal?.throwIfAborted()

	// The script: `cues`, else the ⏳ `text` alias as one cue in the speaker's voice.
	const cues: readonly Cue[] =
		Array.isArray(call.cues) && call.cues.length
			? call.cues
			: typeof call.text === "string" && call.text.trim()
				? [{ text: call.text.trim(), kind: "dialogue", voice: "speaker" }]
				: []
	const sessionId = call.sessionId ?? null
	const lineSpeaker = call.speaker?.trim() || null
	const cast = await castRefs(db, sessionId)
	const groups = groupCues(cues, {
		lineSpeaker,
		language: call.language,
		refOfName: (name) => cast.get(name.trim().toLowerCase()) ?? null
	})
	if (!groups.length) return emptySpeakResult(["nothing to speak: no cue is spoken"])

	// Loaded here, not at the top: the pure helpers above stay importable (and
	// testable) with no database behind them.
	const { resolveVoice, speakerSilent } = await import("$lib/server/speech/resolveVoice")
	const { storeGeneratedMedia } = await import("$lib/server/media/generatedMedia")
	const { renderSpokenGroup, renderDirection } = await import(
		"$lib/server/pipelines/speech/lineTemplate"
	)
	const { sessionSpeechSettings } = await import("$lib/server/pipelines/speech/sessionSpeech")
	const settings = sessionId != null ? await sessionSpeechSettings(db, sessionId) : null
	const sessionTemplateId = settings?.template ?? null

	// The pair a voice is spoken on is its LOADOUT's; the fallback arms speak on the
	// slot, else the speaking loadout (the `text->audio` default, else the shipped
	// Narration loadout by seed key — lane V finding V-1, 2026-10-28). One target
	// per loadout id, built once per dispatch.
	const { createTargetMemo } = await import("$lib/server/speech/speechTarget")
	const slot =
		call.connectionId != null
			? {
					connectionId: call.connectionId,
					connectionModelId: call.connectionModelId ?? null,
					samplingId: call.samplingId ?? null
				}
			: call.connectionModelId != null || call.samplingId != null
				? {
						connectionId: null,
						connectionModelId: call.connectionModelId ?? null,
						samplingId: call.samplingId ?? null
					}
				: null
	const targets = createTargetMemo(db, slot)
	// The fallback pair the resolver's loadout / service arms speak on.
	const fallback =
		call.connectionId != null && call.connectionModelId != null
			? { connectionModelId: call.connectionModelId, samplingConfigId: call.samplingId ?? null }
			: null

	// Per group: the voice, the call's text, the direction.
	interface Planned {
		group: SpokenGroup
		target: SpeechTargetOk
		text: string
		pieces: string[]
		direction: string | undefined
		voiceId: string | null
		language: string | null
		speed: number | undefined
		seed: number | undefined
		/** The voicebank entry's name and where the voice came from, recorded on `spokenAs`. */
		voiceName: string | null
		voiceFrom: string
	}
	const planned: Planned[] = []
	const planLabel = (c: SpeechTargetOk["connection"]): PlanConnection => ({
		id: c.id ?? null,
		name: c.name ?? null,
		type: c.type ?? null,
		model: c.model ?? null
	})
	const notes: string[] = []
	for (const group of groups) {
		call.signal?.throwIfAborted()
		// A card marked silent is never spoken, whatever the session says.
		if (await speakerSilent(db, group.speakerRef as ParticipantRef | null)) {
			notes.push(`${group.speakerName ?? group.speakerRef ?? "speaker"} is silent on their card; not spoken`)
			continue
		}
		const name = group.speakerName ?? (await nameOfRef(db, group.speakerRef))
		// The voice first (language is read off the group's own words): it names the loadout
		// the group is spoken on, and that target's controls shape everything after.
		const resolution = await resolveVoice(
			{
				speakerRef: (group.voice === "narrator"
					? (group.lineSpeakerRef ?? null)
					: group.speakerRef) as ParticipantRef | null,
				cueVoice: group.voice,
				sessionId,
				cueLanguage: group.language ?? call.language ?? null,
				text: group.cues.map((c) => c.text).join(" "),
				...(fallback ? { fallback } : {}),
				rememberAuto: true
			},
			db
		)
		// Narrowed on `ok`: a refusal is a sentence a person can act on.
		if (!resolution.ok) throw new SpeechDispatchError(resolution.reason)
		const target = await targets.get(resolution.loadoutId ?? null)
		if (!target.ok) throw new SpeechDispatchError(target.reason, target.identity)
		const { controls, limit, samplingValues } = target
		const samplingSpeed = finite(samplingValues.speed)
		const text = await renderSpokenGroup({
			template: call.template ?? null,
			sessionTemplateId,
			cues: group.cues,
			speaker: { ref: group.speakerRef ?? "narrator", ...(name ? { name } : {}) },
			voice: group.voice,
			controls,
			variables: call.variables,
			db
		})
		if (!text.trim()) continue
		for (const skip of resolution.skipped)
			notes.push(`voice '${skip.slug}' skipped (${skip.from}): ${skip.reason}`)
		// A voice-designing model reads the instruction as the voice itself:
		// the inflection stays out of it (it would redesign the person per
		// group) and one seed pins the voice across the reply's calls.
		const designsVoice = controls?.designsVoice === true
		if (designsVoice && group.inflection?.trim())
			notes.push(`inflection '${group.inflection.trim()}' not sent: this model designs its voice from the description`)
		const direction = await renderDirection({
			prompts: call.prompts,
			inflection: designsVoice ? null : group.inflection,
			timbreDescription: resolution.description,
			controls,
			variables: call.variables
		})
		const { seedFor } = await import("$lib/server/speech/voiceSeed")
		const seed = seedFor({
			designsVoice,
			entrySeed: resolution.settings?.seed,
			description: resolution.description,
			voiceId: resolution.voiceId
		})
		const speed = finite(resolution.settings?.speed) ?? samplingSpeed
		const { voicebankBySlug } = await import("$lib/server/speech/voicebank")
		const entryRow = resolution.voicebankSlug ? await voicebankBySlug(db, resolution.voicebankSlug) : null
		planned.push({
			group,
			target,
			text,
			pieces: splitForLimit(text, limit),
			direction: direction?.trim() ? direction.trim() : undefined,
			voiceId: resolution.voiceId,
			language: resolution.language,
			speed: speed !== undefined && speed !== 1 ? speed : undefined,
			seed,
			voiceName: entryRow?.name?.trim() || null,
			voiceFrom: resolution.from
		})
	}
	if (!planned.length) return emptySpeakResult([...notes, "nothing to speak: the line template left no words"])

	const callCount = planned.reduce((n, p) => n + p.pieces.length, 0)
	// Several calls are joined, and a WAV joins exactly: ask for it where the group's model lists it
	// (or says nothing, as an OpenAI-compatible host without a voices route does). MP3 byte-joins
	// only when every part comes from one target.
	const distinctTargets = [...new Set(planned.map((p) => p.target))]
	const formatOf = (p: Planned): string | null => {
		if (callCount <= 1) return null
		const listed = p.target.formats
		if (!listed?.length || listed.includes("wav")) return "wav"
		if (listed.includes("mp3") && distinctTargets.length === 1) return "mp3"
		return null
	}
	const groupFormats = planned.map(formatOf)
	const format = groupFormats[0] ?? null
	if (callCount > 1 && groupFormats.some((f) => !f)) {
		const bad = planned.find((_, i) => !groupFormats[i])!
		notes.push(
			`the model returns ${bad.target.formats?.join("/") ?? "an unknown format"}, which cannot be joined; only the first part is kept`
		)
	}
	// Two loadouts on one model are one model to the listener: the note counts models.
	const distinctModels = [
		...new Map(
			distinctTargets.map((t) => [`${t.connection.id ?? ""}|${t.connection.connectionModelId ?? t.connection.model ?? ""}`, t])
		).values()
	]
	if (distinctModels.length > 1) {
		const label = (t: SpeechTargetOk) => t.connection.model ?? t.connection.name ?? "a model"
		const names = distinctModels.map(label)
		notes.push(
			`spoken on ${names.length === 2 ? "two" : names.length} models: ${names.join(", then ")}`
		)
	}

	const plan: SpeakPlan = {
		connection: planLabel(planned[0]!.target.connection),
		groups: planned.map((p) => ({
			voice: p.group.voice,
			speaker: p.group.speakerRef,
			inflection: p.group.inflection,
			cues: p.group.indexes,
			chars: p.text.length,
			voiceId: p.voiceId,
			calls: p.pieces.length,
			connection: planLabel(p.target.connection)
		})),
		format,
		joined: null
	}
	call.onPlan?.(plan)

	// The calls, one at a time: a local speech server renders one utterance at once.
	const adapters = new Map<SpeechTargetOk, InstanceType<SpeechTargetOk["mod"]["Adapter"]>>()
	const adapterOf = (t: SpeechTargetOk) => {
		let a = adapters.get(t)
		if (!a) adapters.set(t, (a = new t.mod.Adapter(t.connection)))
		return a
	}
	const parts: Array<AudioPart & { group: number; durationMs?: number }> = []
	const applied = new Set<string>()
	const ignored = new Set<string>()
	const voices: string[] = []
	let spokenAsFirst: { voice: string; model: string; voiceName: string | null; voiceFrom: string } | null = null
	let isAborted = false
	for (let g = 0; g < planned.length && !isAborted; g++) {
		const p = planned[g]!
		const { connection, identity } = p.target
		const adapter = adapterOf(p.target)
		const groupFormat = groupFormats[g] ?? null
		for (const piece of p.pieces) {
			call.signal?.throwIfAborted()
			const req: SpeechRequest = {
				text: piece,
				...(p.voiceId ? { voice: p.voiceId } : {}),
				...(groupFormat ? { format: groupFormat } : {}),
				...(p.speed !== undefined ? { speed: p.speed } : {}),
				...(p.direction ? { direction: p.direction } : {}),
				...(p.language ? { language: p.language } : {}),
				...(p.seed !== undefined ? { seed: p.seed } : {})
			}
			let result
			try {
				result = await adapter.synthesizeSpeech(req, { signal: call.signal })
			} catch (e) {
				if (call.signal?.aborted) throw e
				// The adapter's own sentence names the address and the model file: kept
				// for the administrator (`detail`), not shown as the message.
				throw new SpeechDispatchError(
					"The voice model could not speak this line.",
					connectionIdentity(connection, e instanceof Error ? e.message : String(e))
				)
			}
			if (result.isAborted) {
				isAborted = true
				break
			}
			for (const k of result.applied) applied.add(k)
			for (const k of result.ignored) ignored.add(k)
			if (result.spokenAs?.voice && !voices.includes(result.spokenAs.voice))
				voices.push(result.spokenAs.voice)
			spokenAsFirst ??= { voice: result.spokenAs?.voice ?? p.voiceId ?? "", model: result.spokenAs?.model ?? connection.model ?? "", voiceName: p.voiceName, voiceFrom: p.voiceFrom }
			const item = result.media[0]
			if (!item?.base64)
				throw new SpeechDispatchError(
					"The voice model answered without any audio.",
					identity
				)
			// A voice model given few words can run on past them with noise
			// (owner report 2026-10-29): a WAV longer than its words could take
			// is cut at the budget and the receipt says so.
			let pieceBytes: Buffer = Buffer.from(item.base64, "base64")
			let pieceDuration = item.durationMs
			const budget = speechBudgetMs(piece)
			if (pieceDuration !== undefined && pieceDuration > budget && item.mime.includes("wav")) {
				const cut = trimWav(pieceBytes, budget)
				if (cut) {
					notes.push(
						`cut ${Math.round(pieceDuration / 100) / 10} s of audio to ${Math.round(budget / 100) / 10} s: the voice ran on past the words`
					)
					pieceBytes = cut.bytes
					pieceDuration = cut.durationMs
				}
			}
			parts.push({
				bytes: pieceBytes,
				mime: item.mime,
				group: g,
				...(pieceDuration !== undefined ? { durationMs: pieceDuration } : {})
			})
		}
	}
	if (isAborted || !parts.length) return { ...emptySpeakResult(notes, true), plan }

	// Join: no gap inside a group's pieces, `gapMs` between groups.
	const gapMs = Math.min(2000, Math.max(0, finite(call.gapMs) ?? 200))
	const gaps = parts.map((part, i) => (i > 0 && part.group !== parts[i - 1]!.group ? gapMs : 0))
	const joined = joinAudio(parts, gaps)
	let bytes: Buffer
	let mime: string
	let spans: Array<{ startMs: number; endMs: number }>
	let source: "concatenated" | "none"
	let spokenGroups: Planned[] = planned
	let durationMs: number | undefined
	if (joined) {
		bytes = joined.bytes
		mime = joined.mime
		source = joined.source
		durationMs = joined.durationMs ?? undefined
		// `joinAudio` spans are per PART; fold the pieces of one group into the group's span.
		spans = []
		parts.forEach((part, i) => {
			const s = joined.spans[i]
			if (!s) return
			const cur = spans[part.group]
			spans[part.group] = cur ? { startMs: cur.startMs, endMs: s.endMs } : { ...s }
		})
		if (joined.resampled)
			notes.push(`resampled ${joined.resampled.parts} part${joined.resampled.parts === 1 ? "" : "s"} to ${joined.resampled.toRate} Hz`)
		plan.joined = parts.length === 1 ? "single" : joined.source === "concatenated" ? "concatenated" : "mp3"
	} else {
		// Not joinable: keep the first group's audio and say so, rather than losing the line silently.
		const firstGroup = parts[0]!.group
		const keep = parts.filter((p) => p.group === firstGroup)
		const again = joinAudio(keep, keep.map(() => 0)) ?? {
			bytes: keep[0]!.bytes,
			mime: keep[0]!.mime,
			durationMs: null,
			spans: [],
			source: "none" as const
		}
		bytes = again.bytes
		mime = again.mime
		source = again.source
		durationMs = again.durationMs ?? undefined
		spans = again.spans.length ? [again.spans.reduce((a, s) => ({ startMs: a.startMs, endMs: s.endMs }), { startMs: 0, endMs: 0 })] : []
		spokenGroups = planned.filter((_, g) => g === firstGroup)
		notes.push("the audio of the later parts could not be joined and was not kept")
		plan.joined = "first-only"
	}

	const spokenText = spokenGroups.map((p) => p.text).join(" ")
	const [ref] = await storeGeneratedMedia(
		db,
		[
			{
				kind: "audio",
				mime,
				base64: bytes.toString("base64"),
				...(durationMs !== undefined ? { durationMs } : {}),
				meta: { spoken: true }
			}
		],
		{
			userId: (await sessionOwner(db, sessionId)) ?? call.userId ?? null,
			sessionId,
			runId: call.runId ?? null,
			step: call.nodeKey ?? null
		}
	)
	if (!ref) return { ...emptySpeakResult([...notes, "the audio could not be stored"]), plan }

	// The words spoken, cached on the file: a spoken line can be searched and
	// read back to a model that cannot hear (`files.transcript`).
	const [file] = await db
		.update(schema.files)
		.set({ transcript: spokenText })
		.where(eq(schema.files.uuid, ref.uuid))
		.returning({ id: schema.files.id })
	if (file && call.artifacts)
		call.artifacts.push({
			kind: "file",
			entityId: file.id,
			action: "created",
			nodeKey: call.nodeKey ?? null
		})

	const cueMap = cueMapOf(spokenGroups.map((p) => p.group), spans, source)
	const lineLabel = planned.map((p) => p.group.inflection).find((l): l is string => !!l) ?? null
	const spokenAs: SpokenAs = {
		voice: spokenAsFirst?.voice ?? "",
		...(voices.length > 1 ? { voices } : {}),
		model: spokenAsFirst?.model ?? "",
		...(spokenAsFirst?.voiceName ? { voiceName: spokenAsFirst.voiceName } : {}),
		...(spokenAsFirst?.voiceFrom ? { voiceFrom: spokenAsFirst.voiceFrom as SpokenAs["voiceFrom"] } : {}),
		applied: [...applied],
		ignored: [...ignored]
	}
	const meta: SpokenMeta = {
		spokenAs,
		cueMap,
		inflection: lineLabel ? { label: lineLabel } : null,
		template: templateIdOf(call.template, sessionTemplateId),
		at: new Date().toISOString()
	}
	return {
		audio: ref,
		cueMap,
		spokenAs,
		meta,
		applied: [...applied],
		ignored: [...ignored],
		notes,
		plan,
		isAborted: false
	}
}

// Re-exported so the host and the bindings take speech's one helper from one place.
export { inflectionLabelOf }
