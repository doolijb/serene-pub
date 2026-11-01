# PLAN — Local hardware: see it, allot it, schedule it — 2026-10-28

**Status: PROPOSED 2026-10-28 (owner asked for it the same day while ruling on managed
audio.cpp). Not GO.** Companion to PLAN-audiocpp-managed-2026-10-28 (★A9 points here).

## 0. Owner's words (2026-10-28)

> add some controls for local server management, where hardware allocation can be managed by
> service (where possible). In admin for "this" server, we should be able to see, and optionally
> choose what components services run on (where possible) … If we can automatically detect
> available hardware, memory etc, that would be awesome, with a live graph etc. List managed
> services, detect unmanaged connections that are local, choose what locally can run
> sequentially, or only one at a time with each other.

## 1. What it is

One admin section, **Hardware** (working title; ★H1), about *this* machine — the one Serene Pub
runs on:

1. **What is here.** Processor (cores, model), memory (total, free), every GPU (vendor, name,
   VRAM total/used, driver), detected at boot and on demand, with a **live graph** of CPU, RAM
   and per-GPU VRAM/utilisation while the page is open.
2. **Who uses it.** Every **managed service** (KoboldCPP run by Serene Pub, audio.cpp run by
   Serene Pub, and later any other) with its process state, what it holds resident, and — where
   the service allows — **which device(s) it runs on** and how much (backend, device index,
   GPU layers / tensor split, threads). Plus every **unmanaged local connection** (an Ollama,
   KoboldCPP, llama.cpp, LM Studio or audio.cpp at 127.0.0.1 / the LAN host, found by local
   discovery or configured), shown as *also on this machine*, read-only, with what we can read
   from it (Ollama `/api/ps` size_vram; KoboldCPP `/api/extra/perf`; audio.cpp `/v1/models` device).
3. **Who may run together.** A **hardware policy** per pair of local runners: *together*
   (default), *one at a time* (starting or loading in one first unloads/stops the other), or
   *in turn* (requests queue behind each other; nothing is unloaded). Enforced for managed
   services; for unmanaged connections only *in turn* is enforceable (we hold our own requests),
   and the section says so.

## 2. What each service lets us do (facts to verify in lane V; ✓ = known today)

| Runner | Detect devices | Choose device | Choose how much | Observe residency |
|---|---|---|---|---|
| **KoboldCPP, run by SP** | binary variant implies backend ✓ (`binaryManager.ts:105-110`); device list from host probe | `--usecublas [device-id]` / `--usevulkan [device-id]` / `--useclblast` per launch (verify flag forms for 1.119) | `--gpulayers` ✓ (per text model, `modelManager.ts:841`), `--tensor_split`, `--threads`; image `--sdthreads`; speech `--ttsgpu` ✓ | `/api/extra/perf` (verify fields); our own residency map ✓ |
| **audio.cpp, run by SP** | host probe; `/health.backend` ✓ | `backend` + `device` in server.json ✓ (restart) ; per-model `device` ✓ | `threads` ✓, `max_loaded_models` ✓, `idle_unload_ms` ✓, `min_free_memory_mb` | `/v1/models[].device` ✓, our config ✓ |
| **Ollama (never spawned by SP ✓)** | — | **no**: `CUDA_VISIBLE_DEVICES` / `OLLAMA_*` are env at its own start | `num_gpu`, `num_thread` per request (verify SP sends them; today sampling does not) | `/api/ps` `size_vram`, `expires_at` ✓ |
| **llama.cpp / LM Studio external** | — | no | no | llama.cpp `/props`, `/slots` (verify); LM Studio none |
| **audio.cpp external** | `/health.backend` ✓ | no | no | `/v1/models[].device` ✓ |
| **Local ONNX (in-process)** | host probe | **no** (CPU, by the runtime) | threads (verify `@huggingface/transformers` env) | our own ✓ |

## 3. Detection (D1–D4)

