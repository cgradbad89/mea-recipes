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

  const savePlan = useCallback((next: WeekPlan) => {
    setPlan(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {}
  }, [])

  const addToDay = useCallback((dateKey: string, slot: MealSlot, recipe: Recipe) => {
    savePlan(prev => {
      const next = { ...prev }
      next[dateKey] = { ...next[dateKey], [slot]: recipe }
      return next
    })
  }, [savePlan])

  const removeFromDay = useCallback((dateKey: string, slot: MealSlot) => {
    savePlan(prev => {
      const next = { ...prev }
      if (next[dateKey]) {
        const day = { ...next[dateKey] }
        delete day[slot]
        next[dateKey] = day
      }
      return next
    })
  }, [savePlan])

  const clearPlan = useCallback(() => {
    savePlan({})
  }, [savePlan])

  // Gather all planned recipes for grocery list
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
