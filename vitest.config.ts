import { sveltekit } from "@sveltejs/kit/vite"
import { defineConfig } from "vitest/config"

/**
 * Performance gates are excluded from the ordinary sweep and run on their own
 * (`npm run test:budgets`).
 *
 * ⚠ Not because they are optional — 18 §9 calls them acceptance numbers — but
 * because a timing assertion competing with two hundred other test files for
 * CPU measures the scheduler rather than the thing under test. Left in the
 * sweep it passed alone and failed in the suite, which is the worst kind of
 * gate: one people learn to re-run.
 */
const excluded = ["**/node_modules/**", "src/**/*.budgets.test.ts"]

/**
 * One list, spent twice: it is the integration project's `include` and the unit
 * project's `exclude`, so the two projects partition the suite by construction.
 * Kept as two hand-written lists they drift, and a file that falls out of both
 * is never run at all — a suite reporting green while testing less, which is a
 * worse failure than the flakes this split exists to retire.
 */
const integrationTests = ["src/**/*.int.test.ts", "scripts/**/*.int.test.ts"]

/**
 * Spelled out in both projects rather than left to config inheritance.
 * `setupFiles` redirects every run at a throwaway data dir; without it, any
 * test that transitively imports $lib/server/db migrates the developer's real
 * database (see vitest.setup.ts). A guarantee that destructive should not rest
 * on merge semantics being what you assumed they were.
 */
const shared = {
	environment: "node" as const,
	setupFiles: ["./vitest.setup.ts"]
}

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		projects: [
			{
				extends: true,
				test: {
					...shared,
					name: "unit",
					include: [
						"src/**/*.{test,spec}.ts",
						"scripts/**/*.{test,spec}.ts"
					],
					exclude: [...excluded, ...integrationTests]
				}
			},
			{
				extends: true,
				test: {
					...shared,
					name: "int",
					include: integrationTests,
					exclude: excluded,
					/**
					 * An integration test builds a real PGlite database —
					 * migrations, then a default-data sync — before it asserts
					 * anything, and under a full concurrent sweep that setup
					 * alone outruns the 5s/10s defaults. The file then passes
					 * alone and fails in the suite, which had us granting
					 * budgets one file at a time: 160 of these already carry
					 * their own `vi.setConfig`, and the stragglers kept
					 * surfacing two per run. 60s is headroom for a contended
					 * machine, not a claim about how long a database should
					 * take.
					 *
					 * ⚠ Scoped to this project on purpose. Raised globally it
					 * would cost the ~170 unit files their fast failure: a test
					 * that hangs should say so in five seconds, not sixty.
					 */
					testTimeout: 60_000,
					hookTimeout: 60_000
				}
			}
		]
	}
})
