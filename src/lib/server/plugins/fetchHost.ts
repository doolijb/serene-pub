/**
 * The mediated network permission — a permission-checked `fetch`.
 *
 * `makeFetchHost(hosts, isCancelled)` runs in the **worker's Node scope**,
 * outside the sandbox; the guest gets an async `ctx.fetch(url, opts?)` that only
 * reaches hosts the plugin declared *and* an admin left granted. Enforced here,
 * not in the guest:
 *  - **Host allowlist:** the URL's host must match an entry in `hosts`. An entry
 *    is an exact host (`api.example.com`), a wildcard (`*.example.com` matches
 *    any sub-domain but not the apex; a bare `*` matches any host), and may pin a
 *    `host:port`. Anything unmatched throws.
 *  - **Port scoping:** a `host:port` entry binds the request to that port; a bare
 *    host or wildcard entry allows only the default web ports (80/443), so a grant
 *    for one service can't reach a co-located Redis/admin port. The exception is a
 *    bare **IP literal or `localhost`** entry — a deliberate internal grant — which
 *    allows any port.
 *  - **Scheme:** http/https only.
 *  - **No SSRF to internal targets.** The host is resolved and rejected if it
 *    lands on a loopback / private / link-local / ULA / reserved address — the
 *    169.254.169.254 metadata endpoint, 127.0.0.1, 10./172.16./192.168., etc. A
 *    domain (or wildcard) that resolves internally is a rebinding attack and is
 *    refused; the only way to reach an internal target is for an admin to
 *    allowlist the **IP literal or `localhost`** itself (a deliberate, visible
 *    grant — never a domain or `*` that merely happens to resolve inward).
 *  - **Redirects are followed manually and re-validated at every hop** — the
 *    allowlist, port scope and the internal-address check run again on each
 *    `Location`, so an allowlisted host cannot bounce the request to a forbidden
 *    one (the classic redirect-to-metadata SSRF). Cross-origin hops drop request
 *    headers and the body, and are capped.
 *  - **Response is flattened to a plain object** ({status, ok, headers, body})
 *    so nothing live (a stream, the real Response) crosses the boundary.
 *  - **No new requests once the call is aborted.** `isCancelled()` is the
 *    backend's per-call view of `ctx.signal`, and a request started after it
 *    fires — including the next hop of a redirect chain — is refused. Without
 *    this, declaring an abort handler would be a way to keep working for the
 *    whole cancellation grace (`hookGrace.ts`) after the person said stop. It is
 *    deliberately *only* the outbound permission: storage stays permitted after
 *    an abort, because winding down local data is what the grace is for.
 *
 * Residual: a determined DNS-rebind that flips the record between this check and
 * undici's own connect is not fully closed here (that needs a pinned dispatcher);
 * the resolved-address gate blocks the static-internal-IP and redirect vectors,
 * which are the practical ones.
 *
 * Async by nature — network cannot be synchronous — which is why this was a
 * SES-only permission for as long as QuickJS had no way to answer a guest with a
 * promise. It does now: the QuickJS backend creates the guest's promise itself
 * (`context.newPromise`), keeps the resolvers host-side, and settles them from
 * this same function while its drive loop pumps the job queue (see
 * `QuickJsSandbox.ts`'s `bridgeFetch`). So `network` is a permission of **both**
 * backends, running the one source below on each — the allowlist, the port
 * scope, the internal-address gate, the per-hop re-validation and the
 * cancellation refusal are literally the same code, and cannot drift.
 *
 * Embedded as a source string because the eval workers cannot import modules;
 * the unit test evaluates this very string.
 */

/**
 * The host-allow decision, shared by the fetch host and its unit test so the
 * wildcard + port-scoping rules have exactly one source of truth. Pure and
 * dependency-free: given the allowlist and a request `(host, port)`, returns the
 * matched allowlist **entry host** (so the caller can tell a deliberate internal
 * grant — a bare IP/`localhost` entry — from a domain/wildcard) or `null` when
 * nothing matches. Embedded as a string because the eval workers cannot import
 * modules.
 */
import { pluginRuleRef } from "@serene-pub/sdk"

