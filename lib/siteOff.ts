import type { PrismaClient } from "@prisma/client";

export const SITE_OFF_KEY = "site_off";

// Maintenance-mode flag: when on, only admins can use the site.
export async function isSiteOff(prisma: PrismaClient): Promise<boolean> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: SITE_OFF_KEY } });
    return row?.value === "1";
  } catch {
    return false; // never brick the site if the settings table is unreachable
  }
}

export async function setSiteOff(prisma: PrismaClient, off: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: SITE_OFF_KEY },
    update: { value: off ? "1" : "0" },
    create: { key: SITE_OFF_KEY, value: off ? "1" : "0" },
  });
}
