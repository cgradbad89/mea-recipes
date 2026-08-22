import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { getComplementaryIngredients } from '@/lib/flavorPairings'
import { generateAIObject } from '@/lib/ai'
import { ApiRequestError, readBoundedJson, safeErrorLogDetails } from '@/lib/apiRequest'
import { safeFetchText } from '@/lib/safeFetch'
import { enforceAbuseLimit } from '@/lib/apiAbuse'
import { z } from 'zod'

const AI_INGEST_MAX_BODY_BYTES = 2_000_000
const MAX_URL_LENGTH = 2_048
const MAX_GENERATION_TEXT_LENGTH = 500
const MAX_DIRECT_TEXT_LENGTH = 250_000
const MAX_DIRECT_HTML_LENGTH = 1_500_000
const MAX_METADATA_LENGTH = 2_048

type AIIngestMode = 'url' | 'html' | 'text' | 'generate'

type AIIngestRequest = {
  url?: string
  html?: string
  text?: string
  generate?: string
  imageURL?: string
  prepTime?: string
  cookTime?: string
}

const REQUEST_SCHEMA: z.ZodType<AIIngestRequest> = z.object({
  url: z.string().max(MAX_URL_LENGTH).optional(),
  html: z.string().max(MAX_DIRECT_HTML_LENGTH).optional(),
  text: z.string().max(MAX_DIRECT_TEXT_LENGTH).optional(),
  generate: z.string().max(MAX_GENERATION_TEXT_LENGTH).optional(),
  imageURL: z.string().max(MAX_METADATA_LENGTH).optional(),
  prepTime: z.string().max(MAX_METADATA_LENGTH).optional(),
  cookTime: z.string().max(MAX_METADATA_LENGTH).optional(),
})

const RECIPE_SCHEMA = z.object({
  title: z.string(),
  cuisine: z.string(),
  category: z.string(),
  ingredients: z.array(z.string()),
  instructions: z.array(z.string()),
  imageURL: z.string(),
  description: z.string(),
  servings: z.string(),
  prepTime: z.string(),
  cookTime: z.string(),
})

const SYSTEM_PROMPT = `You are a recipe parser. Given HTML or text content from a webpage or pasted text, extract the recipe and return ONLY a valid JSON object with no markdown, no backticks, no explanation.

Return exactly this shape:
{
  "title": "string",
  "cuisine": "string (lowercase, e.g. italian, mexican, asian)",
  "category": "string (one of: Chicken & Poultry, Vegetarian Mains, Salads & Bowls, Pasta Noodles & Rice, Soups Stews & Chili, Seafood, Beef & Pork, Breakfast Snacks & Sides)",
  "ingredients": ["ingredient 1", "ingredient 2"],
  "instructions": ["Step 1 text", "Step 2 text"],
  "imageURL": "string or empty string",
  "description": "1-2 sentence description or empty string",
  "servings": "string or empty string",
  "prepTime": "string or empty string",
  "cookTime": "string or empty string"
}

Rules:
- ingredients: each item is a full ingredient line e.g. "2 cups all-purpose flour"
- instructions: each item is one complete step, no step numbers
- cuisine: single word or short phrase, always lowercase
- category: pick the closest match from the list above
- If you cannot find a value, use an empty string
- Return ONLY the JSON object, nothing else`

