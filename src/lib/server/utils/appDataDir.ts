import envPaths from "env-paths"

/**
 * Where this install keeps everything it owns — the database, model weights,
 * caches, backups.
 *
 * ⚠ Its own module rather than a function in `utils/index.ts`, and the reason is
 * that barrel's first four imports: it pulls in `$lib/server/db` (which opens
 * PGlite at module scope) and the whole media stack. Anything that needs only a
 * path — the ONNX list cache, the model cache directories — would otherwise
 * open a database to learn one. `utils/index.ts` re-exports this, so every
 * existing caller is unchanged.
 *
 * `SERENE_PUB_DATA_DIR` wins when set: the portable bundle points it at the
 * unit beside the payload, and every test run points it at a throwaway
 * directory (see `vitest.setup.ts`).
 */
export function getAppDataDir() {
	const envDataDir = process.env.SERENE_PUB_DATA_DIR
	if (envDataDir) {
		return envDataDir
	}

	const paths = envPaths("SerenePub", { suffix: "" })
	return paths.data
}
