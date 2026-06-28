# Admin API-Football Enrichment Invoke

`sync-football-data` enrichment modes are admin-only:

- `coverage`
- `rounds`
- `fixture-enrich`
- `injuries`
- `squads`
- `coaches`
- `venues`
- `top-players`
- `enrich-all`

Do not call these modes with the publishable/anon key. The function returns `401 ADMIN_AUTH_REQUIRED` for publishable/anon requests.

## Required Auth

Use one of these admin credentials:

- Supabase service role key in `Authorization: Bearer <service-role-key>`
- Supabase service role key in `apikey: <service-role-key>`
- A configured admin key from `SUPABASE_SECRET_KEYS`
- A Supabase user JWT whose metadata marks the user as admin:
  - `app_metadata.role = "admin"`
  - `app_metadata.role = "service_role"`
  - `app_metadata.is_admin = true`
  - `user_metadata.role = "admin"`

## curl Example

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/sync-football-data" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <service-role-key-or-admin-jwt>" \
  -H "apikey: <service-role-key-or-admin-key>" \
  -d '{ "mode": "coverage", "limit": 20 }'
```

## supabase-js Example

Run this only in a trusted server/admin environment. Never expose the service role key in frontend code.

```js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const { data, error } = await supabase.functions.invoke('sync-football-data', {
  body: { mode: 'coverage', limit: 20 },
})

if (error) throw error
console.log(data)
```

## Expected Anon Rejection

Requests made with the publishable/anon key should receive:

```json
{
  "ok": false,
  "code": "ADMIN_AUTH_REQUIRED",
  "provider": "api-football",
  "message": "Unauthorized enrichment request. API-Football enrichment modes are admin-only. Invoke this Edge Function with the Supabase service role key, a configured SUPABASE_SECRET_KEYS admin key, or a valid admin user JWT. Publishable/anon keys are not allowed."
}
```
