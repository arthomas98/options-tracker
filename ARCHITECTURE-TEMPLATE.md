# Architecture Request Template

Use this when requesting similar architecture for new applications.

---

## Full Description

Build a **local-first React SPA** with these characteristics:

### Stack
- React + TypeScript + Vite + Tailwind CSS
- No backend server - runs entirely in the browser
- Deploy to Vercel (static hosting + serverless functions for OAuth)

### Data Storage
- Primary: localStorage (works offline, instant)
- Optional cloud sync: Google Sheets as database (user owns their data)
- Data mapper pattern to translate between app models and sheet rows

### State Management
- React Context for global state (no Redux complexity)
- Debounced sync manager for cloud operations

### Key Patterns
- Local-first: App works without internet, syncs when available
- User-owned data: Cloud data lives in user's Google Drive
- OAuth for integrations (Google, Schwab, etc.) - never store passwords
- Immutable update functions in a `storage.ts` utility layer
- Type-safe with TypeScript interfaces in `types/`

---

## One-liner Version

> "Local-first React SPA with localStorage + optional Google Sheets sync, deployed on Vercel"

---

## Project Structure Reference

```
src/
  components/       # React components
  contexts/         # React Context providers (StorageContext, AuthContext, etc.)
  services/         # External service integrations (Google Sheets, Schwab API)
    sheetsDataMapper.ts   # Translates app data <-> spreadsheet rows
    syncManager.ts        # Handles debounced cloud sync
  types/            # TypeScript interfaces
  utils/            # Pure functions (storage.ts, calculations.ts, etc.)
public/             # Static HTML pages
app.html            # Main SPA entry point
vercel.json         # Vercel routing config
```
