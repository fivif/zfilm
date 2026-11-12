import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeImportJobs, importCounts } from './state.ts';
import type { LibraryImportJob } from './types.ts';

function job(id: string, updatedAt: number): LibraryImportJob {
  return { id, name: id, sourceRoot: '/media', status: 'running', snapshot: { agent: 'codex', options: { model: 'selected-model' } }, items: [], logs: [], createdAt: updatedAt, updatedAt };
}

test('an initial saved list arriving after a progress event cannot erase that progress', () => {
  const fresh = { ...job('first', 40), items: [{ id: 'a', relativePath: 'a.mp4', status: 'succeeded' as const }] };
  const merged = mergeImportJobs([fresh], [job('first', 10), job('older', 5)]);
  assert.equal(merged[0], fresh);
  assert.equal(merged[0].items[0].status, 'succeeded');
  assert.deepEqual(merged.map(row => row.id), ['first', 'older']);
  const sameMillisecond = mergeImportJobs([fresh], [job('first', 40)], false);
  assert.equal(sameMillisecond[0], fresh);
});

test('retry updates one job without losing another folder or counting queued failures as complete', () => {
  const other = job('other', 20);
  const failed = { ...job('retry', 10), status: 'failed' as const, items: [
    { id: 'a', relativePath: 'a.mp4', status: 'succeeded' as const },
    { id: 'b', relativePath: 'b.mp4', status: 'failed' as const },
    { id: 'c', relativePath: 'c.txt', status: 'skipped' as const },
  ] };
  assert.deepEqual(importCounts(failed), { total: 3, succeeded: 1, failed: 1, skipped: 1, settled: 3 });
  const retry = { ...failed, status: 'running' as const, updatedAt: 30, items: failed.items.map(item => item.id === 'b' ? { ...item, status: 'queued' as const } : item) };
  const merged = mergeImportJobs([other, failed], [retry]);
  assert.equal(merged.find(row => row.id === 'other'), other);
  assert.deepEqual(importCounts(merged.find(row => row.id === 'retry')!), { total: 3, succeeded: 1, failed: 0, skipped: 1, settled: 2 });
  assert.equal(merged.find(row => row.id === 'retry')?.snapshot.options.model, 'selected-model');
});
