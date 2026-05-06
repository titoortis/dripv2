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

  const queued = await prisma.generationJob.findMany({
    where: { status: "queued" },
    take: 5,
    orderBy: { createdAt: "asc" },
  });
  for (const job of queued) {
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

  const due = await prisma.generationJob.findMany({
    where: {
      status: { in: ["submitted", "processing"] },
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }],
    },
    take: 50,
  });
  for (const j of due) await pollOnce(j.id);

  return { submitted: queued.length, polled: due.length };
}
