/**
 * Which instance capability defaults target one (endpoint, model) pair.
 *
 * Pure and client-safe: the shape mirrors `CapabilityDefault` without importing
 * the server module (which pulls in drizzle). Only an EXPLICIT model match
 * counts — connections have no default model, so a default naming only the
 * endpoint targets nothing.
 */
export interface CapabilityDefaultRef {
	connectionId: number | null
	connectionModelId: number | null
}

/**
 * A default choice for one pair, from the model's detail view — one
 * capability, or every satisfiable one ("default for all"). The sidebar owns
 * the emission and any confirmation.
 */
export type PairDefaultSelection =
	| { kind: "one"; capability: string }
	| { kind: "all"; capabilities: string[] }

export function systemCapabilitiesForModel(
	defaults: Record<string, CapabilityDefaultRef | undefined> | undefined,
	connectionId: number,
	modelId: number
): string[] {
	if (!defaults) return []
	const out: string[] = []
	for (const [capability, def] of Object.entries(defaults)) {
		if (!def || def.connectionId !== connectionId) continue
		if (def.connectionModelId === modelId) out.push(capability)
	}
	return out.sort()
}
