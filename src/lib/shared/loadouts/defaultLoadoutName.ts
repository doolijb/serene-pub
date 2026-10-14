/**
 * What a person calls a transform's default: its **default loadout**, by
 * name — *the Reply loadout*, *the Images loadout* (owner 2026-10-12: "stop
 * using nicknames for the modality defaults; loadouts simplify the concepts
 * for users now"). Never *the chat model*, *the image default* or *a job*
 * (NOMENCLATURE §23).
 *
 * The five transforms core flags a default loadout for carry its title
 * (`CORE_LOADOUTS`, `defaultFor: true`); any other transform falls back to
 * its SDK label, so a pub-made default for vision reads *the Vision loadout*.
 */
import { capabilityLabel } from "@serene-pub/sdk"

const DEFAULT_LOADOUT_NAMES: Record<string, string> = {
	"text->text": "Reply",
	"text->image": "Images",
	"text->embedding": "Embeddings",
	"text->entities": "Entities",
	"text->audio": "Narration"
}

/** "Reply" · "Images" · "Embeddings" · "Entities" · "Narration" · "Vision". */
export function defaultLoadoutName(transform: string): string {
	if (DEFAULT_LOADOUT_NAMES[transform]) return DEFAULT_LOADOUT_NAMES[transform]
	try {
		return capabilityLabel(transform as never)
	} catch {
		return transform
	}
}

/** "the Reply loadout" — mid-sentence. */
export function defaultLoadoutPhrase(transform: string): string {
	return `the ${defaultLoadoutName(transform)} loadout`
}
