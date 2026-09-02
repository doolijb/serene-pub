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
			installDir: INSTALL,
			readFile: files({
				[dataEnv]: "PORT=4000\n",
				[installEnv]: "PORT=5000\n"
			}),
			dataDirFallback: FALLBACK
		})
		expect(plan.applied.PORT).toBeUndefined()
		expect(plan.legacyKeys).toEqual([])
	})

	test("<dataDir>/.env beats <installDir>/.env", async () => {
		const { planEnvLoad } = await load()
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: DATA },
			installDir: INSTALL,
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
			installDir: INSTALL,
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
			installDir: INSTALL,
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
			installDir: INSTALL,
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

	test("a relative data directory resolves against the launch directory", async () => {
		const { planEnvLoad } = await load()
		const portable = path.resolve(process.cwd(), "data", ".env")
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: "./data" },
			installDir: INSTALL,
			readFile: files({ [portable]: "PORT=4000\n" }),
			dataDirFallback: FALLBACK
		})
		expect(plan.dataEnvPath).toBe(portable)
		expect(plan.applied.PORT).toBe("4000")
	})

	test("a data directory that IS the install directory reads one file once", async () => {
		const { planEnvLoad } = await load()
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: INSTALL },
			installDir: INSTALL,
			readFile: files({ [installEnv]: "PORT=4000\n" }),
			dataDirFallback: FALLBACK
		})
		expect(plan.load).toEqual([installEnv])
		expect(plan.applied.PORT).toBe("4000")
		// It is the data-directory file at that point, so nothing is deprecated.
		expect(plan.legacyKeys).toEqual([])
	})
})

describe("planEnvLoad deprecation record", () => {
	test("records only the keys the install .env actually supplied", async () => {
		const { planEnvLoad } = await load()
		const plan = planEnvLoad({
			processEnv: { SERENE_PUB_DATA_DIR: DATA, ORIGIN: "https://real" },
			installDir: INSTALL,
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
			installDir: INSTALL,
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
			installDir: INSTALL,
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
				installDir,
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

	test("defaultDataDir() returns an absolute path", async () => {
		const { defaultDataDir } = await load()
		expect(path.isAbsolute(defaultDataDir())).toBe(true)
	})
})
