# Dependency audit: serene-pub + serene-pub-sdk (2026-11-18)

Read-only. Nothing was installed, built or tested. Two-week rule: no version published after **2026-11-04** is recommended.
PGlite is listed but not researched.

## 0. How the data was gathered

- `npm outdated --json` worked in both repos (network OK). Raw output: `app-outdated.json`, `sdk-outdated.json` in this scratchpad.
- `npm audit --json` **worked without a lockfile in the app** (npm audits the installed `node_modules` tree). App: 55 findings (2 critical, 21 high, 31 moderate, 1 low). SDK: 40 (1 critical, 35 high, 3 moderate, 1 low). Raw: `app-audit.json`, `sdk-audit.json`.
- Release dates: npm registry JSON (`https://registry.npmjs.org/<pkg>` `time` field), fetched by `dates.mjs` / `d2.mjs`.
- Observation (no proposal): **the SDK repo tracks `package-lock.json`** (`git ls-files` lists it); the app gitignores it (`.gitignore:52`).
- **Key fact:** most audit hits come from a *stale local node_modules*. The `^` ranges already allow the fixed versions, so a fresh install (the release build runs `npm install` in `.github/workflows/release.yml:131,184,278`) already gets them. The flip side: a fresh install also takes versions published *today* (svelte 5.58.0, skeleton 5.0.5, @xyflow/svelte stays on 1.x because the range is `^1.6.5`).

## 1. App (`serene-pub/package.json`) — direct deps behind

Gap: P patch, m minor, M major (0.x minor bumps count as major). "In range" = the current `^`/`~` range already allows the recommended version.

