import { sveltekit } from "@sveltejs/kit/vite"
import { defineConfig } from "vitest/config"

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ["src/**/*.{test,spec}.ts"],
		environment: "node",
		// Redirects every run at a throwaway data dir. Without it, any test
		// that transitively imports $lib/server/db migrates the developer's
		// real database — see vitest.setup.ts.
		setupFiles: ["./vitest.setup.ts"]
	}
})
