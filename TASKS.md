# 📋 TASKS — Research Synthesis Engine

Work split for the 5-person group. **Each member owns one issue and lands exactly one commit.**

## Ground rules

- **One commit per member.** Pick an issue below, put your name in **Owner**.
- Branch off `main`: `git checkout -b feat/<issue-number>-<short-name>`, then open a PR.
- **Stay inside your issue's "Files to touch"** so the five commits don't conflict.
- Run `npm run typecheck && npm run lint && npm run build` before you push — all must pass.
- TypeScript strict mode: no `any`, named exports, handle errors explicitly.
- Don't commit secrets. Keys go in `.env.local` (gitignored); document new keys in `.env.example`.

### Where things live (current architecture)

| Area | File |
| --- | --- |
| LLM + embeddings (Gemini, has 429/503 retry) | `src/lib/gemini.ts` |
| Persistence (JSON files + in-memory Maps) | `src/lib/store.ts` |
| Synthesis (cosine clustering, threshold 0.80) | `src/lib/synthesis.ts` |
| Discovery / Ingestion / Claims / Brief / Citations | `src/lib/{discovery,ingest,claims,brief,citations}.ts` |
| UI | `src/app/page.tsx`, `src/app/globals.css`, `src/app/components/` |
| API routes | `src/app/api/*/route.ts` |

---

## #1 — UI/UX overhaul

`labels: ui` · **Owner:** @________ · **Est:** ~3–4 h

**Why.** The current UI is intentionally minimal. Make the 4-step workflow clearer and the
citation traceability more tangible for a reviewer.

**Scope.**
- Tighten the 4-step layout (Discover → Library → Synthesis → Brief); add section dividers and a
  consensus color legend (agree = green, conflict = red, thin = amber).
- Replace the hover-only tooltip in `CitationText.tsx` with a **click-to-open citation panel**
  showing paper title, section, page, and the verbatim quote.
- Add proper loading / empty / error states (spinners already exist in `globals.css`).
- Make it responsive (single column on mobile).

**Files to touch.** `src/app/page.tsx`, `src/app/globals.css`, `src/app/components/CitationText.tsx`
(+ new components under `src/app/components/`). **No backend changes.**

**Acceptance criteria.**
- [ ] Clicking a citation opens a panel with paper + page + exact quote.
- [ ] Consensus legend visible; theme badges color-coded.
- [ ] Loading/empty/error states for all 4 steps.
- [ ] Layout usable at 375 px width.
- [ ] `typecheck` + `lint` + `build` pass.

---

## #2 — Migrate claim storage & grouping to Qdrant

`labels: infra` · **Owner:** @________ · **Est:** ~4–5 h

**Why.** Synthesis currently clusters claims with in-memory cosine similarity
(`clusterClaims` in `synthesis.ts`) and persists to JSON. A real vector DB makes grouping
scale beyond a handful of papers.

**Scope.**
- Add a `src/lib/qdrant.ts` wrapper (Qdrant Cloud). On ingest, upsert each claim's embedding
  (reuse `embed()` from `src/lib/gemini.ts`) with `{claimId, paperId, text}` payload.
- In `synthesis.ts`, group claims using Qdrant similarity search instead of (or feeding) the
  in-memory clustering.
- Add `QDRANT_URL` + `QDRANT_API_KEY` to `.env.example`.
- **Graceful fallback:** if the Qdrant env vars are unset, keep the existing in-memory path so
  the app still runs out of the box.

**Files to touch.** new `src/lib/qdrant.ts`, `src/lib/synthesis.ts`, `src/lib/store.ts` (or its
callers in `src/app/api/ingest`/`upload`), `.env.example`, `package.json` (`@qdrant/js-client-rest`).

**Acceptance criteria.**
- [ ] Claims are upserted to Qdrant on ingest.
- [ ] Synthesis groups via Qdrant when configured.
- [ ] App still works with Qdrant env unset (fallback).
- [ ] `typecheck` + `lint` + `build` pass.

---

## #3 — Multi-provider LLM fallback (Claude + Groq)

`labels: backend` · **Owner:** @________ · **Est:** ~4–5 h

**Why.** Gemini free tier caps at ~20 requests/day and occasionally 503s. If Gemini fails we
should fall back automatically. Also strengthens the assignment's **Mandatory AI Integration**
requirement — we'd evaluate three platforms instead of one.

