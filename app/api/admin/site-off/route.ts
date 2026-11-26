import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isError, requireAdmin } from "@/lib/admin";
import { isSiteOff, setSiteOff } from "@/lib/siteOff";

// POST /api/admin/site-off — toggle maintenance mode:
// when OFF is on, only admins can see the site; everyone else gets a 503/off page.
export async function POST() {
  const auth = await requireAdmin();
  if (isError(auth)) return auth;

  const off = !(await isSiteOff(prisma));
  await setSiteOff(prisma, off);
  return NextResponse.json({ off });
}
