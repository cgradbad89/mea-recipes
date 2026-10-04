import { readFileSync } from 'node:fs'
import type { QueuedRecipe } from '@/lib/queue'

export const nachosHtml = readFileSync('tests/fixtures/bookmarklet-bricklayer-nachos.html', 'utf8')
export const nachosSource = JSON.parse(nachosHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1])
export const nachosIngredients: string[] = nachosSource.recipeIngredient
export const nachosInstructions: string[] = nachosSource.recipeInstructions.map((step: { text: string }) => step.text)
export const nachosQueue: QueuedRecipe = {
  title: nachosSource.name, cuisine: 'mexican', category: 'Snacks',
  ingredients: nachosIngredients, instructions: nachosInstructions,
  sourceURL: 'https://recipes.example/authenticated/nachos', imageURL: nachosSource.image,
  description: '', servings: '6 to 8 servings', prepTime: '20 min', cookTime: '40 min', status: 'pending',
}
