// Next.js calls this once per server process. We use it to start the
// in-process job poller. Disable with DISABLE_POLLER=true.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPoller } = await import("./src/lib/server/jobs/poller");
    startPoller();
  }
}
