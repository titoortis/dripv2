/**
 * Preset source-of-truth.
 *
 * Edit this file to add, remove, retitle, or rewrite presets and their
 * internal prompt templates. The `pnpm db:seed` script syncs every preset
 * here into the database (upsert by id). Existing rows are updated; rows
 * with ids no longer listed here are marked inactive.
 *
 * Prompt templates here are intentionally generic placeholders so they can
 * be replaced with the operator's own copy without UI changes.
 */

/**
 * Capability vocabulary. The locked product surface is
 * 480p / 720p / 1080p × 5s / 10s / 15s. Per-preset narrowing is the norm —
 * a preset's identity is its prompt + composition, and the durations /
 * qualities the picker is allowed to expose for it are part of that
 * identity. PR #23 makes this explicit at authoring time via
 * `lockedDurationSec` / `allowedQualities` / `allowedAspectRatios`.
 */
export type PresetResolution = "480p" | "720p" | "1080p";
export type PresetDuration = 5 | 10 | 15;
export type PresetAspectRatio = "9:16" | "16:9" | "1:1" | "adaptive";

export type PresetSeed = {
  id: string;
  title: string;
  subtitle?: string;
  thumbnailUrl?: string;
  promptTemplate: string;
  /** Baseline aspect ratio. The runner submits this exact value to the
   *  provider. Aspect-ratio choice is currently always preset-defined;
   *  if a future preset wants to expose multiple aspect ratios, populate
   *  `allowedAspectRatios` and the picker will surface a row. */
  aspectRatio: PresetAspectRatio;
  /** Baseline duration. The runner submits this exact value when the user
   *  doesn't override (and they cannot override if `lockedDurationSec` is
   *  set). */
  durationSec: PresetDuration;
  /** Baseline render resolution. */
  resolution: PresetResolution;

  // PR #23 preset-first contract. These authoring-time fields are the
  // source-of-truth for what the picker is allowed to expose. They
  // translate into the existing storage columns (`supportedResolutions`,
  // `supportedDurations`, `aspectRatio`) via `resolvePresetCapabilities`
  // + `prisma/seed.ts`, so no schema migration is needed.

  /** Qualities the picker is allowed to expose for this preset. Defaults
   *  to `[resolution]` (i.e. baseline only). A single-element list yields
   *  the truthful "no choice — quality is preset-defined" UI; the API
   *  derives `qualityLabel` from the single value. */
  allowedQualities?: PresetResolution[];
  /** When set, duration is fixed by the preset's concept — the UI never
   *  renders a Length picker. The canonical way to express "this preset
   *  is a 5-second beat, period." When omitted, the preset inherits
   *  whatever durations the picker derives from `allowedDurations`. */
  lockedDurationSec?: PresetDuration;
  /** Durations the picker is allowed to expose *if no lock is set*.
   *  Defaults to `[durationSec]`. Mutually exclusive with
   *  `lockedDurationSec` in spirit (if a lock is set this field is
   *  ignored). */
  allowedDurations?: PresetDuration[];
  /** Aspect ratios the picker is allowed to expose. Defaults to
   *  `[aspectRatio]`. Today every preset is locked to its baseline
   *  aspect; future presets that want a 16:9 alt would list both. */
  allowedAspectRatios?: PresetAspectRatio[];

  /** Optional UI labels. Defaults derive from the values themselves
   *  (`"5s"`, `"720p"`, `"9:16"`). Provide an override only when the
   *  default reads as a developer string. */
  durationLabel?: string;
  qualityLabel?: string;
  aspectLabel?: string;

  /** @deprecated alias for `allowedQualities`. Older seed entries used
   *  this name. Kept here so any partner / fork that still authors this
   *  field continues to work; new entries should use `allowedQualities`. */
  supportedResolutions?: PresetResolution[];
  /** @deprecated alias for `allowedDurations` (or `[lockedDurationSec]`
   *  when locking). Same back-compat reasoning. */
  supportedDurations?: PresetDuration[];

  generateAudio?: boolean;
  motionNotes?: string;
  modelId?: string;
  isActive?: boolean;
  sortOrder: number;
};

const DEFAULT_MODEL = "dreamina-seedance-2-0-260128";

/**
 * Single source of truth for the resolved capability set of a preset.
 *
 * Used by `prisma/seed.ts` (writes the resolved set into the DB), by
 * `presets-static.ts` (renders the same set into `PresetSummary` for
 * marketing-mode static fallback), and by `/api/presets/route.ts` (which
 * reads from the DB but applies the same default-derivation rules to
 * preserve symmetry between the static and live wire formats).
 *
 * Rules:
 *  - `allowedQualities` defaults to `supportedResolutions` (back-compat)
 *    or `[resolution]`.
 *  - When `lockedDurationSec` is set, it's the only allowed duration —
 *    `allowedDurations` / `supportedDurations` are ignored.
 *  - `allowedAspectRatios` defaults to `[aspectRatio]`.
 *  - Display labels default to the value strings (`"5s"`, `"720p"`,
 *    `"9:16"`); the "preset-defined" suffix is added by the UI, not
 *    here, so labels stay machine-readable.
 *
 * "Locked" is a UI signal — the server gate at `/api/jobs` enforces the
 * same lock by checking `supportedDurations` / `supportedResolutions`,
 * which the seed populated from these resolved values.
 */
