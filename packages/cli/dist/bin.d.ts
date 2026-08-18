#!/usr/bin/env node
/**
 * `serene-pub` — the plugin author's command line.
 *
 * Three verbs, and each one answers a question an author actually asks:
 *
 *   build     what will core see when it installs this? (manifest + documents)
 *   check     what am I doing that core will refuse, and why?
 *   contracts what types does this release give me to pin against?
 *
 * There is deliberately no `publish` and no `install`. Installing an extension is an
 * admin action inside SP, not something a build tool can do to somebody's instance —
 * a CLI that could install would be a CLI that could be scripted into installing.
 */
export declare function main(argv?: string[]): Promise<number>;
//# sourceMappingURL=bin.d.ts.map