/**
 * Where a hotel is stood up (docs/01 §3, §4 step 7).
 *
 * Standing a hotel up builds its PMS — opening business date, tax rules, the
 * starter pack — none of which this app holds or ever will (§1.3). So the build
 * runs in Inspire, from its registry mirror, and this app only links there. The
 * link is derived from Inspire's own shell subscription, so it follows Inspire
 * wherever it is deployed and needs no setting of its own.
 */

/** Inspire's path for standing a registry property up, by the registry's property id. */
export const INSPIRE_STAND_UP_PATH = '/admin/stand-up/new';

/**
 * Inspire's stand-up page for `propertyId`, from the URL Inspire is subscribed
 * at (…/api/registry/v1/shell). Null when that URL does not parse.
 */
export function standUpUrl(subscriberUrl: string, propertyId: string): string | null {
  let origin: string;
  try {
    origin = new URL(subscriberUrl).origin;
  } catch {
    return null;
  }
  if (origin === 'null') return null;
  return `${origin}${INSPIRE_STAND_UP_PATH}?registry=${encodeURIComponent(propertyId)}`;
}
