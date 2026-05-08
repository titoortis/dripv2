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
 * Capability vocabulary. PR 5 adds these as the forward-friendly seam the PR 6
 * quality picker will read; submit-time still uses the preset's `resolution` /
 * `durationSec` baseline. Listed values are the locked product surface
 * (480p / 720p / 1080p × 5s / 10s / 15s); narrowing per preset is allowed.
 */
export type PresetResolution = "480p" | "720p" | "1080p";
export type PresetDuration = 5 | 10 | 15;

export type PresetSeed = {
  id: string;
  title: string;
  subtitle?: string;
  thumbnailUrl?: string;
  promptTemplate: string;
  aspectRatio: "9:16" | "16:9" | "1:1" | "adaptive";
  durationSec: PresetDuration;
  resolution: PresetResolution;
  /**
   * Resolutions this preset advertises support for, including the baseline
   * `resolution`. PR 5 stores this as a CSV string in SQLite; client
   * receives the parsed array via `/api/presets`. Display-only until PR 6.
   * Defaults to `[resolution]` when omitted.
   */
  supportedResolutions?: PresetResolution[];
  /**
   * Same shape as `supportedResolutions`, but for video duration. Defaults
   * to `[durationSec]` when omitted.
   */
  supportedDurations?: PresetDuration[];
  generateAudio?: boolean;
  motionNotes?: string;
  modelId?: string;
  isActive?: boolean;
  sortOrder: number;
};

const DEFAULT_MODEL = "dreamina-seedance-2-0-260128";

// Locked product surface (see GELOAGENT.md). Every PR 5 platform preset
// advertises the full grid; PR 6 will enforce per-quality multipliers and
// gate combos that aren't live-verified against the provider.
const FULL_RESOLUTIONS: PresetResolution[] = ["480p", "720p", "1080p"];
const FULL_DURATIONS: PresetDuration[] = [5, 10, 15];

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
    supportedResolutions: FULL_RESOLUTIONS,
    supportedDurations: FULL_DURATIONS,
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
    supportedResolutions: FULL_RESOLUTIONS,
    supportedDurations: FULL_DURATIONS,
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
    supportedResolutions: FULL_RESOLUTIONS,
    supportedDurations: FULL_DURATIONS,
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
    supportedResolutions: FULL_RESOLUTIONS,
    supportedDurations: FULL_DURATIONS,
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
    supportedResolutions: FULL_RESOLUTIONS,
    supportedDurations: FULL_DURATIONS,
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
    supportedResolutions: FULL_RESOLUTIONS,
    supportedDurations: FULL_DURATIONS,
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
    supportedResolutions: FULL_RESOLUTIONS,
    supportedDurations: FULL_DURATIONS,
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
    supportedResolutions: FULL_RESOLUTIONS,
    supportedDurations: FULL_DURATIONS,
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
    supportedResolutions: FULL_RESOLUTIONS,
    supportedDurations: FULL_DURATIONS,
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
    supportedResolutions: FULL_RESOLUTIONS,
    supportedDurations: FULL_DURATIONS,
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
    supportedResolutions: FULL_RESOLUTIONS,
    supportedDurations: FULL_DURATIONS,
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
    supportedResolutions: FULL_RESOLUTIONS,
    supportedDurations: FULL_DURATIONS,
    motionNotes: "dolly in, hard beam",
    sortOrder: 120,
  },
];

export function activePresets(): PresetSeed[] {
  return PRESETS.filter((p) => p.isActive !== false).sort((a, b) => a.sortOrder - b.sortOrder);
}

export const SEEDANCE_DEFAULT_MODEL = DEFAULT_MODEL;
