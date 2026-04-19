'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';

const ADMIN_EMAIL = 'folstromjohn@gmail.com';

const NAV_ITEMS = [
  { label: 'Hub',      href: 'https://my-hub-drab.vercel.app/' },
  { label: 'Budget',   href: 'https://budget-web-rose.vercel.app' },
  { label: 'Oracle',   href: 'https://oracle-web-pied.vercel.app' },
  { label: 'Recipes',  href: '/', internal: true },
  { label: 'DC Catz',  href: 'https://dc-catz.vercel.app' },
  { label: 'Training', href: 'https://training-web-rho.vercel.app' },
];

export default function HubBanner() {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted || !user || user.email !== ADMIN_EMAIL) return null;

  return (
    <nav className="w-full flex items-center gap-1 px-4 md:pl-[15rem] py-2 bg-zinc-900 border-b border-zinc-800 z-50 overflow-x-auto">
      {NAV_ITEMS.map((item) =>
        item.internal ? (
          <Link
            key={item.label}
            href={item.href}
            className="px-3 py-1 rounded text-sm font-medium bg-zinc-700 text-white"
          >
            {item.label}
          </Link>
        ) : (
          <a
            key={item.label}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 rounded text-sm font-medium text-zinc-400 hover:text-white transition-colors"
          >
            {item.label}
          </a>
        )
      )}
    </nav>
  );
}
