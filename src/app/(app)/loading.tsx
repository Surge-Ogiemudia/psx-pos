// Next.js shows this automatically the instant a nav link is clicked, and swaps it out
// automatically the instant the target page's data has actually resolved — not a fixed
// timer, a real Suspense boundary around whichever page is loading. Sits in this shared
// (app) layout so every tab (Catalog, Reports, Staff, ...) gets it for free without each
// route needing its own copy, since the navbar/layout itself stays mounted across
// navigation and only the page content underneath is what's actually loading.
const DOT_COLORS = ["bg-teal-600", "bg-amber-500", "bg-rose-500", "bg-sky-500"];

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <div className="flex items-center gap-3">
        {DOT_COLORS.map((color, i) => (
          <span
            key={color}
            className={`h-4 w-4 rounded-full ${color} animate-bounce`}
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}
