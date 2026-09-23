import express from "express";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import dotenv from "dotenv";
import helmet from "helmet";
import {Server} from "socket.io";
import Razorpay from "razorpay";
import crypto from "node:crypto";
import {q,pool} from "./db.js";
import {ensureDatabase} from "./ensure-db.js";
import {auth,optionalAuth,register,login,sign,verifyToken,guest} from "./auth.js";
dotenv.config();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(),server=http.createServer(app); app.set("trust proxy",1);
const io=new Server(server,{cors:{origin:process.env.CORS_ORIGIN||true,methods:["GET","POST"]}});
const buckets=new Map();
function rateLimit({windowMs=60_000,max=120,keyFn=req=>req.ip}={}){return(req,res,next)=>{const key=keyFn(req),now=Date.now();let b=buckets.get(key);if(!b||now-b.start>windowMs)b={start:now,count:0};b.count++;buckets.set(key,b);if(b.count>max)return res.status(429).json({error:"Too many requests. Please try again shortly."});next()}}
const authLimiter=rateLimit({windowMs:15*60_000,max:25}),apiLimiter=rateLimit({windowMs:60_000,max:240}),messageLimiter=rateLimit({windowMs:10_000,max:30,keyFn:req=>`${req.ip}:${req.user?.id||"anon"}`});
app.use(helmet({contentSecurityPolicy:false,crossOriginEmbedderPolicy:false}));
app.post("/api/vip/webhook",express.raw({type:"application/json",limit:"1mb"}),async(req,res)=>{try{const secret=process.env.RAZORPAY_WEBHOOK_SECRET;if(!secret)return res.status(503).json({error:"Webhook secret not configured"});const sig=req.headers["x-razorpay-signature"]||"",expected=crypto.createHmac("sha256",secret).update(req.body).digest("hex");if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return res.status(400).json({error:"Invalid webhook signature"});const event=JSON.parse(req.body.toString("utf8")),payment=event.payload?.payment?.entity;if(event.event==="payment.captured"&&payment?.order_id){const sub=await q("UPDATE subscriptions SET payment_id=$1,status='paid' WHERE order_id=$2 AND status<>'paid' RETURNING user_id,product",[payment.id,payment.order_id]);if(sub.rowCount){const row=sub.rows[0];if(row.product==="call_pass"){const days=Number(process.env.CALL_PASS_DAYS||7);await q("UPDATE users SET call_pass_until=GREATEST(COALESCE(call_pass_until,NOW()),NOW())+($1::int * INTERVAL '1 day') WHERE id=$2",[days,row.user_id])}else await q("UPDATE users SET vip_until=GREATEST(COALESCE(vip_until,NOW()),NOW())+INTERVAL '30 days' WHERE id=$1",[row.user_id])}}res.json({received:true})}catch{res.status(400).json({error:"Invalid webhook payload"})}});
app.use(express.json({limit:"7mb"}));app.use(apiLimiter);app.use(express.static(path.join(__dirname,"../public")));
app.get("/health",(_req,res)=>res.json({ok:true,service:"vibemeet",time:new Date().toISOString()}));
app.get("/api/config",(_req,res)=>res.json({turnUrls:process.env.TURN_URLS||"",turnUsername:process.env.TURN_USERNAME||"",turnCredential:process.env.TURN_CREDENTIAL||""}));
const userSelect=`id,name,email,avatar,bio,role,verified,vip_until,call_pass_until,status,gender,match_preference,is_guest,guest_expires_at,age,city,college,course,relationship_intent,interests,languages,mode`;
app.post("/api/auth/register",authLimiter,async(req,res)=>{try{const {name,email,password,gender,matchPreference,mode,age,city,college,course,relationshipIntent,interests,languages}=req.body;if(!name||name.trim().length<2||name.trim().length>40||!email||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!password||password.length<8)return res.status(400).json({error:"Name, valid email and 8+ character password required"});const u=await register(name.trim(),email.trim(),password,{gender,matchPreference,mode,age:Number(age)||null,city,college,course,relationshipIntent,interests,languages});res.json({user:u,token:sign(u)})}catch(e){res.status(e.status||500).json({error:e.message})}});
app.post("/api/auth/guest",authLimiter,async(_req,res)=>{try{const u=await guest();res.json({user:u,token:sign(u)})}catch(e){res.status(e.status||500).json({error:e.message})}});
app.post("/api/auth/login",authLimiter,async(req,res)=>{try{const u=await login(req.body.email,req.body.password);res.json({user:u,token:sign(u)})}catch(e){res.status(e.status||500).json({error:e.message})}});
app.get("/api/me",auth,async(req,res)=>{const r=await q(`SELECT ${userSelect} FROM users WHERE id=$1`,[req.user.id]);res.json(r.rows[0])});
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
app.patch("/api/me",auth,async(req,res)=>{const allowedGender=["male","female","other","prefer_not_to_say"],allowedPref=["any","same","opposite"],allowedMode=["dating","friendship","community"];const b=req.body;const gender=allowedGender.includes(b.gender)?b.gender:null,pref=allowedPref.includes(b.matchPreference)?b.matchPreference:null,mode=allowedMode.includes(b.mode)?b.mode:null;if(!gender||!pref||!mode)return res.status(400).json({error:"Invalid profile preference"});const age=b.age?Math.max(18,Math.min(100,Number(b.age))):null;const interests=Array.isArray(b.interests)?b.interests.map(String).map(x=>x.trim()).filter(Boolean).slice(0,30):[];const languages=Array.isArray(b.languages)?b.languages.map(String).map(x=>x.trim()).filter(Boolean).slice(0,10):[];const avatar=typeof b.avatar==='string'&&b.avatar.length<=5_500_000?b.avatar:"";const name=String(b.name||req.user.name).trim().slice(0,40)||req.user.name;await q(`UPDATE users SET name=$1,avatar=$2,bio=$3,gender=$4,match_preference=$5,mode=$6,age=$7,city=$8,college=$9,course=$10,relationship_intent=$11,interests=$12,languages=$13 WHERE id=$14`,[name,avatar,String(b.bio||"").slice(0,280),gender,pref,mode,age,String(b.city||"").slice(0,80),String(b.college||"").slice(0,120),String(b.course||"").slice(0,100),String(b.relationshipIntent||"open_to_connections").slice(0,40),interests,languages,req.user.id]);const r=await q(`SELECT ${userSelect} FROM users WHERE id=$1`,[req.user.id]);res.json(r.rows[0])});

