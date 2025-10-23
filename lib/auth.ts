import { cookies } from 'next/headers';

export function getCurrentUser(): string | null {
  const userCookie = cookies().get('intelliwatt_user');
  return userCookie?.value ?? null;
} 