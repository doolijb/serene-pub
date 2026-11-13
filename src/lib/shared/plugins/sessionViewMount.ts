import { appletFrontEndApis, type FrontEndApi } from "@serene-pub/sdk"

/**
 * 🚧 (m3-core) What a session view's `PluginFrame` is mounted with (plan
 * `PLAN-sdk-creation-seams` §9). An applet genre's frame holds `ui`, `session`
 * and `applet` while mounted in a session, and the launcher's grants join the
 * session's own; an ordinary genre's frame stays the default (`ui` + `session`),
 * so no `apis` is returned for it. Every grant is still bounded by the acting person.
 */
export function sessionViewMount<G extends string>(o: {
	applet: boolean
	sessionGrants: readonly G[]
	appletGrants?: readonly string[]
}): { apis?: readonly FrontEndApi[]; grants: readonly string[] } {
	if (!o.applet) return { grants: [...o.sessionGrants] }
	return {
		apis: appletFrontEndApis(true),
		grants: [...o.sessionGrants, ...(o.appletGrants ?? [])]
	}
}
