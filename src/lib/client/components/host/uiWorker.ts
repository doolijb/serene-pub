/**
 * The page's UI worker (§3.5, C2): one per owner (core, or one plugin) per
 * session page. It runs that owner's components against a minimal DOM
 * (Remote DOM's polyfill) and sends what they render to the page, which
 * mirrors it through the host-element allowlist.
 *
 * Started from the `/ui-worker` route, whose response carries this worker's
 * own CSP — `script-src 'self'; connect-src 'none'` — so neither `fetch` nor
 * a dynamic `import()` reaches outside the app. `lockDownWorker` removes the
 * network and storage globals
 * too, before any component loads: the CSP is the wall, this is
 * the belt, and the component's only path to data is its mount's port.
 *
 * Everything else — the DOM polyfill, event forwarding, control values,
 * mounts — is the shared worker runtime
 * (`@serene-pub/component-client/worker-runtime`), the same one the
 * component harness runs, so a component that passes its tests behaves
 * the same here.
 */

import { lockDownWorker, startComponentWorker } from "@serene-pub/component-client/worker-runtime"
import type { HostToWorker } from "@serene-pub/sdk"

// No network, no shared storage, no second global — before any component loads.
lockDownWorker()

const handle = startComponentWorker({
	post: (m) => (self as unknown as Worker).postMessage(m),
	// Same-origin only: the route's CSP refuses anything else.
	importModule: (entry) => import(/* @vite-ignore */ entry)
})
self.onmessage = (e: MessageEvent<HostToWorker>) => handle(e.data)
