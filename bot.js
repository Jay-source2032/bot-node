// ===== IMPORTS =====
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const VIP_LINK = process.env.VIP_LINK;
const USERS_FILE = './users.json';

if (!TOKEN || !ADMIN_ID || !VIP_LINK) {
  console.error('Missing environment variables BOT_TOKEN, ADMIN_ID or VIP_LINK!');
  process.exit(1);
}

// ===== INIT BOT =====
const bot = new TelegramBot(TOKEN);
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

// ===== WEBHOOK SETUP =====
if(process.env.RENDER_EXTERNAL_URL) {
  bot.setWebHook(`${process.env.RENDER_EXTERNAL_URL}/${TOKEN}`);
  app.post(`/${TOKEN}`, (req,res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
}

// ===== BOT LOGIC =====
bot.onText(/\/start (.+)/, (msg, match) => {
  const payload = match[1]; // ex: "PREMIUM_username"
  const [planRaw, telegramRaw] = payload.split("_");
  const plan = planRaw.toLowerCase();
  const telegram = telegramRaw.replace('@','');
  const userId = msg.chat.id;
  const name = msg.from.first_name;

  const users = loadUsers();
  if(!users[telegram]) users[telegram] = {};
  const orderId = Math.floor(Math.random()*1000000);

  users[telegram].telegramId = userId;   // salvar chatId
  users[telegram].plan = plan;
  users[telegram].name = name;
  users[telegram].orderId = orderId;
  users[telegram].status = 'pending';
  saveUsers(users);

  // ===== MESSAGE TO ADMIN =====
  const price = plan==='basic'?65:plan==='premium'?120:200;
  const days = plan==='basic'?7:plan==='premium'?30:'lifetime';
  bot.sendMessage(
    ADMIN_ID,
    `🆕 Order received\nPlan: ${plan.toUpperCase()}\nUsername: @${telegram}\nDuration: ${days} days\nPrice: $${price}\nOrder ID: ${orderId}\nStatus: Pending`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Approve ✅", callback_data: `approve_${telegram}` },
            { text: "Reject ❌", callback_data: `reject_${telegram}` }
          ]
        ]
      }
    }
  );

  // ===== MESSAGE TO CLIENT =====
  bot.sendMessage(userId, `📨 Order sent!\nPlan: ${plan.toUpperCase()}\nDuration: ${days} days\nPrice: $${price}\nClick below to upload your payment proof and get VIP link.`);
});

// ===== APPROVE / REJECT =====
bot.on('callback_query', query => {
  const data = query.data;
  const telegram = data.split('_')[1];
  const users = loadUsers();
  const user = users[telegram];

  if(!user || !user.telegramId) return bot.answerCallbackQuery(query.id, { text: "User not found" });

  const chatId = user.telegramId;

  if(data.startsWith('approve')) {
    const expire = getExpire(user.plan);
    user.status = 'approved';
    user.expires = expire;
    saveUsers(users);

    bot.sendMessage(chatId, `🎉 Payment confirmed!\nPlan: ${user.plan.toUpperCase()}\nJoin VIP here: ${VIP_LINK}`);
    bot.answerCallbackQuery(query.id, { text: "Approved" });

  } else if(data.startsWith('reject')) {
    user.status = 'rejected';
    saveUsers(users);
    bot.sendMessage(chatId, `❌ Payment rejected. Contact support: @wachazzin`);
    bot.answerCallbackQuery(query.id, { text: "Rejected" });
  }
});

// ===== UPLOAD PAYMENT PROOF =====
bot.on('message', msg => {
  if(!msg.photo) return; // ignorar se não for imagem
  const userId = msg.chat.id;
  const users = loadUsers();
  const user = Object.values(users).find(u => u.telegramId==userId);
  if(!user) return;

  // enviar foto direto para admin
  const fileId = msg.photo[msg.photo.length-1].file_id;
  bot.sendPhoto(ADMIN_ID, fileId, {
    caption: `📸 Payment proof received\nUsername: @${user.name}\nOrder ID: ${user.orderId}\nPlan: ${user.plan.toUpperCase()}`
  });

  bot.sendMessage(userId, "✅ Payment proof sent! Admin will verify and send VIP link.");
});

// ===== STATS =====
bot.onText(/\/stats/, msg => {
  if(msg.chat.id != ADMIN_ID) return;
  const users = loadUsers();
  let basic=0, premium=0, elite=0;
  Object.values(users).forEach(u=>{
    if(u.plan==='basic') basic++;
    if(u.plan==='premium') premium++;
    if(u.plan==='elite') elite++;
  });
  bot.sendMessage(ADMIN_ID, `📊 Subscribers:\nBasic: ${basic}\nPremium: ${premium}\nElite: ${elite}`);
});

// ===== DAILY REMINDERS =====
const cron = require('node-cron');
cron.schedule('0 12 * * *', () => {
  const users = loadUsers();
  const now = new Date();
  Object.keys(users).forEach(tg=>{
    const u = users[tg];
    if(u.expires && u.expires!=='lifetime'){
      const exp = new Date(u.expires);
      const diff = (exp-now)/(1000*60*60*24);
      if(diff<=2 && diff>1) bot.sendMessage(u.telegramId,"⚠️ Your subscription expires soon.");
      if(diff<=0){
        bot.sendMessage(u.telegramId,"⏰ Your subscription expired. Please renew.");
        delete u.plan;
        delete u.expires;
      }
    }
  });
  saveUsers(users);
});

// ===== WEB SERVER =====
app.get('/', (req,res) => res.send('Bot is running'));
app.listen(process.env.PORT || 3000, ()=>console.log('Web server running'));
