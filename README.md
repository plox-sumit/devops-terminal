# 🚀 Plox v1.2 — DevOps AI New Tab

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

**Option A — Clone**

```bash
git clone https://github.com/plox-sumit/devops-terminal.git
```

**Option B — Download ZIP**

1. Download https://github.com/plox-sumit/devops-terminal/archive/refs/heads/main.zip
2. Extract the folder

---

### 2. Load as Chrome Extension

1. Open Chrome
2. Go to:

```
chrome://extensions/
```

3. Turn ON **Developer Mode** (top right)
4. Click **Load unpacked**
5. Select your project folder

After you pull an update or edit a file, press the reload icon on the extension's card.

---

### 3. Add Your Hugging Face API Token (IMPORTANT)

1. Get a token from https://huggingface.co/settings/tokens (only "Read" access is needed)
2. Open a new tab and type in the terminal:

```
token hf_your_token_here
```

The token is saved in your browser and is not shown on screen again. `token clear` removes it.

You can still put it in `config.js` instead (`HF_TOKEN: "..."`), but git tracks that file,
so take care never to commit it.

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
* Fetched straight from the 14 source sites, once a day. Later tabs reuse the saved list and make no requests
* If a refresh fails, yesterday's list stays on screen and the next try waits 15 minutes
* If you close the tab before every site has answered, the next tab asks only the rest
* Each story shows the day it was published

The extension asks for access to those 14 sites only, so it can read their feeds.
To add or remove a feed, edit the list in `script.js` **and** the matching line under
`host_permissions` in `manifest.json`. `node test.js` fails if the two lists disagree.

---

### ⚡ Command of the Day

* A different command every day, from the 1,260 in `commands_with_desc.txt`
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
* Answers are saved, so asking about the same command again costs nothing
* A rate-limit or server error is retried twice before it is shown

---

## 📁 Project Structure

```
/devops-terminal
  ├── newtab.html        # Main UI
  ├── style.css          # UI styling
  ├── script.js          # Core logic
  ├── config.js          # User config (model, endpoint, daily limit)
  ├── manifest.json      # Chrome extension config + the feed sites it may read
  ├── commands_with_desc.txt  # Command database
  ├── fonts/             # Manrope font (bundled) and its licence
  ├── test.js            # Smoke test
```

---

## 🧪 Testing

```bash
node test.js
```

Opens the page in headless Chrome or Edge and checks the news, quote, command of the day,
terminal, token command, daily limit, drawing board and midnight rollover. Every outside
request is answered from data inside the test, so it needs no network and no token.
Needs Node 22+ and no `npm install`.

---

## ⚠️ Notes

* Your API key is **not stored anywhere externally**. It stays in your browser
* Everything runs locally in your browser. The only outside requests are the news feeds,
  the daily quote and your AI lookups
* If you put your token in `config.js`, do NOT commit or share that file

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
