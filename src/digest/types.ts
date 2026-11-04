// Plan morning-digest § 1. The contract every part of § 2 builds against: the page, the JSON,
// the board link and the route tests all read a night through `readNight`.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, once parsed.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job for the night. Times keep the offset from the log, never converted to UTC.
export type DigestRow = {
  job: string;
  owner: string | null; // null renders as "—"
  runs: number; // lines for this job
  retries: number; // lines with status "retry"
  lastStatus: RunStatus;
  lastError: string | null; // error of the last line that had one; null renders as "—"
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job
  counts: Record<RunStatus, number>; // log lines by status
  badLines: number; // lines that didn't parse or didn't match RunLine; counted, never thrown
};

// null: no file for that night (the routes answer 404). An empty file is a Night with no rows.
export type ReadNight = (runsDir: string, night: string) => Night | null;

export const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
