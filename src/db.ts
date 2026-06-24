// Database schema and setup for local MVP
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';

const DB_PATH = process.env.DATA_DIR ? `${process.env.DATA_DIR}/jobs.db` : 'jobs.db';
if (process.env.DATA_DIR) mkdirSync(process.env.DATA_DIR, { recursive: true });
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    name_input TEXT,
    city_input TEXT,
    preview_base64 TEXT,
    unwatermarked_base64 TEXT,
    output_url TEXT,
    stripe_session_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS consent_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT,
    age_confirmed BOOLEAN,
    ownership_confirmed BOOLEAN,
    privacy_accepted BOOLEAN,
    ip_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Additive migrations (fail silently if columns already exist)
try { db.exec('ALTER TABLE jobs ADD COLUMN bg_layer_b64 TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE jobs ADD COLUMN frame_layer_b64 TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE jobs ADD COLUMN portrait_layer_b64 TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE jobs ADD COLUMN text_layer_b64 TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE jobs ADD COLUMN video_b64 TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE jobs ADD COLUMN player_number INTEGER;'); } catch (e) {}
try { db.exec('ALTER TABLE jobs ADD COLUMN platform TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE jobs ADD COLUMN district TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE jobs ADD COLUMN public_id TEXT;'); } catch (e) {}
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_public_id ON jobs(public_id) WHERE public_id IS NOT NULL;'); } catch (e) {}

export interface Job {
  id: string;
  status: string;
  name_input: string | null;
  city_input: string | null;
  preview_base64: string | null;
  unwatermarked_base64: string | null;
  bg_layer_b64: string | null;
  frame_layer_b64: string | null;
  portrait_layer_b64: string | null;
  text_layer_b64: string | null;
  video_b64: string | null;
  output_url: string | null;
  stripe_session_id: string | null;
  player_number: number | null;
  platform: string | null;
  district: string | null;
  public_id: string | null;
  created_at: string;
}

const DISTRICTS = [
  'SUNRISE COAST', 'NEON QUARTER', 'HARBOR DISTRICT', 'CHROME HEIGHTS',
  'SOUTH BAY', 'AMBER RIDGE', 'THE CAUSEWAY', 'PALM CORRIDOR',
];

function randomDistrict(): string {
  return DISTRICTS[Math.floor(Math.random() * DISTRICTS.length)];
}

// Assigns the next sequential player_number atomically in SQLite
export function createJob(jobId: string, name: string, city: string): number {
  const district = randomDistrict();
  db.prepare(`
    INSERT INTO jobs (id, status, name_input, city_input, district, player_number)
    VALUES (?, 'CREATED', ?, ?, ?, (SELECT COALESCE(MAX(player_number), 0) + 1 FROM jobs))
  `).run(jobId, name, city, district);
  const row = db.prepare('SELECT player_number FROM jobs WHERE id = ?').get(jobId) as { player_number: number };
  return row.player_number;
}

export function updateJobPreview(jobId: string, preview: string, unwatermarked: string) {
  db.prepare('UPDATE jobs SET status = ?, preview_base64 = ?, unwatermarked_base64 = ? WHERE id = ?')
    .run('PREVIEW_READY', preview, unwatermarked, jobId);
}

export function updateJobStatus(jobId: string, status: string, sessionId?: string) {
  if (sessionId) {
    db.prepare('UPDATE jobs SET status = ?, stripe_session_id = ? WHERE id = ?').run(status, sessionId, jobId);
  } else {
    db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, jobId);
  }
}

export function setJobOutput(jobId: string, outputUrl: string) {
  db.prepare('UPDATE jobs SET status = ?, output_url = ? WHERE id = ?').run('DONE', outputUrl, jobId);
}

export function saveJobLayers(jobId: string, bg: string, frame: string, portrait: string, text: string) {
  db.prepare('UPDATE jobs SET bg_layer_b64 = ?, frame_layer_b64 = ?, portrait_layer_b64 = ?, text_layer_b64 = ? WHERE id = ?')
    .run(bg, frame, portrait, text, jobId);
}

export function saveJobVideo(jobId: string, video_b64: string) {
  db.prepare('UPDATE jobs SET video_b64 = ?, status = ?, output_url = ? WHERE id = ?')
    .run(video_b64, 'DONE', `/api/jobs/${jobId}/mp4`, jobId);
}

export function getJob(jobId: string): Job | undefined {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Job | undefined;
}

export function setPublicId(jobId: string, publicId: string): void {
  db.prepare('UPDATE jobs SET public_id = ? WHERE id = ?').run(publicId, jobId);
}

export function getJobByPublicId(publicId: string): Job | undefined {
  return db.prepare('SELECT * FROM jobs WHERE public_id = ?').get(publicId) as Job | undefined;
}

export function getRegistryCount(): { issued: number; remaining: number } {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM jobs WHERE status NOT IN ('FAILED', 'CREATED') AND id != 'demo-card-v7'"
  ).get() as { count: number };
  return { issued: row.count, remaining: Math.max(0, 2000 - row.count) };
}

export interface LeaderboardEntry {
  player_number: number;
  name_input: string;
  city_input: string;
  public_id: string;
  district: string;
}

export function getLeaderboard(limit = 50): LeaderboardEntry[] {
  return db.prepare(`
    SELECT player_number, name_input, city_input, public_id, district
    FROM jobs
    WHERE status = 'DONE' AND public_id IS NOT NULL AND id != 'demo-card-v7'
    ORDER BY player_number ASC
    LIMIT ?
  `).all(limit) as LeaderboardEntry[];
}

export function logConsent(jobId: string, age: boolean, ownership: boolean, privacy: boolean, ipHash: string) {
  db.prepare('INSERT INTO consent_log (job_id, age_confirmed, ownership_confirmed, privacy_accepted, ip_hash) VALUES (?, ?, ?, ?, ?)')
    .run(jobId, age ? 1 : 0, ownership ? 1 : 0, privacy ? 1 : 0, ipHash);
}
