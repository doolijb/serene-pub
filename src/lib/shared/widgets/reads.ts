/**
 * A widget declaration's `reads` (R75) for the wire, off a stored manifest:
 * the SDK's one clamp (`widgetReads` — only base sections, each once) for a
 * declared list, and `undefined` for an absent (or unreadable) one, so the
 * wire says "reads all" by leaving the field off, as a declaration written
 * before R75 does. A thin wrapper: the rule itself is the SDK's, and every
 * host clamps through `widgetReads` directly.
 */
import { widgetReads, type WidgetBaseSection } from "@serene-pub/sdk"

export function declaredWidgetReads(
	raw: unknown
): WidgetBaseSection[] | undefined {
	return Array.isArray(raw)
		? [...widgetReads({ reads: raw as WidgetBaseSection[] })]
		: undefined
}
