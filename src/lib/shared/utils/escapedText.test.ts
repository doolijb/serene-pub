/**
 * The escape round trip, over every marker that ships.
 *
 * The template editor shows escapes and stores characters, so this pair decides
 * the bytes in `completion_templates.roles` — and through it the bytes of every
 * prompt sent through a connection using that row. A display encoder that does
 * not round-trip through its decoder writes markers nobody typed.
 *
 * Harvested from `BUILTIN_COMPLETION_TEMPLATES` rather than re-typed, so a
 * format added later is covered the day it is added.
 */
import { describe, it, expect } from "vitest"
import { fromEscaped, toEscaped } from "./escapedText"
import {
	BUILTIN_COMPLETION_TEMPLATES,
	BLOCK_ROLES
} from "$lib/shared/constants/completionTemplates"

const everyShippedMarker = () => {
	const out: { where: string; text: string }[] = []
	for (const t of BUILTIN_COMPLETION_TEMPLATES) {
		for (const role of BLOCK_ROLES) {
			out.push({
				where: `${t.key}.${role}.prefix`,
				text: t.roles[role].prefix
			})
			out.push({
				where: `${t.key}.${role}.suffix`,
				text: t.roles[role].suffix
			})
		}
		out.push({
			where: `${t.key}.fallback.prefix`,
			text: t.fallbackRole.prefix
		})
		out.push({
			where: `${t.key}.fallback.suffix`,
			text: t.fallbackRole.suffix
		})
	}
	return out
}

describe("escapedText", () => {
	it("round-trips every shipped marker", () => {
		const markers = everyShippedMarker()
		// A guard on the harvest itself: an empty list would make this vacuous,
		// and `split_session`'s framing is deliberately empty.
		expect(markers.length).toBeGreaterThan(90)
		for (const { where, text } of markers)
			expect(fromEscaped(toEscaped(text)), where).toBe(text)
	})

	it("makes the invisible visible", () => {
		expect(toEscaped("### User:\n")).toBe("### User:\\n")
		expect(toEscaped("\n<</SYS>> [/INST]</s>\n")).toBe(
			"\\n<</SYS>> [/INST]</s>\\n"
		)
		expect(toEscaped("a\tb\r")).toBe("a\\tb\\r")
	})

	it("keeps a backslash that means a backslash", () => {
		// `\\n` in the editor is a literal backslash followed by an n, and it has
		// to come back as one — otherwise every save of a template containing a
		// backslash loses a character.
		expect(fromEscaped(toEscaped("C:\\path\\n"))).toBe("C:\\path\\n")
		expect(toEscaped("\\")).toBe("\\\\")
		expect(fromEscaped("\\\\")).toBe("\\")
	})

	it("leaves an escape it does not know exactly as typed", () => {
		// Swallowing the backslash would delete a character from a marker;
		// inventing a meaning for it would add one.
		expect(fromEscaped("\\d")).toBe("\\d")
		expect(fromEscaped("ends with a backslash \\")).toBe(
			"ends with a backslash \\"
		)
	})

	it("treats absence as the empty string at both ends", () => {
		expect(toEscaped(null)).toBe("")
		expect(toEscaped(undefined)).toBe("")
		expect(fromEscaped(null)).toBe("")
		expect(fromEscaped(undefined)).toBe("")
	})
})
