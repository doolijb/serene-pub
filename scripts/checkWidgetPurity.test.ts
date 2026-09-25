import { expect, test } from "vitest"
import { widgetGateways, widgetPurityFindings } from "./checkWidgetPurity"

test("the session widgets import no store, no socket client and no Skeleton (C0)", () => {
	const found = widgetPurityFindings().map((f) => `${f.file}:${f.line} ${f.specifier} — ${f.why}`)
	expect(found).toEqual([])
})

/**
 * ⚠ A ratchet, not a pass: these shared modules a widget imports still reach
 * a store, the socket or Skeleton themselves — C0b's worklist. The list may
 * only shrink; a module added here is a widget that just got less portable.
 */
// C0b closed the list: a conversation widget reaches no store, socket or
// Skeleton, directly or through another module. It stays empty.
const KNOWN_GATEWAYS: string[] = []

test("no new module lets a widget reach a store, the socket or Skeleton indirectly", () => {
	const extra = widgetGateways().filter((g) => !KNOWN_GATEWAYS.includes(g))
	expect(extra).toEqual([])
})
