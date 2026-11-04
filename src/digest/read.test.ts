import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readNight } from './read.js';

const row = (job: string) => readNight('runs', '2026-10-28')?.rows.find((r) => r.job === job);

describe('readNight', () => {
  it('reads 2026-10-28 into one row per job, sorted, with the truncated line counted', () => {
    const night = readNight('runs', '2026-10-28');
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night?.badLines).toBe(1);
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('keeps retries, last status, last error and owner per job', () => {
    expect(row('fixtures/refresh')).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503' });
    expect(row('notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded', owner: 'lane-07' });
    expect(row('digest/render')?.owner).toBeNull();
    expect(row('digest/render')?.lastError).toBeNull();
  });

  it('keeps the offset from the log', () => {
    expect(row('lane/sync')).toMatchObject({
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });

  it('answers null for a night with no file or an invalid night', () => {
    expect(readNight('runs', '1999-01-01')).toBeNull();
    expect(readNight('runs', '../x')).toBeNull();
  });

  it('reads an empty file as a night with no rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
    writeFileSync(join(dir, '2026-11-01.jsonl'), '');
    expect(readNight(dir, '2026-11-01')).toEqual({
      night: '2026-11-01',
      rows: [],
      counts: { ok: 0, retry: 0, fail: 0 },
      badLines: 0,
    });
  });
});
