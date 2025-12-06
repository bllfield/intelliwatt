import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function GET() {
  const jar = cookies()

  jar.set({ name: 'intelliwatt_admin', value: '', expires: new Date(0), path: '/' })
  jar.set({ name: 'intelliwatt_user', value: '', expires: new Date(0), path: '/' })

  redirect('/admin-login')
}
