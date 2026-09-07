/**
 * The scoped storage capability — the extension's own rows and files, reached
 * through a permission-checked, mediated surface.
 *
 * `makeStorageHost(config, rowSnapshot, nowMs)` runs in the **worker's Node
 * scope**, outside the sandbox — the guest never sees `fs`, only the methods on
 * the returned handle's `.api`, endowed (SES) or bridged (QuickJS) in and then
 * adapted to the SDK's promise-returning shape by the prelude's
 * `__wrapStorage`. Four guarantees enforced here, not in the guest:
 *  - **Jail:** every path resolves under `config.storageDir`; `..`/absolute/
 *    symlink escapes throw. The store is inert data — SP never executes it.
 *  - **Scope:** a row carries no plugin field an extension can set or read. The
 *    host loads *this* plugin's rows and commits them back under the same id, so
 *    `query()` has no vocabulary in which another extension's rows exist.
 *  - **Quota:** a write that would push the extension past `config.quotaBytes`
 *    (or rows past `config.rowQuotaBytes`) is refused at the write, so a plugin
 *    cannot fill the disk and is told while it can still do something about it.
 *  - **Transaction:** a call's row and file mutations are buffered and applied
 *    only when the hook returns. `commit`/`discard` are on the handle and never
 *    on `.api`, so only the sandbox can end a transaction — a hook cannot commit
 *    itself mid-call and then carry on.
 *
 * ## Why the writes are a transaction
 *
 * Core can force a hook to stop (`PluginSandbox.kill`, sequenced by
 * `hookGrace.ts`: abort, wait the run's budget, then kill). Write-through
 * storage would make that forced stop a data-integrity event — the hook is
 * severed mid-sequence and whatever prefix of its writes had landed stays
 * landed. Buffered, killing is *always* clean: nothing was applied, so there is
 * nothing to unwind, the directory is byte-identical to before the call, and the
 * row diff dies inside the worker that was holding it.
 *
 * It also gives the grace window a contract an author can hold: **return in time
 * and your writes commit.** "Some unknown prefix of your writes landed" is not
 * one. This is why storage stays *permitted* after `ctx.signal` fires while new
 * outbound work does not (see `fetchHost`) — managing local data is precisely
 * what the grace is for.
 *
 * A hook that throws does not commit, for the reason a database would not: a
 * call that did not finish never decided what its data should be.
 *
 * ## Rows: why they arrive as a snapshot rather than a connection
 *
 * Rows live in Postgres (`plugin_rows`), and **this file has no database
 * handle** — it is a source string evaluated inside a worker thread, where the
 * only ambient authority is `fs`. Reaching the database from in here would mean
 * an asynchronous round trip to the host process, and **the QuickJS backend —
 * the secure default — has no async capability bridge at all**: `ctx.fetch` is
 * SES-only for exactly that reason. A row store built on an async bridge would
 * therefore work on the opt-in backend and throw on the default one, which is
 * the one failure mode worse than not shipping it.
 *
 * So the host does the database work on both sides of the call and this file
 * does none of it. `SandboxManager.dispatch` loads the plugin's rows before the
 * invoke (one indexed seek, `WHERE plugin_id = $1`) and hands them in as
 * `rowSnapshot`; every read is answered from that snapshot plus this call's
 * uncommitted diff, so `get`/`keys`/`query` are synchronous and identical on
 * both backends; and `commit()` returns the collapsed diff for the host to apply
 * in one database transaction.
 *
 * The consequence, stated rather than implied: **`query()` filters in memory.**
 * The index (`plugin_rows_plugin_key_unique`) is what makes the per-call load a
 * seek into one plugin's slice of a shared table instead of a scan across every
 * plugin's rows — that is the query it makes real. It is not a query planner for
 * `prefix`/`since`/`until`, and it cannot be while the guest is synchronous.
 * That is why the row budget is a *fraction* of the grant (see `rowQuotaFor`):
 * the snapshot crosses the sandbox boundary on every call, so the ceiling is a
 * latency budget as much as a disk budget, and the SDK's own framing — "rows are
 * small, queryable" — is the shape being honoured.
 *
 * ## Read-your-writes
 *
 * Every reader — `get`, `keys`, `query`, `usage`, `files.*`, and the older
 * `read`/`exists`/`list`/`size` — answers from the **projection**: the store as
 * it will be once this call commits, never the bare disk or the bare snapshot.
 * An author who writes a key and cannot then read it would rightly conclude the
 * store is broken; the transaction is meant to be invisible until a kill makes
 * it matter. The quota is checked against the same projection, so a hook that
 * buffers past its budget is told at the write that did it, rather than at a
 * commit where nothing can be done about it.
 *
 * ## What commit actually guarantees
 *
 * **Files.** Two phases, and the split is the guarantee. *Prepare* writes every
 * buffered file's bytes to a temp name under the root, where they clobber
 * nothing: a failure there (ENOSPC, EACCES) is undone completely by unlinking
 * the temps, so the call fails having changed the directory not at all. *Apply*
 * is then renames and unlinks only. Each rename is atomic — it is within one
 * directory, so within one filesystem — which makes every individual file
 * all-or-nothing, and a transaction touching one file (the common case) atomic
 * outright. The *set* of them is not: a crash, or a kill landing in the
 * microseconds of the apply loop, can leave some files moved and others not.
 * That is the honest ceiling of POSIX without a journal, and it is stated rather
 * than implied.
 *
 * **Rows.** Atomic, because they are one Postgres transaction — but committed by
 * the host, *after* this handle's file apply has already succeeded. A file apply
 * that throws returns no row diff at all, so the two can never both be half
 * done in the same direction: rows never land for a call whose files did not.
 *
 * **The two together are not atomic**, and cannot be made so without a journal
 * or two-phase commit. The window is between this handle's `commit()` returning
 * and the host's database transaction committing — a process death or a forced
 * kill there leaves **files ahead of rows**. That direction is deliberate:
 * orphaned bytes are self-healing (the next call sees no row, redoes the work and
 * overwrites the file), whereas rows ahead of files is a dangling reference a
 * plugin has to be written to survive. See `SandboxManager.dispatch`, which owns
 * the ordering and states it again at the site.
 *
 * Temps live flat under the root, never beside their destination, so a
 * `remove("dir")` followed by a `write("dir/x")` in the same call cannot delete
 * the very bytes it is about to move into place. They add no directory and no
 * path outside the root the plugin could already write, so staging opens no
 * route to code: a plugin's executable code stays only its reviewed,
 * `bundleHash`-pinned bundle, never a file it writes at runtime.
 *
 * ## What buffering moved, and where it now surfaces
 *
 * Two things a write-through store reported to the hook are now decided after
 * it has gone, and both are stated rather than left to be discovered:
 *  - **A hook that throws, times out or is killed keeps nothing.** It used to
 *    keep whatever it had written before it stopped.
 *  - **An IO failure the write itself would have raised** — writing under a
 *    path that is a file, a read-only directory — surfaces at the commit, where
 *    it fails the *call* with "its writes could not be committed" instead of
 *    reaching the hook's own `try`. Quota is the one such failure deliberately
 *    kept at the write (above), because it is the one a well-behaved plugin
 *    routinely meets and can do something about.
 *
 * ## Two spellings of the file store, on purpose
 *
 * `read/write/exists/remove/list/size` is the surface the sandbox endowed before
 * the SDK's `ExtensionStorage` existed: synchronous, text-only, `remove` where
 * the SDK says `delete`, `size()` where it says `usage()`. Hooks in this repo and
 * in the wild call it, so it stays, unchanged in behaviour and still
 * synchronous. `files.*` is the SDK's spelling of the same store — byte-exact
 * (`Uint8Array`, carried across the boundary as base64), quota-reporting
 * (`Result<WriteReceipt>` rather than a bare `true`), and prefix-aware. Both
 * write into the same buffer and commit together; they are two doors into one
 * room, not two stores.
 *
 * Sync on purpose (the localStorage shape): `readFileSync`/`writeFileSync`
 * blocking the hook's own worker is fine, and it keeps the store synchronous and
 * identical across both backends. Kept as an embeddable source string because
 * the eval workers cannot import modules; the unit test evaluates this string.
 */
