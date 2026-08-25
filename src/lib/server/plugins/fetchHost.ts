/**
 * The mediated network capability — a permission-checked `fetch`.
 *
 * `makeFetchHost(hosts)` runs in the **worker's Node scope**, outside the
 * sandbox; the guest gets an async `ctx.fetch(url, opts?)` that only reaches
 * hosts the plugin declared *and* an admin left granted. Enforced here, not in
 * the guest:
 *  - **Host allowlist:** the URL's host must be in `hosts`; anything else throws.
 *  - **Scheme:** http/https only.
 *  - **Response is flattened to a plain object** ({status, ok, headers, body})
 *    so nothing live (a stream, the real Response) crosses the boundary.
 *
 * Async by nature — network cannot be synchronous — so this is a **SES-only**
 * capability: QuickJS's asyncify cannot resolve the JS promise an awaited fetch
 * returns, so a plugin declaring `network` runs on the SES backend (the same
 * backend-support rule as WebAssembly). Embedded as a source string because the
 * eval workers cannot import modules; the unit test evaluates this very string.
 */
export const FETCH_HOST_SOURCE = String.raw`
function makeFetchHost(hosts) {
	var allow = Array.isArray(hosts) ? hosts : [];
	return async function (url, optsJson) {
		var u;
		try { u = new URL(String(url)); } catch (e) { throw new Error("fetch: invalid URL"); }
		if (u.protocol !== "http:" && u.protocol !== "https:")
			throw new Error("fetch: only http(s) is allowed");
		if (allow.indexOf(u.host) < 0 && allow.indexOf(u.hostname) < 0)
			throw new Error("fetch: host not permitted: " + u.host);
		var opts = {};
		if (optsJson) { try { opts = JSON.parse(optsJson) || {}; } catch (e) {} }
		var res = await fetch(u.toString(), {
			method: opts.method || "GET",
			headers: opts.headers || {},
			body: opts.body != null ? String(opts.body) : undefined,
			redirect: "follow"
		});
		var body = await res.text();
		var headers = {};
		res.headers.forEach(function (v, k) { headers[k] = v; });
		return { status: res.status, ok: res.ok, headers: headers, body: body };
	};
}
`
