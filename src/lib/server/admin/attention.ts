/**
 * The admin Overview's **Needs you** list, from gathered facts.
 *
 * Pure on purpose: the gathering (`overview.ts`) is a dozen reads across
 * five subsystems, and the part worth pinning with tests is the judgement —
 * which fact is an error, which is merely something to act on, and which
 * section's button fixes it. Nothing here reads the database or the clock.
 *
 * Levels follow the status vocabulary (STYLE-GUIDE §6.11): `error` is broken
 * or needed-and-missing, `attention` is something to act on that has not
 * failed yet.
 */

import { capabilityLabel, type CapabilityId } from "@serene-pub/sdk"
import { TunnelStatuses } from "$lib/shared/constants/Tunnels"

type Overview = Sockets.Admin.Overview.Response
type AttentionItem = Sockets.Admin.Overview.AttentionItem

export type OverviewFacts = Omit<Overview, "attention">

/** The one model job whose absence stops every session replying. */
const CHAT_CAPABILITY = "text->text"

/** A backup older than this, with daily backups on, means the schedule is not running. */
export const STALE_BACKUP_MS = 48 * 60 * 60 * 1000

const plural = (n: number, one: string, many = one + "s") =>
	`${n} ${n === 1 ? one : many}`

/** "a, b and 3 more" — the first two names of a list. */
const firstTwo = (names: readonly string[]) =>
	`${names.slice(0, 2).join(", ")}${names.length > 2 ? ` and ${names.length - 2} more` : ""}`

