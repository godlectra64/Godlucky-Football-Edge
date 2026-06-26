# Production QA Checklist

## Local Preparation

- [ ] Run `git pull` on the production branch.
- [ ] Run `npm install`.
- [ ] Confirm `.env` is present locally when testing Supabase-backed flows.
- [ ] Confirm no secrets are staged with `git status --short`.

## Verification Commands

- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Review build output for Vite chunk-size warnings.

## Routes Checklist

- [ ] `/` loads Today without crashing.
- [ ] `/today` loads Today without crashing.
- [ ] `/match/:matchId` loads detail or a clear fallback state.
- [ ] `/performance` loads AI Performance or a clear insufficient-data state.
- [ ] Unknown routes show a safe not-found state and do not break the app.

## Page States Checklist

- [ ] Today has loading, empty, error, and refresh states.
- [ ] Match Detail handles missing `match_analysis`.
- [ ] Match Detail handles `raw: null`.
- [ ] Match Detail handles missing `football_intelligence`.
- [ ] Match Detail handles missing `data_intelligence`.
- [ ] Match Detail handles missing prediction reliability.
- [ ] Match Detail handles missing market intelligence.
- [ ] AI Performance does not show fake statistics when evaluated samples are low.
- [ ] AI Performance shows "กำลังสะสมข้อมูล" or "ยังไม่มีข้อมูลเพียงพอ" when data is insufficient.

## Mobile Checklist

- [ ] Test Android width `360px`.
- [ ] Test Android width `390px`.
- [ ] Test Android width `412px`.
- [ ] Confirm there is no horizontal overflow.
- [ ] Confirm bottom navigation does not cover final content.
- [ ] Confirm cards are readable and not too dense.
- [ ] Confirm body text and labels remain legible.
- [ ] Confirm buttons and nav items are easy to tap.

## Supabase Checklist

- [ ] Confirm `VITE_SUPABASE_URL` is configured in production.
- [ ] Confirm `VITE_SUPABASE_ANON_KEY` is configured in production.
- [ ] Confirm app still loads with missing local env during tests.
- [ ] Confirm Today falls back safely when match queries fail.
- [ ] Confirm AI Performance falls back safely when performance queries fail.
- [ ] Confirm Match Detail falls back safely when analysis payload fields are missing.
- [ ] Confirm no Cron, Auth, or Vault settings changed during this sprint.

## Vercel Deploy Checklist

- [ ] Confirm production environment variables are set in Vercel.
- [ ] Deploy from the intended branch/commit.
- [ ] Open `/`, `/today`, `/performance`, and a known `/match/:matchId` after deploy.
- [ ] Open a non-existent route and confirm the not-found fallback.
- [ ] Review Vercel build logs for warnings or errors.
- [ ] Confirm no migrations or Supabase function deploys are required for this release.
