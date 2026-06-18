/**
 * store.ts — Lightweight persistence.
 *
 * Ingested papers, extracted claims, and generated briefs are held in
 * in-memory Maps (fast access during a session) and mirrored to JSON files
 * under `data/` so they survive a dev-server restart. No external DB.
 *
 * The in-memory Maps are cached on `globalThis` so they persist across Next.js
 * hot-reloads and route-handler module re-evaluations in development.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { StructuredPaper, Claim, Brief } from "@/types";

const DATA_DIR = path.join(process.cwd(), "data");
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
  await fs.mkdir(DATA_DIR, { recursive: true });

  const papers = await readJson<StructuredPaper[]>(PAPERS_FILE, []);
  const claims = await readJson<[string, Claim[]][]>(CLAIMS_FILE, []);
  const briefs = await readJson<Brief[]>(BRIEFS_FILE, []);

  state.papers = new Map(papers.map((p) => [p.id, p]));
  state.claims = new Map(claims);
  state.briefs = new Map(briefs.map((b) => [b.id, b]));
  state.loaded = true;
}

async function persist(file: string, data: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
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

export async function listPapers(): Promise<StructuredPaper[]> {
  await ensureLoaded();
  return [...state.papers.values()];
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

export async function listBriefs(): Promise<Brief[]> {
  await ensureLoaded();
  // Return briefs sorted by date descending (newest first)
  return [...state.briefs.values()].sort((a, b) => 
    new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
  );
}