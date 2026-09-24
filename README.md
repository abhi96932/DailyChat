# VibeMeet

VibeMeet is a dating + friendship + community web app. It combines swipe-style dating discovery with interest groups and events.

## Included features

1. **Community Match Score** — recommendations score age, city, course, shared groups, compatibility answers, interests and verification.
2. **Group → Dating** — group members can discover compatible people from the same community.
3. **Group Matchmaking** — common group membership contributes to recommendations and the “Why you match” reasons.
4. **Compatibility Questions** — quick either/or questions feed the match score.
5. **Why You Match** — each recommendation shows concise reasons behind its score.
6. **Group Events** — joined groups can create events and users can join upcoming activities.
7. **Dating / Friendship / Community modes** — users choose the connection mode; discovery respects the selected mode.

Also retained: guest accounts, private messaging, JPG/PNG/WebP image sharing up to 2 MB, voice/video WebRTC calls, block/report, admin moderation, VIP and optional Razorpay Call Pass.

## Run

Copy `.env.example` to `.env`, configure `DATABASE_URL` and a 32+ character `JWT_SECRET`, then:

```bash
npm install
npm run db:init
npm start
```

For Railway, connect the PostgreSQL service and set `DATABASE_URL=${{Postgres.DATABASE_URL}}` (replace `Postgres` with the exact database service name), `NODE_ENV=production`, and a strong `JWT_SECRET`.

### Production notes

This build includes a production hardening pass: HttpOnly session cookies, short-lived Socket.IO tokens, logout/change-password/guest conversion, discovery filters and profile quality, report escalation and content reports, trip safety status/check-ins, PostgreSQL SSL/pool settings, Helmet security headers, origin checks, API error handling, smoke tests and a pg_dump backup command.

Before public launch, still configure and verify: a real email provider for password reset/verification, age/identity verification appropriate to your audience, privacy/terms/safety policies, automated photo/content moderation, object storage + malware scanning for media, Redis-backed distributed rate limiting, short-lived TURN credentials, Razorpay live keys + webhook reconciliation, observability/alerts, scheduled Railway/Postgres backups, restore drills, security testing and load testing. OWASP recommends secure cookie attributes, server-side session controls, authentication-event logging and strong server-side input/file validation.

Run `npm test` for static smoke checks and `npm run db:backup` from a machine that has `pg_dump` installed and network access to `DATABASE_URL`.

## VibeMeet Gen-Z UI refresh

The latest build includes a refreshed responsive UI with a softer glass/gradient visual system, improved mobile layouts, redesigned community cards, group detail workspace, live member panel, welcome prompts, and clearer dating/community CTAs. Existing API routes and core functionality are preserved.


### Profile photos
JPG, PNG and WebP profile photos up to 2 MB are resized in the browser to a practical 1200px maximum and stored in PostgreSQL for this prototype. For production scale, move avatars to object storage/CDN.

## VibeMeet Community + Travel
This build keeps the premium dating/messaging stack and adds a community-first layer with an Uttarakhand travel system. The database initializer also seeds the Uttarakhand destinations and travel communities from `db/travel_seed.sql`.
