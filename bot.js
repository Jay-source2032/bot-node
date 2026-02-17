// ===== IMPORTS =====
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const cron = require('node-cron');

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const VIP_LINK = process.env.VIP_LINK;
const USERS_FILE = './users.json';
const PORT = process.env.PORT || 3000;
const EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

if (!TOKEN || !ADMIN_ID || !VIP_LINK) {
  console.error('⚠️ Missing BOT_TOKEN, ADMIN_ID, or VIP_LINK!');
  process.exit(1);
}

// ===== INIT BOT =====
const bot = new TelegramBot(TOKEN);
const app = express();
app.use(express.json());

// ===== USERS STORAGE =====
function loadUsers() {
  if(!fs.existsSync(USERS_FILE)) return {};
  return JSON.parse(fs.readFileSync(USERS_FILE));
}

function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null,2));
}

function getExpire(plan){
  const now = new Date();
  if(plan==='basic') now.setDate(now.getDate()+7);
  if(plan==='premium') now.setDate(now.getDate()+30);
  if(plan==='elite') return 'lifetime';
  return now.toISOString();
}

// ===== UPLOAD CONFIG =====
const upload = multer({ dest:'uploads/' });

// ===== WEBHOOK SETUP =====
bot.setWebHook(`${EXTERNAL_URL}/${TOKEN}`);

app.post(`/${TOKEN}`, (req,res)=>{
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ===== BOT LOGIC =====
bot.onText(/\/start (.+)/, (msg,match)=>{
  const payload = match[1]; // PLAN_USERNAME_METHOD
  const [planRaw, telegramRaw, methodRaw] = payload.split("_");
  const plan = planRaw.toLowerCase();
  const telegram = telegramRaw.replace('@','');
  const method = methodRaw || "unknown";
  const userId = msg.chat.id;
  const name = msg.from.first_name;

  const users = loadUsers();
  if(!users[userId]) users[userId]={};

  users[userId].pendingPlan = plan;
  users[userId].telegram = telegram;
  users[userId].name = name;
  users[userId].method = method;

  const orderId = Math.floor(Math.random()*1000000);
  users[userId].orderId = orderId;
  saveUsers(users);

  // ===== ADMIN MESSAGE =====
  const opts = {
    reply_markup:{
      inline_keyboard:[
        [{text:"Approve ✅",callback_data:`approve_${userId}`},
         {text:"Reject ❌", callback_data:`reject_${userId}`}]
      ]
    }
  };
  const price = plan==="basic"?65:plan==="premium"?120:200;
  bot.sendMessage(
    ADMIN_ID,
    `🆕 New order processed\nPlan: ${plan.toUpperCase()}\nUsername: ${telegram}\nMethod: ${method}\nPrice: $${price}\nOrder ID: ${orderId}`,
    opts
  );

  // ===== USER MESSAGE =====
  const days = plan==="basic"?7:plan==="premium"?30:"lifetime";
  bot.sendMessage(userId,
    `✅ Order received!\nPlan: ${plan.toUpperCase()}\nDuration: ${days} days\nPrice: $${price}\nClick below and upload the payment proof to get the VIP link.`
  );
});

// ===== APPROVE / REJECT =====
bot.on('callback_query', async query=>{
  const data = query.data;
  const userId = parseInt(data.split('_')[1]);
  const users = loadUsers();
  const user = users[userId];
  if(!user) return bot.answerCallbackQuery(query.id,{text:"User not found"});

  if(data.startsWith('approve')){
    const plan = user.pendingPlan;
    const expire = getExpire(plan);
    user.plan = plan;
    user.expires = expire;
    delete user.pendingPlan;
    saveUsers(users);

    bot.sendMessage(userId, `🎉 Payment confirmed!\nPlan: ${plan.toUpperCase()}\nJoin VIP here: ${VIP_LINK}`);
    bot.answerCallbackQuery(query.id,{text:"Approved"});
  } else if(data.startsWith('reject')){
    bot.sendMessage(userId, `❌ Payment rejected. Contact support in case of error: @wachazzin`);
    delete user.pendingPlan;
    saveUsers(users);
    bot.answerCallbackQuery(query.id,{text:"Rejected"});
  }
});

// ===== UPLOAD PAYMENT PROOF =====
bot.on('message', msg=>{
  const userId = msg.chat.id;
  const users = loadUsers();
  if(!users[userId]) return;

  if(msg.photo){
    const fileId = msg.photo[msg.photo.length-1].file_id;
    bot.getFileLink(fileId).then(link=>{
      if(!users[userId].proofs) users[userId].proofs=[];
      users[userId].proofs.push(link);
      saveUsers(users);

      const user = users[userId];
      const price = user.plan==="basic"?65:user.plan==="premium"?120:200;

      // Notify user
      bot.sendMessage(userId, `📎 Screenshot received! Admin will verify your order soon.`);
      // Notify admin
      bot.sendMessage(ADMIN_ID,
        `📸 Payment screenshot received\nUsername: ${user.telegram}\nPlan: ${user.plan.toUpperCase()}\nMethod: ${user.method}\nPrice: $${price}\nOrder ID: ${user.orderId}\nLink: ${link}`
      );
    });
  }
});

// ===== STATS =====
bot.onText(/\/stats/, msg=>{
  if(msg.chat.id!=ADMIN_ID) return;
  const users = loadUsers();
  let basic=0,premium=0,elite=0;
  Object.values(users).forEach(u=>{
    if(u.plan==='basic') basic++;
    if(u.plan==='premium') premium++;
    if(u.plan==='elite') elite++;
  });
  bot.sendMessage(ADMIN_ID, `📊 Subscribers:\nBasic: ${basic}\nPremium: ${premium}\nElite: ${elite}`);
});

// ===== DAILY REMINDERS =====
cron.schedule('0 12 * * *', ()=>{
  const users = loadUsers();
  const now = new Date();
  Object.keys(users).forEach(id=>{
    const user = users[id];
    if(user.expires && user.expires!=='lifetime'){
      const exp = new Date(user.expires);
      const diff = (exp-now)/(1000*60*60*24);
      if(diff <=2 && diff>1) bot.sendMessage(id,"⚠️ Your subscription expires soon.");
      if(diff <=0){
        bot.sendMessage(id,"⏰ Your subscription expired. Please renew.");
        delete user.plan;
        delete user.expires;
      }
    }
  });
  saveUsers(users);
});

// ===== WEB SERVER =====
app.get('/',(req,res)=>res.send('Bot is running'));
app.listen(PORT,()=>console.log('Web server running'));
