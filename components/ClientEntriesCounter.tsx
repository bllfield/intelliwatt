"use client";
import React, { useEffect, useState } from 'react';

export default function ClientEntriesCounter() {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    let isMounted = true;
    const fetchCount = async () => {
      try {
        const res = await fetch('/api/user/entries');
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
  }, []);

  return (
    <div className="font-bold" style={{ color: '#BF00FF' }}>{count}</div>
  );
}
