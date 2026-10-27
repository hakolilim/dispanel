
# DisPanel - Discord Bot Management Panel

DisPanel is a full-featured web-based control panel to manage Discord bots with ease. It lets you authenticate your bots, monitor real-time stats, manage servers (guilds), send messages, and more — all in one place.


## 📸 Screenshots

- Login  
  ![Login](images/image1.png)

- Dashboard  
  ![Dash](images/image2.png)

- Message Interface  
  ![Guild Manager](images/image3.png)

**And More!

## ✨ Features

- 🔐 Discord bot token-based login system  
- 📊 Real-time bot stats (uptime, ping, memory usage)  
- 💬 Send messages to channels or DMs  
- 🛠 Guild management (join/leave servers)  
- 💻 Live chat and console logs  
- 🌙 Light/Dark mode support  
- 🖥️ Clean and modern UI with shadcn/ui + Tailwind CSS  

---

## ⚙️ How to Set Up

### 🧱 Step 1: Clone the Repository

```bash
git clone https://github.com/yourname/dispanel.git
cd dispanel
````

---

### 📦 Step 2: Install Dependencies

#### Backend

```bash
cd server
npm install
```

#### Frontend

```bash
cd ../client
npm install
```

---


---

### 🗃 Step 3: Set Up Database

Ensure PostgreSQL is running.

Run database migrations using Drizzle:

```bash
cd server
npx drizzle-kit push
```

---

### 🧪 Step 4: Run the App in Development Mode

#### Start Backend

```bash
cd server
npm run dev
```

#### Start Frontend

```bash
cd ../client
npm run dev
```

Now open your browser and go to:

```
http://localhost:5173
```

---

### 🚀 Step 5: Build for Production

#### Build the frontend:

```bash
cd client
npm run build
```

#### Then go to the backend:

```bash
cd ../server
npm run build
npm start
```

### 🔒 Production Security Configuration

Copy `.env.example` to `.env` and configure it. The server and Drizzle automatically load this file; variables already exported by the operating system retain precedence. A unique `SESSION_SECRET` containing at least 32 characters is strongly recommended for stable production sessions. If omitted, the server generates a secure ephemeral secret and invalidates sessions whenever it restarts. Cookies automatically use the `Secure` attribute when served over HTTPS.

```bash
cp .env.example .env
# Edit .env and replace SESSION_SECRET with the output of:
openssl rand -base64 48
npm run build
npm start
```

Set `PORT` in `.env` to change the HTTP port; it defaults to `5000` when omitted.

`PUBLIC_ORIGIN` is recommended and must match the public origin exactly. Discord bot tokens are used only to establish the active Discord connection; they are not persisted in browser storage or the application schema.

---

## 🧠 Tech Stack

### Frontend

* ⚛️ React + Vite
* 🎨 Tailwind CSS with Discord color palette
* 🧩 shadcn/ui (built on Radix UI)
* 🌐 Wouter (routing)
* 🔁 TanStack Query (state management)
* 🔌 WebSocket client
* 🟦 TypeScript

### Backend

* 🧠 Express.js (TypeScript)
* 🤖 Discord.js
* 🛢 PostgreSQL + Drizzle ORM
* 🧵 Express sessions (PostgreSQL store)
* 🌐 WebSocket server
* 🧰 tsx + ESBuild

---

## 🗃️ Database Tables

* `bot_sessions`: Stores non-secret bot session metadata
* `bot_messages`: Logs message history
* `bot_guilds`: Tracks bot’s guilds
* `bot_stats`: Logs live statistics

---

## 🌍 Deployment Strategy

### Development

* Vite for frontend hot reload
* tsx for running TypeScript backend
* PostgreSQL (local or remote)
* WebSocket for real-time updates

### Production

* Frontend built to static assets (`npm run build`)
* Backend compiled to single JS file (`npm run build`)
* Static files served via Express
* Environment variables for secure configuration
* DB migrations handled via Drizzle Kit

---

## 📅 Changelog

**June 27, 2025**
✅ Initial release of DisPanel
🟢 Added real-time updates, Discord bot integration, full UI

---

## 📄 License

MIT License

---

## 🙋‍♂️ Questions or Contributions?

Feel free to open an issue or pull request on the repository!

Happy botting! 🤖

