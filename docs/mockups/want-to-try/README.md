# Want to Try — design mockups

Open [`index.html`](index.html) in a browser. It is a static, mockup-only review board; it does not load production application code, connect to Firebase, or persist state.

## Recommended design

- **Recipe card:** Add a Lucide `Bookmark` icon button in the lower-right corner of the existing card image. This leaves the current upper-right Add to Plan button untouched and keeps the card link/title area clear. It is 34×34px on desktop and 40×40px on mobile. Unselected is an outlined bookmark on the existing dark overlay; selected is amber with a checkmark. Proposed labels: `Mark {recipe title} as Want to Try` and `Remove {recipe title} from Want to Try`.
- **Recipe detail:** Keep the existing heart in its title-level icon cluster for Favorites. Add an outlined `Bookmark + Want to Try` secondary action next to the existing primary `Add to Plan` action. Selected reads `Want to Try ✓`, with checkmark plus amber outline/fill treatment. This groups future-intent actions without confusing the bookmark with editing or Favorite.
- **Filter:** Add a `Bookmark + Want to Try` toggle as a peer of `Cooked recently` in the existing sort/filter row—not a navigation route or a new filter panel. Its checked bookmark and amber selected treatment make the active state obvious; the existing live count becomes, for example, `3 of 234 recipes`.
- **Empty state:** When that filter is active and zero recipes match, show `No recipes to try yet` and `Tap the bookmark on any recipe to keep it in your Want to Try list.`, with `Clear Want to Try filter` as the recovery action.
- **Mobile:** Retain the current horizontally scrolling sort/filter row. Use 40×40px card controls and stack the detail actions full-width, with Add to Plan first and Want to Try second.

## Why this direction

Bookmark is familiar as a “save for later” metaphor and remains visibly distinct from the filled Favorite heart. Placing it in the unused lower-right image corner avoids adding a third compact action to the card’s already occupied top-right area. The filter follows the exact existing compact-chip language, so it does not recast Want to Try as a new destination.

## Alternative considered

**Alternative: place the bookmark beside Add to Plan in the card’s upper-right corner.** This creates a consistent action cluster, but makes two small circular controls compete in the card’s most prominent corner and is more vulnerable to touch-target crowding. The recommended lower-right placement preserves current card action density and keeps each control separate.

## Accessibility notes represented by the mockup

- Every icon-only bookmark has a proposed accessible name and title.
- Selected state uses a checkmark and changed label/title as well as amber color.
- Bookmark controls are separate from the card navigation target.
- Mobile targets are at least 40×40px; the final implementation should preserve a visible focus ring consistent with existing amber focus styling.

## Implementation decisions intentionally deferred

The mockup does not decide Firestore storage location, data migration, persistence-helper signatures, real filter-state wiring, localStorage persistence behavior, cross-device synchronization, automated tests, or any production component changes. Those decisions belong in a post-approval implementation task.

## Scope confirmation

- Production code: unchanged.
- Data / Firestore: unchanged.
- Dependencies: unchanged.
- `PRD.md`: unchanged — design proposal awaiting product-owner approval.
