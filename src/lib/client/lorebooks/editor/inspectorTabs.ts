/**
 * The inspector's strip, with the figures on it.
 *
 * A door declares which questions its rows can answer (`SectionDescriptor.
 * inspector`); this is what those questions are called and what they count. The
 * ids are the route's, so a link to an entry's account still lands on the tab it
 * names — only the words change with the count beside them.
 */

import type { InspectorTab } from "../sections/types"

export interface InspectorCounts {
	references: number
	contains: number
}

export function inspectorTabsFor(
	declared: readonly InspectorTab[],
	counts: InspectorCounts
): InspectorTab[] {
	const out: InspectorTab[] = []
	for (const tab of declared) {
		if (tab.id !== "references") {
			out.push(tab)
			continue
		}
		out.push({ ...tab, label: `${tab.label} ${counts.references}` })
		// Contains rides with References rather than being declared: it is the
		// other half of the same question, over the same column.
		out.push({ id: "contains", label: `Contains ${counts.contains}` })
	}
	return out
}
