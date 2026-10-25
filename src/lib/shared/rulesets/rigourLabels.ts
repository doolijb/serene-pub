/**
 * 🚧 How strict, in the interface's words (NOMENCLATURE §28): the SDK's
 * rigour ids are never shown. `prose` → **Words only**, `mechanics` →
 * **Rules**, `scripts` → **The rules decide** (2026-10-22: no level is named
 * for dice — a ruleset may decide by cards, a spend or no chance at all).
 * The SDK's one table (`RIGOUR_LABELS`), never a copy.
 */
import { RIGOUR_LABELS as SDK_RIGOUR_LABELS } from "@serene-pub/sdk"

export const RIGOUR_LABELS: Readonly<Record<string, string>> = SDK_RIGOUR_LABELS

/** The plain word for a rigour id; an id nothing names reads as itself. */
export const rigourLabel = (id: string): string => RIGOUR_LABELS[id] ?? id
