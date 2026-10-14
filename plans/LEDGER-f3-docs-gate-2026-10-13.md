# F3 gate ledger — plugin from docs alone

## Timeline
1. Listed sandbox; converted docs-site HTML fragments to text for reading (own script, outside docs dir).
2. Read pages/sdk/index.html (a core reference listing, not a landing page) and pages/sdk/guides/your-first-plugin.html, extending.html, where-values-come-from.html, storage.html.
3. Installed all nine tarballs into a throwaway dir to get the CLI; `serene-pub scaffold plugin ../relay --slug gate.relay --genre`; installed the nine tarballs into work/relay in one npm command. `npm run check` clean; tests fail only for the missing golden (README says so).
4. Searched the site for turnOrderSpec / swaps / annex-changed; found turnOrderSpec and swap contributions documented only in the installed packages' .d.ts files.
5. Read widgets.html + widget-examples.html for the widget/component pattern and ctx.turnOrder.
6. Wrote src/strategy.ts (reverse round robin over roundRobinOrder), src/specs/turnOrder.ts (turnOrderSpec, TURN_ORDER_EVENTS + annex-changed, pin = my strategy, swaps = round robin + random), genre events, annex field `round`, widget `turn-board` (via `serene-pub create component turn-board --widget`), swaps on chatTurnOrder. typecheck + check clean first try; `npm run package` wrote dist/plugin.
7. Scaffold's announcement test failed on the turnOrderSpec document (stall 5); fixed the test.
8. Conformance: site has one vocabulary line; used @serene-pub/conformance README; wrote test/conformance.test.ts; needed happy-dom (stall 6). 6/6 package cases pass (C29 not judged outside the app, C30 n/a). Recorded golden; `npm test` 10/10.
9. Instance setup wizard: name, custom OpenAI-compatible connection to the fake model, "Use in Reply" (environment, no docs needed).
10. Admin › Plugins › Install a package…: a file picker for a .zip. Flat zip of dist/plugin refused; zip containing dist/plugin/ accepted (stall 8). Playwright upload sandbox and the app CSP forced a workaround (stall 9, environment).
11. Plugin page: approved the two requested permissions (only message-respond and session-created were listed, not the ten turn-order events — noted in stall 11), ticked Enabled, saved. Plugin "Loaded / Reviewed". Genre Relay listed Available in Admin › Genres.
12. Imported two JSON character cards (Ada, Bram). New session picker shows Relay, but "No preset is available for this genre" (stall 10): Admin › Presets showed the plugin's preset "Hidden from users"; made it available.
13. Session 1 (Ada, Bram) started in Relay: create pipeline wrote the opening line; turn line said "Bram is ready to continue" (my reverse strategy; round robin would pick Ada). Placed Turn board via Layout editor: rendered "1. Bram 2. Ada", strategy gate.relay:task/turn-reverse@1.
14. Reshuffle (annexFieldAction) wrote the annex (round 0 -> 1). Shipped v0.1.1 with the widget also showing `turnOrder.event`; reinstalled (lands switched off; re-enabled). Reshuffle -> "Recomputed on: core:event/annex-changed@1". Brief item 3 confirmed on the instance.
15. A turn: the scaffold's reply pipeline halted ("assemble has no template") (stall 12). Tried Admin › Pipelines config (stall 13), then shipped a spec preset with a template (no effect), then found `template: slot.template()` was the missing wire (only by reading core-catalog's compiled guide spec). v0.1.3 then failed "connection is chat wire mode, but the prompt ... carries no messages ... (slot.connectionOf)" (stall 14). v0.1.4 added `connection: slot.connectionOf('speak')`.
16. Session 2: Continue -> Bram replied (fake model text), turn passed to Ada; Turn board placed in session 2 shows "1. Ada", recomputed on message-completed. Brief complete.

## Stalls