// Communities and events
app.get("/api/groups",auth,async(req,res)=>{const r=await q(`SELECT g.*,COUNT(gm.user_id)::int AS members,EXISTS(SELECT 1 FROM group_members x WHERE x.group_id=g.id AND x.user_id=$1) AS joined FROM groups g LEFT JOIN group_members gm ON gm.group_id=g.id GROUP BY g.id ORDER BY members DESC,g.name`,[req.user.id]);res.json(r.rows)});
app.post("/api/groups/:id/join",auth,async(req,res)=>{await q("INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[req.params.id,req.user.id]);res.json({ok:true})});
app.post("/api/groups/:id/leave",auth,async(req,res)=>{await q("DELETE FROM group_members WHERE group_id=$1 AND user_id=$2",[req.params.id,req.user.id]);res.json({ok:true})});
app.get("/api/groups/:id/members",auth,async(req,res)=>{const r=await q(`SELECT u.id,u.name,u.avatar,u.bio,u.verified,u.age,u.city,u.college,u.course,u.interests,u.mode FROM users u JOIN group_members gm ON gm.user_id=u.id WHERE gm.group_id=$1 ORDER BY u.verified DESC,u.name LIMIT 100`,[req.params.id]);res.json(r.rows)});
app.get("/api/groups/:id/messages",auth,async(req,res)=>{const r=await q(`SELECT m.id,m.body,m.attachment_data,m.attachment_mime,m.created_at,u.id sender_id,u.name sender_name,u.avatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.group_id=$1 ORDER BY m.created_at DESC LIMIT 100`,[req.params.id]);res.json(r.rows.reverse())});
app.get("/api/events",auth,async(req,res)=>{const r=await q(`SELECT e.*,g.name group_name,COUNT(em.user_id)::int attendees,EXISTS(SELECT 1 FROM event_members x WHERE x.event_id=e.id AND x.user_id=$1) AS joined FROM events e JOIN groups g ON g.id=e.group_id LEFT JOIN event_members em ON em.event_id=e.id WHERE e.starts_at>=NOW()-INTERVAL '1 day' GROUP BY e.id,g.name ORDER BY e.starts_at LIMIT 100`,[req.user.id]);res.json(r.rows)});
app.post("/api/groups/:id/events",auth,async(req,res)=>{const member=await q("SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2",[req.params.id,req.user.id]);if(!member.rowCount)return res.status(403).json({error:"Join the group first"});const {title,description,startsAt,location}=req.body;if(!title||!startsAt)return res.status(400).json({error:"Title and start time required"});const r=await q("INSERT INTO events(group_id,creator_id,title,description,starts_at,location) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[req.params.id,req.user.id,String(title).slice(0,120),String(description||"").slice(0,500),startsAt,String(location||"").slice(0,150)]);res.json(r.rows[0])});
app.post("/api/events/:id/join",auth,async(req,res)=>{await q("INSERT INTO event_members(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[req.params.id,req.user.id]);res.json({ok:true})});

// Compatibility and profile discovery
app.get("/api/compatibility/questions",auth,async(_req,res)=>{const r=await q("SELECT * FROM compatibility_questions ORDER BY id");res.json(r.rows)});
app.get("/api/compatibility/answers",auth,async(req,res)=>{const r=await q("SELECT question_id,answer FROM compatibility_answers WHERE user_id=$1",[req.user.id]);res.json(r.rows)});
app.put("/api/compatibility/answers",auth,async(req,res)=>{const answers=Array.isArray(req.body.answers)?req.body.answers:[];for(const a of answers){if(Number.isInteger(Number(a.questionId))&&String(a.answer||"").length<=120)await q("INSERT INTO compatibility_answers(user_id,question_id,answer) VALUES($1,$2,$3) ON CONFLICT(user_id,question_id) DO UPDATE SET answer=EXCLUDED.answer",[req.user.id,Number(a.questionId),String(a.answer)])}res.json({ok:true})});
function oppositeOk(me,target){if(me.match_preference==="any")return true;if(me.match_preference==="same")return !["male","female"].includes(me.gender)||me.gender===target.gender;if(me.match_preference==="opposite")return !["male","female"].includes(me.gender)||["male","female"].includes(target.gender)&&me.gender!==target.gender;return true}
function targetAccepts(me,target){if(target.match_preference==="any")return true;if(target.match_preference==="same")return !["male","female"].includes(target.gender)||target.gender===me.gender;if(target.match_preference==="opposite")return !["male","female"].includes(target.gender)||["male","female"].includes(me.gender)&&target.gender!==me.gender;return true}
app.get("/api/discover",auth,async(req,res)=>{const me=(await q(`SELECT * FROM users WHERE id=$1`,[req.user.id])).rows[0];const r=await q(`SELECT u.* FROM users u WHERE u.id<>$1 AND u.status<>'banned' AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=$1)) AND NOT EXISTS(SELECT 1 FROM swipes s WHERE s.swiper_id=$1 AND s.target_id=u.id) ORDER BY u.verified DESC,u.created_at DESC LIMIT 100`,[req.user.id]);const candidates=[];for(const u of r.rows){if(oppositeOk(me,u)&&targetAccepts(me,u))candidates.push(u)}
 const ids=candidates.map(x=>x.id);let groups=[];if(ids.length){groups=(await q("SELECT group_id,user_id FROM group_members WHERE user_id=ANY($1::bigint[])",[ids])).rows}const myGroups=(await q("SELECT group_id FROM group_members WHERE user_id=$1",[req.user.id])).rows.map(x=>Number(x.group_id));const qa=(await q("SELECT question_id,answer FROM compatibility_answers WHERE user_id=$1",[req.user.id])).rows;const qmap=new Map(qa.map(x=>[Number(x.question_id),x.answer]));const ids2=[...new Set(groups.map(x=>Number(x.group_id)))];const answerRows=ids.length?await q("SELECT user_id,question_id,answer FROM compatibility_answers WHERE user_id=ANY($1::bigint[])",[ids]):{rows:[]};const groupMap=new Map();for(const g of groups){const n=Number(g.user_id);if(!groupMap.has(n))groupMap.set(n,new Set());groupMap.get(n).add(Number(g.group_id))}const ansMap=new Map();for(const a of answerRows.rows){const n=Number(a.user_id);if(!ansMap.has(n))ansMap.set(n,new Map());ansMap.get(n).set(Number(a.question_id),a.answer)}function score(u){let s=45,reasons=[];if(u.age&&me.age){const d=Math.abs(u.age-me.age);if(d<=2){s+=12;reasons.push("Similar age")}else if(d<=5){s+=7}}if(me.city&&u.city&&me.city.toLowerCase()===u.city.toLowerCase()){s+=10;reasons.push("Same city")}if(me.course&&u.course&&me.course.toLowerCase()===u.course.toLowerCase()){s+=8;reasons.push("Same course")}const common=[...(groupMap.get(u.id)||[])].filter(x=>myGroups.includes(x));if(common.length){s+=Math.min(20,common.length*7);reasons.push(`${common.length} common group${common.length>1?'s':''}`)}const a=ansMap.get(u.id);let sameAnswers=0;if(a)for(const [qid,val] of qmap)if(a.get(qid)===val)sameAnswers++;if(sameAnswers){s+=Math.min(15,sameAnswers*4);reasons.push(`${sameAnswers} compatible answers`)}const commonInterests=(u.interests||[]).filter(x=>(me.interests||[]).map(v=>String(v).toLowerCase()).includes(String(x).toLowerCase()));if(commonInterests.length){s+=Math.min(15,commonInterests.length*3);reasons.push(`${commonInterests.length} shared interest${commonInterests.length>1?'s':''}`)}if(u.verified){s+=3;reasons.push("Verified profile")}return {score:Math.min(99,s),reasons:reasons.slice(0,4)}}
 const out=candidates.map(u=>{const z=score(u);return {id:u.id,name:u.name,avatar:u.avatar,bio:u.bio,verified:u.verified,age:u.age,city:u.city,college:u.college,course:u.course,relationship_intent:u.relationship_intent,interests:u.interests,languages:u.languages,gender:u.gender,mode:u.mode,match_score:z.score,reasons:z.reasons}}).sort((a,b)=>b.match_score-a.match_score);res.json(out)});
app.post("/api/swipes",auth,async(req,res)=>{const target=Number(req.body.targetId),direction=req.body.direction;if(!Number.isInteger(target)||target===req.user.id||!['like','pass'].includes(direction))return res.status(400).json({error:"Invalid swipe"});const blocked=await q("SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)",[req.user.id,target]);if(blocked.rowCount)return res.status(403).json({error:"User unavailable"});await q("INSERT INTO swipes(swiper_id,target_id,direction) VALUES($1,$2,$3) ON CONFLICT(swiper_id,target_id) DO UPDATE SET direction=EXCLUDED.direction,created_at=NOW()",[req.user.id,target,direction]);let matched=false;if(direction==='like'){const reciprocal=await q("SELECT 1 FROM swipes WHERE swiper_id=$1 AND target_id=$2 AND direction='like'",[target,req.user.id]);if(reciprocal.rowCount){const a=Math.min(req.user.id,target),b=Math.max(req.user.id,target);await q("INSERT INTO matches(user1_id,user2_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[a,b]);matched=true;io.to(`user:${target}`).emit("new:match",{userId:req.user.id})}}res.json({ok:true,matched})});
app.get("/api/matches",auth,async(req,res)=>{const r=await q(`SELECT m.id,CASE WHEN m.user1_id=$1 THEN u2.id ELSE u1.id END user_id,CASE WHEN m.user1_id=$1 THEN u2.name ELSE u1.name END name,CASE WHEN m.user1_id=$1 THEN u2.avatar ELSE u1.avatar END avatar,CASE WHEN m.user1_id=$1 THEN u2.verified ELSE u1.verified END verified FROM matches m JOIN users u1 ON u1.id=m.user1_id JOIN users u2 ON u2.id=m.user2_id WHERE m.user1_id=$1 OR m.user2_id=$1 ORDER BY m.created_at DESC`,[req.user.id]);res.json(r.rows)});

// Legacy rooms/private chat + moderation
app.get("/api/rooms",optionalAuth,async(_req,res)=>{const r=await q(`SELECT r.*,COUNT(DISTINCT rm.user_id)::int online FROM rooms r LEFT JOIN room_members rm ON rm.room_id=r.id GROUP BY r.id ORDER BY r.name`);res.json(r.rows)});
app.post("/api/rooms/:id/join",auth,async(req,res)=>{const room=await q("SELECT * FROM rooms WHERE id=$1",[req.params.id]);if(!room.rowCount)return res.status(404).json({error:"Room not found"});await q("INSERT INTO room_members(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[req.params.id,req.user.id]);res.json(room.rows[0])});
app.get("/api/rooms/:id/messages",auth,async(req,res)=>{const r=await q(`SELECT m.id,m.body,m.created_at,u.id sender_id,u.name sender_name,u.avatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.room_id=$1 ORDER BY m.created_at DESC LIMIT 100`,[req.params.id]);res.json(r.rows.reverse())});
app.get("/api/people",auth,async(req,res)=>{const r=await q(`SELECT ${userSelect} FROM users WHERE id<>$1 AND status='online' AND id NOT IN(SELECT blocked_id FROM blocks WHERE blocker_id=$1) AND id NOT IN(SELECT blocker_id FROM blocks WHERE blocked_id=$1) ORDER BY verified DESC,created_at DESC LIMIT 50`,[req.user.id]);res.json(r.rows)});
app.get("/api/dm/:id/messages",auth,async(req,res)=>{const id=Number(req.params.id);const r=await q(`SELECT m.id,m.body,m.attachment_data,m.attachment_mime,m.created_at,u.id sender_id,u.name sender_name,u.avatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE ((m.sender_id=$1 AND m.receiver_id=$2) OR (m.sender_id=$2 AND m.receiver_id=$1)) ORDER BY m.created_at DESC LIMIT 100`,[req.user.id,id]);res.json(r.rows.reverse())});
app.post("/api/dm/:id/image",auth,messageLimiter,async(req,res)=>{try{const id=Number(req.params.id),dataUrl=String(req.body.dataUrl||""),m=dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);if(!Number.isInteger(id)||id===req.user.id)return res.status(400).json({error:"Invalid user"});if(!m)return res.status(400).json({error:"Only JPG, PNG or WebP images are allowed"});const bytes=Buffer.from(m[2],"base64");if(bytes.length>2*1024*1024)return res.status(413).json({error:"Image must be 2 MB or smaller"});const r=await q("INSERT INTO messages(sender_id,receiver_id,body,attachment_data,attachment_mime) VALUES($1,$2,'[Image]',$3,$4) RETURNING id,body,attachment_data,attachment_mime,created_at",[req.user.id,id,dataUrl,m[1]]);io.to(`dm:${Math.min(req.user.id,id)}:${Math.max(req.user.id,id)}`).emit("dm:message",{...r.rows[0],sender_id:req.user.id,sender_name:req.user.name});res.json(r.rows[0])}catch{res.status(500).json({error:"Could not send image"})}});
app.post("/api/users/:id/block",auth,async(req,res)=>{if(Number(req.params.id)===req.user.id)return res.status(400).json({error:"You cannot block yourself"});await q("INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[req.user.id,req.params.id]);res.json({ok:true})});
app.post("/api/reports",auth,async(req,res)=>{const {reportedUserId,messageId,reason,details}=req.body;if(!reportedUserId||Number(reportedUserId)===req.user.id||!reason)return res.status(400).json({error:"Missing report fields"});await q("INSERT INTO reports(reporter_id,reported_user_id,message_id,reason,details) VALUES($1,$2,$3,$4,$5)",[req.user.id,reportedUserId,messageId||null,String(reason).slice(0,100),String(details||"").slice(0,1000)]);res.json({ok:true})});

// Payments
const razorpay=process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET?new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET}):null;
async function createOrder(req,res,product){if(!razorpay)return res.status(503).json({error:"Payments not configured"});const amount=product==='vip'?499:Number(process.env.CALL_PASS_AMOUNT||99),days=Number(process.env.CALL_PASS_DAYS||7);const order=await razorpay.orders.create({amount:amount*100,currency:'INR',receipt:`${product}_${req.user.id}_${Date.now()}`});await q("INSERT INTO subscriptions(user_id,order_id,amount_paise,status,product) VALUES($1,$2,$3,'created',$4)",[req.user.id,order.id,amount*100,product]);res.json({orderId:order.id,amount:amount*100,keyId:process.env.RAZORPAY_KEY_ID,days})}
app.post("/api/vip/order",auth,(req,res)=>createOrder(req,res,'vip'));app.post("/api/call-pass/order",auth,(req,res)=>createOrder(req,res,'call_pass'));
app.post("/api/payments/verify",auth,async(req,res)=>{const {orderId,paymentId,signature}=req.body;if(!process.env.RAZORPAY_KEY_SECRET)return res.status(503).json({error:"Payments not configured"});const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(orderId+'|'+paymentId).digest('hex');if(!signature||signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return res.status(400).json({error:'Invalid payment signature'});const sub=await q("UPDATE subscriptions SET payment_id=$1,status='paid' WHERE user_id=$2 AND order_id=$3 AND status<>'paid' RETURNING product",[paymentId,req.user.id,orderId]);if(!sub.rowCount)return res.status(409).json({error:'Payment already processed or order not found'});if(sub.rows[0].product==='call_pass'){const days=Number(process.env.CALL_PASS_DAYS||7);await q("UPDATE users SET call_pass_until=GREATEST(COALESCE(call_pass_until,NOW()),NOW())+($1::int * INTERVAL '1 day') WHERE id=$2",[days,req.user.id])}else await q("UPDATE users SET vip_until=GREATEST(COALESCE(vip_until,NOW()),NOW())+INTERVAL '30 days' WHERE id=$1",[req.user.id]);res.json({ok:true})});

// Admin
app.get("/api/admin/stats",auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});const [u,r,m,o,b]=await Promise.all([q('SELECT count(*)::int n FROM users'),q("SELECT count(*)::int n FROM reports WHERE status='open'"),q('SELECT count(*)::int n FROM messages'),q("SELECT count(*)::int n FROM users WHERE status='online'"),q("SELECT count(*)::int n FROM users WHERE status='banned'")]);res.json({users:u.rows[0].n,openReports:r.rows[0].n,messages:m.rows[0].n,online:o.rows[0].n,banned:b.rows[0].n})});
app.get("/api/admin/reports",auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});const r=await q(`SELECT rp.*,a.name reporter_name,b.name reported_name FROM reports rp JOIN users a ON a.id=rp.reporter_id JOIN users b ON b.id=rp.reported_user_id ORDER BY rp.created_at DESC LIMIT 200`);res.json(r.rows)});
app.post("/api/admin/reports/:id/resolve",auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});await q("UPDATE reports SET status='resolved' WHERE id=$1",[req.params.id]);res.json({ok:true})});
app.get("/api/admin/users",auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});const r=await q('SELECT id,name,email,role,verified,status,created_at FROM users ORDER BY created_at DESC LIMIT 200');res.json(r.rows)});
app.post("/api/admin/users/:id/ban",auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});if(Number(req.params.id)===req.user.id)return res.status(400).json({error:'Admin cannot ban self'});await q("UPDATE users SET status='banned' WHERE id=$1",[req.params.id]);io.to(`user:${req.params.id}`).emit('account:banned');res.json({ok:true})});
app.post("/api/admin/users/:id/unban",auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});await q("UPDATE users SET status='offline' WHERE id=$1 AND status='banned'",[req.params.id]);res.json({ok:true})});

