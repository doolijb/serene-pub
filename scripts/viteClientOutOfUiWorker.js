// scripts/viteClientOutOfUiWorker.js
//
// Keep Vite's HMR client out of the UI worker in dev.
//
// The UI worker (§3.5, C2) runs remote components under its own CSP,
// `connect-src 'none'`, so nothing inside it can reach the network. In dev,
// Vite's import analysis rewrites the worker's one non-literal dynamic
// `import(entry)` into `import(__vite__injectQuery(entry, 'import'))`, and
// takes that helper from `/@vite/client` with a static import. That module
// opens Vite's HMR websocket as soon as it is evaluated, and the worker's CSP
// blocks it:
//
//   Connecting to 'ws://localhost:5173/?token=…' violates the following
//   Content Security Policy directive: "connect-src 'none'".
//
// The CSP is right and stays as it is. The worker never had a use for the HMR
// socket (a worker cannot hot-swap a module), only for the ten-line helper. So
// this plugin removes that one import from the worker entry and defines the
// helper inline, the same way Vite handles a classic worker. Only the worker
// entry is touched, so the page keeps its own HMR client.
//
// Dev only (`apply: "serve"`). A build never runs import analysis, so the
// shipped worker has no helper and no client at all.
//
// Side-effect free: importing this module only defines the plugin.

/** The exact statement Vite 6 prepends for the helper (`importAnalysis`). */
const HELPER_IMPORT = 'import { injectQuery as __vite__injectQuery } from "/@vite/client";'

/**
 * Vite's own `injectQuery` from `/@vite/client`, which its import analysis
 * appends to a classic worker for the same reason. Appended rather than put
 * where the import was: a function declaration is hoisted, so the position
 * does not matter, and nothing before it moves.
 */
const INLINE_HELPER = `
function __vite__injectQuery(url, queryToInject) {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return \`\${pathname}?\${queryToInject}\${search ? "&" + search.slice(1) : ""}\${hash || ""}\`;
}
`

/** Vite's marker for a module worker's entry (`?worker_file&type=module`). */
const MODULE_WORKER_FILE = /[?&]worker_file&type=module(?:&|$)/

/**
 * `code` without its `/@vite/client` helper import, or `null` when it has
 * none. The import becomes spaces of the same length, so every column after
 * it keeps its place and the source map from earlier transforms stays exact.
 *
 * @param {string} code
 * @returns {string | null}
 */
export function withoutViteClientHelper(code) {
	const at = code.indexOf(HELPER_IMPORT)
	if (at === -1) return null
	return (
		code.slice(0, at) +
		" ".repeat(HELPER_IMPORT.length) +
		code.slice(at + HELPER_IMPORT.length) +
		INLINE_HELPER
	)
}

/** Does this code still import Vite's client, in any form? */
export function importsViteClient(/** @type {string} */ code) {
	return /from\s*["']\/@vite\/client["']|import\s*["']\/@vite\/client["']/.test(code)
}

/**
 * The Vite plugin. `entry` is the UI worker entry's absolute path.
 *
 * @param {string} entry
 * @returns {import("vite").Plugin}
 */
export function keepViteClientOutOfUiWorker(entry) {
	return {
		name: "serene-pub-ui-worker-without-vite-client",
		apply: "serve",
		transform: {
			// After Vite's import analysis, which adds the import: a hook
			// ordered "post" runs after every normal-ordered one, Vite's
			// internal ones included.
			order: "post",
			handler(code, id) {
				const q = id.indexOf("?")
				if (q === -1 || id.slice(0, q) !== entry) return null
				if (!MODULE_WORKER_FILE.test(id.slice(q))) return null
				const out = withoutViteClientHelper(code) ?? code
				if (importsViteClient(out))
					this.warn(
						"the UI worker entry still imports /@vite/client, so its CSP " +
							"(connect-src 'none') will block Vite's HMR socket. Vite's import " +
							"analysis changed shape; see scripts/viteClientOutOfUiWorker.js."
					)
				return out === code ? null : { code: out, map: null }
			}
		}
	}
}
