/**
 * .env moved out of the install directory because upgrades destroy that
 * directory — a self-updater swaps the folder, the portable zip extracts over
 * it, a cask replaces the whole .app. The contract worth testing is therefore
 * the precedence itself: a real environment variable always wins, the
 * data-directory file beats the legacy install-directory one, and the one
 * variable that chooses the data directory can still be set in the legacy file
 * without creating a chicken-and-egg.
 *
 * planEnvLoad() is pure so all of that is testable without a filesystem; the
 * two guards at the bottom cover the parts that are not (that dotenv really
 * behaves the way the precedence relies on, and that the data directory is
 * computed identically here and in getAppDataDir()).
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest"

// Importing the module under test runs its side effects, which would read this
// repository's own .env into the test worker's process.env. dotenv.parse is
// the real one — planEnvLoad depends on it — but config() must apply nothing.
vi.mock("dotenv", async (importOriginal) => {
	const actual = (await importOriginal()) as {
		default: { parse: unknown; config: unknown }
	}
	return {
		default: {
			...actual.default,
			config: vi.fn(() => ({ parsed: {} }))
		}
	}
})

const INSTALL = "/opt/serene-pub"
const DATA = "/home/u/.local/share/SerenePub"
const FALLBACK = "/fallback/SerenePub"

const installEnv = path.join(INSTALL, ".env")
const dataEnv = path.join(DATA, ".env")

/** A readFile stub over a path -> contents map; anything else is absent. */
function files(map: Record<string, string>) {
	return (filePath: string) =>
		Object.prototype.hasOwnProperty.call(map, filePath)
			? map[filePath]
			: null
}

async function load() {
	return await import("./preloadEnv.js")
}

beforeEach(() => {
	vi.resetModules()
})

afterAll(() => {
	delete (globalThis as unknown as Record<string, unknown>)
		.__serenePubEnvPreloaded
})

describe("planEnvLoad precedence", () => {
	test("a real environment variable beats both files", async () => {
		const { planEnvLoad } = await load()
		const plan = planEnvLoad({
			processEnv: { PORT: "9999", SERENE_PUB_DATA_DIR: DATA },
			installRoot: INSTALL,
			readFile: files({
				[dataEnv]: "PORT=4000\n",
				[installEnv]: "PORT=5000\n"
			}),
			dataDirFallback: FALLBACK
		})
		expect(plan.applied.PORT).toBeUndefined()
		expect(plan.legacyKeys).toEqual([])
	})

	test("<dataDir>/.env beats the legacy install-root .env", async () => {
		const { planEnvLoad } = await load()
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: DATA },
			installRoot: INSTALL,
			readFile: files({
				[dataEnv]: "PORT=4000\n",
				[installEnv]: "PORT=5000\nORIGIN=https://legacy.example.com\n"
			}),
			dataDirFallback: FALLBACK
		})
		expect(plan.applied.PORT).toBe("4000")
		// Still honored for anything the winning file did not supply.
		expect(plan.applied.ORIGIN).toBe("https://legacy.example.com")
		expect(plan.load).toEqual([dataEnv, installEnv])
	})

	test("neither file existing leaves nothing to apply", async () => {
		const { planEnvLoad } = await load()
		const plan = planEnvLoad({
			processEnv: {},
			installRoot: INSTALL,
			readFile: files({}),
			dataDirFallback: FALLBACK
		})
		expect(plan.applied).toEqual({})
		expect(plan.load).toEqual([])
		expect(plan.legacyKeys).toEqual([])
		expect(plan.dataDir).toBe(FALLBACK)
		expect(plan.dataDirSource).toBe("default")
		expect(plan.dataEnvPath).toBe(path.join(FALLBACK, ".env"))
	})
})

