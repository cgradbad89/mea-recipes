import { NextRequest, NextResponse } from 'next/server'
import { safeFetchText, SafeFetchError } from '@/lib/safeFetch'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 })

  try {
    const res = await safeFetchText(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; recipe-fetcher/1.0)',
        'Accept': 'text/html',
      },
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = res.text

    // Extract title from <title> tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].replace(/\s*[|\-–]\s*.+$/, '').trim() : ''

    return NextResponse.json({ html, title })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch'
    const status = error instanceof SafeFetchError ? error.status : 502
    return NextResponse.json({ error: message }, { status })
  }
}
