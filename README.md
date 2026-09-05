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

This is a feature-complete MVP/starter, not a claim of full production compliance. Before public launch, add age/identity verification, privacy/terms/safety policies, automated photo/content moderation, object storage + malware scanning for media, Redis-backed rate limiting, short-lived TURN credentials, payment reconciliation, observability, backups/restore tests, security testing and load testing.

## VibeMeet Gen-Z UI refresh

The latest build includes a refreshed responsive UI with a softer glass/gradient visual system, improved mobile layouts, redesigned community cards, group detail workspace, live member panel, welcome prompts, and clearer dating/community CTAs. Existing API routes and core functionality are preserved.


### Profile photos
JPG, PNG and WebP profile photos up to 2 MB are resized in the browser to a practical 1200px maximum and stored in PostgreSQL for this prototype. For production scale, move avatars to object storage/CDN.
