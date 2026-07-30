import type { Metadata } from 'next'
import { themeInitScript } from '@/components/theme-toggle'
import './globals.css'

export const metadata: Metadata = {
  title: 'DOU Dashboard',
  description: 'Статистика фоновых задач',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  )
}