- **D1 One prober, `server/hardware/probe.ts`**, returns `HardwareSnapshot { cpu {model, cores, threads}, memory {total, free}, gpus: GpuInfo[] {index, vendor: nvidia|amd|intel|apple|other, name, vramTotal?, vramUsed?, utilisation?, driver?, backendHints: ('cuda'|'rocm'|'vulkan'|'metal')[]}, probedAt }`. Sources, each optional and time-boxed (2 s), never thrown: Node `os` for CPU/RAM; `nvidia-smi --query-gpu=index,name,memory.total,memory.used,utilization.gpu,driver_version --format=csv,noheader,nounits`; `rocm-smi --showmeminfo vram --showuse --json` (and `amd-smi` when present); `system_profiler SPDisplaysDataType -json` on macOS (unified memory → vramTotal = RAM, marked `shared`); `vulkaninfo --summary` as the vendor-neutral fallback for names only. Windows: `nvidia-smi` is on PATH with the driver; others via `wmic path win32_VideoController` / PowerShell `Get-CimInstance` for names. **No native modules** (the bundles are prebuilt per platform; a native addon would break the multi-platform rule).
- **D2 Live samples** every 2 s while at least one admin holds interest in `hardware:sample` (a GATED, admin-restricted family like `koboldcpp:*`), kept as a 5-minute ring in memory, never stored. The graph draws CPU %, RAM used, per-GPU VRAM used and utilisation.
- **D3 A snapshot is also taken at boot** and written to `system_settings.hardware_last` (json) so the Hardware page and the wizard's local recommendations (★H4) have an answer before the first probe; refreshed by **Detect again**.
- **D4 Trust the service over the probe.** When a service reports its own view (audio.cpp `/health.backend`, Ollama `/api/ps`), the page shows that beside the probe's and never "corrects" either.

## 4. Allotment (D5–D7)

- **D5 Per-service allotment rows**, stored on the service's own settings table (`koboldCppSettings`, `audiocpp_settings`): `backend` (from the probe's hints ∩ what the installed binary can do), `deviceIndex` (or `all`), `threads`, and the service-specific knobs (KoboldCPP: default gpu layers, tensor split; audio.cpp: max loaded, idle unload, min free memory). Changing one = the service's own restart path; the row says *Applies on next start* until then.
- **D6 Where it cannot be chosen, say why**, in one line, from the table in §2: *Ollama picks its own devices; set CUDA_VISIBLE_DEVICES where you start it.* Never an empty select.
- **D7 The binary is part of the allotment.** For KoboldCPP and audio.cpp the backend choice IS the variant choice; picking a backend the installed binary lacks offers **Get the <backend> build** (the existing binary job) instead of silently failing.

## 5. Scheduling (D8–D10)

- **D8 Hardware policy table** (⏳ deferred by ★H2: v1 is fixed one-at-a-time, no table) `hardware_policies (a text, b text, policy text)` keyed by runner ids (`managed:koboldcpp`, `managed:audiocpp`, `connection:<id>` for local unmanaged, `onnx` for in-process), policy ∈ `together | one-at-a-time | in-turn`. Default `together`. Symmetric.
- **D9 Enforcement lives in the capability-target → adapter preflight**, the one place every model call passes: before `ensureManagedReady` (KoboldCPP) or `withManagedReady` (audio.cpp) proceeds, `hardware/lease.ts` `acquire(runnerId, {signal})` consults the policies: `one-at-a-time` with a runner that is live → ask it to yield (KoboldCPP: unload text/image model via the admin API or stop; audio.cpp: `/v1/tasks/unload_models` all; ONNX: dispose the pipeline), then proceed; `in-turn` → wait on the other runner's in-flight count (we count our own requests per runner in `lease.ts`; unmanaged runners are counted by our requests to them, which is all we can see). Released on request end. ⚠ Residency is still each runner's own: the lease never decides what stays loaded beyond the yield it asked for (model-lane rule).
- **D10 Visible, never silent.** A request that waited or evicted says so in the run's notes (`waited 12 s for audio.cpp (in turn)`, `KoboldCPP unloaded Kokoro to make room (one at a time)`), and the Hardware page shows the current holder.

