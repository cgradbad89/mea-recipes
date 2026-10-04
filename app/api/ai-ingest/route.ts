import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { getComplementaryIngredients } from '@/lib/flavorPairings'
import { generateAIObject } from '@/lib/ai'
import { ApiRequestError, readBoundedJson, safeErrorLogDetails } from '@/lib/apiRequest'
import { safeFetchText } from '@/lib/safeFetch'
import { z } from 'zod'
import { RECIPE_SCHEMA, SYSTEM_PROMPT, IMPORT_SYSTEM_PROMPT, MAX_IMPORT_EVIDENCE_LENGTH } from '@/lib/aiIngestContract'
import { aiAbuseControlResponse } from '@/lib/aiAbuseControl'
import { extractSourceRecipeFacts, normalizeRecipeImageUrl, publisherNutritionFromStructuredData } from '@/lib/sourceRecipeFacts'
import { load } from 'cheerio'
import type { SourceRecipeFacts } from '@/lib/sourceRecipeFacts'

const AI_INGEST_MAX_BODY_BYTES = 2_000_000
const MAX_URL_LENGTH = 2_048
const MAX_GENERATION_TEXT_LENGTH = 500
const MAX_DIRECT_TEXT_LENGTH = 250_000
const MAX_DIRECT_HTML_LENGTH = 1_500_000
const MAX_METADATA_LENGTH = 2_048

type AIIngestMode = 'url' | 'html' | 'text' | 'generate'

type ImportSourceMetadata = { sourceURL?: string }

type AIIngestRequest = ImportSourceMetadata & {
  url?: string
  html?: string
  text?: string
  generate?: string
  imageURL?: string
  prepTime?: string
  cookTime?: string
  sourceNutrition?: unknown
}

const REQUEST_SCHEMA: z.ZodType<AIIngestRequest> = z.object({
  url: z.string().max(MAX_URL_LENGTH).optional(),
  sourceURL: z.string().max(MAX_URL_LENGTH).refine(value => {
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password } catch { return false }
  }).optional(),
  html: z.string().max(MAX_DIRECT_HTML_LENGTH).optional(),
  text: z.string().max(MAX_DIRECT_TEXT_LENGTH).optional(),
  generate: z.string().max(MAX_GENERATION_TEXT_LENGTH).optional(),
  imageURL: z.string().max(MAX_METADATA_LENGTH).optional(),
  prepTime: z.string().max(MAX_METADATA_LENGTH).optional(),
  cookTime: z.string().max(MAX_METADATA_LENGTH).optional(),
  sourceNutrition: z.unknown().optional(),
})

