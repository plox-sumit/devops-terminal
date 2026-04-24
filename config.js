// ============================================
// PLOXV1.1 — USER CONFIGURATION FILE
// ============================================
// 
// Edit this file to use your own Hugging Face
// model and API token.
//
// HOW TO GET YOUR TOKEN:
// 1. Go to https://huggingface.co/settings/tokens
// 2. Create a new token (read access is enough)
// 3. Paste it below
//
// HOW TO CHANGE THE MODEL:
// 1. Go to https://huggingface.co/models
// 2. Find a chat/instruct model you want
// 3. Copy the model ID (e.g. "mistralai/Mistral-7B-Instruct-v0.3")
// 4. Paste it below
//
// ============================================

var PLOX_CONFIG = {
  // Your Hugging Face Bearer Token
  HF_TOKEN: "",

  // The model to use for command explanations
  HF_MODEL: "Qwen/Qwen2.5-7B-Instruct:together",

  // API endpoint (usually no need to change)
  HF_ENDPOINT: "https://router.huggingface.co/v1/chat/completions",

  // Max AI lookups per day (terminal locks after this)
  DAILY_LIMIT: 5
};