describe("planEnvLoad data directory resolution", () => {
	test("SERENE_PUB_DATA_DIR in the install .env redirects where the data .env is read from", async () => {
		const { planEnvLoad } = await load()
		const elsewhere = "/mnt/usb/serene-data"
		const plan = planEnvLoad({
			processEnv: {},
			installRoot: INSTALL,
			readFile: files({
				[installEnv]: `SERENE_PUB_DATA_DIR=${elsewhere}\nPORT=5000\n`,
				[path.join(elsewhere, ".env")]: "PORT=4000\n",
				// The default location must NOT be consulted once the install
				// file has named a different one.
				[path.join(FALLBACK, ".env")]: "PORT=1111\n"
			}),
			dataDirFallback: FALLBACK
		})
		expect(plan.dataDir).toBe(elsewhere)
		expect(plan.dataDirSource).toBe("install-env")
		expect(plan.dataEnvPath).toBe(path.join(elsewhere, ".env"))
		expect(plan.applied.PORT).toBe("4000")
	})

	test("the real environment still outranks the install .env for the data directory", async () => {
		const { planEnvLoad } = await load()
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: DATA },
			installRoot: INSTALL,
			readFile: files({
				[installEnv]: "SERENE_PUB_DATA_DIR=/mnt/usb/serene-data\n",
				[dataEnv]: "PORT=4000\n"
			}),
			dataDirFallback: FALLBACK
		})
		expect(plan.dataDir).toBe(DATA)
		expect(plan.dataDirSource).toBe("environment")
		expect(plan.applied.PORT).toBe("4000")
		expect(plan.applied.SERENE_PUB_DATA_DIR).toBeUndefined()
	})

	test("a relative data directory resolves against the install root", async () => {
		const { planEnvLoad } = await load()
		const portable = path.join(INSTALL, "data", ".env")
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: "./data" },
			installRoot: INSTALL,
			readFile: files({ [portable]: "PORT=4000\n" }),
			dataDirFallback: FALLBACK
		})
		expect(plan.dataDir).toBe(path.join(INSTALL, "data"))
		expect(plan.dataEnvPath).toBe(portable)
		expect(plan.applied.PORT).toBe("4000")
	})

	/**
	 * The regression this whole install-root mechanism exists to prevent. A
	 * release entrypoint cd's into app/ (the server resolves ./drizzle and
	 * ./build/client against the working directory), so a `./data` resolved
	 * against the working directory would put the user's database inside the
	 * one folder an update replaces wholesale — deleting it on first upgrade.
	 */
	test("a relative data directory does NOT land inside the app folder the updater replaces", async () => {
		const { planEnvLoad } = await load()
		const appDir = path.join(INSTALL, "app")
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: "./data" },
			installRoot: INSTALL,
			cwd: appDir,
			readFile: files({}),
			dataDirFallback: FALLBACK
		})
		expect(plan.dataDir).toBe(path.join(INSTALL, "data"))
		expect(plan.dataDir.startsWith(appDir + path.sep)).toBe(false)
	})

	test("an absolute data directory is passed through untouched", async () => {
		const { planEnvLoad } = await load()
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: DATA },
			installRoot: INSTALL,
			cwd: path.join(INSTALL, "app"),
			readFile: files({}),
			dataDirFallback: FALLBACK
		})
		expect(plan.dataDir).toBe(DATA)
	})

	test("the data directory is absolute even when nothing names one", async () => {
		const { planEnvLoad } = await load()
		const plan = planEnvLoad({
			processEnv: {},
			installRoot: INSTALL,
			cwd: path.join(INSTALL, "app"),
			readFile: files({}),
			dataDirFallback: FALLBACK
		})
		expect(plan.dataDir).toBe(FALLBACK)
		expect(path.isAbsolute(plan.dataDir)).toBe(true)
	})

	test("a relative data directory in the legacy .env also anchors to the install root", async () => {
		const { planEnvLoad } = await load()
		const rootEnv = path.join(INSTALL, ".env")
		const portable = path.join(INSTALL, "data", ".env")
		const plan = planEnvLoad({
			processEnv: {},
			installRoot: INSTALL,
			cwd: path.join(INSTALL, "app"),
			readFile: files({
				[rootEnv]: "SERENE_PUB_DATA_DIR=./data\n",
				[portable]: "PORT=4000\n"
			}),
			dataDirFallback: FALLBACK
		})
		expect(plan.dataDirSource).toBe("install-env")
		expect(plan.dataDir).toBe(path.join(INSTALL, "data"))
		expect(plan.applied.PORT).toBe("4000")
	})

	test("a data directory that IS the install directory reads one file once", async () => {
		const { planEnvLoad } = await load()
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: INSTALL },
			installRoot: INSTALL,
			readFile: files({ [installEnv]: "PORT=4000\n" }),
			dataDirFallback: FALLBACK
		})
		expect(plan.load).toEqual([installEnv])
		expect(plan.applied.PORT).toBe("4000")
		// It is the data-directory file at that point, so nothing is deprecated.
		expect(plan.legacyKeys).toEqual([])
	})
})