export const HOST_ALLOW_SOURCE = String.raw`
function isIpLiteral(h) {
	return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.indexOf(":") >= 0;
}
function matchAllow(allow, reqHost, reqPort) {
	reqHost = String(reqHost).toLowerCase();
	for (var i = 0; i < allow.length; i++) {
		var raw = String(allow[i]).toLowerCase();
		if (!raw) continue;
		var entryHost = raw, entryPort = null;
		// A trailing ":<digits>" is a port; skip the split for IPv6 (which has
		// its own colons) so "::1" is not mis-parsed as host ":" + port "1".
		var ci = raw.lastIndexOf(":");
		if (ci > 0 && /^\d+$/.test(raw.slice(ci + 1)) && raw.slice(0, ci).indexOf(":") < 0) {
			entryHost = raw.slice(0, ci);
			entryPort = Number(raw.slice(ci + 1));
		}
		var hostOk;
		if (entryHost === "*") hostOk = true;
		else if (entryHost.indexOf("*.") === 0) {
			// "*.example.com" -> matches any sub-domain (host ends with
			// ".example.com"), but NOT the apex "example.com".
			var suffix = entryHost.slice(1);
			hostOk = reqHost.length > suffix.length && reqHost.slice(-suffix.length) === suffix;
		} else hostOk = reqHost === entryHost;
		if (!hostOk) continue;
		if (entryPort !== null) {
			if (reqPort === entryPort) return entryHost;
		} else if (entryHost === "localhost" || isIpLiteral(entryHost)) {
			// A deliberate internal grant — any port on that literal target.
			return entryHost;
		} else if (reqPort === 80 || reqPort === 443) {
			// A bare host/wildcard grant reaches only the default web ports.
			return entryHost;
		}
	}
	return null;
}
`

