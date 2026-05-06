import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../env";
import type { StorageAdapter, StoredObject } from "./types";

export class S3Storage implements StorageAdapter {
  private client: S3Client;
  private bucket: string;
  private base: string;

  constructor() {
    const e = env();
    if (!e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) {
      throw new Error(
        "S3 storage selected but S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not set",
      );
    }
    this.client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: e.S3_ACCESS_KEY_ID,
        secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      },
    });
    this.bucket = e.S3_BUCKET;
    this.base = (e.S3_PUBLIC_BASE_URL || `${e.S3_ENDPOINT}/${e.S3_BUCKET}`).replace(/\/$/, "");
  }

  async put(opts: {
    key: string;
    body: Buffer | Uint8Array;
    contentType: string;
  }): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: opts.key,
        Body: opts.body,
        ContentType: opts.contentType,
      }),
    );
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
