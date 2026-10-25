import { catchUpLabel, catchUpNotice, type CatchUpOffer } from "$lib/shared/sessions/archive"

/**
 * 🚧 pr-6 (pass 9 S4, R-d): the catch-up offer as the session header's one line — the "first-run notice". Its button
 * closes the OLDER session out (its own run; the summary is held for review there). Null with no offer or once dismissed.
 */
export function catchUpHeaderNotice(
	offer: CatchUpOffer | null | undefined,
	opts: { dismissed: boolean; dismiss: () => void; press: (fromSessionId: number) => void }
): SessionHeaderNotice | null {
	if (!offer || opts.dismissed) return null
	return {
		text: catchUpNotice(offer),
		link: null,
		dismiss: opts.dismiss,
		action: {
			label: catchUpLabel(offer),
			press: () => {
				opts.press(offer.fromSessionId)
				opts.dismiss()
			}
		}
	}
}
