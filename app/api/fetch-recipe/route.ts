import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { safeFetchText, SafeFetchError } from '@/lib/safeFetch'

export async function GET(req: NextRequest) {
  if (!await verifyAuthToken(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    if (error instanceof SafeFetchError) {
      return NextResponse.json({ error: 'Could not fetch URL.' }, { status: error.status })
    }
    return NextResponse.json({ error: 'Could not fetch URL.' }, { status: 502 })
  }
}
