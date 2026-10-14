/**
 * The stale-preset notice as the session header's one line (PLAN-core-widgets
 * §3.16; ruled 2026-09-10).
 *
 * A session whose preset binds an event to a pipeline that is gone runs the
 * genre's default instead, and this line is the only place a person in the
 * session would find that out. It was a banner above the composer; it is the
 * header's **header notice** now (`OpenSessionCtx.headerNotice`), because a
 * pipeline substitution is not a turn fact and the turn line is.
 *
 * Same words as the banner, said on one line: an administrator is told which
 * binding and where to fix it; everyone else, which events run the default.
 * Dismissible for this view only — the page keeps the flag
 * (`presetBannerDismissed`), never storage: the condition outlives the tab, so
 * a stored dismissal would be a way to hide it from yourself.
 */

/** What the notice reads off the session page's data (`sessionPageData`). */
export interface PresetNoticeSource {
	/** The session's preset verdict (`sessions:presetStatus`). */
	readonly presetStatus: Sockets.Sessions.PresetStatus.Response | undefined
	/** Dismissed for this view; Dismiss sets it. */
	presetBannerDismissed: boolean
}

/** The header notice for a session's preset verdict, or null when it has none to give. */
export function presetHeaderNotice(
	page: PresetNoticeSource,
	isAdmin: boolean
): SessionHeaderNotice | null {
	const status = page.presetStatus
	const stale = status?.stale ?? []
	if (!stale.length || page.presetBannerDismissed) return null
	const dismiss = () => {
		page.presetBannerDismissed = true
	}
	if (isAdmin) {
		const preset = status?.presetName
			? `preset ${status.presetName}`
			: "its preset"
		const binds = stale.map((b) => `${b.event} to ${b.bound}`).join(", ")
		return {
			text:
				`This session runs the default pipeline: ${preset} binds ${binds}` +
				` — which ${stale.length === 1 ? "is" : "are"} not available.`,
			link:
				status?.presetId != null
					? {
							href: `/admin/session-presets/${status.presetId}#bindings`,
							label: "Fix the binding"
						}
					: null,
			dismiss
		}
	}
	return {
		text: `This session is running the default pipeline for ${stale.map((b) => b.event).join(", ")}.`,
		link: null,
		dismiss
	}
}
