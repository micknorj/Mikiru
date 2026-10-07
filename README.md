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

## License

Copyright © 2026 micknorj. All rights reserved.

See [LICENSE](LICENSE) for the license terms covering Mikiru source code and original materials.

Third-party components remain subject to their respective licenses. Third-party license notices are available under [`public/licenses/`](public/licenses/).
