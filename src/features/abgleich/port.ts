/**
 * Der Bote des Abgleichs: genau die Befehle der Rust-Seite (Vertrag in `data/platform.ts`).
 * Der Ablauf (`engine.ts`) kennt nur diese Schnittstelle – in Tests steht an ihrer Stelle eine
 * Attrappe im Speicher (`__tests__/fake.ts`).
 */
import {
  syncApplyAbort,
  syncApplyBegin,
  syncApplyEnd,
  syncAsideDrop,
  syncAsideList,
  syncAsidePut,
  syncAsideRead,
  syncClearKey,
  syncFetch,
  syncLink,
  syncMark,
  syncProbe,
  syncPush,
  syncRecover,
  syncScan,
  syncSetKey,
  syncState,
  type ApplyBeginInput,
  type AsideReason,
  type AsideRun,
  type FetchItem,
  type FetchedFile,
  type MarkInput,
  type PushInput,
  type SyncLink,
  type SyncProbeResult,
  type SyncScan,
  type SyncStateInfo,
} from '../../data/platform';

export interface SyncPort {
  state(root: string, dataVersion: number): Promise<SyncStateInfo>;
  setKey(key: string): Promise<void>;
  clearKey(): Promise<void>;
  probe(owner?: string, repo?: string): Promise<SyncProbeResult>;
  link(root: string, link: SyncLink | null, moveTo?: boolean): Promise<void>;
  recover(root: string): Promise<{ finished: number; left: { path: string; sha: string }[] }>;
  scan(root: string, remote: boolean, retryKey?: boolean, link?: SyncLink): Promise<SyncScan>;
  fetch(root: string, items: FetchItem[], link?: SyncLink): Promise<FetchedFile[]>;
  applyBegin(input: ApplyBeginInput): Promise<{ run: number; busy: string[] }>;
  applyEnd(root: string, run: number): Promise<{ done: string[]; left: string[] }>;
  applyAbort(root: string, run: number): Promise<void>;
  push(input: PushInput): Promise<{ head: string; tree: string }>;
  mark(input: MarkInput): Promise<void>;
  asideList(root: string): Promise<AsideRun[]>;
  asideRead(root: string, run: number, side: 'hier' | 'dort', path: string): Promise<string>;
  asidePut(root: string, paths: string[], reason: AsideReason): Promise<{ run: number }>;
  asideDrop(root: string, run: number): Promise<void>;
}

/** Die installierte App: die Befehle der Rust-Seite. */
export const desktopPort: SyncPort = {
  state: syncState,
  setKey: syncSetKey,
  clearKey: syncClearKey,
  probe: syncProbe,
  link: syncLink,
  recover: syncRecover,
  scan: syncScan,
  fetch: syncFetch,
  applyBegin: syncApplyBegin,
  applyEnd: syncApplyEnd,
  applyAbort: syncApplyAbort,
  push: syncPush,
  mark: syncMark,
  asideList: syncAsideList,
  asideRead: syncAsideRead,
  asidePut: syncAsidePut,
  asideDrop: syncAsideDrop,
};
