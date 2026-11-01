/**
 * 🚧 Write-time check of the session narrator voice (`speechNarratorVoice`):
 * blank is none and always accepted; anything else must name an enabled
 * voicebank voice. Not run on read — a voice deleted later is skipped at
 * resolution, by design.
 */
import { voicebankBySlug } from "./voicebank"

export async function narratorVoiceRefusal(db: Db, value: unknown): Promise<string | null> {
	const slug = typeof value === "string" ? value.trim() : ""
	if (!slug) return null
	const row = await voicebankBySlug(db, slug)
	if (!row) return `No voice in the voicebank is named "${slug}".`
	if (!row.enabled)
		return `The voice "${slug}" is turned off — pick another or turn it back on in the voicebank.`
	return null
}
