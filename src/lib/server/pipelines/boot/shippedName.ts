/**
 * The name a shipped row takes in its pool.
 *
 * Prompts, context templates and variable templates are unique by name within
 * their pool (`pipeline_prompts_pool_name_idx`,
 * `pipeline_context_templates_node_definition_name_idx`,
 * `pipeline_variable_templates_variable_name_idx`). A person may already have
 * a row under a name the catalog later ships, and a seed that wrote the
 * catalog's name over theirs would hit the index and stop the boot.
 *
 * The SHIPPED row yields, never the person's — the rule sampling presets
 * already follow (`db/defaults.ts`): their name is theirs, and a shipped row
 * is found by its seed key whatever it is called. It takes the catalog's name
 * with "(Built-in)" (then "(Built-in 2)", …), and because every boot asks
 * again, the suffix goes the boot after that name is free.
 *
 * Names compare exactly, as the unique indexes do.
 */

/**
 * `wanted`, or the first "(Built-in)" form of it no other row in the pool
 * holds. `taken` is every name in the pool except the shipped row's own.
 */
export function shippedNameFor(
	wanted: string,
	taken: ReadonlySet<string>
): string {
	if (!taken.has(wanted)) return wanted
	for (let i = 1; ; i++) {
		const name =
			i === 1 ? `${wanted} (Built-in)` : `${wanted} (Built-in ${i})`
		if (!taken.has(name)) return name
	}
}

/**
 * Every name in a pool's rows except one row's own: the `taken` a shipped row
 * yields to. `selfId` is the shipped row, or null for one not written yet.
 */
export function namesTakenBesides(
	rows: ReadonlyArray<{ id: number; name: string }>,
	selfId: number | null
): Set<string> {
	return new Set(rows.filter((r) => r.id !== selfId).map((r) => r.name))
}
