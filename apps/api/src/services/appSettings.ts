import { pool } from "../db/client.js";

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const result = await pool.query<{ value: T }>(`SELECT value FROM app_settings WHERE key = $1`, [key]);
  return result.rows.length > 0 ? result.rows[0].value : defaultValue;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

/** Opt-in, default OFF: numbers with enough distinct SCAM reports get an
 * actual CXCallDirectoryExtensionContext blocking entry (call goes straight
 * to voicemail/rejected), not just a warning label. Off by default because
 * auto-blocking is a much stronger action than labeling -- a false-positive
 * report shouldn't silently drop a real call until the owner opts in. */
export async function isAutoBlockHighRiskEnabled(): Promise<boolean> {
  return getSetting<boolean>("auto_block_high_risk", false);
}
