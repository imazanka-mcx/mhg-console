import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'MHG Corporate Console',
  description: 'The registry plane — properties, groups, people and the Inn Code Standard.',
};

/** Chrome lives in the (console) group, so /login renders without it. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
