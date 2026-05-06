import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "../env";
import type { StorageAdapter, StoredObject } from "./types";

export class LocalStorage implements StorageAdapter {
  private root: string;
  private base: string;

  constructor() {
    this.root = path.resolve(env().STORAGE_LOCAL_DIR);
    this.base = env().STORAGE_PUBLIC_BASE_URL.replace(/\/$/, "");
  }

  async put(opts: {
    key: string;
    body: Buffer | Uint8Array;
    contentType: string;
  }): Promise<StoredObject> {
    const target = path.join(this.root, opts.key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, opts.body);
    const bytes = (opts.body as Buffer).byteLength;
    return {
      storageKey: opts.key,
      publicUrl: this.publicUrlFor(opts.key),
      bytes,
      contentType: opts.contentType,
    };
  }

  publicUrlFor(key: string): string {
    return `${this.base}/${key.replace(/^\/+/, "")}`;
  }
}
