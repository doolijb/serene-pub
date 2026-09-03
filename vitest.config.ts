import { sveltekit } from "@sveltejs/kit/vite"
import { defineConfig } from "vitest/config"

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ["src/**/*.{test,spec}.ts", "scripts/**/*.{test,spec}.ts"],
		/**
		 * Performance gates are excluded from the ordinary sweep and run on
		 * their own (`npm run test:budgets`).
		 *
		 * ⚠ Not because they are optional — 18 §9 calls them acceptance numbers
		 * — but because a timing assertion competing with two hundred other
		 * test files for CPU measures the scheduler rather than the thing under
		 * test. Left in the sweep it passed alone and failed in the suite,
		 * which is the worst kind of gate: one people learn to re-run.
		 */
		exclude: ["**/node_modules/**", "src/**/*.budgets.test.ts"],
		environment: "node",
		// Redirects every run at a throwaway data dir. Without it, any test
		// that transitively imports $lib/server/db migrates the developer's
		// real database — see vitest.setup.ts.
		setupFiles: ["./vitest.setup.ts"]
	}
})
