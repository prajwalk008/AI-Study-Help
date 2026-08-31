function mbFromEnv(name: string, fallbackMb: number): number {
  const raw = process.env[name];
  const mb = raw ? Number(raw) : fallbackMb;
  return mb * 1024 * 1024;
}

/** Azure B1 defaults (~1.75 GB RAM). Set NEXT_PUBLIC_MAX_PART_MB=1 for Render free. */
export const MAX_PART_BYTES = mbFromEnv("NEXT_PUBLIC_MAX_PART_MB", 5);
export const SPLIT_TARGET_BYTES = Math.floor(MAX_PART_BYTES * 0.9);
export const MAX_FILE_BYTES = mbFromEnv("NEXT_PUBLIC_MAX_FILE_MB", 100);
export const STORAGE_QUOTA_BYTES = mbFromEnv("NEXT_PUBLIC_STORAGE_QUOTA_MB", 100);
export const STALE_PROCESSING_MS = 60 * 60 * 1000;

export function formatPartLimitMb() {
  return Math.round(MAX_PART_BYTES / (1024 * 1024));
}
