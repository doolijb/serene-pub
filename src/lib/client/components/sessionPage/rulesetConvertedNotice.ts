/**
 * 🚧 M0 L4: the genre's autoConvert moved this session's rules as it opened — told as the session header's one line.
 * Null with nothing converted or once dismissed.
 */
export function rulesetConvertedHeaderNotice(
	converted: { from: string; to: string } | null,
	opts: { dismissed: boolean; dismiss: () => void }
): SessionHeaderNotice | null {
	if (!converted || opts.dismissed) return null
	return {
		text: `The rules were updated from v${converted.from} to v${converted.to} when this session opened.`,
		link: null,
		dismiss: opts.dismiss
	}
}
