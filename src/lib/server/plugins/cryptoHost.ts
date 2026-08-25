/**
 * Real randomness for the sandbox — `crypto.randomUUID` / `randomBytes` /
 * `getRandomValues`, backed by the worker's Node `crypto`.
 *
 * Unlike the seeded `ctx.random` (deterministic, for replayable rolls), this is
 * genuine OS entropy, so it is safe for ids, nonces, and tokens — which is why
 * it is *not* seeded (a `getRandomValues` that is secretly deterministic is the
 * foot-gun the ambient prelude deliberately avoided). It is a benign capability
 * (random bytes carry no authority and read no data), so it is always granted —
 * no permission, no config — but it still runs host-side and is bridged in,
 * never exposing Node's `crypto` object itself.
 *
 * Embedded as a source string because the eval workers cannot import modules;
 * the unit test evaluates this very string.
 */
export const CRYPTO_HOST_SOURCE = String.raw`
function makeCryptoHost() {
	var nc = require("crypto");
	return {
		randomBytes: function (n) {
			n = Math.max(0, Math.min(65536, n | 0));
			var buf = nc.randomBytes(n);
			var out = new Array(n);
			for (var i = 0; i < n; i++) out[i] = buf[i];
			return out;
		},
		randomUUID: function () { return nc.randomUUID(); }
	};
}
`
