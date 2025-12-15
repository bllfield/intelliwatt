"use client";
import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export default function ClientEntriesCounter() {
  const [count, setCount] = useState<number>(0);
  const pathname = usePathname() || '';
  const isAdminPath = pathname.startsWith('/admin');

  useEffect(() => {
    if (isAdminPath) {
      // Admin pages are not user-session pages; avoid 401 spam.
      return;
    }
    let isMounted = true;
    const fetchCount = async () => {
      try {
        const res = await fetch('/api/user/entries', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (isMounted) setCount(data?.total ?? 0);
        } else {
          if (isMounted) setCount(0);
        }
      } catch {
        if (isMounted) setCount(0);
      }
    };
    fetchCount();
    const onUpdate = () => fetchCount();
    window.addEventListener('entriesUpdated', onUpdate);
    return () => {
      isMounted = false;
      window.removeEventListener('entriesUpdated', onUpdate);
    };
  }, [isAdminPath]);

  return (
    <div className="font-bold text-base md:text-lg" style={{ color: '#BF00FF' }}>{count}</div>
  );
}
