/**
 * The grant table (plans/29 R-3) — which members each kind of plugin hook
 * finds on its `ctx`.
 *
 * Re-exported from the SDK's `hookGrants.ts`, the ONE copy (K1c): each
 * sandbox's `invoke` derives its grants from it, the boot hands its keys to
 * `assertHookSurface`, an author's harness builds its context from it, and the
 * plugin permissions guide (`guides/plugin-permissions.md`) is rendered from
 * it — so the guide cannot describe a table the sandboxes do not enforce.
 */
export {
	HOOK_CTX_KINDS,
	hookCtxGrants,
	hookCtxKeysFor,
	isHookCtxKind,
	type HookCtxGrants,
	type HookCtxKind
} from "@serene-pub/sdk"
