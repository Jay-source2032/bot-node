// ===== IMPORTS =====
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const VIP_LINK = process.env.VIP_LINK;
const PANEL_URL = "https://bot-node-8586.onrender.com/admin.html"; // painel admin
const USERS_FILE = './users.json';

if (!TOKEN || !ADMIN_ID || !VIP_LINK) {
  console.error('⚠️ Missing environment variables BOT_TOKEN, ADMIN_ID, or VIP_LINK!');
  process.exit(1);
}

// ===== INIT BOT =====
const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();
app.use(express.json());

// ===== USERS STORAGE =====
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  return JSON.parse(fs.readFileSync(USERS_FILE));
}

function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function getExpire(plan) {
  const now = new Date();
  if(plan === 'basic') now.setDate(now.getDate()+7);
  if(plan === 'premium') now.setDate(now.getDate()+30);
  if(plan === 'elite') return 'lifetime';
  return now.toISOString();
}

// ===== BOT LOGIC =====
// Comando /start para registrar usuário e plano
bot.onText(/\/start (.+)/, (msg, match) => {
  const payload = match[1]; // ex: "PREMIUM_username"
  const [planRaw, telegramRaw] = payload.split("_");
  const plan = planRaw.toLowerCase();
  const username = telegramRaw.replace('@', '');
  const chatId = msg.chat.id;
  const name = msg.from.first_name;

  const users = loadUsers();
  if(!users[chatId]) users[chatId] = {};

  users[chatId].pendingPlan = plan;
  users[chatId].username = username;
  users[chatId].name = name;
  saveUsers(users);

  // ===== Mensagem para admin =====
  const orderId = Math.floor(Math.random()*1000000);
  users[chatId].orderId = orderId;
  saveUsers(users);

  const opts = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Approve ✅", callback_data: `approve_${chatId}` },
          { text: "Reject ❌", callback_data: `reject_${chatId}` }
        ]
      ]
    }
  };

  bot.sendMessage(
    ADMIN_ID,
    ` Order received\nPlan: ${plan.toUpperCase()}\nUsername: @${username}\nOrder ID: ${orderId}`,
    opts
  );

  // ===== Mensagem para usuário =====
  let price = plan === 'basic' ? 65 : plan === 'premium' ? 120 : 200;
  let days = plan === 'basic' ? 7 : plan === 'premium' ? 30 : 'lifetime';

  bot.sendMessage(
    chatId,
    ` Order sent!\nPlan: ${plan.toUpperCase()}\nDuration: ${days} days\nPrice: $${price}\n\n📎 Please send a screenshot of your payment here to get the VIP link.`
  );
});

// ===== Approve / Reject =====
bot.on('callback_query', async query => {
  const data = query.data;
  const chatId = parseInt(data.split('_')[1]);
  const users = loadUsers();
  const user = users[chatId];

  if(!user) return bot.answerCallbackQuery(query.id, { text: "User not found" });

  if(data.startsWith('approve')) {
    const plan = user.pendingPlan;
    const expire = getExpire(plan);

    user.plan = plan;
    user.expires = expire;
    delete user.pendingPlan;
    saveUsers(users);

    bot.sendMessage(chatId, `Payment confirmed!\nPlan: ${plan.toUpperCase()}\nJoin VIP here: ${VIP_LINK}`);
    bot.answerCallbackQuery(query.id, { text: "Approved" });

  } else if(data.startsWith('reject')) {
    bot.sendMessage(chatId, `❌ Payment rejected. Please contact support: @wachazzin`);
    delete user.pendingPlan;
    saveUsers(users);
    bot.answerCallbackQuery(query.id, { text: "Rejected" });
  }
});

// ===== Receber comprovante (foto ou documento) =====
bot.on('message', msg => {
  const chatId = msg.chat.id;
  const users = loadUsers();
  if(!users[chatId]) return;

  // Evitar processar comandos novamente
  if(msg.text && msg.text.startsWith('/')) return;

  // Foto
  if(msg.photo){
    const fileId = msg.photo[msg.photo.length-1].file_id;
    bot.sendPhoto(ADMIN_ID, fileId, { caption: `📸 Payment screenshot from @${users[chatId].username}\nOrder ID: ${users[chatId].orderId}` });
    bot.sendMessage(chatId, `📎 Screenshot received! Admin will verify your order soon.`);
  }

  // Documento (imagem sem compressão)
  if(msg.document){
    const fileId = msg.document.file_id;
    bot.sendDocument(ADMIN_ID, fileId, { caption: `Payment document from @${users[chatId].username}\nOrder ID: ${users[chatId].orderId}` });
    bot.sendMessage(chatId, `📎 Document received! Admin will verify your order soon.`);
  }
});

// ===== Stats =====
bot.onText(/\/stats/, msg => {
  if(msg.chat.id !== ADMIN_ID) return;
  const users = loadUsers();
  let basic=0, premium=0, elite=0;
  Object.values(users).forEach(u=>{
    if(u.plan==='basic') basic++;
    if(u.plan==='premium') premium++;
    if(u.plan==='elite') elite++;
  });
  bot.sendMessage(ADMIN_ID, `📊 Subscribers:\nBasic: ${basic}\nPremium: ${premium}\nElite: ${elite}`);
});

// ===== Daily reminders =====
const cron = require('node-cron');
cron.schedule('0 12 * * *', () => {
  const users = loadUsers();
  const now = new Date();

  Object.keys(users).forEach(id => {
    const user = users[id];
    if(user.expires && user.expires !== 'lifetime') {
      const exp = new Date(user.expires);
      const diff = (exp - now)/(1000*60*60*24);

      if(diff <= 2 && diff > 1){
        bot.sendMessage(id, "⚠️ Your subscription expires soon.");
      }
      if(diff <= 0){
        bot.sendMessage(id, "⏰ Your subscription expired. Please renew.");
        delete user.plan;
        delete user.expires;
      }
    }
  });
  saveUsers(users);
});

// ===== Admin painel =====
bot.onText(/\/admin/, msg => {
  if(msg.chat.id !== ADMIN_ID) return;
  bot.sendMessage(ADMIN_ID, `🔗 Admin Panel: ${PANEL_URL}`);
});

// ===== Web server =====
app.get('/', (req,res) => res.send('Bot is running'));
app.listen(process.env.PORT || 3000, () => console.log('Web server running'));


