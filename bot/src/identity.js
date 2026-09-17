'use strict';
// Discord user -> conquizta-bore User row.
//
// GAP (documented, not yet migrated): prisma/schema.prisma has no discordId column,
// so we match on displayName (unique, VarChar(32)) and create the row on first play.
// Once a `discordId String? @unique` migration lands, the lookup below becomes exact
// and renames stop mattering.
function sanitize(name) {
  const base = String(name || 'jucator').replace(/[\s]+/g, ' ').trim().slice(0, 32);
  return base.length ? base : 'jucator';
}

async function resolveUser(prisma, { discordId, username, displayName }) {
  const wanted = sanitize(displayName || username);
  const byName = await prisma.user.findUnique({ where: { displayName: wanted }, select: { id: true, displayName: true } });
  if (byName) return { ...byName, created: false };

  // displayName is unique -> on a clash add a short suffix from the discord id
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? wanted : `${wanted.slice(0, 28)}_${String(discordId).slice(-attempt - 1)}`;
    const taken = await prisma.user.findUnique({ where: { displayName: candidate }, select: { id: true } });
    if (taken) continue;
    try {
      const created = await prisma.user.create({ data: { displayName: candidate }, select: { id: true, displayName: true } });
      return { ...created, created: true };
    } catch (e) {
      if (e.code !== 'P2002') throw e; // unique clash -> try the next suffix
    }
  }
  return null;
}

module.exports = { resolveUser, sanitize };
