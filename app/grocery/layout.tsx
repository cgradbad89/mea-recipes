import Navigation from "@/components/Navigation"
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="md:pl-56 pb-20 md:pb-0 min-h-screen">{children}</main>
    </div>
  )
}
