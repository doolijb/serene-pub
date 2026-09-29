import { sveltekit } from "@sveltejs/kit/vite"
import { defineConfig } from "vitest/config"

/**
 * The performance gates, alone and single-threaded (18 §9).
 *
 * ⚠ Separated from the ordinary sweep for a reason found rather than
 * anticipated: the stop-script budget passed in isolation at roughly half its
 * 1 ms allowance and failed inside the full suite, because a timing assertion
 * running alongside two hundred other test files measures CPU contention and
 * not the engine. A gate that fails for a reason unrelated to the code is a
 * gate people learn to re-run, which is worse than not having one.
 *
 * Run as its own CI step: `npm run test:budgets`.
 */
export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ["src/**/*.budgets.test.ts"],
		environment: "node",
		// The same stale-leftover pass as the main config: this run hands out
		// throwaway data directories through the same setup file, so a killed
		// budgets run leaks the same way (see scripts/testTempDirs.ts).
		globalSetup: ["./scripts/testTempDirs.ts"],
		setupFiles: ["./vitest.setup.ts"],
		fileParallelism: false
	}
})
