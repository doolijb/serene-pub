/**
 * The session page's chips speak the viewer's language.
 *
 * The page greys Regenerate, Continue and the session actions row through
 * core-catalog's `paletteRowState`, whose reason for a failed `item.*`
 * predicate is put in the viewer's language by the `statusText` its caller
 * hands it — else by core-catalog's own per-realm resolver, which only a
 * conversation sets (its worker's), so on the page it is English. The page
 * hands it the app's own `statusText`, at every call; it does not ALSO set
 * the realm's resolver — one mechanism, not two.
 *
 * The page is not mounted here (see `widgetMounts.test.ts` on why the suite
 * reads the page's source instead), so this proves the two halves: the
 * parameter is what `paletteRowState` speaks with, and the page passes it.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { itemValuesOf, paletteRowState } from "@serene-pub/core-catalog/conversation"
import type { StatusText } from "@serene-pub/sdk"

const PAGE = resolve(__dirname, "../../../../routes/sessions/[id]/+page.svelte")

/** A Regenerate chip whose newest row is not the viewer's own. */
const chip = (reason: { en: string; es?: string }, statusText?: (s: StatusText | null | undefined) => string) =>
	paletteRowState(
		{
			name: "Regenerate",
			audience: { act: ["item"] },
			canAct: true,
			enabled: true,
			venue: "extra",
			itemPredicates: [{ on: "item.mine", truthy: true, reason }]
		},
		{
			generating: false,
			newest: itemValuesOf({ id: 9, role: "assistant" }, { isNewest: true, mine: false }),
			...(statusText ? { statusText } : {})
		}
	).reason

/** The app's `statusText` for a Spanish viewer: an author's own translation, else the English through `t`. */
const spanish = (s: StatusText | null | undefined) => {
	const i18n = (s?.i18n ?? {}) as Record<string, string>
	return i18n.es ?? `«${i18n.en}»`
}

describe("the session page's chip reasons", () => {
	test("speak through the `statusText` the caller hands `paletteRowState`, with no realm resolver set", () => {
		// Nothing set the realm's resolver: without the parameter, English.
		expect(chip({ en: "only on your own line", es: "solo en tu propia línea" })).toBe("only on your own line")
		expect(chip({ en: "only on your own line", es: "solo en tu propia línea" }, spanish)).toBe(
			"solo en tu propia línea"
		)
		expect(chip({ en: "only on your own line" }, spanish)).toBe("«only on your own line»")
	})

	test("the page hands the app's `statusText` to every `paletteRowState` call, and sets no realm resolver", () => {
		const src = readFileSync(PAGE, "utf8")
		expect(src).toMatch(/\bimport\s*\{[^}]*\bstatusText\b[^}]*\}\s*from\s*"\$lib\/client\/i18n\/state\.svelte"/)
		const calls = [...src.matchAll(/\bpaletteRowState\(chipVerdict\(t\),\s*\{([^}]*)\}\)/g)].map((m) => m[1])
		// `extraChip` (Regenerate, Continue), the session actions row, and the
		// action legend's composer and message verdicts (2026-09-28).
		expect(calls).toHaveLength(4)
		for (const opts of calls) expect(opts).toMatch(/(^|[,\s])statusText(\s*:\s*statusText)?\s*($|,)/)
		// Every call, not just the four this test knows by shape.
		expect(src.match(/\bpaletteRowState\(/g)).toHaveLength(4)
		// The page's own `enabledWhenState` calls, should it gain any, take it too.
		for (const m of src.matchAll(/\benabledWhenState\(([^)]*)\)/g)) expect(m[1]).toMatch(/\bstatusText\b/)
		// One mechanism: the realm-wide resolver is not the page's to set.
		expect(src).not.toMatch(/\bsetStatusTextResolver\b/)
	})
})
