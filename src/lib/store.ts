/**
 * store.ts — Lightweight persistence.
 *
 * Ingested papers, extracted claims, and generated briefs are held in
 * in-memory Maps (fast access during a session) and mirrored to JSON files
 * so they survive a dev-server restart. No external DB.
 *
 * The in-memory Maps are cached on `globalThis` so they persist across Next.js
 * hot-reloads and route-handler module re-evaluations in development.
 *
 * Filesystem mirroring is best-effort: on serverless hosts (e.g. Vercel) the
 * app filesystem is read-only, so we write to the OS temp dir and treat any
 * fs failure as non-fatal — the in-memory Maps remain the source of truth.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StructuredPaper, Claim, Brief } from "@/types";

// Vercel (and most serverless runtimes) only allow writes under the temp dir;
// process.cwd() is read-only there. Use a writable location everywhere.
const DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "synth-data")
  : path.join(process.cwd(), "data");
const PAPERS_FILE = path.join(DATA_DIR, "papers.json");
const CLAIMS_FILE = path.join(DATA_DIR, "claims.json");
const BRIEFS_FILE = path.join(DATA_DIR, "briefs.json");

interface StoreState {
  papers: Map<string, StructuredPaper>;
  claims: Map<string, Claim[]>; // keyed by paperId
  briefs: Map<string, Brief>;
  loaded: boolean;
}

// Cache on globalThis to survive hot-reload in dev.
const globalForStore = globalThis as unknown as { __synthStore?: StoreState };

const state: StoreState =
  globalForStore.__synthStore ??
  (globalForStore.__synthStore = {
    papers: new Map(),
    claims: new Map(),
    briefs: new Map(),
    loaded: false,
  });

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function ensureLoaded(): Promise<void> {
  if (state.loaded) return;
  state.loaded = true; // mark first so a read failure doesn't retry every call

  if (process.env.ENABLE_PERSISTENCE !== "true") {
    // Operate strictly in-memory (empty Maps).
    state.papers = new Map();
    state.claims = new Map();
    state.briefs = new Map();
    return;
  }

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const papers = await readJson<StructuredPaper[]>(PAPERS_FILE, []);
    const claims = await readJson<[string, Claim[]][]>(CLAIMS_FILE, []);
    const briefs = await readJson<Brief[]>(BRIEFS_FILE, []);

    state.papers = new Map(papers.map((p) => [p.id, p]));
    state.claims = new Map(claims);
    state.briefs = new Map(briefs.map((b) => [b.id, b]));
  } catch {
    // Read-only / unavailable filesystem — operate purely in-memory.
  }
}

async function persist(file: string, data: unknown): Promise<void> {
  if (process.env.ENABLE_PERSISTENCE !== "true") return;
  // Best-effort mirror; never let a read-only filesystem crash a request.
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // Ignore — the in-memory Maps remain the source of truth.
  }
}

// ─── Papers ──────────────────────────────────────────────────────────────────

export async function savePaper(paper: StructuredPaper): Promise<void> {
  await ensureLoaded();
  state.papers.set(paper.id, paper);
  await persist(PAPERS_FILE, [...state.papers.values()]);
}

export async function getPaper(id: string): Promise<StructuredPaper | undefined> {
  await ensureLoaded();
  return state.papers.get(id);
}

export async function listPapers(sessionId?: string): Promise<StructuredPaper[]> {
  await ensureLoaded();
  const allPapers = [...state.papers.values()];
  if (sessionId) {
    return allPapers.filter((p) => p.sessionId === sessionId);
  }
  return allPapers;
}

export async function deletePaper(id: string): Promise<void> {
  await ensureLoaded();
  state.papers.delete(id);
  state.claims.delete(id);

  let briefsChanged = false;
  for (const [briefId, brief] of state.briefs.entries()) {
    if (brief.paperIds.includes(id)) {
      brief.paperIds = brief.paperIds.filter((pid) => pid !== id);
      brief.citedClaims = brief.citedClaims.filter((c) => c.paperId !== id);
      state.briefs.set(briefId, brief);
      briefsChanged = true;
    }
  }

  await persist(PAPERS_FILE, [...state.papers.values()]);
  await persist(CLAIMS_FILE, [...state.claims.entries()]);
  if (briefsChanged) {
    await persist(BRIEFS_FILE, [...state.briefs.values()]);
  }
}

// ─── Claims ──────────────────────────────────────────────────────────────────

export async function saveClaims(paperId: string, claims: Claim[]): Promise<void> {
  await ensureLoaded();
  state.claims.set(paperId, claims);
  await persist(CLAIMS_FILE, [...state.claims.entries()]);
}

export async function getClaims(paperId: string): Promise<Claim[]> {
  await ensureLoaded();
  return state.claims.get(paperId) ?? [];
}

export async function getClaimsForPapers(paperIds: string[]): Promise<Claim[]> {
  await ensureLoaded();
  return paperIds.flatMap((id) => state.claims.get(id) ?? []);
}

// ─── Briefs ──────────────────────────────────────────────────────────────────

export async function saveBrief(brief: Brief): Promise<void> {
  await ensureLoaded();
  state.briefs.set(brief.id, brief);
  await persist(BRIEFS_FILE, [...state.briefs.values()]);
}

export async function getBrief(id: string): Promise<Brief | undefined> {
  await ensureLoaded();
  return state.briefs.get(id);
}

export async function listBriefs(sessionId?: string): Promise<Brief[]> {
  await ensureLoaded();
  // Return briefs sorted by date descending (newest first)
  const allBriefs = [...state.briefs.values()].sort((a, b) => 
    new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
  );
  if (sessionId) {
    return allBriefs.filter((b) => b.sessionId === sessionId);
  }
  return allBriefs;
}