import express from "express";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import dotenv from "dotenv";
import helmet from "helmet";
import {Server} from "socket.io";
import Razorpay from "razorpay";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import {q,pool} from "./db.js";
import {auth,optionalAuth,register,login,sign,signSocket,verifyToken,guest} from "./auth.js";
dotenv.config();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(),server=http.createServer(app); app.set("trust proxy",1); app.disable("x-powered-by");
const allowedOrigins=String(process.env.CORS_ORIGIN||"").split(",").map(x=>x.trim()).filter(Boolean);
const io=new Server(server,{cors:{origin:allowedOrigins.length?allowedOrigins:false,methods:["GET","POST"]}});
function setSessionCookie(res,token,maxAgeSeconds){
  const secure=process.env.NODE_ENV==='production'?' Secure;':'';
  res.setHeader('Set-Cookie',`vm_session=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax;${secure}`);
}
function clearSessionCookie(res){
  const secure=process.env.NODE_ENV==='production'?' Secure;':'';
  res.setHeader('Set-Cookie',`vm_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax;${secure}`);
}
function profileQuality(u){
  const checks=[['name',!!u.name],['photo',!!u.avatar],['age',Number(u.age)>=18],['city',!!u.city],['college',!!u.college],['course',!!u.course],['bio',String(u.bio||'').trim().length>=40],['interests',Array.isArray(u.interests)&&u.interests.length>=3],['languages',Array.isArray(u.languages)&&u.languages.length>=1],['mode',!!u.mode],['gender',!!u.gender]];
  const score=Math.round(checks.filter(x=>x[1]).length/checks.length*100);
  return {score,complete:score>=90,missing:checks.filter(x=>!x[1]).map(x=>x[0])};
}

const subscriptionsReady = q(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id TEXT UNIQUE NOT NULL,
    payment_id TEXT,
    amount_paise INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    product TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )
`);
const featurePurchasesReady = q(`
  CREATE TABLE IF NOT EXISTS feature_purchases (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    order_id TEXT UNIQUE,
    payment_id TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    used_at TIMESTAMP
  )
