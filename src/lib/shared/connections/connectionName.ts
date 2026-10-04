/**
 * A connection name nothing else in the list has taken.
 *
 * The server refuses a duplicate connection name (case and outer spacing
 * ignored), and a service's default name — "KoboldCPP", "OpenRouter" — is
 * exactly the name somebody who already added one is likely to have used. So
 * a name made FOR somebody (a manager's one press, the 0.5.3 upgrade's
 * combined connections) is numbered from 2, the way a person would: "OpenRouter",
 * "OpenRouter 2", "OpenRouter 3".
 *
 * Shared because two places make names this way and must agree: the Add menu's
 * manager press (`client/components/connections/managers.ts`) and the 0.5.3
 * upgrade (`server/attic/etl/connectionGroups.ts`).
 */
export function uniqueName(base: string, taken: Iterable<string>): string {
	const used = new Set([...taken].map((n) => n.trim().toLowerCase()))
	if (!used.has(base.toLowerCase())) return base
	for (let n = 2; n < 1000; n++) {
		const candidate = `${base} ${n}`
		if (!used.has(candidate.toLowerCase())) return candidate
	}
	return `${base} ${Date.now()}`
}
