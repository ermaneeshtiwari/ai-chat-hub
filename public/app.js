const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const providerSelect = document.getElementById("providerSelect");
const providerHint = document.getElementById("providerHint");
const modelSelect = document.getElementById("modelSelect");
let providerConfig;

function getSessionId() {
  let sessionId = localStorage.getItem("artch_session_id");
  if (!sessionId) {
    sessionId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem("artch_session_id", sessionId);
  }
  return sessionId;
}

function appendMessage(role, text) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;

  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  wrapper.appendChild(paragraph);

  chatMessages.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function applyProviderSelection(providerName) {
  if (!providerConfig) {
    return;
  }

  const provider = providerConfig.providers.find((item) => item.name === providerName);
  if (!provider) {
    return;
  }

  modelSelect.replaceChildren();
  for (const model of provider.models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelect.appendChild(option);
  }
  modelSelect.value = provider.defaultModel;

  providerHint.textContent = provider.available
    ? `${provider.label} is available.`
    : provider.reason || `${provider.label} is currently unavailable.`;
}

async function loadProviderConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error("Failed to load providers");
  }

  providerConfig = await response.json();
  providerSelect.replaceChildren();

  for (const provider of providerConfig.providers) {
    const option = document.createElement("option");
    option.value = provider.name;
    option.textContent = provider.available
      ? provider.label
      : `${provider.label} (unavailable)`;
    option.disabled = !provider.available;
    providerSelect.appendChild(option);
  }

  providerSelect.value = providerConfig.defaultProvider;
  applyProviderSelection(providerConfig.defaultProvider);
}

function appendMessageWithElement(role, text) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;

  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  wrapper.appendChild(paragraph);

  chatMessages.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return paragraph;
}

async function handleSubmit(event) {
  event.preventDefault();

  const message = messageInput.value.trim();
  if (!message) {
    return;
  }

  appendMessage("user", message);
  messageInput.value = "";
  sendBtn.disabled = true;
  providerSelect.disabled = true;
  modelSelect.disabled = true;

  const provider = providerSelect.value;
  const model = modelSelect.value;

  try {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-id": getSessionId(),
      },
      body: JSON.stringify({ message, provider, model }),
    });

    if (!response.ok) {
      const errorText = (await response.text()) || "Request failed";
      throw new Error(errorText);
    }

    if (!response.body) {
      throw new Error("No response body returned by server.");
    }

    const botParagraph = appendMessageWithElement("bot", "");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let streamedText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      streamedText += decoder.decode(value, { stream: true });
      botParagraph.textContent = streamedText;
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    if (!streamedText.trim()) {
      botParagraph.textContent = "I could not generate a reply.";
    }
  } catch (error) {
    appendMessage("bot", error.message || "Sorry, I hit an error. Please try again.");
  } finally {
    sendBtn.disabled = false;
    providerSelect.disabled = false;
    modelSelect.disabled = false;
    messageInput.focus();
  }
}

chatForm.addEventListener("submit", handleSubmit);
providerSelect.addEventListener("change", (event) => {
  applyProviderSelection(event.target.value);
});

loadProviderConfig().catch(() => {
  appendMessage("bot", "Provider settings could not be loaded.");
  sendBtn.disabled = true;
});
