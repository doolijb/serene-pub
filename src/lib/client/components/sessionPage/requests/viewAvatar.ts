/**
 * 🚧 `view-avatar` (anyone may ask): show one participant's avatar, named by
 * the participant ref a widget was shown. A ref naming no one in this
 * session is refused.
 */

/** What this answer needs of the page. */
export interface ViewAvatarDeps<C> {
	characterForRef(ref: string): C | undefined
	viewAvatar(who: C): void
}

/** Answer one `view-avatar`. */
export function answerViewAvatar<C>(params: unknown, deps: ViewAvatarDeps<C>): void {
	const p = params as Record<string, unknown>
	const who = deps.characterForRef(String(p.ref ?? ""))
	if (!who) throw new Error(`no participant '${String(p.ref)}' in this session`)
	deps.viewAvatar(who)
}
