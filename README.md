# ✅ Discord Check-in Notification Bot

A simple Discord bot that monitors an **announcement channel**, automatically adds a ✅ reaction to new posts, and **reminds users via DM** every 2 hours if they haven’t reacted yet.

Built with **TypeScript**, **Discord.js v14**, and **nodemon** for hot reloading.

---

## 🚀 Features

- Automatically reacts to new messages in your announcement channel.
- Tracks which users have reacted with ✅.
- Sends DM reminders every 2 hours to those who haven’t reacted.
- Updates the bot’s avatar on startup.
- No database required — runs entirely in memory.

---

## 📂 Project Structure

```

discord-checkin-bot/
├─ bot/
│  └─ index.ts           # main bot logic
├─ .env                  # environment variables
├─ package.json          # project dependencies and scripts
├─ tsconfig.json         # TypeScript config
├─ nodemon.json          # nodemon config (optional)
└─ README.md

````

---

## ⚙️ Installation

1. **Clone this repository**

   ```bash
   git clone https://github.com/ledgerwave/discord-bot.git
   cd discord-bot
    ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Create a `.env` file**

   ```bash
   DISCORD_TOKEN=your discord bot token
   ANNOUNCEMENT_CHANNEL_ID=channel ID
   BOT_ICON_PATH=./assets/icon.png
   REMINDER_INTERVAL=2 # reminder interval (hour)
   TIMEOUT_DURATION=24 # timeout duration (hour)
   MAX_MISSED_CHECKINS=5 # max missed checkins
   ```

   * `DISCORD_TOKEN` → Your Discord bot token (from the [Discord Developer Portal](https://discord.com/developers/applications))
   * `ANNOUNCEMENT_CHANNEL_ID` → Channel where announcements are posted
   * `BOT_ICON_PATH` → Optional path to your bot's avatar image

4. **Enable Intents in Developer Portal**

   * Go to **Bot → Privileged Gateway Intents**
   * Enable:

     * ✅ Server Members Intent
     * ✅ Message Content Intent

---

## ▶️ Running the Bot

### Development mode (auto-reload)

```bash
npm run start
```

### Or directly with ts-node

```bash
npx ts-node index.ts
```

The bot will:

* Log in to Discord
* Set its avatar (optional)
* React ✅ to new announcement messages
* DM users who haven’t reacted every 2 hours

---

## 🛠️ Scripts

| Command                | Description                                                |
| ---------------------- | ---------------------------------------------------------- |
| `npm run start`        | Start the bot with nodemon (auto-reload)                   |
| `npx ts-node index.ts` | Run once using ts-node                                     |
| `npm run build`        | (Optional) Compile to JavaScript if you add a build script |

---

## 🧠 Notes

* If users have DMs disabled for server members, they will **not receive reminders**.
* All data (reactions, users) is stored in memory — restarting the bot resets the data.
* You can change the reminder interval inside `index.ts`:

  ```ts
  const REMINDER_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours
  ```

---

## 🪪 License

MIT License © 2025 Your Name

---

## ❤️ Contributing

Pull requests and improvements are welcome!
Feel free to fork and modify this bot for your own server.
