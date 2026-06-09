import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const maxHistoryMessages = Number(process.env.MAX_HISTORY_MESSAGES || 12);
const basicAuthUser = process.env.BASIC_AUTH_USER;
const basicAuthPass = process.env.BASIC_AUTH_PASS;
const sessionHistory = new Map();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isVercelRuntime = Boolean(process.env.VERCEL);
const isDirectRun = !isVercelRuntime && process.argv[1] === __filename;

function parseModelList(value, fallback) {
  const parsed = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (parsed?.length) {
    return parsed;
  }

  return fallback;
}

function isLikelyGeminiApiKey(value) {
  return /^AIza[\w-]{20,}$/.test(value || "");
}

function normalizeProviderError(providerName, error) {
  const provider = providers[providerName];
  const providerLabel = provider?.label || providerName;
  const errorText = String(error?.message || "");

  if (provider?.type === "gemini" && errorText.includes("API_KEY_INVALID")) {
    return {
      status: 502,
      message: `${providerLabel} API key is invalid. Update GEMINI_API_KEY in .env.`,
    };
  }

  if (provider?.type === "gemini" && errorText.includes("RESOURCE_EXHAUSTED")) {
    return {
      status: 429,
      message: `${providerLabel} free-tier quota is exhausted for this model. Switch to gemini-1.5-flash or gemini-2.0-flash-lite in the model field.`,
    };
  }

  if (provider?.type === "gemini" && errorText.includes("NOT_FOUND")) {
    return {
      status: 400,
      message: `${providerLabel}: model not found or not supported. Try gemini-1.5-flash or gemini-2.0-flash-lite.`,
    };
  }

  if (error?.code === "insufficient_quota") {
    return {
      status: 503,
      message: `${providerLabel} quota is exhausted. Check billing or switch providers.`,
    };
  }

  if (error?.status === 401 || error?.status === 403) {
    return {
      status: 502,
      message: `${providerLabel} credentials were rejected. Check that provider's API key.`,
    };
  }

  return {
    status: 500,
    message: `${providerLabel} request failed. Check the server logs for details.`,
  };
}

function buildProviderConfig() {
  const openAiModels = parseModelList(process.env.OPENAI_MODELS, [
    "gpt-4.1-mini",
    "gpt-4o-mini",
    "gpt-4o",
  ]);
  const groqModels = parseModelList(process.env.GROQ_MODELS, [
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile",
  ]);
  const openRouterModels = parseModelList(process.env.OPENROUTER_MODELS, [
    "openai/gpt-4o-mini",
    "anthropic/claude-3.5-sonnet",
    "google/gemini-2.0-flash-001",
  ]);
  const geminiModels = parseModelList(process.env.GEMINI_MODELS, [
    "gemini-2.0-flash",
    "gemini-1.5-pro",
  ]);

  const providers = {
    openai: {
      type: "openai-compatible",
      label: "OpenAI",
      available: Boolean(process.env.OPENAI_API_KEY),
      reason: process.env.OPENAI_API_KEY ? null : "OPENAI_API_KEY is not configured.",
      defaultModel: process.env.OPENAI_DEFAULT_MODEL || "gpt-4.1-mini",
      models: openAiModels,
    },
    groq: {
      type: "openai-compatible",
      label: "Groq",
      available: Boolean(process.env.GROQ_API_KEY),
      reason: process.env.GROQ_API_KEY ? null : "GROQ_API_KEY is not configured.",
      defaultModel:
        process.env.GROQ_DEFAULT_MODEL || "llama-3.1-8b-instant",
      models: groqModels,
    },
    openrouter: {
      type: "openai-compatible",
      label: "OpenRouter",
      available: Boolean(process.env.OPENROUTER_API_KEY),
      reason: process.env.OPENROUTER_API_KEY
        ? null
        : "OPENROUTER_API_KEY is not configured.",
      defaultModel:
        process.env.OPENROUTER_DEFAULT_MODEL || "openai/gpt-4o-mini",
      models: openRouterModels,
    },
    gemini: {
      type: "gemini",
      label: "Gemini",
      available: Boolean(
        process.env.GEMINI_API_KEY &&
          isLikelyGeminiApiKey(process.env.GEMINI_API_KEY)
      ),
      reason: process.env.GEMINI_API_KEY
        ? "Invalid GEMINI_API_KEY format in .env"
        : "GEMINI_API_KEY is not configured.",
      defaultModel:
        process.env.GEMINI_DEFAULT_MODEL ||
        process.env.GEMINI_MODEL ||
        "gemini-2.0-flash",
      models: geminiModels,
    },
  };

  if (process.env.OPENAI_API_KEY) {
    providers.openai.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  if (process.env.GROQ_API_KEY) {
    providers.groq.client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }

  if (process.env.OPENROUTER_API_KEY) {
    providers.openrouter.client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }

  if (providers.gemini.available) {
    providers.gemini.apiKey = process.env.GEMINI_API_KEY;
    providers.gemini.reason = null;
  } else if (process.env.GEMINI_API_KEY) {
    console.warn("Gemini provider is unavailable because GEMINI_API_KEY format is invalid.");
  }

  return providers;
}

const providers = buildProviderConfig();
const providerNames = Object.keys(providers);
const availableProviderNames = providerNames.filter(
  (name) => providers[name].available !== false
);

if (!availableProviderNames.length) {
  const missingProviderMessage =
    "Missing valid AI provider API keys. Configure OPENAI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY.";

  if (isDirectRun) {
    console.error(missingProviderMessage);
    process.exit(1);
  }

  console.warn(missingProviderMessage);
}

if (basicAuthUser && basicAuthPass) {
  app.use((req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Basic ")) {
      res.set("WWW-Authenticate", 'Basic realm="Artch AI"');
      return res.status(401).send("Authentication required.");
    }

    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    if (username !== basicAuthUser || password !== basicAuthPass) {
      res.set("WWW-Authenticate", 'Basic realm="Artch AI"');
      return res.status(401).send("Invalid credentials.");
    }

    return next();
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

app.use("/api", apiLimiter);

function getProviderResponse() {
  return {
    providers: providerNames.map((name) => ({
      name,
      label: providers[name].label,
      available: providers[name].available !== false,
      reason: providers[name].reason || null,
      defaultModel: providers[name].defaultModel,
      models: providers[name].models,
    })),
    defaultProvider: availableProviderNames[0] || providerNames[0],
  };
}

function getSessionMessages(sessionId) {
  if (!sessionHistory.has(sessionId)) {
    sessionHistory.set(sessionId, []);
  }
  return sessionHistory.get(sessionId);
}

function pushSessionTurn(sessionId, role, content) {
  const messages = getSessionMessages(sessionId);
  messages.push({ role, content });

  if (messages.length > maxHistoryMessages) {
    messages.splice(0, messages.length - maxHistoryMessages);
  }
}

function buildInputMessages(sessionId, userMessage) {
  const history = getSessionMessages(sessionId);
  return [
    {
      role: "system",
      content:
        "You are a helpful chatbot assistant for a web app user. Keep answers clear and concise.",
    },
    ...history,
    {
      role: "user",
      content: userMessage,
    },
  ];
}

function getSessionId(req) {
  const sessionId = req.headers["x-session-id"];
  if (!sessionId || typeof sessionId !== "string") {
    return null;
  }
  return sessionId;
}

function resolveProvider(name) {
  if (!name || typeof name !== "string") {
    return availableProviderNames[0];
  }

  if (!providers[name] || providers[name].available === false) {
    return null;
  }

  return name;
}

function resolveModel(providerName, requestedModel) {
  if (!requestedModel || typeof requestedModel !== "string") {
    return providers[providerName].defaultModel;
  }

  return requestedModel.trim() || providers[providerName].defaultModel;
}

function toGeminiContents(input) {
  return input
    .filter((item) => item.role !== "system")
    .map((item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content }],
    }));
}

