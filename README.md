# Mikiru

Mikiru is a character-chat web application focused on natural conversation, memory, and relationship continuity. Part of **Mick's Lab**.

## About Mikiru

Mikiru is designed as a persistent character rather than a general-purpose chatbot.

Conversations can develop over time through memory, relationship state, mood, and previous interactions, allowing Mikiru's behavior toward the user to change naturally while keeping a consistent personality.

The project combines character design, conversation systems, persistent state, and AI-generated dialogue into a single web application. Appearance supports System, Light and Dark. Scene Detail is a local style preference, independent of character state. The interface respects reduced motion and uses WOFF2 fonts.

## Architecture

**GitHub Pages → Cloudflare Worker → Groq**

The static frontend stores conversation history, relationship, mood and memory in browser IndexedDB. A small private backend handles inference and keeps credentials and character instructions outside the public frontend.

One structured Groq call generates the reply and a state proposal. The Worker validates both before returning the reply and accepted state patch. Only successful turns commit history and state together; failed turns can be retried from the last committed state. Responses render as literal text.

## Privacy

Persistent conversation data stays on the user's device. Only the selected context needed to generate a response is sent to the backend and Groq for processing. Browser data is not synchronized across devices.

The application requires no account and includes no analytics or server-side conversation database. Reset requires confirmation, and messages attempted during sleep are not delivered.

The public repository does not include private prompts, artwork, API keys, credentials or private configuration. These inputs must never be placed in frontend configuration or committed to Git.

## Local development

Use Node.js 24:

```sh
npm ci
npm run check
npm run test:worker-local
npm run worker:check -- --fixture
```

These commands install, typecheck, test and build the public source without credentials, private runtime material, artwork or live inference.

For a local demonstration, run these in separate terminals:

```sh
npm run dev:fixture
```

```sh
npm run dev
```

Open http://127.0.0.1:5173/. Fixture replies are labeled and do not call Groq. Fixture mode uses a synthetic neutral WebP, without reading private artwork. If local frontend configuration already exists, set `VITE_API_BASE_URL=http://127.0.0.1:8787/` in the frontend terminal for this demonstration.

Real inference requires authorized private runtime and WebP inputs plus local backend configuration. [`backend/local.env.example`](backend/local.env.example) provides safe placeholders. Local inference and Worker preparation use the same runtime input; the public build and technical checks do not require those private inputs.

## Builds and hosting

`npm run build:frontend` writes to `dist/frontend/`. Set the public HTTPS API address through `VITE_API_BASE_URL`; [`.env.example`](.env.example) contains a placeholder. Without that address, a production frontend cannot send chat requests.

`npm run build:worker` writes the public Worker factory to `dist/worker/`, without bundling private runtime material or artwork. Maintainer-only local preparation supplies those inputs for manual Wrangler deployment. Credentials belong in Worker Secrets; artwork uses Workers Static Assets.

The GitHub Pages workflow publishes only the frontend. A GitHub push does not deploy the Worker; backend changes require a separate manual deployment.

## Context and quota limits

History is compacted in bounded batches while retaining recent dialogue and meaningful memory. Larger memory sets use a lossless table with shared dates and request-local IDs during inference; persisted state and the API retain canonical IDs and the original schema.

Compaction can require an additional provider call without the character prompt. It stays uncommitted until the accompanying turn succeeds; a manual retry can reuse it while the committed revision is unchanged. No automatic provider retries or quota waits are added.

Free-plan input/total-token and daily limits still apply, so rapid consecutive turns are not guaranteed. The 768-token completion cap covers both reply and state; truncated output fails without a partial commit. Oversized memory/context is rejected rather than silently discarded.

## License

Copyright © 2026 micknorj. All rights reserved.

See [LICENSE](LICENSE) for the license terms covering Mikiru source code and original materials.

Third-party components remain subject to their respective licenses. Third-party license notices are available under [`public/licenses/`](public/licenses/).