| package | installed | range | latest (date) | newest ≥2 wk old | gap | in range? |
|---|---|---|---|---|---|---|
| svelte | 5.57.0 | ^5.35.4 | 5.58.0 (11-18) | 5.57.3 (10-26) | P | yes |
| @sveltejs/kit | 2.70.3 | ^2.22.2 | 3.4.0 (11-18) | 2.70.4 is 11-05 (eligible 11-19); 3.1.1 (10-29) | P / M | 2.70.4 yes |
| @sveltejs/adapter-node | 5.5.7 | ^5.2.12 | 6.0.5 (11-18) | 5.5.8 is 11-05 (eligible 11-19) | P / M | 5.5.8 yes |
| @sveltejs/vite-plugin-svelte | 5.1.1 | ^5.1.0 | 7.3.1 (09-23) | 7.3.1 | M | no |
| vite | 6.4.3 | ^6.2.6 | 8.3.8 (11-11) | 6.4.5 (10-21); 8.3.5 | P / M | 6.4.5 yes |
| vitest | 4.1.11 | ^4.1.10 | 5.1.1 (11-18) | 4.1.12 (10-15); 5.0.0 (09-03) | P / M | 4.1.12 yes |
| typescript | 5.9.3 | ^5.0.0 | 7.0.2 (07-08) | 7.0.2 | M | no |
| drizzle-orm | 0.45.3 | ^0.45.3 | 0.45.4 (10-08) | 0.45.4 | P | yes |
| drizzle-kit | 0.31.11 | ^0.31.11 | 0.31.11 | — | current | — |
| tailwindcss / @tailwindcss/vite | 4.3.3 | ^4.0.0 | 4.3.5 (11-06) | 4.3.4 (11-02) | P | yes |
| @skeletonlabs/skeleton(-svelte) | 5.0.1 | ^5.0.0 | 5.0.5 (11-17) | none: 5.0.2–5.0.4 all 11-08 | P | yes (wait) |
| socket.io / socket.io-client | 4.8.4 | ^4.8.4 | 4.8.4 | — | current | engine.io override ^6.6.10 → 6.6.11 (current) |
| @xyflow/svelte | 1.6.6 | ^1.6.5 | 2.0.2 (11-17) | 1.7.1 (11-02) | m / M | 1.7.1 yes; **2.x not recommended** |
| elkjs | 0.12.0 | ^0.12.0 | 0.12.1 (10-28) | 0.12.1 | P | yes |
| @codemirror/* (autocomplete, commands, language, lint, merge, state, view), @lezer/javascript | 6.x | ^6.x | autocomplete 6.20.4, commands 6.11.1, language 6.13.1, lint 6.9.8 (11-13; use 6.9.7), merge 6.12.3, state 6.7.6, view 6.43.15, lezer 1.5.6 | all ≥2 wk except lint 6.9.8 | P/m | yes |
| @zag-js/combobox, file-upload | 1.43.0 | ^1.43.0 | 1.48.0 (11-13) | 1.47.0 (10-26) | m | yes |
| @huggingface/transformers | 4.2.0 | ^4.2.0 | 4.3.2 (10-27) | 4.3.2 | m | yes (see §3 — native modules) |
| dompurify | 3.4.14 | ^3.4.12 | 3.4.18 (11-14) | 3.4.17 (10-12) | P | yes |
| marked | 15.0.12 | ^15.0.12 | 18.2.1 (11-16) | 18.1.3 (11-02) | M | no |
| handlebars | 4.7.9 | ^4.7.8 | 4.7.10 (10-05) | 4.7.10 | P | yes |
| liquidjs | 10.29.0 | **10.29.0 exact** | 10.30.1 (10-28) | 10.30.1 | m | no (exact pin, also in SDK `sdk/`) |
| @tiptap/core, starter-kit, extension-placeholder | 2.27.2 | ^2.22.3 | 3.34.0 (11-13) | 2.27.3 (09-04); 3.32.2 | P / M | 2.27.3 yes |
| prosemirror-model / -view | 1.25.11 / 1.42.3 | ^ | 1.25.13 (11-08) / 1.42.9 (10-31) | 1.25.12 / 1.42.9 | P | yes |
| axios | 1.20.0 | ^1.9.0 | 1.21.1 (11-09) | 1.21.0 (10-27) | m | yes |
| happy-dom | 20.14.5 | ^20.14.5 | 21.0.4 (10-20) | 21.0.4 | P / M | 20.14.6 yes; 21 no |
| @anthropic-ai/sdk | 0.105.0 | ^0.105.0 (locks 0.105.x) | 1.10.0 (11-17) | 0.137.0 (10-20); 1.4.0 (11-02) | M | no |
| openai | 5.23.2 | ^5.3.0 | 7.60.0 (11-18) | 7.49.0 (11-03) | M | no |
| @lmstudio/sdk | 1.5.0 | ^1.3.0 | 2.1.0 (10-14) | 2.1.0 | M | no |
| ollama | 0.6.3 | ^0.6.3 | 0.6.4 (09-29) | 0.6.4 | P | yes |
| zod | 3.25.76 | ^3.25.76 | 4.6.7 (10-12) | 4.6.7 | M | no |
| paseto | 3.1.4 | ^3.1.4 | 4.0.1 (09-04) | 4.0.1 | M | no |
| dotenv | 16.6.1 | ^16.5.0 | 18.0.10 (11-09) | 18.0.9 | M | no |
| uuid | 11.1.1 | ^11.1.0 | 14.0.3 (10-10) | 14.0.3 | M | no |
| env-paths | 3.0.0 | ^3.0.0 | 4.0.0 (01-24) | 4.0.0 | M | no |
| file-type | 21.3.4 | ^21.0.0 | 22.3.0 (10-29) | 22.3.0 | M | no |
| gpt-tokenizer | 3.4.0 | ^3.0.0 | 4.1.2 (11-10) | 4.1.0 (10-18) | M | no |
| open | 10.2.0 | ^10.1.2 | 11.0.4 (09-14) | 11.0.4 | M | no (build script only) |
| @lucide/svelte | 0.511.0 | ^0.511.0 (locks 0.511.x) | 1.75.0 (11-18) | 0.577.0 (03-04); 1.67.0 | M | no |
| @types/node | 20.19.43 | ^20 | 26.6.6 | 24.19.2 (10-09) matches engines ≥24 | M | no |
| @types/lodash | 4.17.25 | ^ | 4.17.27 (10-21) | same | P | yes |
| @remote-dom/core | 1.12.0 | ^1.12.0 | 1.12.1 (10-30) | same | P | yes |
| pg | 8.23.0 | ^8.16.3 | 8.23.1 (09-30) | same | P | yes (but see §4) |
| playwright | 1.63.0 | **1.63.0 exact** | 1.65.1 (11-13) | 1.64.1 (10-14) | m | no |
| prettier | 3.6.2 | **~3.6.2** | 3.10.1 (11-12) | 3.9.10 (10-10) | m | no (tilde) |
| prettier-plugin-svelte | 3.5.2 | ^3.5.2 | 4.2.0 (11-17) | 4.1.1 | M | no |
| prettier-plugin-tailwindcss | 0.6.14 | ^0.6.11 | 0.8.1 (07-15) | 0.8.1 | M | no |
| svelte-check | 4.7.6 | ^4.0.0 | 4.7.8 (11-01) | 4.7.8 | P | yes |
| svelte-dnd-action | 0.9.79 | ^0.9.61 | 0.9.80 (10-05) | same | P | yes |
| translate | 3.1.0 | ^ | 3.1.1 (10-24) | same | P | yes |
| tsx | 4.23.13 | ^ | 4.23.15 (09-20) | same | P | yes |
| axe-core | 4.12.1 | ^4.12.1 | 4.14.1 (11-16) | 4.14.0 (10-05) | m | yes |
| @electric-sql/pglite | 0.2.17 | ^0.2.17 | 0.5.16 | — | M | **not researched (separate track)** |

Up to date / not flagged: esbuild 0.28.2, fflate, yaml, yauzl, ses 2.3.0, quickjs-emscripten 0.32.0 (exact pin = latest), socket.io 4.8.4, lodash (installed 4.18.1).

## 2. SDK (`serene-pub-sdk`, workspaces) — behind

| package | where | installed | range | recommend | note |
|---|---|---|---|---|---|
| handlebars | sdk | 4.7.9 | ^4.7.8 | 4.7.10 | critical advisories (see §3) |
| liquidjs | sdk | 10.29.0 | exact | 10.30.1 | edit pin, keep app in step |
| svelte | cli, component-client, controls, core-catalog, ui-preview | 5.56.10 | ^5.56.0 / >=5 | 5.57.3 | |
| svelte-check | core-catalog, ui-preview | 4.7.6 | ^ | 4.7.8 | |
| @codemirror/language/state/view | playground | — | ^ | 6.13.1/6.7.6/6.43.15 | |
| @remote-dom/core | cli, component-client | 1.12.0 | ^1.12.0 | 1.12.1 | |
| @skeletonlabs/skeleton, @tailwindcss/vite, tailwindcss, @sveltejs/kit, vite | ui-preview | as app | as app | as app | ui-preview mirrors the app stack |
| elkjs, shiki, marked | docs | 0.12.0 / 4.4.3 / 15.0.12 | ^ | 0.12.1 / 4.6.0 (11-02) / stay 15 | |
| happy-dom | root devDep ^20.14.5, cli peer `*` | 20.14.5 | | 21.0.4 (major) | test/harness only |
| tsx | sdk-tests | 4.23.12 | ^4 | 4.23.15 | |
| typedoc 0.28.20 / typedoc-plugin-markdown 4.13.0 | api-docs (exact pins) | | | plugin 4.14.1 (10-19); typedoc is latest | minimatch moderate advisory via typedoc, docs tooling only |
| typescript | root ~7.0.0 (7.0.2 installed); api-docs 5.9.3 exact; core-catalog/playground/ui-preview ~5.9.0 | | | leave | two majors inside one repo |
| jimp | docs, sdk-tests | 1.6.1 | ^1.6.1 | latest | audit "high" only via its zod 3 dep |

## 3. Security advisories that apply to installed versions

Reachability was checked by grep of `src/`, `scripts/`, `svelte.config.js`, and the SDK `*/src`.

| advisory | pkg@installed | sev | reachable? (how checked) | fixed in | fix arrives via |
|---|---|---|---|---|---|
| [GHSA-8r5x-fm3f-whwj](https://github.com/advisories/GHSA-8r5x-fm3f-whwj) AST type confusion in compile | handlebars 4.7.9 (app + SDK) | critical | **Not as described**: needs an *object* passed to `compile()`. All call sites pass strings (`InterpolationEngine.ts:107`, `connections/stops.ts:206`, `pipelines/prompt/renderers.ts:178`, `sdk/src/templateCheck.ts`). But character-card text (untrusted third-party content) *is* compiled server-side, so treat as priority. | 4.7.10 (10-05) | range |
| [GHSA-p8wg-vrv2-v86f](https://github.com/advisories/GHSA-p8wg-vrv2-v86f) own-property check bypass → RCE | handlebars | critical | Needs `allowProtoMethodsByDefault: true`; grep finds none in either repo. | 4.7.10 | range |
| [GHSA-xw65-4hp5-5hc7](https://github.com/advisories/GHSA-xw65-4hp5-5hc7) inline precompiled templates | handlebars | moderate | No `precompile` call found. | 4.7.10 | range |
| [GHSA-cg2g-xh64-v4q7](https://github.com/advisories/GHSA-cg2g-xh64-v4q7) SAFE_FOR_TEMPLATES bypass | dompurify 3.4.14 | critical | Not reachable: only call sites are `markdownToHTML.ts:49` (default config) and `:72` (FORBID_TAGS/ATTR + RETURN_DOM_FRAGMENT); no SAFE_FOR_TEMPLATES, IN_PLACE, PARSER_MEDIA_TYPE or hooks anywhere. | 3.4.17 (10-12) | range |
| [GHSA-mrv2-3pqr-j5jr](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr), [GHSA-p98j-92pf-mc4p](https://github.com/advisories/GHSA-p98j-92pf-mc4p), [GHSA-6688-9rhm-gjv2](https://github.com/advisories/GHSA-6688-9rhm-gjv2), [GHSA-c6gr-qvv4-5v3f](https://github.com/advisories/GHSA-c6gr-qvv4-5v3f) | dompurify | high/low | Not reachable (IN_PLACE / hooks / xhtml media type unused). This is the library that sanitises model and card text, so stay current. | 3.4.17 | range |
| [GHSA-rqp5-r3wg-vg35](https://github.com/advisories/GHSA-rqp5-r3wg-vg35) protocol-relative import | @sveltejs/kit 2.70.3 | moderate | Only with `router.resolution: 'server'`; `svelte.config.js` sets no `router`. Not reachable. | 2.70.4 (11-05) | range |
| [GHSA-mw6w-2fmv-pvw3](https://github.com/advisories/GHSA-mw6w-2fmv-pvw3) reroute URIError | kit | moderate | No `reroute` export in hooks. Not reachable. | 2.70.4 | range |
| [GHSA-3r8g-jcqq-3p5j](https://github.com/advisories/GHSA-3r8g-jcqq-3p5j), [GHSA-6cf5-gc4q-fm3x](https://github.com/advisories/GHSA-6cf5-gc4q-fm3x) remote functions | kit | high/moderate | No `$app/server` import, no remote functions. Not reachable. Fixed only in 3.1.1. | 3.1.1 | major |
| [GHSA-pfhg-q3qv-9q6r](https://github.com/advisories/GHSA-pfhg-q3qv-9q6r), [GHSA-27mw-82g8-phjj](https://github.com/advisories/GHSA-27mw-82g8-phjj) | kit | low | Enhanced-form redirect / prerender cache-control. Low; fixed in 3.x only. | 3.0.0 | major |
| [GHSA-rqw3-x7hx-mm3p](https://github.com/advisories/GHSA-rqw3-x7hx-mm3p) crash proxying via fetch | adapter-node 5.5.7 | moderate | No route returns a `fetch()` response (grep `return (await )?fetch(` in `src/routes`, hooks). Probably not reachable. | 5.5.8 (11-05) | range |
| [GHSA-pxg6-pf52-xh8x](https://github.com/advisories/GHSA-pxg6-pf52-xh8x) | cookie 0.6.0 (via kit 2, pinned ^0.6.0) | low | Cookie names/paths are set by app code, not by users. Fix only with kit 3 (cookie v2). | 0.7.0 | kit 3 |
| devalue: [GHSA-j22f-vq7h-c4qm](https://github.com/advisories/GHSA-j22f-vq7h-c4qm), [GHSA-mcm9-63f2-9j32](https://github.com/advisories/GHSA-mcm9-63f2-9j32), [GHSA-x5rw-q4pp-hg5g](https://github.com/advisories/GHSA-x5rw-q4pp-hg5g), [GHSA-r9w8-h9r3-54w4](https://github.com/advisories/GHSA-r9w8-h9r3-54w4), [GHSA-4q55-j62x-fr9h](https://github.com/advisories/GHSA-4q55-j62x-fr9h), [GHSA-hx4r-w6wj-j8fg](https://github.com/advisories/GHSA-hx4r-w6wj-j8fg), [GHSA-wf3x-273g-mvxv](https://github.com/advisories/GHSA-wf3x-273g-mvxv) | devalue 5.9.2 (via kit, svelte) | high | Low: kit serialises app-built load data; most live data goes over Socket.IO; no remote functions. | 5.9.4 (09-18) | transitive range (kit ^5.8.1, svelte ^5.9.2) |
| vite: [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm), [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22), [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw), [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv), [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) | vite 6.4.3 | high | Dev server only; the shipped bundle is adapter-node output, not vite. Matters for `npm run dev:host` on a LAN and for Windows contributors. | 6.4.4+ (use 6.4.5, 10-21) | range |
| [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8), [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp) | @vitest/mocker 4.1.11 | moderate | Test runner only. | vitest 4.1.12 (10-15) | range |
| happy-dom: [GHSA-834v-8h66-3h79](https://github.com/advisories/GHSA-834v-8h66-3h79), [GHSA-c8p4-j97h-3vg8](https://github.com/advisories/GHSA-c8p4-j97h-3vg8), [GHSA-5fpq-26gf-qwcr](https://github.com/advisories/GHSA-5fpq-26gf-qwcr) | happy-dom 20.14.5 (both repos) | high | Test environment (`vitest.config.ts:118`) and the SDK test harness `cli/src/testing.ts:395`; never in the app's runtime (grep `src` non-test: none). It parses fixture HTML, not untrusted HTML. | 21.0.4 (all three); 20.14.6 fixes only the cookie one | major |
| [GHSA-cp6q-959q-f8rh](https://github.com/advisories/GHSA-cp6q-959q-f8rh) mergeAttributes `__proto__` | @tiptap/core 2.27.2 | moderate | `mergeAttributes` called in `tiptapLegacyTag.ts:135`, `tiptapLorebookBindingTag.ts:176` with schema-defined attrs only (`tag`, `id`); editor content is built from a string (`LoreContentField.svelte:148`), not loaded JSON. Low. No 2.x fix. | 3.30.4 | major |
| [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) memory exhaustion | zod 3.25.76 | high | The flaw is in zod 4's `$ZodArray`; audit flags 3.x by range. Server-side zod use is only `sockets/users.ts` and `sockets/tunnels.ts` with string/enum/boolean schemas; no array schemas. Not reachable. The many "jimp / openai / @lmstudio/sdk high" lines are this same advisory through their zod dep. | 4.6.6 | major |
| sharp: [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) | sharp 0.34.5 (via transformers 4.2.0) | high | App media uses jimp/jsquash, not sharp; no `sharp` import in `src/`. transformers would only use it for image pipelines (the app uses embeddings/NER). Low. | sharp 0.35.5 | transformers 4.3.x (`sharp ^0.35.4`), in range |
| adm-zip: [GHSA-xcpc-8h2w-3j85](https://github.com/advisories/GHSA-xcpc-8h2w-3j85), [GHSA-j5f4-cc29-5x44](https://github.com/advisories/GHSA-j5f4-cc29-5x44), [GHSA-rcw4-f5rp-g42v](https://github.com/advisories/GHSA-rcw4-f5rp-g42v), [GHSA-7q85-xj36-vmfc](https://github.com/advisories/GHSA-7q85-xj36-vmfc), [GHSA-8238-w5pm-2374](https://github.com/advisories/GHSA-8238-w5pm-2374) and more | adm-zip 0.5.18 (via onnxruntime-node 1.24.3) | high | Used only in `onnxruntime-node/script/install-utils.js` (install-time optional CUDA download from Microsoft). Not runtime. | 0.6.1 | ORT 1.30.0 (`adm-zip ^0.6.0`) via transformers 4.3.x |
| follow-redirects: [GHSA-q3jh-wrc6-jgq8](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8), [GHSA-8r9p-f939-6h3c](https://github.com/advisories/GHSA-8r9p-f939-6h3c), [GHSA-mrwp-f3q8-3g9p](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p) | 1.16.0 (via axios) | high | axios is used only by `LlamaCppAdapter.ts` to a llama.cpp server; credentials leak only if that server redirects cross-origin. Low. | 1.16.2 (10-25) | axios `^1.16.0`, in range |
| markdown-it: [GHSA-r7fv-28h4-cvq7](https://github.com/advisories/GHSA-r7fv-28h4-cvq7), [GHSA-gfr2-rv44-r23c](https://github.com/advisories/GHSA-gfr2-rv44-r23c), [GHSA-vfgh-jcmw-g37q](https://github.com/advisories/GHSA-vfgh-jcmw-g37q) | 14.3.1 (via @tiptap/pm → prosemirror-markdown) | high | `@tiptap/pm/markdown` / `prosemirror-markdown` imported nowhere. Not reachable. | 14.3.3 (10-16) | transitive range |
| [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | source-map-js 1.2.1 | high | Build tooling (postcss, tailwind). Not runtime. | 1.2.2 (09-30) | transitive range |
| [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) | postcss-selector-parser 6.0.10 (exact pin in @tailwindcss/typography 0.5.20, the latest) | moderate | Build-time over the app's own CSS. No fix available upstream. | 6.1.5 | none yet |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | esbuild ≤0.24 inside @esbuild-kit (drizzle-kit 0.31.11, the latest) | moderate | Dev tool only (`db:generate`). No fix upstream (audit's "fix" is a downgrade to drizzle-kit 0.18). | — | none |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | minimatch via typedoc (SDK api-docs) | moderate | Docs build only. | — | none in 0.28.x |

No advisories against socket.io 4.8.4, engine.io 6.6.11, ws 8.21.3, paseto 3.1.4, marked 15.0.12, liquidjs, ses or quickjs-emscripten showed up in npm audit.

## 4. Unused / duplicate / undeclared

- **`pg` (devDep)** — its only reference is `import type { QueryResult } from "pg"` in `src/lib/server/providers/users/passphrase/set/index.ts:4`. That type comes from `@types/pg`, and drizzle-kit uses `driver: "pglite"` (`drizzle.config.ts:56`). So the `pg` runtime package looks unused. ★ Proposal: remove it, keeping `@types/pg`. Trade-off: none found, but check `db:studio` once.
- `@codemirror/lang-html`, `@lezer/javascript` — not imported directly, but both are **peer deps of `@replit/codemirror-lang-svelte`**. Keep them.
- `esbuild` — not imported statically, but `src/lib/server/components/compile.ts:176` resolves it at runtime, and the SDK cli declares it as a peer. Keep.
- `@zag-js/file-upload` — used only as a type, through a `../node_modules/...` path in `src/app.d.ts:9`. It works, but the path is fragile. Noticed, not done.
- **`sharp` is imported by `scripts/android-icons.js` but not declared**; it resolves only because transformers depends on it.
- **Different majors across the two repos:** `@types/node` (app ^20, SDK root ^22, engines say ≥24); `typescript` (app 5.9.3, SDK root ~7.0.0 → 7.0.2, SDK workspaces 5.9.3). The app also has `esbuild` 0.28 alongside vite 6's own esbuild 0.25 (normal).
- `@serene-pub/*` show "latest 0.6.0-pr-1" in `npm outdated` only because the registry tag lags the `file:`-linked local packages. Ignore.

## 5. Native modules and the multi-platform bundle

- `@huggingface/transformers ^4.2.0` already allows 4.3.2. **A fresh release build therefore already gets** `sharp ^0.35.4` and the pinned `onnxruntime-node 1.30.0` (plus `adm-zip ^0.6.0`), whatever you decide.
- `scripts/licenseExpression.js:12-21` whitelists `@img/sharp-*` **0.34.5** and `@img/sharp-libvips-*` **1.2.4** by exact version. Under sharp 0.35.x (libvips 1.3.x) the licence gate would no longer match those entries. Not verified by running it.
- sharp 0.35 needs Node ≥20.9 (fine) and adds a `@img/sharp-freebsd-wasm32` optional dependency.
- `scripts/onnxRuntimeOverride.js` already documents that transformers 4.3 pins ORT 1.30.0, and that the Intel-mac bundle carries 1.23.2 (owner ruling 2026-10-05; verified against 4.3.0). `scripts/prune-dist.js:49` already handles ORT 1.30's duplicated darwin dylib. So the code is prepared for 4.3.x; the remaining gap is the licence whitelist plus a smoke run per OS.

## 6. Recommendations

### A. Safe now (in range unless noted; patches/minors, no breaking changes touching code, plus security fixes)

| package | from → to | why | risk | test |
|---|---|---|---|---|
| handlebars (app + SDK `sdk/`) | 4.7.9 → 4.7.10 | 2 critical + 1 moderate advisories; card text is compiled server-side | very low (patch) | `npm test`, `sdk:test`; prompt render goldens |
| dompurify | 3.4.14 → 3.4.17 | 5 advisories; sanitises model/card HTML | very low | message rendering, `strictSanitize` DOM tests |
| vite | 6.4.3 → 6.4.5 | 5 dev-server advisories (LAN `dev:host`, Windows) | low | `npm run dev`, `npm run build` |
| vitest | 4.1.11 → 4.1.12 | mocker advisories | low | `npm test` |
| @sveltejs/kit / adapter-node | 2.70.3 → 2.70.4 / 5.5.7 → 5.5.8 | advisories (none reachable by grep); **eligible 2026-11-19** | low | build + start the bundle; login, socket connect |
| svelte (both repos) | 5.57.0 / 5.56.10 → 5.57.3 | patches (5.58.0 is today's) | low | `npm run check`, DOM tests |
| tailwindcss, @tailwindcss/vite | 4.3.3 → 4.3.4 | patch | low | visual spot check |
| @xyflow/svelte | 1.6.6 → 1.7.1 | stays on 1.x | low-med (minor) | pipeline canvas, lorebook navigator (12 files) |
| drizzle-orm | 0.45.3 → 0.45.4 | patch | low | int tests; second boot changes nothing |
| codemirror set, @lezer/javascript, @remote-dom/core, elkjs, prosemirror-model/-view, @zag-js/* 1.47.0, axios 1.21.0, ollama, svelte-check, svelte-dnd-action, translate, tsx, @types/lodash, axe-core 4.14.0, shiki 4.6.0, typedoc-plugin-markdown 4.14.1 | see §1/§2 | patches/minors | low | `npm test`, `npm run check`, code fields, drag-and-drop |
| liquidjs (app + SDK, exact pin) | 10.29.0 → 10.30.1 | minor; **needs pin edit in both** | low | liquid template tests, `sdk:test` |
| transitive (devalue 5.9.4, follow-redirects 1.16.2+, source-map-js 1.2.2, markdown-it 14.3.3) | — | security; arrive with a fresh install / `npm update` | low | — |

### B. Worth doing soon, each its own small task

| package | from → to | why | risk | files / test |
|---|---|---|---|---|
| @huggingface/transformers (+sharp 0.35, ORT 1.30) | 4.2.0 → 4.3.2 | sharp/adm-zip advisories; **already in range, so the next release build takes it anyway** | med (native, 5 targets) | `scripts/licenseExpression.js` sharp whitelist; run the onnx smoke on win-x64, mac-arm64, mac-x64 (1.23.2 override), linux |
| happy-dom (both repos) | 20.14.5 → 21.0.4 | 3 advisories; v21 turns CSS/iframe loading off by default | low | `vitest.config.ts`, SDK `cli/src/testing.ts`, root devDep; DOM test suites |
| @tiptap/* + @tiptap/pm | 2.27 → 3.32.2 | moderate advisory, no 2.x fix | med (v3 API: extension packaging, placeholder/history moves) | 4 files: `LoreContentField.svelte`, `tiptapLegacyTag.ts`, `tiptapLorebookBindingTag.ts`, `tiptapHandlebarsLint.ts` |
| marked (app + SDK docs) | 15 → 18.1.3 | 3 majors behind; changes are in list/blank-line tokens, Node 20+, ESM-only; the app only calls `marked.parse` | low-med (rendering differences) | `markdownToHTML.ts`; message rendering with lists; docs build |
| paseto | 3.1.4 → 4.0.1 | rewrite (`LocalProtocol` + `paseto/v3/local` factories); v3.local still supported | med (auth) | 4 files under `src/lib/server/auth/tokens/` and providers; check that a token minted by 3.x decrypts under 4.x |
| @anthropic-ai/sdk | 0.105 → 0.137.0 (or 1.4.0) | `^0.105` locks the minor | med | `AnthropicAdapter.ts`; wire replay |
| @lmstudio/sdk | 1.5 → 2.1.0 | major | med | `LMStudioAdapter.ts`; Android import-boundary test |
| @types/node | ^20 → ^24 | match `engines` | low | `tsc --noEmit`, `npm run check` |
| dotenv, uuid, env-paths, file-type, gpt-tokenizer, open | majors | small surfaces (2–4 files each; `open` only in a build script) | low-med; breaking notes not researched one by one | `preloadEnv.js`/`bootstrapEnv.ts`, `appDataDir.ts`, card parsers, tokenizers |
| pg | remove (★) | runtime package unused | low | `db:studio` once |

### C. Leave for now

| package | from → to | reason |
|---|---|---|
| @sveltejs/kit 3 + adapter-node 6 + vite-plugin-svelte 7 + vite 8 | 2/5/5/6 → 3/6/7/8 | Wide impact: `svelte.config.js` removed, `$lib`→`#lib`, `$app/stores` gone, cookie path default, rolldown adapter-node with a static file list, TS ≥6. Do it as one programme. |
| typescript | 5.9 → 7.0.2 | kit 2 peer is `^5.3.3 \|\| ^6`; svelte-check. Moves with kit 3. |
| vitest | 4 → 5.1 | 5.1.0 is 16 days old; finish the current test work first |
| zod | 3 → 4 | 24 client files; openai 5 peers zod ^3; advisory unreachable |
| openai | 5 → 7 | two majors; pair it with zod 4 |
| @lucide/svelte | 0.511 → 1.x | about 400 importing files |
| @xyflow/svelte | 1 → 2 | 2.0.0 shipped 2026-11-16 (instruction) |
| skeleton / skeleton-svelte | 5.0.1 → 5.0.5 | every newer patch is ≤10 days old; recheck from 11-22 (the range already lets fresh installs take 5.0.5) |
| prettier 3.10 / plugin-svelte 4 / tailwind plugin 0.8 | | formatting churn; tilde pin looks deliberate |
| drizzle-kit, @tailwindcss/typography | — | already latest; their advisories (dev/build only) have no upstream fix |
| @electric-sql/pglite | 0.2 → 0.5 | separate research track |

## 7. Ranges: already allowed vs need an edit

**Already allowed by `^` (fresh installs and the release build get them anyway):** handlebars 4.7.10, dompurify (up to 3.4.18), vite 6.4.6, vitest 4.1.12, kit 2.70.4, adapter-node 5.5.8, svelte 5.58.0, tailwind 4.3.5, skeleton 5.0.5, @xyflow/svelte 1.7.1, zag 1.48, transformers 4.3.2 (→ sharp 0.35, ORT 1.30), drizzle-orm 0.45.4, axios 1.21.1, codemirror/prosemirror patches, happy-dom 20.14.6, typescript 5.9.3, all transitive security fixes.

Note: these include versions *younger* than two weeks (svelte 5.58.0, skeleton 5.0.5, dompurify 3.4.18, zag 1.48, tailwind 4.3.5). If you want the vetted versions, the only lever without a lockfile is raising the `^` floor; that sets a minimum, not a maximum.

**Need a range edit:** liquidjs (exact, both repos), playwright (exact), prettier (`~3.6`), @anthropic-ai/sdk (`^0.105` locks the minor), @lucide/svelte (`^0.511`), and every major in B/C (tiptap, marked, happy-dom 21, paseto, lmstudio, openai, zod, dotenv, uuid, env-paths, file-type, gpt-tokenizer, open, @types/node, kit 3, vite 7/8, vite-plugin-svelte, typescript 7, vitest 5).

## Sources

- npm registry metadata (versions and dates): https://registry.npmjs.org/<package> (e.g. https://registry.npmjs.org/handlebars)
- GitHub advisories as linked inline (https://github.com/advisories/GHSA-…)
- SvelteKit 3 migration guide: https://svelte.dev/docs/kit/migrating-to-sveltekit-3
- happy-dom v21.0.0 release: https://github.com/capricorn86/happy-dom/releases/tag/v21.0.0
- marked v17/v18 release notes: https://newreleases.io/project/github/markedjs/marked/release/v17.0.0, https://newreleases.io/project/github/markedjs/marked/release/v18.0.0 ; v16 (CJS removed, Node 20): https://github.com/markedjs/marked/releases
- paseto v4 README / releases: https://github.com/panva/paseto/blob/main/README.md, https://github.com/panva/paseto/releases