export const FETCH_HOST_SOURCE =
	HOST_ALLOW_SOURCE +
	String.raw`
function makeFetchHost(hosts, isCancelled, secrets) {
	var allow = Array.isArray(hosts) ? hosts : [];
	// Secret handles (R63): plugin code holds "⟦secret:<key>:<nonce>⟧", never a
	// value. The nonce is minted per plugin load and known only to the host,
	// so a handle cannot be forged from text that came from anywhere else — a
	// prompt, a tool argument, another package's input. Filled in here, at the
	// network boundary, only after the request's host has passed the
	// allowlist, and only for the keys this call may use (a node running in
	// another package's pipeline gets the ones its owner lends, no more).
	var bag = secrets && typeof secrets === "object" ? secrets : {};
	var secretMap = bag.values && typeof bag.values === "object" ? bag.values : {};
	var nonce = typeof bag.nonce === "string" ? bag.nonce : "";
	var OPEN = "\u27E6secret:", CLOSE = "\u27E7";
	var HANDLE = /\u27E6secret:([A-Za-z0-9_.-]+):([0-9a-f]+)\u27E7/g;
	// The same handle as a URL spells it: its two brackets percent-encoded.
	var HANDLE_IN_URL = /%E2%9F%A6secret:([A-Za-z0-9_.-]+):([0-9a-f]+)%E2%9F%A7/gi;
	function hasHandle(text) {
		return typeof text === "string" && (text.indexOf(OPEN) >= 0 || /%E2%9F%A6secret:/i.test(text));
	}
	function valueFor(key, n) {
		if (!nonce || n !== nonce)
			throw new Error("fetch: that is not a secret handle this plugin was given${pluginRuleRef("secrets")}");
		if (!Object.prototype.hasOwnProperty.call(secretMap, key))
			throw new Error("fetch: the secret '" + key + "' is not available to this call${pluginRuleRef("secrets")}");
		return String(secretMap[key]);
	}
	function fill(text) {
		if (typeof text !== "string" || !hasHandle(text)) return text;
		return text.replace(HANDLE, function (_, key, n) { return valueFor(key, n); });
	}
	// A value in a URL is percent-encoded, so its own "/", "?", "#" or "%"
	// cannot reshape the request; nothing else in the URL is decoded or touched.
	function fillUrl(href) {
		if (!hasHandle(href)) return href;
		return href
			.replace(HANDLE_IN_URL, function (_, key, n) { return encodeURIComponent(valueFor(key, n)); })
			.replace(HANDLE, function (_, key, n) { return encodeURIComponent(valueFor(key, n)); });
	}
	// Every form a value can take on the way back — as sent in a header or
	// body, and as a URL spells it — masked back to its handle, so neither a
	// response that echoes a key nor an error message quoting the request can
	// hand the plugin the value.
	var echoes = [];
	Object.keys(secretMap).forEach(function (k) {
		var v = String(secretMap[k]);
		var handle = OPEN + k + ":" + nonce + CLOSE;
		if (v.length >= 4) {
			echoes.push([v, handle]);
			var enc = encodeURIComponent(v);
			if (enc !== v) echoes.push([enc, handle]);
		}
	});
	echoes.sort(function (a, b) { return b[0].length - a[0].length; });
	function mask(text) {
		if (typeof text !== "string" || !echoes.length) return text;
		for (var i = 0; i < echoes.length; i++) text = text.split(echoes[i][0]).join(echoes[i][1]);
		return text;
	}
	// A header value the Fetch standard would refuse, refused here first and
	// in words that quote nothing — the runtime's own error quotes the value.
	function assertHeaderValue(name, value) {
		if (/[\r\n\0]/.test(value)) throw new Error("fetch: the header '" + name + "' has a line break or a NUL in it");
	}
	// Whether this call's ctx.signal has already fired. The gate lives here,
	// with the permission, rather than in a backend — which is exactly what let
	// it travel unchanged when the second backend gained fetch. Each host passes
	// its own view of the abort: SES a per-job flag, QuickJS the STOP_ABORT bit.
	var cancelled = typeof isCancelled === "function" ? isCancelled : function () { return false; };

	function isPrivateV4(ip) {
		var p = ip.split(".");
		if (p.length !== 4) return false;
		var n = p.map(function (x) { return Number(x); });
		if (n.some(function (x) { return !Number.isInteger(x) || x < 0 || x > 255; })) return false;
		var a = n[0], b = n[1];
		return (
			a === 0 || a === 127 ||                         // this-host, loopback
			a === 10 ||                                     // private
			(a === 172 && b >= 16 && b <= 31) ||            // private
			(a === 192 && b === 168) ||                     // private
			(a === 169 && b === 254) ||                     // link-local (incl. metadata)
			(a === 100 && b >= 64 && b <= 127) ||           // CGNAT
			(a === 192 && b === 0 && n[2] === 0) ||         // IETF protocol assignments
			(a === 198 && (b === 18 || b === 19)) ||        // benchmarking
			a >= 224                                        // multicast + reserved
		);
	}
	function isPrivateV6(ip) {
		var s = String(ip).toLowerCase().split("%")[0];
		if (s === "::1" || s === "::") return true;         // loopback, unspecified
		if (s.indexOf("::ffff:") === 0 && s.indexOf(".") >= 0)
			return isPrivateV4(s.slice(s.lastIndexOf(":") + 1)); // IPv4-mapped
		if (/^f[cd]/.test(s)) return true;                  // unique-local fc00::/7
		if (/^fe[89ab]/.test(s)) return true;               // link-local fe80::/10
		return false;
	}
	function isPrivateAddr(ip) {
		return ip.indexOf(":") >= 0 ? isPrivateV6(ip) : isPrivateV4(ip);
	}

	async function assertReachable(u) {
		if (u.protocol !== "http:" && u.protocol !== "https:")
			throw new Error("fetch: only http(s) is allowed");
		var reqHost = u.hostname.replace(/^\[|\]$/g, "");
		var reqPort = u.port ? Number(u.port) : (u.protocol === "https:" ? 443 : 80);
		var entry = matchAllow(allow, reqHost, reqPort);
		if (entry === null)
			throw new Error("fetch: host not permitted: " + u.host + "${pluginRuleRef("kind-oracle")}");

		var addrs;
		if (isIpLiteral(reqHost)) addrs = [reqHost];
		else {
			try {
				var looked = await require("dns").promises.lookup(reqHost, { all: true });
				addrs = looked.map(function (x) { return x.address; });
			} catch (e) {
				throw new Error("fetch: host did not resolve");
			}
		}
		var internal = addrs.some(isPrivateAddr);
		// An internal target is reachable only when the admin named THAT target
		// literally (a bare IP or "localhost"); a domain or wildcard entry — even
		// one that resolves inward — is a rebinding attempt and is refused.
		var explicit = entry === "localhost" || isIpLiteral(entry);
		if (internal && !explicit)
			throw new Error("fetch: host resolves to a private address");
	}

	return async function (url, optsJson) {
		var opts = {};
		if (optsJson) { try { opts = JSON.parse(optsJson) || {}; } catch (e) {} }
		var current;
		try { current = new URL(String(url)); } catch (e) { throw new Error("fetch: invalid URL"); }
		// A handle in the host or the userinfo would let a key choose where it
		// is sent, or ride in a part the runtime quotes back in its errors.
		if (hasHandle(current.hostname)) throw new Error("fetch: a secret cannot name the host${pluginRuleRef("secrets")}");
		// Any piece of a handle there — the user part splits one at its colon.
		var inUserPart = /\u27E6|%E2%9F%A6/i;
		if (inUserPart.test(current.username) || inUserPart.test(current.password))
			throw new Error("fetch: a secret cannot ride in the URL's user part — send it in a header${pluginRuleRef("secrets")}");

		var method = opts.method || "GET";
		var headers = opts.headers || {};
		var body = opts.body != null ? String(opts.body) : undefined;
		var maxHops = 5;
		// Filled in once the first host has passed (below), never before.
		var filled = false;

		for (var hop = 0; ; hop++) {
			// Checked per hop, not once: a redirect is another outbound request,
			// and one that started before the abort must not carry on chasing
			// Location headers after it.
			if (cancelled())
				throw new Error("fetch: the run was cancelled — no new requests");
			await assertReachable(current);
			var res;
			// From the fill to the response, every error is masked: a message
			// that quotes the request would otherwise quote the key.
			try {
				if (!filled) {
					filled = true;
					var href = current.toString();
					var target = hasHandle(href) ? new URL(fillUrl(href)) : current;
					if (target.host !== current.host) throw new Error("fetch: a secret cannot change the host${pluginRuleRef("secrets")}");
					current = target;
					var outHeadersReq = {};
					for (var hk in headers)
						if (Object.prototype.hasOwnProperty.call(headers, hk)) {
							var hv = fill(String(headers[hk]));
							assertHeaderValue(hk, hv);
							outHeadersReq[hk] = hv;
						}
					headers = outHeadersReq;
					body = fill(body);
				}
				res = await fetch(current.toString(), {
					method: method,
					headers: headers,
					body: body,
					redirect: "manual"
				});
			} catch (e) {
				throw new Error(mask(String((e && e.message) || e)));
			}
			var location = res.status >= 300 && res.status < 400
				? res.headers.get("location")
				: null;
			if (location) {
				if (hop >= maxHops) throw new Error("fetch: too many redirects");
				var next;
				try { next = new URL(location, current); } catch (e) {
					throw new Error("fetch: bad redirect location");
				}
				// Follow as a bodyless GET; drop headers when the origin changes
				// so a set Authorization never rides to a different host.
				var crossOrigin = next.origin !== current.origin;
				current = next;
				method = "GET";
				body = undefined;
				if (crossOrigin) headers = {};
				continue;
			}
			var text = mask(await res.text());
			var outHeaders = {};
			res.headers.forEach(function (v, k) { outHeaders[k] = mask(v); });
			return { status: res.status, ok: res.ok, headers: outHeaders, body: text };
		}
	};
}
// The refusal a plugin without the permission hears — one definition, spliced
// into both backends, because a hook must not be able to tell them apart by the
// wording of a denial. It throws rather than resolving to a response, so a
// denial can never be mistaken for a request that failed.
var __DENIED_FETCH = function () { throw new Error("network: permission not granted${pluginRuleRef("kind-oracle")}"); };
// The permission a backend should endow, from the grants it was loaded with.
//
// An allowlist with nothing in it is NOT a grant with nothing in it: it is what
// an admin who denied every 'network:<host>' key leaves behind, and such a
// plugin must hear "permission not granted" — the named refusal — rather than
// "host not permitted", which would confirm it holds the permission and merely
// aimed badly. SandboxManager.permissionConfig already drops the whole grant in
// that case; this keeps the same answer true one layer down, for any caller that
// hands a sandbox an empty allowlist directly.
function fetchHostFor(config, isCancelled, secrets) {
	var hosts = config && config.networkHosts;
	return Array.isArray(hosts) && hosts.length
		? makeFetchHost(hosts, isCancelled, secrets)
		: __DENIED_FETCH;
}
`
