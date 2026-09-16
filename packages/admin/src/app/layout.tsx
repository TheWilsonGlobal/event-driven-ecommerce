import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Microservices Admin Control Center',
  description: 'Centralized observability, service registry and configuration cockpit for the E-Commerce platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
