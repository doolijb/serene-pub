# PLAN — `.serene` packages: one file, read in place — seams draft — 2026-10-30

**Status: DRAFT 2026-10-30, reviewed the same day; ships in 0.7 (★P1 default taken).** The seams stand;
the review notes below fill gaps found while reading them against the code. For 0.6 only K6 (HTTP upload, today's
`.zip` layout) is built, pulled forward once the owner ruled plugins on in 0.6 (2026-10-30); the format
itself waits for 0.7. Lanes and file ownership get written once the ★ are ruled.

Companion: `plans/PLAN-0-6-readiness-2026-10-30.md` §C3.

## 0. Owner's words (2026-10-30)

> Should i have the SDK compile plugins to a custom file type?
> So an uncompressed zip that can be accessed by core instantly. How about .serene?
> Draft up the .serene seams as well.

## 1. What exists today

- **Writer.** `serene-pub build` writes `dist/<slug>-<version>.zip` (`../serene-pub-sdk/cli/src/bin.ts:403-460`,
  `writePackageZip`). Its zip writer stores every entry uncompressed, sorts entries, and uses a
  fixed timestamp, so a rebuild gives the same bytes (`cli/src/zip.ts:1-12`).
- **Layout inside.**
  - `dist/plugin/` is the build folder itself: `manifest.json`, `bundle.js`, `pipelines/*.json`, ….
  - `ui/`, the declared assets folder, and `lang/`.
  - Surface and component entries that lie outside those.
- **In-app export.** A genre's **Export as plugin…** makes a package too, optionally with
  **Include the source** (NOMENCLATURE §25 rows at :2774 and :2786).
- **Reader.**
  - The browser upload travels over Socket.IO, which caps it at about 70 MB.
  - It is unzipped whole in memory with fflate's `unzipSync` (`src/lib/server/sockets/pluginPackages.ts:12,57`).
  - `storePackageFiles` keeps small `ui` text in `plugin_files.content` (`storedAt: 'db'`). Everything
    else is copied to `<data>/plugins/<id>/<version>/<path>` (`storedAt: 'disk'`), with a SHA-256
    per file (`src/lib/server/plugins/install.ts:807-878`).
  - Approval binds to `bundleHash`, the SHA-256 of the bundle source (`install.ts:774`).
  - Old version folders are culled at the next start (`cullPluginPackageDirs`).
- **Large packages.** These install from a folder: `npm run plugin:install -- <folder>`
  (`docs/hosting.md:121`).
- **Serving.**
  - `/plugin-assets/<id>/<version>/<path>`, immutable (`src/lib/server/plugins/frameHost.ts:335,521`).
  - `/plugin-data/<id>/<path>` for listed shared files only.
  - `/plugin-ui/…`, SAMEORIGIN.
- **Picker.** Admin › Plugins has `accept=".zip,application/zip"`
  (`src/lib/client/admin/sections/plugins/Page.svelte:247`).
- **Limits.** `SP_PLUGIN_PACKAGE_MAX_MB` (512) and `SP_PLUGIN_FILES_MAX` (10000).
- **Schema.** `plugin_files.stored_at` is free text with default `'db'`, and `disk_path` is text
  (`src/lib/server/db/schema.ts:6898-6918`). A new `storedAt` value needs no migration.
- **Backups.** The daily backup is PGlite's own tar of the database (`dumpDataDir`,
  `src/lib/server/db/backup.ts:195`). Package files under `plugins/` are outside it (inferred).

**Gaps today:**
- no format version;
- no hash list shipped in the package (hashes are only computed at install);
- no licence, README or credits reach the admin (life-sim readiness c41);
- the build folder's `dist/plugin/` name is baked into the layout;
- 70 MB browser uploads with the whole package held in memory.

## 2. Decisions this draft takes (from the owner, 2026-10-30)

- **D1 — Container: zip, every entry stored.** Core reads entries in place, with no unpack step.
  Compression is not worth it: most of a large package is pictures and audio that are already
  compressed.
- **D2 — Extension `.serene`** (working name; a NOMENCLATURE §24 pass and a §25 row are owed).
  - It means **a Serene Pub package**, whatever it carries. Any other export Serene Pub adds later
    is either a package or gets a clearly different name.
  - Copy says **package (.serene)**, never "a Serene file": **Serene** is the Guide's envoy and
    mascot (R1).
  - A quick web search on 2026-10-30 found no existing file type using `.serene`.
- **D3 — `.zip` is still accepted through 0.7.** 0.6 is in users' hands
  (`feedback_no_back_compat_before_distribution`).

## 3. Seams: the contracts lanes code against

Owners: **K** = SDK and CLI, **H** = app server, **U** = app UI, **W** = docs and canon,
**V** = verification.

### K1 — The format, written down (owner **K**, readers H U W)

A normative page in the SDK guides, `guides/package-format.md`.

