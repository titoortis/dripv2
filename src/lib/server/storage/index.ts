import { env } from "../env";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";
import type { StorageAdapter } from "./types";

let cached: StorageAdapter | null = null;

export function storage(): StorageAdapter {
  if (cached) return cached;
  cached = env().STORAGE_DRIVER === "s3" ? new S3Storage() : new LocalStorage();
  return cached;
}

export type { StorageAdapter, StoredObject } from "./types";
