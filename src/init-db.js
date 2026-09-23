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

const travelDestinations=[
["Rishikesh","rishikesh","Garhwal","Dehradun","River town for rafting, cafes, yoga and easy student weekends.","🌊","Easy",500,700,450,300,500,[2,3,4,5,6,7,8,9,10,11],[
 {"name":"Haridwar","duration":"45 min","type":"start"},
 {"name":"Shivpuri","duration":"30 min","type":"activity"},
 {"name":"Rishikesh","duration":"1 day","type":"stay"}
],["river","adventure","weekend","quiet"]],
["Haridwar","haridwar","Garhwal","Haridwar","Gateway city for riverfront walks, temples and nearby weekend trips.","🛕","Easy",200,600,350,250,150,[1,2,3,4,5,6,7,8,9,10,11,12],[{"name":"Har Ki Pauri","duration":"2 hr","type":"sightseeing"},{"name":"Kankhal","duration":"1 hr","type":"culture"}],["spiritual","weekend","city"]],
["Kanatal","kanatal","Garhwal","Tehri Garhwal","Quiet forest and mountain escape suited to student groups.","🌲","Easy",1200,800,400,350,300,[3,4,5,6,9,10,11],[{"name":"Dhanaulti","duration":"1 hr","type":"stop"},{"name":"Surkanda Devi","duration":"2 hr","type":"trek"},{"name":"Kanatal","duration":"1 day","type":"stay"}],["mountains","quiet","camping","weekend"]],
["Dhanaulti","dhanaulti","Garhwal","Tehri Garhwal","Pine forests, eco parks and a calm alternative to crowded hill stations.","🌲","Easy",1200,800,400,300,250,[3,4,5,6,9,10,11],[{"name":"Dhanaulti Eco Park","duration":"2 hr","type":"sightseeing"},{"name":"Surkanda Devi","duration":"3 hr","type":"trek"}],["mountains","quiet","weekend"]],
["Tehri","tehri","Garhwal","Tehri Garhwal","Lake, adventure sports and scenic road-trip destination.","🏞️","Easy",1000,650,400,350,500,[3,4,5,6,9,10,11],[{"name":"Tehri Lake","duration":"3 hr","type":"activity"},{"name":"New Tehri","duration":"2 hr","type":"stop"}],["lake","adventure","weekend"]],
["Auli","auli","Garhwal","Chamoli","High-altitude ski and mountain destination with dramatic Himalayan views.","❄️","Moderate",1800,1100,500,400,700,[1,2,3,4,5,10,11,12],[{"name":"Joshimath","duration":"1 hr","type":"base"},{"name":"Auli","duration":"1 day","type":"stay"}],["mountains","snow","trek"]],
["Munsiyari","munsiyari","Kumaon","Pithoragarh","Remote Kumaon mountain destination known for Himalayan views and treks.","🏔️","Moderate",2200,900,450,500,500,[3,4,5,10,11],[{"name":"Almora","duration":"stop","type":"route"},{"name":"Bageshwar","duration":"stop","type":"route"},{"name":"Munsiyari","duration":"2 days","type":"stay"}],["mountains","trek","quiet","backpacking"]],
["Mukteshwar","mukteshwar","Kumaon","Nainital","Forest hills, viewpoints and climbing near Nainital district.","🌄","Easy",1500,850,450,300,300,[3,4,5,6,9,10,11],[{"name":"Mukteshwar Temple","duration":"1 hr","type":"sightseeing"},{"name":"Chauli Ki Jali","duration":"1 hr","type":"viewpoint"}],["mountains","quiet","photography"]],
["Ranikhet","ranikhet","Kumaon","Almora","Pine forests, cantonment roads and relaxed Kumaon scenery.","🌲","Easy",1500,750,400,300,250,[3,4,5,6,9,10,11],[{"name":"Chaubatia","duration":"2 hr","type":"sightseeing"},{"name":"Ranikhet","duration":"1 day","type":"stay"}],["mountains","quiet","photography"]],
["Kausani","kausani","Kumaon","Bageshwar","Wide Himalayan views and slow-travel destination.","🏔️","Easy",1700,800,400,350,250,[3,4,5,6,9,10,11],[{"name":"Baijnath","duration":"2 hr","type":"stop"},{"name":"Kausani","duration":"1 day","type":"stay"}],["mountains","quiet","photography"]],
["Valley of Flowers","valley-of-flowers","Garhwal","Chamoli","Seasonal alpine valley trek; plan around opening conditions and local rules.","🌸","Hard",2200,1200,550,500,700,[7,8,9],[{"name":"Govindghat","duration":"base","type":"route"},{"name":"Ghangaria","duration":"1 day","type":"stay"},{"name":"Valley of Flowers","duration":"1 day","type":"trek"}],["mountains","trek","flowers"]],
["Chakrata","chakrata","Garhwal","Dehradun","Forested hill destination with waterfalls, viewpoints and hikes.","🌲","Moderate",1400,800,400,350,350,[3,4,5,6,9,10,11],[{"name":"Tiger Falls","duration":"half day","type":"trek"},{"name":"Chakrata","duration":"1 day","type":"stay"}],["mountains","trek","quiet"]],
["Jageshwar","jageshwar","Kumaon","Almora","Heritage temple cluster surrounded by cedar forests.","🛕","Easy",1700,700,400,300,200,[3,4,5,6,9,10,11],[{"name":"Jageshwar Temples","duration":"3 hr","type":"culture"},{"name":"Dandeshwar","duration":"1 hr","type":"culture"}],["culture","quiet","photography"]],
["Pithoragarh","pithoragarh","Kumaon","Pithoragarh","Gateway to eastern Kumaon and longer mountain journeys.","🏔️","Moderate",2200,700,400,450,250,[3,4,5,10,11],[{"name":"Pithoragarh","duration":"1 day","type":"base"},{"name":"Munsiyari","duration":"route","type":"extension"}],["mountains","backpacking"]]
];
for(const d of travelDestinations) await q(`INSERT INTO destinations(name,slug,region,district,description,icon,difficulty,base_transport,stay_per_night,food_per_day,local_transport,activities,recommended_months,route_stops,tags)
 VALUES($1,$2,'Uttarakhand',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
 ON CONFLICT(slug) DO NOTHING`,[
  d[0],d[1],d[3],d[4],d[5],d[6],d[7],d[8],d[9],d[10],d[11],d[12],JSON.stringify(d[13]),d[14]
 ]);
