import fs from "node:fs/promises";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import {pool,q} from "./db.js";
dotenv.config();
const schema=await fs.readFile(new URL("../db/schema.sql",import.meta.url),"utf8");
await q(schema);
const rooms=[
["Hindi Chat","hindi","Hindi","🇮🇳"],["English Chat","english","English","🇬🇧"],["Punjabi Chat","punjabi","Punjabi","🪷"],["Bengali Chat","bengali","Bengali","🇧🇩"],["Marathi Chat","marathi","Marathi","🇮🇳"],["Telugu Chat","telugu","Telugu","🇮🇳"],["Kannada Chat","kannada","Kannada","🇮🇳"],["Tamil Chat","tamil","Tamil","🇮🇳"],["International","international","International","🌍"]];
for(const r of rooms) await q("INSERT INTO rooms(name,slug,language,flag) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",r);
const groups=[
["B.Tech CSE","btech-cse","Education","💻","B.Tech CSE students, projects, placements and campus life."],
["Other Courses","other-courses","Education","🎓","Students from every course can connect, study and share opportunities."],
["Travel India","travel-india","Travel","✈️","Trips, itineraries, travel buddies and weekend plans across India."],
["Coding & Hackathons","coding-hackathons","Career","👨‍💻","Build projects, find teammates and discuss hackathons."],
["Fitness & Wellness","fitness-wellness","Lifestyle","🏋️","Fitness, running, nutrition and healthy routines."],
["Gaming","gaming","Entertainment","🎮","Find gaming friends and squad up."],
["Music & Movies","music-movies","Entertainment","🎵","Talk about music, films, shows and creators."],
["Photography","photography","Creative","📸","Share photography ideas, locations and creative work."],
["College Life","college-life","Education","🏫","Campus communities, clubs, events and friendships."],
["City Hangouts","city-hangouts","Local","📍","Meet people around your city for safe public activities."]
];
for(const g of groups) await q("INSERT INTO groups(name,slug,category,icon,description) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",g);
const qs=[
["Ideal weekend?","Road trip or exploring","Relaxing at home","lifestyle"],
["Conversation style?","Deep talks","Fun & spontaneous","personality"],
["Travel preference?","Mountains","Beaches","travel"],
["Study/work style?","Plan everything","Go with the flow","lifestyle"],
["Social energy?","Small circle","Big groups","personality"],
["First date vibe?","Coffee & talk","Activity together","dating"]
];
for(const x of qs) await q("INSERT INTO compatibility_questions(question,option_a,option_b,category) SELECT $1,$2,$3,$4 WHERE NOT EXISTS (SELECT 1 FROM compatibility_questions WHERE question=$1)",x);
const email=process.env.ADMIN_EMAIL,pass=process.env.ADMIN_PASSWORD;
if(email&&pass){const hash=await bcrypt.hash(pass,12);await q("INSERT INTO users(name,email,password_hash,role,verified,status,mode) VALUES('VibeMeet Admin',$1,$2,'admin',true,'offline','community') ON CONFLICT(email) DO NOTHING",[email,hash]);}
console.log("VibeMeet database initialized.");
await pool.end();
