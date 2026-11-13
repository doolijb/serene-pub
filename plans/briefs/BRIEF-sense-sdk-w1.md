# BRIEF — `sense-sdk-w1` — the builder wires a prompt step (review row C1, assemble half)

You are a `lane-worker` under lane `sense-sdk`. SDK repo: `/home/jody/github/serene-pub-sdk`. Use absolute paths.

## Goal

An `assemble@2` (`core:task/assemble`, version 2) that feeds a model call and leaves `template` or `connection`
out of its config must compile to the **same document** as one that wires them the way core does today:

- `template` defaults to `slot.template()` (the node's own template slot);
- `connection` defaults to `slot.connectionOf('<key of the model call it feeds>')`.

A spec that already states either key keeps what it states (only `=== undefined` keys are filled). The validator's
`assemble wiring` warning **stays** (it now only fires on a document nobody built through the builder).

## Exactly how (decided by the supervisor — do not redesign)

1. **`sdk/src/builder.ts`, `SpecBuilder.build()`** — before the action handles are defined, fill the defaults on
   `this.spec.nodes`. Put the logic in one small non-exported function in the same file (e.g.
   `supplyPromptStepWiring(spec: BuiltSpec): void`), with a short doc comment saying what it writes and that the
   rule mirrors `validate()`'s `assemble wiring` law. It must be idempotent (a second `build()` changes nothing).
   - Which model call an assemble feeds — mirror `validate.ts` ~1284–1293 exactly, but over the built spec (there are
     no edges yet): walk `spec.nodes` in array order; for each node walk `collectDataRefs(node.config)` in order; the
     first ref with `ref.node === assemble.key` whose node is `kind === 'oracle'` and whose definition
     (`getDefinition(\`${definitionId}@${definitionVersion}\`)`, import from `./descriptors.js`) satisfies
     `isModelCall(d)` (already in builder.ts) is the model call. None found → leave the node alone.
   - Then `if (config.template === undefined) config.template = slot.template()` and
     `if (config.connection === undefined) config.connection = slot.connectionOf(modelCallKey)`. Use the `slot`
     helpers from `./refs.js` (already imported), never a hand-written object, so the stored shape is identical.
   - Touch nothing else in builder.ts. **No** defaults for oracles' own `connection`/`sampling` slots — that half is
     held for a ruling.
2. **`sdk/src/validate.ts` ~1274–1282** — update only the comment above the `assemble wiring` loop: the builder now
   supplies both (name `build()`), so the warning is for a document that did not come through the builder (hand
   written, an older plugin's, a host's own tests). Do not change the law, its severity, messages or fixes.
3. **`sdk-tests/assembleWiring.test.ts`** — the existing tests build through the builder, so they will now find
   nothing. Rework them so the warning is still proven on a **hand-written document**: compile a fully wired spec,
   then delete `template` / `connection` from the `prompt` node's `config` (and `connection` from its
   `resolvedRefs`) on a JSON copy, and `validate()` that. Keep every existing assertion's intent (two findings, one
   each, the fixes naming `slot.template()` / `slot.connectionOf('generate')`, the "feeds no model call is not
   judged" case, and "no spec core ships trips it"). Add, in a new `describe('the builder wires a prompt step')`:
   - built with neither key → `canonicalize(compile(bare))` **equals** `canonicalize(compile(wired))` and
     `canonicalHash` equals (both from `@serene-pub/sdk`); same for only-template and only-connection;
   - built with neither key → `validate()` has no `assemble wiring` finding;
   - an explicit `connection: slot.connectionOf('other')` (or any other value) is kept as written, not replaced;
   - `build()` called twice yields the same canonical document;
   - an assemble that feeds no model call gains no `template`/`connection` key.
   Update the file's header docblock to say both halves (builder default + warning on hand-written documents).
4. **`guides/your-first-plugin.md`** — two passages contradict each other: ~lines 75–79 ("Leave either out and the
   spec does not publish") and ~98–101 ("Delete `template` or `connection` … `check` warns"). Rewrite both to the
   new truth, keeping the code block itself unchanged:
   - 75–79 (a code comment): `template` is the context template an administrator picks for this step;
     `connectionOf('generate')` says which connection the prompt is written for, so it comes out as chat messages
     or as one text. Both are what the builder writes when you leave them out — the step's own template, and the
     connection of the model call it feeds — so they are stated here only to show where they come from.
   - 98–101 (prose): deleting `template` or `connection` from `prompt` leaves the document unchanged, because the
     builder supplies them. `check` still warns on a document written by hand without them, with a fix naming
     `slot.template()` or `slot.connectionOf('generate')`; keep the existing explanation of what each omission
     costs on a real instance (keep the `[connection]` / `[messages]` bracket links as they are).
   Plain, short sentences. It is a **session**, never a *chat* (chat-completions wire vocabulary such as "chat
   messages" / "chat-style connection" is allowed).

## Files owned (edit only these)

- `/home/jody/github/serene-pub-sdk/sdk/src/builder.ts`
- `/home/jody/github/serene-pub-sdk/sdk/src/validate.ts` (that comment only)
- `/home/jody/github/serene-pub-sdk/sdk-tests/assembleWiring.test.ts`
- `/home/jody/github/serene-pub-sdk/guides/your-first-plugin.md`

## Files readable

Anything in either repo. Useful: `sdk/src/document.ts` (`compileBuilt`, how `resolvedRefs` is written),
`sdk/src/refs.ts` (`slot`, `collectDataRefs`), `sdk/src/hash.ts`.

## Out of scope

Oracle `connection`/`sampling` defaults; anything about `core:oracle/speak@1`; `executor.ts`; `contracts/`; the app
repo; every other guide or doc. If another test breaks because a test spec now gains `template`/`connection`, **do
not edit it** — list it in your report with the failure.

## Stop and ask (in your report, do not decide) when

A published SDK name would be added, removed or renamed (the helper must stay non-exported); a core catalogue hash
pin moves; anything outside the files above seems to need a change.

## Done means

Run, from `/home/jody/github/serene-pub-sdk/sdk-tests`, in a capped scope:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test assembleWiring.test.ts scope.test.ts stepLabel.test.ts agentic.test.ts typedBuilders.test.ts writes.test.ts lair.test.ts coreCatalog.test.ts catalogueParity.test.ts guideSnippets.test.ts guides.test.ts conformance.test.ts migration.test.ts usecases.test.ts"
```

and `npx tsc --noEmit -p /home/jody/github/serene-pub-sdk/sdk-tests` (typecheck). Report each file's pass/fail
counts; for any failure, the test name and assertion. The hash pins in `writes.test.ts`, `lair.test.ts`,
`coreCatalog.test.ts` ("the canonical document is unchanged") and `catalogueParity.test.ts` **must not move** — if
one does, stop and report it, do not re-pin. Then `npx prettier --check <file>` on each file you changed.

## Report

Return in your final message: changed files, what you wrote (the helper's signature and the guide's new
sentences verbatim), tests run with results, anything noticed but not done.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You do not run `sdk:build` at all; the supervisor does.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the SDK
  repo is uncommitted). Never run `npm` at the SDK root.
- **No reference to any other project or product** in code, comments, tests or docs.
- Removing or renaming a published SDK name is the owner's call. This change adds a default and removes nothing.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- Never pipe test output into `head`.
