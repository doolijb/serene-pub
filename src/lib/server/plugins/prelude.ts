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
 *  - `TextEncoder/Decoder`, `atob`/`btoa`, `structuredClone`
 * Deferred to the capability bridge (which can provide real entropy / IO under
 * a permission check): `crypto`, `fetch`, storage, `Buffer`. In particular
 * `crypto` is withheld rather than seeded — a `getRandomValues` that is secretly
 * deterministic is a foot-gun, so it waits for the bridge's real entropy.
 *
 * The string references `__logs` (the per-call log collector), so it is spliced
 * into the program *after* the ctx/log setup and *before* the plugin bundle.
 */
export const AMBIENT_PRELUDE = String.raw`
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
`
