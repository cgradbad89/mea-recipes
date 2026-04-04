'use client'

import { useState, useRef } from 'react'

interface StarRatingProps {
  value: number
  onChange?: (v: number) => void
  size?: number
}

export default function StarRating({ value, onChange, size = 28 }: StarRatingProps) {
  const [hover, setHover] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>, star: number) => {
    if (!onChange) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    setHover(x < rect.width / 2 ? star - 0.5 : star)
  }

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>, star: number) => {
    if (!onChange) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const newRating = x < rect.width / 2 ? star - 0.5 : star
    onChange(newRating === value ? 0 : newRating)
  }

  const display = hover || value

  return (
    <div ref={containerRef} className="flex gap-1">
      {[1, 2, 3, 4, 5].map(star => {
        const full = display >= star
        const half = !full && display >= star - 0.5
        return (
          <button
            key={star}
            onMouseMove={e => handleMouseMove(e, star)}
            onMouseLeave={() => setHover(0)}
            onClick={e => handleClick(e, star)}
            disabled={!onChange}
            className="relative transition-transform hover:scale-110"
            style={{ width: Math.max(size, 32), height: Math.max(size, 32), padding: size < 32 ? (32 - size) / 2 : 0 }
          >
            <svg viewBox="0 0 24 24" className="text-faint/30 absolute inset-0" style={{ width: size, height: size }} fill="currentColor">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            {full && (
              <svg viewBox="0 0 24 24" className="text-amber absolute inset-0" style={{ width: size, height: size }} fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            )}
            {half && (
              <svg viewBox="0 0 24 24" className="text-amber absolute inset-0" style={{ width: size, height: size }} fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77V2z"/>
              </svg>
            )}
          </button>
        )
      })}
    </div>
  )
}
