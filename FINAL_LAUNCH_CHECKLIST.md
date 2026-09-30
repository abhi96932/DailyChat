# VibeMeet Final Launch Checklist

## Infrastructure
- [ ] Railway deployment healthy
- [ ] `/health` returns `{ "ok": true }`
- [ ] `NODE_ENV=production`
- [ ] `CORS_ORIGIN` is restricted to the real VibeMeet origin
- [ ] PostgreSQL backup + restore drill completed

## Security
- [ ] Strong JWT secret
- [ ] HTTPS / Secure HttpOnly session cookies
- [ ] Helmet and security headers
- [ ] Rate limiting
- [ ] Mutual-match enforcement for DMs/calls
- [ ] Block/report/moderation verified
- [ ] Razorpay webhook signature validation verified
- [ ] No secrets committed to Git

## Product
- [ ] Register / Login
- [ ] 18+ validation
- [ ] Profile/photo upload
- [ ] One-at-a-time Home discovery
- [ ] Explore compatibility
- [ ] Matches / Likes You
- [ ] VIP / Super Like / Call Pass
- [ ] Communities / Events / Trips
- [ ] Messaging / Voice / Video
- [ ] Safety center
- [ ] Terms / Privacy / Refund

## Payments
- [x] Test Mode VIP
- [x] Test Mode Super Like
- [x] Test Mode Call Pass
- [x] Test Mode webhook
- [ ] Razorpay Live activation
- [ ] Live API keys
- [ ] Live webhook
- [ ] First controlled live transaction

## Release
- [ ] Run `npm test`
- [ ] Run JavaScript syntax checks
- [ ] Test mobile + desktop
- [ ] Confirm production logs are clean
- [ ] Create a tagged release / backup before Live Mode