const travelGroups=[
["Uttarakhand Travel","uttarakhand-travel","Travel","🏔️","Student travel plans, buddies, routes and safe group trips across Uttarakhand."],
["Uttarakhand Trekkers","uttarakhand-trekkers","Travel","🥾","Treks, trail preparation and mountain adventures."],
["Budget Backpackers UK","budget-backpackers-uk","Travel","🎒","Low-cost student travel and smart shared budgets."],
["Student Trips Uttarakhand","student-trips-uttarakhand","Travel","🎓","Find classmates and students for weekend and semester trips."],
["Garhwal Explorers","garhwal-explorers","Travel","🌲","Explore Garhwal destinations together."],
["Kumaon Explorers","kumaon-explorers","Travel","🏔️","Discover Kumaon with fellow students."],
["Weekend Trips from Haridwar","weekend-haridwar","Local","🚗","Quick trips starting from Haridwar."],
["Backpacking from Dehradun","backpacking-dehradun","Local","🚆","Find people leaving from Dehradun and nearby areas."]
];
for(const g of travelGroups) await q("INSERT INTO groups(name,slug,category,icon,description) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",g);

const email=process.env.ADMIN_EMAIL,pass=process.env.ADMIN_PASSWORD;
if(email&&pass){const hash=await bcrypt.hash(pass,12);await q("INSERT INTO users(name,email,password_hash,role,verified,status,mode) VALUES('VibeMeet Admin',$1,$2,'admin',true,'offline','community') ON CONFLICT(email) DO NOTHING",[email,hash]);}
console.log("VibeMeet database initialized.");
await pool.end();
