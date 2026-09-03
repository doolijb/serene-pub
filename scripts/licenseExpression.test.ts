import { describe, expect, test } from "vitest"

import { isAcceptableLicense } from "./licenseExpression.js"

// name/version are only used by the LICENSE_WHITELIST lookup inside
// isAcceptableLicense; "license-gate-test-pkg" is never in that list, so
// every case here exercises the expression evaluator itself, not the
// whitelist short-circuit (which gets its own test below).
const NAME = "license-gate-test-pkg"
const VERSION = "0.0.0"

function accepts(license: unknown) {
	return isAcceptableLicense(license as any, NAME, VERSION)
}

describe("isAcceptableLicense — required accepts", () => {
	test("OR elects the GPL-3.0-or-later side of elkjs's dual grant, not EPL-2.0", () => {
		expect(accepts("EPL-2.0 OR GPL-3.0-or-later")).toBe(true)
	})

	test("OR accepts when MIT is allowlisted even though GPL-2.0 is not", () => {
		expect(accepts("MIT OR GPL-2.0")).toBe(true)
	})

	test("AND accepts when both conjuncts are allowlisted", () => {
		expect(accepts("MIT AND Apache-2.0")).toBe(true)
	})

	test("a single allowlisted id with hyphens intact is accepted (AGPL-3.0-or-later)", () => {
		expect(accepts("AGPL-3.0-or-later")).toBe(true)
	})

	test("a single allowlisted id with hyphens intact is accepted (LGPL-3.0-or-later)", () => {
		expect(accepts("LGPL-3.0-or-later")).toBe(true)
	})

	test("a single pair of outer parens is unwrapped before evaluation", () => {
		expect(accepts("(MIT OR CC0-1.0)")).toBe(true)
	})

	test("'/' is treated as an OR-like separator", () => {
		expect(accepts("MIT/Apache-2.0")).toBe(true)
	})

	test("a trailing parenthetical note carries no operator, so it is stripped as a note", () => {
		expect(accepts("MIT (see LICENSE)")).toBe(true)
	})
})

describe("isAcceptableLicense — required rejects", () => {
	test("THE CRITICAL ONE: AND must not pass on the strength of MIT alone (MIT AND GPL-2.0)", () => {
		expect(accepts("MIT AND GPL-2.0")).toBe(false)
	})

	test("OR rejects when neither alternative is acceptable", () => {
		expect(accepts("GPL-2.0 OR SomethingProprietary")).toBe(false)
	})

	test("a nested group must fail closed rather than be mis-parsed (MIT AND (GPL-2.0 OR EPL-2.0))", () => {
		expect(accepts("MIT AND (GPL-2.0 OR EPL-2.0)")).toBe(false)
	})

	test("the fail-closed paren guard rejects a parenthetical containing an operator even without an AND/OR joining it", () => {
		expect(accepts("MIT (GPL-2.0 OR EPL-2.0)")).toBe(false)
	})

	test("UNKNOWN is never an implicit accept", () => {
		expect(accepts("UNKNOWN")).toBe(false)
	})

	test("unknown (lowercase) is never an implicit accept", () => {
		expect(accepts("unknown")).toBe(false)
	})

	test("an empty string is not an accept", () => {
		expect(accepts("")).toBe(false)
	})

	test("a null license is not an accept", () => {
		expect(accepts(null)).toBe(false)
	})

	test("an undefined license is not an accept", () => {
		expect(accepts(undefined)).toBe(false)
	})
})

describe("isAcceptableLicense — precedence: AND binds tighter than OR", () => {
	test("(MIT AND GPL-2.0) OR Apache-2.0 is rescued by the OR arm", () => {
		expect(accepts("MIT AND GPL-2.0 OR Apache-2.0")).toBe(true)
	})

	test("Apache-2.0 OR (MIT AND GPL-2.0) — the AND-arm still needs to hold, but the OR arm rescues it", () => {
		expect(accepts("Apache-2.0 OR MIT AND GPL-2.0")).toBe(true)
	})

	test("(GPL-2.0 AND MIT) OR EPL-2.0 rejects because neither arm holds", () => {
		expect(accepts("GPL-2.0 AND MIT OR EPL-2.0")).toBe(false)
	})

	test("three-term mix: the second AND-arm is fully allowlisted, so the whole OR accepts (MIT AND GPL-2.0 OR ISC AND MIT)", () => {
		expect(accepts("MIT AND GPL-2.0 OR ISC AND MIT")).toBe(true)
	})

	test("three-term mix: both AND-arms have a bad conjunct, so the whole OR rejects (MIT AND GPL-2.0 OR EPL-2.0 AND MIT)", () => {
		expect(accepts("MIT AND GPL-2.0 OR EPL-2.0 AND MIT")).toBe(false)
	})
})

