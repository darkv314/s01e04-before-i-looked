import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

const NORMAL = '2030-01-01';
const EMPTY = '2030-01-02';
const BAD_LINE = '2030-01-03';
const MISSING = '2030-01-04';

const line = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify(error === undefined ? { at, job, status, owner } : { at, job, status, owner, error });

// zeta-report is written before the others so sorting by job is observable.
const normalNight = [
  line('2030-01-01T01:00:00+01:00', 'zeta-report', 'retry', 'ana'),
  line('2030-01-01T01:05:00+01:00', 'zeta-report', 'retry', 'ana'),
  line('2030-01-01T01:10:00+01:00', 'zeta-report', 'retry', 'ana'),
  line('2030-01-01T01:15:00+01:00', 'zeta-report', 'ok', 'ana'),
  line('2030-01-01T02:00:00+01:00', 'alpha-sync', 'fail', null, 'connection refused'),
  line('2030-01-01T03:00:00+01:00', 'mid-clean', 'ok', 'bo'),
].join('\n') + '\n';

const badLineNight = [
  line('2030-01-03T01:00:00+01:00', 'zeta-report', 'ok', 'ana'),
  '{"at":"2030-01-03T01:05:00+01:00","job":"alpha-sy',
  line('2030-01-03T02:00:00+01:00', 'alpha-sync', 'ok', 'bo'),
].join('\n') + '\n';

let runsDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  process.env.LANE_MARKER = 'TEST-MARKER';
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, `${NORMAL}.jsonl`), normalNight);
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(join(runsDir, `${BAD_LINE}.jsonl`), badLineNight);
  app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

const html = async (night: string) => {
  const res = await app.request(`/digest/${night}`);
  return { res, text: await res.text() };
};

const json = async (night: string) => {
  const res = await app.request(`/api/digest/${night}`);
  return { res, body: (await res.json()) as Night };
};

describe('GET /digest/:night', () => {
  it('renders a night on disk inside the layout', async () => {
    const { res, text } = await html(NORMAL);
    expect(res.status).toBe(200);
    expect(text).toContain('TEST-MARKER');
    for (const job of ['alpha-sync', 'mid-clean', 'zeta-report']) expect(text).toContain(job);
    expect(text).toContain('connection refused');
  });

  it('lists jobs sorted by name', async () => {
    const { text } = await html(NORMAL);
    const at = ['alpha-sync', 'mid-clean', 'zeta-report'].map((job) => text.indexOf(job));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('shows — for a null owner', async () => {
    const { text } = await html(NORMAL);
    expect(text).toContain('—');
  });

  it('flags rows with 3 or more retries or a failed last run, and only those', async () => {
    const { text } = await html(NORMAL);
    const warnRows = text.match(/<tr[^>]*\bwarn\b[^>]*>/g) ?? [];
    expect(warnRows).toHaveLength(2);
    const clean = text.slice(text.indexOf('mid-clean'));
    expect(clean.slice(0, clean.indexOf('</tr>'))).not.toMatch(/\bwarn\b/);
  });

  it('says nothing ran for an empty file', async () => {
    const { res, text } = await html(EMPTY);
    expect(res.status).toBe(200);
    expect(text).toContain('nothing ran');
  });

  it('counts a bad line and still renders the good ones', async () => {
    const { res, text } = await html(BAD_LINE);
    expect(res.status).toBe(200);
    expect(text).toContain("1 line didn't parse");
    expect(text).toContain('alpha-sync');
    expect(text).toContain('zeta-report');
  });

  it('does not mention bad lines when there are none', async () => {
    const { text } = await html(NORMAL);
    expect(text).not.toContain("didn't parse");
  });

  it('answers 404 for a night with no file', async () => {
    const { res } = await html(MISSING);
    expect(res.status).toBe(404);
  });

  it('answers 404 for a night that is not a date', async () => {
    const { res } = await html('not-a-date');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the Night for a night on disk, rows sorted by job', async () => {
    const { res, body } = await json(NORMAL);
    expect(res.status).toBe(200);
    expect(body.night).toBe(NORMAL);
    expect(body.rows.map((r) => r.job)).toEqual(['alpha-sync', 'mid-clean', 'zeta-report']);
    expect(body.counts).toEqual({ ok: 2, retry: 3, fail: 1 });
    expect(body.badLines).toBe(0);
    const zeta = body.rows.find((r) => r.job === 'zeta-report');
    expect(zeta).toMatchObject({ retries: 3, lastStatus: 'ok', owner: 'ana' });
    const alpha = body.rows.find((r) => r.job === 'alpha-sync');
    expect(alpha).toMatchObject({ owner: null, lastStatus: 'fail', lastError: 'connection refused' });
  });

  it('returns no rows for an empty file', async () => {
    const { res, body } = await json(EMPTY);
    expect(res.status).toBe(200);
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('counts a bad line and still returns the good ones', async () => {
    const { res, body } = await json(BAD_LINE);
    expect(res.status).toBe(200);
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['alpha-sync', 'zeta-report']);
  });

  it('answers 404 with an error for a night with no file', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such night' });
  });

  it('answers 404 for a night that is not a date', async () => {
    const res = await app.request('/api/digest/not-a-date');
    expect(res.status).toBe(404);
  });
});

describe('page and JSON agree', () => {
  it.each([NORMAL, BAD_LINE])('lists the same jobs in the same order for %s', async (night) => {
    const { text } = await html(night);
    const { body } = await json(night);
    const cells = [...text.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]?.trim());
    const pageJobs = cells.filter((cell) => body.rows.some((r) => r.job === cell));
    expect(pageJobs).toEqual(body.rows.map((r) => r.job));
  });
});
