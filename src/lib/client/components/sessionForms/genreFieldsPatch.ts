/**
 * A session's genre fields, as Edit Session saves them (owner ruling
 * 2026-10-03).
 *
 * The form holds every genre field, but Save sends ONLY the fields the person
 * changed there — dirty meaning different from the value loaded
 * (`sameFormValue`, STYLE-GUIDE §6.14), field by field. An `object` field (the
 * author's note) is one field: sent whole when any member moved, not at all
 * when none did. The server merges what it is sent over what is stored, so a
 * field this form never touched keeps whatever was saved meanwhile — by the
 * Author's note widget, or by another tab — instead of the form putting back
 * the value it loaded.
 */
import { sameFormValue } from "$lib/client/forms/sameFormValue"

type Fields = Record<string, unknown>

/** The two sides never share an object: the form edits one in place. */
const copy = (v: unknown): unknown =>
	v !== null && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v

/**
 * The fields of `current` that differ from `loaded`, or `undefined` when
 * none do (send no `genreFields` at all). `declared`, when given, limits it
 * to the genre's keys. A field `loaded` has and `current` lacks is sent as
 * `null`.
 */
export function changedGenreFields(
	current: Fields | undefined,
	loaded: Fields | undefined,
	declared?: readonly string[]
): Fields | undefined {
	const now = current ?? {}
	const was = loaded ?? {}
	const keys = new Set([...Object.keys(now), ...Object.keys(was)])
	const out: Fields = {}
	for (const key of keys) {
		if (declared && !declared.includes(key)) continue
		if (sameFormValue(now[key], was[key])) continue
		out[key] = now[key] ?? null
	}
	return Object.keys(out).length ? out : undefined
}

/**
 * A newer saved row's genre fields reached the open form: each one moves the
 * form's loaded snapshot, and a field the person has not touched (its value
 * still the loaded one) follows it — an edited one keeps the edit, dirty only
 * while it differs from what is now saved (§6.14, "a push never lies").
 * Returns the next `current` and `loaded`; both are new objects only when
 * something moved, so a caller can skip a no-op assignment.
 */
export function adoptSavedGenreFields(
	current: Fields,
	loaded: Fields,
	saved: Fields
): { current: Fields; loaded: Fields; moved: boolean } {
	let nextCurrent = current
	let nextLoaded = loaded
	for (const [key, value] of Object.entries(saved)) {
		if (sameFormValue(loaded[key], value)) continue
		const untouched = sameFormValue(current[key], loaded[key])
		if (nextLoaded === loaded) nextLoaded = { ...loaded }
		nextLoaded[key] = copy(value)
		if (untouched) {
			if (nextCurrent === current) nextCurrent = { ...current }
			nextCurrent[key] = copy(value)
		}
	}
	return {
		current: nextCurrent,
		loaded: nextLoaded,
		moved: nextCurrent !== current || nextLoaded !== loaded
	}
}
