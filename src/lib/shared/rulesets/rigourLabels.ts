/**
 * 🚧 How strict, in the interface's words (NOMENCLATURE §28): the SDK's
 * rigour ids are never shown. `prose` → **Words only**, `mechanics` →
 * **Rules**, `scripts` → **Rules and dice**.
 */
export const RIGOUR_LABELS: Readonly<Record<string, string>> = Object.freeze({
	prose: "Words only",
	mechanics: "Rules",
	scripts: "Rules and dice"
})

/** The plain word for a rigour id; an id nothing names reads as itself. */
export const rigourLabel = (id: string): string => RIGOUR_LABELS[id] ?? id
