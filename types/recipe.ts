export interface Recipe {
  id: string
  recipeID: string
  title: string
  content: string
  category: string
  cuisine: string
  imageURL: string
  sourceURL: string
  sourceFile: string
  labels: string
  hasImage: string
  created: string
  modified: string
}

export type Category =
  | 'Chicken & Poultry'
  | 'Vegetarian Mains'
  | 'Salads & Bowls'
  | 'Pasta, Noodles & Rice'
  | 'Soups, Stews & Chili'
  | 'Seafood'
  | 'Beef & Pork'
  | 'Breakfast, Snacks & Sides'

export interface MealPlanDay {
  date: string // ISO date string
  breakfast?: Recipe
  lunch?: Recipe
  dinner?: Recipe
}

export interface MealPlan {
  weekStart: string // ISO date string (Monday)
  days: MealPlanDay[]
}
