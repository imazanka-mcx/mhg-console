import { MHG_BRANDS } from '@mcx/inn-code';

import { NewPropertyForm } from './new-property-form.tsx';

export const dynamic = 'force-dynamic';

export default function NewPropertyPage() {
  // The closed brand table (B1) is the library's, not a copy kept here — one
  // table, or the flag on the door stops meaning one thing.
  const brands = MHG_BRANDS.filter((b) => !b.retired).map((b) => ({
    code: b.code,
    name: b.name,
  }));
  return <NewPropertyForm brands={brands} />;
}
