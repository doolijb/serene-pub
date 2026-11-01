/**
 * 🚧 The **voice try-out** — one short line spoken with a voice the person is
 * still deciding on (a voicebank entry's draft, a card's timbre draft), heard
 * at once and stored nowhere. Socket `voicebank:preview`
 * (`Sockets.Voicebank.Preview`), server seam `server/speech/preview.ts`
 * (`previewVoice`), control `client/components/speech/VoiceTryout.svelte`.
 *
 * ⚠ Not a voice's `previewUrl` (a sample the service hosts, `SpeechVoice`),
 * and not the prompt preview of a reply.
 */

/** What a try-out says when the person typed nothing. */
export const VOICE_TRYOUT_SAMPLE_LINE =
	"Hello. This is how I sound when one of my lines is read aloud. Does it suit me?"

/** The longest line a try-out speaks (characters). */
export const VOICE_TRYOUT_TEXT_MAX = 300

/** The highest seed a voice accepts (positive int32), the voicebank's and the timbre's. */
export const VOICE_SEED_MAX = 2147483647
