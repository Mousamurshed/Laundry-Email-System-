'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard,
  Users,
  FileText,
  Mail,
  Inbox,
  BarChart2,
  Settings,
  LogOut,
} from 'lucide-react'

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    async function fetchUnread() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { count } = await supabase
        .from('inbox_messages')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false)
      setUnreadCount(count ?? 0)
    }
    fetchUnread()
    const interval = setInterval(fetchUnread, 60_000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, badge: 0 },
    { href: '/contacts',  label: 'Contacts',  icon: Users,           badge: 0 },
    { href: '/templates', label: 'Templates', icon: FileText,        badge: 0 },
    { href: '/emails',    label: 'Send Email', icon: Mail,            badge: 0 },
    { href: '/inbox',     label: 'Inbox',     icon: Inbox,           badge: unreadCount },
    { href: '/analytics', label: 'Analytics', icon: BarChart2,       badge: 0 },
    { href: '/settings',  label: 'Settings',  icon: Settings,        badge: 0 },
  ]

  return (
    <aside className="w-56 min-h-screen bg-white border-r border-gray-200 flex flex-col fixed left-0 top-0 bottom-0">
      <div className="px-4 py-5 border-b border-gray-100">
        <span className="text-xl font-bold text-gray-900">🧺 Outreach</span>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon, badge }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <Icon size={16} />
              <span className="flex-1">{label}</span>
              {badge > 0 && (
                <span className="bg-blue-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center leading-none">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="px-2 py-3 border-t border-gray-100">
        <button
          onClick={signOut}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 w-full transition-colors"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
