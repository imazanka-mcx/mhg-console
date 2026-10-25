import { redirect } from 'next/navigation';

// New Property moved into a "+ New property" dialog on Portfolio. The route
// stays so old links and bookmarks still land somewhere useful.
export default function NewPropertyPage() {
  redirect('/portfolio');
}
