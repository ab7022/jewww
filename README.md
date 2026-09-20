# jev-browser

A browser agent where an LLM compiles a goal into a small program **once**, and
[JEV](https://openrouter.ai/labs/jev) — a typed-decision model that generates no text —
makes every per-step decision inside it.

This repo is **Phase 1: the harness**. There is no product here. It builds the packages a
product would need anyway, plus offline benchmarks that answer whether the idea works
before any Chrome code exists.

## Packages

| | |
|---|---|
| `packages/shared` | Wire contract: snapshot, question, action, profile, plan nodes |
| `packages/sense` | DOM → ranked snapshot. Collector is one self-contained function, so the same source runs under Playwright now and as a content script later. Ranking is pure and runs in Node. |
| `packages/jev` | OpenRouter `/api/v1/systemone` (primary) + Vercel `/v1/evaluate`, with the `noul`/`boolean` dialect normalised away |
| `packages/planner` | goal → node program, on `openai/gpt-5.6-luna` |

## Setup

```bash
pnpm i
cp .env.example .env      # add OPENROUTER_API_KEY
pnpm exec playwright install chromium
```

## Benchmarks

```bash
pnpm smoke                  # one live call: key, price, model build, probabilities
pnpm test                   # unit tests, no network
pnpm eval:capture           # Playwright → eval/fixtures (one time)
pnpm eval:label             # hand-label selection targets
pnpm eval:select --recall   # ranking recall, free, no model
pnpm eval:select            # + JEV top-1 accuracy
pnpm eval:fields            # field mapping on real ATS forms
pnpm eval:plans             # 50 end-to-end use cases → planner checks
pnpm plan <slug>            # inspect one plan
```

Everything after `eval:capture` replays saved fixtures offline. A full sweep is a few cents.

## Measured

| Metric | Result | Gate |
|---|---|---|
| Ranking recall @120 | 100% (13) | ≥95% |
| JEV element selection top-1 | 100% (13) | ≥85% |
| Field mapping | 98.3% (59 fields, 5 real ATS forms) | ≥90% |
| Planner safety gating | 50/50 | 100% |
| JEV cost | $0.042/M input, output free | — |
| JEV latency | ~450–500ms warm | — |

## Two design decisions worth knowing

**Ranking picks which elements survive the cap; document order decides how they are
presented.** Positional intents ("open the first job posting") are common, and the only
way the model can answer one is if the list it sees runs in the order the page does.

**Ground truth never comes from a model.** Field labels come from deterministic rules and
anything a rule cannot decide is excluded from scoring. Selection targets are hand-picked.
A benchmark labelled by an LLM only measures agreement with that LLM.