**Container rules:**
- a zip with every entry stored (method 0);
- UTF-8 names (flag bit 11), `/` separators;
- no absolute paths, no `..`, no duplicate names, no zip64;
- sorted entries and a fixed timestamp, as now, **except** that the index is written first and the rest
  are sorted after it (review note: "sorted" and "index first" otherwise contradict).

**The first entry is the package index**, `serene-package.json` (name ★P4). It is stored and first
in local-header order, so a reader can tell a package from its first few hundred bytes:

```jsonc
{
  "format": 1,                       // integer; readers refuse a higher one
  "slug": "vendor.name",
  "version": "0.1.0",
  "license": "AGPL-3.0-only",        // SPDX expression
  "credits": [{ "name": "…", "url": "…" }],
  "source": "https://…",             // optional
  "files": {                         // every entry except this index
    "plugin/manifest.json": { "sha256": "…", "bytes": 132804 }
  }
}
```

**Required members:**
- the index;
- `plugin/manifest.json`;
- one of `LICENSE`, `LICENSE.md` or `LICENSE.txt`;
- `README.md`;
- `plugin/bundle.js` if and only if the manifest names handlers.

**Layout:**
- `plugin/` (was `dist/plugin/`; name ★P4);
- `ui/`, `assets/` (or the declared folder), `lang/`;
- `source/` (optional; the in-app **Include the source**).

**Versioning:**
- adding a field does not bump `format`; changing or removing one does;
- a reader that meets a higher `format` refuses with a sentence naming the version it reads.

**The package hash** is the SHA-256 of the whole file. It is the identity of one build, for a
future catalogue to pin.

### K2 — One writer, shared (owner **K**, reader U)

- `serene-pub build` writes `dist/<slug>-<version>.serene` with the index and hash list.
- `--zip` keeps writing today's layout for authors who target older pubs, until 0.7 final.
- The writer is exported from the SDK, and the app's **Export as plugin…** imports it, so the two
  can never drift. Review note: today's writer is `cli/src/zip.ts`, and the app must not depend on the CLI
  package; move the writer (and the K3 reader) into `@serene-pub/sdk` or a small `@serene-pub/package`
  workspace that both import.
- The in-app export asks for a licence (SPDX picker) and writes a `README.md` from the genre's
  description, because K1 requires both.
- `serene-pub check <file.serene>` validates a built package against K1, as well as a source
  folder. That ties in with readiness-plan D3 (c33).

### K3 — Telling a package apart (owner **H**)

The file's content decides, never its name:
- `PK\x03\x04` and a first entry named `serene-package.json` → a package; read its `format`.
- A zip holding `dist/plugin/manifest.json` → a legacy package; take today's path, then K4's
  repack.
- Anything else → refused.

Sentences (U owns the final copy):
- *This isn't a Serene Pub package.*
- *This package needs a newer Serene Pub: it uses package format 2, and this pub reads format 1.*
- *This package is missing its licence.* (and the same for each required member)

### K4 — Install keeps the file (owner **H**)

1. The upload (K6) streams to a temporary file under `<data>/plugins/<id>/`, which is fsynced and
   renamed to `<version>.serene`.
2. Read the central directory and build the entry index `{ path → offset, bytes, crc }`.
3. Refuse:
   - any entry not stored;
   - an unsafe path;
   - an entry missing from the hash list, or a hash-list entry with no entry;
   - a size over the limits.
4. Verify each entry's SHA-256 against the index once, streaming.
5. `plugin_files` rows keep `path`, `mime`, `hash`, `bytes` and `kind`, with `storedAt: 'package'`
   and `diskPath` naming the `.serene` file. No migration is needed (§1, schema).
6. `bundleHash` stays as it is. It now also equals the index's hash for `plugin/bundle.js`, which
   anyone can check.
7. **Legacy input** (`.zip`, folder install) is repacked into a `.serene` file at install
   (★P6), inflating any compressed entries. That leaves one runtime path.
8. Small `ui` text in the database: ★P2.

### K5 — Serving from the file (owner **H**)

- `/plugin-assets`, `/plugin-data` and `/plugin-ui` look up the entry index and stream a byte range
  of the file (`createReadStream` with `start`/`end`).
- HTTP `Range` requests are served inside the entry, so audio and video can seek.
- The ETag is the entry's SHA-256, kept immutable as today.
- The sandbox reads `plugin/bundle.js` from its range once.
- Entry indexes are cached per (id, version) in memory, rebuilt on first use after boot. Parsing
  the central directory of 10,000 entries is cheap.
- **Windows** won't delete a file another handle has open. An upgrade writes a new version file, and
  the old one is culled at the next start, as folders are today.
