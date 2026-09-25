/**
 * Pure decision logic behind EditSessionForm's create-flow preset pre-fill
 * (23 §9: "Optional pre-fill for creation (fields, lorebook policy…)").
 *
 * The bug this fixes: switching presets used to overwrite `name`, `scenario`,
 * `tags`, `lorebookId`, the turn strategy and `genreFields` unconditionally,
 * so a scenario the user had already typed was silently discarded the moment
 * they picked a different preset. The fix is "fill only pristine fields": a
 * default is applied to a field only if that field still holds its initial
 * (empty) value, or the value the PREVIOUSLY-applied preset put there.
 * `PresetFillState` is that memory — for every field a preset last set, the
 * value it set — so a later call can tell "still what the preset left here"
 * (safe to replace) apart from "the user changed it since" (never touch
 * again).
 *
 * `genreFields` is tracked per declared key rather than as one blob, since
 * `defaults.genreFields` can specify only a subset and the component merges
 * it key-by-key into whatever mode fields already hold.
 */
import { storedSwapsOf, type StoredSwapContribution } from "$lib/shared/swaps"

/** The subset of EditSessionForm's fields a preset's `defaults` can fill. */
export interface PresetFillableFields {
	name: string
	scenario: string
	/** Swaps to seat the session with (R40); empty inherits every node's pin. */
	swaps: StoredSwapContribution[]
	lorebookId: number | null
	tags: string[]
	genreFields: Record<string, unknown>
}

/** The form's blank-slate values — "pristine" also means "still this". */
export const INITIAL_PRESET_FILLABLE_FIELDS: PresetFillableFields = {
	name: "",
	scenario: "",
	swaps: [],
	lorebookId: null,
	tags: [],
	genreFields: {}
}

/**
 * What the previously-applied preset (if any) left in each field, so the
 * next apply can recognise "untouched since" instead of re-clobbering a
 * value the user has since edited. A field absent here has never been (or is
 * no longer) preset-filled: either no preset has run yet, or the user edited
 * away from what a preset put there, which retires that field from further
 * auto-fill until it returns to pristine on its own.
 */
export interface PresetFillState {
	name?: string
	scenario?: string
	swaps?: StoredSwapContribution[]
	lorebookId?: number | null
	tags?: string[]
	genreFields?: Record<string, unknown>
}

/** True when `current` is still exactly what the form starts with, or
 * exactly what the last-applied preset put there — i.e. nothing the user
 * typed. */
function isPristine<T>(
	current: T,
	initial: T,
	presetValue: T | undefined,
	equal: (a: T, b: T) => boolean
): boolean {
	if (equal(current, initial)) return true
	if (presetValue !== undefined && equal(current, presetValue)) return true
	return false
}

function stringsEqual(a: string, b: string): boolean {
	return a === b
}

function arraysEqual(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Computes the next field values and the next `PresetFillState` for
 * switching to `defaults`. Never overwrites a field the user has typed into
 * since it last matched either the blank form or a preset's own fill.
 *
 * Mirrors the old, unconditional `applyPresetDefaults`'s per-field type
 * checks exactly — a malformed or absent key in `defaults` leaves that field
 * alone — it just gates each present, well-typed key on pristineness first.
 */
export function resolvePresetFill(
	current: PresetFillableFields,
	fillState: PresetFillState,
	defaults: Sockets.SessionAdmin.PresetDefaults | null | undefined
): { fields: PresetFillableFields; fillState: PresetFillState } {
	const fields: PresetFillableFields = { ...current }
	const nextFillState: PresetFillState = { ...fillState }

	if (!defaults || typeof defaults !== "object") {
		// No defaults at all still means "this preset seeds no swaps": clear
		// the previous preset's, when untouched (see the swaps block below).
		if (
			fillState.swaps &&
			JSON.stringify(current.swaps) === JSON.stringify(fillState.swaps)
		) {
			fields.swaps = []
			delete nextFillState.swaps
		}
		return { fields, fillState: nextFillState }
	}

	if (typeof defaults.name === "string") {
		const value = defaults.name
		if (
			isPristine(
				current.name,
				INITIAL_PRESET_FILLABLE_FIELDS.name,
				fillState.name,
				stringsEqual
			)
		) {
			fields.name = value
			nextFillState.name = value
		} else {
			delete nextFillState.name
		}
	}

	if (typeof defaults.scenario === "string") {
		const value = defaults.scenario
		if (
			isPristine(
				current.scenario,
				INITIAL_PRESET_FILLABLE_FIELDS.scenario,
				fillState.scenario,
				stringsEqual
			)
		) {
			fields.scenario = value
			nextFillState.scenario = value
		} else {
			delete nextFillState.scenario
		}
	}

	// Seeded swaps (R40), not validated choices: whether a node offers a
	// definition is the server's to say at create (`setSessionNodeRebind`
	// refuses with a sentence and the session still starts on the pin).
	{
		const value = storedSwapsOf(defaults.swaps)
		const pristine = isPristine(
			current.swaps,
			INITIAL_PRESET_FILLABLE_FIELDS.swaps,
			fillState.swaps,
			(a, b) => JSON.stringify(a) === JSON.stringify(b)
		)
		if (pristine) {
			// A preset with no swaps clears what the previous one seeded, so
			// preset B never starts on preset A's strategy (M2 review) — the
			// form shows no swaps control until A8, so nobody could see it.
			fields.swaps = value
			if (value.length) nextFillState.swaps = value
			else delete nextFillState.swaps
		} else {
			delete nextFillState.swaps
		}
	}

	if (typeof defaults.lorebookId === "number" || defaults.lorebookId === null) {
		const value = defaults.lorebookId as number | null
		if (
			isPristine(
				current.lorebookId,
				INITIAL_PRESET_FILLABLE_FIELDS.lorebookId,
				fillState.lorebookId,
				(a, b) => a === b
			)
		) {
			fields.lorebookId = value
			nextFillState.lorebookId = value
		} else {
			delete nextFillState.lorebookId
		}
	}

	if (Array.isArray(defaults.tags)) {
		const value = defaults.tags.filter(
			(t): t is string => typeof t === "string"
		)
		if (
			isPristine(
				current.tags,
				INITIAL_PRESET_FILLABLE_FIELDS.tags,
				fillState.tags,
				arraysEqual
			)
		) {
			fields.tags = value
			nextFillState.tags = value
		} else {
			delete nextFillState.tags
		}
	}

	// genreFields: per declared key, since `defaults.genreFields` can specify
	// a subset and the component's merge is `{...genreFields, ...d.genreFields}`
	// — i.e. per-key already, before this fix ever gated it on pristineness.
	if (
		!!defaults.genreFields &&
		typeof defaults.genreFields === "object" &&
		!Array.isArray(defaults.genreFields)
	) {
		const incoming = defaults.genreFields as Record<string, unknown>
		const genreFields = { ...current.genreFields }
		const genreFillState = { ...(fillState.genreFields ?? {}) }
		for (const [key, value] of Object.entries(incoming)) {
			const wasPresent = key in current.genreFields
			const presetValue = genreFillState[key]
			const pristine =
				!wasPresent ||
				(presetValue !== undefined &&
					JSON.stringify(current.genreFields[key]) ===
						JSON.stringify(presetValue))
			if (pristine) {
				genreFields[key] = value
				genreFillState[key] = value
			} else {
				delete genreFillState[key]
			}
		}
		fields.genreFields = genreFields
		nextFillState.genreFields = genreFillState
	}

	return { fields, fillState: nextFillState }
}