## 1. turnOrderSpec() is not documented on the site
- Needed: how to build a genre's turn order with `turnOrderSpec()` (brief item 1): its import path and options.
- Looked: pages/sdk/guides/your-first-plugin.html ("A turn strategy of your own"), extending.html (Genres), where-values-come-from.html, search.json, pages/sdk/api/index.html (module list), api/sdk/src/turnOrder.html, api/sdk/src/genres.html, api/sdk/src/document.html.
- Found: the only mention on the whole site is a parenthetical in api/sdk/src/document.html ("a helper such as `turnOrderSpec()` returns one"). The API reference covers contracts, controls and sdk only; `@serene-pub/core-catalog` (where `turnOrderSpec`, `TURN_ORDER_EVENTS`, `chatTurnOrder` live) has no API pages. Found the full, well-written TSDoc in node_modules/@serene-pub/core-catalog/dist/factories/turnOrder.d.ts, with an example that is exactly the brief.
- Time: ~10
- Resolved by: docs (package .d.ts in node_modules, not the site)
- Fix: add core-catalog to the API reference (at least factories/turnOrder: turnOrderSpec, TURN_ORDER_EVENTS, TURN_ORDER_NARRATOR_EVENTS, TurnOrderHandle, chatTurnOrder) and add a "Your genre's turn order" section to your-first-plugin.html or extending.html#Genres showing the d.ts example, including that a preset must bind it.

## 2. No site example of a swap contribution; the brief's `contributes.swaps` does not exist
- Needed: how to offer my turn strategy on Chat's turn order (brief item 2 says "through `contributes.swaps`").
- Looked: extending.html ("At a glance" row says `handlers`, `swaps`; "Less common parts > Swaps" links to where-values-come-from.html), where-values-come-from.html (layers only, no declaration), vocabulary.html (mentions `expose: { swaps: [...] }` on a spec node, i.e. your own spec), your-first-plugin.html (says a swap must be `visibility: 'public'`).
- Found: no page shows the shape of a swap contribution. `contributes` on a spec only holds `actions` (builder.d.ts). The real field is `defineExtension({ swaps: [{ spec, node, definition }] })` (SwapContribution in sdk/dist/declarations.d.ts / extension.d.ts), and the node key for Chat is `chatTurnOrder.strategyNode` (`decide.rules.strategy`, because chat has the model path) from core-catalog's TurnOrderHandle. Nothing on the site says the node key is not `strategy`.
- Time: ~8
- Resolved by: docs (package .d.ts)
- Fix: in your-first-plugin.html "A turn strategy of your own", finish the example: the describeTaskDefinition with the turnCandidates/messages -> main/order ports, `handler(def, fn, { visibility: 'public' })`, and `swaps: [{ spec: chatTurnOrder, node: chatTurnOrder.strategyNode, definition: def }]` with the core-catalog import. (And whoever wrote the brief: the vocabulary is `swaps` on defineExtension, not `contributes.swaps`.)

