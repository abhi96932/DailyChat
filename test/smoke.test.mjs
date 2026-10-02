import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";
const server=fs.readFileSync(new URL("../src/server.js",import.meta.url),"utf8");const app=fs.readFileSync(new URL("../public/app.js",import.meta.url),"utf8");const index=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");const schema=fs.readFileSync(new URL("../db/schema.sql",import.meta.url),"utf8");
test("core safety/discovery endpoints are present",()=>{for(const x of ["/api/discover","/api/swipes","/api/reports","/api/users/:id/block","/api/auth/logout","/api/auth/convert-guest","/api/auth/change-password","/api/trips/:id/safety","/api/feed/:id/report","/api/admin/reports/:id/action"] )assert.ok(server.includes(x),x);});
test("production protections are configured",()=>{assert.match(server,/helmet\(/);assert.match(server,/HttpOnly/);assert.match(server,/SameSite=Lax/);assert.match(server,/Permissions-Policy/);});
test("schema contains moderation and safety tables",()=>{assert.match(schema,/content_reports/);assert.match(schema,/trip_checkins/);assert.match(schema,/travel_profiles/);});
test("mobile and media flows remain wired",()=>{assert.match(index,/data-mobile-page="community"/);assert.match(app,/chatImageInput/);assert.match(app,/getUserMedia/);});

test("onboarding finishes into required camera verification",()=>{assert.match(app,/async function finishOnboarding\(\)/);assert.match(app,/await render\('verifyProfile'\)/);assert.match(app,/function renderVerification\(\)/);assert.match(app,/navigator\.mediaDevices\?\.getUserMedia/);assert.match(app,/captureVerificationPhoto/);assert.match(app,/api\('\/api\/verification\/request'/);assert.match(server,/verification_status=CASE WHEN avatar IS DISTINCT FROM \$2/);});

test("dating discovery is one-at-a-time and no public People directory remains",()=>{assert.match(app,/One person at a time/);assert.match(app,/async function renderExplore/);assert.doesNotMatch(index,/data-page="people"/);assert.doesNotMatch(app,/api\/people/);assert.match(app,/singleDiscoverCard/);});
test("private messaging and calls require a mutual match",()=>{assert.match(server,/usersAreMatched/);assert.match(server,/You can message only mutual matches/);assert.match(server,/await usersAreMatched\(uid,id\)/);});
test("roadmap v9 safety, verification, matching, AI and analytics endpoints are wired",()=>{
  for(const x of ["/api/safety","/api/verification/request","/api/match-preferences","/api/date-safety/shares","/api/analytics/events","/api/ai/match-assistant","/api/ai/profile-assist","/api/ai/trip-planner","/api/me/export","/api/admin/verifications"] )assert.ok(server.includes(x),x);
  assert.match(app,/Safety Center/);assert.match(app,/Discovery Preferences/);assert.match(app,/Vibe AI/);assert.match(app,/Activity & growth/);
});
test("privacy, account export and mobile PWA hooks are present",()=>{assert.match(server,/app.delete\('\/api\/me'/);assert.match(server,/password-reset\/request/);assert.match(index,/manifest.webmanifest/);assert.match(index,/serviceWorker.register/);assert.match(app,/toggleVoiceRecord/);assert.match(app,/unsendMessage/);});

test("Likes You identity is paywalled for free users",()=>{
  assert.match(server,/reveal_swipe_id/);
  assert.match(server,/const visible = vipActive/);
  assert.match(server,/const locked = vipActive/);
  assert.match(app,/buyExtraLike\(\$\{Number\(x\.swipe_id\)\}\)/);
  assert.match(app,/likes\.locked/);
});

test("Mobile drawer has backdrop and scroll-safe shell",()=>{
  assert.match(app,/drawerBackdrop/);
  assert.match(index,/id="drawerBackdrop"/);
  const css=fs.readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
  assert.match(css,/drawerBackdrop/);
  assert.match(css,/overscroll-behavior:contain/);
});

test("production polish, auth labeling and legal pages are wired",()=>{
  assert.match(index,/id="authSubmitBtn"/);
  assert.match(app,/submit\.textContent=registering\?'Create account':'Login'/);
  assert.match(app,/Meet people who share your interests, energy and plans/);
  assert.match(app,/renderLegal\('terms'\)/);
  assert.match(app,/renderLegal\('privacy'\)/);
  assert.match(app,/renderLegal\('refund'\)/);
  assert.match(index,/authSubmitBtn/);
  assert.match(server,/backupDirConfigured/);
});
test("backup script performs post-dump verification when pg_restore is available",()=>{
  const backup=fs.readFileSync(new URL("../scripts/backup-db.mjs",import.meta.url),"utf8");
  assert.match(backup,/pg_dump/);
  assert.match(backup,/pg_restore/);
  assert.match(backup,/Backup verified/);
});

test("flexible event foundation and community APIs are wired",()=>{
  for(const x of ["/api/events","/api/events/:id","/api/events/:id/join","/api/events/:id/leave","/api/events/:id/invite","/api/events/:id/announcements","/api/events/:id/chat","/api/events/:id/attendance","/api/events/:id/report","/api/events/:id/analytics","/api/admin/event-reports","/api/admin/event-reports/:id/action","/api/groups/:id/events"]) assert.ok(server.includes(x),x);
  assert.match(schema,/event_announcements/);assert.match(schema,/event_messages/);assert.match(schema,/event_invites/);assert.match(schema,/event_reports/);assert.match(schema,/event_attendance/);
});
test("event UX supports online offline hybrid and invite visibility",()=>{
  assert.match(app,/Online, offline or hybrid/);assert.match(app,/invite_only/);assert.match(app,/Show QR code/);assert.match(app,/External event link/);assert.match(app,/Create an experience/);
});
test("community UX connects communities to events",()=>{
  assert.match(app,/Find your people\. Build something together/);assert.match(app,/Community members/);assert.match(app,/COMMUNITY EVENTS|Community events/);assert.match(app,/createEventWizard/);
});

test("community event feed uses safe aggregation and polished event surfaces",()=>{
  const route=server.slice(server.indexOf('app.get("/api/groups/:id/events"'),server.indexOf('app.post("/api/groups/:id/join"'));
  assert.match(route,/LEFT JOIN \(SELECT event_id,COUNT\(user_id\)::int attendees FROM event_members GROUP BY event_id\)/);
  assert.match(app,/function memberAvatarHtml\(/);
  assert.match(app,/class="miniAvatarImg"/);
  assert.match(app,/eventsGrid/);
  const css=fs.readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
  assert.match(css,/\.eventCreateBackdrop\{\n  position:fixed/);
  assert.match(css,/\.miniAvatarImg\{/);
  assert.match(css,/\.eventsGrid\{grid-template-columns/);
});
