/**
 * The narrator's cadence (`narratorInterjections`, **Narrator's turn** (was *Narrator asides*); owner
 * 2026-11-04, playtest item 7): the one field's older stored values read as the
 * key they stand for. Shared by the derived settings form (server) and the
 * turn picker (client), so a stored `true` shows *Every round* everywhere.
 */
export const NARRATOR_CADENCE_FIELD_KEY = "narratorInterjections"

/** An older stored value read as the key it stands for; anything else as it is. */
export function narratorCadenceKey(value: unknown): unknown {
	if (value === true || value === "full" || value === "review")
		return "every-round"
	if (value === false) return "off"
	return value
}
