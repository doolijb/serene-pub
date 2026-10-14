# Image generation: providers × purposes — design (2026-10-11)

Status: **BUILT + VERIFIED 2026-10-12** (uncommitted — the owner commits; needs an SDK prerelease + pin bump before push, as core-catalog/contracts changed). Was: BUILDING since 2026-10-12 (owner: "Ok, get to work" — every ★ recommendation stands as
ruled, as with card strokes 10-11). Lanes run 3–4 at a time, single task each, targeted tests only;
one grouped verification at the end. Ledger at the bottom (§16). Previous status: PROPOSED 10-11.

## As built — where it differs from the text below

The text below is the design as ruled. What the thirteen build lanes changed (details in §16):

1. **`workflows.document` is TEXT**, not JSON: a graph with Handlebars holes is not valid JSON until
   rendered. A `description` column was added (0104).
2. **`loadouts.transform`** is a column (0103): a loadout knows its transform without a pair, so an
   unfilled one can fall back and a merge can be checked for same-transform.
3. **No `count` param on the image oracle.** Many identical pictures come from the sampling
   config's batch, or from a series (*proofs*); §4.1's `count` was not added.
4. **Gemini is a preset on the OPENAI type** (`google-gemini`), not its own type; its image module
   (`GeminiImageAdapter`) is folded into the OPENAI type's by `withGeminiImages`.
5. **Proofs, not candidates.** Portrait's N identical items are `core:task/build-proofs@1`;
   *candidate* is retrieval's word (§7 of the canon, R1).
6. **Scene is Chat-only.** An inlet is locked to one genre, so Adventure needs a second spec; not built.
7. **Review is ON for Portrait** and is answered by the global `PipelineReviewModal`, which already
   catches sessionless parks; no card-local review UI.
8. **The `loadout` slot is config-named, never wired**: specs name a loadout in their Default
   config (`slot.loadout(...)`), no node wires it (`paramsSlotWiring.test` allows this). Image,
   Scene and the reply specs name theirs; Portrait and Sprite set fill name none and draw on Images.
9. **Migrations**: 0102 `sessions.backdrop_media_id`; 0103 `loadouts` (+`transform`); 0104
   `workflows`; 0105 `loadouts.workflow_id` FK; 0106 (C5a) the backdrop column becomes an FK
   `ON DELETE SET NULL`. `connection_defaults` is emptied by a one-shot into default loadouts.
