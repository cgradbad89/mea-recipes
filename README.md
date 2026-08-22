# MEA Recipes — Web App

A Next.js web app for your personal recipe collection, powered by Firebase Firestore and Vercel AI Gateway.

## Tech Stack

- **Next.js 16** (App Router) + **React 19**
- **Firebase** (Firestore + Google Auth)
- **Vercel AI Gateway** + **Vercel AI SDK** (`openai/gpt-5.6-luna`)
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
- AI recipe generation, recommendations, meal-plan suggestions, grocery cleanup, and cooking assistant
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

This project is pinned to Node.js 26.x and npm 11.19.0. Use the committed
`.nvmrc` (for example, `nvm use`) before installing dependencies. The Node
range is intentionally limited to the 26.x major so installs and Vercel builds
do not silently move to a future Node major.

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

Copy `.env.example` to `.env.local` and configure the server credentials needed by
the features you use. AI features require `AI_GATEWAY_API_KEY` outside Vercel OIDC;
nutrition lookup also uses `USDA_API_KEY`. Firebase Admin API routes require
`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`.

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

To keep your MyFitnessPal food diary synced with the app, the sync route
**scrapes the classic diary page HTML** —
`https://www.myfitnesspal.com/food/diary/{MFP_USERNAME}?date=YYYY-MM-DD` — and
parses the nutrition table out of the raw response (no documented API is
involved). Since MFP has no public API, this uses your actual session cookie.
When your session expires, you must manually update these environment variables
in Vercel:

1. **Log into MyFitnessPal** in your browser and open your food **Diary**.
2. Note the username in the diary URL (`.../food/diary/<username>`) — that's
   `MFP_USERNAME`.
3. Open **Developer Tools** -> **Network** tab and reload the Diary page.
4. Click the top-level document request for `food/diary/...`.
5. Look at the **Request Headers** and copy these values into your Vercel Project Environment Variables:
   - `MFP_SESSION_COOKIE`: The entire string from the `cookie` header.
   - `MFP_USER_AGENT`: The exact `user-agent` header from that same request. Copying it from the real browser session (rather than hardcoding one) keeps the request consistent with the captured cookie, and lets you update it without a code deploy.
   - `MFP_USERNAME`: The username path segment from step 2.
6. Make sure `MFP_SYNC_UID` is set to your Firebase Authentication UID.
7. Make sure `CRON_SECRET` matches between your Vercel env and the cron auth check.

> **Trigger mode:** Vercel schedules `/api/cron/sync-nutrition` daily at 06:00 UTC via `vercel.json`. The same classic-diary HTML sync can also be triggered manually with the `Authorization: Bearer $CRON_SECRET` header; it is not manual-only.
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
4. Configure the environment variables documented in `.env.example`, then deploy

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
  ai.ts             # Server-only Vercel AI SDK helpers
  aiConfig.ts       # Gateway model, versioning, cache identity, provenance
  firebase.ts       # Firebase init
  AuthContext.tsx   # Auth provider
  recipes.ts        # Firestore recipe queries
  userdata.ts       # User Firestore operations
hooks/
  useFavorites.ts   # Favorites state
types/
  recipe.ts         # TypeScript types
```

## AI architecture

As of 2026-08-20, every active AI feature uses the central configuration in
`lib/aiConfig.ts` and the server-only helpers in `lib/ai.ts`. The configured model
is `openai/gpt-5.6-luna` through Vercel AI Gateway. Structured routes use AI SDK
schema outputs, model-dependent client caches include the provider/model/version
identity, and newly generated nutrition data records provider/model/prompt provenance.
There is no direct-provider fallback, and no retired Gemini or Anthropic provider SDK
is installed. Provider credentials from those integrations are no longer used.
