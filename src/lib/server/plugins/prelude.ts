/**
 * The ambient standard library — the globals a normal TS/Node hook reaches for,
 * provided **identically on both backends** so a hook cannot tell which sandbox
 * it runs in (the parity contract).
 *
 * These are **pure-JS implementations injected into the sandbox program**, never
 * real Node objects endowed across the boundary — endowing the host's `Buffer`
 * or `crypto` would hand the guest live objects whose prototype chains could
 * reach authority (and `Buffer.allocUnsafe` leaks memory). Pure JS has nothing
 * to escape to. They are lexically scoped inside the hook's program, so `new
 * TextEncoder()` resolves to these, while `globalThis` stays bare.
 *
 * Scope of this layer is deliberately the *safe, pure-computation* surface:
 *  - `console.*`      → captured into the run's logs (never real stdout)
 *  - `__fmtLog`       → the other writer to that channel: `ctx.log`'s formatter,
 *                       here rather than in a backend because ONE implementation
 *                       is what makes the two indistinguishable (`__B64` is the
 *                       standing precedent for an internal helper living here)
 *  - `TextEncoder/Decoder`, `atob`/`btoa`, `structuredClone`
 *  - `AbortController` — the cooperative-cancellation half of `ctx.signal`
 *  - `__wrapStorage` → the adapter that turns the mediated storage object into
 *                      the SDK's `ExtensionStorage`, here for the same reason
 *                      `__fmtLog` is: one implementation is what makes the two
 *                      backends indistinguishable
 * Deferred to the capability bridge (which can provide real entropy / IO under
 * a permission check): `crypto`, `fetch`, storage, `Buffer`. In particular
 * `crypto` is withheld rather than seeded — a `getRandomValues` that is secretly
 * deterministic is a foot-gun, so it waits for the bridge's real entropy.
 *
 * The string references `__logs` (the per-call log collector), so it is spliced
 * into the program *after* the ctx/log setup and *before* the plugin bundle.
 * `ctx.log` calls back into `__fmtLog` across that same seam, which is sound for
 * the mirror-image reason: the call sits inside a function body, so the name
 * resolves when a hook logs — long after the whole program has been evaluated.
 */
