export type StoredObject = {
  storageKey: string;
  publicUrl: string;
  bytes: number;
  contentType: string;
};

export interface StorageAdapter {
  /** Persist raw bytes. Returns a stable key + a publicly-fetchable URL. */
  put(opts: {
    key: string;
    body: Buffer | Uint8Array;
    contentType: string;
  }): Promise<StoredObject>;

  /** Build the public URL for a key without writing anything. */
  publicUrlFor(key: string): string;
}