export const STORAGE_HOST_SOURCE = String.raw`
function makeStorageHost(config, rowSnapshot, nowMs) {
	var fs = require("fs");
	var path = require("path");
	var root = config && config.storageDir;
	var quota = (config && config.quotaBytes) || 10 * 1024 * 1024;
	// Mirrors rowQuotaFor() in this module's TypeScript half; a test asserts the
	// two agree, because a drift between them is a quota a plugin cannot predict.
	var rowQuota =
		(config && config.rowQuotaBytes) ||
		Math.min(quota, Math.max(65536, Math.min(1048576, Math.floor(quota / 8))));
	// This call's uncommitted diff against the disk: what each written path will
	// hold (as base64, so text and bytes share one buffer), and which paths are
	// to be deleted (recursively, as before). A path is in exactly one of the
	// two — writing re-creates something removed, removing drops a buffered
	// write — so ordering is settled as it happens and no log has to be replayed
	// at commit.
	var writes = new Map();
	var removes = new Set();
	var closed = false;
	var txId = process.pid + "-" + Math.floor(Math.random() * 1e9);
	// The call's pinned clock, so a row's updatedAt is the same replayable value
	// ctx.now() reports rather than whatever the worker's wall clock said.
	var stamp = new Date(
		typeof nowMs === "number" && isFinite(nowMs) ? Math.floor(nowMs) : Date.now()
	).toISOString();

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
	function under(p, parent) {
		var withSep = parent.endsWith(path.sep) ? parent : parent + path.sep;
		return p.indexOf(withSep) === 0;
	}
	function rootSep() {
		return root.endsWith(path.sep) ? root : root + path.sep;
	}
	// A relative, slash-separated path — the only spelling the guest ever sees.
	function relOf(full) {
		if (full === root) return "";
		return full.slice(rootSep().length).split(path.sep).join("/");
	}
	// Exact for canonical base64 (what Buffer#toString('base64') emits, and what
	// normB64 forces guest input into), and it avoids decoding just to measure.
	function b64Bytes(s) {
		if (!s) return 0;
		var pad = s.charAt(s.length - 1) === "=" ? (s.charAt(s.length - 2) === "=" ? 2 : 1) : 0;
		return Math.floor((s.length * 3) / 4) - pad;
	}
	// Guest-supplied base64 is re-encoded rather than trusted: b64Bytes assumes
	// canonical form, and a plugin that hand-rolled its own encoding must not be
	// able to make the quota arithmetic disagree with the bytes on disk.
	function normB64(s) {
		return Buffer.from(String(s == null ? "" : s), "base64").toString("base64");
	}

	/* ── the projection: the store as this call believes it to be ────────── */

	// Is p inside something this call removed? Ancestors count — removing a
	// directory removes what is under it.
	function covered(p) {
		if (removes.has(p)) return true;
		var hit = false;
		removes.forEach(function (r) { if (!hit && under(p, r)) hit = true; });
		return hit;
	}
	function bufferedUnder(p) {
		var hit = false;
		writes.forEach(function (_v, k) { if (!hit && under(k, p)) hit = true; });
		return hit;
	}
	// "file", "dir" or null (absent). A buffered write wins over a covering
	// remove because it can only have happened after it.
	function project(p) {
		if (writes.has(p)) return "file";
		if (bufferedUnder(p)) return "dir";
		if (covered(p)) return null;
		if (!fs.existsSync(p)) return null;
		try { return fs.statSync(p).isDirectory() ? "dir" : "file"; } catch (e) { return null; }
	}
	// On-disk bytes this call has not superseded or deleted. Recursion is
	// top-down, so a removed directory takes its whole subtree out with it.
	function diskSize(dir) {
		var total = 0;
		if (!fs.existsSync(dir)) return 0;
		var entries = fs.readdirSync(dir, { withFileTypes: true });
		for (var i = 0; i < entries.length; i++) {
			var e = entries[i];
			var fp = path.join(dir, e.name);
			if (writes.has(fp) || covered(fp)) continue;
			if (e.isDirectory()) total += diskSize(fp);
			else { try { total += fs.statSync(fp).size; } catch (x) {} }
		}
		return total;
	}
	// What the directory will weigh once this call commits — the number the
	// quota is checked against, and the one size() answers.
	function projectedSize() {
		var total = diskSize(root);
		writes.forEach(function (v) { total += b64Bytes(v); });
		return total;
	}
	// Every file the store will hold once this call commits, as FileEntry —
	// recursive, relative, sorted. Staging temps are excluded: they are this
	// commit's scratch (or a dead one's leftovers), never content, and their
	// names carry the host pid.
	function walkFiles(dir, rel, out) {
		if (!fs.existsSync(dir)) return;
		var entries;
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
		for (var i = 0; i < entries.length; i++) {
			var e = entries[i];
			if (!rel && e.name.indexOf(".sptmp-") === 0) continue;
			var fp = path.join(dir, e.name);
			if (covered(fp)) continue;
			var r = rel ? rel + "/" + e.name : e.name;
			if (e.isDirectory()) walkFiles(fp, r, out);
			else if (!writes.has(fp)) {
				try {
					var st = fs.statSync(fp);
					out.push({ path: r, bytes: st.size, updatedAt: new Date(st.mtimeMs).toISOString() });
				} catch (x) {}
			}
		}
	}
	function projectedFiles() {
		var out = [];
		walkFiles(root, "", out);
		writes.forEach(function (v, k) {
			out.push({ path: relOf(k), bytes: b64Bytes(v), updatedAt: stamp });
		});
		out.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
		return out;
	}

	/* ── the projection: rows ────────────────────────────────────────────── */

	// key -> { value, bytes, updatedAt }. Seeded from the host's snapshot and
	// mutated in place by this call; nothing here is the database's opinion
	// until commit hands the diff back.
	var rows = new Map();
	// The keys the snapshot arrived with, so a key created and then deleted in
	// the same call emits no DELETE for a row that was never there.
	var baseKeys = new Set();
	// key -> the ONE op that key ends the call in. Collapsed rather than logged:
	// a hook that rewrites a counter a thousand times owes the database one
	// upsert, not a thousand, and the payload crossing back is bounded by the
	// number of keys touched instead of the number of calls made.
	var rowOps = new Map();

	function jsonOf(v) {
		var s;
		try { s = JSON.stringify(v === undefined ? null : v); } catch (e) { s = undefined; }
		if (typeof s !== "string")
			throw new Error("storage: a row value must be JSON-serializable");
		return s;
	}
	// A row costs its key as well as its value: a store that charged only for
	// values would let a plugin spend its budget on index keys for free.
	function rowSize(key, json) {
		return Buffer.byteLength(key, "utf8") + Buffer.byteLength(json, "utf8");
	}
	function rowKey(key) {
		if (typeof key !== "string" || key.length === 0)
			throw new Error("storage: a row key is required");
		if (key.length > 512)
			throw new Error("storage: a row key may not exceed 512 characters");
		return key;
	}
	(function seed() {
		var src = rowSnapshot || [];
		for (var i = 0; i < src.length; i++) {
			var r = src[i];
			if (!r || typeof r.key !== "string" || !r.key.length) continue;
			// Sizes are recomputed rather than trusted: one formula decides what
			// a row costs, and it is the one the quota is checked against.
			var json;
			try { json = jsonOf(r.value); } catch (e) { continue; }
			rows.set(r.key, {
				value: JSON.parse(json),
				bytes: rowSize(r.key, json),
				updatedAt: typeof r.updatedAt === "string" && r.updatedAt ? r.updatedAt : stamp
			});
			baseKeys.add(r.key);
		}
	})();

	function rowTotal() {
		var t = 0;
		rows.forEach(function (r) { t += r.bytes; });
		return t;
	}
	// Split from usage() so a caller that has ALREADY measured the directory can
	// answer without walking it a second time. projectedSize() is a recursive
	// readdir, and a hook that writes a thousand rows must not pay for a
	// thousand extra walks to be told how much room is left.
	function usageFrom(rb, fb) {
		var used = rb + fb;
		return {
			quotaBytes: quota,
			usedBytes: used,
			availableBytes: Math.max(0, quota - used),
			rowBytes: rb,
			fileBytes: fb
		};
	}
	function usage() {
		return usageFrom(rowTotal(), projectedSize());
	}
	function ok(value) { return { kind: "ok", value: value }; }
	function refuse(reason) { return { kind: "err", reason: reason }; }
	function receipt(delta) { return ok({ deltaBytes: delta, usage: usage() }); }
	function open() {
		if (closed) throw new Error("storage: the call has ended");
	}

	// A raw Node fs error leaks the absolute host path (and so the OS username,
	// install layout and plugin id) in its .message — which crosses to the guest
	// verbatim on both backends. Re-throw a code-only message so a failing op
	// tells the plugin *what* failed, never *where*. The jail's own throws carry
	// no .code, so they (and their safe, path-free text) pass straight through.
	function codeMessage(code) {
		var m = {
			ENOENT: "not found",
			ENOTDIR: "not a directory",
			EISDIR: "is a directory",
			EEXIST: "already exists",
			EACCES: "permission denied",
			EPERM: "operation not permitted",
			ENOSPC: "no space left"
		};
		return m[code] || "io error";
	}
	function guard(fn) {
		try {
			return fn();
		} catch (e) {
			if (e && e.code) throw new Error("storage: " + codeMessage(e.code));
			throw e;
		}
	}

	/* ── shared file mutators, behind both spellings ──────────────────────── */

	// Buffer a write and report the byte delta, or null when the quota refuses
	// it. Both spellings go through here so there is one quota arithmetic.
	function bufferWrite(full, b64) {
		var incoming = b64Bytes(b64);
		var existing = 0;
		if (writes.has(full)) existing = b64Bytes(writes.get(full));
		else if (!covered(full) && fs.existsSync(full)) {
			try { existing = fs.statSync(full).size; } catch (x) {}
		}
		if (rowTotal() + projectedSize() - existing + incoming > quota) return null;
		removes.delete(full);
		writes.set(full, b64);
		return incoming - existing;
	}
	function bufferRemove(full) {
		// Buffered writes under a removed path go with it: the remove happened
		// after them, and order is the semantics.
		var doomed = [];
		writes.forEach(function (_v, k) {
			if (k === full || under(k, full)) doomed.push(k);
		});
		for (var i = 0; i < doomed.length; i++) writes.delete(doomed[i]);
		removes.add(full);
	}
	function bytesAt(rel) {
		var total = 0;
		var pf = projectedFiles();
		for (var i = 0; i < pf.length; i++)
			if (rel === "" || pf[i].path === rel || pf[i].path.indexOf(rel + "/") === 0)
				total += pf[i].bytes;
		return total;
	}

	/* ── commit ──────────────────────────────────────────────────────────── */

	function applyTx() {
		ensureRoot();
		// Prepare: bytes first, where nothing is at stake yet. A failure here
		// unwinds completely — the directory is exactly as it was.
		var staged = [];
		try {
			writes.forEach(function (data, dest) {
				var tmp = path.join(root, ".sptmp-" + txId + "-" + staged.length);
				fs.writeFileSync(tmp, Buffer.from(data, "base64"));
				staged.push({ tmp: tmp, dest: dest });
			});
		} catch (e) {
			for (var i = 0; i < staged.length; i++)
				try { fs.rmSync(staged[i].tmp, { force: true }); } catch (x) {}
			throw e;
		}
		// Apply: renames and unlinks only, and every one of them attempted —
		// stopping at the first failure would lose writes that would have
		// landed, and the state is a mixture either way.
		var keep = new Set();
		for (var s = 0; s < staged.length; s++) keep.add(staged[s].tmp);
		var failure = null;
		removes.forEach(function (p) {
			try {
				if (p === root) {
					// Wiping the whole store must not take this commit's own
					// staged bytes with it: they are the new state, not the old.
					var names = fs.readdirSync(root);
					for (var i = 0; i < names.length; i++) {
						var fp = path.join(root, names[i]);
						if (!keep.has(fp)) fs.rmSync(fp, { recursive: true, force: true });
					}
				} else fs.rmSync(p, { recursive: true, force: true });
			} catch (e) { if (!failure) failure = e; }
		});
		for (var j = 0; j < staged.length; j++) {
			try {
				fs.mkdirSync(path.dirname(staged[j].dest), { recursive: true });
				fs.renameSync(staged[j].tmp, staged[j].dest);
			} catch (e) {
				if (!failure) failure = e;
				try { fs.rmSync(staged[j].tmp, { force: true }); } catch (x) {}
			}
		}
		if (failure) throw failure;
	}

	return {
		api: {
			/* ── the SDK's ExtensionStorage (sdk/src/storage.ts) ──────────── */

			usage: function () {
				return guard(function () { return usage(); });
			},
			get: function (key) {
				return guard(function () {
					var r = rows.get(rowKey(key));
					return r ? r.value : undefined;
				});
			},
			keys: function (prefix) {
				return guard(function () {
					var p = prefix == null ? "" : String(prefix);
					var out = [];
					rows.forEach(function (_r, k) { if (k.indexOf(p) === 0) out.push(k); });
					return out.sort();
				});
			},
			query: function (q) {
				return guard(function () {
					var o = q || {};
					var p = o.prefix == null ? "" : String(o.prefix);
					var since = o.since == null ? NaN : Date.parse(o.since);
					var until = o.until == null ? NaN : Date.parse(o.until);
					// The host clamps it; ask for what you want (RowQuery.limit).
					var want = Math.floor(Number(o.limit));
					var limit = Math.max(1, Math.min(200, isFinite(want) && want > 0 ? want : 50));
					var order = o.order === "oldest" || o.order === "key" ? o.order : "newest";
					var all = [];
					rows.forEach(function (r, k) {
						if (k.indexOf(p) !== 0) return;
						var t = Date.parse(r.updatedAt);
						if (!isNaN(since) && !(t >= since)) return;
						if (!isNaN(until) && !(t < until)) return;
						all.push({ key: k, value: r.value, bytes: r.bytes, updatedAt: r.updatedAt });
					});
					all.sort(function (a, b) {
						if (order !== "key") {
							var ta = Date.parse(a.updatedAt), tb = Date.parse(b.updatedAt);
							if (ta !== tb) return order === "oldest" ? ta - tb : tb - ta;
						}
						return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
					});
					// An offset cursor, exact within a call because the page is
					// cut from one in-memory projection. A cursor it cannot read
					// throws rather than silently restarting at zero, which is
					// how a pager becomes an infinite loop.
					var start = 0;
					if (o.cursor != null) {
						var c = String(o.cursor);
						if (!/^o:[0-9]+$/.test(c)) throw new Error("storage: unreadable cursor");
						start = parseInt(c.slice(2), 10);
					}
					var page = { rows: all.slice(start, start + limit) };
					if (start + limit < all.length) page.nextCursor = "o:" + (start + limit);
					return page;
				});
			},
			put: function (key, value) {
				return guard(function () {
					open();
					var k = rowKey(key);
					var json = jsonOf(value);
					var size = rowSize(k, json);
					var prev = rows.get(k);
					var delta = size - (prev ? prev.bytes : 0);
					var before = rowTotal();
					if (before + delta > rowQuota)
						return refuse("storage: the row budget is full");
					// One walk, reused for the receipt below: rows and files
					// share one quota, so the file half has to be measured, but
					// it has to be measured once.
					var fileBytes = projectedSize();
					if (before + fileBytes + delta > quota)
						return refuse("storage: quota exceeded");
					// Re-parsed, not stored by reference: on SES the value is a
					// live guest object the hook could still mutate after the
					// put, and what commits must be what was written.
					rows.set(k, { value: JSON.parse(json), bytes: size, updatedAt: stamp });
					rowOps.set(k, { op: "put", key: k, value: JSON.parse(json), bytes: size, updatedAt: stamp });
					return ok({ deltaBytes: delta, usage: usageFrom(before + delta, fileBytes) });
				});
			},
			delete: function (key) {
				return guard(function () {
					open();
					var k = rowKey(key);
					var prev = rows.get(k);
					if (!prev) return receipt(0);
					rows.delete(k);
					if (baseKeys.has(k)) rowOps.set(k, { op: "delete", key: k });
					else rowOps.delete(k);
					return receipt(-prev.bytes);
				});
			},
			deleteAll: function (prefix) {
				return guard(function () {
					open();
					var p = prefix == null ? "" : String(prefix);
					var doomed = [];
					rows.forEach(function (_r, k) { if (k.indexOf(p) === 0) doomed.push(k); });
					for (var i = 0; i < doomed.length; i++) {
						rows.delete(doomed[i]);
						if (baseKeys.has(doomed[i])) rowOps.set(doomed[i], { op: "delete", key: doomed[i] });
						else rowOps.delete(doomed[i]);
					}
					return ok({ removed: doomed.length, usage: usage() });
				});
			},

			/* ── the SDK's ExtensionFiles, over the same buffer ───────────── */

			files: {
				list: function (prefix) {
					return guard(function () {
						var p = prefix == null ? "" : String(prefix);
						if (p.indexOf("..") >= 0)
							throw new Error("storage: path escapes the extension directory");
						return projectedFiles().filter(function (f) {
							return f.path.indexOf(p) === 0;
						});
					});
				},
				stat: function (rel) {
					return guard(function () {
						var full = resolve(rel);
						if (project(full) !== "file") return null;
						if (writes.has(full))
							return { path: relOf(full), bytes: b64Bytes(writes.get(full)), updatedAt: stamp };
						var st = fs.statSync(full);
						return { path: relOf(full), bytes: st.size, updatedAt: new Date(st.mtimeMs).toISOString() };
					});
				},
				read: function (rel) {
					return guard(function () {
						var full = resolve(rel);
						if (writes.has(full)) return ok(writes.get(full));
						var kind = project(full);
						if (kind === null) return refuse("storage: not found");
						if (kind === "dir") return refuse("storage: is a directory");
						return ok(fs.readFileSync(full).toString("base64"));
					});
				},
				write: function (rel, b64) {
					return guard(function () {
						open();
						var full = resolve(rel);
						var delta = bufferWrite(full, normB64(b64));
						if (delta === null) return refuse("storage: quota exceeded");
						return receipt(delta);
					});
				},
				delete: function (rel) {
					return guard(function () {
						open();
						var full = resolve(rel);
						var freed = bytesAt(relOf(full));
						bufferRemove(full);
						return receipt(-freed);
					});
				},
				deleteAll: function (prefix) {
					return guard(function () {
						open();
						var p = prefix == null ? "" : String(prefix);
						if (p.indexOf("..") >= 0)
							throw new Error("storage: path escapes the extension directory");
						var doomed = projectedFiles().filter(function (f) {
							return f.path.indexOf(p) === 0;
						});
						for (var i = 0; i < doomed.length; i++)
							bufferRemove(path.resolve(root, doomed[i].path));
						// A prefix that IS a directory takes the directory with
						// it, so repeated sweeps do not accumulate empty ones.
						// Its whole subtree is a subset of what the prefix
						// already matched, so this removes nothing extra.
						if (p && project(resolve(p)) === "dir") bufferRemove(resolve(p));
						return ok({ removed: doomed.length, usage: usage() });
					});
				}
			},

			/* ── the older file spelling, unchanged ───────────────────────── */

			read: function (rel) {
				return guard(function () {
					var full = resolve(rel);
					if (writes.has(full))
						return Buffer.from(writes.get(full), "base64").toString("utf8");
					var kind = project(full);
					if (kind === null) return null;
					if (!fs.existsSync(full)) {
						// A directory this call only buffered has no disk twin
						// to fail on; say what a real one would.
						if (kind === "dir") throw new Error("storage: is a directory");
						return null;
					}
					return fs.readFileSync(full, "utf8");
				});
			},
			write: function (rel, data) {
				return guard(function () {
					open();
					var full = resolve(rel);
					var str = String(data == null ? "" : data);
					var delta = bufferWrite(full, Buffer.from(str, "utf8").toString("base64"));
					if (delta === null) throw new Error("storage: quota exceeded");
					return true;
				});
			},
			exists: function (rel) {
				return guard(function () {
					return project(resolve(rel)) !== null;
				});
			},
			remove: function (rel) {
				return guard(function () {
					open();
					bufferRemove(resolve(rel));
					return true;
				});
			},
			list: function (rel) {
				return guard(function () {
					var dir = rel ? resolve(rel) : root;
					var kind = project(dir);
					if (kind === "file") throw new Error("storage: not a directory");
					if (kind === null) return [];
					var out = new Set();
					if (fs.existsSync(dir)) {
						var entries = fs.readdirSync(dir);
						for (var i = 0; i < entries.length; i++)
							if (project(path.join(dir, entries[i])) !== null)
								out.add(entries[i]);
					}
					var withSep = dir.endsWith(path.sep) ? dir : dir + path.sep;
					writes.forEach(function (_v, k) {
						if (k.indexOf(withSep) !== 0) return;
						var rest = k.slice(withSep.length);
						var cut = rest.indexOf(path.sep);
						out.add(cut < 0 ? rest : rest.slice(0, cut));
					});
					return Array.from(out);
				});
			},
			size: function () {
				return guard(function () {
					return projectedSize();
				});
			}
		},
		/**
		 * The hook returned: make the store match what it believes it did.
		 *
		 * Files are applied here, in this worker, exactly as before. Rows are
		 * *returned* — one collapsed op per key it touched — because only the
		 * host has a database. A file apply that throws fails the call and
		 * returns nothing, so the host never commits rows for a call whose
		 * files did not land.
		 */
		commit: function () {
			if (closed) return [];
			closed = true;
			var pending = [];
			rowOps.forEach(function (op) { pending.push(op); });
			try {
				if (writes.size || removes.size) applyTx();
			} catch (e) {
				var m = e && e.code ? codeMessage(e.code) : String((e && e.message) || e);
				throw new Error(
					"storage: the hook returned but its writes could not be committed — " + m
				);
			} finally {
				writes.clear();
				removes.clear();
				rowOps.clear();
			}
			return pending;
		},
		/** The call ended without committing (killed, timed out, threw). */
		discard: function () {
			closed = true;
			writes.clear();
			removes.clear();
			rowOps.clear();
		}
	};
}
`

