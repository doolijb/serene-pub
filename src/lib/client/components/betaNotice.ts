/**
 * The beta notice's one sentence and its per-browser dismissal (★R4,
 * PLAN-0-5-polish-parity 2026-10-24; STYLE-GUIDE §2.3).
 *
 * Home said "Serene Pub is in beta" and, on a pre-release, a second orange
 * line about guarantees; the wizard showed both above its card and Document
 * View's footer repeated them. A fresh user's first screen said "warning"
 * three times before "Evening, admin." Now there is one sentence, in one
 * quiet line on Home, the same words in Document View's footer, and none on
 * the wizard.
 *
 * ⚠ The dismissal is keyed by VERSION: a new build brings the line back once,
 * because "keep backups" is the news a pre-release upgrade carries. Storage
 * may be missing or throw (a private window, blocked site data); the notice
 * then shows every visit, which is the safe way to be wrong.
 */

export const BETA_NOTICE_DISMISSED_KEY = "serene-pub:betaNoticeDismissed"

/** The notice, in words. `prerelease` adds the build's own warning word. */
export function betaNoticeSentence(version: string, prerelease: boolean): string {
	return `Beta, ${prerelease ? "pre-release " : ""}${version}. Expect changes; keep backups of anything you can't lose.`
}

/** Whether this browser dismissed the notice for this version. */
export function isBetaNoticeDismissed(version: string): boolean {
	try {
		return localStorage.getItem(BETA_NOTICE_DISMISSED_KEY) === version
	} catch {
		return false
	}
}

/** Remember the dismissal for this version, where storage allows. */
export function dismissBetaNotice(version: string): void {
	try {
		localStorage.setItem(BETA_NOTICE_DISMISSED_KEY, version)
	} catch {
		// No storage: the notice comes back next visit. Nothing else to do.
	}
}
