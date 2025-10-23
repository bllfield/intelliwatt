import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function GET() {
  cookies().set({
    name: 'intelliwatt_user',
    value: '',
    expires: new Date(0),
    path: '/',
  });

  redirect('/');
} 