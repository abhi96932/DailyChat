import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";
const server=fs.readFileSync(new URL("../src/server.js",import.meta.url),"utf8");const app=fs.readFileSync(new URL("../public/app.js",import.meta.url),"utf8");const index=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");const schema=fs.readFileSync(new URL("../db/schema.sql",import.meta.url),"utf8");
test("core safety/discovery endpoints are present",()=>{for(const x of ["/api/discover","/api/swipes","/api/reports","/api/users/:id/block","/api/auth/logout","/api/auth/convert-guest","/api/auth/change-password","/api/trips/:id/safety","/api/feed/:id/report","/api/admin/reports/:id/action"] )assert.ok(server.includes(x),x);});
test("production protections are configured",()=>{assert.match(server,/helmet\(/);assert.match(server,/HttpOnly/);assert.match(server,/SameSite=Lax/);assert.match(server,/Permissions-Policy/);});
test("schema contains moderation and safety tables",()=>{assert.match(schema,/content_reports/);assert.match(schema,/trip_checkins/);assert.match(schema,/travel_profiles/);});
test("mobile and media flows remain wired",()=>{assert.match(index,/data-mobile-page="community"/);assert.match(app,/chatImageInput/);assert.match(app,/getUserMedia/);});

test("dating discovery is one-at-a-time and no public People directory remains",()=>{assert.match(app,/One person at a time/);assert.match(app,/async function renderExplore/);assert.doesNotMatch(index,/data-page="people"/);assert.doesNotMatch(app,/api\/people/);assert.match(app,/singleDiscoverCard/);});
test("private messaging and calls require a mutual match",()=>{assert.match(server,/usersAreMatched/);assert.match(server,/You can message only mutual matches/);assert.match(server,/await usersAreMatched\(uid,id\)/);});
test("roadmap v9 safety, verification, matching, AI and analytics endpoints are wired",()=>{
  for(const x of ["/api/safety","/api/verification/request","/api/match-preferences","/api/date-safety/shares","/api/analytics/events","/api/ai/match-assistant","/api/ai/profile-assist","/api/ai/trip-planner","/api/me/export","/api/admin/verifications"] )assert.ok(server.includes(x),x);
  assert.match(app,/Safety Center/);assert.match(app,/Discovery Preferences/);assert.match(app,/Vibe AI/);assert.match(app,/Activity & growth/);
});
test("privacy, account export and mobile PWA hooks are present",()=>{assert.match(server,/app.delete\('\/api\/me'/);assert.match(server,/password-reset\/request/);assert.match(index,/manifest.webmanifest/);assert.match(index,/serviceWorker.register/);assert.match(app,/toggleVoiceRecord/);assert.match(app,/unsendMessage/);});
