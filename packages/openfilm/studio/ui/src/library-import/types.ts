/** Desktop-owned library work. Jobs survive closing Settings and reopening the app. */
export type LibraryImportSnapshot = {
  agent: string;
  options: Record<string, string | number | boolean>;
};

export interface LibraryImportItem {
  id: string;
  relativePath: string;
  status: 'queued' | 'copied' | 'running' | 'succeeded' | 'failed' | 'skipped';
  attempt?: number;
  error?: string | null;
  skipReason?: string | null;
  metadata?: { title?: string; description?: string; tags?: string[] } | null;
}

export interface LibraryImportLog {
  seq: number;
  time: number | string;
  message: string;
}

export interface LibraryImportJob {
  id: string;
  name: string;
  sourceRoot: string;
  status: 'importing' | 'queued' | 'running' | 'succeeded' | 'failed';
  snapshot: LibraryImportSnapshot;
  items: LibraryImportItem[];
  logs: LibraryImportLog[];
  error?: string | null;
  createdAt: number | string;
  updatedAt: number | string;
  retryableSkipped?: number;
}

/** Selection and folder picking are resolved by the desktop host at the moment import starts. */
export interface LibraryImportHost {
  pickAndImport(): Promise<LibraryImportJob | null>;
  listJobs(): Promise<LibraryImportJob[]>;
  retryFailed(id: string): Promise<LibraryImportJob>;
  onChange(listener: (job: LibraryImportJob) => void): () => void;
}
