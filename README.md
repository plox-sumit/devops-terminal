# 🚀 Plox v1.1 — DevOps AI New Tab

A sleek **DevOps dashboard + AI-powered Linux terminal** that replaces your browser’s new tab.

It gives you:

* 🧠 AI explanations for Linux commands
* 📰 Live DevOps news feed
* 🎨 Built-in drawing board
* ⚡ Command of the Day
* 💻 Clean terminal-style interface

---

## ⚙️ Setup Instructions

### 1. Download the Project

**Option A — Download ZIP**

1. Click the green **Code** button on this repo
2. Click **Download ZIP**
3. Extract the folder

**Option B — Clone**

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
```

---

### 2. Add Your Hugging Face API Token (IMPORTANT)

Before using the AI terminal:

1. Open `config.js`
2. Add your token:

```js
HF_TOKEN: "your_huggingface_token_here"
```

👉 Get your token from: https://huggingface.co/settings/tokens
(Only "Read" access is needed)

---

### 3. Load as Chrome Extension

1. Open Chrome
2. Go to:

```
chrome://extensions/
```

3. Turn ON **Developer Mode** (top right)
4. Click **Load unpacked**
5. Select your project folder

---

### 4. Done 🎉

Open a new tab — your dashboard is live.

---

## 🧠 Features

### 💻 AI Terminal

* Type any Linux command
* Get instant AI explanation
* Example:

  ```
  ls -la
  ```
* Helps beginners understand commands deeply

---

### 📰 DevOps News Feed

* Aggregates from multiple sources:

  * DevOps blogs
  * Cloud providers
  * Kubernetes ecosystem
* Updates daily automatically

---

### ⚡ Command of the Day

* Random useful command shown daily
* Includes description + copy button

---

### 🎨 Drawing Board

* Simple canvas to sketch ideas
* Adjustable brush size & color
* Clears automatically daily

---

### 📊 Daily Usage Limit

* Limits AI usage per day (default: 5)
* Prevents overuse of API

---

## 📁 Project Structure

```
/project
  ├── newtab.html        # Main UI
  ├── style.css          # UI styling
  ├── script.js          # Core logic
  ├── config.js          # User config (API key)
  ├── manifest.json      # Chrome extension config
  ├── commands_with_desc.txt  # Command database
```

---

## ⚠️ Notes

* Your API key is **not stored anywhere externally**
* Everything runs locally in your browser
* Do NOT share your `config.js` publicly

---

## 🧪 Example Commands

Try typing:

```
docker ps
kubectl get pods
find / -name "*.log"
```

---

## 🔥 Future Ideas (if you extend this)

* Custom command history
* Themes (dark/light)
* Multi-model support
* Voice input

---

## 👨‍💻 Author

Made by **ploxsumit**

---

## ⭐ If you like this

Give the repo a star — helps a lot.
