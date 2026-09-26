# VibeMeet v9 — Product Roadmap Build

This build adds the next product layer while preserving the v8 dating-discovery behavior:

- Home remains one-profile-at-a-time.
- Explore remains compatible-profile discovery; there is no public People directory.
- Private messaging and calls require a mutual match.
- Razorpay remains in Test Mode; existing payment/webhook configuration is preserved.

## Added

### Safety & Trust
- Safety Center and privacy controls
- Exact-location privacy setting
- Online/last-seen controls
- Emergency contacts
- Date safety shares and check-ins
- Block/unblock management
- Structured report reasons
- Profile verification request + admin review + verified badge
- Account data export and permanent deletion confirmation

### Matching
- Saved discovery preferences: age, cities, colleges, interests, travel interests, lifestyle, languages and hobbies
- Richer compatibility scoring and “why this match” reasons
- Incognito/snooze/travel mode preserved

### Profiles
- Lifestyle, hobbies and travel interests
- Existing multi-photo gallery/reorder/delete flows retained
- Profile completion and preview retained

### Messaging
- Mutual-match enforcement retained
- Image sharing retained
- Voice-note recording and playback
- Reply/reactions/read receipts/typing retained
- Message unsend

### Notifications
- Notification preferences
- Browser/PWA shell
- Event reminders
- Existing in-app real-time notification system retained

### Travel
- Existing Travel Together/trip builder/check-ins/emergency contact flows retained
- AI trip planner added

### Communities & Events
- Existing community feed, groups, comments, likes, follows and moderation retained
- Event reminders added

### AI
- AI Match Assistant
- AI Icebreaker generator
- AI Profile Assistant
- AI Trip Planner

These are deterministic application-side assistants and do not require an external AI secret. They can later be upgraded to a configured local/hosted model.

### Admin & Analytics
- Verification queue
- Moderation/report tools retained
- Product funnel analytics
- User activity analytics
- Production readiness check retained

### Security
- Existing Helmet, rate limits, HttpOnly sessions, audit logs, image validation and production checks retained
- Password reset/email verification token infrastructure added with optional `EMAIL_WEBHOOK_URL`
- Webhook event idempotency added
- Razorpay captured/failed events reconcile subscriptions and feature purchases

### Monetization
- Free plan daily like limit
- VibeMeet+ price configured at ₹199 / 30 days in the UI and server default
- Super Like ₹49
- Boost ₹99
- Existing Call Pass preserved
- Existing Razorpay Test Mode integration preserved

## New optional environment variables

```text
VIP_AMOUNT=199
EMAIL_WEBHOOK_URL=
EMAIL_WEBHOOK_AUTH=
```

Do not add secrets to Git. Configure them in Railway Variables.

## Validation

```text
node --check src/server.js
node --check public/app.js
node --check public/travel.js
node --check public/community.js
npm test
```

Current smoke tests: **8 passed**.
