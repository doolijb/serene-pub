/**
 * A status sentence in the viewer's language, without the app's i18n store
 * (C0b): the conversation's parts, and the pure modules they share with the
 * page (`messageVerbState`, `slashPalette`), resolve a `StatusText` here.
 *
 * It renders in English until a conversation points it at its widget's own
 * translation (`setStatusTextResolver`, from `createConversation`) — the
 * app's `t` natively, the worker's catalog in a remote — so the same source
 * speaks the viewer's language in either place.
 */
import { localeMapOf, renderStatusText, type StatusText } from "@serene-pub/sdk"

/** A status in `language`: its own translation when it carries one, else its English through `t`. */
export function statusTextIn(
	status: StatusText | null | undefined,
	language: string,
	t: (source: string) => string
): string {
	if (!status) return ""
	const i18n = localeMapOf(status.i18n)
	if (i18n[language] !== undefined) return renderStatusText(status, language)
	return renderStatusText({ ...status, i18n: { en: t(i18n.en) } })
}

let resolve: (status: StatusText | null | undefined) => string = (status) =>
	status ? renderStatusText(status) : ""

/** A status sentence, in the language the current resolver speaks. */
export const statusText = (status: StatusText | null | undefined): string => resolve(status)

/** Speak the conversation's language from now on. */
export function setStatusTextResolver(language: () => string, t: (source: string) => string): void {
	resolve = (status) => statusTextIn(status, language(), t)
}
