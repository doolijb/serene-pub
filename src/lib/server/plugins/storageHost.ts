/**
 * The scoped storage capability — a random-access-ish file store the sandbox
 * reaches through a permission-checked, mediated surface.
 *
 * `makeStorageHost(config)` runs in the **worker's Node scope**, outside the
 * sandbox — the guest never sees `fs`, only the returned object's methods,
 * endowed (SES) or bridged (QuickJS) in. Two guarantees enforced here, not in
 * the guest:
 *  - **Jail:** every path resolves under `config.storageDir`; `..`/absolute/
 *    symlink escapes throw. The store is inert data — SP never executes it.
 *  - **Quota:** a write that would push the directory past `config.quotaBytes`
 *    throws, so a plugin cannot fill the disk.
 *
 * Sync on purpose (the localStorage shape): the worker runs one hook at a time,
 * so `readFileSync`/`writeFileSync` blocking that hook's own worker is fine, and
 * it keeps hooks synchronous and identical across both backends. Writes are
 * atomic (temp + rename). Kept as an embeddable source string because the eval
 * workers cannot import modules; the unit test evaluates this very string.
 */
export const STORAGE_HOST_SOURCE = String.raw`
function makeStorageHost(config) {
	var fs = require("fs");
	var path = require("path");
	var root = config && config.storageDir;
	var quota = (config && config.quotaBytes) || 10 * 1024 * 1024;
	function ensureRoot() {
		if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
	}
	function resolve(rel) {
		if (typeof rel !== "string" || rel.length === 0)
			throw new Error("storage: a path is required");
		var full = path.resolve(root, rel);
		var real = full;
		try { real = fs.realpathSync(path.dirname(full)) + path.sep + path.basename(full); } catch (e) {}
		var withSep = root.endsWith(path.sep) ? root : root + path.sep;
		if (full !== root && full.indexOf(withSep) !== 0)
			throw new Error("storage: path escapes the extension directory");
		if (real !== root && real.indexOf(withSep) !== 0)
			throw new Error("storage: path escapes the extension directory (symlink)");
		return full;
	}
	function dirSize(dir) {
		var total = 0;
		if (!fs.existsSync(dir)) return 0;
		var entries = fs.readdirSync(dir, { withFileTypes: true });
		for (var i = 0; i < entries.length; i++) {
			var e = entries[i];
			var fp = path.join(dir, e.name);
			if (e.isDirectory()) total += dirSize(fp);
			else { try { total += fs.statSync(fp).size; } catch (x) {} }
		}
		return total;
	}
	// A raw Node fs error leaks the absolute host path (and so the OS username,
	// install layout and plugin id) in its .message — which crosses to the guest
	// verbatim on both backends. Re-throw a code-only message so a failing op
	// tells the plugin *what* failed, never *where*. The jail's own throws carry
	// no .code, so they (and their safe, path-free text) pass straight through.
	function guard(fn) {
		try {
			return fn();
		} catch (e) {
			if (e && e.code) {
				var m = {
					ENOENT: "not found",
					ENOTDIR: "not a directory",
					EISDIR: "is a directory",
					EEXIST: "already exists",
					EACCES: "permission denied",
					EPERM: "operation not permitted",
					ENOSPC: "no space left"
				};
				throw new Error("storage: " + (m[e.code] || "io error"));
			}
			throw e;
		}
	}
	return {
		read: function (rel) {
			return guard(function () {
				var full = resolve(rel);
				if (!fs.existsSync(full)) return null;
				return fs.readFileSync(full, "utf8");
			});
		},
		write: function (rel, data) {
			return guard(function () {
				ensureRoot();
				var full = resolve(rel);
				var str = String(data == null ? "" : data);
				var incoming = Buffer.byteLength(str, "utf8");
				var existing = fs.existsSync(full) ? fs.statSync(full).size : 0;
				if (dirSize(root) - existing + incoming > quota)
					throw new Error("storage: quota exceeded");
				fs.mkdirSync(path.dirname(full), { recursive: true });
				var tmp = full + ".tmp-" + process.pid + "-" + Math.floor(Math.random() * 1e9);
				fs.writeFileSync(tmp, str, "utf8");
				fs.renameSync(tmp, full);
				return true;
			});
		},
		exists: function (rel) {
			return guard(function () {
				return fs.existsSync(resolve(rel));
			});
		},
		remove: function (rel) {
			return guard(function () {
				var full = resolve(rel);
				if (fs.existsSync(full)) fs.rmSync(full, { recursive: true, force: true });
				return true;
			});
		},
		list: function (rel) {
			return guard(function () {
				var dir = rel ? resolve(rel) : root;
				if (!fs.existsSync(dir)) return [];
				return fs.readdirSync(dir);
			});
		},
		size: function () {
			return guard(function () {
				return dirSize(root);
			});
		}
	};
}
`

/** The per-plugin capability grants the runtime passes at load. Each field is
 * present only when the effective permission set grants that capability. */
/**
 * A capability grant as one comparable string, so a runtime can tell whether a
 * bundle it already holds still carries the grants it should. Keyed only on the
 * bundle hash, a runtime treats a grant-only change — same code, lower quota,
 * revoked hosts — as a no-op and keeps the original config alive. Host order is
 * normalised because an allowlist is a set, not a sequence.
 */
export function capabilityKey(config?: CapabilityConfig): string {
	if (!config) return ""
	return JSON.stringify([
		config.storageDir ?? null,
		config.quotaBytes ?? 0,
		[...(config.networkHosts ?? [])].sort()
	])
}

export interface CapabilityConfig {
	/** Absolute path to this plugin's private directory (extensions_data/<id>). */
	storageDir?: string
	/** Max total bytes the directory may hold. */
	quotaBytes?: number
	/** Allowed fetch hosts — the mediated network grant (SES backend only). */
	networkHosts?: string[]
}
