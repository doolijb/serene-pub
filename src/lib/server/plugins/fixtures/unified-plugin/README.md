# `demo.unified` — a built plugin package, checked in

The output of `serene-pub build` over the SDK's `sdk-tests/fixtures/unified-plugin`
acceptance fixture (D-1), with the frame document the fixture declares and does
not ship.

Checked in **built** rather than built in-process by the tests that use it,
because what is under test here is the app's reading of a package on disk. A
test that ran the packager first would depend on the SDK's `dist` being current,
which it is not between an SDK edit and `npm run sdk:build`, and would fail for
a reason that has nothing to do with the install.

Regenerate with:

    node ../serene-pub-sdk/cli/dist/bin.js build \
      ../serene-pub-sdk/sdk-tests/fixtures/unified-plugin --out <tmp>

then copy `manifest.json`, `bundle.js`, `pipelines/` and `components/` into
`dist/plugin/` here. (Run it with `npx tsx ../serene-pub-sdk/cli/src/bin.ts` instead when the
SDK's `dist` is older than the packager change you are regenerating for.) `ui/`
is this fixture's own: the SDK fixture declares `ui/tally.html` and ships no
file, because nothing on that side mounts one.

`bundle.js` is the code half (D-6b): one self-contained CJS source assigning
`module.exports = { hooks: { tallyHandler } }`, with the SDK inlined — the
sandbox has no module resolution, so nothing is left external. It is what makes
the handler actually dispatch; without it the package installs its declarations
and none of its code.

**Two hand edits, and both have to be re-applied.** `bundle.js` gets a leading
`// @ts-nocheck`: it is build output living under `src/`, where the app's
`checkJs` reads it as source and `npm run check` answers with five hundred
errors in a file nobody wrote. (Nothing else needs it — a plugin repo's own
tsconfig includes `src` and never its `dist`.)

And to the copied manifest: the genre gains a `shape`. `GenreDecl.shape` is optional in the SDK and the SDK's
fixture declares none, because nothing on that side lists genres; the app's
`listSessionGenres` filters on it, so a shapeless genre installs and is offered
by no picker. `readPluginPackage` refuses one for that reason, and the fixture
has to be a package it accepts. (Both showcase plugins declare a shape — this
is the SDK fixture being minimal, not a real package's shape.)

What it exercises, deliberately:

- a genre (`demo.unified:genre/tally`) whose create spec carries **no**
  `meta.genre` — so the install has to supply the declaration from the manifest
  or the picker card comes up blank;
- two pipelines, one of them using the package's own node definition;
- a config over its **own** spec and one over **somebody else's**
  (`core:spec/chat-respond`), which is also the package's one `requires` entry;
- a prompt in D-1's `prompts` vocabulary rather than `templates`;
- a preset binding both of the genre's events;
- a component widget (`widgets[0].component: 'tally'`) whose component places
  `ui/tally.html` as an `sp-frame` — hand-edited into `manifest.json` (the frame
  widget retired 2026-10-02), with `dist/plugin/components/tally.js` a hand-written
  stand-in for the built module (`// @ts-nocheck`, as `bundle.js`); the `bundle.js`
  still inlines an older SDK's checks, which nothing calls;
- a node definition with `hooks.nodeHandlers` naming the exported function that
  implements it, and the bundle that exports it — the three seams D-6b closed.
