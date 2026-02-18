// ===== IMPORTS =====
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// ===== ENV =====
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const VIP_LINK = process.env.VIP_LINK;
const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL;

if (!TOKEN || !ADMIN_ID || !VIP_LINK || !WEBHOOK_URL) {
  console.log("Missing ENV variables");
  process.exit(1);
}

// ===== INIT =====
const bot = new TelegramBot(TOKEN);
const app = express();
app.use(express.json());

// ===== MEMORY STORAGE =====
// (Simples e estável. Depois pode trocar por database se quiser)
let users = {};
let stats = {
  total: 0,
  basic: 0,
  premium: 0,
  elite: 0
};

// ===== WEBHOOK =====
bot.setWebHook(`${WEBHOOK_URL}/${TOKEN}`);

app.post(`/${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send("Bot running");
});

// ===== START COMMAND =====
bot.onText(/\/start(?: (.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name;
  const username = msg.from.username || name;

  let plan = null;
  let providedUsername = username;

  if (match[1]) {
    const parts = match[1].split("_");
    plan = parts[0].toLowerCase();
    if (parts[1]) providedUsername = parts[1].replace("@", "");
  }

  // Save user
  if (!users[chatId]) {
    users[chatId] = {
      username: providedUsername,
      name: name,
      plan: null,
      pendingPlan: null
    };
    stats.total++;
  }

  // If coming from payment page
  if (plan) {
    users[chatId].pendingPlan = plan;

    const orderId = Math.floor(Math.random() * 1000000);

    const adminButtons = {
      reply_markup: {
        inline_keyboard: [[
          { text: "Approve ✅", callback_data: `approve_${chatId}` },
          { text: "Reject ❌", callback_data: `reject_${chatId}` }
        ]]
      }
    };

    // ===== ADMIN MESSAGE =====
    bot.sendMessage(
      ADMIN_ID,
      `📦 Order sent
User: @${providedUsername}
Name: ${name}
Plan: ${plan.toUpperCase()}
ChatID: ${chatId}
OrderID: ${orderId}`,
      adminButtons
    );

    // ===== CLIENT MESSAGE =====
    bot.sendMessage(
      chatId,
      `✅ Order received!

Plan: ${plan.toUpperCase()}

Next step:
Please send your payment screenshot here.

After admin approval, you will receive your VIP link automatically.`
    );
  } else {
    bot.sendMessage(chatId, "Welcome! Please use the payment page to start your order.");
  }
});

// ===== RECEIVE PAYMENT IMAGE =====
bot.on('photo', (msg) => {
  const chatId = msg.chat.id;

  if (!users[chatId]) return;

  const fileId = msg.photo[msg.photo.length - 1].file_id;

  bot.sendPhoto(
    ADMIN_ID,
    fileId,
    {
      caption: `📸 Payment proof received

User: @${users[chatId].username}
Name: ${users[chatId].name}
ChatID: ${chatId}
Plan: ${users[chatId].pendingPlan || "Unknown"}`
    }
  );

  bot.sendMessage(chatId, "Screenshot received. Waiting for admin approval.");
});

// If user sends image as file
bot.on('document', (msg) => {
  const chatId = msg.chat.id;

  if (!users[chatId]) return;

  if (msg.document.mime_type && msg.document.mime_type.startsWith("image")) {
    bot.sendDocument(
      ADMIN_ID,
      msg.document.file_id,
      {
        caption: `📎 Payment file received

User: @${users[chatId].username}
ChatID: ${chatId}`
      }
    );

    bot.sendMessage(chatId, "File received. Waiting for admin approval.");
  }
});

// ===== APPROVE / REJECT =====
bot.on('callback_query', (query) => {
  const data = query.data;
  const chatId = parseInt(data.split("_")[1]);

  if (!users[chatId]) {
    bot.answerCallbackQuery(query.id, { text: "User not found" });
    return;
  }

  const plan = users[chatId].pendingPlan;

  if (data.startsWith("approve")) {
    users[chatId].plan = plan;
    users[chatId].pendingPlan = null;

    // stats
    if (plan === "basic") stats.basic++;
    if (plan === "premium") stats.premium++;
    if (plan === "elite") stats.elite++;

    bot.sendMessage(
      chatId,
      `🎉 Payment approved!

Here is your VIP access:
${VIP_LINK}`
    );

    bot.answerCallbackQuery(query.id, { text: "Approved" });
  }

  if (data.startsWith("reject")) {
    users[chatId].pendingPlan = null;

    bot.sendMessage(
      chatId,
      "❌ Payment rejected. Please contact support."
    );

    bot.answerCallbackQuery(query.id, { text: "Rejected" });
  }
});

// ===== STATS =====
bot.onText(/\/stats/, (msg) => {
  if (msg.chat.id != ADMIN_ID) return;

  bot.sendMessage(
    ADMIN_ID,
    `📊 Stats

Total users: ${stats.total}
Basic: ${stats.basic}
Premium: ${stats.premium}
Elite: ${stats.elite}`
  );
});

// ===== SERVER =====
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
