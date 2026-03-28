"use client";

interface HubBannerProps {
  href?: string;
  position?: "top" | "bottom";
}

export default function HubBanner({
  href = "https://my-hub-drab.vercel.app",
  position = "bottom",
}: HubBannerProps) {
  const posClass = position === "top" ? "top-0" : "bottom-0";
  return (
    <a
      href={href}
      className={`fixed ${posClass} left-0 right-0 z-50 flex items-center justify-center gap-1.5 bg-zinc-900/90 px-4 py-2 text-sm font-medium text-zinc-300 backdrop-blur-sm transition-colors hover:text-white`}
    >
      <span aria-hidden="true">&larr;</span> My Apps
    </a>
  );
}
