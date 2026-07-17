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

**Option A: Run against Production** (Default)
```bash
npm run dev
```

**Option B: Run against Local Firebase Emulators**
To avoid affecting production data during local development, you can start the Firebase emulator suite alongside Next.js:

```bash
npm run dev:emulator
```
This uses the `NEXT_PUBLIC_USE_FIRESTORE_EMULATOR=true` environment flag to tell the app to connect to `127.0.0.1:8080` (Firestore) and `127.0.0.1:9099` (Auth).

> **Note:** The emulator starts **empty** by default (no recipes, no user data). To test with realistic data, you must manually export from production and import into the emulator. You can export production data using `firebase emulators:export ./emulator-data` (requires Firebase CLI logged into the production project).

> **Vercel Warning:** Never set `NEXT_PUBLIC_USE_FIRESTORE_EMULATOR=true` in Vercel production environments, otherwise the live app will attempt to connect to localhost emulators and fail.

> **🚨 DEPLOYMENT DANGER:** `firebase.json` in this repo must **never** have a `"firestore"` key added to it (which would define rules/indexes deploy targets). Firestore security rules and indexes for the `malignant-metro` project are shared across multiple apps and are managed exclusively via a manual paste into the Firebase Console. Running `firebase deploy` (unscoped, or with `--only firestore`) from this repo could overwrite and clobber rules/indexes relied on by other apps.

Open [http://localhost:3000](http://localhost:3000)

## MyFitnessPal Integration

To keep your MyFitnessPal food diary synced with the app, a Vercel Cron Job runs nightly. Since MFP has no public API, this uses your actual session credentials. When your session expires, you must manually update these environment variables in Vercel:

1. **Log into MyFitnessPal** in your browser.
2. Open **Developer Tools** -> **Network** tab.
3. Filter by `fetch/XHR` and reload the "Diary" page.
4. Click on a request starting with `diary?entry_date=...`
5. Look at the **Request Headers** and copy these values into your Vercel Project Environment Variables:
   - `MFP_SESSION_COOKIE`: The entire string from the `cookie` header.
   - `MFP_CSRF_TOKEN`: The token from the `x-csrf-token` header. Note: This token may expire on a different cadence than the session cookie. Both need to be refreshed together if the sync starts failing.
   - `MFP_USER_AGENT`: The exact `user-agent` header from that same request. Copying it from the real browser session (rather than hardcoding one) keeps the request consistent with the captured cookie/token, and lets you update it without a code deploy.
6. Make sure `MFP_SYNC_UID` is set to your Firebase Authentication UID.
7. Make sure `CRON_SECRET` matches between your Vercel env and the cron auth check.

> **Trigger mode:** the sync route ships with **no cron schedule** in `vercel.json` — it is manual-trigger-only (call the route with the `Authorization: Bearer $CRON_SECRET` header) until idempotency has been confirmed. Add a `crons` entry to `vercel.json` only after verifying a double-trigger produces no duplicate entries.
>
> Optional: set `MFP_DEBUG=true` in Vercel to enable verbose troubleshooting logs (env-var presence flags, lengths, fetch URL and header keys — never secret values). Leave it unset for normal quiet operation.

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
