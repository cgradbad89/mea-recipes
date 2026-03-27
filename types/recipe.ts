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
  addedBy?: string  // uid of user who added this recipe via web
  prepTime?: string
  cookTime?: string
}

export interface RecipeOverrides {
  title?: string
  cuisine?: string
  category?: string
  content?: string
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
