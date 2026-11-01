/**
 * 🚧 One seed per voice. A voice-designing model (`controls.designsVoice`)
 * makes a new person on every call unless the seed is pinned, and a reply is
 * spoken in several calls, so without this every paragraph had a different
 * voice (owner report, 2026-10-29). The seed is the voicebank entry's when
 * set; else a stable hash of the voice's description (and id), so the same
 * description is the same voice on every pub, forever, with no row to store.
 * Other models get the entry's seed only when one was set.
 */
import { createHash } from "node:crypto"

export function stableVoiceSeed(parts: Array<string | null | undefined>): number {
	const key = parts.map((p) => (p ?? "").trim().toLowerCase()).join("\u0000")
	const h = createHash("sha256").update(key).digest()
	// 31 bits: every seed field we know takes a positive int32.
	return h.readUInt32BE(0) & 0x7fffffff
}

export function seedFor(input: {
	designsVoice: boolean
	entrySeed: number | null | undefined
	description: string | null | undefined
	voiceId: string | null | undefined
}): number | undefined {
	if (Number.isInteger(input.entrySeed)) return input.entrySeed as number
	if (!input.designsVoice) return undefined
	return stableVoiceSeed([input.description, input.voiceId])
}
