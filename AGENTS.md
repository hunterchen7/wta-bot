# WTA Bot project guidance

## UI and UX

- Treat UX polish as part of feature completeness, not a later cleanup pass. Interfaces should feel responsive, predictable, and pleasant as well as look finished.
- Use the project’s shadcn-style components for standard controls and interaction patterns, including dialogs, selects, checkboxes, tabs, tooltips, scroll areas, dropdowns, and alerts. Extend the shared component layer when a suitable component is missing instead of creating page-specific substitutes.
- Add tasteful animation and transition feedback for navigation, dialogs, expanding content, loading-to-content changes, saves, and other meaningful state changes. Motion should clarify what changed and where it went; avoid decorative or slow animation that delays the user.
- Prevent layout shifts when content, dialogs, menus, or loading states appear. Use appropriately sized skeletons and stable containers.
- Support `prefers-reduced-motion` and keep every workflow fully usable without animation.
- Check light mode, dark mode, keyboard interaction, focus visibility, narrow screens, and common desktop viewport sizes before considering UI work complete.
