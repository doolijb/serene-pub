/**
 * The "is there a newer release" check, and the one gate that stops it running
 * at all on a pre-release build.
 *
 * Lifted out of hooks.server.ts so the gate is testable. The requirement is
 * that a pre-release must never *call GitHub about versions* — not that it
 * calls and discards the answer — and the only way to assert that is to be
 * able to import this in isolation and prove fetch was never invoked. Hooks
 * cannot be imported that way (bootstrapEnv, the db, the socket server all
 * come with it), so the logic moved and hooks kept the trigger.
 *
 * `checkForUpdates` is deliberately NOT exported. maybeCheckForUpdates() is
 * the only door in, so the pre-release gate cannot be walked around by a
 * future caller reaching for the inner function.
 *
 * Module-level mutable state, same as it was in hooks: one process-wide
 * answer, refreshed at most daily. Tests isolate with vi.resetModules().
 */
import {
	isPrereleaseVersion,
	pickNotifiableRelease
} from "$lib/shared/utils/releaseChannel"

// The full release list, NOT /releases/latest. GitHub's "latest" endpoint
// excludes pre-releases by definition, so a beta install could never be told
// about a newer beta through it — the channel filtering below needs to see
// every release and decide for itself.
export const GITHUB_API_URL =
	"https://api.github.com/repos/doolijb/serene-pub/releases?per_page=30"

/** Re-check no more than once a day. Deliberately lazy rather than a timer:
 * an idle server has nobody to notify, and this keeps the check tied to
 * someone actually loading the app. */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

let latestReleaseTag: string | undefined = undefined
let isNewerReleaseAvailable: boolean | undefined = undefined
/** 0 means "never checked". Compared against UPDATE_CHECK_INTERVAL_MS so a
 * long-lived server re-checks daily instead of once per process. */
let lastUpdateCheckAt = 0
let updateCheckInFlight: Promise<void> | null = null

export interface UpdateState {
	latestReleaseTag?: string
	isNewerReleaseAvailable?: boolean
}

/** Whatever the last completed check concluded. Both fields stay undefined on
 * a pre-release build, because no check ever runs there. */
export function getUpdateState(): UpdateState {
	return { latestReleaseTag, isNewerReleaseAvailable }
}

async function checkForUpdates(currentVersion: string) {
	try {
		console.log("[VersionCheck] Checking for new release...")
		const res = await fetch(GITHUB_API_URL, {
			headers: { Accept: "application/vnd.github+json" },
			signal: AbortSignal.timeout(5000)
		})
		if (!res.ok) {
			console.warn(
				`[VersionCheck] Failed to fetch releases: HTTP ${res.status}`
			)
			return
		}

		const data = await res.json()
		if (!Array.isArray(data)) {
			console.warn("[VersionCheck] Unexpected response shape; ignoring.")
			return
		}

		// Drafts are not published to anyone. `prerelease` is NOT used to filter
		// here — the tag name is the authority, since that is what encodes the
		// channel (-beta / -rc-N / -pr-N) and what the ladder understands.
		const tags: string[] = data
			.filter((r: any) => r && !r.draft && typeof r.tag_name === "string")
			.map((r: any) => r.tag_name)

		const notifiable = pickNotifiableRelease(currentVersion, tags)

		latestReleaseTag = notifiable ?? undefined
		isNewerReleaseAvailable = notifiable !== null

		if (notifiable) {
			console.log(
				`[VersionCheck] Current: ${currentVersion} — update available: ${notifiable}`
			)
		} else {
			console.log(
				`[VersionCheck] Current: ${currentVersion} — no newer release on this channel.`
			)
		}
	} catch (err) {
		// Most likely cause is no internet connection (DNS failure, timeout,
		// offline); this is expected in offline/air-gapped deployments, so
		// don't log a scary stack trace for it.
		const reason = err instanceof Error ? err.message : String(err)
		console.warn(
			`[VersionCheck] Could not check for new release (likely no internet connection): ${reason}`
		)
	} finally {
		// Stamped even on failure, so an offline server retries once a day
		// rather than on every single request.
		lastUpdateCheckAt = Date.now()
	}
}

/**
 * Run the check if it is due, and if this build is allowed to run it at all.
 *
 * Returns the in-flight promise when it started (or joined) one, else null —
 * callers fire-and-forget, tests await.
 *
 * Three reasons to do nothing, in order:
 *
 *  1. **This is a pre-release.** A pre-release build is not a production
 *     install and must not behave like one: it never contacts the GitHub API
 *     about versions, so there is no request to see in a proxy log, no
 *     rate-limit budget spent, and nothing for a downstream consumer to
 *     render. This is the gate, and it is first for a reason.
 *  2. A check is already running — a burst of concurrent requests must not
 *     launch several fetches at once.
 *  3. The last one was less than a day ago.
 */
export function maybeCheckForUpdates(
	currentVersion: string
): Promise<void> | null {
	if (isPrereleaseVersion(currentVersion)) return null
	if (updateCheckInFlight) return updateCheckInFlight
	if (Date.now() - lastUpdateCheckAt <= UPDATE_CHECK_INTERVAL_MS) return null

	updateCheckInFlight = checkForUpdates(currentVersion).finally(() => {
		updateCheckInFlight = null
	})
	return updateCheckInFlight
}