const onlineSockets=new Map(),socketMessageTimes=new Map();function socketRate(id){const now=Date.now(),arr=(socketMessageTimes.get(id)||[]).filter(t=>now-t<10_000);arr.push(now);socketMessageTimes.set(id,arr);return arr.length<=30}function safeInt(v){const n=Number(v);return Number.isInteger(n)&&n>0?n:null}
io.use(async(socket,next)=>{try{const payload=verifyToken(socket.handshake.auth?.token||''),r=await q('SELECT id,name,role,status FROM users WHERE id=$1',[payload.id]);if(!r.rowCount||r.rows[0].status==='banned')throw Error();socket.user=r.rows[0];next()}catch{next(new Error('auth failed'))}});
io.on('connection',socket=>{const uid=socket.user.id;socket.join(`user:${uid}`);onlineSockets.set(uid,(onlineSockets.get(uid)||0)+1);q('UPDATE users SET status=\'online\' WHERE id=$1',[uid]).catch(()=>{});
 socket.on('room:join',async roomId=>{const id=safeInt(roomId);if(!id)return;await q('INSERT INTO room_members(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,uid]);socket.join(`room:${id}`)});
 socket.on('room:message',async({roomId,body}={})=>{if(!socketRate(uid)||typeof body!=='string'||!body.trim()||body.length>2000)return;const id=safeInt(roomId);if(!id)return;const member=await q('SELECT 1 FROM room_members WHERE room_id=$1 AND user_id=$2',[id,uid]);if(!member.rowCount)return;const r=await q('INSERT INTO messages(sender_id,room_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at',[uid,id,body.trim()]);io.to(`room:${id}`).emit('room:message',{...r.rows[0],sender_id:uid,sender_name:socket.user.name})});
 socket.on('group:join',async groupId=>{const id=safeInt(groupId);if(!id)return;await q('INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,uid]);socket.join(`group:${id}`)});
 socket.on('group:message',async({groupId,body}={})=>{if(!socketRate(uid)||typeof body!=='string'||!body.trim()||body.length>2000)return;const id=safeInt(groupId);if(!id)return;const member=await q('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2',[id,uid]);if(!member.rowCount)return;const r=await q('INSERT INTO messages(sender_id,group_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at',[uid,id,body.trim()]);io.to(`group:${id}`).emit('group:message',{...r.rows[0],sender_id:uid,sender_name:socket.user.name})});
 socket.on('dm:join',id=>{id=safeInt(id);if(id&&id!==uid)socket.join(`dm:${Math.min(uid,id)}:${Math.max(uid,id)}`)});
 socket.on('trip:join',async tripId=>{const id=safeInt(tripId);if(!id)return;const member=await q("SELECT 1 FROM trip_members WHERE trip_id=$1 AND user_id=$2 AND status='active'",[id,uid]);if(member.rowCount)socket.join(`trip:${id}`)});
 socket.on('trip:message',async({tripId,body}={})=>{if(!socketRate(uid)||typeof body!=='string'||!body.trim()||body.length>2000)return;const id=safeInt(tripId);if(!id)return;const member=await q("SELECT 1 FROM trip_members WHERE trip_id=$1 AND user_id=$2 AND status='active'",[id,uid]);if(!member.rowCount)return;const r=await q("INSERT INTO trip_messages(trip_id,sender_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at",[id,uid,body.trim()]);io.to(`trip:${id}`).emit('trip:message',{...r.rows[0],sender_id:uid,sender_name:socket.user.name})});
 socket.on('dm:message',async({to,body}={})=>{if(!socketRate(uid)||typeof body!=='string'||!body.trim()||body.length>2000)return;const id=safeInt(to);if(!id||id===uid)return;const b=await q('SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)',[id,uid]);if(b.rowCount)return;const r=await q('INSERT INTO messages(sender_id,receiver_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at',[uid,id,body.trim()]);io.to(`dm:${Math.min(uid,id)}:${Math.max(uid,id)}`).emit('dm:message',{...r.rows[0],sender_id:uid,sender_name:socket.user.name})});
 socket.on('call:offer',async({to,offer,type='video'}={})=>{const id=safeInt(to);if(!id||!offer)return;const target=await q('SELECT id,gender FROM users WHERE id=$1',[id]),me=await q('SELECT gender,call_pass_until FROM users WHERE id=$1',[uid]);if(!target.rowCount||!me.rowCount)return;const opposite=['male','female'].every(x=>[me.rows[0].gender,target.rows[0].gender].includes(x))&&me.rows[0].gender!==target.rows[0].gender,pass=me.rows[0].call_pass_until&&new Date(me.rows[0].call_pass_until)>new Date();if(opposite&&!pass)return socket.emit('call:blocked',{reason:'Call Pass required for opposite-gender calls'});io.to(`user:${id}`).emit('call:offer',{from:uid,offer,type})});
 socket.on('call:answer',({to,answer}={})=>{const id=safeInt(to);if(id)io.to(`user:${id}`).emit('call:answer',{from:uid,answer})});socket.on('call:ice',({to,candidate}={})=>{const id=safeInt(to);if(id)io.to(`user:${id}`).emit('call:ice',{from:uid,candidate})});socket.on('call:end',({to}={})=>{const id=safeInt(to);if(id)io.to(`user:${id}`).emit('call:end',{from:uid})});
 socket.on('disconnect',async()=>{const count=Math.max(0,(onlineSockets.get(uid)||1)-1);if(count)onlineSockets.set(uid,count);else{onlineSockets.delete(uid);await q("UPDATE users SET status='offline' WHERE id=$1 AND status<>'banned'",[uid]).catch(()=>{})}});
});

// ================= Community + Uttarakhand Travel API =================
async function notify(userId, actorId, type, title, body=""){
  try{
    const r=await q(`INSERT INTO notifications(user_id,actor_id,type,title,body)
      VALUES($1,$2,$3,$4,$5) RETURNING id,type,title,body,read_at,created_at`,
      [userId,actorId,type,title,body]);
    io.to(`user:${userId}`).emit("notification:new",{...r.rows[0],actor_id:actorId});
  }catch(e){ console.error("notification:",e.message); }
}
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

app.get("/api/notifications",auth,async(req,res)=>{
  const r=await q(`SELECT n.*,u.name actor_name,u.avatar actor_avatar
    FROM notifications n LEFT JOIN users u ON u.id=n.actor_id
    WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 50`,[req.user.id]);
  res.json(r.rows);
});
app.post("/api/notifications/read",auth,async(req,res)=>{
  await q("UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND read_at IS NULL",[req.user.id]);
  res.json({ok:true});
});

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
  await notify(trip.host_id,req.user.id,"trip_request","🧳 New trip join request",`${req.user.name} wants to join your trip.`);
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
    await notify(request.user_id,req.user.id,"trip_accept","🎒 Trip request accepted",`You're in ${trip.title}.`);
    res.json({ok:true,status:"accepted"});
  }else{
    await q("UPDATE trip_join_requests SET status='declined',updated_at=NOW() WHERE id=$1",[request.id]);
    await notify(request.user_id,req.user.id,"trip_decline","Trip request update",`Your request for ${trip.title} was declined.`);
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
app.post("/api/trips/:id/checkin",auth,async(req,res)=>{
  if(!(await isTripMember(req.params.id,req.user.id)))return res.status(403).json({error:"Join the trip first"});
  const status=["safe","help"].includes(req.body?.status)?req.body.status:"safe";
  const lat=Number.isFinite(Number(req.body?.latitude))?Number(req.body.latitude):null;
  const lon=Number.isFinite(Number(req.body?.longitude))?Number(req.body.longitude):null;
  const r=await q("INSERT INTO trip_checkins(trip_id,user_id,status,note,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[req.params.id,req.user.id,status,String(req.body?.note||"").slice(0,300),lat,lon]);
  if(status==="help"){const host=(await q("SELECT host_id,title FROM trips WHERE id=$1",[req.params.id])).rows[0];if(host)await notify(host.host_id,req.user.id,"trip_help","🚨 Trip safety alert",`${req.user.name} requested help in ${host.title}.`)}
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

// ================= End Community + Uttarakhand Travel API =================

const PORT=process.env.PORT||3000;ensureDatabase().then(()=>server.listen(PORT,()=>console.log(`VibeMeet running on port ${PORT}`))).catch(e=>{console.error("Database initialization failed:",e);process.exit(1)});process.on('SIGTERM',async()=>{await pool.end();process.exit(0)});
