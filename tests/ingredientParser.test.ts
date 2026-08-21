import { describe, expect, it } from 'vitest'
import { normalizeNoun, singularizeFoodWord } from '@/lib/ingredientParser'

describe('food noun normalization', () => {
  it('normalizes common regular and irregular food plurals', () => {
    expect(normalizeNoun('tomatoes')).toBe('tomato')
    expect(normalizeNoun('fresh leaves')).toBe('fresh leaf')
    expect(normalizeNoun('red onions')).toBe('red onion')
    expect(normalizeNoun('mixed berries')).toBe('mixed berry')
  })

  it('preserves uncountable and special food nouns', () => {
    for (const noun of ['fish', 'rice', 'couscous', 'molasses', 'oats', 'asparagus']) {
      expect(singularizeFoodWord(noun)).toBe(noun)
    }
  })

  it('keeps identity-bearing modifiers', () => {
    expect(normalizeNoun('the red onions')).toBe('red onion')
    expect(normalizeNoun('yellow onion')).toBe('yellow onion')
    expect(normalizeNoun('red onions')).not.toBe(normalizeNoun('yellow onion'))
  })
})