function getGeminiSystemInstruction(input) {
  const systemMessage = input.find((item) => item.role === "system");
  if (!systemMessage) {
    return undefined;
  }

  return {
    parts: [{ text: systemMessage.content }],
  };
}

async function createTextResponse(providerName, model, input) {
  const provider = providers[providerName];

  if (provider.type === "gemini") {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${provider.apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: getGeminiSystemInstruction(input),
          contents: toGeminiContents(input),
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini request failed: ${errorText}`);
    }

    const data = await response.json();
    return (
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("") || "No response generated."
    );
  }

  // Use the universal Chat Completions API so every OpenAI-compatible
  // provider (OpenAI, Groq, OpenRouter) works with the same code path.
  const response = await provider.client.chat.completions.create({
    model,
    messages: input,
  });

  return response.choices?.[0]?.message?.content || "No response generated.";
}

async function streamTextResponse(providerName, model, input, res) {
  const provider = providers[providerName];

  if (provider.type === "gemini") {
    const text = await createTextResponse(providerName, model, input);
    res.write(text);
    return text;
  }

  let assistantReply = "";

  // Chat Completions streaming: set stream:true and read each chunk's
  // choices[0].delta.content. Supported by OpenAI, Groq, and OpenRouter.
  const stream = await provider.client.chat.completions.create({
    model,
    messages: input,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      assistantReply += delta;
      res.write(delta);
    }
  }

  return assistantReply || "No response generated.";
}

app.get("/api/config", (req, res) => {
  return res.json(getProviderResponse());
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message, provider, model } = req.body;
    const sessionId = getSessionId(req);

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    if (!sessionId) {
      return res.status(400).json({ error: "x-session-id header is required" });
    }

    const providerName = resolveProvider(provider);
    if (!providerName) {
      return res.status(400).json({ error: "provider is not configured" });
    }

    const selectedModel = resolveModel(providerName, model);

    const input = buildInputMessages(sessionId, message);
    const reply = await createTextResponse(providerName, selectedModel, input);
    pushSessionTurn(sessionId, "user", message);
    pushSessionTurn(sessionId, "assistant", reply);

    return res.json({
      reply,
      provider: providerName,
      model: selectedModel,
    });
  } catch (error) {
    console.error("Chat API error:", error);
    const normalizedError = normalizeProviderError(req.body.provider, error);
    return res.status(normalizedError.status).json({ error: normalizedError.message });
  }
});

app.post("/api/chat/stream", async (req, res) => {
  const { message, provider, model } = req.body;
  const sessionId = getSessionId(req);

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }

  if (!sessionId) {
    return res.status(400).json({ error: "x-session-id header is required" });
  }

  const providerName = resolveProvider(provider);
  if (!providerName) {
    return res.status(400).json({ error: "provider is not configured" });
  }

  const selectedModel = resolveModel(providerName, model);

  const input = buildInputMessages(sessionId, message);

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  try {
    const assistantReply = await streamTextResponse(
      providerName,
      selectedModel,
      input,
      res
    );
    pushSessionTurn(sessionId, "user", message);
    pushSessionTurn(
      sessionId,
      "assistant",
      assistantReply || "No response generated."
    );
    return res.end();
  } catch (error) {
    console.error("Streaming chat API error:", error);
    const normalizedError = normalizeProviderError(providerName, error);
    res.statusCode = normalizedError.status;
    return res.end(normalizedError.message);
  }
});

if (isDirectRun) {
  app.listen(port, () => {
    console.log(`Chatbot server running at http://localhost:${port}`);
  });
}

export default app;
