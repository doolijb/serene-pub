/**
 * 🚧 The **voice try-out** seam. Speaks ONE short line on the speaking pair
 * with the overrides a person is editing (a timbre draft, a voicebank form's
 * draft) so they can hear a voice before saving it. It runs the speak path's
 * own pieces — `buildSpeechTarget` (the loadout's connection, the speech
 * adapter, the model's facts), `resolveVoice`, `renderDirection`, `seedFor`,
 * speed — for one piece, in the same order and with the same sentences
 * (`pipelines/runtime/dispatchSpeech.ts`). It stores nothing: no file, no
 * media row, no transcript; the clip is returned inline.
 *
 * The input is untrusted (it came off the wire). A non-administrator may send
 * only `text`, `description`, `language`, `settings.seed` and `inflection`
 * (A1: members do not pick voices; nor loadouts). The target: an administrator's
 * `loadoutId` (an unsaved voicebank draft's loadout), else the `voice` slug's
 * resolved loadout, else the speaking loadout. One try per person at a time.
 * Every refusal is a `VoicePreviewRefusal`: a sentence a person can act on.
 */
import { eq } from "drizzle-orm"
import { INFLECTION_LABELS, NEUTRAL_INFLECTION_LABEL } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { SpeechRequest } from "$lib/server/adapters/actions"
import { canPickVoice, type CharacterTimbreInput } from "$lib/shared/characters/timbre"
import {
	VOICE_TRYOUT_SAMPLE_LINE,
	VOICE_TRYOUT_TEXT_MAX
} from "$lib/shared/speech/voiceTryout"
import type { VoicebankSettings } from "$lib/shared/speech/voicebank"
import { TIMBRE_LIMITS } from "$lib/server/characters/timbre"
import { seedFor } from "./voiceSeed"
import { cleanSettings } from "./voicebank"
import { buildSpeechTarget, type SpeechTargetOk } from "./speechTarget"

export type PreviewVoiceInput = Omit<Sockets.Voicebank.Preview.Params, "requestId">
export type PreviewVoiceResult = Omit<Sockets.Voicebank.Preview.Response, "requestId">

/** A refusal: the message is a sentence a person can act on. */
export class VoicePreviewRefusal extends Error {
	constructor(message: string) {
		super(message)
		this.name = "VoicePreviewRefusal"
	}
}

/** How long the voice model has to answer one try-out. */
export const PREVIEW_TIMEOUT_MS = 60_000

const refuse = (message: string): never => {
	throw new VoicePreviewRefusal(message)
}

const inFlight = new Set<number>()
/** Test seam: forget every held try-out. */
export function _resetPreviewInFlightForTests(): void {
	inFlight.clear()
}

const finite = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v) ? v : undefined

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

const KNOWN_INFLECTIONS: ReadonlySet<string> = new Set<string>([
	...INFLECTION_LABELS,
	NEUTRAL_INFLECTION_LABEL
])

interface Clean {
	text: string
	voice: string
	voiceId: string
	loadoutId: number | null
	description: string | null
	language: string | null
	settings: VoicebankSettings
	inflection: string | null
}

function clean(raw: unknown, admin: boolean): Clean {
	const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
	let text = str(r.text)
	if (!text) text = VOICE_TRYOUT_SAMPLE_LINE
	if (text.length > VOICE_TRYOUT_TEXT_MAX)
		refuse(`A try-out line is at most ${VOICE_TRYOUT_TEXT_MAX} characters.`)
	const description = str(r.description)
	if (description.length > TIMBRE_LIMITS.descriptionChars)
		refuse(`The timbre description is over ${TIMBRE_LIMITS.descriptionChars} characters.`)
	const lang = str(r.language).toLowerCase()
	if (lang && !/^[a-z]{2}$/.test(lang)) refuse("Language must be a two-letter code, like en or ja.")
	let settings: VoicebankSettings
	try {
		settings = cleanSettings(r.settings)
	} catch (e) {
		settings = refuse(e instanceof Error ? e.message : "Those voice settings are not valid.")
	}
	const inflection = str(r.inflection)
	if (inflection && !KNOWN_INFLECTIONS.has(inflection)) refuse("That is not a mood this pub knows.")
	const voice = str(r.voice)
	const voiceId = str(r.voiceId)
	const lo = r.loadoutId
	if (lo != null && !(typeof lo === "number" && Number.isInteger(lo)))
		refuse("That loadout is not valid.")
	const loadoutId = (lo ?? null) as number | null
	if (!admin) {
		if (voice || voiceId || loadoutId != null)
			refuse("Only an administrator can try a particular voice; your try uses the pub's default voice.")
		settings = settings.seed !== undefined ? { seed: settings.seed } : {}
	}
	return {
		text,
		voice,
		voiceId,
		loadoutId,
		description: description || null,
		language: lang || null,
		settings,
		inflection: inflection || null
	}
}

/**
 * Speak one try-out line. Resolves with the clip, or throws a
 * `VoicePreviewRefusal`; a caller's own abort (`opts.signal`) is rethrown as
 * the abort, not a refusal.
 */
