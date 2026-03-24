# MEA Recipes — Web App

A Next.js web app for your personal recipe collection, powered by Firebase Firestore.

## Tech Stack

- **Next.js 14** (App Router)
- **Firebase** (Firestore + Google Auth)
- **Tailwind CSS**
- **TypeScript**
- **Vercel** (deployment)

## Features

- Browse & search your full recipe collection
- Filter by cuisine and category
- Full recipe detail with ingredients + instructions
- Favorites (synced via Firestore when signed in)
- Weekly meal planner (synced with iOS app)
- Grocery list (shared with iOS app)
- Add recipes via URL (auto-parses structured recipe sites) or paste
- Notes + ratings per recipe
- Mobile responsive

## Firebase Collections Used

All data syncs with the iOS MEA app:

- `recipes/{id}` — shared recipe catalog
- `users/{uid}/recipes/root/favorites/{recipeID}` — favorites
- `users/{uid}/recipes/root/meta/{recipeID}` — notes + ratings
- `users/{uid}/pantry/root/weekPlans/{weekID}` — meal plans
- `users/{uid}/pantry/root/groceryItems/{id}` — grocery list

## Setup

### 1. Clone and install

```bash
git clone <your-repo>
cd mea-recipes
npm install
```

### 2. Firebase setup

The Firebase config is already embedded in `lib/firebase.ts`.

You need to add your web domain to Firebase Auth authorized domains:
1. Go to [Firebase Console](https://console.firebase.google.com/project/malignant-metro/authentication/settings)
2. Under **Authorized domains**, add your Vercel domain (e.g. `mea-recipes.vercel.app`)

### 3. Firestore security rules

Make sure your Firestore rules allow web reads. In Firebase Console → Firestore → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Recipes catalog — public read
    match /recipes/{recipeId} {
      allow read: if true;
      allow write: if request.auth != null;
    }

    // User data — owner only
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

### Option A — Vercel CLI

```bash
npm install -g vercel
vercel
```

### Option B — GitHub + Vercel dashboard

1. Push this folder to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → New Project
3. Import your repo
4. Deploy — no env vars needed (config is in code)

### After deploying

Add your Vercel URL to Firebase Auth authorized domains:
- Firebase Console → Authentication → Settings → Authorized domains
- Add: `your-app.vercel.app`

## Project Structure

```
app/
  recipes/          # Recipe library + detail
    [id]/           # Recipe detail page
  plan/             # Weekly meal planner
  grocery/          # Grocery list
  favorites/        # Saved recipes
  api/
    fetch-recipe/   # Server-side URL fetcher
components/
  Navigation.tsx    # Sidebar + mobile nav
  RecipeCard.tsx    # Recipe grid card
  RecipeFilters.tsx # Search + filter bar
  AddRecipeModal.tsx # Add recipe flow
  AuthButton.tsx    # Google sign in/out
lib/
  firebase.ts       # Firebase init
  AuthContext.tsx   # Auth provider
  recipes.ts        # Firestore recipe queries
  userdata.ts       # User Firestore operations
hooks/
  useFavorites.ts   # Favorites state
types/
  recipe.ts         # TypeScript types
```
