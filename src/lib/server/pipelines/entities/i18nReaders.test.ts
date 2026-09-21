/**
 * One resolver for display text (R-20; U5i, ruled 2026-09-17).
 *
 * The four server readers of declared display text — actions, script kinds,
 * genres, the panel's choices — read through the SDK's `i18nText`, and this
 * pins that at the import level: each file names `i18nText` in its
 * `@serene-pub/sdk` import and none reaches for `.en` by hand. A second
 * reader is where the rule "a bare string is en" drifts and where a locale
 * goes unanswered. Cheap on purpose — a source read, not a spy — because what
 * is guarded is the absence of a second reader, which no runtime test can see.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"

const READERS = [
	"src/lib/server/pipelines/entities/sessionActions.ts",
	"src/lib/server/pipelines/entities/scripts.ts",
	"src/lib/server/pipelines/entities/sessionGenres.ts",
	"src/lib/server/pipelines/config/panel/choices.ts"
]

/** The `@serene-pub/sdk` import block(s) of a source, joined. */
const sdkImports = (source: string): string =>
	[...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@serene-pub\/sdk"/g)]
		.map((m) => m[1]!)
		.join(",")

describe("the four display-text readers resolve through the SDK's i18nText", () => {
	for (const file of READERS) {
		test(file, () => {
			const source = readFileSync(resolve(process.cwd(), file), "utf8")
			expect(sdkImports(source)).toMatch(/\bi18nText\b/)
			expect(source).toMatch(/i18nText\(v as I18n \| undefined\)/)
			// No hand-rolled reader beside it: nothing indexes `.en` off a value.
			expect(source).not.toMatch(/\?\.en\b/)
			expect(source).not.toMatch(/\.en \?\?/)
		})
	}
})
