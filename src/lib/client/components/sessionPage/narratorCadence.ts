/**
 * The narrator's cadence (`narratorInterjections`, **Narrator's turn** (was *Narrator asides*)) as
 * the turn picker draws it: the one field of the server's derived settings
 * form, the server already reads an older stored value as its key.
 */

import { NARRATOR_CADENCE_FIELD_KEY } from "$lib/shared/sessions/narratorCadence"

/** The cadence field of the form as the server sent it; null when the form has none. */
export function narratorCadenceField(
	form: Sockets.Sessions.SettingsForm.Response | null | undefined
): Sockets.Sessions.SettingsForm.Field | null {
	for (const group of form?.groups ?? []) {
		for (const field of group.fields ?? []) {
			if (
				field.address.kind === "genre" &&
				field.address.key === NARRATOR_CADENCE_FIELD_KEY
			) {
				// The server's derived form already reads an older stored value as its key (`narratorCadenceKey`, shared).
				return field
			}
		}
	}
	return null
}
