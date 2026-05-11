import { env } from "../env";
import { prisma } from "../prisma";
import { pollOnce, submitJob } from "./runner";

let started = false;
let timer: NodeJS.Timeout | null = null;

const TICK_MS = 2_000;

export function startPoller() {
  if (started) return;
  if (env().DISABLE_POLLER) return;
  started = true;

  const tick = async () => {
    try {
      await tickOnce();
    } catch (err) {
      // never let the poller die
      console.error("[poller] tick error", err);
    } finally {
      timer = setTimeout(tick, TICK_MS);
    }
  };
  timer = setTimeout(tick, TICK_MS);
}

export function stopPoller() {
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

async function tickOnce() {
  const now = new Date();

  // PR #29: include `provisioning` in the submit pool. Jobs sitting in
  // `provisioning` need `submitJob` to re-run — it checks the provider
  // asset status and either keeps waiting, fails the job, or transitions
  // onward to `uploading` → `submitted`. We respect `nextPollAt` for the
  // provisioning case so we don't hammer the provider Files API on every
  // 2-second tick.
  const queued = await prisma.generationJob.findMany({
    where: { status: "queued" },
    take: 5,
    orderBy: { createdAt: "asc" },
  });
  for (const job of queued) {
    await submitJob({ jobId: job.id });
  }

  const provisioning = await prisma.generationJob.findMany({
    where: {
      status: "provisioning",
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }],
    },
    take: 5,
    orderBy: { nextPollAt: "asc" },
  });
  for (const job of provisioning) {
    await submitJob({ jobId: job.id });
  }

  const due = await prisma.generationJob.findMany({
    where: {
      status: { in: ["submitted", "processing"] },
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }],
    },
    take: 10,
    orderBy: { nextPollAt: "asc" },
  });
  for (const job of due) {
    await pollOnce(job.id);
  }
}

/** Cron-style external entrypoint. Returns how many rows it touched. */
export async function tickFromCron(): Promise<{ submitted: number; polled: number }> {
  const now = new Date();
  const queued = await prisma.generationJob.findMany({
    where: { status: "queued" },
    take: 20,
  });
  for (const j of queued) await submitJob({ jobId: j.id });

  // PR #29 — advance any provisioning jobs whose nextPollAt has elapsed.
  // Counted under `submitted` so the existing return shape stays stable.
  const provisioning = await prisma.generationJob.findMany({
    where: {
      status: "provisioning",
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }],
    },
    take: 20,
  });
  for (const j of provisioning) await submitJob({ jobId: j.id });

  const due = await prisma.generationJob.findMany({
    where: {
      status: { in: ["submitted", "processing"] },
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }],
    },
    take: 50,
  });
  for (const j of due) await pollOnce(j.id);

  return { submitted: queued.length + provisioning.length, polled: due.length };
}
