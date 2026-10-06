# Mikiru

Mikiru is a character-chat web application under **Mick's Lab**.

The architecture is **GitHub Pages → Cloudflare Worker → Groq**. Conversation history, relationship, mood and memory stay in browser IndexedDB. The Worker generates natural dialogue, then validates a separate structured state update. Only successful turns commit history and state together; failed turns can be retried from the last committed state. Responses render as literal text.

There are no accounts, analytics or server-side conversation database. Selected conversation context is sent to the backend and Groq for inference. Browser data is not synchronized across devices. Reset requires confirmation, and messages attempted during sleep are not delivered.

## Local development

Use Node.js 24:

```sh
npm ci
npm run check
npm run test:worker-local
```

These checks install, typecheck, test and build the public source without credentials, private runtime material, artwork or live inference.

For a local demonstration, run these in separate terminals:

```sh
npm run dev:fixture
```

```sh
npm run dev
```

Open http://127.0.0.1:5173/. Fixture replies are labeled and do not call Groq. Missing private artwork is supported.

Real inference requires authorized private runtime and WebP inputs plus ignored backend environment configuration. `backend/local.env.example` provides safe placeholders. Provider credentials and private inputs are intentionally absent from this repository and must never be placed in frontend configuration.

## Builds and hosting

`npm run build:frontend` writes to `dist/frontend/`. Set the public HTTPS API address through `VITE_API_BASE_URL`; `.env.example` contains a placeholder. Without that address, a production frontend cannot send chat requests.

`npm run build:worker` writes the public Worker factory to `dist/worker/`, without bundling private runtime material or artwork. Maintainer-only local preparation supplies those inputs for manual Wrangler deployment. Credentials belong in Worker Secrets; artwork uses Workers Static Assets. There is no R2 or automatic GitHub-to-Worker deployment. The GitHub Pages workflow publishes only the frontend.

Appearance supports System, Light and Dark. Scene Detail is a local style preference, independent of character state. The interface respects reduced motion and uses WOFF2 fonts.

Copyright © 2026 micknorj. See `LICENSE`. Third-party licenses are included under `public/licenses/`.
