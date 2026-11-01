# REPORT — readiness lane W (B1, A2, B2 docs, E3) — 2026-10-30

Saved by the lead from the supervisor's hand-back (the harness refused the subagent's own write). Nothing committed.

## Built
**B1 Windows signing (SignPath Foundation)**
- NEW `docs/code-signing-policy.md`, registered in `scripts/build-docs.js` under Reference and help: SignPath's
  required sentence and why the publisher reads SignPath Foundation; what is signed (`Serene Pub.exe`,
  `app\serene-pub-window.exe`); what isn't and why it is open source (`node.exe` from nodejs.org checked against
  SHASUMS256; `node_modules` licence-gated by `bundle-dist.js`; closed-source DirectML/dxil/dxcompiler DLLs pruned
  by `prune-dist.js:131`); how a release is made (tag → `release.yml` on GitHub runners → manual approval in
  SignPath); roles (all `doolijb`, MFA required); privacy statement; uninstalling, checking a signature, reporting.
- `docs/install.md` Windows step 4: the warning "can" appear for a while on a new release; links the policy.
- `.github/workflows/release.yml` (+76 lines): `actions: read` on `build-and-release`; four Windows-only steps
  between the macOS sign step and the Windows zip: gate (secret + variables via `env`, notice when missing),
  `upload-artifact@v4` of the two exes, `signpath/github-action-submit-signing-request@f6d04783…` (# v3.0, waits
  ≤2700 s), pwsh copy-back that fails unless the signature reads Valid. With no secret all four skip.

**A2 place for checklist results**
- NEW `.github/ISSUE_TEMPLATE/capability-report.yml` (Capability report form: section, item, declared marking,
  result, model, service + version, system, Serene Pub version, optional support report) and
  `.github/ISSUE_TEMPLATE/config.yml` (blank issues on; Discord for questions).
- `TESTING-CHECKLIST-0.6.0.md`: "Where to send results" line; step 4 and Reporting point at the form.
- pr-7 notes: sentence under **Help test what models can do**.

**B2 docs** (`docs/connect-a-model.md`): Setting up row "Make an account and copy a key. Free models need no
credit."; Not sure? and step 1 updated; step 5 says type `free` in the filter; new **Free models** section
(50/day and 20/min, ~50 replies; 1,000/day after a one-time $10; credit unlocks the rest; list changes; some
free providers may keep what you send).

**E3 release notes** (`docs/release-notes/`, next is untracked `0.6.0-pr-7.md`): "Plugins are on by default" with
an Admin › Plugins switch (`<!-- LANE P -->` placeholder to confirm); **Not in 0.6**: modifiers; iOS app; lorebook
export and native format; `.serene` (0.7). Downloads links the policy.

**Fixes on the way:** pr-3/pr-6/pr-7 said "Settings › About can copy a support report" → **Admin › Diagnostics**.
Registered the SDK guide `stability` (lane S's D2 page) in `SDK_GUIDE_ORDER` after `vocabulary`.

## Verified
YAML parses; prettier passes on the three YAML files; step order and permissions checked by script; `actionlint`
not installed, workflow not run. `node scripts/build-docs.js --site`: 284 pages, 0 warnings. Anchors checked by hand.

## New terms (§25 rows added)
🚧 **code signing policy** (the docs page; not §5 "policy" nor SignPath's "signing policy" slug). 🚧 **Capability
report** (the issue form; "capability" in its §10 sense).

## Owner actions left
1. Apply at https://signpath.org/apply (terms read 2026-10-30, marked draft).
2. MFA for everyone with write access on GitHub and SignPath.
3. SignPath: link the GitHub.com trusted build system; create a signing policy (owner as approver); artifact
   configuration:
   ```xml
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="Serene Pub.exe" product-name="Serene Pub"><authenticode-sign/></pe-file>
       <directory path="app">
         <pe-file path="serene-pub-window.exe" product-name="Serene Pub"><authenticode-sign/></pe-file>
       </directory>
     </zip-file>
   </artifact-configuration>
   ```
4. GitHub Actions: secret `SIGNPATH_API_TOKEN`; variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`,
   `SIGNPATH_SIGNING_POLICY_SLUG`; optionally `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`.
5. Re-read the policy page (roles table, privacy list).
6. Add a "Code signing policy" link to `README.md` (SignPath wants it on the home page and release pages).
7. Approve each signed release's request in SignPath within 45 minutes (job capped at 90).
8. **The checklist is gitignored** (`/*.md`): add `!/TESTING-CHECKLIST-0.6.0.md` to `.gitignore` and commit it
   before tagging pr-7, else links 404. Issue forms show only from the default branch (`main`). Optionally create
   the `capability report` label.

## Decisions for the owner
- Modifiers wording: rules already add bonuses from items and effects to rolls (`docs/rulesets.md:79`); confirm
  what "modifiers" means so the Not-in-0.6 bullet is accurate.
- Checklist Known gaps still says no adapter declares embeddings or speech (left unedited).
- HTML comments in docs appear in `search.json` snippets (pre-existing; SDK docs compiler).

## Placeholders for the second docs pass
- `docs/connect-a-model.md` after OpenRouter step 5: `<!-- LANE C: … -->`.
- `docs/release-notes/0.6.0-pr-7.md` under Changed: `<!-- LANE P: … -->`.
- `docs/plugins.md` and `docs/environment-variables.md:78` still say plugins are off by default.

## Ledger
2026-10-30 openrouter.ai/docs/api-reference/limits and /docs/faq (free limits); signpath.org/terms; action v3.0 → f6d0478.

Files: docs/code-signing-policy.md (new), docs/install.md, docs/connect-a-model.md, docs/release-notes/0.6.0-pr-{3,6,7}.md,
.github/workflows/release.yml, .github/ISSUE_TEMPLATE/{capability-report,config}.yml (new), scripts/build-docs.js,
TESTING-CHECKLIST-0.6.0.md, NOMENCLATURE.md.
