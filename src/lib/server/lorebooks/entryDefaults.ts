/**
 * What a new entry a session creates starts with: its Beginning and its Decay.
 *
 * Per field, the writing step's value wins over the entry type's, else
 * perpetual and 0. A model's output never reaches a layer: the step's values
 * are its params. This is the only place the layers are resolved; it applies
 * to a session's new entry only, never to a match, a history day, a person's
 * create, an import, a duplicate or a starter.
 */
import "@serene-pub/core-catalog"
import { getDefinition } from "@serene-pub/sdk"
import { entryDeclaration } from "$lib/server/entries/declarations"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"

export type BeginningDefault = "perpetual" | "began"

/** One layer: what an entry type or a writing step says. Unset is absent. */
export interface EntryDefaultsLayer {
	defaultBeginning?: BeginningDefault
	defaultDecayRate?: number
}

/** The entry's date parts, all null for a perpetual one. */
export type NewEntryTime = {
	year: number | null
	month: number | null
	day: number | null
	decayRate: number
}

/** A type's declared defaults, from the SDK registry; empty for an unknown type. */
export function entryTypeDefaultsLayer(typeId: string): EntryDefaultsLayer {
	const version = entryDeclaration(typeId)?.version
	if (version === undefined) return {}
	const shape = getDefinition(`${typeId}@${version}`)?.entryShape as
		| EntryDefaultsLayer
		| undefined
	if (!shape) return {}
	return {
		...(shape.defaultBeginning !== undefined
			? { defaultBeginning: shape.defaultBeginning }
			: {}),
		...(shape.defaultDecayRate !== undefined
			? { defaultDecayRate: shape.defaultDecayRate }
			: {})
	}
}

/** What a type is called in a sentence: its declared English name, without a trailing "entries". */
export function entryTypeSentenceName(typeId: string): string {
	const version = entryDeclaration(typeId)?.version
	const definition =
		version === undefined
			? undefined
			: getDefinition(`${typeId}@${version}`)
	const en = (definition?.i18n as { name?: { en?: string } } | undefined)
		?.name?.en
	return (en ?? typeId).replace(/\s+entries$/i, "")
}

/**
 * A writing step's params as a layer, or the sentence that refuses them.
 * Empty, null and absent are unset; nothing is coerced.
 */
export function checkStepDefaults(
	params:
		| { defaultBeginning?: unknown; defaultDecayRate?: unknown }
		| undefined,
	entryType: { name: string; takesBeginning: boolean }
): { layer: EntryDefaultsLayer } | { refusal: string } {
	const layer: EntryDefaultsLayer = {}
	const beginning = params?.defaultBeginning
	if (beginning !== undefined && beginning !== null && beginning !== "") {
		if (beginning !== "perpetual" && beginning !== "began")
			return {
				refusal: `${String(beginning)} is not a Beginning default. Say 'perpetual' or 'began', or leave it empty.`
			}
		if (!entryType.takesBeginning)
			return {
				refusal: `${entryType.name} entries carry their own date, so defaultBeginning does nothing here. Leave it empty.`
			}
		layer.defaultBeginning = beginning
	}
	const rate = params?.defaultDecayRate
	if (rate !== undefined && rate !== null && rate !== "") {
		if (
			typeof rate !== "number" ||
			!Number.isFinite(rate) ||
			rate < 0 ||
			rate > 1
		)
			return {
				refusal:
					"A Decay rate is a number from 0 to 1: 0 is a fact, above 0 a living entry."
			}
		layer.defaultDecayRate = rate
	}
	return { layer }
}

/**
 * The Beginning and Decay of a session's new entry. The Beginning is the
 * session's date when the resolved default is `began` and the session reads at
 * one, else none; a type that carries its own date takes none. The Decay
 * resolves whatever the date.
 */
export function newEntryTime(input: {
	type?: EntryDefaultsLayer
	step?: EntryDefaultsLayer
	date: StoryDate | null
	takesBeginning: boolean
}): NewEntryTime {
	const { type, step } = input
	const beginning: BeginningDefault =
		step?.defaultBeginning ?? type?.defaultBeginning ?? "perpetual"
	const decayRate = step?.defaultDecayRate ?? type?.defaultDecayRate ?? 0
	const date =
		input.takesBeginning && beginning === "began" ? input.date : null
	return {
		year: date ? date.year : null,
		month: date ? (date.month ?? null) : null,
		day: date ? (date.day ?? null) : null,
		decayRate
	}
}
