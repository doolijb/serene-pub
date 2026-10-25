/**
 * The default loadouts a connection fills: every capability whose registered
 * default names it as its endpoint.
 *
 * ONE reading, shared by the two places that ask "is something relying on
 * this connection?": the admin Overview's **Needs you** (a connection whose
 * model sync failed is a red item only when it fills a loadout,
 * `server/sockets/adminOverview.ts` → `server/admin/attention.ts`) and the
 * Connections view's row, which is red only in that same case
 * (`connectionRowStatus.ts`, ★R2 / PLAN-0-5-polish-parity L4.1, 2026-10-24).
 * A broken connection nothing relies on is said quietly in both.
 *
 * The endpoint half is enough, as Needs you has always read it: a
 * registration whose model the host stopped listing still points every run of
 * that job at this connection.
 */
export function loadoutsFilledBy(
	defaults:
		| Readonly<Record<string, { connectionId?: number | null } | null | undefined>>
		| null
		| undefined,
	connectionId: number
): string[] {
	if (!defaults) return []
	return Object.keys(defaults).filter(
		(capability) => defaults[capability]?.connectionId === connectionId
	)
}
