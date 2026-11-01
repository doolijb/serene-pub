/**
 * The package's own files — `ctx.package.read(path)` (M2a, readiness a3).
 *
 * A plugin ships files under its manifest's `assets: { dir }` folder; frames
 * reach them at `/plugin-assets/<id>/<version>/<path>` and this is the same
 * door for a handler. `makePackageHost(config)` runs in the **worker's Node
 * scope**, outside the sandbox, exactly as `storageHost` does: the guest never
 * sees `fs`, only the `read` on the handle, endowed (SES) or bridged (QuickJS)
 * in and then adapted to the SDK's `PackageFiles` shape by the prelude's
 * `__wrapPackage` (bytes cross as base64; the guest gets a Uint8Array).
 *
 * Read-only, and nothing else: no listing, no exists, no write. The jail is
 * the whole of the security:
 *  - the path is the one a frame appends to `assetsBase` — package-relative,
 *    so it starts with the assets folder's name (`assets/worlds/a.json`);
 *  - absolute paths, `..` segments and NULs are refused;
 *  - the resolved path must stay under the assets folder, and so must its
 *    **realpath** (a symlink out is refused), and it must be a file;
 *  - `lang/` and `ui/` are outside the folder, so they are refused.
 *
 * Every refusal is the same sentence, so a missing file and a file outside the
 * folder are indistinguishable to the guest: the host does not tell a plugin
 * what exists beyond its assets.
 *
 * Kept as an embeddable source string because the eval workers cannot import
 * modules; the unit test evaluates this string.
 */
import { join } from "node:path"
import { permissionKey, type PermissionConfig } from "./storageHost"
import { pluginPackageDirOf } from "./packageDir"

/** Where a plugin's assets are on disk: the package folder, and the declared folder inside it. */
export interface PackageAssets {
	/** Absolute: `<dataDir>/plugins/<id>/<version>`. */
	root: string
	/** The manifest's `assets.dir`, relative to `root` (default `assets`). */
	dir: string
}

/** What a sandbox is handed at load: the storage/network grants plus the package's assets. */
export type SandboxConfig = PermissionConfig & {
	/** Present only when the manifest declares `assets: { dir }` with a safe dir. */
	packageAssets?: PackageAssets
}

/** The grants as one comparable string (a grant-only change must reload). */
export function sandboxConfigKey(config?: SandboxConfig): string {
	return permissionKey(config) + "|" + JSON.stringify(config?.packageAssets ?? null)
}

/** The assets folder a manifest declares, or undefined when it declares none or an unsafe one. */
export function safeAssetsDir(manifest: unknown): string | undefined {
	const decl = (manifest as { assets?: unknown } | null | undefined)?.assets
	if (!decl || typeof decl !== "object" || Array.isArray(decl)) return undefined
	const raw = (decl as { dir?: unknown }).dir
	const dir = typeof raw === "string" ? raw : "assets"
	const parts = dir.split("/")
	if (
		dir === "" ||
		dir.startsWith("/") ||
		dir.includes("\\") ||
		dir.includes("\0") ||
		parts.some((p) => p === "" || p === "." || p === "..") ||
		["ui", "dist", "lang"].includes(parts[0]!)
	)
		return undefined
	return dir
}

/**
 * The descriptor field for a stored row: `{ version, dir }` when the manifest
 * declares a safe assets folder, else undefined. `store.ts` spreads it into the
 * descriptor (`packageAssets: packageAssetsOfRow(row.manifest, row.version)`).
 */
export function packageAssetsOfRow(
	manifest: unknown,
	version: string | null | undefined
): { version: string; dir: string } | undefined {
	const dir = safeAssetsDir(manifest)
	return dir && version ? { version, dir } : undefined
}

/** The descriptor's assets, resolved against the data dir. */
export function packageAssetsFor(
	dataDir: string,
	pluginId: string,
	version: string,
	dir: string
): PackageAssets {
	return { root: join(dataDir, pluginPackageDirOf(pluginId, version)), dir }
}

export const PACKAGE_HOST_SOURCE = String.raw`
function makePackageHost(config) {
	var fs = require("fs");
	var path = require("path");
	var pa = config && config.packageAssets;
	function refuse(reason) { return { kind: "err", reason: reason }; }
	function notAsset(p) {
		return refuse("package: '" + String(p) + "' is not one of this package's assets");
	}
	return {
		read: function (rel) {
			if (!pa) return refuse("package: this plugin ships no assets — declare assets: { dir } in its manifest");
			if (typeof rel !== "string" || rel.length === 0) return notAsset(rel);
			if (rel.indexOf("\0") >= 0 || rel.charAt(0) === "/" || rel.charAt(0) === "\\" || /^[A-Za-z]:/.test(rel) || path.isAbsolute(rel))
				return notAsset(rel);
			var segs = rel.split(/[\\/]/);
			for (var i = 0; i < segs.length; i++) if (segs[i] === "..") return notAsset(rel);
			var folder = path.join(pa.root, pa.dir);
			var sep = folder.endsWith(path.sep) ? folder : folder + path.sep;
			var full = path.resolve(pa.root, rel);
			if (full.indexOf(sep) !== 0) return notAsset(rel);
			try {
				var realFolder = fs.realpathSync(folder);
				var realSep = realFolder.endsWith(path.sep) ? realFolder : realFolder + path.sep;
				var real = fs.realpathSync(full);
				if (real.indexOf(realSep) !== 0) return notAsset(rel);
				if (!fs.statSync(real).isFile()) return notAsset(rel);
				return { kind: "ok", value: fs.readFileSync(real).toString("base64") };
			} catch (e) {
				return notAsset(rel);
			}
		}
	};
}
`
