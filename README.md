# Artch AI Chatbot

Simple chatbot app using Express and OpenAI-compatible AI providers.

## Setup

1. Install dependencies:
   npm install
2. Create an environment file:
   Copy .env.example to .env
3. Put at least one provider key in .env:
   OPENAI_API_KEY=your_openai_api_key_here
4. Start the app:
   npm start
5. Open in browser:
   http://localhost:3000

## Features

- Streaming AI responses in the browser
- Switch AI provider from the UI when multiple providers are configured
- Switch model from the UI with suggested model names
- Per-session chat memory using a stable browser session id
- API rate limiting to reduce abuse
- Optional HTTP basic auth for protecting the app

## Provider settings

- OpenAI: OPENAI_API_KEY, OPENAI_DEFAULT_MODEL, OPENAI_MODELS
- Groq: GROQ_API_KEY, GROQ_DEFAULT_MODEL, GROQ_MODELS
- OpenRouter: OPENROUTER_API_KEY, OPENROUTER_DEFAULT_MODEL, OPENROUTER_MODELS
- Gemini: GEMINI_API_KEY, GEMINI_DEFAULT_MODEL, GEMINI_MODELS

The app starts if at least one provider API key is configured.

## Optional security settings

- BASIC_AUTH_USER and BASIC_AUTH_PASS: if both are set, all routes require login
- RATE_LIMIT_MAX: max API requests per 15 minutes per IP (default 60)
- MAX_HISTORY_MESSAGES: number of previous turns kept in memory per session (default 12)

## Project structure

- index.js: Express server, provider config, and chat endpoints
- public/index.html: Chat UI
- public/styles.css: App styling
- public/app.js: Frontend chat logic with provider/model switching