export function attentionFor(facts: OverviewFacts, now: number): AttentionItem[] {
	const out: AttentionItem[] = []

	// Chat with nothing registered: no session can reply. Only chat, because
	// "demanded" means some node in the catalog can use a capability, not that
	// anything on this pub will — image generation and embeddings are demanded
	// on every fresh pub, embeddings fall back to keyword search, and a
	// permanent red row nobody can act on teaches people to ignore this list.
	// A run that does fail for want of one shows under failed runs, and
	// Defaults marks every unset demanded job either way.
	for (const m of facts.models.missing) {
		if (m.capability !== CHAT_CAPABILITY) continue
		out.push({
			id: `models:missing:${m.capability}`,
			level: "error",
			title: `${capabilityLabel(m.capability as CapabilityId)} has no model`,
			detail: m.requiredBy.length
				? `Needed by ${m.requiredBy.slice(0, 2).join(", ")}${m.requiredBy.length > 2 ? ` and ${m.requiredBy.length - 2} more` : ""}. Runs that need it will fail.`
				: "A pipeline needs it. Runs that need it will fail.",
			section: "/admin/defaults",
			// Lands on that job's row (defaults/Page.svelte, `data-field`).
			action: {
				label: "Choose a model",
				href: `/admin/defaults#default:${m.capability}`
			}
		})
	}

	// A default whose host stopped listing its models: every job registered
	// to it is about to fail. Only defaults — a connection nothing relies on
	// may be switched off on purpose, and a permanent red row for it is the
	// noise the comment above warns about. The Connections view shows every
	// sync error either way.
	for (const c of facts.models.syncErrors) {
		if (!c.capabilities.length) continue
		const jobs = c.capabilities.map((id) => capabilityLabel(id as CapabilityId))
		out.push({
			id: `connections:syncError:${c.connectionId}`,
			level: "error",
			title: `${c.name} is not answering`,
			detail: `It is the default for ${firstTwo(jobs)}, and its last model sync failed: ${c.error}`,
			section: "/admin/connections",
			// Lands on that connection's Models card, beside its Refresh.
			action: {
				label: "Open connection",
				href: `/admin/connections/${c.connectionId}#models`
			}
		})
	}

	const failed = facts.pipelines.runs24h.failed
	if (failed > 0) {
		out.push({
			id: "pipelines:failedRuns",
			level: "error",
			title: `${plural(failed, "pipeline run")} failed today`,
			detail: `${failed} of ${facts.pipelines.runs24h.total} runs in the last 24 hours ended in an error.`,
			section: "/admin/pipelines",
			// The recent-runs feed, narrowed to the failures.
			action: {
				label: "See failed runs",
				href: "/admin/pipelines?runs=failed#recent-runs"
			}
		})
	}

	// A tunnel on file while accounts are off can never start: the server
	// refuses a public instance with no account boundary.
	const tunnelNeedsAccounts =
		facts.network.tunnelAvailable &&
		facts.network.tunnelConfigured &&
		!facts.app.accountsEnabled

	// The supervisor gave up restarting it, or it failed to start: the row
	// says `error` until the next start, stop or boot. Keyed on the status the
	// supervisor wrote, never on `enabled`, which a failure also clears. While
	// accounts are off that is the fix to show, so this one waits behind it.
	if (
		facts.network.tunnelAvailable &&
		facts.network.tunnelStatus === TunnelStatuses.ERROR &&
		!tunnelNeedsAccounts
	) {
		out.push({
			id: "network:tunnelFailed",
			level: "error",
			title: "Your tunnel stopped",
			detail: facts.network.tunnelLastError
				? `It failed and is not running: ${facts.network.tunnelLastError}`
				: "It failed and is not running.",
			section: "/admin/network",
			// The Tunnel card, where its status line and Start button are.
			action: { label: "Open the tunnel", href: "/admin/network#tunnel-heading" }
		})
	}

	if (tunnelNeedsAccounts) {
		out.push({
			id: "network:tunnelNeedsAccounts",
			level: "attention",
			title: "Your tunnel needs accounts",
			detail: "A tunnel is set up, but it cannot start until accounts are on.",
			section: "/admin/general",
			action: { label: "Turn on accounts", href: "/admin/general#accounts" }
		})
	}

	if (facts.data.dailyBackups) {
		const at = facts.data.lastBackupAt ? Date.parse(facts.data.lastBackupAt) : NaN
		const stale = !Number.isFinite(at) || now - at > STALE_BACKUP_MS
		// The last daily attempt failed, and no backup (daily or by hand) has
		// been taken since. It says why, so it replaces the stale row rather
		// than sitting beside it: two rows for one missing backup.
		const failure = facts.data.lastBackupFailure
		const failedAt = failure ? Date.parse(failure.at) : NaN
		const failed =
			!!failure && (!Number.isFinite(at) || !Number.isFinite(failedAt) || failedAt > at)
		if (failed) {
			out.push({
				id: "data:backupFailed",
				level: "error",
				title: "The daily backup failed",
				detail: `The last attempt did not finish: ${failure!.message}`,
				section: "/admin/data",
				action: { label: "Back up now", href: "/admin/data#backup-now" }
			})
		} else if (stale) {
			out.push({
				id: "data:staleBackup",
				level: "attention",
				title: Number.isFinite(at)
					? "No backup in two days"
					: "No backup yet",
				detail: "Daily backups are on, but none has been taken recently.",
				section: "/admin/data",
				// Lands on the button itself, focused: one press from here.
				action: { label: "Back up now", href: "/admin/data#backup-now" }
			})
		}
	}

	// Only while something is installed: 0.6.0 ships with the sandbox off,
	// and a permanent item on every fresh install would teach people to
	// ignore this list.
	if (!facts.extensions.sandboxEnabled && facts.extensions.pluginCount > 0) {
		out.push({
			id: "extensions:sandboxOff",
			level: "attention",
			title: "Plugins are not running",
			detail: `${plural(facts.extensions.pluginCount, "plugin")} installed, but the plugin sandbox is off (SP_PLUGINS_ENABLED).`,
			section: "/admin/plugins",
			// The fix is an environment variable; the notice links its guide.
			action: {
				label: "How to turn it on",
				href: "/admin/plugins#plugin-sandbox"
			}
		})
	}

	// A changed bundle arrives turned off, and a permission nobody has looked
	// at is refused: either way the plugin waits on an admin.
	const waiting = facts.extensions.awaitingReview
	if (waiting.length > 0) {
		out.push({
			id: "plugins:awaitingReview",
			level: "attention",
			title: `${plural(waiting.length, "plugin")} waiting for review`,
			detail: `${firstTwo(waiting)}. An updated plugin stays off, and permissions nobody has reviewed are refused, until you do.`,
			section: "/admin/plugins",
			action: { label: "Review plugins", href: "/admin/plugins#installed-plugins" }
		})
	}

	// Errors first, then the rest, each in the order found.
	return [
		...out.filter((a) => a.level === "error"),
		...out.filter((a) => a.level !== "error")
	]
}
