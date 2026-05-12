import { z } from "zod";

const Schema = z.object({
  ARK_API_KEY: z.string().optional(),
  ARK_BASE_URL: z
    .string()
    .url()
    .default("https://ark.ap-southeast.bytepluses.com/api/v3"),
  ARK_DEFAULT_MODEL_ID: z.string().default("dreamina-seedance-2-0-260128"),

  DATABASE_URL: z.string().default("file:./dev.db"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./public/uploads"),
  STORAGE_PUBLIC_BASE_URL: z.string().default("http://localhost:3000/uploads"),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  S3_PUBLIC_BASE_URL: z.string().optional(),

  APP_PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),

  POLL_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  POLL_MAX_INTERVAL_MS: z.coerce.number().int().positive().default(20000),
  JOB_WALL_CLOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(600000),
  DISABLE_POLLER: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  // Kill switch for the `reference_image` runner path. When false
  // (default), the runner forces every job onto the `first_frame` role
  // regardless of `preset.referenceMode`, so the feature can stay dark
  // until Seedance task bodies with role="reference_image" are
  // live-validated. Mirrors the DISABLE_POLLER / S3_FORCE_PATH_STYLE
  // string-with-transform convention so .env files stay homogeneous.
  PROVIDER_REFERENCE_MODE_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
});

export type AppEnv = z.infer<typeof Schema>;

let cached: AppEnv | null = null;

export function env(): AppEnv {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function hasArkCredentials(): boolean {
  const k = env().ARK_API_KEY;
  return Boolean(k && k.trim().length > 0);
}