export async function POST(req: NextRequest) {
  let requestMetadata: {
    mode: AIIngestMode | 'unvalidated'
    contentLength: number
    urlLength: number
  } = { mode: 'unvalidated', contentLength: 0, urlLength: 0 }

  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const abuseResponse = await enforceAbuseLimit(req, 'aiExpensive', uid)
    if (abuseResponse) return abuseResponse

    const requestResult = REQUEST_SCHEMA.safeParse(
      await readBoundedJson(req, AI_INGEST_MAX_BODY_BYTES),
    )
    if (!requestResult.success) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    }

    const body = requestResult.data
    const activeModes = (['url', 'html', 'text', 'generate'] as const).filter(mode => {
      const value = body[mode]
      return typeof value === 'string' && value.trim().length > 0
    })
    if (activeModes.length !== 1) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    }

    const mode = activeModes[0]
    const {
      imageURL: providedImage,
      prepTime: providedPrep,
      cookTime: providedCook,
    } = body
    requestMetadata = {
      mode,
      contentLength: mode === 'html' || mode === 'text' || mode === 'generate'
        ? body[mode]!.length
        : 0,
      urlLength: mode === 'url' ? body.url!.length : 0,
    }

    // Generate mode — create a full recipe from a dish name
    if (mode === 'generate') {
      const generate = body.generate!
      const seeds = [generate, ...generate.split(/[\s,]+/)]
      const complementary = getComplementaryIngredients(seeds, 12)
      const flavorGuidance = complementary.length > 0
        ? `\n\nFLAVOR PAIRING GUIDANCE (from FlavorGraph, a food-science ingredient pairing model):\nWhen choosing ingredients, favor these scientifically complementary ingredients where they fit the dish naturally: ${complementary.join(', ')}.\nDo not force them in — use only those that genuinely suit the recipe.`
        : ''

      try {
        const genParsed = await generateAIObject({
          feature: 'recipe-generation',
          userId: uid,
          system: SYSTEM_PROMPT,
          prompt: `Generate a complete, authentic recipe for: ${generate}\n\nProvide realistic ingredients with measurements and detailed step-by-step instructions.${flavorGuidance}`,
          schema: RECIPE_SCHEMA,
        })
        return NextResponse.json({ ...genParsed, title: genParsed.title || generate, sourceURL: '' })
      } catch (err) {
        console.error('[ai-ingest] AI generation failed', {
          error: safeErrorLogDetails(err),
          ...requestMetadata,
        })
        return NextResponse.json({ error: 'AI generation failed or could not parse response' }, { status: 500 })
      }
    }

    const url = mode === 'url' ? body.url! : ''
    const html = mode === 'html' ? body.html! : ''
    const text = mode === 'text' ? body.text! : ''
    let content = html || text
    let fetchedTitle = ''

    if (mode === 'url') {
      try {
        const res = await safeFetchText(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; recipe-parser/1.0)',
            'Accept': 'text/html',
          },
        })
        if (res.ok) {
          const rawHtml = res.text
          const titleMatch = rawHtml.match(/<title[^>]*>([^<]+)<\/title>/i)
          fetchedTitle = titleMatch ? titleMatch[1].replace(' - ', ' | ').split(' | ')[0].trim() : ''
          content = rawHtml
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .slice(0, 15000)
        }
      } catch (err) {
        console.error('[ai-ingest] URL fetch failed', {
          error: safeErrorLogDetails(err),
          ...requestMetadata,
        })
        return NextResponse.json({ error: 'Could not fetch URL. Try the bookmarklet or paste text instead.' }, { status: 422 })
      }
    }

    if (!content.trim()) {
      return NextResponse.json({ error: 'No content to parse' }, { status: 400 })
    }

    const userMessage = mode === 'url'
      ? `Parse this recipe from ${url}:\n\n${content}`
      : `Parse this recipe:\n\n${content}`

    try {
      const parsed = await generateAIObject({
        feature: 'recipe-ingest',
        userId: uid,
        system: SYSTEM_PROMPT,
        prompt: userMessage,
        schema: RECIPE_SCHEMA,
      })
      return NextResponse.json({
        ...parsed,
        title: parsed.title || fetchedTitle || 'Untitled Recipe',
        sourceURL: url,
        // Prefer client-provided values (from bookmarklet) over parsed ones
        imageURL: providedImage || parsed.imageURL || '',
        prepTime: providedPrep || parsed.prepTime || '',
        cookTime: providedCook || parsed.cookTime || '',
      })
    } catch (err) {
      console.error('[ai-ingest] AI parsing failed', {
        error: safeErrorLogDetails(err),
        ...requestMetadata,
      })
      return NextResponse.json({ error: 'AI parsing failed or could not parse response' }, { status: 500 })
    }

  } catch (err) {
    if (err instanceof ApiRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[ai-ingest] request failed', {
      error: safeErrorLogDetails(err),
      ...requestMetadata,
    })
    return NextResponse.json({ error: 'Unable to complete the request.' }, { status: 500 })
  }
}
