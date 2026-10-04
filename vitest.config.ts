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
 * Client code that needs a DOM — custom elements, Svelte's `mount` — runs in
 * its own project under happy-dom with the `browser` export condition:
 * without it `svelte` resolves to its server build, where `mount` refuses.
 * Partitioned out of "unit" the same way "int" is, so no file is run twice.
 */
const domTests = ["src/**/*.dom.test.ts", "src/**/*.dom.test.svelte.ts"]

/**
 * `core:query/vector-search@1` declares a 3s `timeoutMs` (see the SDK
 * contract) enforced by the real host + `run()` engine — not a vitest
 * setting, so raising `testTimeout` cannot buy it headroom. A file that
 * drives that node for real (`createHost` + `run`, the mechanism switched on —
 * `query-windows.searchByMeaning`, since 2026-09-29) pays that budget in
 * wall-clock time, and a full parallel sweep
 * steals enough of it that the node comes back `err: timeout` — passing
 * alone, flaking in the suite. `measure/` is entirely this shape;
 * `parity/harness.rag.int.test.ts` drives the same real node the same way
 * (the rest of `parity/` leaves the switch at its shipped Automatic, which
 * searches nothing there — no embedding connection is starred — and never
 * reaches the timeout). Pulled into their own sequential project rather than
 * budgeted per-file, because the contention is the suite's, not any one
 * file's to fix.
 */
const serialInt = [
	"src/lib/server/pipelines/measure/**/*.int.test.ts",
	"src/lib/server/pipelines/parity/**/*.int.test.ts"
]

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
		/**
		 * Remove what an earlier run could not.
		 *
		 * Each test file is handed a throwaway data directory and removes it
		 * again (see vitest.setup.ts) — but a run that is killed never reaches
		 * that teardown, and the leftovers do not expire on their own: they
		 * reached 63,768 directories and 223 GB on one machine and filled the
		 * root filesystem, which puts every PGlite instance on it at risk. This
		 * pass runs once, before any file, and only touches leftovers old
		 * enough that no run in progress can be inside them.
		 */
		globalSetup: ["./scripts/testTempDirs.ts"],
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
					exclude: [...excluded, ...integrationTests, ...domTests]
				}
			},
			{
				extends: true,
				resolve: { conditions: ["browser"] },
				test: {
					...shared,
					environment: "happy-dom",
					name: "dom",
					include: domTests,
					exclude: excluded
				}
			},
			{
				extends: true,
				test: {
					...shared,
					name: "int",
					include: integrationTests,
					exclude: [...excluded, ...serialInt],
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
			},
			{
				extends: true,
				test: {
					...shared,
					name: "int-serial",
					include: serialInt,
					exclude: excluded,
					// Same headroom as "int" — these are int tests too, just
					// carved out for the reason on `serialInt` above.
					testTimeout: 60_000,
					hookTimeout: 60_000,
					// The fix itself: run this project's files one at a time so
					// none of them are competing with the rest of the suite (or
					// each other) for the CPU that `vector-search`'s 3s budget
					// assumes it has.
					fileParallelism: false
				}
			}
		]
	}
})