## 6. Surfaces

- **Admin › Hardware** (new section, admin-only; placement ★H1: own entry vs under Diagnostics): cards *This machine* (probe + Detect again + graph), *Services* (managed rows with state, residency, allotment form, Restart), *Also on this machine* (unmanaged local rows, read-only), *Running together* (policy matrix as a small grid; with ≤4 runners it is a list of pairs).
- The managed connection views' Settings tabs show *Runs on: GPU 0 (CUDA) · 8 threads — change in Admin › Hardware*.
- Wizard (★H4): the local recommendations (which KoboldCPP build, which speech package) read `hardware_last`.
- Members see none of it.

## 7. Seams and lanes (sketch; sized after GO)

| # | Seam | Lane |
|---|---|---|
| H-S1 | `server/hardware/probe.ts` + per-vendor readers + fixtures (captured `nvidia-smi`/`rocm-smi`/`system_profiler` outputs) | A |
| H-S2 | `hardware:*` sockets (snapshot, sample push, policies get/set, allotment get/set per service), interest family, `system_settings.hardware_last`, `hardware_policies` migration | A |
| H-S3 | Allotment columns on `koboldCppSettings` + `audiocpp_settings`; KoboldCPP args from allotment (`--usecublas/--usevulkan <idx>`, `--threads`, `--tensor_split`); audio.cpp config writer reads allotment | B |
| H-S4 | `hardware/lease.ts` + hooks in `managedPreflight.ts`, `profiles/audiocpp.ts withManagedReady`, ONNX runtime, and the request counter in `modelServerFetch` for unmanaged runners | B |
| H-S5 | Admin › Hardware section (cards, graph — a plain SVG sparkline set, no chart library), Settings-tab lines, wizard read | C |
| H-S6 | Docs `docs/admin.md`/`connections.md` "Hardware"; NOMENCLATURE rows **hardware policy**, **allotment**, **runner** (qualified: *local runner*), **hardware lease**; §25 | C |
| H-V | Fixtures per vendor; lease unit tests (together / one-at-a-time / in-turn, abort while waiting); live walk on the owner's box (NVIDIA) and a CPU-only VM | V |

Order: after PLAN-audiocpp-managed lanes A–B land (the allotment needs `audiocpp_settings` and the supervisor factory), or in parallel with its lane D.

## 8. Open ★

- **★H1** Section name and placement: **Hardware** as its own admin entry (proposal), or inside **Diagnostics**? "Server" collides with the network/remote-access section; "This machine" is the card, not the section.
- **★H2 RULED 2026-10-28:** v1 shows the matrix **partially** (the pairs Serene Pub can enforce: the managed services and the in-process ONNX runtime), **disabled**, every pair **fixed to one-at-a-time**. No policy table is written yet; `hardware/lease.ts` enforces one-at-a-time between those runners and the grid is read-only with one line: *Local runners take turns on this machine's hardware; choosing pairs comes later.* Unmanaged local connections are listed but not in the grid. (Was: is the policy matrix wanted in v1, or only *together* + *one-at-a-time* between the two managed services (a single switch: *Run KoboldCPP and audio.cpp one at a time*)? Proposal: the single switch first; the matrix when a third runner exists.
- **★H3** Should `in-turn` apply to unmanaged local connections at all, given we only see our own requests? Proposal: yes, labelled *in turn (as far as Serene Pub's own requests go)*.
- **★H4** Should the wizard start using the probe (recommend the CUDA KoboldCPP build when an NVIDIA GPU is seen)? Proposal: yes, read-only, one line of reason.
- **★H5** Live graph retention: 5 minutes in memory (proposal) or persisted history? Persisting is a different feature (metrics) and out of scope here.
- **★H6** Ollama per-request `num_gpu` / `num_thread`: expose as allotment for Ollama connections (sent with every request) or leave Ollama entirely to itself? Proposal: leave it; note in D6.
