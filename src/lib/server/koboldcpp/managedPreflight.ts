/**
 * "Make sure the managed koboldcpp is up with the model I need loaded."
 *
 * Lifted wholesale out of `KoboldCppManagedAdapter.preflight()`, because both
 * kinds of managed connection need exactly this and only one of them has a
 * generation attached. A `koboldcpp_managed` row asks for its text GGUF before
 * writing a reply; a `koboldcpp_managed_image` row asks for its image model
 * before drawing. Same process, same admin API, same subprocess manager, same
 * baseUrl-keyed TTL — the only thing that differs is which model is named.
 *
 * Living here rather than on the adapter removes two traps rather than handling
 * them:
 *
 *   - Nothing constructs an adapter for the image path any more. The old
 *     entry point had to fabricate a `sampling`/`session`/`contextConfig` shaped
 *     object because `KoboldCppAdapter`'s constructor is the GENERATION
 *     constructor and dereferences `sampling.contextTokens` to compute
 *     `tokenLimit` — it threw a TypeError before `preflight()` ever ran, and the
 *     one test covering the path had stubbed the whole class, so it was
 *     invisible.
 *   - Nothing borrows a context size any more. `contextSize` lives INSIDE the
 *     text request, so an image request has none to invent, and an image-only
 *     .kcpps emits no `contextsize` key at all — it cannot disagree with the
 *     next text load and force a reload nobody asked for.
 */

import { db } from "$lib/server/db"
import * as subprocessManager from "$lib/server/koboldcpp/subprocessManager"
import { pingKoboldCPP } from "$lib/server/koboldcpp/kcppHttp"
import { ensureModelLoaded, type ManagedModelRequest } from "./modelManager"
import { modelsDirFor, resolveModelPath } from "./modelsDir"

// ensureModelLoaded() already waits out a normal, in-progress load — these
// retries exist only for the rarer case where the subprocess itself needs a
// fresh respawn (it genuinely crashed rather than just being slow). Each
// attempt here is a full "check/spawn/load" pass, not a quick recheck, so
// this stays a small, short list rather than a long one — the whole point
// of one user action (a summary, a message, a picture) failing outright
// shouldn't be "the respawn needed a 4th try" territory; a handful with light
// backoff covers a real crash-and-recover without turning a genuine,
// non-transient failure (bad config, disabled manager) into a long silent wait
// before the user sees anything.
const PREFLIGHT_RETRY_DELAYS_MS = [2000, 4000]

type KoboldCppSettings = NonNullable<
	Awaited<ReturnType<typeof db.query.koboldCppSettings.findFirst>>
>

/** `Omit` over a union member-by-member. The plain form collapses to the keys
 * the two variants share, which would erase every knob. */
type DistributiveOmit<T, K extends keyof never> = T extends unknown
	? Omit<T, K>
	: never

/**
 * A model request as a CALLER states it: which model and how to load it, with
 * no filesystem path. Which directory that filename lives in is a two-column
 * question and this module answers it, so a caller cannot get it wrong.
 */
export type ManagedModelSpec = DistributiveOmit<ManagedModelRequest, "path">

/**
 * Where the named model actually is on disk.
 *
 * `mustExist`, so a filename that has been deleted or moved out from under the
 * app fails HERE, naming the file, rather than reaching koboldcpp — which does
 * not skip a model it cannot open, it calls `exit_with_error` and the process
 * dies. It is also what makes an existing install's models keep loading with
 * nothing migrated: the resolver retries the other directory, so an image model
 * still sitting in the old flat `models/llm` folder is found in place.
 */
async function resolveRequestPath(
	spec: ManagedModelSpec,
	settings: KoboldCppSettings
): Promise<string> {
	// No directory configured at all is the legacy shape and still supported:
	// the bare filename goes into the .kcpps and koboldcpp resolves it against
	// its own working directory, exactly as it did before there was a models
	// directory setting. Nothing to contain it against, and nothing to stat.
	if (!modelsDirFor(spec.kind, settings)) return spec.file
	return resolveModelPath(spec.kind, spec.file, settings, { mustExist: true })
}

/**
 * Start the managed instance if we own it, and load the model this request
 * names. Retries a genuine crash-and-respawn; fails fast on anything that
 * won't be different next time.
 *
 * Returns the base URL the instance was actually reached at — a managed row's
 * own `baseUrl` column is not authoritative and is not kept in sync.
 */
export async function ensureManagedReady(
	spec: ManagedModelSpec,
	opts: { connectionId: number; signal?: AbortSignal }
): Promise<{ baseUrl: string }> {
	const settings = await db.query.koboldCppSettings.findFirst()
	if (!settings?.koboldCppManagerEnabled) {
		throw new Error(
			"KoboldCPP Manager is disabled. Enable it in Settings to use this connection."
		)
	}
	if (!spec.file) {
		throw new Error("No model selected for this connection.")
	}
	const adminDir = settings.koboldCppManagedBinaryDir
	if (!adminDir) {
		throw new Error(
			"KoboldCPP Manager needs an Admin Directory configured — set one in Settings."
		)
	}

	// Resolved once, outside the retry loop: a file that isn't there won't be
	// there on the second attempt either, and there is no point spawning a
	// process to load it.
	const modelPath = await resolveRequestPath(spec, settings)
	const request: ManagedModelRequest =
		spec.kind === "text"
			? { ...spec, path: modelPath }
			: { ...spec, path: modelPath }

	const baseUrl = settings.koboldCppManagerBaseUrl
	const totalAttempts = PREFLIGHT_RETRY_DELAYS_MS.length + 1
	for (let attemptNum = 1; ; attemptNum++) {
		try {
			await attemptLoad(settings, adminDir, request, opts, attemptNum)
			return { baseUrl }
		} catch (err: any) {
			if (opts.signal?.aborted) throw err
			const delayMs = PREFLIGHT_RETRY_DELAYS_MS[attemptNum - 1]
			if (delayMs === undefined) throw err
			console.warn(
				`[KoboldCPP] preflight: attempt ${attemptNum}/${totalAttempts} failed (${err?.message || err}) — retrying in ${delayMs}ms...`
			)
			await new Promise((r) => setTimeout(r, delayMs))
		}
	}
}

