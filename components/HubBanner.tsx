'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { ADMIN_EMAIL } from '@/lib/admin';

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
    <nav aria-label="Switch apps" className="site-switcher w-full flex items-center gap-1 px-4 md:pl-[15rem] py-1 bg-[#f7f5ef] border-b border-[#d3cbbd] z-50 overflow-x-auto">
      {NAV_ITEMS.map((item) =>
        item.internal ? (
          <Link
            key={item.label}
            href={item.href}
            aria-current="page"
            className="inline-flex items-center min-h-[44px] shrink-0 whitespace-nowrap px-3 py-1 rounded text-sm font-medium bg-[#285c45] text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a45100]"
          >
            {item.label}
          </Link>
        ) : (
          <a
            key={item.label}
            href={item.href}
            className="inline-flex items-center min-h-[44px] shrink-0 whitespace-nowrap px-3 py-1 rounded text-sm font-medium text-[#324d3d] hover:bg-[#e4eee5] hover:text-[#1d382b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a45100] transition-colors"
          >
            {item.label}
          </a>
        )
      )}
    </nav>
  );
}