export const AMBIENT_PRELUDE = String.raw`
// ctx.log's formatter — one implementation, spliced identically into both
// backends, because a hook must not be able to tell them apart by its own logs.
//
// The SDK declares log(level, message, detail?) and both sandboxes endowed
// log(m), keeping the FIRST argument only: ctx.log("warn", "disk full") recorded
// "warn" and dropped the message and the detail, silently. So every argument has
// to reach the channel — and the channel is string[], carried onward by the
// pipeline's chain fold, which is why this composes a line rather than
// structuring one.
//
// Levels are the SDK's LogLevel union, matched by value. Anything else — a
// legacy one-argument call, a level nobody declared — goes out under "[log]"
// with EVERY argument kept: inventing a level would relabel someone's line, and
// dropping the rest would be the same silent loss one call along.
var __LOG_DETAIL_MAX = 2000;
function __isLogLevel(v) {
	return v === "debug" || v === "info" || v === "warn" || v === "error";
}
// A detail is typed unknown: circular, a BigInt, a function, an Error, a getter
// that throws. None of that may throw out of here (a log line must not fail a
// hook) and none of it may vanish — a value with no rendering says so in words.
//
// The renderings JSON has no form for, kept in ONE list because the same list
// answers for the value itself and for anything nested inside it. Returns
// undefined only for a value JSON can carry. Note that {a: undefined} therefore
// renders its key rather than dropping it, which is the point.
function __logPrim(v) {
	if (v === undefined) return "undefined";
	var t = typeof v;
	if (t === "function") return "[function]";
	if (t === "bigint") return String(v) + "n";
	if (t === "symbol") return String(v);
	// JSON writes NaN and the infinities as null, a lie an author debugging a
	// number cannot see through.
	if (t === "number" && !isFinite(v)) return String(v);
	return undefined;
}
function __logSer(v) {
	var out = __logPrim(v);
	if (out === undefined) {
		try {
			// The replacer's this is the object holding val, so unwinding to it
			// drops the branches already finished: only true ancestors are ever
			// compared, and a value merely repeated across siblings still
			// renders in full.
			var stack = [];
			out = JSON.stringify(v, function (k, val) {
				var i = stack.indexOf(this);
				if (i < 0) stack.push(this); else stack.length = i + 1;
				var p = __logPrim(val);
				if (p !== undefined) return p;
				// name + message, never the stack: SES hides stacks from the
				// guest and QuickJS does not, so a stack here would be exactly
				// the tell this formatter exists to remove. Left alone, an Error
				// serializes to "{}" — the whole failure, silently gone.
				if (val instanceof Error) return { name: val.name, message: val.message };
				if (val !== null && typeof val === "object" && stack.indexOf(val) >= 0) return "[circular]";
				return val;
			});
		} catch (e) {}
		// A throwing getter or toJSON lands here. Deliberately one fixed word
		// and not the thrown message: engines word their own failures
		// differently, and a line that named one would be the tell again.
		if (out === undefined) out = "[unserializable]";
	}
	if (out.length > __LOG_DETAIL_MAX)
		out = out.slice(0, __LOG_DETAIL_MAX) + "...(+" + (out.length - __LOG_DETAIL_MAX) + " more chars)";
	return out;
}
function __logRender(v) {
	return typeof v === "string" ? v : __logSer(v);
}
function __fmtLog(args) {
	var n = args.length, i, parts = [];
	if (n > 1 && __isLogLevel(args[0])) {
		// The message reads bare; a detail is a separate VALUE and keeps its
		// quotes and braces, or there is no telling where the message ended.
		parts.push(__logRender(args[1]));
		for (i = 2; i < n; i++) parts.push(__logSer(args[i]));
		return "[" + args[0] + "] " + parts.join(" ");
	}
	for (i = 0; i < n; i++) parts.push(__logRender(args[i]));
	return parts.length ? "[log] " + parts.join(" ") : "[log]";
}
var console = (function () {
	function w() { __logs.push(Array.prototype.map.call(arguments, String).join(" ")); }
	return { log: w, info: w, debug: w, warn: w, error: w, trace: w };
})();
function TextEncoder() {}
TextEncoder.prototype.encode = function (str) {
	str = String(str == null ? "" : str);
	var out = [];
	for (var i = 0; i < str.length; i++) {
		var c = str.charCodeAt(i);
		if (c < 0x80) out.push(c);
		else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
		else if (c >= 0xd800 && c < 0xdc00) {
			var c2 = str.charCodeAt(++i);
			var cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
			out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
		} else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
	}
	return new Uint8Array(out);
};
function TextDecoder() {}
TextDecoder.prototype.decode = function (buf) {
	var b = buf instanceof Uint8Array ? buf : new Uint8Array(buf || []);
	var out = "", i = 0;
	while (i < b.length) {
		var c = b[i++];
		if (c < 0x80) out += String.fromCharCode(c);
		else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
		else if (c < 0xf0) out += String.fromCharCode(((c & 0xf) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
		else {
			var cp = ((c & 0x7) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
			cp -= 0x10000;
			out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
		}
	}
	return out;
};
var __B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function btoa(str) {
	str = String(str);
	var out = "";
	for (var i = 0; i < str.length; ) {
		var a = str.charCodeAt(i++), b = str.charCodeAt(i++), c = str.charCodeAt(i++);
		if (a > 0xff || b > 0xff || c > 0xff) throw new Error("btoa: byte out of range");
		var n = (a << 16) | ((isNaN(b) ? 0 : b) << 8) | (isNaN(c) ? 0 : c);
		out += __B64[(n >> 18) & 63] + __B64[(n >> 12) & 63] + (isNaN(b) ? "=" : __B64[(n >> 6) & 63]) + (isNaN(c) ? "=" : __B64[n & 63]);
	}
	return out;
}
function atob(str) {
	str = String(str).replace(/[^A-Za-z0-9+/]/g, "");
	var out = "", bits = 0, val = 0;
	for (var i = 0; i < str.length; i++) {
		var idx = __B64.indexOf(str.charAt(i));
		if (idx < 0) continue;
		val = (val << 6) | idx;
		bits += 6;
		if (bits >= 8) { bits -= 8; out += String.fromCharCode((val >> bits) & 0xff); }
	}
	return out;
}
function structuredClone(v) {
	if (v === null || typeof v !== "object") return v;
	if (v instanceof Date) return new Date(v.getTime());
	if (v instanceof Uint8Array) return new Uint8Array(v);
	if (Array.isArray(v)) {
		var a = [];
		for (var i = 0; i < v.length; i++) a[i] = structuredClone(v[i]);
		return a;
	}
	var o = {};
	for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = structuredClone(v[k]);
	return o;
}
// A minimal, pure-JS Buffer (Uint8Array-backed) — the common surface real
// pure-JS libraries reach for. No real Node Buffer crosses the boundary;
// allocUnsafe zero-fills (no uninitialized-memory leak, unlike Node's).
var Buffer = (function () {
	function tag(u8) {
		u8.__isBuffer = true;
		u8.toString = function (enc) { return bytesToStr(u8, enc); };
		u8.slice = function (a, b) { return tag(u8.subarray(a, b)); };
		u8.equals = function (o) {
			if (!o || u8.length !== o.length) return false;
			for (var i = 0; i < u8.length; i++) if (u8[i] !== o[i]) return false;
			return true;
		};
		return u8;
	}
	function strToBytes(s, enc) {
		s = String(s); enc = (enc || "utf8").toLowerCase();
		if (enc === "utf8" || enc === "utf-8") return new TextEncoder().encode(s);
		if (enc === "hex") {
			var out = new Uint8Array(Math.floor(s.length / 2));
			for (var i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
			return out;
		}
		if (enc === "base64") {
			var bin = atob(s), b = new Uint8Array(bin.length);
			for (var j = 0; j < bin.length; j++) b[j] = bin.charCodeAt(j);
			return b;
		}
		if (enc === "latin1" || enc === "binary" || enc === "ascii") {
			var a = new Uint8Array(s.length);
			for (var k = 0; k < s.length; k++) a[k] = s.charCodeAt(k) & 0xff;
			return a;
		}
		throw new Error("Buffer: unknown encoding " + enc);
	}
	function bytesToStr(u8, enc) {
		enc = (enc || "utf8").toLowerCase();
		if (enc === "utf8" || enc === "utf-8") return new TextDecoder().decode(u8);
		if (enc === "hex") {
			var h = "";
			for (var i = 0; i < u8.length; i++) { var x = u8[i].toString(16); h += x.length < 2 ? "0" + x : x; }
			return h;
		}
		if (enc === "base64") {
			var s = "";
			for (var j = 0; j < u8.length; j++) s += String.fromCharCode(u8[j]);
			return btoa(s);
		}
		if (enc === "latin1" || enc === "binary" || enc === "ascii") {
			var r = "";
			for (var k = 0; k < u8.length; k++) r += String.fromCharCode(u8[k]);
			return r;
		}
		throw new Error("Buffer: unknown encoding " + enc);
	}
	return {
		from: function (v, enc) {
			if (typeof v === "string") return tag(strToBytes(v, enc));
			if (v instanceof Uint8Array || Array.isArray(v)) return tag(new Uint8Array(v));
			if (v && typeof v.length === "number") return tag(new Uint8Array(v));
			throw new Error("Buffer.from: unsupported input");
		},
		alloc: function (n, fill) {
			var u = new Uint8Array(n);
			if (typeof fill === "number") for (var i = 0; i < n; i++) u[i] = fill;
			return tag(u);
		},
		allocUnsafe: function (n) { return tag(new Uint8Array(n)); },
		isBuffer: function (x) { return !!(x && x.__isBuffer); },
		byteLength: function (s, enc) { return strToBytes(s, enc).length; },
		concat: function (list) {
			var len = 0, i;
			for (i = 0; i < list.length; i++) len += list[i].length;
			var out = new Uint8Array(len), off = 0;
			for (i = 0; i < list.length; i++) { out.set(list[i], off); off += list[i].length; }
			return tag(out);
		}
	};
})();
// Real randomness, bridged from the worker (never seeded — safe for ids/nonces).
var crypto = (typeof __crypto !== "undefined") ? {
	randomUUID: function () { return __crypto.randomUUID(); },
	randomBytes: function (n) { return Buffer.from(__crypto.randomBytes(n)); },
	getRandomValues: function (arr) {
		var b = __crypto.randomBytes(arr.length);
		for (var i = 0; i < arr.length; i++) arr[i] = b[i];
		return arr;
	}
} : undefined;
// Cooperative cancellation, in pure JS for the same reason as everything else
// here: an AbortSignal is not structured-cloneable, and a host one endowed into
// the guest would be a live host object. So the controller is built *inside*
// the sandbox and the host only ever fires it (see each backend's program
// preamble, which registers the fire callback before the plugin bundle runs).
// Standard shape on purpose — an author's habits transfer, and a hook cannot
// tell the two backends apart by it.
var AbortController = (function () {
	function abortError() {
		var e = new Error("This operation was aborted");
		e.name = "AbortError";
		return e;
	}
	function Signal() {
		this.aborted = false;
		this.reason = undefined;
		this.onabort = null;
		this.__listeners = [];
	}
	Signal.prototype.addEventListener = function (type, fn) {
		if (type === "abort" && typeof fn === "function") this.__listeners.push(fn);
	};
	Signal.prototype.removeEventListener = function (type, fn) {
		if (type !== "abort") return;
		var i = this.__listeners.indexOf(fn);
		if (i >= 0) this.__listeners.splice(i, 1);
	};
	Signal.prototype.throwIfAborted = function () {
		if (this.aborted) throw this.reason;
	};
	function Controller() {
		this.signal = new Signal();
	}
	Controller.prototype.abort = function (reason) {
		var s = this.signal;
		if (s.aborted) return;
		s.aborted = true;
		s.reason = reason === undefined ? abortError() : reason;
		// A snapshot, and the list is emptied first: a listener that aborts again,
		// or registers another, must not re-enter or extend this dispatch. A
		// throwing listener does not stop the rest, as in the DOM.
		var ls = s.__listeners.slice();
		s.__listeners.length = 0;
		var ev = { type: "abort", target: s };
		if (typeof s.onabort === "function") { try { s.onabort(ev); } catch (e) {} }
		for (var i = 0; i < ls.length; i++) { try { ls[i](ev); } catch (e) {} }
	};
	return Controller;
})();

// ── ctx.storage: the SDK's shape over the mediated storage object ──────────
//
// The SDK declares ExtensionStorage (sdk/src/storage.ts) as promise-returning,
// with file bytes as Uint8Array. The object each backend hands in is
// synchronous and carries bytes as base64 — synchronous because a QuickJS guest
// has no async capability bridge to the host that holds the database (see
// storageHost.ts, which explains why rows arrive as a snapshot), base64 because
// a typed array cannot cross the QuickJS bridge. This adapter is the whole of
// that difference, and it lives here rather than in either backend for the same
// reason __fmtLog does: one implementation is what makes the two
// indistinguishable.
//
// The six older file methods (read/write/exists/remove/list/size) pass through
// UNCHANGED and stay synchronous. Hooks already call ctx.storage.write(...)
// without awaiting; handing them a promise would silently break every one.
function __spCall(recv, fn, args) {
	// A refusal is a rejected promise, never a synchronous throw — a method
	// typed as returning a promise that sometimes throws instead is a footgun
	// in the one place an author cannot see it. (A quota refusal is neither:
	// it resolves with err, which is what the SDK's docblock promises.)
	try {
		return Promise.resolve(fn.apply(recv, args));
	} catch (e) {
		return Promise.reject(e);
	}
}
function __b64ToBytes(b64) {
	// A plain Uint8Array, not the Buffer shim's tagged view: the SDK says
	// Uint8Array, and an author who feature-tests .toString should not find
	// one that was never promised.
	return new Uint8Array(Buffer.from(String(b64 == null ? "" : b64), "base64"));
}
function __bytesToB64(bytes) {
	if (typeof bytes === "string") return Buffer.from(bytes, "utf8").toString("base64");
	return Buffer.from(bytes == null ? [] : bytes).toString("base64");
}
function __wrapStorage(host) {
	if (!host || typeof host !== "object") return host;
	// Absent only for a stub that predates files; the denied stub carries it
	// like the real store does, so a plugin without the grant is refused by
	// name rather than by "is not a function".
	var files = host.files || {};
	return {
		usage: function () { return __spCall(host, host.usage, []); },
		get: function (k) { return __spCall(host, host.get, [k]); },
		keys: function (p) { return __spCall(host, host.keys, [p]); },
		query: function (q) { return __spCall(host, host.query, [q]); },
		put: function (k, v) { return __spCall(host, host.put, [k, v]); },
		delete: function (k) { return __spCall(host, host.delete, [k]); },
		deleteAll: function (p) { return __spCall(host, host.deleteAll, [p]); },
		files: {
			list: function (p) { return __spCall(files, files.list, [p]); },
			stat: function (p) { return __spCall(files, files.stat, [p]); },
			read: function (p) {
				return __spCall(files, files.read, [p]).then(function (r) {
					return r && r.kind === "ok"
						? { kind: "ok", value: __b64ToBytes(r.value) }
						: r;
				});
			},
			write: function (p, bytes) {
				// The encode is inside the guarded call so a bad argument
				// rejects like every other refusal instead of throwing here.
				return __spCall(files, function () {
					return files.write(p, __bytesToB64(bytes));
				}, []);
			},
			delete: function (p) { return __spCall(files, files.delete, [p]); },
			deleteAll: function (p) { return __spCall(files, files.deleteAll, [p]); }
		},
		read: function (p) { return host.read(p); },
		write: function (p, d) { return host.write(p, d); },
		exists: function (p) { return host.exists(p); },
		remove: function (p) { return host.remove(p); },
		list: function (p) { return host.list(p); },
		size: function () { return host.size(); }
	};
}
`
