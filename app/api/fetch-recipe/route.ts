import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 })

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; recipe-fetcher/1.0)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()

    // Extract title from <title> tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].replace(/\s*[|\-–]\s*.+$/, '').trim() : ''

    return NextResponse.json({ html, title })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to fetch' }, { status: 500 })
  }
}
