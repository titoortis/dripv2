import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "dripv2_sid";
const ONE_YEAR_S = 60 * 60 * 24 * 365;

export function getOrCreateSessionId(): string {
  const jar = cookies();
  const existing = jar.get(COOKIE_NAME)?.value;
  if (existing) return existing;
  const sid = randomUUID();
  jar.set({
    name: COOKIE_NAME,
    value: sid,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_S,
  });
  return sid;
}

export function getSessionId(): string | null {
  return cookies().get(COOKIE_NAME)?.value ?? null;
}
