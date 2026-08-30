/**
 * Shared signal: is the app header / navigation currently hovered?
 *
 * Set by Header.svelte (the top nav bar), read by SessionLayout to reveal its
 * otherwise-hidden "Layout" pull-tab only while the nav is hovered. They live
 * in different subtrees (Header and the page content are siblings under
 * <main>), so a module-level $state singleton is the simplest bridge — no
 * context plumbing through the app shell.
 */
export const navHover = $state({ over: false })