export type ResolvedCapabilities = {
  allowedQualities: PresetResolution[];
  allowedDurations: PresetDuration[];
  allowedAspectRatios: PresetAspectRatio[];
  lockedDurationSec: PresetDuration | null;
  qualityLocked: boolean;
  aspectLocked: boolean;
  durationLabel: string;
  qualityLabel: string;
  aspectLabel: string;
};

export function resolvePresetCapabilities(p: PresetSeed): ResolvedCapabilities {
  const allowedQualities = dedupe(
    p.allowedQualities ?? p.supportedResolutions ?? [p.resolution],
  );
  const lockedDurationSec = p.lockedDurationSec ?? null;
  const allowedDurations = dedupe(
    lockedDurationSec !== null
      ? [lockedDurationSec]
      : p.allowedDurations ?? p.supportedDurations ?? [p.durationSec],
  );
  const allowedAspectRatios = dedupe(p.allowedAspectRatios ?? [p.aspectRatio]);

  const qualityLocked = allowedQualities.length === 1;
  const aspectLocked = allowedAspectRatios.length === 1;

  const durationLabel =
    p.durationLabel ?? `${lockedDurationSec ?? allowedDurations[0] ?? p.durationSec}s`;
  const qualityLabel =
    p.qualityLabel ?? (qualityLocked ? allowedQualities[0] : "Multiple");
  const aspectLabel =
    p.aspectLabel ?? (aspectLocked ? allowedAspectRatios[0] : "Multiple");

  return {
    allowedQualities,
    allowedDurations,
    allowedAspectRatios,
    lockedDurationSec,
    qualityLocked,
    aspectLocked,
    durationLabel,
    qualityLabel,
    aspectLabel,
  };
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export const PRESETS: PresetSeed[] = [
  {
    id: "iron_hero_v1",
    title: "Iron Hero",
    subtitle: "Suit-up. Heroic stance.",
    promptTemplate:
      "Cinematic image-to-video of the subject in the photo suiting up as a sleek, modern superhero. Reveal a high-tech armor over their existing outfit, light reflections on metal, slow heroic camera push-in, faint particle effects, dramatic key light. No facial morphing — keep identity, hairstyle, and proportions consistent with the photo.",
    aspectRatio: "9:16",
    durationSec: 5,
    resolution: "720p",
    allowedQualities: ["720p"],
    lockedDurationSec: 5,
    allowedAspectRatios: ["9:16"],
    motionNotes: "slow push-in, key light, particle accents",
    sortOrder: 10,
  },
  {
    id: "fight_club_v1",
    title: "Fight Club",
    subtitle: "Slow-mo combat.",
    promptTemplate:
      "Cinematic image-to-video of the subject in the photo in a moody warehouse, slow-motion combat stance, dust particles in the air, hard rim light from above, shallow depth of field. Maintain the subject's identity from the photo.",
    aspectRatio: "9:16",
    durationSec: 5,
    resolution: "720p",
    allowedQualities: ["720p"],
    lockedDurationSec: 5,
    allowedAspectRatios: ["9:16"],
    motionNotes: "slow-mo, rim light, warehouse",
    sortOrder: 20,
  },
  {
    id: "hyperspeed_tunnel_v1",
    title: "Hyperspeed",
    subtitle: "Time-warp dive.",
    promptTemplate:
      "Cinematic image-to-video of the subject from the photo flying through a hyperspeed light tunnel, radial motion blur, neon trails streaming past, deep focus center, cinematic anamorphic feel. Keep identity from the photo.",
    aspectRatio: "9:16",
    durationSec: 5,
    resolution: "720p",
    allowedQualities: ["720p"],
    lockedDurationSec: 5,
    allowedAspectRatios: ["9:16"],
    motionNotes: "radial motion blur, neon streaks",
    sortOrder: 30,
  },
  {
    id: "wind_blast_v1",
    title: "Wind Blast",
    subtitle: "Hair-tossed close-up.",
    promptTemplate:
      "Cinematic close-up image-to-video of the subject from the photo facing into a strong wind. Hair and clothing flow back, low golden light, subtle dust drifting, slow head turn. Identity preserved from the photo.",
    aspectRatio: "9:16",
    durationSec: 5,
    resolution: "720p",
    allowedQualities: ["720p"],
    lockedDurationSec: 5,
    allowedAspectRatios: ["9:16"],
    motionNotes: "wind, golden hour, slow turn",
    sortOrder: 40,
  },
  {
    id: "earth_orbit_v1",
    title: "Orbit",
    subtitle: "View from low orbit.",
    promptTemplate:
      "Cinematic image-to-video that opens on the subject from the photo and pulls back through clouds into low Earth orbit. Reveal continents and the curvature of the planet under soft sunrise light. Photo-real, subtle stars, no UI overlays. Identity preserved.",
    aspectRatio: "9:16",
    durationSec: 5,
    resolution: "720p",
    allowedQualities: ["720p"],
    lockedDurationSec: 5,
    allowedAspectRatios: ["9:16"],
    motionNotes: "vertical pull-back, atmospheric",
    sortOrder: 50,
  },
  {
    id: "lavender_field_v1",
    title: "Lavender Field",
    subtitle: "Calm walk at golden hour.",
    promptTemplate:
      "Cinematic image-to-video of the subject from the photo walking slowly through a lavender field at golden hour. Soft warm light, gentle wind on stems, slight handheld camera, shallow depth of field. Keep identity from the photo.",
    aspectRatio: "9:16",
    durationSec: 5,
    resolution: "720p",
    allowedQualities: ["720p"],
    lockedDurationSec: 5,
    allowedAspectRatios: ["9:16"],
    motionNotes: "handheld, golden hour, soft",
    sortOrder: 60,
  },
  {
    id: "portal_step_v1",
    title: "Portal",
    subtitle: "Step through a doorway.",
    promptTemplate:
      "Cinematic image-to-video of a swirling blue energy portal opening in front of the subject from the photo. The subject takes one calm step forward. Light from the portal washes over their face, particles drift outward. Identity preserved.",
    aspectRatio: "9:16",
    durationSec: 5,
    resolution: "720p",
    allowedQualities: ["720p"],
    lockedDurationSec: 5,
    allowedAspectRatios: ["9:16"],
    motionNotes: "VFX portal, energy wash",
    sortOrder: 70,
  },
  {
    id: "wings_v1",
    title: "Wings",
    subtitle: "Mythic feathered reveal.",
    promptTemplate:
      "Cinematic image-to-video where large feathered wings unfurl behind the subject from the photo. Soft volumetric light, slow lift of feathers, ambient mist. No facial morphing — keep the subject's face, hairstyle, and proportions consistent with the photo.",
    aspectRatio: "9:16",
    durationSec: 5,
    resolution: "720p",
    allowedQualities: ["720p"],
    lockedDurationSec: 5,
    allowedAspectRatios: ["9:16"],
    motionNotes: "wing reveal, volumetrics",
    sortOrder: 80,
  },
  {
    id: "freerunner_v1",
    title: "Freerunner",
    subtitle: "Rooftop jump.",
    promptTemplate:
      "Cinematic image-to-video of the subject from the photo running and leaping across a steel rooftop bridge at dusk, low contrast urban background, slight camera follow, motion blur on limbs only. Identity preserved.",
    aspectRatio: "9:16",
    durationSec: 5,
    resolution: "720p",
    allowedQualities: ["720p"],
    lockedDurationSec: 5,
    allowedAspectRatios: ["9:16"],
    motionNotes: "follow cam, dusk",
    sortOrder: 90,
  },
  {
    id: "smoke_sprint_v1",
    title: "Smoke Sprint",
    subtitle: "Charge through smoke.",
    promptTemplate:
      "Cinematic image-to-video of the subject from the photo sprinting forward through a wall of dense smoke, hard rim light from behind, dust kicking up, low-angle camera. Identity preserved from the photo.",
    aspectRatio: "9:16",
    durationSec: 5,
    resolution: "720p",
    allowedQualities: ["720p"],
    lockedDurationSec: 5,
    allowedAspectRatios: ["9:16"],
    motionNotes: "low angle, smoke, rim light",
    sortOrder: 100,
  },
  {
    id: "ocean_storm_v1",
    title: "Open Sea",
    subtitle: "Sail into a storm.",
    promptTemplate:
      "Cinematic image-to-video where the subject from the photo stands on the bow of a small sailboat heading into open ocean, soft chop, distant rain front, gulls high overhead. Subtle handheld camera. Identity preserved.",
    aspectRatio: "9:16",
    durationSec: 5,
    resolution: "720p",
    allowedQualities: ["720p"],
    lockedDurationSec: 5,
    allowedAspectRatios: ["9:16"],
    motionNotes: "marine, handheld",
    sortOrder: 110,
  },
  {
    id: "ray_of_light_v1",
    title: "Ray of Light",
    subtitle: "Cathedral beam.",
    promptTemplate:
      "Cinematic image-to-video of the subject from the photo standing in a stone cathedral, a single hard beam of light pierces from a high window, dust suspended in air, slow camera dolly forward. Identity preserved.",
    aspectRatio: "9:16",
    durationSec: 5,
    resolution: "720p",
    allowedQualities: ["720p"],
    lockedDurationSec: 5,
    allowedAspectRatios: ["9:16"],
    motionNotes: "dolly in, hard beam",
    sortOrder: 120,
  },
];

export function activePresets(): PresetSeed[] {
  return PRESETS.filter((p) => p.isActive !== false).sort((a, b) => a.sortOrder - b.sortOrder);
}

export const SEEDANCE_DEFAULT_MODEL = DEFAULT_MODEL;