**Scope.**
- Introduce a provider-agnostic `src/lib/llm.ts` exposing the **same** `generateJSON<T>()`,
  `generateText()`, `embed()` signatures so no caller changes.
- Order: **Gemini → Anthropic Claude → Groq**. On a non-retryable failure (e.g. daily quota
  exhausted), fall through to the next provider. Keep the existing 429/503 retry per provider.
- Claude: `@anthropic-ai/sdk`, default `claude-haiku-4-5` (fast/cheap) or `claude-sonnet-4-6`.
  Groq: OpenAI-compatible endpoint (e.g. `llama-3.3-70b`). Embeddings stay on Gemini (or add a
  Groq/other embedding fallback if time permits).
- Env: `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, optional `LLM_PROVIDER_ORDER`. Document in
  `.env.example`. Update the README "Free-tier note".

**Files to touch.** new `src/lib/llm.ts`, refactor `src/lib/gemini.ts` (becomes the Gemini
adapter), `.env.example`, `README.md`, `package.json`. Library callers import from `llm.ts`.

**Acceptance criteria.**
- [ ] All `src/lib/*` callers go through the unified provider layer.
- [ ] Simulating a Gemini failure falls through to Claude, then Groq.
- [ ] Existing structured-output (zod) validation still enforced.
- [ ] `typecheck` + `lint` + `build` pass.

---

## #4 — Evaluation harness + tests

`labels: enhancement` · **Owner:** @________ · **Est:** ~3–4 h

**Why.** The assignment is graded on explicit Success Metrics. Codify them as runnable tests so
we can prove (and not regress) traceability and contradiction detection.

**Scope.**
- Add `npm test` (node:test or vitest). Unit tests for the pure logic:
  - `validateQuotes` (`src/lib/claims.ts`) — drops claims whose quote isn't on the page.
  - `clusterClaims` (`src/lib/synthesis.ts`) — separates dissimilar vectors.
  - `validateCitations` (`src/lib/brief.ts`) — strips invented `[claimId]`s.
- A fixture with a **planted contradiction** (two opposing claims) asserting synthesis labels
  the theme `conflict`. (See the two coffee PDFs used during manual verification as a model.)
- An assertion that **100% of citations in a generated brief resolve to real claims**.

**Files to touch.** new `tests/` (or `scripts/evaluate.ts`), `package.json` (test script + dev
dep). Tiny fixtures under `tests/fixtures/`. **Mostly new files — no conflicts.**

**Acceptance criteria.**
- [ ] `npm test` runs and passes locally.
- [ ] Includes the planted-contradiction → `conflict` case.
- [ ] Includes the "no unsourced citations" check.
- [ ] `typecheck` + `lint` pass.

---

## #5 — Full brief export + history view

`labels: enhancement` · **Owner:** @________ · **Est:** ~3 h

**Why.** Today we only export BibTeX/APA citations (`src/lib/citations.ts`). Reviewers want the
**whole brief** as a document, and a way to revisit past briefs.

**Scope.**
- Add Markdown (and optionally PDF) export of the full brief — exec summary, findings by theme,
  consensus, open questions, recommended papers — with citations rendered as `(Paper, p.N)`.
- New route, e.g. `src/app/api/brief/[briefId]/export?format=md`, reusing `getBrief` from
  `store.ts`.
- A simple **history view** listing past briefs (question + date) that re-opens one. Add a
  `GET /api/briefs` list endpoint (extend `store.ts` with a `listBriefs()`).

**Files to touch.** `src/lib/citations.ts` (or new `src/lib/export.ts`), new
`src/app/api/brief/[briefId]/export/route.ts`, new `src/app/api/briefs/route.ts`,
`src/lib/store.ts` (`listBriefs`), small UI hook in `src/app/page.tsx`.

**Acceptance criteria.**
- [ ] Brief downloads as a readable Markdown file with citations intact.
- [ ] Past briefs are listable and re-openable.
- [ ] `typecheck` + `lint` + `build` pass.

---

### Suggested order / dependencies

These are independent. #3 (LLM layer) touches `gemini.ts`, so if both #2 and #3 are in flight,
coordinate: #2 only needs `embed()` and can import it from wherever #3 leaves it. Everything
else is cleanly separated.