/**
 * One row as it crosses between the host and the sandbox.
 *
 * `value` is whatever JSON the extension put there; `bytes` is what it costs
 * against the row budget (its key plus its serialized value — see `rowSize` in
 * the source above), and `updatedAt` is ISO, taken from the call's pinned clock
 * so a replay reproduces it.
 */
export interface PluginRowSnapshotEntry {
	key: string
	value: unknown
	bytes: number
	updatedAt: string
}

/**
 * What a returning hook decided about its rows — one op per key it touched, in
 * no particular order, because each key is independent and each is idempotent.
 *
 * `put` is an upsert of the whole value; `delete` removes the key. There is no
 * "replace everything" op on purpose: two concurrent calls of the same plugin
 * hold independent snapshots, and per-key ops mean they only lose each other's
 * work on a key they *both* wrote — the same granularity the file half has
 * always had, where the last rename of a given path wins.
 */
export type PluginRowChange =
	| {
			op: "put"
			key: string
			value: unknown
			bytes: number
			updatedAt: string
	  }
	| { op: "delete"; key: string }

/**
 * The row budget inside a storage grant: an eighth of it, never below 64 KB,
 * never above 1 MB, and never more than the grant itself.
 *
 * Rows and files share **one** quota — that is the SDK's rule, and the reason is
 * that two budgets which can each be under while the disk fills is not a limit.
 * So this is not a second budget; it is a *sub-cap* inside the one, and it earns
 * its place for a reason the SDK's model does not have to know about: the row
 * snapshot crosses the sandbox boundary on every single call (see the docblock
 * above), so an extension allowed to keep its whole 256 MB grant in rows would
 * be paying that cost on every hook it runs. A tenth of a megabyte of keyed JSON
 * is a state store; a hundred megabytes is a table, and the SDK's own answer to
 * wanting one of those is that it is a different conversation.
 *
 * Mirrors the expression in `STORAGE_HOST_SOURCE`, which is where it is actually
 * enforced (a config that never reaches the sandbox is advisory, per the same
 * rule that makes `normalizeStorageQuota` clamp a manifest's declared quota).
 */
