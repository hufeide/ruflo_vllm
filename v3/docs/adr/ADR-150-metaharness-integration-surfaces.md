# ADR-150 — MetaHarness Integration Surfaces in `npx ruflo`

**Status**: Proposed
**Date**: 2026-06-16
**Related**: ADR-148 (cost-optimal router lifecycle via `@metaharness/router`), ADR-149 (per-model cost-optimal routing), ADR-026 (3-tier model routing), ADR-097 (federation budget circuit breaker), ADR-124 (optional native dependencies), ADR-144 (agent-authorization-propagation)
**External reference**: [`ruvnet/agent-harness-generator`](https://github.com/ruvnet/agent-harness-generator) — the upstream that publishes `metaharness` + `@metaharness/*`. Same author (rUv), explicitly designed around ruflo primitives.
**Research dossier**: published as a gist (linked from the tracking issue) with full graded-evidence sourcing.

## Context

We just shipped `ruflo@3.11.0` (also `@claude-flow/cli@3.11.0`, `claude-flow@3.11.0`). ADR-148/149 already wired `@metaharness/router` as an `optionalDependency` for cost-optimal model routing behind a triple gate. The remaining MetaHarness surface — twenty-plus `@metaharness/*` packages: kernel, host adapters (9), verticals (13), scaffold/eject CLI — is unused by ruflo despite being authored by the same maintainer specifically around ruflo's architecture.

Three signals make this the right time to commit a broader integration:

1. **MetaHarness is first-party.** Same author (`ruv@ruv.net`), same ADR numbering convention (kernel docs reference ADR-011/022/033/036/040/041/043), explicit framing: *"Scaffold your own focused AI agent harness — like ruflo, uniquely yours."* The `buildRegistryEntry()` doc comment says: *"Mirrors the ruflo plugin registry shape so the same UI can browse it."* The `@metaharness/host-claude-code` adapter emits `.claude/settings.json` in exactly ruflo's format.
2. **The router integration is already live but underutilized.** `@metaharness/router@^0.3.2` is in `optionalDependencies`; `neural-router.ts` imports it behind `CLAUDE_FLOW_ROUTER_NEURAL=1`. The bundled KRR is trained on hand-coded seed scores rather than measured routing outcomes — leaving the DRACO Pareto win unrealized.
3. **No ruflo skill exposes scaffolding/score/genome/threat-model to Claude Code today.** Users discover MetaHarness independently and are confused about the relationship.

### Evidence baseline (measured 2026-06-16)

| Fact | Source | Grade |
|---|---|---|
| `metaharness@0.1.11` ships 24 subcommands across two binaries (`metaharness` factory + `harness` lifecycle) | `dist/index.d.ts`, `dist/subcommands.d.ts`, all `*-cmd.d.ts` | HIGH |
| 20+ `@metaharness/*` packages published; full ecosystem (kernel + 5 host adapters + 13 verticals + 5 platform NAPI binaries) | `npm search @metaharness` | HIGH |
| `@metaharness/router@0.3.2` exports `Router` (k-NN), `TrainedRouter` (KRR), `NativeRouter` (FastGRNN via tiny-dancer), zero runtime deps, 53 kB unpacked | `dist/*.d.ts`, npm registry | HIGH |
| `@metaharness/kernel@0.1.0` exports `loadKernel`, `ToolDispatcher` (claims-checked), `SelfEvolvingRouter`, `TrajectoryStore`, `rankWithDecay` | `kernel-pkg/package/dist/*.d.ts` | HIGH |
| `metaharness` factory exports `buildRepoScorecard()`, `buildGenomeReport()`, `buildScorecard()`, `buildThreatModel()`, `scanMcp()`, `buildOiaManifest()`, `buildRegistryEntry()` — all pure reads, well-typed | `dist/repo-scorecard.d.ts` etc. | HIGH |
| Velocity: `metaharness` 0.1.0 → 0.1.11 in ~23h; `@metaharness/router` 0.1.0 → 0.3.2 in 2.7h on 2026-06-15 | npm `time` field | HIGH |
| Both packages MIT-licensed, same maintainer as ruflo | npm registry | HIGH |
| Existing benchmark proves `@metaharness/router` native backend loads on the test host: `mh_native_available: true` | `docs/benchmarks/runs/router-4way-seed99-2026-06-15T14-12-40Z.json` | HIGH |

## Decision

Adopt MetaHarness as ruflo's downstream sibling tool, surfaced through three integration channels that match its three distinct contributions:

1. **Static-analysis MCP tools** — `harness-score`, `harness-genome`, `harness-threat-model`, `harness-mcp-scan` as a new `plugins/ruflo-metaharness/` plugin. Subprocess invocation of the `metaharness` / `harness` CLI binaries; no static library dependency added to ruflo's boot path. Read-only operations only.
2. **Live router data pipeline** — replace the hand-coded seed corpus for the bundled KRR with measured routing trajectories collected via the existing `CLAUDE_FLOW_ROUTER_TRAJECTORY=1` recorder; retrain `train-bundled-krr.mjs` against real data. This unlocks the Pareto win ADR-149 forecast but never measured.
3. **CI security gates** — add `harness mcp scan .` and `metaharness score . --json` to `v3-ci.yml`. Both are static, fast, and machine-readable. Asserts no HIGH MCP findings and a non-zero readiness score on every PR.

Three concrete things we ARE NOT doing in this ADR (deferred to Phase 2+):

- Wiring `@metaharness/kernel`'s `ToolDispatcher` into the MCP dispatch core. The kernel is v0.1.0 and the dispatch path is too high-blast-radius for an early-stage replacement.
- Promoting `@metaharness/router` from `optionalDependency` to `dependency`. The triple gate is the right posture until the API stabilizes at 1.0.
- Exposing `from-repo <git-url>` as an MCP tool callable by Claude Code without explicit user confirmation. Untrusted-Git-clone is a deliberate human-in-the-loop step.

### Phased rollout

**Phase 0 — Measurement spike (1–3 days, no code shipped to npm).**
- Run `npx metaharness score .` and `npx metaharness genome .` against the ruflo repo to establish baseline scorecards.
- Enable `CLAUDE_FLOW_ROUTER_TRAJECTORY=1` for ≥50 routing decisions; verify the `.swarm/model-router-trajectories.jsonl` shape matches what `train-bundled-krr.mjs` expects.
- Confirm `import('@metaharness/router')` succeeds from `v3/@claude-flow/cli` and exercise `Router.fromExamples(...)` with the existing benchmark corpus.
- Run `harness mcp scan .` to baseline ruflo's own MCP threat-model score.

Exit criteria: baseline numbers in hand; no surprises in trajectory format or `mcp scan` output.

**Phase 1 — MVP (3–7 days, one MINOR release: 3.12.0).**
1. **`plugins/ruflo-metaharness/`** with three skills (`harness-score`, `harness-genome`, `harness-mint`), conventional structure (`plugin.json`, `skills/*/SKILL.md` with `allowed-tools: Bash`, `scripts/smoke.sh`). Skills shell out to `npx metaharness` / `npx harness` — no library imports. Covered by the fleet meta-smoke and the three existing audits (exit-bypass, frontmatter, manifest).
2. **CI gates** in `v3-ci.yml`: `npx metaharness score . --json` (assert `exitCode === 0`) and `npx harness mcp scan .` (assert no HIGH findings). Both are additive jobs on the existing matrix.
3. **Real seed corpus**: collect trajectory data over Phase-0's recorder runs + a CI pass, retrain via `scripts/train-bundled-krr.mjs`, regenerate the bundled artifact. Validate `routedBy: 'metaharness-krr'` activates on real decisions in the next bench run.

Exit criteria: `plugins/ruflo-metaharness/scripts/smoke.sh` passes; meta-smoke shows 33/33 plugins green; CI score + mcp-scan jobs green on main; new bench run shows `routedBy: 'metaharness-krr'` for ≥ 1 routing decision driven by measured-seed KRR.

Semver: MINOR — additive plugin, additive CI gates, additive MCP tools. No breaking changes.

**Phase 2 — Expansion (1–4 weeks, one or two MINOR releases).**
- `npx ruflo eject` command wrapping `metaharness --from-existing ./` for one-shot harness extraction (attribution preserved via the `<!-- ruflo-attribution-block -->` convention).
- `SelfEvolvingRouter` (from `@metaharness/kernel`) parallel-logged alongside the Thompson bandit in `model-router.ts` for two weeks; promote to default only if disagreement < 5% or quality improvement > 2%.
- Harness entries in the ruflo plugin registry — accept `type: 'harness'` in `discovery.ts`; surface via `npx ruflo plugins list --type harness`.
- 13th background worker `oia-audit` that runs `buildOiaManifest()` + `buildThreatModel()` + `scanMcp()` on a schedule and stores results in the `metaharness-audit` memory namespace.

Each Phase-2 item is independently scoped and can ship as separate MINOR releases.

## Consequences

### Positive

- Closes the "what is the relationship between ruflo and MetaHarness?" question by answering it in the UX rather than the docs.
- Ruflo gains a continuous, machine-readable readiness score and MCP threat-model on every PR — the same primitives we use to score third-party repos for harness viability.
- The ADR-149 Pareto win (per-model cost-optimal routing) becomes measured rather than theoretical, because the KRR is finally trained on real trajectories.
- Phase 1 is entirely additive: no `model-router.ts` dispatch logic changes, no top-level command surface change, no IPFS registry change. Backward-compatible MINOR bump.
- Three integration channels match MetaHarness's three contributions — analysis, routing, hosts — without forcing the kernel's full surface into a position where its 0.x stability would block ruflo releases.

### Negative / risks

- **API stability**: both `metaharness` and `@metaharness/router` are 0.x and ship rapid patch releases. A breaking change in `@metaharness/router@0.4.x` would require immediate `neural-router.ts` updates. Mitigation: pin to `~0.3.2` in `optionalDependencies`; add `scripts/check-metaharness-compat.mjs` to CI exercising the `Router` constructor with a trivial example to catch runtime breakage before publishing.
- **Bus factor**: same maintainer as ruflo, MetaHarness, and ruvector. No change from today, but the dependency edge is now explicit.
- **Sandboxing**: `harness from-repo <url>` clones arbitrary Git URLs. Phase-1 skills NEVER expose this to Claude Code; only `analyze`/`score`/`genome` (pure reads) and `harness-mint` (writes to user-specified target dir, never project root).
- **GCP dependency**: `harness validate` uses GCP Secret Manager via `gcloud`. Ruflo CI must skip those subcommands (or mock them) — explicit `--skip-gcp` flag from the `harness validate` command surface handles this.
- **Phase-1 MCP plugin spawns subprocesses**: subprocess crashes, timeouts, and stdout-parsing edge cases are now in ruflo's failure surface. Mitigation: hard timeout (60s) per invocation, captured stderr in error responses, structured-JSON output enforced via `--json` flag everywhere.

### Neutral / accepted trade-offs

- Subprocess invocation in Phase 1 (rather than library import) adds ~200ms cold-start overhead per call vs. an embedded library. Acceptable for MCP tools that are not in the hot path; the router path (already library-imported) remains as-is.
- Maintaining a `ruflo-metaharness` plugin doubles documentation surface for two sibling tools. Mitigation: skill descriptions explicitly point to the upstream MetaHarness docs as canonical for the underlying functionality; the plugin only documents the ruflo-side adaptation.

## Alternatives Considered

**Alternative A: Ignore MetaHarness, build all scaffolding/score/genome natively in ruflo.**
Rejected. `buildRepoScorecard()`, `buildGenomeReport()`, `scanMcp()`, `buildThreatModel()` are already-tested implementations exposing clean TypeScript APIs. Reimplementing them in ruflo is pure duplication cost with no advantage. The eject path's `rewriteContent()` with attribution-block preservation is subtle.

**Alternative B: Use MetaHarness only as a CLI subprocess everywhere, never as a library import.**
Partially adopted (this is the Phase-1 plugin posture). Wrong for `@metaharness/router` — sub-ms routing latency demands a library import, which ADR-148/149 already accepted.

**Alternative C: Promote `@metaharness/router` from `optionalDependency` to `dependency`.**
Rejected for now. The triple gate (`CLAUDE_FLOW_ROUTER_NEURAL=1` + artifact + import success) is the right posture until the API stabilizes at 1.0.

**Alternative D: Wait for MetaHarness 1.0 before any further integration beyond ADR-148/149.**
Rejected. The static-analysis surface (`score`, `genome`, `mcp scan`, `threat-model`) is already mature (475 files, well-typed, pure reads). Waiting creates a window where users discover MetaHarness independently and are confused about its relationship to ruflo. The Phase-1 plugin answers that question without incurring API-stability risk because the integration is via CLI subprocess, not library import.

**Alternative E: Wire `@metaharness/kernel`'s `ToolDispatcher` as the primary MCP dispatch in Phase 1.**
Rejected. Touching the MCP dispatch core affects all 314 tools and is too high-blast-radius for an early-stage (v0.1.0) component. Deferred to a Phase-3 ADR after the kernel ships a 1.0 with API-stability commitments.

## Open Questions

- Should the Phase-1 plugin's `harness-mint` skill require explicit user confirmation in the Claude Code UI before writing any files? Lean yes — destructive-action-confirmation matches ruflo's "executing actions with care" principle.
- Should the seed-corpus retraining cadence be ad-hoc (Phase-1) or scheduled (e.g., monthly cron in a Phase-2 follow-up)? Defer to Phase-2 once we see the trajectory volume.
- Does the `oia-audit` background worker (Phase 2) belong in `ruflo-loop-workers` or in `ruflo-metaharness`? Probably the latter, since the audit output is MetaHarness-specific.

## References

- [Research dossier (gist)](https://gist.github.com/ruvnet/19d166ff9acf368c9da4172d91ac9113) — full graded-evidence sourcing.
- [Tracking issue](https://github.com/ruvnet/ruflo/issues) — link inserted once opened; phase checklist.
- ADR-148 — Cost-optimal router lifecycle via `@metaharness/router`.
- ADR-149 — Per-model cost-optimal routing (Pareto framing).
- ADR-097 — Federation budget circuit breaker (cost-spend telemetry pattern reused by metaharness plugin).
- `metaharness@0.1.11` on npm: <https://www.npmjs.com/package/metaharness>
- `@metaharness/router@0.3.2` on npm: <https://www.npmjs.com/package/@metaharness/router>
- `@metaharness/kernel@0.1.0` on npm: <https://www.npmjs.com/package/@metaharness/kernel>
- Upstream: <https://github.com/ruvnet/agent-harness-generator>