- **Enabled, not in scope.** Life-sim readiness a3 (a handler can't read its own package files)
  becomes a small seam once files are read in place. It is an SDK 1.0 candidate.

### K6 — Upload over HTTP (owner **H**, reader U)

- Replace the Socket.IO upload with an admin-only HTTP `POST` that streams to disk.
  - It checks origin and session like the other admin routes (review note: the `/plugin-ui/` and
    `/plugin-assets/` handlers in `frameHost.ts` show the origin pattern; a plain-http LAN origin must pass,
    `feedback_no_back_compat_before_distribution`).
  - It is capped by `SP_PLUGIN_PACKAGE_MAX_MB`, and it works over LAN http.
  - That removes the 70 MB ceiling and the whole-file buffer.
- `npm run plugin:install -- <path>` accepts a `.serene` file as well as a folder.
- `docs/hosting.md` "Install very large packages from disk" shrinks to the no-browser case.

### K7 — Picker, drop and download (owner **U**)

- **Picker:** `accept=".serene,.zip,application/zip,application/octet-stream"`. Android's picker
  filters by MIME type and may not match an unknown extension, so test it in the APK. The content
  check in K3 is what really decides.
- **Drop:** a package dropped on **Admin › Plugins** stages it for review.
- **Download:** the in-app export downloads as `<slug>-<version>.serene`, with the MIME type named
  in ★P5.
- **OS file association:** the desktop launcher opening Admin › Plugins with the file staged is
  later (★P3).

### K8 — Limits and accounting (owner **H**)

- `SP_PLUGIN_PACKAGE_MAX_MB` counts the file. Nothing is compressed, so that equals what it holds.
- `SP_PLUGIN_FILES_MAX` counts entries.
- The support report's **Plugin disk use** reads the file sizes.
- Backups: ★P7.

### K9 — Licence, README and credits reach the admin (owner **U**)

- The install review shows the SPDX licence with its full text a click away, the README rendered
  (sanitised), and the credits with links.
- The plugin's page in Admin › Plugins keeps showing them after install.
- This closes life-sim readiness c41. It also carries that port's conditions: credit and a link
  back.

### K10 — Canon and docs (owner **W**)

- NOMENCLATURE §24 pass for `.serene`, the package index and the inner folder name; §25 rows.
- STYLE-GUIDE copy rule: **package (.serene)**.
- `docs/plugins.md`, `docs/hosting.md`, the SDK's `your-first-plugin.md` (Package and check) and
  `guides/package-format.md`.
- The release notes for whichever release ★P1 picks.

## 4. What this does not do

- **Signing.** It needs a story for whose keys to trust. A later `format` adds a signature member.
- **A catalogue or registry.** The package hash (K1) is what one would pin.
- **Packages of lorebooks, characters or rules alone.** The name leaves room for them; nothing here
  designs them. Readiness-plan ★E1 keeps lorebook export a separate choice for 0.6.
- **Compression** (D1).

## 5. Order (sketch)

1. K1 and K2 (SDK) first.
2. Then K3–K6 (server) beside K7 and K9 (UI).
3. Then K10, then V.

V walks:
- build → upload over HTTP → install;
- serve an asset, and an audio range, from the file;
- upgrade with a changed bundle (lands Disabled, as ruled) → old file culled at restart;
- uninstall;
- a legacy deflated `.zip` repacked;
- a package near 400 MB;
- the Android APK picker;
- Windows delete-while-open.

## 6. Open ★ (recommended default first)

| ★ | Question | Recommended |
| --- | --- | --- |
| P1 | Ship in 0.6 or 0.7? | **0.7**, when the format freezes with SDK 1.0. Nothing here needs a migration, so it isn't tied to RC1. The two weeks before RC1 belong to the floor fixes. If plugins surface in 0.6 (readiness ★D1), K6 alone (HTTP upload) is the piece worth pulling forward. |
| P2 | Keep small `ui` text in `plugin_files.content`, or read everything from the file? | Read from the file, with an in-memory cache; one source of truth. `content` then stays as a nullable column for legacy rows until the 0.7 squash; no migration |
| P3 | Desktop file association: when? | After 0.7 |
| P4 | Names: `serene-package.json` (the package index) and `plugin/` | §24 pass; these are working names |
| P5 | MIME type for downloads, e.g. `application/vnd.serenepub.package+zip` | Decide only when Serene Pub serves packages (export, catalogue) |
| P6 | Repack legacy `.zip` and folders into `.serene` at install? | Yes; one runtime path |
| P7 | Backups include `plugins/*.serene`? | Yes: one file per version makes it cheap. Today's backup covers the database only (inferred), so a restore can name package files that aren't there. Check that first. |

## Ledger

- 2026-10-30 (later still) — plugins ruled on in 0.6; K6 built by readiness lane P against the `.zip` layout.
- 2026-10-30 (later) — reviewed under the owner's go: ★P1 default (0.7) taken, three gap notes added (index
  order, writer placement, LAN origin); no code.
- 2026-10-30 — drafted from the owner's ruling (stored zip, read in place, `.serene`). Facts read
  from the SDK CLI, `plugins/install.ts`, `sockets/pluginPackages.ts`, `frameHost.ts`, `schema.ts`,
  `db/backup.ts` and the Admin › Plugins page.
