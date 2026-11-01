/**
 * 🚧 The speech target: the connection, model facts and sampling a line (or a
 * try-out) is spoken on. ONE function for the speak effect and the voice
 * preview. A voice names its LOADOUT (`loadoutId`); the fallback arms speak on
 * the speak step's slot, else the speaking loadout. Never guessed beyond that.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { connectionIdentity, type ConnectionIdentity } from "$lib/server/connections/visibility"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { readSpeechFacts, type SpeechControls } from "$lib/shared/connectionAdapters/speechFacts"
import type { CapabilityTargetResult } from "$lib/server/connections/capabilityTarget"
import { entryLoadout, speakingLoadout } from "./voicebank"

/** The speak step's explicit pair, when a loadout or the panel set one. */
export interface SpeechSlot {
	connectionId: number | null
	connectionModelId: number | null
	samplingId: number | null
}

export interface SpeechTargetOk {
	ok: true
	connection: Extract<CapabilityTargetResult, { ok: true }>["connection"]
	identity: ConnectionIdentity
	/** The speech adapter module (`new mod.Adapter(connection)`). */
	mod: NonNullable<Awaited<ReturnType<typeof import("$lib/server/connectionAdapters/speech/getSpeechAdapter").getSpeechAdapter>>>
	facts: ReturnType<typeof readSpeechFacts>
	controls: SpeechControls | null
	formats: readonly string[] | null
	/** Characters per request (Infinity = none). */
	limit: number
	samplingValues: Record<string, unknown>
	/** The loadout it was built from; null = the slot / the speaking loadout's fallback. */
	loadoutId: number | null
	loadoutName: string | null
}
export type SpeechTarget =
	| SpeechTargetOk
	| { ok: false; reason: string; identity?: ConnectionIdentity }

/** Input limits by connection type (characters per request). Ollama 400s past this. */
export async function inputLimitOf(type: string): Promise<number> {
	if (type !== CONNECTION_TYPE.OLLAMA) return Infinity
	const { OLLAMA_SPEECH_INPUT_LIMIT } = await import(
		"$lib/server/connectionAdapters/speech/profiles/ollama"
	)
	return OLLAMA_SPEECH_INPUT_LIMIT
}

export interface SpeechTargetInput {
	/** A loadout to speak on (its merge root's pair). Wins over `slot`. */
	loadoutId?: number | null
	/** The explicit pair. With neither: the speaking loadout. */
	slot?: SpeechSlot | null
}

export async function buildSpeechTarget(db: Db, input: SpeechTargetInput): Promise<SpeechTarget> {
	let pair: { connectionId: number | null; connectionModelId: number | null; samplingConfigId: number | null }
	let loadoutId: number | null = null
	let loadoutName: string | null = null
	if (input.loadoutId != null) {
		const l = await entryLoadout(db, input.loadoutId)
		if (!l) return { ok: false, reason: "That voice's loadout no longer exists." }
		if (!l.filled) return { ok: false, reason: `Its loadout "${l.name}" has no model yet.` }
		pair = l
		loadoutId = l.loadoutId
		loadoutName = l.name
	} else if (input.slot?.connectionId != null) {
		pair = {
			connectionId: input.slot.connectionId,
			connectionModelId: input.slot.connectionModelId,
			samplingConfigId: input.slot.samplingId
		}
	} else {
		const speaking = await speakingLoadout(db)
		pair = {
			connectionId: speaking?.connectionId ?? null,
			connectionModelId: input.slot?.connectionModelId ?? speaking?.connectionModelId ?? null,
			samplingConfigId: input.slot?.samplingId ?? speaking?.samplingConfigId ?? null
		}
	}
	const { resolveCapabilityTarget } = await import("$lib/server/connections/capabilityTarget")
	const target = await resolveCapabilityTarget(db, {
		capability: "text->audio",
		pipelineConfig: pair
	})
	if (!target.ok)
		return { ok: false, reason: target.problem.message, ...(target.problem.connection ? { identity: target.problem.connection } : {}) }
	const connection = target.connection
	const identity = connectionIdentity(connection)

	const { getSpeechAdapter } = await import("$lib/server/connectionAdapters/speech/getSpeechAdapter")
	const mod = await getSpeechAdapter(connection.type)
	if (!mod)
		return {
			ok: false,
			reason: loadoutName
				? `The loadout "${loadoutName}" has a connection type that cannot speak. Choose a speaking model for it in Admin › Models › Loadouts.`
				: "The Narration loadout's connection type cannot speak. Choose a speaking model for Narration in Admin › Models › Loadouts.",
			identity
		}

	let facts = null as ReturnType<typeof readSpeechFacts>
	if (connection.connectionModelId != null) {
		const [row] = await db
			.select({ facts: schema.connectionModels.facts })
			.from(schema.connectionModels)
			.where(eq(schema.connectionModels.id, connection.connectionModelId))
			.limit(1)
		facts = readSpeechFacts(row?.facts)
	}
	return {
		ok: true,
		connection,
		identity,
		mod,
		facts,
		controls: facts?.controls ?? null,
		formats: facts?.formats ?? null,
		limit: await inputLimitOf(connection.type),
		samplingValues: (target.sampling?.values ?? {}) as Record<string, unknown>,
		loadoutId,
		loadoutName
	}
}

/**
 * One target per loadout id for a dispatch (key `null` = the slot, else the
 * speaking loadout), so a line with many groups builds each target once.
 */
export function createTargetMemo(db: Db, slot: SpeechSlot | null) {
	const memo = new Map<number | null, Promise<SpeechTarget>>()
	return {
		get(loadoutId: number | null): Promise<SpeechTarget> {
			let hit = memo.get(loadoutId)
			if (!hit) memo.set(loadoutId, (hit = buildSpeechTarget(db, { loadoutId, slot })))
			return hit
		}
	}
}
