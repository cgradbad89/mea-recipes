export default function Loading() {
  return (
    <main className="max-w-6xl mx-auto px-4 py-8" aria-busy="true" aria-label="Loading MEA Recipes">
      <div className="h-4 w-24 skeleton rounded mb-6" />
      <div className="h-12 w-72 max-w-full skeleton rounded-xl mb-8" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {[0, 1, 2, 3, 4, 5].map(item => (
          <div key={item} className="recipe-card p-4">
            <div className="aspect-video skeleton rounded-xl mb-4" />
            <div className="h-6 w-3/4 skeleton rounded mb-3" />
            <div className="h-4 w-1/2 skeleton rounded" />
          </div>
        ))}
      </div>
    </main>
  )
}