`);

const webhookEventsReady=q(`CREATE TABLE IF NOT EXISTS webhook_events (event_id VARCHAR(160) PRIMARY KEY,received_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
const superLikesReady = q(`
  CREATE TABLE IF NOT EXISTS super_likes (
    id SERIAL PRIMARY KEY,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW()
  )
`);

const boostsReady = q(`
  CREATE TABLE IF NOT EXISTS profile_boosts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
  )
`);
const profilePhotosReady=q(`CREATE TABLE IF NOT EXISTS profile_photos (id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,data TEXT NOT NULL,mime TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,position))`).catch(e=>{console.error('profile_photos init failed',e);throw e});
const securityEventsReady=q(`CREATE TABLE IF NOT EXISTS security_events (id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,event VARCHAR(80) NOT NULL,ip_hash VARCHAR(128),user_agent_hash VARCHAR(128),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
const contentReportsReady=q(`CREATE TABLE IF NOT EXISTS content_reports (id BIGSERIAL PRIMARY KEY,reporter_id BIGINT REFERENCES users(id) ON DELETE CASCADE,content_type VARCHAR(30) NOT NULL,content_id BIGINT NOT NULL,reported_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,reason VARCHAR(120) NOT NULL,details VARCHAR(1000) DEFAULT '',status VARCHAR(20) NOT NULL DEFAULT 'open',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
const notificationsReady=q(`CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
  );`);
const premiumFeaturesReady=(async()=>{
  await q("ALTER TABLE users ADD COLUMN IF NOT EXISTS incognito_enabled BOOLEAN NOT NULL DEFAULT FALSE");
  await q("ALTER TABLE users ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ");
  await q("ALTER TABLE users ADD COLUMN IF NOT EXISTS travel_city VARCHAR(80)");
  await q("CREATE TABLE IF NOT EXISTS profile_views (id SERIAL PRIMARY KEY,viewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,viewed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(viewer_id,viewed_id))");
  await q("CREATE INDEX IF NOT EXISTS idx_profile_views_viewed ON profile_views(viewed_id,created_at DESC)");
  await q("CREATE TABLE IF NOT EXISTS compliments (id SERIAL PRIMARY KEY,sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,body VARCHAR(150) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),read_at TIMESTAMPTZ)");
  await q("CREATE INDEX IF NOT EXISTS idx_compliments_receiver ON compliments(receiver_id,created_at DESC)");
})().catch(e=>{console.error('premium features init failed',e);throw e});
const roadmapReady=(async()=>{
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_status VARCHAR(24) NOT NULL DEFAULT 'unverified'`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_photo BOOLEAN NOT NULL DEFAULT FALSE`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_exact_location BOOLEAN NOT NULL DEFAULT TRUE`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lifestyle_tags TEXT[] NOT NULL DEFAULT '{}'`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hobbies TEXT[] NOT NULL DEFAULT '{}'`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS travel_interests TEXT[] NOT NULL DEFAULT '{}'`);
  await q(`CREATE TABLE IF NOT EXISTS user_discovery_preferences (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,age_min INT NOT NULL DEFAULT 18,age_max INT NOT NULL DEFAULT 100,cities TEXT[] NOT NULL DEFAULT '{}',colleges TEXT[] NOT NULL DEFAULT '{}',interests TEXT[] NOT NULL DEFAULT '{}',travel_interests TEXT[] NOT NULL DEFAULT '{}',relationship_intents TEXT[] NOT NULL DEFAULT '{}',lifestyle_tags TEXT[] NOT NULL DEFAULT '{}',languages TEXT[] NOT NULL DEFAULT '{}',hobbies TEXT[] NOT NULL DEFAULT '{}',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS safety_settings (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,hide_exact_location BOOLEAN NOT NULL DEFAULT TRUE,show_online_status BOOLEAN NOT NULL DEFAULT TRUE,show_last_seen BOOLEAN NOT NULL DEFAULT FALSE,allow_profile_view_notifications BOOLEAN NOT NULL DEFAULT TRUE,allow_message_notifications BOOLEAN NOT NULL DEFAULT TRUE,allow_match_notifications BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS verification_requests (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind VARCHAR(30) NOT NULL DEFAULT 'profile',selfie_data TEXT,document_data TEXT,status VARCHAR(24) NOT NULL DEFAULT 'pending',reviewer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,review_note VARCHAR(500) DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),reviewed_at TIMESTAMPTZ)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_verification_requests_status ON verification_requests(status,created_at DESC)`);
  await q(`CREATE TABLE IF NOT EXISTS emergency_contacts (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name VARCHAR(80) NOT NULL,phone VARCHAR(30) NOT NULL,relation VARCHAR(40) DEFAULT '',is_primary BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS date_safety_shares (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,contact_id BIGINT REFERENCES emergency_contacts(id) ON DELETE SET NULL,match_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,title VARCHAR(160) NOT NULL,start_at TIMESTAMPTZ,end_at TIMESTAMPTZ,location_label VARCHAR(180) DEFAULT '',notes VARCHAR(500) DEFAULT '',status VARCHAR(20) NOT NULL DEFAULT 'active',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),ended_at TIMESTAMPTZ)`);
  await q(`CREATE TABLE IF NOT EXISTS date_safety_checkins (id BIGSERIAL PRIMARY KEY,share_id BIGINT NOT NULL REFERENCES date_safety_shares(id) ON DELETE CASCADE,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,status VARCHAR(20) NOT NULL DEFAULT 'safe',note VARCHAR(300) DEFAULT '',latitude DOUBLE PRECISION,longitude DOUBLE PRECISION,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS notification_preferences (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,in_app BOOLEAN NOT NULL DEFAULT TRUE,push BOOLEAN NOT NULL DEFAULT TRUE,email BOOLEAN NOT NULL DEFAULT FALSE,likes BOOLEAN NOT NULL DEFAULT TRUE,matches BOOLEAN NOT NULL DEFAULT TRUE,messages BOOLEAN NOT NULL DEFAULT TRUE,trips BOOLEAN NOT NULL DEFAULT TRUE,events BOOLEAN NOT NULL DEFAULT TRUE,safety BOOLEAN NOT NULL DEFAULT TRUE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS push_subscriptions (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,endpoint TEXT NOT NULL UNIQUE,p256dh TEXT NOT NULL,auth TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS analytics_events (id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,event VARCHAR(80) NOT NULL,properties JSONB NOT NULL DEFAULT '{}'::jsonb,session_id VARCHAR(120) DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE INDEX IF NOT EXISTS idx_analytics_event_time ON analytics_events(event,created_at DESC)`);
  await q(`CREATE TABLE IF NOT EXISTS password_reset_tokens (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash VARCHAR(128) NOT NULL UNIQUE,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS email_verification_tokens (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash VARCHAR(128) NOT NULL UNIQUE,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS event_reminders (event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,remind_minutes INT NOT NULL DEFAULT 60,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(event_id,user_id))`);
  await q(`CREATE TABLE IF NOT EXISTS ai_usage (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,count_today INT NOT NULL DEFAULT 0,day DATE NOT NULL DEFAULT CURRENT_DATE)`);
  await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_kind VARCHAR(20) DEFAULT 'image'`);
})().catch(e=>{console.error('roadmap init failed',e);throw e});
const messagingFeaturesReady=(async()=>{await q("ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL");await q("ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ");await q("CREATE TABLE IF NOT EXISTS message_reactions (id SERIAL PRIMARY KEY,message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,emoji VARCHAR(16) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(message_id,user_id,emoji))");await q("CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id)");await q("CREATE INDEX IF NOT EXISTS idx_messages_dm_unread ON messages(receiver_id,sender_id,read_at) WHERE receiver_id IS NOT NULL")})().catch(e=>{console.error('messaging features init failed',e);throw e});
const buckets=new Map();
async function createNotification(userId,actorId,type,title,body){
  try{
    await notificationsReady;

    const r=await q(
      `INSERT INTO notifications
       (user_id,actor_id,type,title,body)
       VALUES($1,$2,$3,$4,$5)
       RETURNING id,actor_id,type,title,body,read_at,created_at`,
      [userId,actorId,type,title,body||null]
    );

    const n=r.rows[0];

    let actor={rows:[]};

    if(actorId){
      actor=await q(
        `SELECT name,avatar
         FROM users
         WHERE id=$1`,
        [actorId]
      );
    }

    io.to(`user:${userId}`).emit('notification:new',{
      ...n,
      actor_name:actor.rows[0]?.name||null,
      actor_avatar:actor.rows[0]?.avatar||null
    });

  }catch(e){
    console.error("Notification error:",e.message);
  }
}
async function audit(req,event,userId=null){try{await securityEventsReady;const hash=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex');await q('INSERT INTO security_events(user_id,event,ip_hash,user_agent_hash) VALUES($1,$2,$3,$4)',[userId,event,hash(req.ip),hash(req.get('user-agent'))]);}catch(e){console.error('Security audit log failed:',e.message)}}
function rateLimit({windowMs=60_000,max=120,keyFn=req=>req.ip}={}){return(req,res,next)=>{const key=keyFn(req),now=Date.now();let b=buckets.get(key);if(!b||now-b.start>windowMs)b={start:now,count:0};b.count++;buckets.set(key,b);if(b.count>max)return res.status(429).json({error:"Too many requests. Please try again shortly."});next()}}
const authLimiter=rateLimit({windowMs:15*60_000,max:25}),apiLimiter=rateLimit({windowMs:60_000,max:240}),messageLimiter=rateLimit({windowMs:10_000,max:30,keyFn:req=>`${req.ip}:${req.user?.id||"anon"}`});
app.use(helmet({contentSecurityPolicy:false,crossOriginEmbedderPolicy:false,hsts:process.env.NODE_ENV==='production'}));
app.use((req,res,next)=>{res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Permissions-Policy','camera=(self), microphone=(self), geolocation=(self)');next()});
app.use((req,res,next)=>{if(!allowedOrigins.length||!req.headers.origin)return next();if(!allowedOrigins.includes(req.headers.origin))return res.status(403).json({error:'Origin not allowed'});next()});

app.post("/api/vip/webhook",express.raw({type:"application/json",limit:"1mb"}),async(req,res)=>{try{const secret=process.env.RAZORPAY_WEBHOOK_SECRET;if(!secret)return res.status(503).json({error:"Webhook secret not configured"});const sig=req.headers["x-razorpay-signature"]||"",expected=crypto.createHmac("sha256",secret).update(req.body).digest("hex");if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return res.status(400).json({error:"Invalid webhook signature"});const event=JSON.parse(req.body.toString("utf8"));await webhookEventsReady;const eventId=String(event.id||`${event.event}:${event.created_at||Date.now()}`);const seen=await q("INSERT INTO webhook_events(event_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING event_id",[eventId]);if(!seen.rowCount)return res.json({received:true,duplicate:true});const payment=event.payload?.payment?.entity;if(event.event==="payment.captured"&&payment?.order_id){const sub=await q("UPDATE subscriptions SET payment_id=$1,status='paid' WHERE order_id=$2 AND status<>'paid' RETURNING user_id,product",[payment.id,payment.order_id]);if(sub.rowCount){const row=sub.rows[0];if(row.product==="call_pass"){const days=Number(process.env.CALL_PASS_DAYS||7);await q("UPDATE users SET call_pass_until=GREATEST(COALESCE(call_pass_until,NOW()),NOW())+($1::int * INTERVAL '1 day') WHERE id=$2",[days,row.user_id])}else await q("UPDATE users SET vip_until=GREATEST(COALESCE(vip_until,NOW()),NOW())+INTERVAL '30 days' WHERE id=$1",[row.user_id])}const feature=await q("UPDATE feature_purchases SET payment_id=$1,status='paid' WHERE order_id=$2 AND status='created' RETURNING user_id,product",[payment.id,payment.order_id]);if(feature.rowCount&&feature.rows[0].product==='boost'){await boostsReady;await q("INSERT INTO profile_boosts(user_id,started_at,expires_at,status) VALUES($1,NOW(),NOW()+INTERVAL '6 hours','active')",[feature.rows[0].user_id])}}else if(event.event==="payment.failed"&&payment?.order_id){await q("UPDATE subscriptions SET status='failed' WHERE order_id=$1 AND status='created'",[payment.order_id]);await q("UPDATE feature_purchases SET status='failed' WHERE order_id=$1 AND status='created'",[payment.order_id])}res.json({received:true})}catch{res.status(400).json({error:"Invalid webhook payload"})}});
app.use(express.json({limit:"7mb"}));app.use(apiLimiter);app.use(express.static(path.join(__dirname,"../public")));
app.get("/health",(_req,res)=>res.json({ok:true,service:"vibemeet",time:new Date().toISOString()}));
app.get("/api/config",(_req,res)=>res.json({turnUrls:process.env.TURN_URLS||"",turnUsername:process.env.TURN_USERNAME||"",turnCredential:process.env.TURN_CREDENTIAL||"",environment:process.env.NODE_ENV||"development"}));
const userSelect=`id,name,email,avatar,bio,role,verified,vip_until,call_pass_until,status,gender,match_preference,is_guest,guest_expires_at,age,city,college,course,relationship_intent,interests,languages,mode,incognito_enabled,snoozed_until,travel_city,verification_status,verified_photo,hide_exact_location,last_seen_at`;
app.post("/api/auth/register",authLimiter,async(req,res)=>{try{const {name,email,password,gender,matchPreference,mode,age,city,college,course,relationshipIntent,interests,languages}=req.body;if(!name||name.trim().length<2||name.trim().length>40||!email||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!password||password.length<8)return res.status(400).json({error:"Name, valid email and 8+ character password required"});const registrationAge=Number(age);if(!Number.isInteger(registrationAge)||registrationAge<18||registrationAge>100)return res.status(400).json({error:"VibeMeet is 18+ — enter a valid age."});const u=await register(name.trim(),email.trim(),password,{gender,matchPreference,mode,age:Number(age)||null,city,college,course,relationshipIntent,interests,languages});setSessionCookie(res,sign(u),u.is_guest?86400:604800);await audit(req,'register_success',u.id);res.json({user:u,authenticated:true})}catch(e){await audit(req,'register_failure');res.status(e.status||500).json({error:e.message})}});
app.post("/api/auth/guest",authLimiter,async(req,res)=>{try{const u=await guest();setSessionCookie(res,sign(u),86400);await audit(req,'guest_created',u.id);res.json({user:u,authenticated:true})}catch(e){await audit(req,'guest_failure');res.status(e.status||500).json({error:e.message})}});
app.post("/api/auth/login",authLimiter,async(req,res)=>{try{const u=await login(req.body.email,req.body.password);setSessionCookie(res,sign(u),604800);await audit(req,'login_success',u.id);res.json({user:u,authenticated:true})}catch(e){await audit(req,'login_failure');res.status(e.status||500).json({error:e.message})}});
app.get("/api/auth/session",auth,async(req,res)=>{await roadmapReady;const r=await q(`SELECT ${userSelect} FROM users WHERE id=$1`,[req.user.id]);res.json({user:r.rows[0],authenticated:true});});
app.get("/api/auth/socket-token",auth,async(req,res)=>res.json({token:signSocket(req.user)}));
app.post("/api/auth/logout",auth,async(req,res)=>{await q("UPDATE users SET status='offline' WHERE id=$1",[req.user.id]).catch(()=>{});await audit(req,'logout',req.user.id);clearSessionCookie(res);res.json({ok:true});});
app.post("/api/auth/convert-guest",auth,async(req,res)=>{try{if(!req.user.is_guest)return res.status(400).json({error:"This account is already registered."});const email=String(req.body?.email||'').trim().toLowerCase(),password=String(req.body?.password||'');const name=String(req.body?.name||req.user.name).trim().slice(0,40);if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||password.length<8)return res.status(400).json({error:"Enter a valid email and an 8+ character password."});const exists=await q("SELECT id FROM users WHERE email=$1 AND id<>$2",[email,req.user.id]);if(exists.rowCount)return res.status(409).json({error:"Email already registered."});const bcrypt=(await import('bcryptjs')).default;const hash=await bcrypt.hash(password,12);const r=await q(`UPDATE users SET name=$1,email=$2,password_hash=$3,is_guest=false,guest_expires_at=NULL WHERE id=$4 RETURNING ${userSelect}`,[name,email,hash,req.user.id]);setSessionCookie(res,sign(r.rows[0]),604800);res.json({user:r.rows[0],authenticated:true});}catch(e){res.status(e.status||500).json({error:e.message||'Could not convert guest account'})}});
app.post("/api/auth/change-password",auth,authLimiter,async(req,res)=>{try{const current=String(req.body?.currentPassword||''),next=String(req.body?.newPassword||'');if(next.length<8)return res.status(400).json({error:'New password must be at least 8 characters.'});const bcrypt=(await import('bcryptjs')).default;const r=await q('SELECT password_hash FROM users WHERE id=$1',[req.user.id]);if(!r.rowCount||!(await bcrypt.compare(current,r.rows[0].password_hash)))return res.status(401).json({error:'Current password is incorrect.'});const hash=await bcrypt.hash(next,12);await q('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,req.user.id]);clearSessionCookie(res);return res.json({ok:true,reauthRequired:true});}catch(e){res.status(500).json({error:'Could not change password'})}});

app.get("/api/notifications",auth,async(req,res)=>{
  try{
    const r=await q(`
      SELECT n.*, u.name AS actor_name, u.avatar AS actor_avatar
      FROM notifications n
      LEFT JOIN users u ON u.id=n.actor_id
      WHERE n.user_id=$1
      ORDER BY n.created_at DESC
      LIMIT 50
    `,[req.user.id]);

    res.json(r.rows);
  }catch(e){
    res.status(500).json({error:e.message});
  }
});
app.post("/api/notifications/read",auth,async(req,res)=>{
  try{
    await q(
      `UPDATE notifications
       SET read_at=NOW()
       WHERE user_id=$1 AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({ok:true});
  }catch(e){
    res.status(500).json({error:e.message});
  }
});
app.get("/api/me",auth,async(req,res)=>{await roadmapReady;const r=await q(`SELECT ${userSelect} FROM users WHERE id=$1`,[req.user.id]);const u=r.rows[0];res.json({...u,profile_quality:profileQuality(u)});});
app.get("/api/me/profile-quality",auth,async(req,res)=>{await roadmapReady;const r=await q(`SELECT ${userSelect} FROM users WHERE id=$1`,[req.user.id]);res.json(profileQuality(r.rows[0]));});
function parseAvatarData(data){
  if(typeof data!=="string") throw Object.assign(new Error("Photo data is required"),{status:400});
  const m=data.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if(!m) throw Object.assign(new Error("Only JPG, PNG or WebP photos are supported"),{status:400});
  const raw=Buffer.from(m[2],"base64");
  if(!raw.length || raw.length>2*1024*1024) throw Object.assign(new Error("Photo must be 2 MB or smaller"),{status:400});
  return `data:${m[1].toLowerCase()};base64,${raw.toString("base64")}`;
}
app.post("/api/me/avatar",auth,async(req,res)=>{
  try{const avatar=parseAvatarData(req.body?.data);const r=await q(`UPDATE users SET avatar=$1 WHERE id=$2 RETURNING ${userSelect}`,[avatar,req.user.id]);res.json(r.rows[0])}
  catch(e){res.status(e.status||500).json({error:e.message||"Could not save photo"})}
});
app.delete("/api/me/avatar",auth,async(req,res)=>{const r=await q(`UPDATE users SET avatar='' WHERE id=$1 RETURNING ${userSelect}`,[req.user.id]);res.json(r.rows[0])});

app.get("/api/me/photos",auth,async(req,res)=>{await profilePhotosReady;const r=await q("SELECT id,data,mime,position,created_at FROM profile_photos WHERE user_id=$1 ORDER BY position,id",[req.user.id]);res.json(r.rows)});
app.get("/api/users/:id/photos",auth,async(req,res)=>{await profilePhotosReady;const r=await q("SELECT id,data,mime,position FROM profile_photos WHERE user_id=$1 ORDER BY position,id",[req.params.id]);res.json(r.rows)});
app.post("/api/me/photos",auth,async(req,res)=>{try{await profilePhotosReady;const data=parseAvatarData(req.body?.data);const mime=data.slice(5,data.indexOf(";"));const count=await q("SELECT COUNT(*)::int n FROM profile_photos WHERE user_id=$1",[req.user.id]);if(count.rows[0].n>=6)return res.status(400).json({error:"You can have up to 6 profile photos"});const pos=await q("SELECT COALESCE(MAX(position),-1)+1 position FROM profile_photos WHERE user_id=$1",[req.user.id]);const r=await q("INSERT INTO profile_photos(user_id,data,mime,position) VALUES($1,$2,$3,$4) RETURNING id,data,mime,position,created_at",[req.user.id,data,mime,pos.rows[0].position]);if(Number(pos.rows[0].position)===0)await q("UPDATE users SET avatar=$1 WHERE id=$2",[data,req.user.id]);res.json(r.rows[0])}catch(e){res.status(e.status||500).json({error:e.message||"Could not add photo"})}});
app.patch("/api/me/photos/:id",auth,async(req,res)=>{try{await profilePhotosReady;const id=Number(req.params.id);const data=req.body?.data?parseAvatarData(req.body.data):null;if(data){const mime=data.slice(5,data.indexOf(";"));await q("UPDATE profile_photos SET data=$1,mime=$2 WHERE id=$3 AND user_id=$4",[data,mime,id,req.user.id])}if(req.body?.position!==undefined){const pos=Math.max(0,Math.min(5,Number(req.body.position)));const current=await q("SELECT id,position FROM profile_photos WHERE id=$1 AND user_id=$2",[id,req.user.id]);if(!current.rowCount)return res.status(404).json({error:"Photo not found"});const old=current.rows[0].position;const other=await q("SELECT id FROM profile_photos WHERE user_id=$1 AND position=$2",[req.user.id,pos]);if(other.rowCount&&other.rows[0].id!==id)await q("UPDATE profile_photos SET position=$1 WHERE id=$2",[6,other.rows[0].id]);await q("UPDATE profile_photos SET position=$1 WHERE id=$2 AND user_id=$3",[pos,id,req.user.id]);if(old!==pos)await q("UPDATE profile_photos SET position=position-1 WHERE user_id=$1 AND position>$2 AND position<=6",[req.user.id,old])}const r=await q("SELECT id,data,mime,position,created_at FROM profile_photos WHERE user_id=$1 ORDER BY position,id",[req.user.id]);const first=r.rows[0]?.data||"";await q("UPDATE users SET avatar=$1 WHERE id=$2",[first,req.user.id]);res.json(r.rows)}catch(e){res.status(e.status||500).json({error:e.message||"Could not update photo"})}});
app.delete("/api/me/photos/:id",auth,async(req,res)=>{try{await profilePhotosReady;const id=Number(req.params.id);const r0=await q("SELECT id,position FROM profile_photos WHERE id=$1 AND user_id=$2",[id,req.user.id]);if(!r0.rowCount)return res.status(404).json({error:"Photo not found"});await q("DELETE FROM profile_photos WHERE id=$1 AND user_id=$2",[id,req.user.id]);await q("UPDATE profile_photos SET position=position-1 WHERE user_id=$1 AND position>$2",[req.user.id,r0.rows[0].position]);const r=await q("SELECT id,data,mime,position,created_at FROM profile_photos WHERE user_id=$1 ORDER BY position,id",[req.user.id]);await q("UPDATE users SET avatar=$1 WHERE id=$2",[r.rows[0]?.data||"",req.user.id]);res.json(r.rows)}catch(e){res.status(500).json({error:"Could not delete photo"})}});
app.post("/api/me/photos/reorder",auth,async(req,res)=>{try{await profilePhotosReady;const ids=Array.isArray(req.body?.ids)?req.body.ids.map(Number).filter(Number.isInteger):[];if(ids.length<1||ids.length>6)return res.status(400).json({error:"Invalid photo order"});const r=await q("SELECT id FROM profile_photos WHERE user_id=$1 ORDER BY position,id",[req.user.id]);const valid=r.rows.map(x=>x.id);if(ids.some(id=>!valid.includes(id))||new Set(ids).size!==valid.length)return res.status(400).json({error:"Invalid photo order"});for(let i=0;i<ids.length;i++)await q("UPDATE profile_photos SET position=$1 WHERE id=$2 AND user_id=$3",[i,ids[i],req.user.id]);const photos=await q("SELECT id,data,mime,position,created_at FROM profile_photos WHERE user_id=$1 ORDER BY position,id",[req.user.id]);await q("UPDATE users SET avatar=$1 WHERE id=$2",[photos.rows[0]?.data||"",req.user.id]);res.json(photos.rows)}catch(e){res.status(500).json({error:"Could not reorder photos"})}});
app.patch("/api/me",auth,async(req,res)=>{const allowedGender=["male","female","other","prefer_not_to_say"],allowedPref=["any","same","opposite"],allowedMode=["dating","friendship","community"];const b=req.body;const gender=allowedGender.includes(b.gender)?b.gender:null,pref=allowedPref.includes(b.matchPreference)?b.matchPreference:null,mode=allowedMode.includes(b.mode)?b.mode:null;if(!gender||!pref||!mode)return res.status(400).json({error:"Invalid profile preference"});const age=b.age?Math.max(18,Math.min(100,Number(b.age))):null;const interests=Array.isArray(b.interests)?b.interests.map(String).map(x=>x.trim()).filter(Boolean).slice(0,30):[];const languages=Array.isArray(b.languages)?b.languages.map(String).map(x=>x.trim()).filter(Boolean).slice(0,10):[];const avatar=typeof b.avatar==='string'&&b.avatar.length<=5_500_000?b.avatar:"";const name=String(b.name||req.user.name).trim().slice(0,40)||req.user.name;await q(`UPDATE users SET name=$1,avatar=$2,bio=$3,gender=$4,match_preference=$5,mode=$6,age=$7,city=$8,college=$9,course=$10,relationship_intent=$11,interests=$12,languages=$13,lifestyle_tags=$14,hobbies=$15,travel_interests=$16 WHERE id=$17`,[name,avatar,String(b.bio||"").slice(0,280),gender,pref,mode,age,String(b.city||"").slice(0,80),String(b.college||"").slice(0,120),String(b.course||"").slice(0,100),String(b.relationshipIntent||"open_to_connections").slice(0,40),interests,languages,cleanList(b.lifestyleTags,15),cleanList(b.hobbies,15),cleanList(b.travelInterests,15),req.user.id]);const r=await q(`SELECT ${userSelect} FROM users WHERE id=$1`,[req.user.id]);res.json(r.rows[0])});

// Communities and events
app.post("/api/groups", auth, async(req,res)=>{
  try{
    const {name,description}=req.body;

    if(!name || !name.trim()){
      return res.status(400).json({error:"Community name is required"});
    }

    // Check VIP status
    const vip=await q(
      `SELECT vip_until FROM users WHERE id=$1`,
      [req.user.id]
    );

    const isVip=
      vip.rows[0]?.vip_until &&
      new Date(vip.rows[0].vip_until)>new Date();

    // Non-VIP users need one paid community creation
    let purchaseId=null;

    if(!isVip){
      const purchase=await q(
        `UPDATE feature_purchases
         SET status='used'
         WHERE id=(
           SELECT id
           FROM feature_purchases
           WHERE user_id=$1
             AND product='community_create'
             AND status='paid'
           ORDER BY id ASC
           LIMIT 1
         )
         RETURNING id`,
        [req.user.id]
      );

      if(!purchase.rowCount){
        return res.status(402).json({
          error:"₹29 payment is required to create a community."
        });
      }

      purchaseId=purchase.rows[0].id;
    }

    try{
      const group = await q(
        `INSERT INTO groups(name,description,slug,category,created_by)
          VALUES($1,$2,$3,$4,$5)
          RETURNING *`,
        [
        name.trim(),
        description?.trim() || "",
        name.trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""),"General",
        req.user.id
        ]
      );

      await q(
        `INSERT INTO group_members(group_id,user_id)
         VALUES($1,$2)
         ON CONFLICT DO NOTHING`,
        [group.rows[0].id,req.user.id]
      );

      res.json(group.rows[0]);

    }catch(e){
      // If community creation failed, restore the paid purchase
      if(purchaseId){
        await q(
          `UPDATE feature_purchases
           SET status='paid'
           WHERE id=$1`,
          [purchaseId]
        );
      }
      throw e;
    }

  }catch(e){
    console.error("Create community error:",e.message);
    res.status(500).json({error:"Unable to create community"});
  }
});
app.get("/api/groups",auth,async(req,res)=>{const r=await q(`SELECT g.*,COUNT(gm.user_id)::int AS members,EXISTS(SELECT 1 FROM group_members x WHERE x.group_id=g.id AND x.user_id=$1) AS joined FROM groups g LEFT JOIN group_members gm ON gm.group_id=g.id GROUP BY g.id ORDER BY members DESC,g.name`,[req.user.id]);res.json(r.rows)});
app.post("/api/groups/:id/join",auth,async(req,res)=>{await q("INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[req.params.id,req.user.id]);res.json({ok:true})});
app.post("/api/groups/:id/leave",auth,async(req,res)=>{await q("DELETE FROM group_members WHERE group_id=$1 AND user_id=$2",[req.params.id,req.user.id]);res.json({ok:true})});
app.get("/api/groups/:id/members",auth,async(req,res)=>{const r=await q(`SELECT u.id,u.name,u.avatar,u.bio,u.verified,u.age,u.city,u.college,u.course,u.interests,u.mode FROM users u JOIN group_members gm ON gm.user_id=u.id WHERE gm.group_id=$1 ORDER BY u.verified DESC,u.name LIMIT 100`,[req.params.id]);res.json(r.rows)});
app.get("/api/groups/:id/messages",auth,async(req,res)=>{const r=await q(`SELECT m.id,m.body,m.attachment_data,m.attachment_mime,m.created_at,u.id sender_id,u.name sender_name,u.avatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.group_id=$1 ORDER BY m.created_at DESC LIMIT 100`,[req.params.id]);res.json(r.rows.reverse())});
app.get("/api/events",auth,async(req,res)=>{const r=await q(`SELECT e.*,g.name group_name,COUNT(em.user_id)::int attendees,EXISTS(SELECT 1 FROM event_members x WHERE x.event_id=e.id AND x.user_id=$1) AS joined FROM events e JOIN groups g ON g.id=e.group_id LEFT JOIN event_members em ON em.event_id=e.id WHERE e.starts_at>=NOW()-INTERVAL '1 day' GROUP BY e.id,g.name ORDER BY e.starts_at LIMIT 100`,[req.user.id]);res.json(r.rows)});
app.post("/api/groups/:id/events",auth,async(req,res)=>{
  const vip = await q(
  "SELECT vip_until FROM users WHERE id=$1",
  [req.user.id]
);

const isVip =
  vip.rows[0]?.vip_until &&
  new Date(vip.rows[0].vip_until) > new Date();

let purchaseId = null;

if(!isVip){
  const purchase = await q(
    `UPDATE feature_purchases
     SET status='used'
     WHERE id=(
       SELECT id
       FROM feature_purchases
       WHERE user_id=$1
         AND product='event_create'
         AND status='paid'
       ORDER BY id ASC
       LIMIT 1
     )
     RETURNING id`,
    [req.user.id]
  );

  if(!purchase.rowCount){
    return res.status(402).json({
      error:"₹29 payment is required to create an event."
    });
  }

  purchaseId = purchase.rows[0].id;
}


  const member=await q("SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2",[req.params.id,req.user.id]);if(!member.rowCount)return res.status(403).json({error:"Join the group first"});const {title,description,startsAt,location}=req.body;if(!title||!startsAt)return res.status(400).json({error:"Title and start time required"});const r=await q("INSERT INTO events(group_id,creator_id,title,description,starts_at,location) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[req.params.id,req.user.id,String(title).slice(0,120),String(description||"").slice(0,500),startsAt,String(location||"").slice(0,150)]);res.json(r.rows[0])});

app.post("/api/events/:id/join",auth,async(req,res)=>{await q("INSERT INTO event_members(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[req.params.id,req.user.id]);res.json({ok:true})});

// Compatibility and profile discovery
app.get("/api/compatibility/questions",auth,async(_req,res)=>{const r=await q("SELECT * FROM compatibility_questions ORDER BY id");res.json(r.rows)});
app.get("/api/compatibility/answers",auth,async(req,res)=>{const r=await q("SELECT question_id,answer FROM compatibility_answers WHERE user_id=$1",[req.user.id]);res.json(r.rows)});
app.put("/api/compatibility/answers",auth,async(req,res)=>{const answers=Array.isArray(req.body.answers)?req.body.answers:[];for(const a of answers){if(Number.isInteger(Number(a.questionId))&&String(a.answer||"").length<=120)await q("INSERT INTO compatibility_answers(user_id,question_id,answer) VALUES($1,$2,$3) ON CONFLICT(user_id,question_id) DO UPDATE SET answer=EXCLUDED.answer",[req.user.id,Number(a.questionId),String(a.answer)])}res.json({ok:true})});
function oppositeOk(me,target){if(me.match_preference==="any")return true;if(me.match_preference==="same")return !["male","female"].includes(me.gender)||me.gender===target.gender;if(me.match_preference==="opposite")return !["male","female"].includes(me.gender)||["male","female"].includes(target.gender)&&me.gender!==target.gender;return true}
function targetAccepts(me,target){if(target.match_preference==="any")return true;if(target.match_preference==="same")return !["male","female"].includes(target.gender)||target.gender===me.gender;if(target.match_preference==="opposite")return !["male","female"].includes(target.gender)||["male","female"].includes(me.gender)&&target.gender!==me.gender;return true}
app.get("/api/discover",auth,async(req,res)=>{await premiumFeaturesReady;await boostsReady;await roadmapReady;const me=(await q(`SELECT * FROM users WHERE id=$1`,[req.user.id])).rows[0];
 const pref=(await q(`SELECT * FROM user_discovery_preferences WHERE user_id=$1`,[req.user.id])).rows[0]||{};
 const ageMin=Math.max(18,Number(req.query.ageMin)||Number(pref.age_min)||18),ageMax=Math.min(100,Number(req.query.ageMax)||Number(pref.age_max)||100),city=String(req.query.city||'').trim(),college=String(req.query.college||'').trim(),mode=String(req.query.mode||'').trim(),interestList=String(req.query.interests||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).slice(0,10);
 const params=[req.user.id,ageMin,ageMax,city,college,mode];
 let sql=`SELECT u.*,EXISTS(SELECT 1 FROM profile_boosts pb WHERE pb.user_id=u.id AND pb.status='active' AND pb.expires_at>NOW()) AS boosted FROM users u WHERE u.id<>$1 AND u.status NOT IN ('banned','restricted') AND COALESCE(u.age,0) BETWEEN $2 AND $3 AND ($4='' OR LOWER(COALESCE(u.city,''))=LOWER($4)) AND ($5='' OR LOWER(COALESCE(u.college,'')) LIKE LOWER('%'||$5||'%')) AND ($6='' OR u.mode=$6) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=$1)) AND NOT EXISTS(SELECT 1 FROM swipes s WHERE s.swiper_id=$1 AND s.target_id=u.id) AND ((SELECT travel_city FROM users WHERE id=$1) IS NULL OR LOWER(COALESCE(u.city,''))=LOWER((SELECT travel_city FROM users WHERE id=$1))) AND (COALESCE(u.incognito_enabled,FALSE)=FALSE OR EXISTS(SELECT 1 FROM swipes s2 WHERE s2.swiper_id=u.id AND s2.target_id=$1 AND s2.direction='like'))`;
 if(!city && Array.isArray(pref.cities) && pref.cities.length){params.push(pref.cities);sql+=` AND EXISTS(SELECT 1 FROM unnest($${params.length}::text[]) c WHERE LOWER(c)=LOWER(COALESCE(u.city,'')))`;} if(!college && Array.isArray(pref.colleges) && pref.colleges.length){params.push(pref.colleges);sql+=` AND EXISTS(SELECT 1 FROM unnest($${params.length}::text[]) c WHERE LOWER(COALESCE(u.college,'')) LIKE LOWER('%'||c||'%'))`;} const effectiveInterests=interestList.length?interestList:(Array.isArray(pref.interests)?pref.interests.map(x=>String(x).toLowerCase()).slice(0,10):[]); if(effectiveInterests.length){params.push(effectiveInterests);sql+=` AND EXISTS(SELECT 1 FROM unnest(u.interests) i WHERE LOWER(i)=ANY($${params.length}::text[]))`;}
 sql+=' ORDER BY boosted DESC,u.verified DESC,u.created_at DESC LIMIT 120';
 const r=await q(sql,params);const candidates=[];for(const u of r.rows){if(oppositeOk(me,u)&&targetAccepts(me,u))candidates.push(u)}
 const ids=candidates.map(x=>x.id);let groups=[];if(ids.length)groups=(await q("SELECT group_id,user_id FROM group_members WHERE user_id=ANY($1::bigint[])",[ids])).rows;const myGroups=(await q("SELECT group_id FROM group_members WHERE user_id=$1",[req.user.id])).rows.map(x=>Number(x.group_id));const qa=(await q("SELECT question_id,answer FROM compatibility_answers WHERE user_id=$1",[req.user.id])).rows;const qmap=new Map(qa.map(x=>[Number(x.question_id),x.answer]));const answerRows=ids.length?await q("SELECT user_id,question_id,answer FROM compatibility_answers WHERE user_id=ANY($1::bigint[])",[ids]):{rows:[]};const groupMap=new Map();for(const g of groups){const n=Number(g.user_id);if(!groupMap.has(n))groupMap.set(n,new Set());groupMap.get(n).add(Number(g.group_id))}const ansMap=new Map();for(const a of answerRows.rows){const n=Number(a.user_id);if(!ansMap.has(n))ansMap.set(n,new Map());ansMap.get(n).set(Number(a.question_id),a.answer)}
 function score(u){let z=35,reasons=[];const meInts=(me.interests||[]).map(v=>String(v).toLowerCase()),uInts=(u.interests||[]).map(v=>String(v).toLowerCase());const commonInterests=uInts.filter(x=>meInts.includes(x));if(commonInterests.length){z+=Math.min(18,commonInterests.length*4);reasons.push(`${commonInterests.length} shared interest${commonInterests.length>1?'s':''}`)}const commonTravel=(u.travel_interests||[]).filter(x=>(me.travel_interests||[]).map(v=>String(v).toLowerCase()).includes(String(x).toLowerCase()));if(commonTravel.length){z+=Math.min(12,commonTravel.length*4);reasons.push(`${commonTravel.length} shared travel interest${commonTravel.length>1?'s':''}`)}const commonLife=(u.lifestyle_tags||[]).filter(x=>(me.lifestyle_tags||[]).map(v=>String(v).toLowerCase()).includes(String(x).toLowerCase()));if(commonLife.length){z+=Math.min(10,commonLife.length*3);reasons.push(`${commonLife.length} shared lifestyle trait${commonLife.length>1?'s':''}`)}const commonHobbies=(u.hobbies||[]).filter(x=>(me.hobbies||[]).map(v=>String(v).toLowerCase()).includes(String(x).toLowerCase()));if(commonHobbies.length){z+=Math.min(8,commonHobbies.length*3);reasons.push(`${commonHobbies.length} shared hobby${commonHobbies.length>1?'s':''}`)}const commonLang=(u.languages||[]).filter(x=>(me.languages||[]).map(v=>String(v).toLowerCase()).includes(String(x).toLowerCase()));if(commonLang.length){z+=Math.min(7,commonLang.length*3);reasons.push('Shared language')};if(u.age&&me.age){const d=Math.abs(u.age-me.age);if(d<=2){z+=10;reasons.push('Similar age')}else if(d<=5){z+=6}}if(me.city&&u.city&&me.city.toLowerCase()===u.city.toLowerCase()){z+=10;reasons.push('Same city')}if(me.college&&u.college&&me.college.toLowerCase()===u.college.toLowerCase()){z+=8;reasons.push('Same college')}if(me.course&&u.course&&me.course.toLowerCase()===u.course.toLowerCase()){z+=5;reasons.push('Same course')}if(me.relationship_intent&&u.relationship_intent&&me.relationship_intent===u.relationship_intent){z+=7;reasons.push('Same relationship intention')}const common=[...(groupMap.get(u.id)||[])].filter(x=>myGroups.includes(x));if(common.length){z+=Math.min(12,common.length*5);reasons.push(`${common.length} common group${common.length>1?'s':''}`)}const a=ansMap.get(u.id);let sameAnswers=0;if(a)for(const [qid,val] of qmap)if(a.get(qid)===val)sameAnswers++;if(sameAnswers){z+=Math.min(15,sameAnswers*4);reasons.push(`${sameAnswers} compatible answers`)}if(u.mode&&me.mode&&u.mode===me.mode){z+=4;reasons.push('Same connection mode')}if(u.verified){z+=3;reasons.push('Verified profile')}const quality=profileQuality(u);if(quality.score>=90){z+=4;reasons.push('Complete profile')}return {score:Math.min(99,z),reasons:reasons.slice(0,5),quality:quality.score}}
 const out=candidates.map(u=>{const z=score(u);return {id:u.id,name:u.name,avatar:u.avatar,bio:u.bio,verified:u.verified,boosted:!!u.boosted,age:u.age,city:u.city,college:u.college,course:u.course,relationship_intent:u.relationship_intent,interests:u.interests,languages:u.languages,gender:u.gender,mode:u.mode,lifestyle_tags:u.lifestyle_tags||[],hobbies:u.hobbies||[],travel_interests:u.travel_interests||[],verification_status:u.verification_status,verified_photo:u.verified_photo,match_score:z.score,profile_quality:z.quality,reasons:z.reasons}}).sort((a,b)=>b.match_score-a.match_score);res.json(out)});
app.post("/api/swipes",auth,async(req,res)=>{const target=Number(req.body.targetId),direction=req.body.direction;if(!Number.isInteger(target)||target===req.user.id||!['like','pass'].includes(direction))return res.status(400).json({error:"Invalid swipe"});const blocked=await q("SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)",[req.user.id,target]);if(blocked.rowCount)return res.status(403).json({error:"User unavailable"});const vipState=await q("SELECT vip_until>NOW() AS active FROM users WHERE id=$1",[req.user.id]);if(direction==='like'&&!vipState.rows[0]?.active){const used=await q("SELECT COUNT(*)::int n FROM swipes WHERE swiper_id=$1 AND direction='like' AND created_at>=CURRENT_DATE",[req.user.id]);if(Number(used.rows[0]?.n||0)>=20)return res.status(402).json({error:'Free plan: 20 likes per day. VIP unlocks unlimited likes.'});}await q("INSERT INTO swipes(swiper_id,target_id,direction) VALUES($1,$2,$3) ON CONFLICT(swiper_id,target_id) DO UPDATE SET direction=EXCLUDED.direction,created_at=NOW()",[req.user.id,target,direction]);let matched=false;if(direction==='like'){
    const reciprocal=await q(
      "SELECT 1 FROM swipes WHERE swiper_id=$1 AND target_id=$2 AND direction='like'",
      [target,req.user.id]
    );

    if(reciprocal.rowCount){

      const a=Math.min(req.user.id,target);
      const b=Math.max(req.user.id,target);

      await q(
        "INSERT INTO matches(user1_id,user2_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [a,b]
      );

      matched=true;

      await createNotification(
        target,
        req.user.id,
        "match",
        "💞 It's a match!",
        "You both liked each other. Start the conversation!"
      );

      await createNotification(
        req.user.id,
        target,
        "match",
        "💞 It's a match!",
        "You both liked each other. Start the conversation!"
      );

      io.to(`user:${target}`).emit("new:match",{userId:req.user.id});

    } else {

      await createNotification(
        target,
        req.user.id,
        "like",
        "❤️ Someone likes you!",
        "Someone liked your profile. Check Likes You to see who it is."
      );
    }
  }
  await roadmapReady; await q('INSERT INTO analytics_events(user_id,event,properties) VALUES($1,$2,$3)',[req.user.id,direction==='like'?'like':'pass',JSON.stringify({targetId:target,matched})]).catch(()=>{}); if(matched) await q('INSERT INTO analytics_events(user_id,event,properties) VALUES($1,$2,$3)',[req.user.id,'match',JSON.stringify({targetId:target})]).catch(()=>{});
  res.json({ok:true,matched,targetId:target});
});

  app.get("/api/matches",auth,async(req,res)=>{const r=await q(`SELECT m.id,CASE WHEN m.user1_id=$1 THEN u2.id ELSE u1.id END user_id,CASE WHEN m.user1_id=$1 THEN u2.name ELSE u1.name END name,CASE WHEN m.user1_id=$1 THEN u2.avatar ELSE u1.avatar END avatar,CASE WHEN m.user1_id=$1 THEN u2.verified ELSE u1.verified END verified FROM matches m JOIN users u1 ON u1.id=m.user1_id JOIN users u2 ON u2.id=m.user2_id WHERE m.user1_id=$1 OR m.user2_id=$1 ORDER BY m.created_at DESC`,[req.user.id]);res.json(r.rows)});
app.get("/api/likes",auth,async(req,res)=>{
  const vip=await q(
    `SELECT vip_until>NOW() AS active FROM users WHERE id=$1`,
    [req.user.id]
  );
  const vipActive=!!vip.rows[0]?.active;

  const incoming=await q(
    `SELECT s.id AS swipe_id,u.id AS user_id,u.name,u.avatar,u.verified,
      u.age,u.city,u.college,u.course,u.interests,
      s.created_at AS liked_at,
      EXISTS(SELECT 1 FROM super_likes sl WHERE sl.sender_id=u.id AND sl.receiver_id=$1) AS super_liked,
      EXISTS(
        SELECT 1 FROM matches m
        WHERE (m.user1_id=$1 AND m.user2_id=u.id)
           OR (m.user1_id=u.id AND m.user2_id=$1)
      ) AS matched
    FROM swipes s
    JOIN users u ON u.id=s.swiper_id
    WHERE s.target_id=$1
      AND s.direction='like'
      AND u.status<>'banned'
      AND NOT EXISTS(
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id=$1 AND b.blocked_id=u.id)
           OR (b.blocker_id=u.id AND b.blocked_id=$1)
      )
    ORDER BY super_liked DESC,s.created_at DESC`,
    [req.user.id]
  );

  const outgoing=await q(
    `SELECT s.id AS swipe_id,u.id AS user_id,u.name,u.avatar,u.verified,
      u.age,u.city,u.college,u.course,u.interests,
      s.created_at AS liked_at,
      EXISTS(
        SELECT 1 FROM matches m
        WHERE (m.user1_id=$1 AND m.user2_id=u.id)
           OR (m.user1_id=u.id AND m.user2_id=$1)
      ) AS matched
    FROM swipes s
    JOIN users u ON u.id=s.target_id
    WHERE s.swiper_id=$1
      AND s.direction='like'
      AND u.status<>'banned'
      AND NOT EXISTS(
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id=$1 AND b.blocked_id=u.id)
           OR (b.blocker_id=u.id AND b.blocked_id=$1)
      )
    ORDER BY s.created_at DESC`,
    [req.user.id]
  );

  const incomingRows = incoming.rows.filter(x => !x.matched);

  const revealedLikes = await q(
    `SELECT COUNT(*)::int AS count
     FROM feature_purchases
     WHERE user_id=$1
       AND product='extra_like'
       AND status='paid'
       AND used_at IS NOT NULL`,
    [req.user.id]
  );

  const paidExtraLikes = revealedLikes.rows[0]?.count || 0;

  const visibleCount = vipActive
    ? incomingRows.length
    : Math.min(incomingRows.length, 1 + paidExtraLikes);

  res.json({
    incoming: incomingRows.slice(0, visibleCount),
    incomingCount: incomingRows.length,
    lockedCount: Math.max(0, incomingRows.length - visibleCount),
    outgoing: outgoing.rows.filter(x => !x.matched),
    vipActive
  });

});


// Legacy rooms/private chat + moderation
app.get("/api/rooms",optionalAuth,async(_req,res)=>{const r=await q(`SELECT r.*,COUNT(DISTINCT rm.user_id)::int online FROM rooms r LEFT JOIN room_members rm ON rm.room_id=r.id GROUP BY r.id ORDER BY r.name`);res.json(r.rows)});
app.post("/api/rooms/:id/join",auth,async(req,res)=>{const room=await q("SELECT * FROM rooms WHERE id=$1",[req.params.id]);if(!room.rowCount)return res.status(404).json({error:"Room not found"});await q("INSERT INTO room_members(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[req.params.id,req.user.id]);res.json(room.rows[0])});
app.get("/api/rooms/:id/messages",auth,async(req,res)=>{const r=await q(`SELECT m.id,m.body,m.created_at,u.id sender_id,u.name sender_name,u.avatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.room_id=$1 ORDER BY m.created_at DESC LIMIT 100`,[req.params.id]);res.json(r.rows.reverse())});
app.get("/api/users/:id/public-profile",auth,async(req,res)=>{await roadmapReady;const id=Number(req.params.id);if(!Number.isInteger(id)||id===req.user.id)return res.status(400).json({error:"Invalid user"});const r=await q(`SELECT ${userSelect} FROM users WHERE id=$1 AND status NOT IN ('banned','restricted')`,[id]);if(!r.rowCount)return res.status(404).json({error:"Profile unavailable"});const u=r.rows[0];res.json({...u,profile_quality:profileQuality(u).score});});
async function usersAreMatched(a,b){const r=await q("SELECT 1 FROM matches WHERE (user1_id=$1 AND user2_id=$2) OR (user1_id=$2 AND user2_id=$1) LIMIT 1",[a,b]);return !!r.rowCount}

app.get("/api/dm/:id/messages",auth,async(req,res)=>{await messagingFeaturesReady;const id=Number(req.params.id);if(!Number.isInteger(id)||id===req.user.id)return res.status(400).json({error:"Invalid user"});if(!(await usersAreMatched(req.user.id,id)))return res.status(403).json({error:"You can message only mutual matches."});const r=await q(`SELECT m.id,m.body,m.attachment_data,m.attachment_mime,m.created_at,m.read_at,m.reply_to_id,m.attachment_kind,m.deleted_at,u.id sender_id,u.name sender_name,u.avatar,rm.body reply_body,ru.name reply_sender_name,COALESCE((SELECT json_agg(json_build_object('emoji',x.emoji,'count',x.cnt,'mine',x.mine) ORDER BY x.emoji) FROM (SELECT mr.emoji,COUNT(*)::int cnt,BOOL_OR(mr.user_id=$3) mine FROM message_reactions mr WHERE mr.message_id=m.id GROUP BY mr.emoji) x),'[]'::json) reactions FROM messages m JOIN users u ON u.id=m.sender_id LEFT JOIN messages rm ON rm.id=m.reply_to_id LEFT JOIN users ru ON ru.id=rm.sender_id WHERE ((m.sender_id=$1 AND m.receiver_id=$2) OR (m.sender_id=$2 AND m.receiver_id=$1)) ORDER BY m.created_at DESC LIMIT 100`,[req.user.id,id,req.user.id]);res.json(r.rows.reverse())});
app.post("/api/dm/:id/read",auth,async(req,res)=>{await messagingFeaturesReady;const id=Number(req.params.id);if(!Number.isInteger(id)||id===req.user.id)return res.status(400).json({error:"Invalid user"});if(!(await usersAreMatched(req.user.id,id)))return res.status(403).json({error:"You can message only mutual matches."});const r=await q("UPDATE messages SET read_at=NOW() WHERE sender_id=$1 AND receiver_id=$2 AND read_at IS NULL RETURNING id",[id,req.user.id]);const messageIds=r.rows.map(x=>x.id);if(messageIds.length){const pair=`dm:${Math.min(req.user.id,id)}:${Math.max(req.user.id,id)}`;io.to(pair).emit("dm:read",{messageIds,readerId:req.user.id})}res.json({messageIds})});
app.post("/api/dm/:id/image",auth,messageLimiter,async(req,res)=>{await messagingFeaturesReady;try{const id=Number(req.params.id),dataUrl=String(req.body.dataUrl||""),m=dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);if(!Number.isInteger(id)||id===req.user.id)return res.status(400).json({error:"Invalid user"});if(!(await usersAreMatched(req.user.id,id)))return res.status(403).json({error:"You can message only mutual matches."});if(!m)return res.status(400).json({error:"Only JPG, PNG or WebP images are allowed"});const bytes=Buffer.from(m[2],"base64");if(bytes.length>2*1024*1024)return res.status(413).json({error:"Image must be 2 MB or smaller"});const r=await q("INSERT INTO messages(sender_id,receiver_id,body,attachment_data,attachment_mime) VALUES($1,$2,'[Image]',$3,$4) RETURNING id,body,attachment_data,attachment_mime,created_at,read_at",[req.user.id,id,dataUrl,m[1]]);io.to(`dm:${Math.min(req.user.id,id)}:${Math.max(req.user.id,id)}`).emit("dm:message",{...r.rows[0],sender_id:req.user.id,sender_name:req.user.name});await createNotification(id,req.user.id,"message",`💬 ${req.user.name} sent you a photo`,"Open your conversation to view it.");res.json(r.rows[0])}catch{res.status(500).json({error:"Could not send image"})}});
app.post("/api/users/:id/block",auth,async(req,res)=>{const id=Number(req.params.id);if(!Number.isInteger(id)||id===req.user.id)return res.status(400).json({error:"You cannot block yourself"});await q("INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[req.user.id,id]);await q("DELETE FROM matches WHERE (user1_id=$1 AND user2_id=$2) OR (user1_id=$2 AND user2_id=$1)",[req.user.id,id]);await audit(req,'block_user',req.user.id);res.json({ok:true})});
app.delete("/api/matches/:id",auth,async(req,res)=>{const id=Number(req.params.id);if(!Number.isInteger(id)||id===req.user.id)return res.status(400).json({error:"Invalid user"});await q("DELETE FROM matches WHERE (user1_id=$1 AND user2_id=$2) OR (user1_id=$2 AND user2_id=$1)",[req.user.id,id]);await q("DELETE FROM swipes WHERE (swiper_id=$1 AND target_id=$2) OR (swiper_id=$2 AND target_id=$1)",[req.user.id,id]);res.json({ok:true})});
app.post("/api/reports",auth,async(req,res)=>{const reportedUserId=Number(req.body?.reportedUserId),messageId=req.body?.messageId?Number(req.body.messageId):null,reason=String(req.body?.reason||'').trim(),details=String(req.body?.details||'').trim();if(!Number.isInteger(reportedUserId)||reportedUserId===req.user.id||!reason)return res.status(400).json({error:"Missing report fields"});const target=await q("SELECT id,status FROM users WHERE id=$1",[reportedUserId]);if(!target.rowCount)return res.status(404).json({error:"User not found"});const recent=await q("SELECT COUNT(DISTINCT reporter_id)::int n FROM reports WHERE reported_user_id=$1 AND created_at>NOW()-INTERVAL '24 hours' AND status IN ('open','under_review')",[reportedUserId]);const r=await q("INSERT INTO reports(reporter_id,reported_user_id,message_id,reason,details,status) VALUES($1,$2,$3,$4,$5,'open') RETURNING id",[req.user.id,reportedUserId,messageId,reason.slice(0,100),details.slice(0,1000)]);if(Number(recent.rows[0]?.n||0)+1>=3)await q("UPDATE users SET status=CASE WHEN status='online' THEN 'restricted' ELSE status END WHERE id=$1 AND status<>'banned'",[reportedUserId]);res.json({ok:true,reportId:r.rows[0].id,underReview:Number(recent.rows[0]?.n||0)+1>=3});});
app.post("/api/feed/:id/report",auth,async(req,res)=>{const post=await q("SELECT author_id FROM community_posts WHERE id=$1",[req.params.id]);if(!post.rowCount)return res.status(404).json({error:'Post not found'});await q("INSERT INTO content_reports(reporter_id,content_type,content_id,reported_user_id,reason,details) VALUES($1,'post',$2,$3,$4,$5)",[req.user.id,req.params.id,post.rows[0].author_id,String(req.body?.reason||'Community guideline issue').slice(0,100),String(req.body?.details||'').slice(0,1000)]);res.json({ok:true});});

// Premium dating features
app.post("/api/super-likes/use",auth,async(req,res)=>{try{await superLikesReady;const target=Number(req.body?.targetId);if(!Number.isInteger(target)||target===req.user.id)return res.status(400).json({error:"Invalid target"});const blocked=await q("SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)",[req.user.id,target]);if(blocked.rowCount)return res.status(403).json({error:"User unavailable"});const targetUser=await q("SELECT id FROM users WHERE id=$1 AND status<>'banned'",[target]);if(!targetUser.rowCount)return res.status(404).json({error:"Profile unavailable"});const purchase=await q(`UPDATE feature_purchases SET status='used' WHERE id=(SELECT id FROM feature_purchases WHERE user_id=$1 AND product='super_like' AND status='paid' ORDER BY id ASC LIMIT 1) RETURNING id`,[req.user.id]);if(!purchase.rowCount)return res.status(402).json({error:"₹49 payment is required for a Super Like."});await q("INSERT INTO super_likes(sender_id,receiver_id) VALUES($1,$2)",[req.user.id,target]);await q("INSERT INTO swipes(swiper_id,target_id,direction) VALUES($1,$2,'like') ON CONFLICT(swiper_id,target_id) DO UPDATE SET direction='like',created_at=NOW()",[req.user.id,target]);const reciprocal=await q("SELECT 1 FROM swipes WHERE swiper_id=$1 AND target_id=$2 AND direction='like'",[target,req.user.id]);let matched=false;if(reciprocal.rowCount){const a=Math.min(req.user.id,target),b=Math.max(req.user.id,target);await q("INSERT INTO matches(user1_id,user2_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[a,b]);matched=true;await createNotification(target,req.user.id,"match","💞 It's a match!","Your Super Like became a mutual match.");await createNotification(req.user.id,target,"match","💞 It's a match!","Your Super Like became a mutual match.");io.to(`user:${target}`).emit("new:match",{userId:req.user.id})}else await createNotification(target,req.user.id,"super_like","⭐ Super Like received!",`${req.user.name} sent you a Super Like.`);res.json({ok:true,matched,targetId:target})}catch(e){console.error("Super Like error:",e.message);res.status(500).json({error:"Unable to send Super Like"})}});
app.post("/api/swipes/rewind",auth,async(req,res)=>{try{const vip=await q("SELECT vip_until>NOW() AS active FROM users WHERE id=$1",[req.user.id]);if(!vip.rows[0]?.active)return res.status(402).json({error:"Rewind is available with VIP."});const r=await q(`DELETE FROM swipes WHERE id=(SELECT id FROM swipes WHERE swiper_id=$1 ORDER BY created_at DESC LIMIT 1) RETURNING target_id`,[req.user.id]);if(!r.rowCount)return res.status(404).json({error:"Nothing to rewind."});const u=await q("SELECT name FROM users WHERE id=$1",[r.rows[0].target_id]);res.json({ok:true,name:u.rows[0]?.name||"your last swipe"})}catch(e){res.status(500).json({error:"Unable to rewind swipe"})}});
app.post("/api/me/privacy",auth,async(req,res)=>{try{await premiumFeaturesReady;const vip=await q("SELECT vip_until>NOW() AS active FROM users WHERE id=$1",[req.user.id]);if(!vip.rows[0]?.active)return res.status(402).json({error:"Incognito Mode is available with VIP."});const r=await q("UPDATE users SET incognito_enabled=$1 WHERE id=$2 RETURNING incognito_enabled",[!!req.body?.incognito_enabled,req.user.id]);res.json(r.rows[0])}catch(e){res.status(500).json({error:"Unable to update privacy settings"})}});
app.post("/api/me/snooze",auth,async(req,res)=>{try{await premiumFeaturesReady;const r=await q("UPDATE users SET snoozed_until=NOW()+INTERVAL '24 hours' WHERE id=$1 RETURNING snoozed_until",[req.user.id]);res.json(r.rows[0])}catch(e){res.status(500).json({error:"Unable to snooze profile"})}});
app.post("/api/me/travel",auth,async(req,res)=>{try{await premiumFeaturesReady;const vip=await q("SELECT vip_until>NOW() AS active FROM users WHERE id=$1",[req.user.id]);if(!vip.rows[0]?.active)return res.status(402).json({error:"Travel Mode is available with VIP."});const city=String(req.body?.city||'').trim().slice(0,80);const r=await q("UPDATE users SET travel_city=NULLIF($1,'') WHERE id=$2 RETURNING travel_city",[city,req.user.id]);res.json(r.rows[0])}catch(e){res.status(500).json({error:"Unable to update Travel Mode"})}});
app.post("/api/profile-views/:id",auth,async(req,res)=>{try{await premiumFeaturesReady;const id=Number(req.params.id);if(!Number.isInteger(id)||id===req.user.id)return res.json({ok:true});await q("INSERT INTO profile_views(viewer_id,viewed_id) VALUES($1,$2) ON CONFLICT(viewer_id,viewed_id) DO UPDATE SET created_at=NOW()",[req.user.id,id]);await createNotification(id,req.user.id,"profile_view","👀 Someone viewed your profile",`${req.user.name} checked out your VibeMeet profile.`);res.json({ok:true})}catch(e){res.status(500).json({error:"Unable to record profile view"})}});
app.get("/api/profile-views",auth,async(req,res)=>{try{await premiumFeaturesReady;const vip=await q("SELECT vip_until>NOW() AS active FROM users WHERE id=$1",[req.user.id]);if(!vip.rows[0]?.active)return res.status(402).json({error:"Profile views are available with VIP."});const r=await q(`SELECT pv.id,pv.created_at,u.id AS user_id,u.name,u.avatar,u.age,u.city,u.verified FROM profile_views pv JOIN users u ON u.id=pv.viewer_id WHERE pv.viewed_id=$1 ORDER BY pv.created_at DESC LIMIT 100`,[req.user.id]);res.json(r.rows)}catch(e){res.status(500).json({error:"Unable to load profile views"})}});
app.post("/api/compliments",auth,async(req,res)=>{try{await premiumFeaturesReady;const receiver=Number(req.body?.receiverId),body=String(req.body?.body||'').trim();if(!Number.isInteger(receiver)||receiver===req.user.id||!body||body.length>150)return res.status(400).json({error:"Write a short compliment (max 150 characters)."});const vip=await q("SELECT vip_until>NOW() AS active FROM users WHERE id=$1",[req.user.id]);if(!vip.rows[0]?.active)return res.status(402).json({error:"Compliments are available with VIP."});await q("INSERT INTO compliments(sender_id,receiver_id,body) VALUES($1,$2,$3)",[req.user.id,receiver,body]);await q("INSERT INTO swipes(swiper_id,target_id,direction) VALUES($1,$2,'like') ON CONFLICT(swiper_id,target_id) DO UPDATE SET direction='like',created_at=NOW()",[req.user.id,receiver]);await createNotification(receiver,req.user.id,"compliment","💌 New compliment",`${req.user.name}: ${body}`);res.json({ok:true})}catch(e){res.status(500).json({error:"Unable to send compliment"})}});
app.get('/api/me/export',auth,async(req,res)=>{try{const id=req.user.id;const [u,photos,swipes,matches,groups,trips,notifications]=await Promise.all([q(`SELECT id,name,email,bio,role,verified,age,city,college,course,relationship_intent,interests,languages,mode,lifestyle_tags,hobbies,travel_interests,created_at FROM users WHERE id=$1`,[id]),q('SELECT id,position,mime,created_at FROM profile_photos WHERE user_id=$1 ORDER BY position',[id]),q('SELECT target_id,direction,created_at FROM swipes WHERE swiper_id=$1',[id]),q('SELECT * FROM matches WHERE user1_id=$1 OR user2_id=$1',[id]),q('SELECT g.id,g.name,g.slug,gm.joined_at FROM group_members gm JOIN groups g ON g.id=gm.group_id WHERE gm.user_id=$1',[id]),q('SELECT id,title,start_date,end_date,status,created_at FROM trips WHERE host_id=$1',[id]),q('SELECT type,title,body,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200',[id])]);res.json({exportedAt:new Date().toISOString(),profile:u.rows[0],photos:photos.rows,swipes:swipes.rows,matches:matches.rows,groups:groups.rows,trips:trips.rows,notifications:notifications.rows})}catch(e){res.status(500).json({error:e.message})}});
app.delete('/api/me',auth,async(req,res)=>{if(String(req.body?.confirm||'')!=='DELETE MY ACCOUNT')return res.status(400).json({error:'Type DELETE MY ACCOUNT to confirm'});try{await q('DELETE FROM users WHERE id=$1',[req.user.id]);clearSessionCookie(res);res.json({ok:true})}catch(e){res.status(500).json({error:'Could not delete account'})}});
function tokenHash(token){return crypto.createHash('sha256').update(token).digest('hex')}
app.post('/api/auth/password-reset/request',authLimiter,async(req,res)=>{try{await roadmapReady;const email=String(req.body?.email||'').trim().toLowerCase(),u=(await q('SELECT id,email FROM users WHERE email=$1',[email])).rows[0];if(!u)return res.json({ok:true,message:'If an account exists, reset instructions will be sent.'});const raw=crypto.randomBytes(32).toString('hex');await q('UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL',[u.id]);await q('INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL \'30 minutes\')',[u.id,tokenHash(raw)]);const configured=Boolean(process.env.EMAIL_WEBHOOK_URL);if(configured){try{await fetch(process.env.EMAIL_WEBHOOK_URL,{method:'POST',headers:{'content-type':'application/json','authorization':process.env.EMAIL_WEBHOOK_AUTH||''},body:JSON.stringify({type:'password_reset',email:u.email,token:raw})})}catch{}}res.json({ok:true,message:'If an account exists, reset instructions will be sent.',devToken:process.env.NODE_ENV==='production'?undefined:raw,emailDeliveryConfigured:configured})}catch(e){res.status(500).json({error:'Unable to start password reset'})}});
app.post('/api/auth/password-reset/confirm',authLimiter,async(req,res)=>{try{const token=String(req.body?.token||''),password=String(req.body?.password||'');if(token.length<20||password.length<8)return res.status(400).json({error:'Valid reset token and 8+ character password required'});const row=(await q('SELECT id,user_id FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW()',[tokenHash(token)])).rows[0];if(!row)return res.status(400).json({error:'Reset token is invalid or expired'});const bcrypt=(await import('bcryptjs')).default;const hash=await bcrypt.hash(password,12);await q('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,row.user_id]);await q('UPDATE password_reset_tokens SET used_at=NOW() WHERE id=$1',[row.id]);res.json({ok:true})}catch(e){res.status(500).json({error:'Unable to reset password'})}});
app.post('/api/auth/email-verification/request',auth,async(req,res)=>{try{await roadmapReady;const raw=crypto.randomBytes(32).toString('hex');await q('UPDATE email_verification_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL',[req.user.id]);await q('INSERT INTO email_verification_tokens(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL \'24 hours\')',[req.user.id,tokenHash(raw)]);const configured=Boolean(process.env.EMAIL_WEBHOOK_URL);if(configured){try{await fetch(process.env.EMAIL_WEBHOOK_URL,{method:'POST',headers:{'content-type':'application/json','authorization':process.env.EMAIL_WEBHOOK_AUTH||''},body:JSON.stringify({type:'email_verification',email:req.user.email,token:raw})})}catch{}}res.json({ok:true,devToken:process.env.NODE_ENV==='production'?undefined:raw,emailDeliveryConfigured:configured})}catch(e){res.status(500).json({error:'Unable to create verification request'})}});
app.post('/api/auth/email-verification/confirm',auth,async(req,res)=>{try{const token=String(req.body?.token||'');const row=(await q('SELECT id FROM email_verification_tokens WHERE user_id=$1 AND token_hash=$2 AND used_at IS NULL AND expires_at>NOW()',[req.user.id,tokenHash(token)])).rows[0];if(!row)return res.status(400).json({error:'Verification token is invalid or expired'});await q('UPDATE email_verification_tokens SET used_at=NOW() WHERE id=$1',[row.id]);res.json({ok:true})}catch(e){res.status(500).json({error:'Unable to verify email'})}});

// Roadmap: safety, richer matching, AI helpers, analytics and privacy
async function ensureRoadmapUser(userId){
  await roadmapReady;
  await q(`INSERT INTO safety_settings(user_id) VALUES($1) ON CONFLICT DO NOTHING`,[userId]);
  await q(`INSERT INTO notification_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING`,[userId]);
  await q(`INSERT INTO user_discovery_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING`,[userId]);
}
function cleanList(v,max=20){return Array.isArray(v)?v.map(x=>String(x).trim()).filter(Boolean).slice(0,max):[]}
app.get('/api/safety',auth,async(req,res)=>{try{await ensureRoadmapUser(req.user.id);const [s,e,b,r]=await Promise.all([q('SELECT * FROM safety_settings WHERE user_id=$1',[req.user.id]),q('SELECT * FROM emergency_contacts WHERE user_id=$1 ORDER BY is_primary DESC,created_at',[req.user.id]),q('SELECT b.blocked_id,u.name,u.avatar,b.created_at FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=$1 ORDER BY b.created_at DESC',[req.user.id]),q("SELECT id,reason,details,status,created_at FROM reports WHERE reporter_id=$1 ORDER BY created_at DESC LIMIT 50",[req.user.id])]);res.json({settings:s.rows[0],emergencyContacts:e.rows,blocks:b.rows,reports:r.rows})}catch(e){res.status(500).json({error:e.message})}});
app.patch('/api/safety',auth,async(req,res)=>{try{await ensureRoadmapUser(req.user.id);const b=req.body||{};const r=await q(`UPDATE safety_settings SET hide_exact_location=$1,show_online_status=$2,show_last_seen=$3,allow_profile_view_notifications=$4,allow_message_notifications=$5,allow_match_notifications=$6,updated_at=NOW() WHERE user_id=$7 RETURNING *`,[b.hideExactLocation!==false,b.showOnlineStatus!==false,!!b.showLastSeen,b.allowProfileViews!==false,b.allowMessages!==false,b.allowMatches!==false,req.user.id]);await q('UPDATE users SET hide_exact_location=$1 WHERE id=$2',[b.hideExactLocation!==false,req.user.id]);res.json(r.rows[0])}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/report-reasons',auth,async(_req,res)=>res.json(['Fake profile','Harassment or abusive behavior','Scam or financial request','Spam or advertising','Inappropriate photo','Underage concern','Threat or safety concern','Other']));
app.get('/api/blocks',auth,async(req,res)=>{const r=await q('SELECT b.blocked_id AS user_id,u.name,u.avatar,b.created_at FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=$1 ORDER BY b.created_at DESC',[req.user.id]);res.json(r.rows)});
app.delete('/api/users/:id/block',auth,async(req,res)=>{const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:'Invalid user'});await q('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2',[req.user.id,id]);res.json({ok:true})});
app.get('/api/emergency-contacts',auth,async(req,res)=>{await roadmapReady;const r=await q('SELECT * FROM emergency_contacts WHERE user_id=$1 ORDER BY is_primary DESC,created_at',[req.user.id]);res.json(r.rows)});
app.post('/api/emergency-contacts',auth,async(req,res)=>{await roadmapReady;const name=String(req.body?.name||'').trim().slice(0,80),phone=String(req.body?.phone||'').trim().slice(0,30),relation=String(req.body?.relation||'').trim().slice(0,40);if(!name||!phone)return res.status(400).json({error:'Name and phone are required'});const r=await q('INSERT INTO emergency_contacts(user_id,name,phone,relation,is_primary) VALUES($1,$2,$3,$4,NOT EXISTS(SELECT 1 FROM emergency_contacts WHERE user_id=$1)) RETURNING *',[req.user.id,name,phone,relation]);res.status(201).json(r.rows[0])});
app.patch('/api/emergency-contacts/:id',auth,async(req,res)=>{const id=Number(req.params.id);const r=await q('UPDATE emergency_contacts SET name=$1,phone=$2,relation=$3,updated_at=NOW() WHERE id=$4 AND user_id=$5 RETURNING *',[String(req.body?.name||'').trim().slice(0,80),String(req.body?.phone||'').trim().slice(0,30),String(req.body?.relation||'').trim().slice(0,40),id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Contact not found'});res.json(r.rows[0])});
app.delete('/api/emergency-contacts/:id',auth,async(req,res)=>{await q('DELETE FROM emergency_contacts WHERE id=$1 AND user_id=$2',[Number(req.params.id),req.user.id]);res.json({ok:true})});
app.post('/api/date-safety/shares',auth,async(req,res)=>{await roadmapReady;const b=req.body||{},title=String(b.title||'My VibeMeet date').slice(0,160),location=String(b.locationLabel||'').slice(0,180),notes=String(b.notes||'').slice(0,500);const contactId=b.contactId?Number(b.contactId):null,matchUserId=b.matchUserId?Number(b.matchUserId):null;const r=await q(`INSERT INTO date_safety_shares(user_id,contact_id,match_user_id,title,start_at,end_at,location_label,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[req.user.id,contactId,matchUserId,title,b.startAt||null,b.endAt||null,location,notes]);res.status(201).json(r.rows[0])});
app.get('/api/date-safety/shares',auth,async(req,res)=>{const r=await q(`SELECT d.*,c.name contact_name,c.phone contact_phone FROM date_safety_shares d LEFT JOIN emergency_contacts c ON c.id=d.contact_id WHERE d.user_id=$1 ORDER BY d.created_at DESC LIMIT 50`,[req.user.id]);res.json(r.rows)});
app.post('/api/date-safety/shares/:id/checkin',auth,async(req,res)=>{const id=Number(req.params.id),own=await q('SELECT 1 FROM date_safety_shares WHERE id=$1 AND user_id=$2 AND status=\'active\'',[id,req.user.id]);if(!own.rowCount)return res.status(404).json({error:'Safety share not found'});const status=['safe','help'].includes(req.body?.status)?req.body.status:'safe';const r=await q('INSERT INTO date_safety_checkins(share_id,user_id,status,note,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id,req.user.id,status,String(req.body?.note||'').slice(0,300),req.body?.latitude??null,req.body?.longitude??null]);if(status==='help')await createNotification(req.user.id,null,'safety','🚨 Safety check-in marked HELP','A safety check-in was marked as needing help.');res.json(r.rows[0])});
app.post('/api/date-safety/shares/:id/end',auth,async(req,res)=>{const r=await q("UPDATE date_safety_shares SET status='ended',ended_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING *",[Number(req.params.id),req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Safety share not found'});res.json(r.rows[0])});
app.get('/api/match-preferences',auth,async(req,res)=>{await ensureRoadmapUser(req.user.id);const r=await q('SELECT * FROM user_discovery_preferences WHERE user_id=$1',[req.user.id]);res.json(r.rows[0])});
app.patch('/api/match-preferences',auth,async(req,res)=>{await ensureRoadmapUser(req.user.id);const b=req.body||{};const min=Math.max(18,Math.min(100,Number(b.ageMin)||18)),max=Math.max(min,Math.min(100,Number(b.ageMax)||100));const lists={cities:cleanList(b.cities),colleges:cleanList(b.colleges),interests:cleanList(b.interests),travel_interests:cleanList(b.travelInterests),relationship_intents:cleanList(b.relationshipIntents),lifestyle_tags:cleanList(b.lifestyleTags),languages:cleanList(b.languages),hobbies:cleanList(b.hobbies)};const r=await q(`UPDATE user_discovery_preferences SET age_min=$1,age_max=$2,cities=$3,colleges=$4,interests=$5,travel_interests=$6,relationship_intents=$7,lifestyle_tags=$8,languages=$9,hobbies=$10,updated_at=NOW() WHERE user_id=$11 RETURNING *`,[min,max,lists.cities,lists.colleges,lists.interests,lists.travel_interests,lists.relationship_intents,lists.lifestyle_tags,lists.languages,lists.hobbies,req.user.id]);res.json(r.rows[0])});
app.post('/api/analytics/events',auth,async(req,res)=>{try{await roadmapReady;const event=String(req.body?.event||'').trim().slice(0,80);if(!event)return res.status(400).json({error:'Event required'});await q('INSERT INTO analytics_events(user_id,event,properties,session_id) VALUES($1,$2,$3,$4)',[req.user.id,event,JSON.stringify(req.body?.properties||{}),String(req.body?.sessionId||'').slice(0,120)]);res.status(201).json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/analytics/me',auth,async(req,res)=>{const [counts,funnel]=await Promise.all([q(`SELECT event,COUNT(*)::int count FROM analytics_events WHERE user_id=$1 GROUP BY event ORDER BY count DESC`,[req.user.id]),q(`SELECT COUNT(*) FILTER(WHERE event='signup')::int signup,COUNT(*) FILTER(WHERE event='profile_complete')::int profile_complete,COUNT(*) FILTER(WHERE event='discover_view')::int discover_view,COUNT(*) FILTER(WHERE event='like')::int likes,COUNT(*) FILTER(WHERE event='match')::int matches,COUNT(*) FILTER(WHERE event='message')::int messages,COUNT(*) FILTER(WHERE event='trip_created')::int trips FROM analytics_events WHERE user_id=$1`,[req.user.id])]);res.json({counts:counts.rows,funnel:funnel.rows[0]})});
app.get('/api/admin/analytics',auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});const [events,funnel,daily]=await Promise.all([q(`SELECT event,COUNT(*)::int count FROM analytics_events GROUP BY event ORDER BY count DESC LIMIT 40`),q(`SELECT COUNT(*) FILTER(WHERE event='signup')::int signups,COUNT(*) FILTER(WHERE event='profile_complete')::int profiles,COUNT(*) FILTER(WHERE event='discover_view')::int discoveries,COUNT(*) FILTER(WHERE event='like')::int likes,COUNT(*) FILTER(WHERE event='match')::int matches,COUNT(*) FILTER(WHERE event='message')::int messages,COUNT(*) FILTER(WHERE event='trip_created')::int trips FROM analytics_events`),q(`SELECT DATE(created_at) day,COUNT(DISTINCT user_id)::int active_users,COUNT(*)::int events FROM analytics_events WHERE created_at>NOW()-INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY day DESC`)]);res.json({events:events.rows,funnel:funnel.rows[0],daily:daily.rows})});
app.get('/api/verification/me',auth,async(req,res)=>{await roadmapReady;const r=await q(`SELECT verification_status,verified,verified_photo FROM users WHERE id=$1`,[req.user.id]);const requests=await q('SELECT id,kind,status,review_note,created_at,reviewed_at FROM verification_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10',[req.user.id]);res.json({user:r.rows[0],requests:requests.rows})});
app.post('/api/verification/request',auth,async(req,res)=>{await roadmapReady;const selfie=String(req.body?.selfieData||''),kind=String(req.body?.kind||'profile').slice(0,30);if(!selfie.startsWith('data:image/'))return res.status(400).json({error:'A selfie/photo is required'});const bytes=Buffer.from((selfie.split(',')[1]||''),'base64');if(bytes.length>3*1024*1024)return res.status(413).json({error:'Verification photo must be 3 MB or smaller'});const pending=await q("SELECT 1 FROM verification_requests WHERE user_id=$1 AND status='pending'",[req.user.id]);if(pending.rowCount)return res.status(409).json({error:'A verification request is already under review'});const r=await q(`INSERT INTO verification_requests(user_id,kind,selfie_data,status) VALUES($1,$2,$3,'pending') RETURNING id,kind,status,created_at`,[req.user.id,kind,selfie]);await q("UPDATE users SET verification_status='pending' WHERE id=$1",[req.user.id]);res.status(201).json(r.rows[0])});
app.get('/api/admin/verifications',auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});const r=await q(`SELECT vr.*,u.name,u.email,u.avatar FROM verification_requests vr JOIN users u ON u.id=vr.user_id WHERE vr.status='pending' ORDER BY vr.created_at ASC LIMIT 100`);res.json(r.rows)});
app.post('/api/admin/verifications/:id',auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});const id=Number(req.params.id),action=req.body?.action==='approve'?'approve':'reject',note=String(req.body?.note||'').slice(0,500);const vr=(await q('SELECT user_id FROM verification_requests WHERE id=$1 AND status=\'pending\'',[id])).rows[0];if(!vr)return res.status(404).json({error:'Verification request not found'});await q(`UPDATE verification_requests SET status=$1,reviewer_id=$2,review_note=$3,reviewed_at=NOW() WHERE id=$4`,[action==='approve'?'approved':'rejected',req.user.id,note,id]);await q(`UPDATE users SET verification_status=$1,verified=$2,verified_photo=$3 WHERE id=$4`,[action==='approve'?'verified':'rejected',action==='approve',action==='approve',vr.user_id]);await createNotification(vr.user_id,req.user.id,'verification',action==='approve'?'✅ Profile verified':'Verification update',action==='approve'?'Your VibeMeet profile is verified.':'Your verification request was not approved. You can submit another request later.');res.json({ok:true})});
app.get('/api/notifications/preferences',auth,async(req,res)=>{await ensureRoadmapUser(req.user.id);const r=await q('SELECT * FROM notification_preferences WHERE user_id=$1',[req.user.id]);res.json(r.rows[0])});
app.patch('/api/notifications/preferences',auth,async(req,res)=>{await ensureRoadmapUser(req.user.id);const b=req.body||{};const r=await q(`UPDATE notification_preferences SET in_app=$1,push=$2,email=$3,likes=$4,matches=$5,messages=$6,trips=$7,events=$8,safety=$9,updated_at=NOW() WHERE user_id=$10 RETURNING *`,[b.inApp!==false,b.push!==false,!!b.email,b.likes!==false,b.matches!==false,b.messages!==false,b.trips!==false,b.events!==false,b.safety!==false,req.user.id]);res.json(r.rows[0])});
app.post('/api/push/subscribe',auth,async(req,res)=>{await roadmapReady;const s=req.body||{};if(!s.endpoint||!s.keys?.p256dh||!s.keys?.auth)return res.status(400).json({error:'Invalid push subscription'});await q(`INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth) VALUES($1,$2,$3,$4) ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth`,[req.user.id,String(s.endpoint),String(s.keys.p256dh),String(s.keys.auth)]);res.json({ok:true})});
app.post('/api/events/:id/reminder',auth,async(req,res)=>{const eventId=Number(req.params.id),mins=Math.max(5,Math.min(10080,Number(req.body?.minutes)||60));const joined=await q('SELECT 1 FROM event_members WHERE event_id=$1 AND user_id=$2',[eventId,req.user.id]);if(!joined.rowCount)return res.status(403).json({error:'Join the event before setting a reminder'});const r=await q('INSERT INTO event_reminders(event_id,user_id,remind_minutes) VALUES($1,$2,$3) ON CONFLICT(event_id,user_id) DO UPDATE SET remind_minutes=EXCLUDED.remind_minutes RETURNING *',[eventId,req.user.id,mins]);res.json(r.rows[0])});
app.delete('/api/events/:id/reminder',auth,async(req,res)=>{await q('DELETE FROM event_reminders WHERE event_id=$1 AND user_id=$2',[Number(req.params.id),req.user.id]);res.json({ok:true})});

app.post('/api/ai/icebreaker',auth,async(req,res)=>{const p=req.body?.profile||{},ints=cleanList(p.interests,6);const options=ints.length?[`I noticed you like ${ints[0]} too — what got you into it?`,`You mentioned ${ints.slice(0,2).join(' and ')}. Which one are you more obsessed with right now?`,`Quick question: what is your ideal plan for a free weekend?`]:['What is something you could talk about for hours?','What is your ideal weekend like?','What is one place you really want to visit?'];res.json({suggestions:options})});
app.post('/api/ai/profile-assist',auth,async(req,res)=>{const b=req.body||{},name=String(b.name||req.user.name).trim(),ints=cleanList(b.interests,8),city=String(b.city||'').trim(),travel=cleanList(b.travelInterests,4);let bio=`${name} is into ${ints.slice(0,4).join(', ')||'good conversations and new experiences'}.`;if(travel.length)bio+=` Always up for ${travel.slice(0,2).join(' and ')}.`;if(city)bio+=` Based in ${city}, looking for genuine connections and fun plans.`;res.json({bio:bio.slice(0,280),headline:`${ints.slice(0,3).join(' · ')||'Good vibes · New connections'}`})});
app.post('/api/ai/match-assistant',auth,async(req,res)=>{const qv=String(req.body?.query||'').toLowerCase();const people=(await q(`SELECT * FROM users WHERE id<>$1 AND status NOT IN ('banned','restricted') AND COALESCE(age,0)>=18 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=users.id) OR (b.blocker_id=users.id AND b.blocked_id=$1)) AND NOT EXISTS(SELECT 1 FROM swipes s WHERE s.swiper_id=$1 AND s.target_id=users.id) AND (COALESCE(users.incognito_enabled,FALSE)=FALSE OR EXISTS(SELECT 1 FROM swipes s2 WHERE s2.swiper_id=users.id AND s2.target_id=$1 AND s2.direction='like')) LIMIT 250`,[req.user.id])).rows;const words=qv.split(/\s+/).filter(x=>x.length>2);const scored=people.map(p=>{const hay=[p.name,p.city,p.college,p.course,p.relationship_intent,p.mode,...(p.interests||[]),...(p.languages||[]),...(p.travel_interests||[]),...(p.hobbies||[])].join(' ').toLowerCase();const hits=words.filter(w=>hay.includes(w)).length;return {p,hits}}).filter(x=>x.hits>0).sort((a,b)=>b.hits-a.hits).slice(0,12).map(x=>({id:x.p.id,name:x.p.name,avatar:x.p.avatar,city:x.p.city,college:x.p.college,interests:x.p.interests,match_score:Math.min(99,55+x.hits*10),reasons:['Matched your AI search'] }));res.json({query:qv,results:scored})});
app.post('/api/ai/trip-planner',auth,async(req,res)=>{const destination=String(req.body?.destination||'').trim();const days=Math.max(1,Math.min(14,Number(req.body?.days)||4));const d=(await q(`SELECT * FROM destinations WHERE name ILIKE $1 LIMIT 1`,[`%${destination}%`])).rows[0];if(!d)return res.status(404).json({error:'Destination not found. Try an Uttarakhand destination such as Munsiyari, Auli or Rishikesh.'});const stops=Array.isArray(d.route_stops)?d.route_stops:[];const itinerary=Array.from({length:days},(_,i)=>({day:i+1,title:i===0?'Arrival & local exploration':i===days-1?'Slow morning & return':'Explore '+(stops[i-1]||d.name),ideas:i===0?[`Reach ${d.name}`,`Check in and explore nearby`]:i===days-1?['Breakfast','Pack and return safely']:[`Visit ${stops[i-1]||d.name}`,`Try a local experience`,`Keep an emergency buffer`] }));res.json({destination:d.name,days,budget:calcTripBudget(d,days,'balanced',2),itinerary})});
app.get('/api/admin/verification-count',auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});const r=await q("SELECT COUNT(*)::int count FROM verification_requests WHERE status='pending'");res.json(r.rows[0])});

// Payments
const razorpay=process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET?new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET}):null;
async function createOrder(req,res,product){if(!razorpay)return res.status(503).json({error:"Payments not configured"});const amount=product==='vip'?Number(process.env.VIP_AMOUNT||199):Number(process.env.CALL_PASS_AMOUNT||99),days=Number(process.env.CALL_PASS_DAYS||7);const order=await razorpay.orders.create({amount:amount*100,currency:'INR',receipt:`${product}_${req.user.id}_${Date.now()}`});await q("INSERT INTO subscriptions(user_id,order_id,amount_paise,status,product) VALUES($1,$2,$3,'created',$4)",[req.user.id,order.id,amount*100,product]);res.json({orderId:order.id,amount:amount*100,keyId:process.env.RAZORPAY_KEY_ID,days})}
app.post("/api/vip/order",auth,(req,res)=>createOrder(req,res,'vip'));app.post("/api/call-pass/order",auth,(req,res)=>createOrder(req,res,'call_pass'));
const FEATURE_PRICES = {
  community_create: 29,
  event_create: 29,
  extra_like: 19,
  super_like: 49,
  boost: 99
};

async function createFeatureOrder(req, res, product) {
  try {
    if (!razorpay) {
      return res.status(503).json({ error: "Payments not configured" });
    }

    const price = FEATURE_PRICES[product];

    if (!price) {
      return res.status(400).json({ error: "Invalid feature" });
    }

    const order = await razorpay.orders.create({
      amount: price * 100,
      currency: "INR",
      receipt: `${product}_${req.user.id}_${Date.now()}`
    });

    await q(
      `INSERT INTO feature_purchases
       (user_id, product, amount_paise, status, order_id)
       VALUES ($1,$2,$3,'created',$4)`,
      [req.user.id, product, price * 100, order.id]
    );

    res.json({
      orderId: order.id,
      amount: price * 100,
      keyId: process.env.RAZORPAY_KEY_ID,
      product
    });
  } catch (e) {
    console.error("Feature order error:", e.message);
    res.status(500).json({ error: "Unable to create payment order" });
  }
}

app.post("/api/features/order", auth, async (req, res) => {
  await createFeatureOrder(req, res, req.body.product);
});
app.post("/api/features/verify", auth, async (req, res) => {
  try {
    const { orderId, paymentId, signature } = req.body;

    if (!process.env.RAZORPAY_KEY_SECRET) {
      return res.status(503).json({ error: "Payments not configured" });
    }

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ error: "Payment details are required" });
    }

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(orderId + "|" + paymentId)
      .digest("hex");

    if (
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      )
    ) {
      return res.status(400).json({ error: "Invalid payment signature" });
    }

    const purchase = await q(
      `UPDATE feature_purchases
       SET payment_id=$1,status='paid'
       WHERE user_id=$2
         AND order_id=$3
         AND status='created'
       RETURNING id,product,amount_paise`,
      [paymentId, req.user.id, orderId]
    );

    if (!purchase.rowCount) {
      return res.status(409).json({
        error: "Payment already processed or order not found"
      });
    }

    const product = purchase.rows[0].product;

    if (product === "boost") {
      await boostsReady;
      await q(
        `INSERT INTO profile_boosts
         (user_id,started_at,expires_at,status)
         VALUES ($1,NOW(),NOW()+INTERVAL '6 hours','active')`,
        [req.user.id]
      );
    }

    res.json({
      ok: true,
      product
    });
  } catch (e) {
    console.error("Feature payment verification error:", e.message);
    res.status(500).json({
      error: "Unable to verify payment"
    });
  }
});

app.post("/api/features/use", auth, async (req, res) => {
  try {
    const { product } = req.body;

    if (product !== "extra_like") {
      return res.status(400).json({ error: "Invalid feature" });
    }

    const used = await q(
      `UPDATE feature_purchases
       SET used_at = NOW()
       WHERE id = (
         SELECT id
         FROM feature_purchases
         WHERE user_id = $1
           AND product = 'extra_like'
           AND status = 'paid'
           AND used_at IS NULL
         ORDER BY created_at ASC
         LIMIT 1
       )
       RETURNING id`,
      [req.user.id]
    );

    if (!used.rowCount) {
      return res.status(402).json({
        error: "No unused Like reveal available"
      });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("Feature use error:", e.message);
    res.status(500).json({ error: "Unable to use feature" });
  }
});

app.post("/api/payments/verify",auth,async(req,res)=>{const {orderId,paymentId,signature}=req.body;if(!process.env.RAZORPAY_KEY_SECRET)return res.status(503).json({error:"Payments not configured"});const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(orderId+'|'+paymentId).digest('hex');if(!signature||signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return res.status(400).json({error:'Invalid payment signature'});const sub=await q("UPDATE subscriptions SET payment_id=$1,status='paid' WHERE user_id=$2 AND order_id=$3 AND status<>'paid' RETURNING product",[paymentId,req.user.id,orderId]);if(!sub.rowCount)return res.status(409).json({error:'Payment already processed or order not found'});if(sub.rows[0].product==='call_pass'){const days=Number(process.env.CALL_PASS_DAYS||7);await q("UPDATE users SET call_pass_until=GREATEST(COALESCE(call_pass_until,NOW()),NOW())+($1::int * INTERVAL '1 day') WHERE id=$2",[days,req.user.id])}else await q("UPDATE users SET vip_until=GREATEST(COALESCE(vip_until,NOW()),NOW())+INTERVAL '30 days' WHERE id=$1",[req.user.id]);res.json({ok:true})});

// Messaging polish: voice notes, unsend and notification-safe deletion
app.post('/api/dm/:id/gif',auth,messageLimiter,async(req,res)=>{await messagingFeaturesReady;const id=Number(req.params.id),url=String(req.body?.url||'').trim();if(!Number.isInteger(id)||id===req.user.id)return res.status(400).json({error:'Invalid user'});if(!(await usersAreMatched(req.user.id,id)))return res.status(403).json({error:'You can message only mutual matches.'});let host='';try{host=new URL(url).hostname.toLowerCase()}catch{return res.status(400).json({error:'Invalid GIF URL'})}if(!(host==='giphy.com'||host.endsWith('.giphy.com')||host==='tenor.com'||host.endsWith('.tenor.com')))return res.status(400).json({error:'GIFs must come from Giphy or Tenor'});const r=await q("INSERT INTO messages(sender_id,receiver_id,body,attachment_data,attachment_mime,attachment_kind) VALUES($1,$2,'[GIF]',$3,'image/gif','gif') RETURNING id,body,attachment_data,attachment_mime,attachment_kind,created_at,read_at",[req.user.id,id,url]);io.to(`dm:${Math.min(req.user.id,id)}:${Math.max(req.user.id,id)}`).emit('dm:message',{...r.rows[0],sender_id:req.user.id,sender_name:req.user.name,reactions:[]});res.json(r.rows[0])});

app.post('/api/dm/:id/voice',auth,messageLimiter,async(req,res)=>{await messagingFeaturesReady;const id=Number(req.params.id),data=String(req.body?.dataUrl||'');if(!Number.isInteger(id)||id===req.user.id)return res.status(400).json({error:'Invalid user'});if(!(await usersAreMatched(req.user.id,id)))return res.status(403).json({error:'You can message only mutual matches.'});const m=data.match(/^data:(audio\/(?:webm|ogg|mp4|mpeg));base64,([A-Za-z0-9+/=]+)$/i);if(!m)return res.status(400).json({error:'Only supported audio formats are allowed'});const bytes=Buffer.from(m[2],'base64');if(bytes.length>3*1024*1024)return res.status(413).json({error:'Voice note must be 3 MB or smaller'});const r=await q("INSERT INTO messages(sender_id,receiver_id,body,attachment_data,attachment_mime,attachment_kind) VALUES($1,$2,'[Voice message]',$3,$4,'audio') RETURNING id,body,attachment_data,attachment_mime,attachment_kind,created_at,read_at",[req.user.id,id,data,m[1]]);io.to(`dm:${Math.min(req.user.id,id)}:${Math.max(req.user.id,id)}`).emit('dm:message',{...r.rows[0],sender_id:req.user.id,sender_name:req.user.name,reactions:[]});await createNotification(id,req.user.id,'message',`🎙️ ${req.user.name} sent a voice note`,'Open your conversation to listen.');res.json(r.rows[0])});
app.delete('/api/dm/messages/:messageId',auth,async(req,res)=>{const id=Number(req.params.messageId);const r=await q('SELECT id,sender_id,receiver_id FROM messages WHERE id=$1',[id]);if(!r.rowCount)return res.status(404).json({error:'Message not found'});const m=r.rows[0];if(Number(m.sender_id)!==Number(req.user.id))return res.status(403).json({error:'You can unsend only your own messages'});if(!(await usersAreMatched(req.user.id,m.receiver_id)))return res.status(403).json({error:'You can message only mutual matches.'});await q("UPDATE messages SET deleted_at=NOW(),body='[Message unsent]',attachment_data=NULL,attachment_mime=NULL WHERE id=$1",[id]);io.to(`dm:${Math.min(m.sender_id,m.receiver_id)}:${Math.max(m.sender_id,m.receiver_id)}`).emit('dm:deleted',{messageId:id});res.json({ok:true})});

// Moderation + safety
app.get("/api/admin/content-reports",auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});const r=await q(`SELECT cr.*,u.name reporter_name,a.name author_name FROM content_reports cr JOIN users u ON u.id=cr.reporter_id LEFT JOIN users a ON a.id=cr.reported_user_id ORDER BY cr.created_at DESC LIMIT 300`);res.json(r.rows)});
app.post("/api/admin/reports/:id/action",auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});const action=String(req.body?.action||'resolve');const rp=(await q("SELECT reported_user_id FROM reports WHERE id=$1",[req.params.id])).rows[0];if(!rp)return res.status(404).json({error:'Report not found'});if(action==='ban')await q("UPDATE users SET status='banned' WHERE id=$1 AND id<>$2",[rp.reported_user_id,req.user.id]);else if(action==='restrict')await q("UPDATE users SET status='restricted' WHERE id=$1 AND id<>$2",[rp.reported_user_id,req.user.id]);else if(action==='restore')await q("UPDATE users SET status='offline' WHERE id=$1 AND status='restricted'",[rp.reported_user_id]);await q("UPDATE reports SET status=$1 WHERE id=$2",[action==='dismiss'?'dismissed':'resolved',req.params.id]);res.json({ok:true});});
app.post("/api/admin/content-reports/:id/resolve",auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});await q("UPDATE content_reports SET status='resolved' WHERE id=$1",[req.params.id]);res.json({ok:true})});

app.get("/api/admin/production-check",auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});const liveKey=String(process.env.RAZORPAY_KEY_ID||'').startsWith('rzp_live_');res.json({node:process.version,environment:process.env.NODE_ENV||'development',databaseConfigured:Boolean(process.env.DATABASE_URL),jwtSecretStrong:Boolean(process.env.JWT_SECRET&&process.env.JWT_SECRET.length>=32),httpsHeaders:process.env.NODE_ENV==='production',corsConfigured:Boolean(process.env.CORS_ORIGIN),razorpayConfigured:Boolean(process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET),razorpayLiveKey:liveKey,razorpayWebhookConfigured:Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),turnConfigured:Boolean(process.env.TURN_URLS&&process.env.TURN_USERNAME&&process.env.TURN_CREDENTIAL),backupCommandAvailable:true});});
// Admin
app.get("/api/admin/stats",auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});const [u,r,m,o,b,t,e,pay,ver]=await Promise.all([q('SELECT count(*)::int n FROM users'),q("SELECT count(*)::int n FROM reports WHERE status='open'"),q('SELECT count(*)::int n FROM messages'),q("SELECT count(*)::int n FROM users WHERE status='online'"),q("SELECT count(*)::int n FROM users WHERE status='banned'"),q('SELECT count(*)::int n FROM trips'),q('SELECT count(*)::int n FROM events'),q("SELECT count(*)::int n FROM subscriptions WHERE status='paid'") ,q("SELECT count(*)::int n FROM verification_requests WHERE status='pending'")]);res.json({users:u.rows[0].n,openReports:r.rows[0].n,messages:m.rows[0].n,online:o.rows[0].n,banned:b.rows[0].n,trips:t.rows[0].n,events:e.rows[0].n,paidPayments:pay.rows[0].n,pendingVerification:ver.rows[0].n})});
app.get("/api/admin/reports",auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});const r=await q(`SELECT rp.*,a.name reporter_name,b.name reported_name FROM reports rp JOIN users a ON a.id=rp.reporter_id JOIN users b ON b.id=rp.reported_user_id ORDER BY rp.created_at DESC LIMIT 200`);res.json(r.rows)});
app.post("/api/admin/reports/:id/resolve",auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});await q("UPDATE reports SET status='resolved' WHERE id=$1",[req.params.id]);res.json({ok:true})});
app.get("/api/admin/users",auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});const r=await q('SELECT id,name,email,role,verified,status,created_at FROM users ORDER BY created_at DESC LIMIT 200');res.json(r.rows)});
app.post("/api/admin/users/:id/ban",auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});if(Number(req.params.id)===req.user.id)return res.status(400).json({error:'Admin cannot ban self'});await q("UPDATE users SET status='banned' WHERE id=$1",[req.params.id]);io.to(`user:${req.params.id}`).emit('account:banned');res.json({ok:true})});
app.post("/api/admin/users/:id/unban",auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});await q("UPDATE users SET status='offline' WHERE id=$1 AND status='banned'",[req.params.id]);res.json({ok:true})});

const onlineSockets=new Map(),socketMessageTimes=new Map();function socketRate(id){const now=Date.now(),arr=(socketMessageTimes.get(id)||[]).filter(t=>now-t<10_000);arr.push(now);socketMessageTimes.set(id,arr);return arr.length<=30}function safeInt(v){const n=Number(v);return Number.isInteger(n)&&n>0?n:null}
io.use(async(socket,next)=>{try{const payload=verifyToken(socket.handshake.auth?.token||''),r=await q('SELECT id,name,role,status FROM users WHERE id=$1',[payload.id]);if(!r.rowCount||r.rows[0].status==='banned')throw Error();socket.user=r.rows[0];next()}catch{next(new Error('auth failed'))}});
io.on('connection',socket=>{const uid=socket.user.id;socket.join(`user:${uid}`);const wasOnline=onlineSockets.has(uid);onlineSockets.set(uid,(onlineSockets.get(uid)||0)+1);q('UPDATE users SET status=\'online\' WHERE id=$1',[uid]).catch(()=>{});if(!wasOnline)io.emit('presence:update',{userId:uid,status:'online'});
 socket.on('room:join',async roomId=>{const id=safeInt(roomId);if(!id)return;await q('INSERT INTO room_members(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,uid]);socket.join(`room:${id}`)});
 socket.on('room:message',async({roomId,body}={})=>{if(!socketRate(uid)||typeof body!=='string'||!body.trim()||body.length>2000)return;const id=safeInt(roomId);if(!id)return;const member=await q('SELECT 1 FROM room_members WHERE room_id=$1 AND user_id=$2',[id,uid]);if(!member.rowCount)return;const r=await q('INSERT INTO messages(sender_id,room_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at',[uid,id,body.trim()]);io.to(`room:${id}`).emit('room:message',{...r.rows[0],sender_id:uid,sender_name:socket.user.name})});
 socket.on('group:join',async groupId=>{const id=safeInt(groupId);if(!id)return;await q('INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,uid]);socket.join(`group:${id}`)});
 socket.on('group:message',async({groupId,body}={})=>{if(!socketRate(uid)||typeof body!=='string'||!body.trim()||body.length>2000)return;const id=safeInt(groupId);if(!id)return;const member=await q('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2',[id,uid]);if(!member.rowCount)return;const r=await q('INSERT INTO messages(sender_id,group_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at',[uid,id,body.trim()]);io.to(`group:${id}`).emit('group:message',{...r.rows[0],sender_id:uid,sender_name:socket.user.name})});
 socket.on('dm:join',async id=>{id=safeInt(id);if(id&&id!==uid&&await usersAreMatched(uid,id)){socket.join(`dm:${Math.min(uid,id)}:${Math.max(uid,id)}`);socket.emit('presence:update',{userId:id,status:onlineSockets.has(id)?'online':'offline'});}});
 socket.on('dm:typing',async({to,typing=false}={})=>{const id=safeInt(to);if(!id||id===uid||!(await usersAreMatched(uid,id)))return;io.to(`user:${id}`).emit('dm:typing',{userId:uid,typing:Boolean(typing)});});
 socket.on('dm:message',async({to,body,replyToId=null}={})=>{if(!socketRate(uid)||typeof body!=='string'||!body.trim()||body.length>2000)return;const id=safeInt(to);if(!id||id===uid||!(await usersAreMatched(uid,id))){return;}await messagingFeaturesReady;const b=await q('SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)',[id,uid]);if(b.rowCount)return;let rid=replyToId==null?null:safeInt(replyToId);if(rid){const ok=await q('SELECT 1 FROM messages WHERE id=$1 AND ((sender_id=$2 AND receiver_id=$3) OR (sender_id=$3 AND receiver_id=$2))',[rid,uid,id]);if(!ok.rowCount)rid=null}const r=await q('INSERT INTO messages(sender_id,receiver_id,body,reply_to_id) VALUES($1,$2,$3,$4) RETURNING id,body,created_at,read_at,reply_to_id',[uid,id,body.trim(),rid]);let reply=null;if(rid){const rr=await q('SELECT m.body,u.name sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=$1',[rid]);reply=rr.rows[0]||null}io.to(`dm:${Math.min(uid,id)}:${Math.max(uid,id)}`).emit('dm:message',{...r.rows[0],sender_id:uid,sender_name:socket.user.name,reply_body:reply?.body||null,reply_sender_name:reply?.sender_name||null,reactions:[]});

  await createNotification(
    id,
    uid,
    "message",
    `💬 ${socket.user.name} sent you a message`,
    "Open your conversation to reply."
  );
});
 socket.on('dm:reaction',async({messageId,emoji}={})=>{await messagingFeaturesReady;if(!socketRate(uid))return;const mid=safeInt(messageId),em=typeof emoji==='string'?emoji.trim().slice(0,16):'';if(!mid||!em)return;const own=await q('SELECT sender_id,receiver_id FROM messages WHERE id=$1',[mid]);if(!own.rowCount)return;const m=own.rows[0];if(m.sender_id!==uid&&m.receiver_id!==uid)return;if(!(await usersAreMatched(uid,m.sender_id===uid?m.receiver_id:m.sender_id)))return;const pair=Math.min(m.sender_id,m.receiver_id)+':'+Math.max(m.sender_id,m.receiver_id);const existing=await q('SELECT id FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',[mid,uid,em]);if(existing.rowCount)await q('DELETE FROM message_reactions WHERE id=$1',[existing.rows[0].id]);else await q('INSERT INTO message_reactions(message_id,user_id,emoji) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[mid,uid,em]);const rs=await q('SELECT emoji,COUNT(*)::int count,BOOL_OR(user_id=$2) mine FROM message_reactions WHERE message_id=$1 GROUP BY emoji ORDER BY emoji',[mid,uid]);io.to(`dm:${pair}`).emit('dm:reaction',{messageId:mid,reactions:rs.rows})});
 socket.on('call:offer',async({to,offer,type='video'}={})=>{const id=safeInt(to);if(!id||!offer||!(await usersAreMatched(uid,id)))return;const target=await q('SELECT id,gender FROM users WHERE id=$1',[id]),me=await q('SELECT gender,call_pass_until FROM users WHERE id=$1',[uid]);if(!target.rowCount||!me.rowCount)return;const opposite=['male','female'].every(x=>[me.rows[0].gender,target.rows[0].gender].includes(x))&&me.rows[0].gender!==target.rows[0].gender,pass=me.rows[0].call_pass_until&&new Date(me.rows[0].call_pass_until)>new Date();if(opposite&&!pass)return socket.emit('call:blocked',{reason:'Call Pass required for opposite-gender calls'});io.to(`user:${id}`).emit('call:offer',{from:uid,offer,type})});
 socket.on('call:answer',async({to,answer}={})=>{const id=safeInt(to);if(id&&await usersAreMatched(uid,id))io.to(`user:${id}`).emit('call:answer',{from:uid,answer})});socket.on('call:ice',async({to,candidate}={})=>{const id=safeInt(to);if(id&&await usersAreMatched(uid,id))io.to(`user:${id}`).emit('call:ice',{from:uid,candidate})});socket.on('call:end',async({to}={})=>{const id=safeInt(to);if(id&&await usersAreMatched(uid,id))io.to(`user:${id}`).emit('call:end',{from:uid})});
 socket.on('disconnect',async()=>{const count=Math.max(0,(onlineSockets.get(uid)||1)-1);if(count)onlineSockets.set(uid,count);else{onlineSockets.delete(uid);io.emit('presence:update',{userId:uid,status:'offline'});await q("UPDATE users SET status='offline' WHERE id=$1 AND status<>'banned'",[uid]).catch(()=>{})}});
});
async function ensureTravelProfile(userId){
  await q(`INSERT INTO travel_profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING`,[userId]);
}
function dateDays(a,b){return Math.max(1,Math.ceil((new Date(b)-new Date(a))/86400000)+1)}
function calcTripBudget(d,days,style,members){
  const mult={budget:.78,balanced:1,comfort:1.35}[style]||1;
  const shared=Math.round((Number(d.base_transport||0)+Number(d.local_transport||0))*mult);
  const stay=Math.round(Number(d.stay_per_night||0)*Math.max(1,days-1)*mult);
  const food=Math.round(Number(d.food_per_day||0)*days*mult);
  const activities=Math.round(Number(d.activities||0)*mult);
  const emergency=Math.round((shared+stay+food+activities)*.08);
  const total=Math.round(shared/members+stay+food+activities+emergency);
  return {transport:shared,stay,food,local_transport:Math.round(Number(d.local_transport||0)*mult),activities,emergency,total_min:Math.round(total*.9),total_max:Math.round(total*1.15),members};
}
function normalizeMonths(a){return Array.isArray(a)?a.map(Number).filter(Number.isFinite):[]}

app.get("/api/destinations",auth,async(req,res)=>{
  const qv=String(req.query.q||"").trim();
  const r=await q(`SELECT * FROM destinations
    WHERE ($1='' OR name ILIKE '%'||$1||'%' OR $1=ANY(tags))
    ORDER BY name LIMIT 100`,[qv]);
  res.json(r.rows);
});
app.get("/api/destinations/:id",auth,async(req,res)=>{
  const r=await q("SELECT * FROM destinations WHERE id=$1",[req.params.id]);
  if(!r.rowCount)return res.status(404).json({error:"Destination not found"});
  res.json(r.rows[0]);
});

app.get("/api/travel/profile",auth,async(req,res)=>{
  await ensureTravelProfile(req.user.id);
  const r=await q(`SELECT tp.*,u.name,u.avatar,u.college,u.course
    FROM travel_profiles tp JOIN users u ON u.id=tp.user_id WHERE tp.user_id=$1`,[req.user.id]);
  res.json(r.rows[0]);
});
app.patch("/api/travel/profile",auth,async(req,res)=>{
  await ensureTravelProfile(req.user.id);
  const b=req.body||{};
  const styles=Array.isArray(b.styles)?b.styles.map(String).slice(0,10):[];
  const interests=Array.isArray(b.interests)?b.interests.map(String).slice(0,15):[];
  const pace=["relaxed","balanced","fast"].includes(b.pace)?b.pace:"balanced";
  const budgetStyle=["budget","balanced","comfort"].includes(b.budgetStyle)?b.budgetStyle:"balanced";
  await q(`UPDATE travel_profiles SET styles=$1,pace=$2,budget_style=$3,interests=$4,
    emergency_name=$5,emergency_phone=$6,emergency_relation=$7,home_base=$8,bio=$9,updated_at=NOW()
    WHERE user_id=$10`,[
      styles,pace,budgetStyle,interests,
      String(b.emergencyName||"").slice(0,80),String(b.emergencyPhone||"").slice(0,30),
      String(b.emergencyRelation||"").slice(0,40),String(b.homeBase||"").slice(0,100),
      String(b.bio||"").slice(0,500),req.user.id
    ]);
  const r=await q("SELECT * FROM travel_profiles WHERE user_id=$1",[req.user.id]);
  res.json(r.rows[0]);
});

app.get("/api/trips",auth,async(req,res)=>{
  const mine=req.query.mine==="1", destination=req.query.destination;
  const r=await q(`SELECT t.*,d.name destination_name,d.icon destination_icon,d.region destination_region,
      u.name host_name,u.avatar host_avatar,u.college host_college,u.verified host_verified,
      COUNT(DISTINCT tm.user_id)::int member_count,
      EXISTS(SELECT 1 FROM trip_members x WHERE x.trip_id=t.id AND x.user_id=$1 AND x.status='active') AS joined,
      EXISTS(SELECT 1 FROM trip_join_requests jr WHERE jr.trip_id=t.id AND jr.user_id=$1 AND jr.status='pending') AS requested,
      EXISTS(SELECT 1 FROM saved_trips st WHERE st.trip_id=t.id AND st.user_id=$1) AS saved
    FROM trips t
      LEFT JOIN destinations d ON d.id=t.destination_id
      JOIN users u ON u.id=t.host_id
      LEFT JOIN trip_members tm ON tm.trip_id=t.id AND tm.status='active'
    WHERE t.status='open' AND t.visibility='public'
      AND ($2::bigint IS NULL OR t.destination_id=$2)
      AND ($3::boolean=false OR t.host_id=$1)
    GROUP BY t.id,d.id,u.id ORDER BY t.start_date ASC,t.created_at DESC LIMIT 100`,
    [req.user.id,destination?Number(destination):null,mine]);
  res.json(r.rows);
});
app.get("/api/trips/:id",auth,async(req,res)=>{
  const r=await q(`SELECT t.*,d.name destination_name,d.icon destination_icon,d.description destination_description,
      d.difficulty,d.recommended_months,d.route_stops,d.tags,d.base_transport,d.stay_per_night,d.food_per_day,d.local_transport,d.activities,
      u.name host_name,u.avatar host_avatar,u.college host_college,u.course host_course,u.verified host_verified,u.created_at host_created_at,
      COUNT(DISTINCT tm.user_id)::int member_count
    FROM trips t LEFT JOIN destinations d ON d.id=t.destination_id
      JOIN users u ON u.id=t.host_id LEFT JOIN trip_members tm ON tm.trip_id=t.id AND tm.status='active'
    WHERE t.id=$1 GROUP BY t.id,d.id,u.id`,[req.params.id]);
  if(!r.rowCount)return res.status(404).json({error:"Trip not found"});
  const trip=r.rows[0];
  const [members,requests,checklist,expenses]=await Promise.all([
    q(`SELECT tm.*,u.name,u.avatar,u.college,u.course,u.verified FROM trip_members tm JOIN users u ON u.id=tm.user_id WHERE tm.trip_id=$1 AND tm.status='active' ORDER BY tm.role='host' DESC,tm.joined_at`,[req.params.id]),
    trip.host_id===req.user.id?q(`SELECT jr.*,u.name,u.avatar,u.college,u.course,u.verified FROM trip_join_requests jr JOIN users u ON u.id=jr.user_id WHERE jr.trip_id=$1 ORDER BY jr.created_at DESC`,[req.params.id]):Promise.resolve({rows:[]}),
    q(`SELECT c.*,u.name assigned_name FROM trip_checklist c LEFT JOIN users u ON u.id=c.assigned_to WHERE c.trip_id=$1 ORDER BY c.done,c.created_at`,[req.params.id]),
    q(`SELECT e.*,u.name paid_by_name FROM trip_expenses e LEFT JOIN users u ON u.id=e.paid_by WHERE e.trip_id=$1 ORDER BY e.created_at DESC`,[req.params.id])
  ]);
  res.json({...trip,members:members.rows,requests:requests.rows,checklist:checklist.rows,expenses:expenses.rows});
});
app.post("/api/trips",auth,async(req,res)=>{
  const b=req.body||{},destinationId=Number(b.destinationId);
  const d=(await q("SELECT * FROM destinations WHERE id=$1",[destinationId])).rows[0];
  if(!d)return res.status(400).json({error:"Choose a valid Uttarakhand destination"});
  const start=new Date(b.startDate),end=new Date(b.endDate);
  if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<start)return res.status(400).json({error:"Choose valid travel dates"});
  const maxMembers=Math.max(1,Math.min(20,Number(b.maxMembers)||4)),days=dateDays(b.startDate,b.endDate);
  const style=["budget","balanced","comfort"].includes(b.travelStyle)?b.travelStyle:"balanced";
  const pace=["relaxed","balanced","fast"].includes(b.pace)?b.pace:"balanced";
  const budget=calcTripBudget(d,days,style,maxMembers);
  const route=Array.isArray(b.route)&&b.route.length?b.route:d.route_stops||[];
  const title=String(b.title||`${d.name} Escape`).slice(0,160);
  const description=String(b.description||"").slice(0,1000);
  const startPoint=String(b.startPoint||"Haridwar").slice(0,120);
  const r=await q(`INSERT INTO trips(host_id,destination_id,title,description,start_date,end_date,start_point,max_members,travel_style,pace,budget_min,budget_max,budget_breakdown,route)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [req.user.id,destinationId,title,description,b.startDate,b.endDate,startPoint,maxMembers,style,pace,budget.total_min,budget.total_max,JSON.stringify(budget),JSON.stringify(route)]);
  const trip=r.rows[0];
  await q("INSERT INTO trip_members(trip_id,user_id,role) VALUES($1,$2,'host')",[trip.id,req.user.id]);
  await q("INSERT INTO trip_checklist(trip_id,title) VALUES($1,$2),($1,$3),($1,$4),($1,$5)",[trip.id,"ID proof","Power bank","First-aid kit","Water bottle"]);
  res.status(201).json(trip);
});
app.patch("/api/trips/:id",auth,async(req,res)=>{
  const trip=(await q("SELECT * FROM trips WHERE id=$1",[req.params.id])).rows[0];
  if(!trip)return res.status(404).json({error:"Trip not found"});
  if(trip.host_id!==req.user.id)return res.status(403).json({error:"Only the host can edit this trip"});
  const b=req.body||{};
  const allowedStatus=["open","full","completed","cancelled"];
  const status=allowedStatus.includes(b.status)?b.status:trip.status;
  const title=String(b.title??trip.title).slice(0,160),description=String(b.description??trip.description).slice(0,1000);
  const maxMembers=Math.max(1,Math.min(20,Number(b.maxMembers)||trip.max_members));
  const r=await q(`UPDATE trips SET title=$1,description=$2,max_members=$3,status=$4 WHERE id=$5 RETURNING *`,[title,description,maxMembers,status,trip.id]);
  res.json(r.rows[0]);
});
app.post("/api/trips/:id/request",auth,async(req,res)=>{
  const trip=(await q("SELECT * FROM trips WHERE id=$1",[req.params.id])).rows[0];
  if(!trip)return res.status(404).json({error:"Trip not found"});
  if(trip.host_id===req.user.id)return res.status(400).json({error:"You already host this trip"});
  const member=await q("SELECT 1 FROM trip_members WHERE trip_id=$1 AND user_id=$2 AND status='active'",[trip.id,req.user.id]);
  if(member.rowCount)return res.status(400).json({error:"You are already in this trip"});
  const r=await q(`INSERT INTO trip_join_requests(trip_id,user_id,message) VALUES($1,$2,$3)
    ON CONFLICT(trip_id,user_id) DO UPDATE SET message=EXCLUDED.message,status='pending',updated_at=NOW()
    RETURNING *`,[trip.id,req.user.id,String(req.body?.message||"").slice(0,500)]);
  await createNotification(trip.host_id,req.user.id,"trip_request","🧳 New trip join request",`${req.user.name} wants to join your trip.`);
  res.json(r.rows[0]);
});
app.post("/api/trips/:id/request/:requestId",auth,async(req,res)=>{
  const trip=(await q("SELECT * FROM trips WHERE id=$1",[req.params.id])).rows[0];
  if(!trip||trip.host_id!==req.user.id)return res.status(403).json({error:"Only the host can review requests"});
  const request=(await q("SELECT * FROM trip_join_requests WHERE id=$1 AND trip_id=$2",[req.params.requestId,trip.id])).rows[0];
  if(!request)return res.status(404).json({error:"Request not found"});
  const action=req.body?.action==="accept"?"accept":"decline";
  if(action==="accept"){
    const count=(await q("SELECT COUNT(*)::int n FROM trip_members WHERE trip_id=$1 AND status='active'",[trip.id])).rows[0].n;
    if(count>=trip.max_members)return res.status(409).json({error:"Trip is full"});
    await q("UPDATE trip_join_requests SET status='accepted',updated_at=NOW() WHERE id=$1",[request.id]);
    await q("INSERT INTO trip_members(trip_id,user_id) VALUES($1,$2) ON CONFLICT(trip_id,user_id) DO UPDATE SET status='active'",[trip.id,request.user_id]);
    await createNotification(request.user_id,req.user.id,"trip_accept","🎒 Trip request accepted",`You're in ${trip.title}.`);
    res.json({ok:true,status:"accepted"});
  }else{
    await q("UPDATE trip_join_requests SET status='declined',updated_at=NOW() WHERE id=$1",[request.id]);
    await createNotification(request.user_id,req.user.id,"trip_decline","Trip request update",`Your request for ${trip.title} was declined.`);
    res.json({ok:true,status:"declined"});
  }
});
async function isTripMember(tripId,userId){
  return (await q("SELECT 1 FROM trip_members WHERE trip_id=$1 AND user_id=$2 AND status='active'",[tripId,userId])).rowCount>0;
}
app.post("/api/trips/:id/leave",auth,async(req,res)=>{
  const trip=(await q("SELECT host_id FROM trips WHERE id=$1",[req.params.id])).rows[0];
  if(!trip)return res.status(404).json({error:"Trip not found"});
  if(trip.host_id===req.user.id)return res.status(400).json({error:"Host cannot leave. Transfer or cancel the trip."});
  await q("UPDATE trip_members SET status='left' WHERE trip_id=$1 AND user_id=$2",[req.params.id,req.user.id]);
  res.json({ok:true});
});
app.get("/api/trips/:id/messages",auth,async(req,res)=>{
  if(!(await isTripMember(req.params.id,req.user.id)))return res.status(403).json({error:"Join the trip to access its chat"});
  const r=await q(`SELECT tm.id,tm.body,tm.created_at,tm.sender_id,u.name sender_name,u.avatar sender_avatar
    FROM trip_messages tm JOIN users u ON u.id=tm.sender_id WHERE tm.trip_id=$1 ORDER BY tm.created_at DESC LIMIT 100`,[req.params.id]);
  res.json(r.rows.reverse());
});
app.post("/api/trips/:id/messages",auth,async(req,res)=>{
  if(!(await isTripMember(req.params.id,req.user.id)))return res.status(403).json({error:"Join the trip to chat"});
  const body=String(req.body?.body||"").trim().slice(0,2000);if(!body)return res.status(400).json({error:"Message required"});
  const r=await q(`INSERT INTO trip_messages(trip_id,sender_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at`,[req.params.id,req.user.id,body]);
  const msg={...r.rows[0],sender_id:req.user.id,sender_name:req.user.name};
  io.to(`trip:${req.params.id}`).emit("trip:message",msg);res.json(msg);
});
app.post("/api/trips/:id/checklist",auth,async(req,res)=>{
  if(!(await isTripMember(req.params.id,req.user.id)))return res.status(403).json({error:"Join the trip first"});
  const title=String(req.body?.title||"").trim().slice(0,160);if(!title)return res.status(400).json({error:"Checklist item required"});
  const r=await q("INSERT INTO trip_checklist(trip_id,title) VALUES($1,$2) RETURNING *",[req.params.id,title]);res.json(r.rows[0]);
});
app.patch("/api/trips/:id/checklist/:itemId",auth,async(req,res)=>{
  if(!(await isTripMember(req.params.id,req.user.id)))return res.status(403).json({error:"Join the trip first"});
  const done=!!req.body?.done,assigned=req.body?.assignedTo?Number(req.body.assignedTo):null;
  const r=await q("UPDATE trip_checklist SET done=$1,assigned_to=$2 WHERE id=$3 AND trip_id=$4 RETURNING *",[done,assigned,req.params.itemId,req.params.id]);res.json(r.rows[0]||null);
});
app.post("/api/trips/:id/expenses",auth,async(req,res)=>{
  if(!(await isTripMember(req.params.id,req.user.id)))return res.status(403).json({error:"Join the trip first"});
  const title=String(req.body?.title||"").slice(0,120),amount=Math.round(Number(req.body?.amount)||0),category=String(req.body?.category||"other").slice(0,40);
  if(!title||amount<=0)return res.status(400).json({error:"Valid expense required"});
  const r=await q("INSERT INTO trip_expenses(trip_id,paid_by,title,amount,category) VALUES($1,$2,$3,$4,$5) RETURNING *",[req.params.id,req.user.id,title,amount,category]);res.json(r.rows[0]);
});
app.get("/api/trips/:id/expenses/summary",auth,async(req,res)=>{
  if(!(await isTripMember(req.params.id,req.user.id)))return res.status(403).json({error:"Join the trip first"});
  const expenses=(await q(`SELECT e.*,u.name paid_by_name FROM trip_expenses e JOIN users u ON u.id=e.paid_by WHERE e.trip_id=$1`,[req.params.id])).rows;
  const members=(await q(`SELECT tm.user_id,u.name FROM trip_members tm JOIN users u ON u.id=tm.user_id WHERE tm.trip_id=$1 AND tm.status='active'`,[req.params.id])).rows;
  const total=expenses.reduce((s,e)=>s+Number(e.amount),0),share=members.length?Math.round(total/members.length):0;
  const paid=new Map(members.map(m=>[Number(m.user_id),0]));expenses.forEach(e=>paid.set(Number(e.paid_by),(paid.get(Number(e.paid_by))||0)+Number(e.amount)));
  res.json({total,members:members.map(m=>({id:m.user_id,name:m.name,paid:paid.get(Number(m.user_id))||0,balance:(paid.get(Number(m.user_id))||0)-share})),share,expenses});
});
app.get("/api/trips/:id/safety",auth,async(req,res)=>{if(!(await isTripMember(req.params.id,req.user.id)))return res.status(403).json({error:'Join the trip first'});const [p,last,members]=await Promise.all([q("SELECT emergency_name,emergency_phone,emergency_relation FROM travel_profiles WHERE user_id=$1",[req.user.id]),q("SELECT status,note,latitude,longitude,created_at FROM trip_checkins WHERE trip_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1",[req.params.id,req.user.id]),q("SELECT tm.user_id,u.name,tc.created_at last_checkin,tc.status last_status FROM trip_members tm JOIN users u ON u.id=tm.user_id LEFT JOIN LATERAL (SELECT status,created_at FROM trip_checkins WHERE trip_id=tm.trip_id AND user_id=tm.user_id ORDER BY created_at DESC LIMIT 1) tc ON TRUE WHERE tm.trip_id=$1 AND tm.status='active' ORDER BY tm.role='host' DESC,u.name",[req.params.id])]);res.json({emergency:p.rows[0]||{},lastCheckin:last.rows[0]||null,members:members.rows});});
app.post("/api/trips/:id/checkin",auth,async(req,res)=>{
  if(!(await isTripMember(req.params.id,req.user.id)))return res.status(403).json({error:"Join the trip first"});
  const status=["safe","help"].includes(req.body?.status)?req.body.status:"safe";
  const lat=Number.isFinite(Number(req.body?.latitude))?Number(req.body.latitude):null;
  const lon=Number.isFinite(Number(req.body?.longitude))?Number(req.body.longitude):null;
  const r=await q("INSERT INTO trip_checkins(trip_id,user_id,status,note,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[req.params.id,req.user.id,status,String(req.body?.note||"").slice(0,300),lat,lon]);
  if(status==="help"){const host=(await q("SELECT host_id,title FROM trips WHERE id=$1",[req.params.id])).rows[0];if(host)await createNotification(host.host_id,req.user.id,"trip_help","🚨 Trip safety alert",`${req.user.name} requested help in ${host.title}.`)}
  res.json(r.rows[0]);
});
app.post("/api/trips/:id/review",auth,async(req,res)=>{
  if(!(await isTripMember(req.params.id,req.user.id)))return res.status(403).json({error:"Trip members only"});
  const target=Number(req.body?.userId),rating=Math.max(1,Math.min(5,Number(req.body?.rating)||5));
  if(!target||target===req.user.id)return res.status(400).json({error:"Invalid member"});
  const r=await q(`INSERT INTO travel_reviews(trip_id,reviewer_id,reviewed_user_id,rating,comment) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(trip_id,reviewer_id,reviewed_user_id) DO UPDATE SET rating=EXCLUDED.rating,comment=EXCLUDED.comment RETURNING *`,
    [req.params.id,req.user.id,target,rating,String(req.body?.comment||"").slice(0,500)]);
  res.json(r.rows[0]);
});
app.post("/api/trips/:id/complete",auth,async(req,res)=>{
  const trip=(await q("SELECT host_id FROM trips WHERE id=$1",[req.params.id])).rows[0];
  if(!trip)return res.status(404).json({error:"Trip not found"});
  if(trip.host_id!==req.user.id)return res.status(403).json({error:"Only the host can complete the trip"});
  const r=await q("UPDATE trips SET status='completed' WHERE id=$1 RETURNING *",[req.params.id]);
  res.json(r.rows[0]);
});
app.get("/api/travel/reputation/:id",auth,async(req,res)=>{
  const id=Number(req.params.id);
  const trips=(await q(`SELECT COUNT(*)::int n FROM trip_members tm JOIN trips t ON t.id=tm.trip_id WHERE tm.user_id=$1 AND t.status='completed' AND tm.status='active'`,[id])).rows[0].n;
  const hosted=(await q(`SELECT COUNT(*)::int n FROM trips WHERE host_id=$1 AND status='completed'`,[id])).rows[0].n;
  const reviews=(await q(`SELECT COUNT(*)::int n,COALESCE(ROUND(AVG(rating),1),0) avg FROM travel_reviews WHERE reviewed_user_id=$1`,[id])).rows[0];
  const reports=(await q(`SELECT COUNT(*)::int n FROM reports WHERE reported_user_id=$1`,[id])).rows[0].n;
  const reliability=Math.max(0,Math.min(100,Math.round(70+Math.min(20,trips*2)+Number(reviews.avg||0)*2-reports*12)));
  res.json({tripsCompleted:trips,hosted,companions:Math.max(0,trips-1),reviews:Number(reviews.n),rating:Number(reviews.avg),reports,reliability});
});

app.get("/api/travel/compatibility/:tripId/:userId",auth,async(req,res)=>{
  const trip=(await q(`SELECT t.*,d.name destination_name FROM trips t LEFT JOIN destinations d ON d.id=t.destination_id WHERE t.id=$1`,[req.params.tripId])).rows[0];
  const uid=Number(req.params.userId);if(!trip)return res.status(404).json({error:"Trip not found"});
  const hostProfile=(await q("SELECT * FROM travel_profiles WHERE user_id=$1",[trip.host_id])).rows[0]||{};
  const candidate=(await q("SELECT u.*,tp.styles,tp.pace,tp.budget_style,tp.interests travel_interests FROM users u LEFT JOIN travel_profiles tp ON tp.user_id=u.id WHERE u.id=$1",[uid])).rows[0];
  if(!candidate)return res.status(404).json({error:"User not found"});
  let score=45,reasons=[];
  if(candidate.city&&trip.start_point&&candidate.city.toLowerCase()===trip.start_point.toLowerCase()){score+=12;reasons.push("Same starting city")}
  if(candidate.course&&trip.host_id){const hc=(await q("SELECT course FROM users WHERE id=$1",[trip.host_id])).rows[0]?.course;if(hc&&candidate.course===hc){score+=7;reasons.push("Similar academic background")}}
  if(candidate.pace&&candidate.pace===trip.pace){score+=12;reasons.push("Same travel pace")}
  if(candidate.budget_style&&candidate.budget_style===trip.travel_style){score+=12;reasons.push("Same budget style")}
  const common=Array.from(new Set([...(candidate.interests||[]),...(candidate.travel_interests||[])]));
  if(common.length){score+=Math.min(12,common.length*2);reasons.push(`${Math.min(6,common.length)} shared interests`)}
  res.json({score:Math.min(99,score),reasons:reasons.slice(0,5),destination:trip.destination_name});
});

app.post("/api/going",auth,async(req,res)=>{
  const destinationId=Number(req.body?.destinationId);const d=(await q("SELECT id,name FROM destinations WHERE id=$1",[destinationId])).rows[0];
  if(!d)return res.status(400).json({error:"Choose a destination"});
  const r=await q(`INSERT INTO going_posts(user_id,destination_id,text,trip_date,start_point,budget_min,budget_max)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.user.id,destinationId,String(req.body?.text||"").slice(0,500),req.body?.tripDate||null,String(req.body?.startPoint||"").slice(0,120),Number(req.body?.budgetMin)||0,Number(req.body?.budgetMax)||0]);
  res.status(201).json(r.rows[0]);
});
app.get("/api/going",auth,async(req,res)=>{
  const r=await q(`SELECT gp.*,d.name destination_name,d.icon destination_icon,u.name user_name,u.avatar user_avatar,u.college
    FROM going_posts gp JOIN destinations d ON d.id=gp.destination_id JOIN users u ON u.id=gp.user_id
    WHERE gp.trip_date IS NULL OR gp.trip_date>=CURRENT_DATE ORDER BY gp.created_at DESC LIMIT 100`);
  res.json(r.rows);
});
app.get("/api/weekend-radar",auth,async(req,res)=>{
  const r=await q(`SELECT t.id,t.title,t.start_date,t.end_date,t.budget_min,t.budget_max,t.max_members,d.name destination_name,d.icon destination_icon,
      COUNT(tm.user_id)::int member_count,u.name host_name
    FROM trips t JOIN destinations d ON d.id=t.destination_id JOIN users u ON u.id=t.host_id
      LEFT JOIN trip_members tm ON tm.trip_id=t.id AND tm.status='active'
    WHERE t.status='open' AND t.start_date BETWEEN CURRENT_DATE AND CURRENT_DATE+INTERVAL '14 days'
    GROUP BY t.id,d.name,d.icon,u.name ORDER BY t.start_date LIMIT 12`);
  res.json(r.rows);
});
app.post("/api/trips/:id/save",auth,async(req,res)=>{
  await q("INSERT INTO saved_trips(user_id,trip_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[req.user.id,req.params.id]);res.json({ok:true});
});
app.delete("/api/trips/:id/save",auth,async(req,res)=>{
  await q("DELETE FROM saved_trips WHERE user_id=$1 AND trip_id=$2",[req.user.id,req.params.id]);res.json({ok:true});
});

app.post("/api/travel/plan",auth,async(req,res)=>{
  const budget=Math.max(500,Number(req.body?.budget)||5000),days=Math.max(1,Math.min(14,Number(req.body?.days)||3)),start=String(req.body?.startPoint||req.user.city||"Haridwar");
  const qv=String(req.body?.preference||"").toLowerCase();
  const ds=(await q("SELECT * FROM destinations WHERE region='Uttarakhand' ORDER BY name")).rows;
  const scored=ds.map(d=>{
    let score=0;
    const base=Math.round((Number(d.base_transport)+Number(d.stay_per_night)*(days-1)+Number(d.food_per_day)*days+Number(d.local_transport)+Number(d.activities))*0.9);
    if(base<=budget)score+=50; else score-=Math.min(40,Math.round((base-budget)/100));
    if(qv.includes("mountain")&&d.tags.includes("mountains"))score+=15;
    if(qv.includes("trek")&&d.tags.includes("trek"))score+=15;
    if(qv.includes("quiet")&&d.tags.includes("quiet"))score+=10;
    if(start.toLowerCase().includes("haridwar")&&["Rishikesh","Kanatal","Dhanaulti","Tehri"].includes(d.name))score+=8;
    return {...d,estimated:base,score};
  }).sort((a,b)=>b.score-a.score).slice(0,3);
  res.json({startPoint:start,budget,days,results:scored.map(d=>({destinationId:d.id,name:d.name,icon:d.icon,estimatedMin:Math.round(d.estimated*.9),estimatedMax:Math.round(d.estimated*1.15),difficulty:d.difficulty,tags:d.tags,reason:`Good fit for ${days} day${days>1?"s":""} from ${start} within your budget.`}))});
});



// ================= Community Feed API =================
app.get("/api/feed",auth,async(req,res)=>{
  const r=await q(`SELECT p.*,u.name,u.avatar,u.college,u.verified,g.name group_name,g.icon group_icon,
    (SELECT COUNT(*)::int FROM community_post_likes l WHERE l.post_id=p.id) like_count,
    EXISTS(SELECT 1 FROM community_post_likes l WHERE l.post_id=p.id AND l.user_id=$1) liked,
    (SELECT COUNT(*)::int FROM community_post_comments c WHERE c.post_id=p.id) comment_count,
    EXISTS(SELECT 1 FROM saved_posts s WHERE s.post_id=p.id AND s.user_id=$1) saved
    FROM community_posts p JOIN users u ON u.id=p.author_id
    LEFT JOIN groups g ON g.id=p.group_id
    WHERE u.status<>'banned'
    ORDER BY p.created_at DESC LIMIT 80`,[req.user.id]);
  res.json(r.rows);
});
app.post("/api/feed",auth,async(req,res)=>{
  const body=String(req.body?.body||'').trim().slice(0,2000);
  if(!body)return res.status(400).json({error:'Write something first'});
  const groupId=req.body?.groupId?Number(req.body.groupId):null;
  if(groupId){const m=await q("SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2",[groupId,req.user.id]);if(!m.rowCount)return res.status(403).json({error:'Join the community before posting'});}
  const r=await q(`INSERT INTO community_posts(author_id,group_id,body) VALUES($1,$2,$3) RETURNING *`,[req.user.id,groupId,body]);
  res.status(201).json(r.rows[0]);
});
app.delete("/api/feed/:id",auth,async(req,res)=>{
  const r=await q("DELETE FROM community_posts WHERE id=$1 AND author_id=$2 RETURNING id",[req.params.id,req.user.id]);
  if(!r.rowCount)return res.status(404).json({error:'Post not found'});res.json({ok:true});
});
app.post("/api/feed/:id/like",auth,async(req,res)=>{
  const post=(await q("SELECT author_id FROM community_posts WHERE id=$1",[req.params.id])).rows[0];if(!post)return res.status(404).json({error:'Post not found'});
  const exists=await q("SELECT 1 FROM community_post_likes WHERE post_id=$1 AND user_id=$2",[req.params.id,req.user.id]);
  if(exists.rowCount)await q("DELETE FROM community_post_likes WHERE post_id=$1 AND user_id=$2",[req.params.id,req.user.id]);
  else{await q("INSERT INTO community_post_likes(post_id,user_id) VALUES($1,$2)",[req.params.id,req.user.id]);if(Number(post.author_id)!==Number(req.user.id))await createNotification(post.author_id,req.user.id,'post_like','❤️ Someone liked your post',`${req.user.name} liked your community post.`)}
  res.json({liked:!exists.rowCount});
});
app.get("/api/feed/:id/comments",auth,async(req,res)=>{
  const r=await q(`SELECT c.*,u.name,u.avatar FROM community_post_comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=$1 ORDER BY c.created_at ASC LIMIT 100`,[req.params.id]);res.json(r.rows);
});
app.post("/api/feed/:id/comments",auth,async(req,res)=>{
  const body=String(req.body?.body||'').trim().slice(0,500);if(!body)return res.status(400).json({error:'Comment required'});
  const post=(await q("SELECT author_id FROM community_posts WHERE id=$1",[req.params.id])).rows[0];if(!post)return res.status(404).json({error:'Post not found'});
  const r=await q("INSERT INTO community_post_comments(post_id,user_id,body) VALUES($1,$2,$3) RETURNING *",[req.params.id,req.user.id,body]);
  if(Number(post.author_id)!==Number(req.user.id))await createNotification(post.author_id,req.user.id,'post_comment','💬 New comment',`${req.user.name} commented on your post.`);
  res.status(201).json(r.rows[0]);
});
app.post("/api/feed/:id/save",auth,async(req,res)=>{await q("INSERT INTO saved_posts(post_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[req.params.id,req.user.id]);res.json({ok:true});});

app.post("/api/users/:id/follow",auth,async(req,res)=>{const id=Number(req.params.id);if(!Number.isInteger(id)||id===req.user.id)return res.status(400).json({error:'Invalid user'});const target=await q("SELECT id FROM users WHERE id=$1 AND status<>'banned'",[id]);if(!target.rowCount)return res.status(404).json({error:'User not found'});const x=await q("INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING follower_id",[req.user.id,id]);if(x.rowCount)await createNotification(id,req.user.id,'follow','👋 New follower',`${req.user.name} followed you.`);res.json({following:Boolean(x.rowCount)});});
app.delete("/api/users/:id/follow",auth,async(req,res)=>{await q("DELETE FROM user_follows WHERE follower_id=$1 AND following_id=$2",[req.user.id,req.params.id]);res.json({following:false});});
app.get("/api/users/:id/following",auth,async(req,res)=>{const r=await q("SELECT EXISTS(SELECT 1 FROM user_follows WHERE follower_id=$1 AND following_id=$2) following",[req.user.id,req.params.id]);res.json(r.rows[0]);});

// ================= End Community Feed API =================

const moderationReady=(async()=>{await contentReportsReady;await q("ALTER TABLE users ADD COLUMN IF NOT EXISTS moderation_state VARCHAR(20) NOT NULL DEFAULT 'normal'");await q("CREATE INDEX IF NOT EXISTS idx_reports_status_time ON reports(status,created_at DESC)");})();
const communityTravelReady=(async()=>{
  const schema=await fs.readFile(new URL("../db/community_travel_schema.sql",import.meta.url),"utf8");
  await q(schema);
  const seed=await fs.readFile(new URL("../db/travel_seed.sql",import.meta.url),"utf8");
  await q(seed);
})().catch(e=>{console.error("Community/travel database initialization failed:",e);throw e});

app.use((req,res,next)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'API route not found'});next()});
app.use((err,req,res,next)=>{console.error('Unhandled request error:',err);if(res.headersSent)return next(err);res.status(err.status||500).json({error:process.env.NODE_ENV==='production'?'Something went wrong.':(err.message||'Internal server error')});});
const PORT=process.env.PORT||3000;
Promise.all([communityTravelReady,moderationReady,securityEventsReady,profilePhotosReady,messagingFeaturesReady,premiumFeaturesReady,roadmapReady,webhookEventsReady,subscriptionsReady,featurePurchasesReady,superLikesReady,boostsReady]).then(()=>server.listen(PORT,()=>console.log(`VibeMeet running on port ${PORT}`))).catch(()=>process.exit(1));process.on('SIGTERM',async()=>{await pool.end();process.exit(0)});setInterval(async()=>{try{const r=await q(`SELECT er.event_id,er.user_id,er.remind_minutes,e.title,e.starts_at FROM event_reminders er JOIN events e ON e.id=er.event_id WHERE e.starts_at>NOW() AND e.starts_at-NOW()<=make_interval(mins=>er.remind_minutes) AND e.starts_at-NOW()>make_interval(mins=>er.remind_minutes-2)`);for(const x of r.rows){const exists=await q(`SELECT 1 FROM notifications WHERE user_id=$1 AND type='event_reminder' AND body LIKE $2 AND created_at>NOW()-INTERVAL '2 hours'`,[x.user_id,`%${x.event_id}%`]);if(!exists.rowCount)await createNotification(x.user_id,null,'event_reminder','⏰ Event reminder',`Event ${x.event_id}: ${x.title} starts ${new Date(x.starts_at).toLocaleString()}`)}}catch{}} ,60_000);