export function rowQuotaFor(quotaBytes: number): number {
	if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) return 64 * 1024
	return Math.min(
		Math.floor(quotaBytes),
		Math.max(64 * 1024, Math.min(1024 * 1024, Math.floor(quotaBytes / 8)))
	)
}

/** The per-plugin permission grants the sandbox passes at load. Each field is
 * present only when the effective permission set grants that permission. */
/**
 * A permission grant as one comparable string, so a sandbox can tell whether a
 * bundle it already holds still carries the grants it should. Keyed only on the
 * bundle hash, a sandbox treats a grant-only change — same code, lower quota,
 * revoked hosts — as a no-op and keeps the original config alive. Host order is
 * normalised because an allowlist is a set, not a sequence.
 */
export function permissionKey(config?: PermissionConfig): string {
	if (!config) return ""
	return JSON.stringify([
		config.storageDir ?? null,
		config.quotaBytes ?? 0,
		[...(config.networkHosts ?? [])].sort(),
		config.rowQuotaBytes ?? 0
	])
}

export interface PermissionConfig {
	/** Absolute path to this plugin's private directory (extensions_data/<id>). */
	storageDir?: string
	/** Max total bytes the directory may hold. */
	quotaBytes?: number
	/**
	 * The sub-cap on the row half of that total (`rowQuotaFor`). Derived, never
	 * declared: a manifest has one storage number and this is computed from it.
	 */
	rowQuotaBytes?: number
	/** Allowed fetch hosts — the mediated network grant, honoured on both backends. */
	networkHosts?: string[]
}
