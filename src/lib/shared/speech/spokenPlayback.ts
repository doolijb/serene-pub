/**
 * 🚧 **Spoken playback** — how spoken lines play for ONE person
 * (`user_settings.spoken_playback`; owner ruling 2026-10-28). The session's
 * Read aloud decides whether audio is MADE; this decides only how it plays
 * for the listener, so a member changes nothing anyone else hears or pays for.
 */
export const SPOKEN_PLAYBACK_MODES = ["auto", "click", "never"] as const
export type SpokenPlayback = (typeof SPOKEN_PLAYBACK_MODES)[number]

export const SPOKEN_PLAYBACK_CHOICES: Readonly<
	Record<SpokenPlayback, { label: string; description: string }>
> = {
	auto: {
		label: "Play as they arrive",
		description: "The newest line plays by itself when the session is set to Make and play."
	},
	click: {
		label: "Play when I press",
		description: "A player under each spoken line; nothing plays until you press it."
	},
	never: {
		label: "No player",
		description: "Spoken lines are not shown to you at all. Audio is still made for others."
	}
}

export function isSpokenPlayback(v: unknown): v is SpokenPlayback {
	return typeof v === "string" && (SPOKEN_PLAYBACK_MODES as readonly string[]).includes(v)
}