export async function POST(req: NextRequest) {
  let requestMetadata: {
    mode: AIIngestMode | 'unvalidated'
    contentLength: number
    urlLength: number
  } = { mode: 'unvalidated', contentLength: 0, urlLength: 0 }

  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    if (body.sourceURL && mode !== 'html' && mode !== 'text') {
      return NextResponse.json({ error: 'Source attribution is only supported with captured HTML or text.' }, { status: 400 })
    }
    const {
      imageURL: providedImage,
      prepTime: providedPrep,
      cookTime: providedCook,
      sourceNutrition: providedSourceNutrition,
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
        const limited = aiAbuseControlResponse(err)
        if (limited) return limited
        console.error('[ai-ingest] AI generation failed', {
          error: safeErrorLogDetails(err),
          ...requestMetadata,
        })
        return NextResponse.json({ error: 'AI generation failed or could not parse response' }, { status: 500 })
      }
    }

    const url = mode === 'url' ? body.url! : body.sourceURL || ''
    let rawHtml = mode === 'html' ? body.html! : ''
    let content = mode === 'text' ? body.text! : ''
    let fetchedTitle = ''
    let sourceFacts: SourceRecipeFacts = { imageURL: '' }

    if (mode === 'url') {
      try {
        const res = await safeFetchText(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; recipe-parser/1.0)',
            'Accept': 'text/html',
          },
        })
        if (res.ok) rawHtml = res.text
      } catch (err) {
        console.error('[ai-ingest] URL fetch failed', {
          error: safeErrorLogDetails(err),
          ...requestMetadata,
        })
        return NextResponse.json({ error: 'Could not fetch URL. Try the bookmarklet or paste text instead.' }, { status: 422 })
      }
    }
    if (rawHtml) {
      // Preserve structured rows BEFORE script removal. Both browser capture and
      // public URL ingestion use the same source-fact parser and precedence.
      sourceFacts = extractSourceRecipeFacts(rawHtml, url)
      const page = load(rawHtml)
      fetchedTitle = page('title').first().text().replace(' - ', ' | ').split(' | ')[0].trim()
      page('script,style,noscript,template,form,nav,header,footer,aside,[hidden],[aria-hidden="true"]').remove()
      page('br').replaceWith('\n')
      page('p,div,section,article,li,h1,h2,h3,h4,h5,h6,tr').append('\n')
      const visibleText = page('body').text().trim()
      // A complete single structured recipe is already a complete relevant
      // representation. Otherwise retain ALL fallback text, never a prefix.
      content = sourceFacts.ingredients && sourceFacts.instructions
        ? JSON.stringify(sourceFacts.recipe)
        : [visibleText, sourceFacts.recipe ? JSON.stringify(sourceFacts.recipe) : ''].filter(Boolean).join('\n')
    }
    if (sourceFacts.unsupportedRecipe || content.length > MAX_IMPORT_EVIDENCE_LENGTH) {
      return NextResponse.json({ error: 'Recipe evidence exceeds supported capacity. No content was trimmed. Try a complete, smaller recipe text.' }, { status: 413 })
    }
    if (!content.trim()) return NextResponse.json({ error: 'No content to parse' }, { status: 400 })

    const sourceNutrition = publisherNutritionFromStructuredData(providedSourceNutrition) || sourceFacts.nutrition
    const userMessage = `Parse this recipe${url ? ` from ${url}` : ''}:\n\n${content}`

    try {
      const parsed = await generateAIObject({
        feature: 'recipe-ingest',
        userId: uid,
        system: IMPORT_SYSTEM_PROMPT,
        prompt: userMessage,
        schema: RECIPE_SCHEMA,
      })
      const ingredients = sourceFacts.ingredients || parsed.ingredients
      const instructions = sourceFacts.instructions || parsed.instructions
      // Without a trustworthy source array, require literal grounding in the
      // complete supplied evidence. A plausible different dish is not success.
      const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim()
      const evidence = normalize(content)
      const grounded = (rows: string[]) => rows.length > 0 && rows.every(row => row.trim() && evidence.includes(normalize(row)))
      if ((!sourceFacts.ingredients && !grounded(ingredients)) || (!sourceFacts.instructions && !grounded(instructions))) {
        return NextResponse.json({ error: 'Could not establish a complete recipe from the supplied source. Open the full recipe or paste its ingredients and instructions.' }, { status: 422 })
      }
      return NextResponse.json({
        ...parsed,
        ingredients,
        instructions,
        title: parsed.title || fetchedTitle || 'Untitled Recipe',
        sourceURL: url,
        // Prefer client-provided values (from bookmarklet) over parsed ones
        imageURL: normalizeRecipeImageUrl(providedImage, url) || sourceFacts.imageURL || normalizeRecipeImageUrl(parsed.imageURL, url),
        prepTime: providedPrep || (typeof sourceFacts.recipe?.prepTime === 'string' ? sourceFacts.recipe.prepTime : '') || parsed.prepTime || '',
        cookTime: providedCook || (typeof sourceFacts.recipe?.cookTime === 'string' ? sourceFacts.recipe.cookTime : '') || parsed.cookTime || '',
        ...(sourceNutrition ? { sourceNutrition } : {}),
      })
    } catch (err) {
      const limited = aiAbuseControlResponse(err)
      if (limited) return limited
      console.error('[ai-ingest] AI parsing failed', {
        error: safeErrorLogDetails(err),
        ...requestMetadata,
      })
      return NextResponse.json({ error: 'AI parsing failed or could not parse response' }, { status: 500 })
    }

  } catch (err) {
    const limited = aiAbuseControlResponse(err)
    if (limited) return limited
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