export async function previewVoice(
	db: Db,
	user: { id: number; isAdmin?: boolean | null } | null | undefined,
	input: unknown,
	opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<PreviewVoiceResult> {
	if (!user) return refuse("Sign in to try a voice.")
	const admin = canPickVoice(user)
	const c = clean(input, admin)

	if (inFlight.has(user.id)) return refuse("A voice is already being tried.")
	inFlight.add(user.id)
	try {
		opts.signal?.throwIfAborted()

		// An administrator's draft loadout: a filled `text->audio` loadout, else a sentence.
		let target: SpeechTargetOk | null = null
		const useTarget = async (loadoutId: number | null): Promise<SpeechTargetOk> => {
			const t = await buildSpeechTarget(db, { loadoutId })
			if (!t.ok) return refuse(t.reason)
			return t
		}
		if (admin && c.loadoutId != null) {
			const { loadoutById } = await import("$lib/server/loadouts")
			const row = await loadoutById(db, c.loadoutId)
			if (!row) return refuse("That loadout no longer exists.")
			if (row.transform !== "text->audio") return refuse(`The loadout "${row.name}" does not speak.`)
			target = await useTarget(c.loadoutId)
		}

		// The voice.
		const notes: string[] = []
		let voiceId: string | null
		let settings: VoicebankSettings
		let language: string | null
		let description: string | null
		if (admin && c.voiceId) {
			voiceId = c.voiceId
			settings = c.settings
			language = c.language
			description = c.description
		} else {
			const { resolveVoice } = await import("./resolveVoice")
			const timbre: CharacterTimbreInput = {}
			if (c.description) timbre.description = c.description
			if (admin && c.voice) timbre.voice = c.voice
			if (c.language) timbre.language = c.language
			if (Object.keys(c.settings).length) timbre.settings = c.settings
			const resolution = await resolveVoice(
				{ speakerRef: null, sessionId: null, cueLanguage: c.language, text: c.text, timbre },
				db
			)
			if (!resolution.ok) return refuse(resolution.reason)
			// The voice's own loadout, unless a draft loadout was sent.
			target ??= await useTarget(resolution.loadoutId ?? null)
			for (const skip of resolution.skipped)
				notes.push(`voice '${skip.slug}' skipped (${skip.from}): ${skip.reason}`)
			voiceId = resolution.voiceId
			settings = (resolution.settings ?? {}) as VoicebankSettings
			language = resolution.language
			description = resolution.description
		}

		target ??= await useTarget(null)
		const { connection, mod, controls, samplingValues } = target
		const designsVoice = controls?.designsVoice === true
		if (designsVoice && c.inflection)
			notes.push(`inflection '${c.inflection}' not sent: this model designs its voice from the description`)
		const { renderDirection } = await import("$lib/server/pipelines/speech/lineTemplate")
		const direction = await renderDirection({
			prompts: null,
			inflection: designsVoice ? null : c.inflection,
			timbreDescription: description,
			controls,
			variables: null
		})
		const seed = seedFor({ designsVoice, entrySeed: settings.seed, description, voiceId })
		const speed = finite(settings.speed) ?? finite(samplingValues.speed)
		const req: SpeechRequest = {
			text: c.text,
			...(voiceId ? { voice: voiceId } : {}),
			...(speed !== undefined && speed !== 1 ? { speed } : {}),
			...(direction?.trim() ? { direction: direction.trim() } : {}),
			...(language ? { language } : {}),
			...(seed !== undefined ? { seed } : {})
		}

		// The one call.
		const timeout = AbortSignal.timeout(opts.timeoutMs ?? PREVIEW_TIMEOUT_MS)
		const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
		const timedOut = () => refuse("The voice model did not answer within a minute.")
		const adapter = new mod.Adapter(connection)
		let result
		try {
			result = await Promise.race([
				adapter.synthesizeSpeech(req, { signal }),
				new Promise<never>((_, reject) => {
					const stop = () => reject(signal.reason ?? new Error("aborted"))
					if (signal.aborted) stop()
					else signal.addEventListener("abort", stop, { once: true })
				})
			])
		} catch (e) {
			if (opts.signal?.aborted) throw e
			if (timeout.aborted) return timedOut()
			console.error("voice try-out failed:", e instanceof Error ? e.message : e)
			return refuse("The voice model could not speak this line.")
		}
		if (result.isAborted) {
			if (opts.signal?.aborted) throw opts.signal.reason ?? new Error("aborted")
			if (timeout.aborted) return timedOut()
			return refuse("The voice model could not speak this line.")
		}
		const item = result.media[0]
		if (!item?.base64) return refuse("The voice model answered without any audio.")
		return {
			mime: item.mime,
			bytes: item.base64,
			...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
			spokenAs: result.spokenAs
				? { voice: result.spokenAs.voice, model: result.spokenAs.model }
				: null,
			...(seed !== undefined ? { seed } : {}),
			applied: [...result.applied],
			ignored: [...result.ignored],
			notes
		}
	} finally {
		inFlight.delete(user.id)
	}
}

