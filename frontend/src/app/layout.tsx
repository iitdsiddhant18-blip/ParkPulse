import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { Navbar } from '@/components/Navbar';

export const metadata: Metadata = {
  title: 'ParkPulse — Smart Parking Reservation & Analytics',
  description: 'Find. Reserve. Park. Editorial real-time smart parking reservation system.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        data-theme="editorial-sand"
        className="min-h-screen bg-editorial-bg font-sans text-editorial-ink antialiased"
      >
        <AuthProvider>
          <Navbar />
          <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