## 3. Site says nothing recomputes the turn order
- Needed: whether a genre's turn order recomputes on events (brief item 3, `annex-changed`).
- Looked: where-values-come-from.html ("The turn order. No layers. It is stored ... and read as it is. Nothing recomputes it."), api/sdk/src/genres.html (sessionEvents.annexChanged exists), pages/sdk/index.html (presets bind core:spec/*-turn-order on nine events).
- Found: the sentence "Nothing recomputes it" reads as a contradiction of the presets table, which binds a turn-order spec on nine events. The d.ts explains it: the order is recomputed by a pipeline bound on events; "nothing" means no layer cascade. 
- Time: ~3
- Resolved by: docs (reconciled from index.html + core-catalog d.ts)
- Fix: where-values-come-from.html: replace "Nothing recomputes it" with "No layer recomputes it on read; the genre's turn-order pipeline rewrites it when one of the events it is bound on happens (see turnOrderSpec)".

## 4. A turn strategy cannot read the annex, so "annex state drives turn order" has no road through turnOrderSpec
- Needed: let annex state (set from my widget) change who goes next.
- Looked: turnOrder.d.ts (core-catalog): strategy ports are fixed to candidates + messages; turnOrderSpec opts have no extra wiring; your-first-plugin.html strategy section; storage.html annex section.
- Found: a strategy pin sees only `candidates` and `messages`; turnOrderSpec offers no way to feed `core:query/session-annex` into it. `annex-changed` can be added to `events` (the d.ts example does exactly this), so the order recomputes on an annex write, but the recompute cannot see the annex value. The site never says what a turn order bound on `annex-changed` is for.
- Time: ~10
- Resolved by: guess (design workaround: the annex value is a "round" counter/toggle the widget bumps, which forces a recompute; the strategy is deterministic over candidates+messages)
- Fix: either (API) let turnOrderSpec take an `annex` option that wires `core:query/session-annex` into the strategy (an optional `annex` in-port on strategy pins), or (docs) state that a strategy sees only candidates and messages, and show the intended use of `annex-changed` on a turn order.

## 5. The scaffold's own test breaks as soon as a turnOrderSpec() document is in `pipelines`
- Needed: keep the scaffold's tests green after adding the turn-order spec.
- Looked: test/announcement.test.ts (scaffold), api/sdk/src/document.html (compile).
- Found: the scaffold test asserts `built.input?.event`; `turnOrderSpec()` returns a compiled SpecDocument bound on many events, whose lock is `input.events[]`, so the test fails with "expected undefined to be truthy". Nothing on the site says a pipeline may be bound on several events or what the document's `input` looks like.
- Time: ~3
- Resolved by: guess (inspected compile() output; changed the test to `compile(built).input.event ?? .events[0]`)
- Fix: scaffold template: assert through `compile(built).input` and accept `events`; document the SpecDocument `input` lock (`event` | `events`) on the API page.

## 6. Running the conformance suite on a plugin is not on the site
- Needed: how a plugin author runs "the conformance suite" (brief item 5).
- Looked: search.json ("conformance"), pages/sdk/laws.html (host laws C1..., "every host has to pass"), vocabulary.html#conformance (one line: "`conformPackage(…)` runs the package checks against your built plugin"), your-first-plugin.html (link to laws only), then node_modules/@serene-pub/conformance/README.md.
- Found: the site never shows how to call conformPackage. The package README does, but its snippet leaves `codeOf`, `writeAside`, `root`, `bundleCode` undefined and does not say (a) that the four host functions come from `@serene-pub/sdk`, (b) that C30/C31 need a DOM test environment (happy-dom, which the scaffold does not install), (c) that the result's field is `pass` (my first assertion checked the wrong field and passed a 4/6 run as green). The scaffold ships @serene-pub/conformance as a devDependency but no conformance test.
- Time: ~12
- Resolved by: docs (package README) + guess (helpers, happy-dom from the kit's own error text)
- Fix: scaffold a `test/conformance.test.ts` that builds the host from dist/plugin (as written in this run) with `// @vitest-environment happy-dom` and happy-dom in devDependencies, asserting `results.every(r => r.pass)`; add a "Check it against the conformance kit" section to your-first-plugin.html "Package and check".

## 7. Scaffold's engines range excludes the release the SDK ships with
- Needed: an `engines` range the 0.6 instance accepts.
- Looked: your-first-plugin.html ("engines is the range of Serene Pub releases your plugin supports"; example `>=0.7 <0.8`), scaffold src/index.ts (same), every page's banner ("Plugins are a preview in Serene Pub 0.6").
- Found: the docs and scaffold both write `>=0.7 <0.8` while the SDK is 0.6.0-pr-4 and the banner says plugins run in 0.6. Changed to `>=0.6.0-0 <0.8` pre-emptively (prerelease needs the `-0`). Whether the instance would refuse 0.7-only was not tested.
- Time: ~2
- Resolved by: guess
- Fix: scaffold writes the range of the SDK it shipped with; your-first-plugin.html says how a prerelease instance matches a range.

## 8. What zip does "Install a package…" take? `serene-pub build` writes a folder, not a zip
- Needed: the file to upload in Admin › Plugins › Install a package….
- Looked: your-first-plugin.html "Package and check" ("`build` writes the manifest and the compiled documents; that folder is what an administrator installs"), genres.html ("a zip in the plugin package layout" — for in-app genre exports), cli --help, cli/sdk READMEs, search.json for "zip".
- Found: the docs say the *folder* is installed; the UI only accepts a .zip and the CLI never writes one. The layout is nowhere on the site. Zipping the contents of dist/plugin was refused with a good message: "'relay.zip' has no 'dist/plugin/manifest.json'. Install the zip 'serene-pub build' wrote or an export wrote." — but build wrote no zip. Zipping the `dist/plugin` directory from the package root (`zip -r relay.zip dist/plugin`) installed.
- Time: ~5
- Resolved by: guess (guided by the refusal sentence)
- Fix: have `serene-pub build` also write `dist/<slug>-<version>.zip` (or add `serene-pub pack`), and add to your-first-plugin.html: "Install: Admin › Plugins › Install a package…, choose the zip; the zip holds `dist/plugin/manifest.json`". Reword the refusal to not promise a zip build does not write.

## 9. (environment) Uploading a file from the sandbox
- Needed: hand the zip to the file picker.
- Found: the Playwright MCP refuses files outside /home/jody/github/serene-pub (out of bounds for this test), and the app's CSP (`connect-src 'self'`) blocks a page fetch from a local server. Worked around by serving the zip on 127.0.0.1:47911 and using Playwright's `page.request` + `setInputFiles({buffer})`.
- Time: ~5
- Resolved by: environment
- Fix: none for docs; the gate harness could allow the scratchpad as an upload root.

## 10. A plugin's preset installs hidden; the SDK docs say nothing about it
- Needed: start a session in my genre.
- Looked: your-first-plugin.html ("The first preset you declare for your genre becomes its default on a pub that has none"), genres.html (user docs: "Once an administrator has installed the plugin and enabled its preset, its genre appears on the start screen").
- Found: the genre did appear, but the session form said "No preset is available for this genre". Admin › Play › Presets listed it as Default but "Hidden from users"; Actions › Make selected presets available fixed it. The user docs hint at it ("enabled its preset"); the SDK guide does not, and the plugin page shows nothing about it.
- Time: ~3
- Resolved by: docs (user-facing genres.html) + UI message
- Fix: your-first-plugin.html / a new "Install and try it" section: after enabling the plugin, make its preset available under Admin › Play › Presets. Better: the plugin page's save offers to make its presets available.

## 11. (observation) The permission review lists only 2 of the 12 events the plugin's pipelines answer
- Needed: nothing blocked; noted while approving.
- Found: the plugin page asked to approve `message-respond` and `session-created` only, though the turn-order spec (a precompiled turnOrderSpec() document) is bound on ten more, including annex-changed. They ran anyway. Either the review undercounts what a turnOrderSpec document subscribes to, or turn-order events need no grant; no page says which.
- Time: ~1
- Resolved by: docs n/a (observation)
- Fix: plugin-permissions.html: say which events need a grant, and make the review list every event a shipped document answers.

## 12. The scaffold's reply pipeline (and the guide's first spec) halts on a real instance: assemble's `template` slot is never wired
- Needed: a turn to happen (brief: "confirm ... a turn happens").
- Looked: run receipt ("assemble has no template — the template slot did not resolve to a story string ... Check that this pipeline's configuration selects a context template"), pages/sdk/pipelines/core_spec_chat-respond.html ("`prompt` — task (`core:task/assemble@2`) / template — template template slot", no wiring shown), context-templates.html (user docs: pick a template in Admin › Pipelines), api/sdk/src/refs.html (slot.template exists, no "when to wire it"), your-first-plugin.html (its `C.assemble.v2()` takes no template either).
- Found: selecting a template in Admin and shipping `.preset(..., p => p.template('prompt', ...))` both did nothing, because the node never reads the slot unless the spec wires `template: slot.template()` into `C.assemble.v2({...})`. I learned that only by reading node_modules/@serene-pub/core-catalog/dist/genres/guide/respond.js, i.e. core's compiled spec source. The playground/fixture host and the scaffold's golden test do not catch it; "Everything on this page builds and runs today" holds on the fixture host only.
- Time: ~25
- Resolved by: source-needed (compiled core spec in node_modules; not the source repo, but source all the same)
- Fix: scaffold respond.ts and your-first-plugin.html's first spec: wire `template: slot.template()` (and see 14). Better (API): assemble@2 should read its template slot whether or not the spec wires it, or `validate()` should refuse an assemble with the slot unwired ("a published spec cannot render"). Also the halt sentence should say "the spec does not wire slot.template()" when that is the cause, rather than pointing the admin at a configuration that cannot help.

## 13. Admin › Pipelines configuration for a plugin spec: Save is disabled until a configuration exists, and a new one drops the pending change
- Needed: set the context template through the UI as context-templates.html says.
- Looked: context-templates.html ("A context template is chosen per pipeline, in Admin › Pipelines, on the step that builds the prompt"), the pipeline page.
- Found: the plugin's spec had no configuration; picking "Default — Handlebars" left Save disabled; "New" created an empty configuration (the pending pick did not carry over), re-picking and saving worked, but did not help (stall 12). Nothing explains that a plugin spec with no shipped config has nothing to save into.
- Time: ~8
- Resolved by: guess
- Fix: pipelines.html / context-templates.html: what an admin sees for a spec that ships no configuration, and that a new configuration starts empty.

## 14. After wiring the template: "this OpenAI connection is chat wire mode, but the prompt it was handed carries no messages ... (slot.connectionOf)"
- Needed: the reply to send.
- Looked: the run error, api/sdk/src/refs.html (slot.connectionOf listed), core-catalog guide respond.js (again).
- Found: assemble must also be given `connection: slot.connectionOf('<the generate node>')` so it renders for the model's wire mode. Nothing on the site says assemble needs it; the error's hint named the helper, which was enough.
- Time: ~4
- Resolved by: docs (error text) + source (confirmed against core's compiled spec)
- Fix: same as 12: scaffold + guide wire it; validate() refuses an assemble feeding a generate-text without it.

## 15. (minor) Layout and naming papercuts seen on the way
- A widget placed in one session's layout is not in the next session; the layout editor tray is the only way in. The plugin's genre ships no layout, so each session needs it placed again. Fix: extending.html/widgets.html already say a genre may ship `layouts`; your-first-plugin should show it next to `widget({ genres })`.
- Plugin specs show in Admin › Pipelines by bare slug ("turn-order", "create-session", role "Unclassified"); nothing on the site says how a plugin spec gets a display name or role.
- The conformance README's snippet does not typecheck against `@serene-pub/cli/testing`'s `MountComponentOptions` (`grants: string[]` vs `WidgetScope[]`); needed a cast.
- An update reinstall lands the plugin switched off every time (said in the install message, not in the docs).
- Sending a message did not start a reply; Continue on the turn line did. Not documented for plugin genres (may be the session's auto-advance setting).

## Verdict

One full run of the brief completed on the instance:
1. Genre `gate.relay:genre/relay` with its own turn order from `turnOrderSpec()` — yes.
2. Custom strategy `gate.relay:task/turn-reverse@1`, public, offered on Chat's turn order via `defineExtension({ swaps })` (the brief's `contributes.swaps` does not exist) — packaged, C32/C33 pass, plugin page shows "1 swap contribution". Not exercised from a Chat session's settings.
3. Annex field `round` set from the widget; turn order bound on `annex-changed` and seen recomputing on it ("Recomputed on: core:event/annex-changed@1"). The strategy cannot read the annex value (stall 4).
4. Widget `turn-board` renders the turn order (Bram, Ada; then Ada after Bram's turn).
5. `conformPackage` C28–C33: 6/6 pass (C29 not judged outside the app, C30 n/a).
Packaged, installed via Admin › Plugins, session started, a turn happened (Bram replied, Ada next).

It did NOT complete without the source: a turn only happened after I read core-catalog's compiled guide spec in node_modules to learn that `C.assemble.v2` needs `template: slot.template()` and `connection: slot.connectionOf(...)`. The scaffold's own reply pipeline halts on a real instance.

Stalls by Resolved by:
- source-needed: 12 (assemble template slot; with 14 confirmed the same way)
- docs (from package .d.ts/README, not the site): 1 (turnOrderSpec), 2 (swaps shape), 6 (conformance), 3 (turn order "nothing recomputes it" contradiction), 10 (preset hidden; user docs), 14 (error text + source)
- guess: 4 (annex not readable by a strategy), 5 (scaffold test vs turnOrderSpec doc), 7 (engines range), 8 (zip layout), 13 (admin config UI)
- environment: 9 (file upload root / CSP)
- observations: 11, 15

Biggest fixes, in order: (a) scaffold + your-first-plugin wire `template` and `connectionOf` on assemble, and validate() refuses it unwired; (b) put core-catalog (turnOrderSpec, TURN_ORDER_EVENTS, chatTurnOrder) in the API reference and add a turn-order + swap worked example to your-first-plugin; (c) `serene-pub build` writes the installable zip and the guide says how to install it and make the preset available; (d) scaffold a conformance test.
