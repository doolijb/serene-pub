/**
 * The 0.5 config tables are an archive. This is what makes that true.
 *
 * `context_configs`, `prompt_configs`, `narrator_prompt_configs` and the four
 * summarize/graph config tables are superseded — by `pipeline_context_templates`
 * and `pipeline_prompts` — and nothing in 0.6 builds a prompt from any of them.
 * The rows are kept so a year of somebody's tuning survives the upgrade, and
 * they go with the tables in a later release.
 *
 * Until then they are **readable and nothing else**. A row that can still be
 * edited invites exactly one mistake: someone carefully re-tunes a prompt
 * config, sees it save, and wonders for a week why their chats did not change.
 * An archive that accepts writes is worse than one that refuses them, because
 * the write looks like it worked.
 *
 * ## Enforced at the socket, not in the panel
 *
 * The sidebar hides its own Save and Delete buttons, but that is a courtesy —
 * anything with a socket can still emit. This is the rule. It sits in
 * `register`, which every handler in the application passes through, so a
 * handler added to one of these namespaces later is covered without anybody
 * remembering to cover it.
 *
 * ## Fail closed
 *
 * The reads are listed and everything else refuses, rather than the reverse.
 * Enumerating the *writes* would mean a verb nobody thought of — a bulk import,
 * a reorder, a `duplicate` — silently staying writable, and the failure would
 * be invisible until it corrupted the thing this is protecting. Listing the
 * three reads makes the mistake go the harmless way: a new read gets refused
 * once, loudly, and someone adds it here.
 */

/** The tables the Legacy panel exposes. */
const ARCHIVED_NAMESPACES = new Set([
	"contextConfigs",
	"promptConfigs",
	"narratorPromptConfigs",
	"worldSummarizeConfigs",
	"characterSummarizeConfigs",
	"sceneSummarizeConfigs",
	"graphBuildConfigs"
])

/**
 * What may still be done to an archived table.
 *
 * `preview` is a read despite the name: it renders a template and returns the
 * string, touching nothing.
 *
 * `setUserActive` and `setDefault` are deliberately **absent**. They look like
 * selection rather than mutation, but what they select is which archived row a
 * scope points at — and since nothing reads those pointers any more, they are
 * writes that change nothing observable. That is the precise shape of the
 * mistake this file exists to prevent.
 */
const READS = new Set(["get", "list", "preview"])

export interface ArchiveRefusal {
	event: string
	message: string
}

/**
 * Whether this event writes to an archived table, and what to say if it does.
 *
 * Returns null for everything else, which is almost everything — the check is
 * two set lookups on a string that was already split, so putting it in the hot
 * path of every socket message costs nothing worth measuring.
 */
export function archivedWrite(event: string): ArchiveRefusal | null {
	const [namespace, verb] = event.split(":")
	if (!namespace || !verb) return null
	if (!ARCHIVED_NAMESPACES.has(namespace)) return null
	if (READS.has(verb)) return null

	return {
		event: `${event}:error`,
		message:
			"These are the old configuration tables, kept so nothing you " +
			"wrote is lost — they are read-only now, and nothing is built " +
			"from them. Make this change in the Pipelines panel instead."
	}
}