describe("isAcceptableLicense — regression: the hyphen bug (embedded 'or' is not a separator)", () => {
	test("'or' inside a hyphenated id is not a separator (GPL-3.0-or-later)", () => {
		expect(accepts("GPL-3.0-or-later")).toBe(true)
	})

	test("a single hyphenated id with no embedded operator (AGPL-3.0-only)", () => {
		expect(accepts("AGPL-3.0-only")).toBe(true)
	})

	test("EPL-2.0 is deliberately not allowlisted on its own", () => {
		expect(accepts("EPL-2.0")).toBe(false)
	})

	test("GPL-2.0 is not allowlisted", () => {
		expect(accepts("GPL-2.0")).toBe(false)
	})

	test("only the -or-later form is allowlisted, not GPL-3.0-only", () => {
		expect(accepts("GPL-3.0-only")).toBe(false)
	})
})

describe("isAcceptableLicense — regression: separator forms", () => {
	test("'&&' is AND-like — one bad conjunct poisons it (MIT && GPL-2.0)", () => {
		expect(accepts("MIT && GPL-2.0")).toBe(false)
	})

	test("'&&' accepts when both conjuncts are allowlisted (MIT && Apache-2.0)", () => {
		expect(accepts("MIT && Apache-2.0")).toBe(true)
	})

	test("plain AND accepts when both conjuncts are allowlisted (Apache-2.0 AND LGPL-3.0-or-later)", () => {
		expect(accepts("Apache-2.0 AND LGPL-3.0-or-later")).toBe(true)
	})

	test("plain AND rejects when a conjunct is not allowlisted (Apache-2.0 AND EPL-2.0)", () => {
		expect(accepts("Apache-2.0 AND EPL-2.0")).toBe(false)
	})

	test("'||' is OR-like (MIT || GPL-2.0)", () => {
		expect(accepts("MIT || GPL-2.0")).toBe(true)
	})

	test("',' is OR-like (GPL-2.0, MIT)", () => {
		expect(accepts("GPL-2.0, MIT")).toBe(true)
	})

	test("'||' rejects when neither side is acceptable (GPL-2.0 || SomethingProprietary)", () => {
		expect(accepts("GPL-2.0 || SomethingProprietary")).toBe(false)
	})
})

describe("isAcceptableLicense — regression: grouped expressions fail closed in every arrangement", () => {
	test("a group in the left position fails closed ((GPL-2.0 OR EPL-2.0) AND MIT)", () => {
		expect(accepts("(GPL-2.0 OR EPL-2.0) AND MIT")).toBe(false)
	})

	test("fails closed even when the grouped expression is semantically fine ((MIT OR GPL-2.0) AND MIT)", () => {
		expect(accepts("(MIT OR GPL-2.0) AND MIT")).toBe(false)
	})

	test("a group in the right position fails closed (MIT OR (GPL-2.0 AND EPL-2.0))", () => {
		expect(accepts("MIT OR (GPL-2.0 AND EPL-2.0)")).toBe(false)
	})

	test("a group nested inside an outer wrap fails closed ((MIT AND (GPL-2.0 OR EPL-2.0)))", () => {
		expect(accepts("(MIT AND (GPL-2.0 OR EPL-2.0))")).toBe(false)
	})
})

describe("isAcceptableLicense — regression: notes vs. unacceptable ids", () => {
	test("a note is stripped but a still-unacceptable id underneath still rejects (GPL-2.0 (see LICENSE))", () => {
		expect(accepts("GPL-2.0 (see LICENSE)")).toBe(false)
	})
})

describe("isAcceptableLicense — regression: WITH expressions are unhandled and stay unhandled", () => {
	test("SPDX WITH exceptions are not supported (Apache-2.0 WITH LLVM-exception)", () => {
		expect(accepts("Apache-2.0 WITH LLVM-exception")).toBe(false)
	})

	test("SPDX WITH exceptions are not supported (MIT WITH Bison-exception-2.2)", () => {
		expect(accepts("MIT WITH Bison-exception-2.2")).toBe(false)
	})
})

describe("isAcceptableLicense — regression: object/array license fields from package.json", () => {
	test("an array of ids is joined with 'or' — MIT is elected", () => {
		expect(accepts(["MIT", "GPL-2.0"])).toBe(true)
	})

	test("an array of ids is joined with 'or' — rejects when neither is acceptable", () => {
		expect(accepts(["GPL-2.0", "EPL-2.0"])).toBe(false)
	})

	test("a { type } license object is accepted when its id is allowlisted", () => {
		expect(accepts({ type: "MIT" })).toBe(true)
	})

	test("a { type } license object is rejected when its id is not allowlisted", () => {
		expect(accepts({ type: "GPL-2.0" })).toBe(false)
	})
})

describe("isAcceptableLicense — whitespace and case tolerance", () => {
	test("surrounding whitespace is trimmed", () => {
		expect(accepts("  MIT  ")).toBe(true)
	})

	test("an already-lowercase expression is accepted", () => {
		expect(accepts("mit or gpl-2.0")).toBe(true)
	})

	test("mixed-case operators and ids are normalized before evaluation", () => {
		expect(accepts("Mit Or Gpl-2.0")).toBe(true)
	})
})

describe("isAcceptableLicense — LICENSE_WHITELIST short-circuit", () => {
	test("an exact name+version match in LICENSE_WHITELIST is accepted even with an UNKNOWN license", () => {
		expect(isAcceptableLicense("UNKNOWN", "json-schema", "0.4.0")).toBe(
			true
		)
	})
})
