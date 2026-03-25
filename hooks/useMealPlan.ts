'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Recipe } from '@/types/recipe'

const STORAGE_KEY = 'mea-meal-plan'

export type MealSlot = 'breakfast' | 'lunch' | 'dinner'

export interface WeekPlan {
  [dateKey: string]: {
    breakfast?: Recipe
    lunch?: Recipe
    dinner?: Recipe
  }
}

export function useMealPlan() {
  const [plan, setPlan] = useState<WeekPlan>({})

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) setPlan(JSON.parse(stored))
    } catch {}
  }, [])

  const addToDay = useCallback((dateKey: string, slot: MealSlot, recipe: Recipe) => {
    setPlan(prev => {
      const next = { ...prev, [dateKey]: { ...prev[dateKey], [slot]: recipe } }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const removeFromDay = useCallback((dateKey: string, slot: MealSlot) => {
    setPlan(prev => {
      const day = { ...prev[dateKey] }
      delete day[slot]
      const next = { ...prev, [dateKey]: day }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const clearPlan = useCallback(() => {
    setPlan({})
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }, [])

  const getAllPlannedRecipes = useCallback((): Recipe[] => {
    const recipes: Recipe[] = []
    Object.values(plan).forEach(day => {
      if (day.breakfast) recipes.push(day.breakfast)
      if (day.lunch) recipes.push(day.lunch)
      if (day.dinner) recipes.push(day.dinner)
    })
    return recipes
  }, [plan])

  return { plan, addToDay, removeFromDay, clearPlan, getAllPlannedRecipes }
}
