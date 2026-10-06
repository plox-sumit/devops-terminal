// ============================================
// PLOXV1.2 — USER CONFIGURATION FILE
// ============================================
// 
// Edit this file to use your own Hugging Face
// model, endpoint or daily limit.
//
// HOW TO GET YOUR TOKEN:
// 1. Go to https://huggingface.co/settings/tokens
// 2. Create a new token (read access is enough)
// 3. Open a new tab and type in the terminal:
//      token hf_your_token_here
//    It is saved in your browser, not in this file.
//
// HOW TO CHANGE THE MODEL:
// 1. Go to https://huggingface.co/models
// 2. Find a chat/instruct model you want
// 3. Copy the model ID (e.g. "mistralai/Mistral-7B-Instruct-v0.3")
// 4. Paste it below
//
// ============================================

var PLOX_CONFIG = {
  // Leave empty and use the terminal's "token" command instead.
  // (A token pasted here works too, but git tracks this file: never commit it.)
  HF_TOKEN: "",

  // The model to use for command explanations
  HF_MODEL: "Qwen/Qwen2.5-7B-Instruct:together",

  // API endpoint (usually no need to change)
  HF_ENDPOINT: "https://router.huggingface.co/v1/chat/completions",

  // Max AI lookups per day (terminal locks after this)
  DAILY_LIMIT: 5
};