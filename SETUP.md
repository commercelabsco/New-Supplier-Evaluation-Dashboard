# Database setup (Supabase)

The dashboard is hosted on GitHub Pages and stores its data in Supabase.
Only signed-in `@commercelabs.co` users can read or write data.

## 1. Create the project

1. Sign up at https://supabase.com and create a new project (the free tier is enough).
2. Go to **SQL Editor → New query**, paste the SQL below, and click **Run**.

```sql
create table if not exists public.kv (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.kv enable row level security;

-- Only verified @commercelabs.co accounts can touch the data.
create policy "commercelabs users" on public.kv
  for all to authenticated
  using      ((auth.jwt() ->> 'email') like '%@commercelabs.co')
  with check ((auth.jwt() ->> 'email') like '%@commercelabs.co');

-- Atomic counter for EVAL-### reference numbers.
create or replace function public.kv_increment(counter_key text)
returns integer
language plpgsql
security invoker
as $$
declare next_val integer;
begin
  insert into public.kv (key, value) values (counter_key, '1')
  on conflict (key) do update
    set value = (coalesce(nullif(public.kv.value, ''), '0')::integer + 1)::text,
        updated_at = now()
  returning value::integer into next_val;
  return next_val;
end;
$$;

-- Give signed-in users access (needed when "Automatically expose new tables" is off).
grant select, insert, update, delete on public.kv to authenticated;
grant execute on function public.kv_increment(text) to authenticated;

notify pgrst, 'reload schema';
```

## 2. Configure sign-in

In **Authentication → URL Configuration**:

- **Site URL:** `https://commercelabsco.github.io/New-Supplier-Evaluation-Dashboard/`
- **Redirect URLs:** add the same URL.

Email sign-in (magic link) is on by default. The built-in email sender is
rate-limited to a few emails per hour. For a larger team, set up custom SMTP
under **Project Settings → Authentication → SMTP**.

## 3. Connect the dashboard

In **Project Settings → API**, copy the **Project URL** and the **anon public** key
into the top of `storage.js`:

```js
const SUPABASE_URL = "https://xxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...";
```

The anon key can safely be public. The row-level security policy above is what
protects the data. Commit, push, and GitHub Pages will redeploy.

## 4. Move existing data (optional)

If you have a backup from **Export All (.json)**, sign in on the live site and
use **Import .json** to load it into the database.
