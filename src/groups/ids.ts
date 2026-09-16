/**
 * Group ids (docs/01 §2.2).
 *
 * Its own module, free of Prisma, for the same reason scope.ts and rules.ts
 * are: minting an id is a rule about names, and it should be testable without a
 * database.
 */

/**
 * Mint a group id from its name — `Midwest` → `grp_midwest`.
 *
 * Minted ONCE, at creation, and never recomputed. Grants point at the id, so a
 * group that re-slugged when it was renamed would quietly orphan every grant on
 * it. Same discipline as a property keeping its internal id through a rebrand
 * (G1): the display name is mutable, the thing pointed at is not.
 */
export function slugForGroupName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  if (!slug) throw new Error('A group needs a name with at least one letter or digit in it.');
  return `grp_${slug}`;
}
