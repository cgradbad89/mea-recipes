import Navigation from '@/components/Navigation'
import SignInBanner from '@/components/SignInBanner'

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="md:pl-56 pb-20 md:pb-0 min-h-screen flex flex-col">
        <SignInBanner />
        <div className="warm-page flex-1">{children}</div>
      </main>
    </div>
  )
}