10. **Words**: `SessionDossierV1.backdrop` → `appBackground`; the Loadouts icon is `Briefcase`
    (`Backpack` is the Inventory widget's); `ImageCapabilities` → `DrawingSheet`, no alias.
11. **Not built**: *Describe from image*, NovelAI *Re-express from neutral* (sheet flag only),
    *Make it*'s smoke-test picture, the wizard's images step, the Image action's *Show a
    character* toggle.

Goal (Jody, verbatim intent): *see how other projects handle multi-provider and multi-purpose image
generation; design something for Serene Pub that's modular and easy to understand.* Use cases named:
multi-sprite / emotion generation, scene generation, portrait generation.

One-line answer: **a purpose is a pipeline, a provider is a connection, and the thing that keeps a
character looking like themself across both is a card field.** Nothing new sits between them. The
oracle that exists today (`core:oracle/generate-image@1`) grows two ports and the adapters grow one
declared capability sheet; everything else is specs, outlets and a card field.

---

## 0. Words (NOMENCLATURE §24 — all 🚧 until ruled)

| Word | Means | Not |
|---|---|---|
| **likeness** | How to *draw* a character: a **likeness image** (the reference the model is shown), a **likeness prompt** (tags/description of their look) and a **likeness negative**. Lives on the **card** and travels with it. UI label **Likeness**. | Not the avatar (that is the card's identity image; the likeness image *defaults* to it). Not a sprite. Not the description (prose for the LLM). |
| **picture job** · **picture pipeline** | A spec whose outlet produces media: Image (free), Portrait, Scene, Sprites. Casual: *the Portrait pipeline*. | Not a *mode* (SillyTavern) — there is no mode switch; each purpose is its own spec with its own slots. |
| **references** (port) | Images handed to the oracle so the output resembles them (`core:oracle/generate-image@1` in-port `references: mediaList`). | Not `init` (img2img starting canvas) and not a mask. The three are different wire fields on every backend that has them (KCPP: `extra_images` vs `init_images` vs `mask`). |
| **backdrop** | A session's current scene image, shown behind or beside the Stage by the **Backdrop widget**; set by the Scene pipeline's outlet or by hand. | Not the user's app background (`user_settings.background_media_id`), not a message attachment. §23 retired *scene image* stays retired — a backdrop is session state, not a left/right pin. |
| **drawing sheet** | What an image adapter *declares* it can draw with: which request knobs it honours, size rules, reference limits, transparency support, images per call. Replaces the ad-hoc `ImageCapabilities`. | Not a capability grade (`native/emulated/none` — those are per transform), not a sampling config. |
| **plain-background** → **cut-out** | A sprite generation asks for a flat single-colour background; a **cut-out** is the result after the alpha step (native on providers that do it, otherwise `core:task/cut-out@1`). | Not "transparent" bare — that is a drawing-sheet flag. |
| **workflow** (ComfyUI) | Comfy's word for its graph. Inside Serene Pub a saved workflow is a **context template** (§15) on the oracle's **`workflow` slot**; the slot keeps Comfy's word because it is the one thing a Comfy user is looking for. | Not a pipeline (our graphs are *specs*; the `Workflow` icon is the pipeline's, §22 — tolerated collision, ★ §9.9), not a profile key. |
| _mode_, _source_ (ST), _imggen_ (Risu) | Boundary words only (R5). | |

---

## 1. What other projects do (research, 2026-10-11; agent reports in session)

Read for the pattern, not the detail. Five roleplay front-ends (SillyTavern, RisuAI, Agnai, KoboldAI
Lite, text-generation-webui), three general chat front-ends (Open WebUI, LibreChat, LobeChat), one
SDK (Vercel AI), and the provider APIs themselves.

**1.1 Nobody has provider × purpose.** Every roleplay app has ONE active image source, global. Purpose
exists only as a prompt template (ST's eleven `generationMode` templates: *you / me / scene / face /
background / last / raw last / free…*; Risu's per-character `imggen` vs `emotion`; Agnai's one
"Image Caption"). Portraits and backgrounds cannot use different backends anywhere. Agnai alone has a
scope chain (user → character → chat settings, with *last speaker* resolution in groups) and lets an
image provider borrow auth from a text provider.

**1.2 Purpose = template + side effects.** ST's modes differ in three things only: the LLM prompt that
writes the SD prompt, the forced orientation (face → portrait, background → landscape), and where the
output goes (background mode sets the chat background). That is exactly what a spec is here: prompt
rows, params, outlet.

**1.3 Per-character art prefix is universal and breaks in groups.** ST stores `sd_character_prompt
{positive, negative}` in the card's `extensions` (shareable) and skips it entirely in group chats
(issue #2946); Risu throws in groups. Agnai resolves to the last speaker. Our cast already knows who is
on stage, so this is solvable, and we must read ST's field at import (R5).

**1.4 Prompt production has three shapes:** (a) a quiet LLM call with a per-mode template (ST, Agnai
on a selectable preset — quality depends on the chat model's instruct setup, ST #4479); (b) the main
model emits an inline tag `<ImgGen="…">` / `<t2i>…</t2i>` and the app renders it (Risu inlay, Kobold
"smart") — one call, model decides when; (c) a tool call with the prompt as argument (Open WebUI
native, LibreChat, LobeChat). We have all three mechanisms already: a text oracle in a spec, the tool
loop, and a composer action with a `collects` form.

**1.5 Parameter normalisation, the two clean designs.**
- **LobeChat:** every image *model* declares a parameter schema `{prompt, imageUrls{maxCount}, size{enum}
  | width/height{min,max,step} | aspectRatio{enum}, steps, cfg, seed, quality…}`; the UI renders only
  declared knobs; adapters rename keys per vendor; the same schema is served to the LLM tool.
- **Vercel AI SDK:** four standard params (`size`, `aspectRatio`, `seed`, `n`) + `files[]` + `mask`,
  `providerOptions` namespaced by provider id, **unsupported → warning, never error**, `maxImagesPerCall`
  splits `n` into several calls, `supportsFileInputs` tri-state.
  Our `Translation.applied/ignored` and `connections.extraJson.profile` are already this split; what is
  missing is the *declaration* up front so forms and specs can know before dispatch.

**1.6 ComfyUI has three integration styles:** user JSON + `%placeholder%` string replace (ST, with
`%char_avatar%` as a base64 reference — the simplest and the only one users can extend), node-id
mapping table (Open WebUI — works on any graph, users must dig node ids), code-built graphs per model
family (LobeChat, Kobold Lite — rigid). ST's is the right *user* experience (one JSON, named holes); we
already own a better mechanism for it — the workflow is a context template rendered by the
template engine (§4.5), so the holes are `{{prompt}}` under law T1, not a private `%token%` grammar.

**1.7 Wire dialects, not vendors.** Eight dialects cover every provider worth having:
A1111-flat (A1111, Forge, SD.Next, KoboldCpp) · OpenAI-images (`/v1/images/generations|edits`:
OpenAI, xAI, Together, KoboldCpp, text-generation-webui) · Gemini image · AI Horde · ComfyUI graph ·
NovelAI · BFL Flux · Stability v2beta. fal/Replicate are per-model OpenAPI schemas (no generic shape)
and are out of scope.

**1.8 Character consistency is "send the same reference every time".** No app has a first-class
reference-set concept. The models that do it well take reference images with the prompt: OpenAI edits
(≤16 images, high fidelity), Gemini Nano Banana (≤4–5 *character* references), Flux.2/Kontext (≤8/4),
Qwen-Image-Edit (local via sd.cpp/KoboldCpp `extra_images` ≤4), NovelAI character reference. SD-era
IP-Adapter/InstantID/PhotoMaker are weaker. NovelAI's `augment-image` `emotion` director tool is
literally "change this sprite's expression".

**1.9 Transparent output:** native on OpenAI (`background: transparent`, png/webp), AI Horde
(`transparent:true` LayerDiffuse or `strip_background`), NovelAI V5; Stability has a remove-background
endpoint; Gemini/Flux/KCPP need post-processing. `onnx-community/BiRefNet_lite-ONNX` (MIT) runs under
`@huggingface/transformers`, which is already a dependency (package.json:127). Prompting for a flat
single-colour background makes the matting trivial.

**1.10 Nobody generates expression sprites.** ST's Character Expressions only *reads* sprites;
third-party tools fill the gap. This is open ground.

**1.11 First-class Comfy integrations (research 2026-10-12; SwarmUI, Krita AI Diffusion,
ComfyDeploy, ViewComfy, comfyui-sdk, Comfy App Mode).** Two camps: **marker nodes** from a node
pack the person installs (`SwarmInput*`, `ETN_Parameter`, `ComfyUIDeployExternal*` — each carries
title/default/min/max/type, returns its value in plain Comfy, the app generates a form from them)
vs **no-install path mapping** (ViewComfy `nodeId.inputs.key`, comfyui-sdk dotted paths, Open WebUI's
node-id table — all break on re-export with new ids). SwarmUI does both: markers if present, else an
**auto-claim walk** by class name + links (our §4.8 walk), filled via `${id:default}` string
placeholders. Everyone: hides generic knobs the workflow did not claim (Krita has none); builds the
checkpoint picker from `/object_info` enums with the baked value as default (Swarm, Krita); skips
`PreviewImage`/`temp` outputs; identifies finals **by node** (`executed` event per node id, Krita's
sink node, ComfyDeploy's `output_id`) with `/history` fallback — Open WebUI took the last node in
JSON order and broke (#14538). **Verified: `POST /prompt` accepts non-numeric node ids** —
`execution.py validate_prompt` iterates dict keys as strings, links resolve by dict lookup,
`graph_utils.is_link` requires a *string* source id, `GraphBuilder` mints prefixed ids, subgraphs
flatten to `1:2:3`. Comfy's own **App Mode** (frontend ≥1.41) declares inputs/outputs first-party,
but only in the UI-format file (`extra.linearData`), absent from Export (API).

---

## 2. What exists here (facts, 2026-10-11 — survey in session)

- **Adapter family** `src/lib/server/imageAdapters/` (`BaseImageAdapter.ts`, `A1111Adapter.ts`,
  `KoboldCppManagedImageAdapter.ts`); shared registry/actions in `src/lib/server/adapters/`.
  Request/profile split is documented in the header (BaseImageAdapter.ts:11-30). `ImageGenRequest`
  (`src/lib/shared/imageGen/types.ts:27-70`) has prompt/negative/size/steps/cfg/seed/sampler/scheduler/
  batch/clipSkip/denoise/model/video. `AdapterActions.editImage?` exists with `init`+`mask`
  (`adapters/actions.ts:219-226, :372`); **no adapter implements it**. `ImageCapabilities`
  (`types.ts:178`) is progress/preview/cancel/batch/video/freeSize/sizePresets/samplers — partial.
- **Registry** (`adapters/registry.ts:49`): image modules on KOBOLDCPP, KOBOLDCPP_MANAGED, A1111.
  OPENAI deliberately has none (registry.ts:88-95 tells the story). **No hosted image provider
  exists**; ComfyUI only as the undispatched sample oracle `chariot.comfy:render-image@1`.
- **Oracle** `core:oracle/generate-image@1` (`SDK/contracts/src/oracles.ts:891-956`): slots
  `connection` (requires `text->image`), `sampling` (shape imageGen), `prompts` (`positive`,
  `negative`), `params{streaming}`; in-ports `prompt`, `negative`, `init` (**declared, unused**);
  out `main/media: mediaList`, `image`, `caption`. Review fields `prompt`, `negative`.
- **One spec**: `core:spec/chat-generate-image` 1.1.0 — composer action **Image** with a `collects.text`
  form → oracle → `createMessage` with media. Prompt rows *Prompt as written* / *Prompt with quality
  tags*. Host `dispatchImage.ts:342` resolves the `text->image` job, renders templates, calls
  `generateImage`, `createMedia` per item with provenance in `files.meta` (prompt, seed, model…).
- **Jobs** are `(input, output)` keyed (`connection_defaults`, 0183); the Models view scopes
  **Images** = `text->image`. `samplingShapeForCapability` already maps any `*->image` transform to
  the image sampling shape. Manifest declares no `text+image->image` anywhere.
- **Sampling** `imageSamplingSchema` (SDK `sampling.ts:557-655`): steps/cfg/width/height/batch/seed/
  sampler/scheduler/clipSkip/denoise; five seeded presets (SD 1.5 default, SDXL, SD 3.x, Flux, Turbo).
  The doc comment already rules hosted knobs (size enum, quality, background) into the profile.
- **Sprites** (`sprite_sets`, `sprites`, 0167): `sprites.source` already admits `generated`;
  `core:oracle/pick-sprite@1` chooses by embedding similarity; **no generation path**. DESIGN-sprites
  §8 row S6 "Fill empty sprites by image generation — on the image-gen plan" is this document.
- **Media**: `createMedia` with provenance ints, buckets `generated`/`backgrounds`, variants
  original/display/thumb/fitted. Lightbox **Info** already shows prompt/seed/model.
- **Widgets**: Scene Portraits (`face: avatar|sprite|chosen`), Album (`source: generated`). **No
  backdrop widget.** `sceneImages` left/right store is retired, removal due 0.7.
- **Cards**: import preserves foreign `extensions` (sockets/characters.ts:696-701) — ST's
  `sd_character_prompt` arrives intact today and is read by nothing.
- **docs/connections.md:579** promises "an online image service such as OpenAI's has no steps or CFG;
  its size and quality options are on the connection instead" — a promise with no code behind it.

---

## 3. The shape

```
                 provider axis                              purpose axis
   ┌────────────────────────────────┐          ┌──────────────────────────────────┐
   │ connection (endpoint, model)   │          │ spec = picture pipeline           │
   │  · image module per dialect    │  slot    │  · prompt rows (positive/negative)│
   │  · drawing sheet (declared)    │◄─────────│  · params (orientation, cut-out)  │
   │  · profile (backend-only form) │          │  · outlet (message/sprite/avatar/ │
   │  · job default text->image     │          │            backdrop)              │
   │             text+image->image  │          └──────────────────────────────────┘
   └────────────────────────────────┘                        ▲
                                                             │ references + likeness prompt
                                                   ┌─────────┴─────────┐
                                                   │ card.likeness     │
                                                   │  image · prompt · │
                                                   │  negative         │
                                                   └───────────────────┘
```

Three independent pieces, each with one owner and one place to edit it:

1. **Provider** = a connection with an image module. Choosing *which* provider a purpose uses is the
   oracle's `connection` slot on that spec: unset → the job default (instance-wide, Models view);
   set in Pipelines → that purpose only. That is Agnai's scope chain reduced to the two tiers this
   app already has (job default → pipeline config; session override is retired, 0130). *Portraits on
   gpt-image, sprites on local Qwen-Edit, scenes on Horde* is three slot values, no new UI.
2. **Purpose** = a spec. Prompt rows are the template; params carry the side effects; the outlet says
   where the picture goes. A modder adds a purpose by adding a spec — the same way genres add
   actions today.
3. **Likeness** = the card's answer to "what do I look like". Every picture pipeline that draws a
   character wires `references ← likeness image` and `{{likeness}}` into its positive prompt.

The oracle is the only thing in the middle and it stays one definition.

---

## 4. The oracle and the request (SDK + host)

### 4.1 `core:oracle/generate-image@1` → `@2`? No — widen in place (additive ports, bumps the hash)

- In-ports: `prompt: text`, `negative: text`, **`references: mediaList`** (new), **`init: image`**
  (keep, now honoured), **`mask: image`** (new). All optional.
- Params: `streaming` (keep), **`orientation: square | portrait | landscape | free`** (default
  `free` = take the sampling's width/height as-is; portrait/landscape swap the longer edge — ST's
  `setTypeSpecificDimensions`), **`cutOut: off | native-or-task | native-only`** (default off),
  **`count: 1..8`** (default 1; overrides sampling `batch` when set — the Sprites spec fans out
  per label, so each call is `count: 1`).
- Slot `connection` keeps `requires: [text->image]`. `requires` is a static list in the SDK
  (`sdk/src/descriptors.ts:133`, `connections.ts:42`), so it cannot flip to `text+image->image` by
  wiring. The gate for references is therefore the **drawing sheet** (§4.3): the bind guard refuses a
  spec whose `references` port is wired to a pair whose sheet says `references: null`. The
  `text+image->image` transform still exists in the manifest (so the Models view can scope *Image
  edits* and a person can pick a different pair for it), but the oracle does not require it (★ §9.2).
- Out-ports unchanged (`main/media: mediaList`, `image`, `caption`).

### 4.2 `ImageGenRequest` gains

`references?: MediaRef[]`, `init?: MediaRef`, `mask?: MediaRef`, `transparent?: boolean`,
`aspect?: "W:H"` (derived from width/height by the host for aspect-only providers; adapters never
compute it twice), `outputFormat?: png|webp|jpeg`. Nothing else. Hosted-only knobs (`quality`,
`moderation`, `style_preset`, `safety_tolerance`, LoRAs, Horde `post_processing`) are **profile**,
as the header rule already says.

### 4.3 The drawing sheet (replaces `ImageCapabilities`)

Declared per adapter, refined per model when the listing knows (OpenAI `gpt-image-1-mini` cannot
`input_fidelity: high`; Gemini Lite is 1K-only). Shape:

```ts
type DrawingSheet = {
  negative: boolean; seed: boolean; steps: boolean; cfg: boolean; sampler: boolean; clipSkip: boolean;
  size: { kind: "free"; step: 8|16|64; min; max } | { kind: "enum"; sizes: string[] } | { kind: "aspect"; aspects: string[]; tiers?: string[] };
  references: { max: number } | null;      // null = no reference input at all
  init: boolean; mask: boolean;
  transparent: "native" | "none";          // "none" ⇒ cutOut falls to core:task/cut-out
  perCall: number;                          // Vercel's maxImagesPerCall; host loops above it
  progress: boolean; preview: boolean; cancel: boolean; video: boolean;
}
```

Consumers: the **sampling form** greys knobs the default pair's sheet says `false` (it already
shows *N of M sent*); the **bind guard** refuses a spec whose wired ports the sheet cannot take
(`references` on a sheet with `references: null` → the same refusal copy as a missing job default);
the host loops `count` over `perCall`; `dispatchImage` keeps writing `applied/ignored` so the Info
pane stays honest. Vercel's rule holds: **unsupported is ignored and reported, never an error** —
with references the report comes *before* the run, on the action's form (§4.6, §6.6), and a spec
may escalate it to a refusal with `references: required`.

### 4.4 Dialect adapters (one each; all ride existing connection presets where the endpoint matches)

| Dialect | Connection type | New? | Notes |
|---|---|---|---|
| A1111-flat | `a1111`, KOBOLDCPP, KOBOLDCPP_MANAGED | exists | add `init_images`/`mask`/`extra_images` (KCPP), `alwayson_scripts` passthrough from profile; sheet per host (KCPP: `perCall:1`, `references:{max:4}` only when the loaded model is an edit model — read from the loaded-model name, else `null`) |
| OpenAI-images | OPENAI, OPENAI_COMPATIBLE (xAI, Together presets), KOBOLDCPP | **new module** | `/v1/images/generations` + `/edits`; sheet: `negative:false, steps:false, size:enum|free(÷16)`, `references:{max:16}`, `transparent:"native"`, `perCall:10`; profile: `quality`, `moderation`, `outputCompression`. Lifts registry.ts:88-95's ban, which was about an *absent* module — the module now exists and the per-model modality gate (0172) keeps chat models out. |
| Gemini image | GOOGLE (existing Gemini preset) | **new module** | `generateContent` with image parts; sheet: `size:aspect`, `references:{max:4}` (character refs), `perCall:1`, `transparent:"none"`, `seed:false` |
| AI Horde | **new type** `horde` (category Services, *free · queued*) | new | async poll; `###` negative; `transparent:"native"`; `perCall:20`; profile: `models[]`, `nsfw`, `loras`, `post_processing` |
| ComfyUI | **new type** `comfyui` (local) | new | the workflow is a **context template** on the oracle's `workflow` slot, never the profile — §4.5; models = checkpoints/UNETs from `/object_info`; sheet derived from what the template reads |
| NovelAI | **new type** `novelai` | new | V4.5/V5; `director_reference_*` for references; `augment-image emotion` surfaces as a **second action** on the sprite row (§6.3) |
| BFL Flux | **new type** `bfl` | new | async poll; `references:{max:8}`; `negative:false`; flex gets steps/cfg |
| Stability | **new type** `stability` | later | `remove-background` is also a cut-out provider |

### 4.5 ComfyUI: a workflow is a context template (canon §15, already ruled)

> **Revised by ruling 14 (fourth revision 2026-10-12, §4.10): a workflow is its own entity (`workflows` table, `workflow-ref` control), not a context template.** What stands here: the rendering engine fills the holes internally, the variable scope, the derived sheet, validation and transport. The canon §15 sentence gets a ledger amendment.

The table above says "ST-style `%placeholder%` workflow in the profile". **Withdrawn.** A profile is
per connection; a Comfy workflow is per *purpose* (a sprite graph with IP-Adapter is not a scene
graph), and NOMENCLATURE §15 already rules the shape: *"A ComfyUI workflow saved as a context
template, rendered and shipped to a ComfyUI API, is the same shape of thing as a prompt document
shipped to a chat model."* So ComfyUI's three axes land on three things that exist:

| Comfy's thing | Ours | Where it is chosen |
|---|---|---|
| server | **connection** (`comfyui`, local) — URL, optional auth; `/object_info` is its probe | New connection |
| checkpoint / UNET | **connection model** rows, listed from `/object_info` (`CheckpointLoaderSimple.ckpt_name`, `UNETLoader.unet_name`, GGUF loaders) — modality `image-gen` | pair: job default or the spec's `connection` slot |
| workflow (API format JSON) | **context template** row, engine Handlebars or Liquid, template id `core:template/comfy-sdxl@1` / `acme.rp:template/comfy-sprite-ipadapter@1`; chosen on a new **`workflow` template slot** of the oracle | the spec (pipeline config), like every other template slot |

**The `workflow` slot.** `core:oracle/generate-image@1` gains a template slot `workflow`
(`acceptedEngines: handlebars, liquid`), **required only when the bound pair's drawing sheet says
`payload: "template"`** (ComfyUI; nothing else). Flat dialects ignore it; the bind guard refuses a
Comfy pair with no workflow chosen (*Choose a workflow for this step*), the same copy family as a
missing job default. A pipeline config such as *Sprites on Comfy SDXL* is then: connection slot =
the Comfy pair, workflow slot = the IP-Adapter sprite template. Provider × purpose, no new tier.

**Template scope** (law T1 applies; `checkTemplateSource` decides fit): `prompt`, `negative`,
`seed`, `steps`, `cfg`, `width`, `height`, `sampler`, `scheduler`, `clipSkip`, `denoise`, `model`
(the pair's model id), `references[]` and `init` / `mask` as **server filenames** (the host uploads
each through `POST /upload/image` *before* rendering, so a template writes
`"image": "{{references.[0].filename}}"` into a `LoadImage` node and never sees base64),
`transparent`, `count`, `clientId`. A workflow that reads nothing it is not given fits; one that
reads `annex` or `history` does not. Numbers render unquoted because the template author writes
`"seed": {{seed}}`, not `"{{seed}}"` — the ST quote-swap hack is unnecessary with a real engine.

**The drawing sheet is derived from the template**, not declared by the adapter: `negative: true`
iff the workflow reads `negative`; `references: {max: n}` from the highest `references.[i]` read
(or 8 under `{{#each references}}`); `seed/steps/cfg/sampler` likewise; `size` is `free` when it
reads `width`/`height`, else `enum` with the one size baked into the graph (read back from the
rendered `EmptyLatentImage`); `transparent: "native"` iff it reads `transparent` (a LayerDiffuse
graph); `perCall` = 1 unless it reads `count` into `batch_size`. The sampling form therefore greys
exactly the knobs *this workflow* ignores, and the Info pane's `ignored` list is honest per graph.
The sheet is computed at template selection and cached on the config, recomputed on template save.

**Validation, three layers.** (1) Template check at save: renders with sample values and must parse
as a JSON object whose values each have `class_type` + `inputs` (API format, not the UI format —
the UI's `nodes/links` save cannot be converted server-side; the editor says *Export (API) in
ComfyUI's Dev mode* and refuses the UI shape by name). (2) `/object_info` at bind and on connection
test: every `class_type` must exist on the server, else the connection row goes `unfinished` with
*Missing nodes: IPAdapterApply, LayerDiffuseApply* — the custom-node pack is the person's to
install. (3) `node_errors` from `POST /prompt` surfaced as the run's refusal, verbatim.

**Transport.** `POST /prompt {prompt, client_id}` → `WS /ws?clientId=` for `progress` / `executing`
/ `executed` (maps onto the existing `ImageGenProgress`; preview from `PreviewImage` binaries on the
socket) → `GET /history/{id}` → `GET /view?filename&subfolder&type` for every `SaveImage` /
`PreviewImage` output. Cancel = `POST /interrupt`. Progress/preview/cancel are `true` on the sheet.

**Starter workflows** ship as seeded `workflows` rows (idempotent seed keys), like seeded prompt rows: *SD 1.5
text-to-image*, *SDXL text-to-image*, *Flux (GGUF) text-to-image*, *Flux Kontext with reference*,
*SDXL + IP-Adapter sprite (plain background)*, *SDXL + LayerDiffuse cut-out*. A person clones one
in the templates library and edits the JSON in a CodeField (10-09 ruling); a plugin ships its own
under `templates[]`. What the template does not know (which LoRA, which VAE name on *this*
server) is a **template variable with a default** the person sets on the config, the same way a
prompt row's fields work today — not a profile key.

**Not done:** pulling saved workflows off the server (`/userdata?dir=workflows` returns the UI
format; no server-side conversion exists), ComfyUI "workspaces"/user accounts (multi-user Comfy
puts a `comfy-user` header on every call — one profile key, later), SwarmUI (speaks A1111-flat
already, so it is the `a1111` type). The sample oracle `chariot.comfy:render-image@1` is retired by
this section: core dispatches Comfy through the one oracle.

### 4.6 Specs never name a connection type — they declare needs

Asked 2026-10-11: *should we allow pipelines that work for only specific connection types?* **No by
type, yes by need.** A spec may be *useless* on most pairs (a sprite spec whose workflow is an
IP-Adapter graph) but it never says "ComfyUI"; it says what it needs, and the bind decides. This is
the same line R53 draws for plugins (blind to connections; may know only which capabilities are
available) and the same sentence docs/connections.md already makes to users: *a job can only be
given a model whose capabilities include it.* A vendor name in a spec would be a third gate beside
transforms and the drawing sheet, and the first one that goes stale when KoboldCpp learns a trick.

How a spec declares a need, with nothing new to learn:

| Need | Declared by | On a pair that lacks it |
|---|---|---|
| a transform (`text->image`) | the oracle's `requires` (exists) | refused at bind (exists) |
| reference images (likeness) | wiring the `references` port + oracle param `references: preferred \| required` (default **preferred**) | **preferred**: the pre-run form says *This model can't take a reference image; drawn from the likeness prompt and a fixed seed, so it will match less closely* and the run proceeds (`ignored: references`). **required**: refused at bind. Soft by default because a sprite set from the prompt alone is what the person would choose over nothing (walk §6.6); the subject-swap worry is met by the notice being on the form, before the run. |
| an alpha cut-out | param `cutOut: native-only` | refused; `native-or-task` degrades to `core:task/cut-out@1` |
| a template payload (Comfy) | filling the `workflow` slot | **not used, reported** (*Workflow not used: <pair> takes a flat request*) — the spec still runs, from prompt rows, and the host re-packs the series (§4.7), so a config moves between a Comfy pair and a hosted one without edits |
| negative / seed / steps / cfg / sampler | the sampling config | sent if the sheet says so, else `ignored` on the receipt and Info pane (exists) |
| an expression edit (NovelAI `augment-image emotion`) | a node on `core:oracle/express-image@1` (I10), whose `requires` is a sheet flag `expressions` | refused at bind |

Rules that follow:
- **Hard needs are the ones a person cannot see failing in the output.** Everything else degrades
  with a report — and a *pre-run notice on the form* where the degradation changes what the
  picture is of (references). (The Vercel rule; §4.3's references exception now reads: refused
  only when the spec says `required`.)
- **Refusal copy names the need and the pair, never a vendor:** *needs a model that takes
  reference images*, not *needs ComfyUI*. The Image/Scene/Portrait buttons stay clickable and fail
  with one message linking Defaults (10-11 ruling); the job sheet greys unfit pairs with the same
  reason (exists for transforms; extend to sheet facts).
- **Presets may be tuned for a dialect; they still do not bind one.** A spec ships presets such as
  *Comfy SDXL sprites* (names a workflow template + 832×1216) and *gpt-image sprites* (no workflow,
  `cutOut: native-only`). Picking one sets slots and params; the pair is still whatever the job
  default or the config says.
- **Plugins** get the same door R53 already opens: the capability table a plugin may read gains
  the sheet facts of the job default (`references`, `transparent`, `payload`), so a plugin's
  catalogue entry can state *Needs a model that takes reference images* and the host shows it the
  way *Off / Needed* shows for jobs. A plugin never learns the type.
- **The one place a type is legitimately read** is the adapter registry, which maps a type to its
  module and sheet. Nothing above it repeats the mapping.

### 4.7 Series: many pictures from one step, and who decides the packing

Raised 2026-10-11: *a Comfy workflow could generate 12 images at a time.* It can, in two different
senses, and the spec must not care which:

- **a batch**: `EmptyLatentImage.batch_size = 12` — twelve pictures of ONE prompt (portrait
  candidates; sprite variants under one label);
- **branches**: twelve `KSampler → SaveImage` chains, each with its own prompt text and
  `filename_prefix` — twelve DIFFERENT pictures from one queue call (a whole sprite set, the
  reference loaded once, no per-call model reload: the efficient path on a local GPU).

§4.3's `perCall` and §6.3's per-label gather both assumed one picture per call. Replace them:

**The oracle takes a series.** New in-port `series: list<{key, vars}>` on `core:oracle/generate-image@1`
(optional; absent = one item, key `"1"`). The prompt rows render **per item** with `vars` in scope
(`{{labelPhrase}}`), the shared ports (`references`, `negative`) once. Every media item on the out
ports carries its `key`. Spec authors write *what* pictures they want; nothing in a spec says how
many calls that is.

**The host packs the series into calls** from the sheet, in this order:
1. **Keyed graph** (Comfy; *revised 2026-10-12, §1.11*) — no template authoring needed: the host
   renders the one-branch template **once per item**, prefixes every node id in that render with
   the item's key (`joy:3`, `joy:9`; links rewritten alike — Comfy accepts string ids, verified),
   **merges** the renders into one prompt and **dedupes nodes whose rendered JSON is identical**
   across items (the checkpoint loader, the reference `LoadImage` appear once). One call per
   chunk of `seriesMax`; outputs keyed by the marked output node under each prefix (§4.11).
2. **Batch** — `perCall ≥ n` and every item's rendered prompt is identical (candidates): one call
   with `count: n`, outputs keyed by order.
3. **Loop** — otherwise one call per item, the existing `perCall` loop (hosted APIs, A1111, KCPP).

The spec runs on every pair; only the receipt differs (*12 pictures, 1 call* vs *12 pictures, 12
calls*). This is what makes "workflow not used" in §4.6 genuinely soft: dropping the workflow
changes the packing, never the set of pictures.

**The sheet learns outputs.** `outputs: { perRun: number; keyed: true }` for every Comfy template
(keyed packing is always available by the merge above); `perRun` = the marked output node's
latent `batch_size` in the rendered sample. The template check **warns** when `perRun > 1` and
the template does not read `count` (*This workflow makes 4 pictures per item; extras become
variants*) — not refused. `seriesMax` (default 8) is a connection profile value, since how many
branches fit is a property of that server's VRAM, not of the graph.

**Surplus and shortfall are host rules, not spec rules.** Surplus *inside a keyed call* (a
one-branch graph with `batch_size: 4` baked, called for `joy`) = **variants of that key** —
sprites already admit several under one label, Portrait keeps them as candidates. Surplus with no
key context (a batch-12 graph asked for 4 identical items): the first *n* are keyed, the rest are
kept as unkeyed media on the run (the Album shows them; `attach-sprite` ignores unkeyed; the
receipt counts them). Fewer (a branch failed,
Gemini "won't always follow the count"): the missing keys are reported and the outlet fills what
it has — the Sprites contact sheet shows an empty tile with **Redo**.

**Cost guard** is computed from the same packing before the run starts: the action's form says
*28 pictures · 3 calls on <pair>* and, for a billed service, the per-image price from model facts.

Consequences elsewhere: §4.3 `perCall` stays (it is rule 2/3's input); §6.3 is rewritten below to
hand the oracle a series instead of fanning out; §6.2 Portrait's `count: 1..4` becomes a series of
*n* identical items so a batch graph serves it in one call.

### 4.8 Bringing in a person's own ComfyUI workflow

Asked 2026-10-11: *a user uploads a custom ComfyUI workflow.* A raw export has no template holes
and one branch, so §4.5's "paste a template" is the modder's path, not the user's. The user's path:

1. **One door.** The ComfyUI connection view's Workflows tab → *Add workflow*: import a file, or a
   starter. Creates one `workflows` row (§4.10).
2. **Format check** (deterministic): API format only — an object whose values each carry
   `class_type` + `inputs`. The UI save (`nodes`, `links`, `widgets_values`) is refused by name
   with *Export (API) from ComfyUI's Dev mode*. (Converting UI → API needs each node's widget
   order from `/object_info`; possible, fiddly, not phase 1.)
3. **Fitting = a graph walk, then a confirm form.** From each `KSampler` (and the
   `SamplerCustom`/`KSamplerAdvanced` family) follow `positive`/`negative` to `CLIPTextEncode`
   (prompt, negative), `latent_image` to `EmptyLatentImage` (width, height, batch_size), `model`
   back through LoRA nodes to the checkpoint/UNET loader (model), `seed`/`steps`/`cfg`/
   `sampler_name`/`scheduler` on the sampler; `LoadImage` nodes are reference/init/mask
   candidates (decided by what consumes them: IP-Adapter/ReferenceLatent → reference,
   `VAEEncode` → init, `*mask*` → mask); `SaveImage`/`PreviewImage` are outputs. The same walk
   KoboldCpp's Comfy emulation does, as a pure function (`fitComfyWorkflow(graph) → proposal`).
   The person confirms each proposed row (Open WebUI's mapping table, prefilled); any other
   literal (LoRA name, VAE, upscaler) can stay literal or be **promoted to a variable** with the
   current value as its default. On confirm the JSON is rewritten with `{{prompt}}` etc. at the
   chosen spots and saved. The wizard writes a template; it is not a second kind of thing.
4. **The sheet as a sentence** on the saved row: *This workflow takes a prompt, a negative, a seed,
   a size and 1 reference image. It makes 1 picture per run. No transparent output: the cut-out
   step will run for sprites.* The same facts the sampling form greys by and the bind guard reads.
5. **Server check**: every `class_type` looked up in `/object_info`; missing → connection row
   `unfinished`, *Missing nodes: …*. Then *Draw a test* (the existing Test Generation path) with
   sample values.
6. **Default workflow on the connection** (profile key `defaultWorkflowTemplateId`, set on first
   import, changeable in the connection view): used when a spec's `workflow` slot is unset. Without
   it, a Comfy pair as the Images job default makes the free Image action refuse at bind. Slot
   beats connection default, like every other layered default here.
7. **Series**: *revised 2026-10-12* — a one-branch custom graph packs as a **keyed graph** (§4.7
   rule 1) with no authoring: the host renders per item, prefixes ids by key, merges and dedupes.
   *28 pictures · 4 calls* on the default `seriesMax` of 8. The old phase-2 *Make this a series
   workflow* item is gone.
8. **Markers recognised, never required** (§1.11): a workflow that already carries `SwarmInput*`,
   `ETN_Parameter` or `ComfyUIDeployExternal*` nodes has those treated as declared variables
   (title, default, min/max, type from the node) in the fitting form. We ship no node pack (§4.9).
9. **Variables are keyed by name**, Krita-style: re-importing an edited export re-runs the walk
   and keeps config values whose variable names survived; a renamed variable is a new one.
10. **Comfy App Mode** (`extra.linearData` in the UI file) is the first-party declaration of
   inputs and outputs and the one reason to read UI format later; Export (API) drops it.

### 4.9 ComfyUI is a host, never a managed runtime: what we read, say and refuse

Asked 2026-10-11: *how do we handle not managing the Comfy workflows, models and settings?*
The connection vocabulary already has the line: a **managed connection** is a runtime this pub runs
(KoboldCPP, Ollama — teal chip, status card, Remove from this pub, model directory, downloads); a
host it merely talks to is outlined, *Address only*. ComfyUI is the second kind, exactly like
external KoboldCpp and A1111. Being explicit about the consequences:

| | ComfyUI |
|---|---|
| **Reads** | `GET /object_info` (node types + every loader's enum of accepted names: `ckpt_name`, `unet_name`, `lora_name`, `vae_name`, `upscale_model`, `sampler_name`, `scheduler`) · `GET /system_stats` (version, device, VRAM → facts line) · `GET /queue` (busy) · `GET /history/{id}` · `GET /view` |
| **Writes** | `POST /upload/image` (references, by filename) · `POST /prompt` · `POST /interrupt`. Nothing else. **Never** ComfyUI-Manager's install/download routes, never `/userdata` writes. |
| **Models** | `connection_models` rows = the checkpoint/UNET enum from `/object_info`, modality `image-gen`, **no size/quant facts** (we cannot see files). Sync marks a vanished name *no longer listed*. The pair's model is sent only when the template reads `{{model}}`; otherwise the receipt says `ignored: model (the workflow bakes its own)` and the connection view says the same in one line. The **model finder never offers a Comfy connection as a destination**; *Get a model* is not shown there. |
| **Settings** | None of Comfy's. The profile is: URL · optional auth header · `defaultWorkflowTemplateId` (§4.8) · later `comfy-user`. Steps/cfg/size/sampler come from the sampling config **only where the template reads them** (the sheet); a baked literal wins and the form greys that knob. No threads, no VRAM flags. |
| **Validation** | At template save, at bind, on connection test: every `class_type` ∈ `/object_info`, and every **literal that lands on an enum input** (a baked checkpoint, LoRA, VAE, upscaler, sampler) ∈ that input's enum. A miss puts the connection row `unfinished` and **names it**: *Missing nodes: IPAdapterApply* · *This workflow names `sdxl_base.safetensors`; your ComfyUI doesn't have it.* One button on the row: **Open ComfyUI** (the URL). We say; the person fixes it there. |
| **Drift** | A sync after the server changes re-checks every template bound through that connection; a template whose names went missing gets a warning badge in the library and its bind refuses with the reason (the swapped-embedding-model precedent: never remap silently). |
| **Managed Comfy** | Out of scope, likely for good: a Python environment + custom node packs + a GPU is not one binary and one model file. If it ever comes, it is a new managed type, not this one. |

### 4.11 Keying outputs: how the host knows which picture is which

Asked 2026-10-11 (*for multi-image outputs, how do we determine what each image is, i.e. sprites?*).
**Keys come from the plan, never from the pixels.** Per packing:

| Packing | Key source | Several images back |
|---|---|---|
| loop (one call per item) | the call's item | variants of that key (§4.7) |
| batch (identical prompts only) | order returned | correct by construction: the items are interchangeable |
| keyed graph (Comfy) | **node id**: the marked output node of item `joy` is `joy:9`; the `executed` event names the node, `/history` is keyed by node — match on the id prefix up to the first `:` (ids verified non-numeric-safe, §1.11) | each item's marked output is its key; other SaveImages in the branch are **extras** (kept on the run, unkeyed); `PreviewImage` and `type: "temp"` outputs are previews for the progress stream, never outputs (every first-class integration skips them) |

Rules:
- **Keys are sanitised before rendering**: label normalised (trimmed, case-folded), spaces → `-`,
  non filename-safe characters dropped, collisions suffixed (`joy`, `joy-2`). The host keeps the
  key → label map; the template never sees a raw label. (A key is also what `{{key}}` renders
  into prompt text, so the *phrase* comes from `vars.labelPhrase`, never from the key.)
- **Which SaveImage is the output**: the import marks one per branch (`role: output`; default the
  node fed by the final `VAEDecode` on the sampler's chain). Only that node's prefix carries the
  key. A template author can move the mark.
- **Node ids are the key** (verified 2026-10-12: `validate_prompt` iterates string keys, links
  resolve by dict lookup, `is_link` requires a string source, `GraphBuilder` mints prefixed ids).
  `filename_prefix: serene/{{runId}}/{{key}}` is still written, for server tidiness only.
- **No content check.** The host never classifies the picture to confirm it matches its label;
  if the plan keyed it wrong, the fix is the template. A person moves a tile to another label on
  the contact sheet (moves the sprite row, the existing editor action).

### 4.12 Where Comfy workflows live and are managed (asked 2026-10-12)

- **Storage**: one `workflows` row per workflow (§4.10): dialect, the JSON with holes, variable
  declarations, the output mark. Nothing on disk, nothing in the templates table. Plugins ship
  them under `workflows[]`.
- **Server-agnostic**: listed under every ComfyUI connection's Workflows tab with that server's
  validity chip (ready · missing nodes · names a checkpoint it lacks).
- **One home**: the **ComfyUI connection view → Workflows tab** — *Add workflow* (import or
  starter), *Set as default*, *Edit · Duplicate · Export · Delete*. The templates library never
  lists them.
- **One editor**: JSON in a CodeField, the variables panel (fitting walk, re-runnable after a
  paste), the output mark, the sheet sentence, *Draw a test* against a chosen Comfy connection.
- **Chosen** in the job sheet (Images default) and in Pipelines on a spec's connection slot as the
  pair (Comfy, workflow); its sampling configs in the Sampling view grouped under the workflow's
  name and in the job sheet's step 3.
- **Who**: admins manage (connections + prompt writes are admin-only, 10-09); members meet a
  workflow only as the pair named on the Fill form.
- **Export**: one file = JSON with holes + the meta block (round-trips between installs); *with
  current defaults* writes a runnable plain-Comfy API file instead.

### 4.10 A workflow is its own entity (ruling 14, fourth and final revision 2026-10-12)

History, kept so it is not re-walked: (B) checkpoint as model + workflow as a template slot — no
guard against (OpenAI, workflow), dead Use buttons. (A-old) a template row addressed by a model
row — "even more confusing". (A) a `connection_models` row — a vocabulary stretch, no plugin
shipping, needs a catalogue. (C) a *scoped* context template with a general template requirement —
owner: *most image providers don't need a context template, and a document that appears only when
a Comfy pair is selected can't be called a template and put in that table.* Correct: a context
template is what every service call renders; a workflow is a document one dialect consumes.

**Workflow = its own entity.**
- Table **`workflows`**: `seed_key` (shipped starters, idempotent like every other seed), `name`,
  **`dialect`** (`comfyui` today; the column is what lets a second graph backend fit without a
  second table), `document` (the JSON with holes), `variables` (declarations: `name`, `type`,
  `default`, range or enum source, group), `output_node` (the mark), timestamps. Server-agnostic.
  Not a template, not a model, not a config: a **provider document** — the only kind there is.
- **Rendering**: the Handlebars engine fills the holes, internally, as the prompt renderer does.
  Canon §15's "a ComfyUI workflow saved as a context template" → ledger amendment: *rendered with
  the template engine; not a context template.*
- **Selection**: the oracle's `workflow` slot takes a new control **`workflow-ref`** (sibling of
  `connection-ref`); value `{ id }`. Shown only when the connection slot's pair has a sheet that
  says `payload: "template"` (slot-level shown-when on a sibling slot's sheet fact — the one new
  editor mechanism); lists workflows of that pair's dialect. The **template requirement** of
  revision C is withdrawn: a workflow slot offers only workflows and workflows are offered nowhere
  else, so there is nothing to scope.
- ~~Connection default workflow~~ — **deleted by §11**: the Images default loadout carries the workflow.
- **Checkpoint = the pair's model**, promoted into the `{{model}}` hole by default (SwarmUI's way);
  a graph that must keep its checkpoint leaves it literal (`ignored: model` on the receipt).
- **Sampling shape** keyed by workflow id (§7.1).
- **One home**: the ComfyUI connection view → **Workflows** tab — the rows of this dialect, each
  with this server's validity chip (ready · missing nodes · names a checkpoint it lacks),
  *Add workflow* (import a file, or a starter), *Set as default*, *Edit · Duplicate · Export ·
  Delete*. **Nothing in the templates library.**
- **Plugins** contribute under a new manifest key **`workflows[]`** (the shape of `templates[]`,
  landing in this table, id grammar `acme.rp:workflow/sprite-ipadapter@1`). R53 holds: a plugin
  ships a document; it never touches a connection.
- The mismatch question is closed by construction: the only control that can hold a workflow is
  shown only for a template-payload pair.

Order of building: OpenAI-images and ComfyUI first (they unlock hosted + every local graph), then
Gemini, Horde, NovelAI, BFL. Stability last (docs unscrapable; verify fields first).

---

## 5. Likeness (the card)

Column-free: stored in `characters.extensions.serenepub.likeness` `{ imageMediaId?, prompt?,
negative? }` so it **travels in the card** (dowry precedent, DESIGN-card-strokes B) and round-trips
between installs. Export writes it; import reads it, and reads ST's `extensions.sd_character_prompt
{positive, negative}` into `prompt`/`negative` when ours is absent (R5 boundary, one direction).

- **Likeness image** defaults to the avatar; the card editor's Likeness tab offers *Use avatar*, *Pick
  from gallery*, *Pick a sprite* (the default set's `neutral` is the natural choice once sprites
  exist). Media role pointer like `avatarMediaId` — provenance stays on `files`.
- **Likeness prompt** is a tag line (*"adult woman, red braid, green cloak, freckles"*), not prose; the
  editor's helper **Describe from image** runs `core:oracle/caption-image@1`-style call on the
  vision job (ST's multimodal captioning, 1.3) — only if a vision job is set, else hidden.
- **Prompt template access:** `{{likeness}}` / `{{likenessNegative}}` macros for the speaker, and
  `core:var/likenesses@1` (`[{name, prompt}]`) for everyone on stage — the group-chat answer: a scene
  prompt names each present character's tags; a multi-reference provider gets each one's likeness
  image in `references`, ordered by stage presence.

Personas are characters (0132), so a persona has a likeness too; *"me"* pictures need nothing extra.

---

## 6. The four picture pipelines (core-catalog specs)

All four reuse the one oracle. Each is a few nodes.

### 6.1 Image (free) — exists, `core:spec/chat-generate-image`
Add: wire `references ← likeness image of the speaker` only when the collects form's **Show a
character** toggle is on (ST's `{{charPrefix}}`); param `orientation: free`. Otherwise unchanged.

### 6.2 Portrait — `core:spec/character-portrait` (new; runs from the Characters view, not a session)
```
inlet card-action(characterId) → task build-prompt (likeness prompt + template "portrait of …")
  → oracle generate-image { series: n identical items (n = 1..4), references: [likeness image]?, orientation: portrait }
  → outlet core:outlet/offer-media@1  (gallery row + a "Use as avatar" affordance)
```
Review preset **on** by default here (a person is already in an editor; the parked form shows the
prompt — ST's refine popup). Prompt rows: *Portrait, tags*, *Portrait, prose* (hosted models prefer
prose; SD prefers tags — the row is the switch, no new mechanism).

### 6.3 Sprites — `core:spec/sprite-set-fill` (new; from the card's Sprites tab, per set)
```
inlet card-action(characterId, setName, labels[] = empty slots by default)
  → task build-series   (one item per label: key = label, vars = { labelPhrase })
  → oracle generate-image { series, references: [likeness image], prompt row "{{likeness}}, {{labelPhrase}}, full body, plain flat green background",
                            orientation: portrait, cutOut: native-or-task, seed: fixed per run }
  → task core:task/cut-out@1   (per item; no-op when the sheet said native; BiRefNet-lite ONNX otherwise)
  → outlet core:outlet/attach-sprite@1 (each keyed item → sprites.file_id under its label, source: "generated"; unkeyed ignored)
```
- **One spec, three packings** (§4.7): a keyed Comfy graph draws the set in one or a few calls with
  the reference loaded once; a batch graph or hosted API loops per label. The spec never knows.
- **Label phrases**: a prompt row *Sprite label phrases* mapping the standard 28 (+ anything
  free-form falls back to the label word itself) → `"joy: smiling warmly, eyes bright"`. Editable,
  per genre or globally, like any prompt row. The classifier labels and the phrases stay two
  vocabularies (R5): the picker never reads phrases.
- **Same seed across the series** plus the same likeness image is what makes the set cohere on
  SD-class backends; on edit-class models (gpt-image, Gemini, Kontext, Qwen-Edit) the reference does
  the work and the seed is ignored per sheet.
- **NovelAI extra**: when the sprite set's connection is NovelAI, `attach-sprite`'s row menu offers
  *Re-express from neutral* → `augment-image emotion` on the neutral sprite (cheapest, most
  consistent). An adapter action `expressImage?(ref, label)` behind an `expressions: true` sheet
  flag; nothing else knows it exists.
- Review: off by default (28 forms would be absurd); the Sprites tab shows the results as a
  contact sheet with **Keep / Redo** per tile (the Album widget's tile + an action, not a new
  widget); a missing key is an empty tile with **Redo**.
- Budget guard: the action's form says *28 pictures · N calls on <pair>* (§4.7) and, for a billed
  service, the per-image price from model facts when known.

### 6.4 Scene — `core:spec/chat-illustrate-scene` (new; session action **Scene**, genre Chat +
Adventure)
```
inlet session-action → query history(last N lines) + core:var/likenesses@1
  → oracle generate-text { prompt row "Scene prompt from the last lines" → tag list }   (quiet call, 1.4a)
  → oracle generate-image { references: likeness images of present cast (≤ sheet.max), orientation: landscape }
  → outlet: EITHER create-message(media)  OR  core:outlet/set-backdrop@1   (param `placement: message | backdrop | both`)
```
- The text oracle has its own `connection`/`sampling` slots → Agnai's "separate preset for the caption
  step" for free; defaults to the chat pair.
- **Backdrop** is session state: `sessions.backdropMediaId` (role pointer, same as avatar), published
  as `backdrop` for enabled-when; the **Backdrop widget** (new, small: shows it, *Change* opens the
  Album/gallery picker, *Clear*). ST's background mode, without touching the app background.
- *Illustrate every N turns* and the model-emitted tag (Kobold "smart", Risu inlay) are presets of
  this same spec later: `trigger: action | everyNthReply | modelTag` — §8, not phase 1.

### 6.5 Where they appear

| Pipeline | Surface | Needs |
|---|---|---|
| Image | composer action (exists) | `text->image` |
| Portrait | Characters view, card → *Generate portrait*; wizard's Character step | `text->image` (+ `text+image->image` when a likeness image is set) |
| Sprites | card → Sprites tab → *Fill empty sprites* / *Redo* per tile | `text+image->image` preferred; falls to `text->image` + seed with a notice |
| Scene | composer action **Scene**; Backdrop widget's *Illustrate* | `text->text` + `text->image` |

Jobs grid: **Images** stays `text->image`; **Image edits** (`text+image->image`) is a new tile under
the same output-kind group, *Off* until something asks (session-actions.md:174 rule).

---

### 6.6 Two walks, from a new instance (the test of the whole design)

**A — twelve sprites on ComfyUI, one button.**
1. Wizard: chat model as today. Images untouched.
2. Connections → New connection → *Images* filter → **ComfyUI** (*Address only*) → URL → Test:
   `/object_info` read, checkpoints listed, row gold *unfinished — no workflow yet*.
3. **Add workflow**: paste an API export → fitting form (prefilled, §4.8) → sheet sentence; or a
   **starter** (*SDXL + IP-Adapter sprite, plain background*; validated — missing IP-Adapter nodes
   → offered *SDXL text-to-image* instead). Becomes the connection's default workflow.
   *Draw a test* → row green.
4. Models → **Images** tile → job sheet: ComfyUI · checkpoint (*used only if the workflow reads
   `{{model}}`*) · the workflow's *Default* config (its own dials, §7.1). Images job set.
5. Characters → card → **Likeness** tab: image = avatar (default); tag line typed, or *Describe
   from image* when a vision job exists.
6. Sprites tab → **Fill empty sprites** → form: *12 pictures · 2 calls on ComfyUI · sdxl_base*
   (keyed starter) or *· 12 calls* (one-branch custom) → Generate → contact sheet fills, Keep/Redo.

Steps 2–4 admin; a member does 5–6. **Pipelines is never opened.**

**B — switch to KoboldCpp, a new twelve, one button.**
1. Models → **Get a model** → scope *Images* → destination managed KoboldCPP → a curated image
   GGUF → downloads.
2. **Images** tile → job sheet: KoboldCPP · that model · matching preset. Three clicks.
3. Sprites tab → **New set** (*Summer*) or **Redo all** → **Fill empty sprites** → form:
   *12 pictures · 12 calls on KoboldCPP*; first time also *downloading the background remover,
   once* (no native alpha → `cut-out`). With plain SDXL loaded the form adds the references
   notice (§4.6, preferred); with Qwen-Image-Edit loaded the likeness goes through
   `extra_images` (sheet `references {max 4}`). Generate.

The switch is the job sheet (3 clicks) + one button. A per-run *Draw with* picker on the Fill form
would make it one click but reintroduces a tier the app retired (session connection override,
0130); the form shows the pair with **Change** → job sheet instead, matching the Image action's
*links Defaults* rule (10-11).

## 7. Sampling, size and the "hosted has no steps" problem

- Keep `imageSamplingSchema` as the SD-family truth. The sheet decides which knobs the form offers
  and which the adapter sends — no second schema for hosted. `docs/connections.md:579` becomes true
  by the OpenAI module's profile (`quality`, `background`, `outputCompression`).
- **Size**: sampling holds `width/height`; `orientation` on the spec swaps them; for `size: aspect`
  sheets the host derives the nearest declared aspect + tier and records `applied: aspect 3:2
  (from 1216×832)`. For `size: enum` sheets, nearest enum. One place (`buildImageRequest`).
- Seeded presets gain **Hosted (OpenAI/Gemini)** = steps/cfg disabled, 1024², batch 1 — so the
  sampling row for a hosted pair reads *2 of 10 sent* instead of implying 25 steps happened.

---

### 7.1 A Comfy workflow defines its own sampling shape (raised 2026-10-11)

The owner: *not confident the normal images sampling config is appropriate for ComfyUI workflows.*
Agreed, structurally: `imageSamplingSchema` is the SD knob set; a graph bakes most of it and has
dials of its own (IP-Adapter weight, LoRA strength, second-pass denoise, Flux guidance, two
samplers with two step counts). "SDXL preset with seven of ten knobs greyed" says nothing.

**Rule:** a workflow is a **sampling shape** of its own, id = the workflow id, schema = its
variables:
- **standard variables** the template reads (`steps`, `cfg`, `seed`, `width`, `height`, `sampler`,
  `scheduler`, `denoise`, `clipSkip`, `count`) reuse `imageSamplingSchema`'s field definitions
  (same label, range, default) — shared vocabulary, not a shared schema;
- **promoted variables** (§4.8 step 3) become fields with the literal as default; type inferred:
  number → number field; a string on an enum input → a select filled from the connection's cached
  `/object_info` enum (a promoted `lora_name` offers the server's LoRA list); other strings → text;
- nothing else: the form is exactly this graph's dials, "N of N sent" always.

Downstream is existing machinery: named configs under that shape in `sampling_configs` and the
Sampling view (grouped under the workflow's name); the job sheet's step 3 (*How it draws*) lists
the default workflow's configs for a Comfy pair instead of the SD presets; a spec's `sampling`
slot picks one per purpose; `followDefaultPreset` behaviour on a template major bump (a new major
is a new shape; configs do not carry). The drawing sheet stays for flat dialects and for bind
checks; for Comfy the form no longer needs it to grey anything. A freshly imported workflow seeds
one config, *Default*, from the template's defaults, so the job sheet has something to pick.

**Honest frictions:** (1) the 2026-09-02 ruling keys sampling by *output kind*; a template-keyed
shape is a third kind of key — consistent in spirit (a shape is a schema; a workflow is a schema)
but a ruling, not a quiet extension (★ §9.13). (2) `samplingShapeForCapability(text->image)`
returns `S.imageGen`; for a template-payload pair the host must resolve the shape from the bound
workflow instead — one more branch in the same function, not a second function.

**Rejected:** no sampling for Comfy at all, every variable a node setting on the pipeline config.
Simpler, but no named reusable presets, and members cannot reach Pipelines, so the only dials
they could touch are whatever the Fill form exposes.

**REVERSED 2026-10-12** (owner: *"Why do we have a bunch of 'workflow' sampling configs? I never
asked for this."*; lane E3). No sampling shape per workflow and no seeded *Default* configs: a
workflow's dials are its own **workflow variables** with defaults, edited in the workflow editor
(the variables panel C1 built), and a loadout bound to a Comfy pair may override them inline (the
values live on the loadout row, lane E2). Sampling is what it was before C1: a Comfy pair's step 3
offers the image configs like any image pair, and the knobs the workflow does not read are ignored
and reported by the drawing sheet. The render takes `workflowValues` = the variables' defaults
(`workflowDialDefaults`, read in `dispatchImage`'s prepare and the Draw-a-test path) with the
loadout's overrides merged over them. A boot one-shot (`removeWorkflowSamplingConfigs`) deletes the
configs C1 seeded (`seed_key` `workflow:*`) and any row left in a workflow shape. Kept: the
dials' schema (`workflowDialsSchema`, for the loadout's override form), `deriveComfySheet`, the
sheet sentence.

## 8. Not in phase 1 (named so nobody re-discovers them)

- Auto-illustration triggers (every N replies; model-emitted `<t2i>` tag). Same spec, new inlet.
- Interactive regex ("send me a picture of…"). The tool loop with a `generate-image` tool covers it
  better; a later `core:tool/draw@1`.
- fal / Replicate (per-model OpenAPI; a plugin's job).
- Video (`video` on the request stays, sheet `video:false` everywhere).
- LoRA management UI (profile JSON only).
- A per-session likeness override (clothes change mid-story) — the sprite-set override slot is the
  precedent; wait for demand.

---

## 9. Rulings wanted (★)

1. ★ **The word "likeness"** for `{image, prompt, negative}` on the card, stored in
   `extensions.serenepub.likeness`, exported with the card, ST's `sd_character_prompt` read at
   import. (Alternatives considered: *appearance* — collides with prose description; *art prompt* —
   R3 bare-noun risk; *reference* — taken by the port.)
2. ★ **One oracle, gated by the drawing sheet** (recommended: `requires` stays `[text->image]`; a
   wired `references` port is refused at bind time when the pair's sheet has no reference input)
   vs **two oracles** (`generate-image` requiring `text->image`, `draw-with-references` requiring
   `text+image->image`, static and visible in the jobs grid). One keeps "one way to draw" and lets
   a sprite spec degrade to seed-only on an SD pair with a notice; two makes the Models view's
   *Image edits* tile the thing that decides. Recommend one.
3. ★ **Purpose = spec, provider = slot, no new "image settings" object anywhere.** This is the
   load-bearing call; everything in §6 follows from it. The alternative (Agnai-style scoped image
   settings on user/character/session) is rejected: it is a third config system beside pipeline
   config and sampling.
4. ★ **Backdrop as session state** (`sessions.backdropMediaId` + Backdrop widget) vs "scene images
   are just messages, the Album widget shows the latest". Recommend state: a backdrop outlives the
   message it came from and a person can set one by hand.
5. ★ **Cut-out via BiRefNet-lite under `@huggingface/transformers`** (already a dep) — the model
   download (~170 MB?) is a *local model* row (`local_models`, modality `matting`?) or a silent
   cache? Recommend a `local_models` row so it shows in the Models view and can be deleted.
6. ★ **Lift the OPENAI no-image-module ban** (registry.ts:88-95) now that a module would exist, or
   add a separate `openai-images` connection type. Recommend lift: one connection, per-model
   modality gate already keeps chat models off the Images job.
7. ★ Build order: §4.3 sheet + §4.1 ports + §5 likeness first (no provider work), then Sprites
   (the use case nobody else has), then OpenAI-images + ComfyUI, then Portrait/Scene, then the
   remaining dialects. Or providers first?
8. ★ **Scene's review default**: off (matches Image, 10-11 ruling) — confirm.
9. ★ *(absorbed into 14)* **ComfyUI workflows are context templates on a `workflow` oracle slot** (§4.5, following canon
   §15), with checkpoints as connection models and starter workflows as seeded template rows — vs
   workflows as connection-model rows (one Comfy connection, each workflow a "model" with the JSON
   in `connection_models.extra_json`). Recommend templates: it is already ruled, plugins already
   ship `templates[]`, law T1 gives validation and the sheet for free, and a workflow is per
   purpose while a model row is per pair. The word *workflow* on the slot collides with the
   pipeline icon's name (§22) — tolerated, or rename the slot *graph*?
10. ★ **Specs declare needs, never a connection type** (§4.6): references wired = **preferred** by
   default (pre-run notice on the form, run proceeds) or `required` (refused) — changed 10-11 after
   walk §6.6 (plain-SDXL KoboldCpp must still draw sprites); workflow filled on a flat pair = not
   used + reported; sampling knobs = ignored + reported. Confirm the hard/soft line, in particular that an unused workflow is soft — which
   holds only because packing is the host's (§4.7).
11. ★ **Series packing is the host's** (§4.7): keyed template → batch → loop, decided from the sheet;
   surplus outputs kept unkeyed, shortfall reported with Redo; a multi-output graph that reads no
   `series` is warned, not refused. Confirm; and the chunk default `seriesMax: 8`.
12. ★ **Custom workflow import** (§4.8): fitting by graph walk + confirm form writes an ordinary
   template; a connection-level default workflow fills an unset slot; UI-format conversion and
   *Make this a series workflow* are later. Confirm the default-workflow profile key in particular
   (it is the one place a connection points at a template).
13. ~~★ **A Comfy workflow is its own sampling shape**~~ **REVERSED 2026-10-12** — see §7.1's note;
   a workflow's settings are its variables, a loadout may override them. Was (§7.1): shape id = workflow id,
   schema = the template's variables (standard ones reuse the SD field defs; promoted ones typed
   from their literal, enums from `/object_info`). Extends the 09-02 "sampling keyed by output
   kind" ruling with a template-keyed shape — both quoted here so the extension is explicit.
14. ★ **A workflow is its own entity** (§4.10, fourth revision 10-12, after the owner's point that a
   document only one dialect consumes is not a context template): `workflows` table with a
   `dialect` column, `workflow-ref` control on the oracle's `workflow` slot shown only for a
   template-payload pair, connection default workflow, checkpoint = the pair's model via
   `{{model}}`, plugins via manifest `workflows[]`, canon §15 ledger amendment. Confirm the bare
   word **workflow** (R3: qualified as *ComfyUI workflow* in prose; the §22 `Workflow` icon is a
   lucide id, not vocabulary) and the `dialect` column. Rejected and recorded: B, A-old, A, C.

## 11. Loadouts — the third model layer (owner: "I like it", 2026-10-12; word pending)

Owner's layers: **modality** (what a model is for; has a default) · **capabilities** (transforms;
jobs = defaults) · **model presets** (reply/prose, extraction, tool calling, …, each paired with a
sampling config, custom ones addable). Layers 1–2 exist (`connection_models.modality` + the
"active" default; `connection_defaults` keyed `(input, output)`). Layer 3 is the proposal:
SillyTavern's *connection profiles*, RisuAI's *separate model lanes*, Agnai's `summaryPresetId`.

**Word: `loadout`** 🚧 (R2; zero hits in src, SDK, canon; *preset* already has three meanings —
spec presets, connection presets, seeded sampling presets). ★ owner to confirm the word.

**What a loadout carries (ruled 10-12):** the **pair** (connection, model) · a **sampling config**
by reference (it owns no knobs — the 09-02 shape ruling stands) · a **workflow**, only when the
pair's sheet takes a template payload. Plus a name, the **purpose** it is bound to, and a
**default flag per transform** (what the job default becomes). **Not carried:** `prompts`,
`parameters`, `template`, `settings` (`enabled`/`review`), `scripts` — those say what the *step*
means; a loadout says what the *engine* is and how it is driven. Rule: anything that would change
if you swapped the model without touching the step's intent is loadout; anything that survives
the swap is node. Streaming stays on the node (turned off per step, not per model). Deliberately
later: a fallback pair, a context budget.

**On an oracle node (ruled 10-12): pick a loadout, or set individual overrides — and both.** One
new slot **`loadout`** (control `loadout-ref`) on every model-calling oracle; the existing
`connection`, `sampling` (and the image oracle's `workflow`) slots stay as **overrides**.
Resolution per value (revised §12/§13, 10-12): the node's explicit slot → its loadout, following
merges to the root → if unfilled, the transform's default loadout. "The reply loadout, but temperature 0.3 here" is
one override, not a second loadout.
- **No contract churn**: `loadout` is additive; no oracle changes shape. Only `connection_defaults`
  rows become default-flagged loadout rows (generated migration). The earlier "before SDK 1.0"
  warning is withdrawn.
- **UI**: the settings group gains a loadout picker at the top; each slot below says where its
  value came from in the Sampling view's words — *set here* · *from the Extraction loadout* ·
  *from the default* — with the override one disclosure away. Never a mode switch.
- **Purposes**: `expose.purpose` stays a free display label (09-30); **no binding** (owner, §12).
- **Management**: Models view → **Loadouts** section; the job sheet becomes *edit this transform's
  default loadout*; **Use** on a model row sets that default loadout's pair; purpose bindings sit
  beside the loadouts. Sessions never pick a loadout (09-30: a session never picks a connection).

**Effect on this design**: the Images default is a loadout that carries a workflow, so the
**connection default workflow (§4.8 step 6, §4.10) is deleted**. The `workflow` slot on the image
oracle stays as an override, shown when the *resolved* pair takes a template payload. Walk §6.6:
step 4 is *make the Sprites loadout* (Comfy pair + sprite workflow + "Sprites, fast"); the Fill
form names the loadout. Ruling 14 shrinks to "a workflow is its own entity, referenced from a
loadout or an override slot".

★ Still wanted: the word; whether the Models view's *Images* scope lists loadouts or models
(recommend models, with the loadout's pair marked).

## 12. The gap: a modder's intended loadout vs what a person binds (ruled in part 2026-10-12)

Owner: **3 must be finished either way · no to 2 · 4 and 5 are great · later, a model may help
generate configs and loadouts.**

- **No purpose vocabulary.** `expose.purpose` stays a free display label heading the settings
  group (09-30); **nothing binds to it**. Loadouts are still shared — pick the Extraction loadout
  on each extraction node once; changing its pair changes them all. Resolution (§11) drops to
  three tiers: the node's own slot → its loadout → the transform's default loadout.
- **Needs** (3, finish regardless): derived from wiring + `requires` — transform, wired
  `references`, structured answer, tools port, attachments port. Refuse or grey. Zero modder work.
- **Prefers** (4): declared by the modder on the node placement or its definition — the soft twin
  of `requires`: `{ structured: 'schema', tools: 'native', latency: 'fast', cost: 'cheap',
  sampling: '<seeded preset id>', references: true, transparent: true, contextWindow: '>=16k' }`.
  Grades, never gates. Word: not *recommends* (*recommended list* = the ONNX catalogues, R1).
- **Prose** (5): a *Best with* sentence in the node description and the catalogue.

**Where the suggestion shows** (the "way to suggest what's beneficial/needed"):
1. **Pipelines**, the node's settings group: a *Needs / Best with* line under the loadout picker.
2. **The loadout picker**: each loadout graded **fits** · **partly** (*no native JSON*) · **won't**
   (*no vision*), reason on the row; hard needs still refuse. (★ 09-30 rejected a *told-apart
   verdict*; this gates nothing — owner to confirm the grade on rows.)
3. **Make a loadout from this**: pair = best-graded model across connections (grades + facts),
   sampling = the preferred seeded preset, workflow = a starter when the node is an image oracle
   with references wired and the pair is Comfy. Rename and keep.
4. **Loadouts page**, derived: *Used by* per loadout, and **steps with no fitting loadout** — the
   one aggregate a vocabulary would have given.
5. **Receipt**: a run on a *partly* loadout says so beside `applied`/`ignored`.

**Later — the advisor.** A core tool (inside R53: core, not a plugin) reads the **fleet**: every
connection, model facts, capability grades, sampling schemas, and every node's needs + prefers.
A Guide session asks it what is wrong; it proposes loadouts and sampling configs as a form the
administrator accepts through the review gate. The fleet is one read shape shared with the picker's
grading. Not phase 1; its own unit when it comes.

**Suggestions (2026-10-12, not ruled; recommend 1, 2, 4 now, 3 carrying 5 in the same phase):**
1. **Derive more, declare less.** Structured answer port → schema door preferred; tools port →
   native tools; attachments port → vision; wired `references` → edit-class image model. `prefers`
   shrinks to `{ sampling: '<seeded preset id>', tier: 'fast' | 'cheap' | 'best' }`.
2. **Show consequences, not a grade.** Picker rows show what the receipt *would* say: *JSON by
   instruction (no schema door)* · *references dropped* · *steps ignored*. Describes, never
   judges — sidesteps the 09-30 verdict question.
3. **Ship loadouts, not criteria.** A spec or plugin ships a loadout with the pair left empty
   (*Extraction · sampling Extraction · any text model with a schema door*); the Loadouts page
   lists them as suggested; *Make it* fills the pair. R53 holds: the pair is the one blank field.
4. **Pair change resets a mismatched sampling.** A Comfy loadout's sampling has the workflow's
   shape; switching the pair to KoboldCpp swaps it to the transform's seeded default and says so,
   instead of leaving an id the bind refuses later.
5. **Smoke test on the loadout.** *Make a loadout from this* on an image node ends with one picture
   drawn with the card's likeness, shown beside the loadout (Test Generation's path).
6. **Genre defaults need no mechanism**: a genre's shipped Default config sets the loadout slot on
   its reply spec, as spec presets already do per genre.

## 13. Loadout declarations, merging, and the core set (ruled 2026-10-12 on §12's suggestions)

Owner: 1 yes (derive more) · 2 yes (consequences, not a grade) · 3 yes, with: *a loadout can be
owned by a plugin or defined in a spec, carries a slug scoped to the pub or the plugin/spec
namespace, carries an arbitrary description of what is recommended; loadouts are mergeable under a
single parent so a plugin's `extract` can be a merged child of the pub's `extraction` and resolve
to it at run time; a spec's default loadout may name an external loadout, including the core
catalogue's, discoverable through the SDK* · 4 ok · 5 yes, and create the loadouts the core
catalogue benefits from.

**Identity.** Id grammar as everything else: `core:loadout/extraction@1` ·
`acme.rp:loadout/extract@1` · `pub:loadout/<slug>` (a person's; slug typed by them, unique per
pub). A **shipped loadout** is a declaration: `{ id, name, description (free prose: what is
recommended and why), sampling: '<seeded preset id>', tier?: 'fast' | 'cheap' | 'best',
workflow?: '<starter workflow id>' }` — **never a pair** (R53: the pair is the one blank). At boot
it becomes a row (idempotent seed) with an empty pair, state **unfilled**. A spec's Default config
names one on the oracle's `loadout` slot: `slot.loadout('core:loadout/extraction@1')`, typed
against the registered declarations the way template ids resolve; `@serene-pub/core-catalog`
exports `CORE_LOADOUTS`; a plugin ships its own under manifest `loadouts[]` and may name core's.

**Merging = a run-time redirect, the pub's act.** A loadout row may carry `mergedInto: <id>`
(UI: *Merge into…* on the child; *Unmerge*). Resolution follows the chain to its root (any depth;
a cycle is refused when it would be made). While merged, the child's pair/sampling/workflow are
ignored and its description stays readable; the receipt says *extract → Extraction (merged)*.
No config row changes; a plugin never merges anything (installing a plugin never changes which
model runs). Words: **merged loadout** · **parent loadout** (grep clean for *loadout*; *merge* is
an ordinary verb here, as in `koboldCppManagedFold`).

**Unfilled falls through.** Resolution (§11) becomes: node slot → its loadout (following merges)
→ **if that loadout is unfilled, the transform's default loadout**. Fresh install: the core set
is unfilled except the four flagged transform defaults (`reply`, `images`, `embeddings`,
`entities`), which the wizard fills. The Loadouts page says *falls back to Reply — fill to
specialise*. Everything runs on one model; specialists are opt-in. Beginner-first.

**Core set (★ prune):**

| Loadout | Title | Transform | Default? | Used by (core) | Ships with |
|---|---|---|---|---|---|
| `core:loadout/reply@1` | **Reply** | text→text | **yes** | the 7 reply specs, form answers | sampling *Chat* |
| `core:loadout/tool-calling@1` | **Tool calling** | text→text | | tool loop | sampling *Chat*; prefers native tools (derived) |
| `core:loadout/extraction@1` | **Extraction** | text→text | | summaries, state keeper | sampling *Extraction* (low temp); schema door (derived) |
| `core:loadout/scene-prompt@1` | **Scene prompt** | text→text | | Scene's quiet call | sampling *Extraction* |
| `core:loadout/images@1` | **Images** | text→image | **yes** | Image action | sampling *SD 1.5* (family presets) |
| `core:loadout/portrait@1` | **Portrait** | text→image | | Portrait | prefers references (derived); tier best |
| `core:loadout/sprites@1` | **Sprites** | text→image | | Sprite set fill | prefers references + transparent (derived); starter workflow *SDXL + IP-Adapter sprite* when the pair is Comfy |
| `core:loadout/scene@1` | **Scene** | text→image | | Scene's image half | tier fast |
| `core:loadout/tts@1` | **Narration** | text→audio | **yes** | narration | |
| `core:loadout/embeddings@1` | **Embeddings** | text→embedding | **yes** | retrieval, sprite picker | (no sampling) |
| `core:loadout/entities@1` | **Entities** | text→entities | **yes** | named-entity recognition (lorebook indexing) | (no sampling) |

**How a loadout ships with a sampling config (asked 10-12).** By **seed key**, never by id: the
declaration names `sampling: 'sampling-extraction'`; at boot the seed ensures that immutable row
exists (matched on `seedKey`, `db/defaults.ts:29-46`) and the loadout row points at whatever id it
got on this install. A person's edits land in a copy; the loadout keeps the original until they
pick the copy. Gaps: (a) core needs new seeded text presets — at least *Extraction* (low temp);
the image family presets exist; (b) plugins cannot ship sampling rows today, so a plugin loadout
names a core seed key — a manifest `sampling[]` contribution is a small I12 item if a plugin needs
its own. For a Comfy loadout the shape is the workflow's (§7.1), so it names a starter workflow and
that workflow's seeded *Default* config is its sampling — the same rule, one hop longer.

**Picker rows** (2): consequences in the receipt's words — *JSON by instruction (no schema door)* ·
*references dropped* · *steps ignored* — never a grade. **`prefers`** (1) is `{ sampling, tier }`;
everything else is derived from wiring. **Make it** (5) on an image loadout ends with one picture
drawn with a card's likeness beside the loadout.

★ Calls made here the owner may reverse: merge depth unlimited (cycles refused); person's slug
free, unique per pub; plugin loadouts arrive unfilled and unmerged.

## 14. Loadouts in the UI (owner 2026-10-12: its own rail view)

Owner: *users set connections in the sidebar, manage models in the models sidebar, bring it all
together in the loadouts sidebar.* Yes — three views, one story in order: **Connections** (where
models run) → **Models** (what models exist) → **Loadouts** (what each kind of work runs on).
Each answers one question; members see none of them; the wizard fills Reply and Images so most
people never open Loadouts.

**Loadouts** (rail key `loadouts`, URL `/loadouts`, admin-only, icon ★ `Backpack`) owns: the
**status strip** (*Sessions can reply* is a loadout question), the **loadouts grid**, the
**loadout sheet**, the **defaults ledger**, merging, *New loadout*. The first-run gold dot points
here. **Models** shrinks to inventory: the flat list with scopes, *Get a model*, and **Use** →
a small *Use in…* menu of that transform's loadouts, default first (a cross-view action that names
its target). **Admin → Models → Defaults** stays the admin's mirror of Loadouts (admin is a view).

1. **Loadouts view.** Status strip at the top (*Sessions can reply* = Reply filled). The
   **loadouts grid**: one tile per loadout, grouped by output kind as Admin Defaults
   groups (text · images · audio · embeddings · entities); tile = title · pair or *Unfilled —
   falls back to Reply* · sampling name · chip (*merged into …* / plugin owner) · one consequence
   line. Default-flagged first with the gold mark; then **New loadout**. The flat models list
   stays; **Use** on a model row sets the current scope's default loadout, a small menu beside it
   offers that transform's other loadouts.
2. **Loadout sheet (was job sheet).** Header: title · slug · description (read-only prose on a
   shipped one) · *Default for <transform>* · *Merge into… / Unmerge* · *Used by N steps* (lists
   them). **1 Which connection** · **2 Which model** — grows a **Workflow** field with the
   checkpoint beneath when the pair's sheet takes a template payload · **3 How it samples** —
   configs of the matching shape; a pair change swaps a mismatched config and says so (§12 sugg. 4)
   · **Make it** (fill from the fleet; image loadouts end with one picture from a chosen card's
   likeness, §12 sugg. 5).
3. **Admin → Models → Defaults**: rows become loadouts (more rows, same table); status words stay
   — *Set* · *Unfilled → falls back to X* · *Needed* (a run failed without it in 7 days) · *Off*.
4. **Pipelines**, each model call's settings group: top row **Loadout** picker showing title +
   resolved chain (*Extraction → Reply (unfilled)*); beneath, the slots with provenance in the
   Sampling view's words (*set here* · *from the Extraction loadout*), override one disclosure
   away, *Use loadout's* to clear; a *Needs / Best with* line under the picker; picker rows carry
   consequence lines.
5. **Action forms** (Image · Scene · Portrait · Fill sprites): one line — *Sprites · ComfyUI ·
   sdxl_base · 12 pictures · 2 calls* — **Change** opens the sheet for an admin, plain text for a
   member; the unfilled failure keeps today's copy, naming the loadout.
6. **Receipts**: a loadout line with the whole chain.
7. **Unchanged**: session settings pick sampling only (09-30); wizard's chat step fills Reply,
   optional images step fills Images, one sentence each; Sampling view adds *Used by loadouts:
   Reply, Tool calling*; Comfy connection's Workflows tab as ruled (§4.10, §4.12).

Vocabulary (ledger when built): **jobs grid → loadouts grid**, **job sheet → loadout sheet**,
**Loadouts** (the rail view) beside **Models** and **Connections** (§10 rows); *job* stays the
word for the transform itself (scopes).

## 15. The Pipelines rail view (asked 2026-10-12; RULED: prompts stay behind Admin)

Owner: *for now, keep prompts behind the admin; we don't want non-admins editing them. Users can
break their characters, but a non-admin shouldn't be able to break prompts.*

So: **the Pipelines rail view goes; nothing replaces it on the rail.** Pipelines, with its
settings groups (loadout line · prompt rows · params · review) and the deep half (graph,
bindings, scripts, runs, config layers), lives under **Admin → Pipelines**, which exists. Members
keep picking prompt rows in session settings; prompt writes stay admin-only (10-09). The 10-09
open item (a member who wants to write prompts has no door) stays open by ruling, not by
omission: breakage of shared prompts is the admin's to risk.

Rail for an admin after this: Connections · Models · Loadouts · Sampling (+ the everyone views);
Pipelines reached through Admin. The *Prompts* rail idea is recorded and not taken.

**Out-of-the-box check (asked 10-12). RULED: non-admins never see or touch connections, models,
sampling or loadouts, and have no reason to.** The admin provides a working environment through
**session presets** that members select; a member's rail is Sessions · Characters · Lorebooks ·
Tags · Settings · Help and that is the whole experience. My two "gaps" (member-owned sampling
configs; per-session model choice) are **rejected** and must not be re-raised: the first would put
a tuning surface in front of people who should never see one; the second was retired at 0130 and
reaffirmed 09-30. A one-person install's admin has everything on the rail once Loadouts exists.

## 10. Units (after rulings; none started)

| Unit | What | Touches |
|---|---|---|
| I1 | Drawing sheet type + per-adapter declarations; sampling form greys; bind guard on `references` | `shared/imageGen/types.ts`, `BaseImageAdapter.ts`, A1111/KCPP adapters, sampling form, `bindGuard` |
| I2 | Oracle ports `references`/`init`/`mask`/`series`, params `orientation`/`cutOut`; request fields; host packing (keyed template / batch / loop, §4.7) with keyed media out, surplus and shortfall rules, cost guard; `buildImageRequest` aspect/enum fit | SDK contracts `oracles.ts`, `dispatchImage.ts`, `buildRequest.ts`, spec hash pins |
| I3 | Likeness: card extensions field, editor tab, export/import (+ST read), `{{likeness}}` macros, `core:var/likenesses@1` | characters sockets/parser, card editor, `promptFields.ts`, `variableLayouts.ts`, NOMENCLATURE §25 |
| I4 | `core:task/cut-out@1` (BiRefNet-lite) + local model row | new task, `local_models`, Models view |
| I5 | Sprites pipeline + `core:outlet/attach-sprite@1` + Sprites tab contact sheet + label-phrase prompt row | SDK core-catalog, outlets, characters UI |
| I6 | OpenAI-images module (+ KCPP `/v1/images` not needed — A1111 path covers it); lift registry ban; manifest `text+image->image`; Hosted sampling preset | `imageAdapters/OpenAIImagesAdapter.ts`, registry, manifest, defaults |
| I7 | ComfyUI type + adapter; workflow-as-sampling-shape (§7.1: shape from the row's variables, seeded *Default* config, job sheet step 3, `samplingShapeForCapability` branch); `workflows` table (generated migration) + `workflow-ref` control + slot shown-when + connection default workflow + `{{model}}` promotion by default + manifest `workflows[]` (§4.10); Workflows tab; oracle `workflow` template slot (`payload: "template"` sheets only); scope + fit for workflow templates; sheet derived from template reads; `/upload/image` for references; `/object_info` missing-node check; six seeded starter workflows; **import wizard** (`fitComfyWorkflow` graph walk + confirm form + promote-to-variable, §4.8); connection `defaultWorkflowTemplateId`; retire `chariot.comfy:render-image@1`; output keying by node-id prefix + sanitised keys + `role: output` mark (§4.11); series merge (render per item, prefix ids, merge, dedupe identical nodes, `seriesMax` on the profile); marker-node recognition; variables by name | new type, adapter, SDK `oracles.ts`, template-check, templates seed, connection form |
| I8 | Portrait pipeline + `core:outlet/offer-media@1` + Characters-view action | SDK, characters UI |
| I9 | Scene pipeline + `sessions.backdropMediaId` (migration, generated) + `core:outlet/set-backdrop@1` + Backdrop widget | SDK, schema, widgets registry, session-layout docs |
| I10 | Gemini, Horde, NovelAI (+`expressImage`), BFL modules | adapters, types, presets |
| I12 | Loadouts (§11–§13): `loadouts` table (generated migration; `connection_defaults` → default-flagged rows), `loadout-ref` control + additive `loadout` slot on every model-calling oracle, resolution with merges + unfilled fall-through, `CORE_LOADOUTS` + SDK `slot.loadout()` + manifest `loadouts[]`, Models view Loadouts section (Used by, no-fitting-loadout list, Merge into/Unmerge, Make it + smoke test), picker consequence lines, `prefers {sampling, tier}`, receipts naming the resolved chain; new seeded text presets (*Extraction*), optional manifest `sampling[]`; Default configs of core specs name their loadouts | schema, SDK contracts/builder/core-catalog, Models view, host resolution, receipts |
| I11 | Docs: `docs/images.md` (new, beginner-first: *pick a provider, give a character a likeness, press Scene*), connections.md hosted section, characters.md Likeness + Sprites fill, sessions.md Scene/Backdrop; NOMENCLATURE §25 ledger | docs |

Verification once at the end (one grouped run): `sdk:test` (spec hash pins move for I2/I5/I8/I9),
app suite, svelte-check, `docs:build`, a real-data upgrade check (likeness on an imported ST card).

## 16. Build ledger (keep current)

| Lane | Unit(s) | Status | Notes |
|---|---|---|---|
| A1 | I1 + I2 — drawing sheet, oracle ports/series, host packing | **DONE 10-12** | `DrawingSheet` (no alias), `S.imageSeries`, `imageGen/packing.ts` + `sheetGuard.ts`, `previewImageRun` for forms, `images:drawingSheet` socket, sampling form greys; 356/357 green (red = A6's pin). NOTE: `count` param not added (brief omission; batch via sampling); FOUND: `host.ts` reads `p.streaming` top-level while executor puts params under `p.params` (pre-existing) |
| A2 | I3 — likeness | **DONE 10-12** | `server/characters/likeness.ts`, cardIO export/import (+ST read), Likeness tab (`ScanFace`), `{{likeness}}`/`{{likenessNegative}}`, `core:var/likenesses@1`; 443+24+72 tests green; 6 context pins moved. LEFT OUT: *Describe from image* (needs a vision caption spec → C-lane), persona card io, §22 icon row |
| A3 | I4 — cut-out task | **DONE 10-12** | `runtime/cutOut.ts`, `localModels/matting.ts`, 7 tests green; meta key `transparent: 'native'` is what `auto` reads — A1 must write it; GAPS: Models view does not list the matting row (→ B1), no download cancel, real weights never run; FOUND: KCPP list scan deletes ONNX `local_models` rows (`sockets/koboldcpp.ts:350-358`) → lane A7 |
| A7 | fix: managed KCPP scan deletes non-GGUF `local_models` rows | **DONE 10-12** | sweep now only deletes `gguf`/`safetensors` rows whose filename the scan could list; `koboldcpp.scan.int.test.ts`; 75 tests green |
| A5 | §15 — Pipelines rail view removed | **DONE 10-12** | 41 tests green; `PipelinesSidebar.svelte` deleted; docs + §23/§25 rows; leftovers: `PipelineConfigOptions.svelte` link wording, STYLE-GUIDE:1480, docs:build pending |
| A6 | I9 state half — `sessions.backdropMediaId`, Backdrop widget, `core:outlet/set-backdrop@1` | **DONE 10-12** | migration 0102; event `backdrop-set`; widget `MountainSnow`; `sessions:setBackdrop`; 7 int tests. FOLLOW-UPS: column is a plain int (brief error — `avatarMediaId` IS an FK `SET NULL`; make it one, C5); `SessionDossierV1.backdrop` boolean clashes (rename → `appBackground`, C5); chooser offers cast galleries only (session-generated images not pickable yet) |
| B3 | I5 — sprites pipeline + `attach-sprite` + Sprites tab contact sheet | **DONE 10-12** | `core:spec/sprite-set-fill`, `core:inlet/card-action@1` (new, sessionless runner `runtime/cardAction.ts`), `build-sprite-series`, `attach-sprite`, oracle `seed: as-set\|per-run` param, prompt rows *Sprite label phrases* + *Sprite, tags*, Fill dialog + `SpriteContactSheet`; 151 tests. FIXED A1 bug: `bindings.ts` never forwarded references/series/mask/params. LEFT: fill preview copies spec config, not loadouts (B1 to reconcile); review-on would park with no session; copy says *Image generation* not *Images* (C5) |
| C2 | I8 — Portrait pipeline + `offer-media` outlet + Characters view action | **DONE 10-12** | `core:spec/character-portrait` (review ON by default — the global `PipelineReviewModal` already catches sessionless parks, B3's worry void), `core:task/build-proofs@1` (*proofs*, not *candidates* — §7 collision), `core:outlet/offer-media@1`, `media-offered` event, `characters:previewPortrait/generatePortrait/portrait/setLikenessImage`, `GeneratePortraitDialog`, gallery *Use as likeness image*; prompt rows use `{{prompt}}` so a review edit changes the picture; 9+5 int/dom tests. C1's `build-proofs` boot failure was this lane mid-flight — recheck at verification. Wizard skipped (no avatar step) |
| A4 | I7a — `workflows` table + Comfy adapter + fitting walk + series merge (server) | **DONE 10-12** | migration 0104 (`document` is TEXT — holes make it non-JSON until render; `description` col added); `imageGen/comfy/{graph,fit,render,merge,objectInfo,serverCheck,workflows,starters}.ts`; `ComfyAdapter.ts`; `workflows:*` sockets; oracle `workflow` slot + `slot.workflow()`; 311+3 tests. LEFT for C1: Draw a test + `images:drawingSheet` with a workflow, connection view/status line reading `modelsSync.problem`, §7.1 workflow sampling shape; B1 must supply `workflowId` |
| C1 | I7b — Comfy Workflows tab, import wizard UI, Draw a test with workflow, §7.1 workflow sampling shape | **DONE 10-12** | `connections/comfy/*` (tab, add dialog, fitting form, editor, facts, draw test), `shared/imageGen/{workflowShape,sheetSentence}.ts`, `comfy/workflowSampling.ts` (Default per workflow, seed `workflow:<id>:default`), `samplingShapeForCapability(…, pair)`, `WorkflowRefControl` self-hiding, `WorkflowPicker.svelte` UNMOUNTED (loadout sheet step 3 hook → C5); `choices.ts` still filters sampling-ref to `S.imageGen` (C5). FOUND: `sessionSamplingMigration.int.test` fails at boot — core binds `core:task/build-proofs@1` which no type declares (pre-existing? check at verification). Not clicked through in a browser |
| B1 | I12 — loadouts (schema, SDK slot, resolution, Loadouts view, core set) | **DONE 10-12** | migrations 0103 (`loadouts`, + `transform` col) and 0105 (`workflow_id` FK); one-shot `loadouts/fromConnectionDefaults.ts` empties `connection_defaults`; `sdk/src/loadouts.ts`, `slot.loadout()`, `prefers`, manifest `loadouts[]`, `CORE_LOADOUTS`; `world.ts applyLoadoutLayer`; receipts carry the chain; Loadouts view/sheet/grid/ledger, Models = inventory + Use in… + matting row, Admin Defaults, Pipelines group provenance. 30 pins moved. OPEN: `Backpack` icon collides with Inventory widget (pick another, C5); plugin loadouts seed at boot only; matting download not in the tray; `loadouts:update` error has no toast; a `vite preview` on the REAL data dir was seen running during the lane (not ours) — next boot runs the one-shot on real `connection_defaults` |
| B2 | I6 — OpenAI-images module + hosted preset | **DONE 10-12** | `OpenAIImagesAdapter.ts` (19 tests), sheets per model/preset (gpt-image, DALL·E, xAI, Together), edits route, `noRetry` refusals, ban lifted, `sampling-image-hosted`, `ModelPricing.perImage`; 532 tests green in its scope. WATCH: `dispatchImage.int.test` 40/49 red with *No model is set* + a PGlite missing-table in `defaults.imagePresets.int` — likely B1's in-flight default resolution/schema; re-check at grouped verification. LEFT: xAI/Together edits, xAI resolution tier, price not shown on screen |
| B3 | I5 (stale queue row) | superseded — DONE above | |
| C1 | I7b (stale queue row) | superseded — DONE above | |
| C2 | I8 (stale queue row) | superseded — DONE above | |
| C3 | I9 — Scene spec (text half + image half + outlets) | **DONE 10-12** | `core:spec/chat-illustrate-scene` (Chat only; icon `Mountain`), `clean-image-prompt`, `picture-placement` (junctions branch on ports), `core:query/likeness-images@1`, prompt rows, Backdrop widget *Illustrate*; FIXED `{{likenesses}}` empty in prompt rows. LEFT: Adventure contribution (needs a second spec); `paramsSlotWiring.test` red because no core spec WIRES the `loadout` slot (B1's slot is config-named) → C5 |
| C5a | code leftovers sweep | **DONE 10-12** | all 12 items: backdrop FK (0106, with a stale-id null UPDATE), `appBackground` rename, Loadouts icon `Briefcase`, `paramsSlotWiring` exempts `loadout` + enforces `workflow`, `serverCheck` via registry (`fetchObjectInfo`), WorkflowPicker mounted in the loadout sheet + `choices.ts` workflow shapes + previews pass `workflowId`, OpenAIForm *Image settings*, matting in the Downloads tray (`pushToConnectedAdmins`), loadouts error toasts verified central + guard test, SDK guide vocabulary, copy (*Images*, *Admin › Pipelines*), `set-backdrop` owner-or-admin refusal on runs; 697 targeted tests |
| C5b | I11 — docs + canon sweep, `docs/images.md` | **DONE 10-12** | new `docs/images.md` (GUIDE_ORDER after `session-layout`); coherence pass on connections/characters/sessions/session-layout/pipelines/getting-around/system-settings/coming-from-sillytavern/session-actions/connect-a-model; STYLE-GUIDE *Pipelines view* + *jobs grid*; NOMENCLATURE group rows for ~30 §25 terms, cut-out rows merged, Missing-on-server line split, §10 jobs grid/job sheet struck, `ScanFace` §22 row, backdrop FK + `appBackground` rows; `npm run docs:build` green. As-built section added at the top |
| C4 | I10 — Gemini, Horde, NovelAI, BFL | **DONE 10-12** | `GeminiImageAdapter.ts` (wraps the OPENAI image module by preset `google-gemini`), `HordeAdapter.ts`, `NovelAIImageAdapter.ts` (+`expressImage` behind sheet `expressions`), `BflAdapter.ts`, `hostedImageHelpers.ts`; types HORDE/NOVELAI/BFL; 142 adapter tests. LEFT: OPENAI-type `OpenAIForm` does not render the image profile (Gemini `imageSize`/`safety`, B2's `quality` unreachable in UI → C5); no Gemini prices; `importBoundary` test red on A4's `serverCheck.ts` importing ComfyAdapter directly (C5) |
| C5 | I11 | split into C5a (code) + C5b (docs) | |
| C5c | orchestrator fixes 10-12 | **DONE** | Portrait + Sprite set fill Default presets name `core:loadout/portrait@1` / `sprites@1`; Scene's two calls carry `purpose` (groups test); rail order Connections · Models · Loadouts · Sampling (`SYSTEM_ORDER`, test, docs); `capabilityTarget.ts:627` sentence; 3 spec pins + SDK canonical digest moved |
| V | grouped verification | **DONE 10-12** | tsc 0 · svelte-check 0 errors / 9 warnings · docs:build 113 pages · sdk:test 2973/2973 · app suite **17,069 pass / 0 fail / 11 skipped** (second run, after 11 cross-lane conformance fixes) · fresh scratch instance boots clean through migration **0107** · browser: Loadouts view (grid, strip, ledger, Briefcase), rail order Connections·Models·Loadouts·Sampling, character editor **Likeness** tab, New-connection Image Generation filter lists Horde/BFL/Gemini/NovelAI/OpenAI/Together/xAI/ComfyUI/A1111. NOT clicked: Sprites Fill dialog + contact sheet, Portrait dialog, Workflows tab, Scene action (dom/int-tested only) — a concurrent session's edits to shared src kept reloading the page. ⚠ **0107 (`character_shares`, `conversation_attachments`, `messaging_enabled`) is another session's work in this tree, not this plan's** |
| D1 | follow-up: Describe from image (`core:spec/describe-likeness`), persona card likeness io, SpritesTab `$state` warning | **DONE 10-12** | new `core:oracle/describe-image@1` (generate-text requires text→text so could not serve), `describeImage.ts` host via `dispatchGeneration` on `text+image->text`, `characters:describeLikeness` (+probe), button only when a vision pair exists; persona cards carry likeness; `$state` fixed (pre-existing warning). Step key must be `generate` (world.ts projects the job default only onto that key — a trap worth a canon note) |
| D2 | follow-up: NovelAI *Re-express from neutral*, matting download cancel, xAI resolution tier, per-image price on tiles/forms | **DONE 10-12** | `sprites/reexpress.ts` + `characters:expressSprite` (label→NovelAI expression map; `sprites-attached` notified to plugin listeners only — not a pipeline event), `cancelMattingDownload` + `localModels:cancelMatting` + tray Cancel, xAI `resolution` 1k/2k, `shared/connections/imagePrice.ts` + tile line. LEFT: a re-expressed sprite keeps NovelAI's background (no cut-out) |
| D3 | follow-up: Scene for Adventure (shared builder), backdrop chooser session images, plugin loadouts on enable, `p.streaming` read, docs order warning, *picture pipeline* canon row | **DONE 10-12** | `shared/illustrateScene.ts` builder + `core:spec/adventure-illustrate-scene` (narrator builder, deliberate); `session-images` request + *From this session*; `plugins:setEnabled` seeds loadouts, `pluginOff` chip; `p.streaming` NOT a bug but **FOUND+FIXED: the image binding never forwarded the `workflow` slot** (`runtime/bindings.ts`); docs order; §4 *picture pipeline* |
| V2 | verification after D1–D3 | **DONE 10-12** | tsc 0 · svelte-check 0 errors / 7 warnings · sdk:test 2973/2973 (after linking *messages* in `guides/your-first-plugin.md`) · app suite 17,186 pass / 8 fail: **3 ours, fixed** (`stopsWiring` exempts `sprites/reexpress.ts`; `allPipelines.int` lists `core:oracle/describe-image`; `retake.int` + `sanctumSteers.int` were load timeouts — pass alone) · **5 are the other session's conversations/shares feature** (`tableRegistry` `lorebook_shares`, `commentHistory` ratchet on `conversations/*` + `shares`, `wiring` §4 `conversations:*:error`/`characters:share:error`, `cast.interestGate` `shares.ts innerJoin`) — not touched |
| E0 | Loadouts icon `Briefcase` → `Combine` (owner disliked it) | **DONE 10-12** | rail, Admin Defaults, Use-in menu, §22 row |
| E1 | vocabulary sweep: no nicknames for modality defaults (job default · active · chat model · default pair → the Reply/Images/… loadout) | **DONE 10-12** | `shared/loadouts/defaultLoadoutName.ts`; Use in Reply/Images/…; *Fill the Reply loadout*; Admin › Models › **Loadouts** (URL kept); §10 *job* → *default loadout*, *active*/*Defaults mode* retired, §23 rows; 2,582 tests; docs rebuilt. Leftovers in E2's files (sheet copy still says *job*) → E2 |
| E2 | loadout editor redesign (three cards, live summary, inline workflow dials stored in `loadouts.workflow_values`) | **DONE 10-12** | `LoadoutSheet.svelte` rewritten + `sheet/{ModelCard,SamplingCard,WorkflowCard,ConfirmDialog}.svelte`; draft-until-Save; New loadout = same editor; migration **0111** (0108–0110 were other sessions'); dials ride the workflow slot as `{id, values}`; 36+4 tests; walked on 5198, screenshots judged decent. NOT BUILT: *Make it*'s likeness test picture (needs a server unit). Pill still reads *Default for Image generation* (transform label) — owner may prefer *Default for Images* |
| E3 | **ruling 13 REVERSED** — per-workflow sampling configs removed; a workflow's dials = its variables' defaults, overridable on the loadout; boot cleanup of `workflow:*` seed rows | **DONE 10-12** | `workflowSampling.ts` deleted; `boot/workflowSamplingCleanup.ts` (also removes a person's copies of the dead shape — beyond brief, nothing could use them); `workflowDialDefaults` base in dispatch + Draw a test; Sampling view grouping gone; a Comfy pair is offered the image configs; 308 tests. Transitional leftovers for E2: `workflowShapeId`/`onShape`, `workflowSamplingOptions` type |
| V3 | verification after E0–E3 | **DONE 10-12** | tsc 0 · svelte-check 0 errors / 7 warnings · sdk:test 2976/2976 · app suite 17,301 pass / 5 fail: 1 ours (toast copy in `connections.dom.test` — updated to the loadout wording), **4 the other session's conversations/shares** (same four as V2) · editor screenshot sent to the owner |

