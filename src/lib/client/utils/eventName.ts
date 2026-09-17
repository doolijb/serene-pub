/**
 * The display name of a session event, from its id.
 *
 * A screen that lists a preset's binding slots has an event ID in hand
 * (`core:event/message-respond@1` — the address every binding, lock and
 * genre surface is keyed by since R-4) and a person to show it to. The id is
 * not a label: the registry entry's `name` is, and the id goes in the
 * tooltip, so the address stays reachable without being read as a word.
 *
 * A plugin's event, or an id the running build does not know, falls back to
 * the humanised slug rather than the raw address — the same fallback the
 * pipeline panel uses for a definition without an `i18n.name`.
 */
import { getEvent } from "@serene-pub/sdk"
import { i18nTextIn } from "$lib/shared/i18n/i18nText"
import { t } from "$lib/client/i18n/state.svelte"

/** `owner:event/<slug>@N` → `<slug>`; a bare or unparseable id is itself. */
export function eventSlugOf(id: string): string {
	const m = /^[^:]+:event\/([^@]+)(?:@\d+)?$/.exec(id)
	return m ? m[1]! : id
}

export function eventDisplayName(id: string): string {
	const slug = eventSlugOf(id)
	const named = i18nTextIn(getEvent(slug)?.name)
	if (named) return t(named)
	return slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}