describe("planEnvLoad legacy .env location", () => {
	/**
	 * The upgrade this exists for. Before the payload moved into app/, a
	 * release put run.sh and build/ in one flat directory, so a user's .env sat
	 * at what is now the install ROOT. Extracting a new zip over that folder
	 * leaves the file exactly where it was — and the entrypoint now cd's into
	 * app/, so resolving the legacy file against the working directory would
	 * miss it and silently drop every setting in it.
	 */
	test("finds an upgraded user's .env at the install root, not in the app directory", async () => {
		const { planEnvLoad } = await load()
		const rootEnv = path.join(INSTALL, ".env")
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: DATA },
			installRoot: INSTALL,
			cwd: path.join(INSTALL, "app"),
			readFile: files({ [rootEnv]: "PORT=5000\n" }),
			dataDirFallback: FALLBACK
		})
		expect(plan.legacyEnvPath).toBe(rootEnv)
		expect(plan.load).toEqual([rootEnv])
		expect(plan.applied.PORT).toBe("5000")
		expect(plan.legacyKeys).toEqual(["PORT"])
	})

	test("falls back to the working directory when the install root has no .env", async () => {
		const { planEnvLoad } = await load()
		const appDir = path.join(INSTALL, "app")
		const appEnv = path.join(appDir, ".env")
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: DATA },
			installRoot: INSTALL,
			cwd: appDir,
			readFile: files({ [appEnv]: "PORT=5000\n" }),
			dataDirFallback: FALLBACK
		})
		expect(plan.legacyEnvPath).toBe(appEnv)
		expect(plan.applied.PORT).toBe("5000")
	})

	test("the install root wins when both legacy locations exist, and the loser is named", async () => {
		const { planEnvLoad } = await load()
		const appDir = path.join(INSTALL, "app")
		const rootEnv = path.join(INSTALL, ".env")
		const appEnv = path.join(appDir, ".env")
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: DATA },
			installRoot: INSTALL,
			cwd: appDir,
			readFile: files({
				[rootEnv]: "PORT=5000\n",
				// Deliberately NOT merged in: one file is in effect, the other
				// is reported so a disagreement between them is visible.
				[appEnv]: "PORT=6000\nHOST=127.0.0.1\n"
			}),
			dataDirFallback: FALLBACK
		})
		expect(plan.legacyEnvPath).toBe(rootEnv)
		expect(plan.legacyIgnoredPaths).toEqual([appEnv])
		expect(plan.applied.PORT).toBe("5000")
		expect(plan.applied.HOST).toBeUndefined()
	})

	/**
	 * A source checkout, Docker, or any entrypoint that exports nothing: the
	 * install root defaults to the working directory, there is one candidate,
	 * and behavior is exactly what it was before app/ existed.
	 */
	test("a run with no install root declared behaves exactly as before", async () => {
		const { planEnvLoad } = await load()
		const cwdEnv = path.join(INSTALL, ".env")
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: DATA },
			installRoot: INSTALL,
			readFile: files({ [cwdEnv]: "PORT=5000\n" }),
			dataDirFallback: FALLBACK
		})
		expect(plan.legacyCandidates).toEqual([cwdEnv])
		expect(plan.legacyEnvPath).toBe(cwdEnv)
		expect(plan.legacyIgnoredPaths).toEqual([])
	})
})

describe("planEnvLoad deprecation record", () => {
	test("records only the keys the install .env actually supplied", async () => {
		const { planEnvLoad } = await load()
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: DATA, ORIGIN: "https://real" },
			installRoot: INSTALL,
			readFile: files({
				[dataEnv]: "PORT=4000\n",
				[installEnv]:
					"PORT=5000\nORIGIN=https://legacy\nTRUSTED_PROXIES=10.0.0.0/8\n"
			}),
			dataDirFallback: FALLBACK
		})
		// PORT came from the data dir, ORIGIN from the real environment; only
		// TRUSTED_PROXIES had nowhere else to come from.
		expect(plan.legacyKeys).toEqual(["TRUSTED_PROXIES"])
	})

	test("empty when the install .env is fully shadowed — nothing to warn about", async () => {
		const { planEnvLoad } = await load()
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: DATA },
			installRoot: INSTALL,
			readFile: files({
				[dataEnv]: "PORT=4000\n",
				[installEnv]: "PORT=5000\n"
			}),
			dataDirFallback: FALLBACK
		})
		expect(plan.legacyKeys).toEqual([])
		// The file was still read, so the banner can say so.
		expect(plan.load).toEqual([dataEnv, installEnv])
	})

	test("empty when there is no install .env at all", async () => {
		const { planEnvLoad } = await load()
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: DATA },
			installRoot: INSTALL,
			readFile: files({ [dataEnv]: "PORT=4000\n" }),
			dataDirFallback: FALLBACK
		})
		expect(plan.legacyKeys).toEqual([])
		expect(plan.load).toEqual([dataEnv])
	})
})

