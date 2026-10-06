# Mikiru

Mikiru is a character-chat web application focused on natural conversation, memory, and relationship continuity. Part of Mick's Lab.

## About Mikiru

Mikiru is designed as a persistent character rather than a general-purpose chatbot.

Conversations can develop over time through memory, relationship state, mood, and previous interactions, allowing Mikiru's behavior toward the user to change naturally while keeping a consistent personality.

The project combines character design, conversation systems, persistent state, and AI-generated dialogue into a single web application.

## Architecture

Mikiru uses a static web frontend with browser-local storage for conversation and state.

A small private backend handles AI requests and keeps private configuration, such as API credentials and character instructions, outside the public frontend.

## Privacy

Mikiru is designed to keep persistent conversation data on the user's device where possible.

Only the context needed to generate a response is sent for processing.

The application does not require an account and does not include analytics by default.

The public repository does not include private prompts, API keys, credentials, or other private configuration.

## License

Copyright © 2026 micknorj. All rights reserved.

See [LICENSE](LICENSE) for the license terms covering Mikiru source code and original materials.

Third-party components remain subject to their respective licenses. Third-party license notices are available under [`public/licenses/`](public/licenses/).
