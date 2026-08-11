# Agent instructions — WhatWhen

## Do not start the app

**Never launch or run the app yourself.** That includes:

- `npm run dev`
- `npx electron .`
- `electron-vite dev` / preview
- Starting packaged builds or any other process that opens the UI

Running WhatWhen is **the developer’s job**. After you build or change code, stop there — tell the developer how to run it if useful, but do not start it.

You **may** still:

- Install dependencies (`npm install`)
- Build (`npm run build`, `npx electron-vite build`, typecheck)
- Edit source, configs, and docs
- Kill stray processes **only if the developer explicitly asks** you to

## Project notes

- Electron + TypeScript (electron-vite)
- Global hotkeys and a single always-on-top orb window — multiple agent-started instances fight over shortcuts and userData
- Prefer finishing with a successful **build**, not a running process
