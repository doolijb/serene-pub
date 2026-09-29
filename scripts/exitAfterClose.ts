/**
 * Run a CLI entry's work, close the database, then exit — on every path.
 *
 * A command that imports `$lib/server/db` opens PGlite and writes "unclean"
 * into meta.json's shutdown marker at open. Only `closeDatabase()` writes
 * "clean" back, and only after PGlite has let go. An entry that ends with a
 * bare `process.exit()` skips that, so every later boot logs
 * `[db] previous shutdown: unclean` and the WAL is left to PGlite's recovery.
 *
 * `close` is the app's own teardown (`closeDatabase()`, the same function the
 * "database" managed service runs on SIGTERM) — never a second one. It is
 * passed in rather than imported so this file does not open the database by
 * being loaded, and so a close that throws (the module itself failed to
 * import) is reported without masking the work's exit code.
 */
export async function exitAfterClose(
	work: () => Promise<number>,
	close: () => Promise<void>,
	exit: (code: number) => void = (code) => process.exit(code)
): Promise<void> {
	let code: number
	try {
		code = await work()
	} catch (e) {
		process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
		code = 1
	}
	try {
		await close()
	} catch (e) {
		process.stderr.write(
			`warning: could not close the database cleanly — ${e instanceof Error ? e.message : String(e)}\n`
		)
	}
	exit(code)
}