describe("guards", () => {
	/**
	 * The whole precedence rests on dotenv not overwriting a key that is
	 * already set — including one set by an earlier config() call. package.json
	 * floats dotenv on a caret range with no lockfile, so assert it against the
	 * installed version rather than trusting the documentation.
	 */
	test("`applied` matches what real dotenv.config() actually does, in order", async () => {
		const { planEnvLoad } = await load()
		const actual = (await vi.importActual("dotenv")) as {
			default: {
				config: (o: {
					path: string
					processEnv: Record<string, string>
				}) => unknown
			}
		}

		const root = fs.mkdtempSync(path.join(os.tmpdir(), "sp-preloadenv-"))
		try {
			const installDir = path.join(root, "install")
			const dataDir = path.join(root, "data")
			fs.mkdirSync(installDir)
			fs.mkdirSync(dataDir)
			fs.writeFileSync(
				path.join(installDir, ".env"),
				"PORT=5000\nORIGIN=https://legacy\nTRUSTED_PROXIES=10.0.0.0/8\n"
			)
			fs.writeFileSync(
				path.join(dataDir, ".env"),
				"PORT=4000\nHOST=127.0.0.1\n"
			)

			const start = {
				SERENE_PUB_DATA_DIR: dataDir,
				ORIGIN: "https://real"
			}
			const plan = planEnvLoad({
				processEnv: start,
				installRoot: installDir,
				readFile: (p) => {
					try {
						return fs.readFileSync(p, "utf8")
					} catch {
						return null
					}
				},
				dataDirFallback: FALLBACK
			})

			// dotenv 16.4+ can target an object instead of process.env, so the
			// real thing can be exercised without polluting this worker.
			const applied: Record<string, string> = { ...start }
			for (const file of plan.load) {
				actual.default.config({ path: file, processEnv: applied })
			}
			expect(applied).toEqual({ ...start, ...plan.applied })
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	/**
	 * If preloadEnv.js and getAppDataDir() ever disagree about the default data
	 * directory, the app reads its database from one place and its
	 * configuration from another. preloadEnv.js is copied unbundled and cannot
	 * import $lib, so the two call sites can only be kept honest by comparing
	 * them — and getAppDataDir()'s module pulls in the database, which a unit
	 * test must not touch, so compare the source text.
	 */
	test("computes the default data directory exactly as getAppDataDir() does", () => {
		const root = path.resolve(__dirname, "../../../..")
		const call = 'envPaths("SerenePub", { suffix: "" })'
		const preload = fs.readFileSync(
			path.join(root, "src/lib/server/config/preloadEnv.js"),
			"utf8"
		)
		const utils = fs.readFileSync(
			path.join(root, "src/lib/server/utils/index.ts"),
			"utf8"
		)
		expect(preload).toContain(call)
		expect(utils).toContain(call)
	})

	/**
	 * The other half of the relative-data-dir fix, and the half that is a side
	 * effect rather than a pure function: every reader downstream
	 * (getAppDataDir() in utils/index.ts and in drizzle.config.ts,
	 * RuntimeManager's storage root) takes SERENE_PUB_DATA_DIR straight from
	 * the environment and would resolve a relative value against whatever the
	 * working directory is by then — which in a release is the app/ folder an
	 * update deletes. So the resolved absolute path is written back.
	 */
	test("rewrites a relative SERENE_PUB_DATA_DIR in the environment to an absolute path under the install root", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "sp-installroot-"))
		const saved = { ...process.env }
		try {
			process.env.SERENE_PUB_INSTALL_ROOT = root
			process.env.SERENE_PUB_DATA_DIR = "./data"
			await load()
			expect(process.env.SERENE_PUB_DATA_DIR).toBe(
				path.join(root, "data")
			)
		} finally {
			for (const key of Object.keys(process.env)) delete process.env[key]
			Object.assign(process.env, saved)
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("leaves SERENE_PUB_DATA_DIR unset when nothing set it", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "sp-installroot-"))
		const saved = { ...process.env }
		try {
			process.env.SERENE_PUB_INSTALL_ROOT = root
			delete process.env.SERENE_PUB_DATA_DIR
			await load()
			// RuntimeManager reads its presence as "the operator chose a data
			// directory" and enables plugin storage on it — writing the default
			// back would turn that on as a side effect of a path fix.
			expect(process.env.SERENE_PUB_DATA_DIR).toBeUndefined()
		} finally {
			for (const key of Object.keys(process.env)) delete process.env[key]
			Object.assign(process.env, saved)
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("defaultDataDir() returns an absolute path", async () => {
		const { defaultDataDir } = await load()
		expect(path.isAbsolute(defaultDataDir())).toBe(true)
	})
})