/** One full "make sure the server is up and the right model is loaded"
 * pass. Always re-verifies actual liveness with a real ping rather than
 * trusting subprocessManager's in-memory isRunning() flag, which can go
 * stale (a health-check false-positive, or the process having exited/been
 * restarted outside this app's tracking) — so every request gets a
 * fresh check, not just the first one after a cold start. */
async function attemptLoad(
	settings: KoboldCppSettings,
	adminDir: string,
	request: ManagedModelRequest,
	opts: { connectionId: number; signal?: AbortSignal },
	attemptNum: number
): Promise<void> {
	const baseUrl = settings.koboldCppManagerBaseUrl
	const alreadyResponding = await pingKoboldCPP(baseUrl, 3000)

	// Only spawn a subprocess in "managed" mode — in "external" mode the
	// user's own koboldcpp instance is expected to already be running
	// with the admin API enabled.
	if (!alreadyResponding && settings.koboldCppManagedMode !== "managed") {
		// Nothing is listening and we're not allowed to spawn anything —
		// left uncaught, this surfaces as a bare "fetch failed"/ECONNREFUSED
		// from ensureModelLoaded() below, which reads like an app bug rather
		// than a config/timing issue (e.g. Manager was switched to
		// "External" or disabled from the settings screen — possibly
		// mid-generation — while nothing external was actually running).
		throw new Error(
			`KoboldCPP is not reachable at ${baseUrl} and the Manager is in "${settings.koboldCppManagedMode ?? "unset"}" mode, so it can't be auto-started. Either start KoboldCPP externally, or switch the Manager to "Managed" mode in Settings.`
		)
	}
	if (settings.koboldCppManagedMode === "managed" && !alreadyResponding) {
		console.log(
			`[KoboldCPP] preflight attempt ${attemptNum}: subprocess not responding, starting...`
		)
		try {
			await subprocessManager.start()
		} catch (err: any) {
			console.error(
				`[KoboldCPP] preflight attempt ${attemptNum}: subprocess start FAILED:`,
				err
			)
			throw new Error(
				`KoboldCPP managed subprocess failed to start: ${err?.message || err}`
			)
		}
		console.log(
			`[KoboldCPP] preflight attempt ${attemptNum}: subprocess started`
		)
	}

	console.log(
		`[KoboldCPP] preflight attempt ${attemptNum}: connection`,
		opts.connectionId,
		`${request.kind} model`,
		request.file,
		request.kind === "text" ? `contextSize ${request.contextSize}` : ""
	)

	// A model load can leave koboldcpp unresponsive to other requests for
	// minutes on a large GGUF/slow disk — well beyond the health check's
	// own failure-tolerance window. Suspend it for the duration so a slow
	// load can never be mistaken for a crash and have its process torn
	// down while this exact request is still waiting on it.
	subprocessManager.suspendHealthCheck()
	try {
		await ensureModelLoaded({
			connectionId: opts.connectionId,
			request,
			baseUrl,
			adminDir,
			adminPassword: settings.koboldCppManagedAdminPassword ?? "",
			ttlSecs: settings.koboldCppManagedModelTtlSecs ?? 300,
			signal: opts.signal,
			// Only trust process liveness as the wait signal when we
			// actually spawned/own this subprocess — an adopted external
			// instance has no such guarantee, so ensureModelLoaded falls
			// back to its fixed-timeout tolerance for that case instead.
			isAlive:
				settings.koboldCppManagedMode === "managed" &&
				!subprocessManager.isExternal()
					? () => subprocessManager.isRunning()
					: undefined
		})
		console.log(
			`[KoboldCPP] preflight attempt ${attemptNum}: ensureModelLoaded completed OK`
		)
		subprocessManager.pingActivity()
	} catch (err: any) {
		console.error(
			`[KoboldCPP] preflight attempt ${attemptNum}: ensureModelLoaded FAILED:`,
			err
		)
		// Name the model that was actually asked for. A text and an image model
		// never share a .kcpps, so a failed load has exactly one candidate and
		// saying which one it was is the difference between "chat stopped
		// working" and a file the user can go and look at.
		const named = `The ${request.kind} model "${request.file}" failed to load`
		// An externally-owned instance almost certainly has a different
		// --adminpassword and --admindir than this Manager is configured
		// with, so the admin API call above (reload_config) is expected to
		// be rejected — surface that explanation instead of the raw,
		// undiagnosable "rejected the request" error.
		if (settings.koboldCppManagedMode === "external") {
			throw new Error(
				`${named}. KoboldCPP at ${baseUrl} rejected the model-load request: ${err?.message || err}. Make sure it was started with --admin --adminpassword <matching the one configured here> --admindir <matching the one configured here>.`
			)
		}
		if (subprocessManager.isExternal()) {
			throw new Error(
				`${named}. KoboldCPP is running on this port but wasn't started by this Manager, so its admin password/directory don't match — model loading was rejected: ${err?.message || err}. Stop the external instance and let the Manager start its own, or point this Manager at a different port.`
			)
		}
		throw new Error(`${named}: ${err?.message || err}`)
	} finally {
		subprocessManager.resumeHealthCheck()
	}
}
