-- Run this file once in Supabase Dashboard > SQL Editor using the postgres role.
-- All application data is private. Only the Vercel server's service_role key may
-- access these tables. That server verifies the JWT AND OWNER_EMAIL first.
begin;

create table if not exists public.cloud_accounts (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  initialized boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.cloud_dreams (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 120),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  chat_history jsonb not null default '[]'::jsonb check (jsonb_typeof(chat_history) = 'array'),
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint cloud_dream_size check (octet_length(data::text) + octet_length(chat_history::text) <= 1048576)
);
create index if not exists cloud_dreams_owner_created on public.cloud_dreams(owner_id, created_at desc, id);

create table if not exists public.ai_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

alter table public.cloud_accounts enable row level security;
alter table public.cloud_dreams enable row level security;
alter table public.ai_settings enable row level security;
revoke all on public.cloud_accounts, public.cloud_dreams, public.ai_settings from public, anon, authenticated;
grant all on public.cloud_accounts, public.cloud_dreams, public.ai_settings to service_role;

-- Serialize bulk/create operations per owner. A database transaction (rather
-- than a process-local lock) also works across concurrent Vercel functions.
create or replace function public.cloud_save_dreams(p_owner uuid, p_dreams jsonb, p_mode text default 'import')
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  was_initialized boolean;
  existing_count integer;
  imported_count integer := 0;
  incoming_count integer;
  inserted_count integer;
  dream jsonb;
begin
  if p_mode not in ('bootstrap', 'import', 'create') or jsonb_typeof(p_dreams) <> 'array' then
    raise exception 'INVALID_ARCHIVE';
  end if;
  incoming_count := jsonb_array_length(p_dreams);
  if incoming_count > 500 or (p_mode = 'create' and incoming_count <> 1) then
    raise exception 'INVALID_ARCHIVE';
  end if;

  insert into public.cloud_accounts(owner_id) values (p_owner) on conflict do nothing;
  select initialized into was_initialized from public.cloud_accounts where owner_id = p_owner for update;
  if p_mode = 'bootstrap' and was_initialized then
    return jsonb_build_object('imported', 0, 'skipped', incoming_count, 'initialized', true);
  end if;
  select count(*) into existing_count from public.cloud_dreams where owner_id = p_owner;

  for dream in select value from jsonb_array_elements(p_dreams) loop
    if p_mode = 'create' and exists(select 1 from public.cloud_dreams where owner_id = p_owner and id = dream->>'id') then
      raise unique_violation using message = 'DUPLICATE_DREAM';
    end if;
    insert into public.cloud_dreams(owner_id, id, data, chat_history, created_at)
    values (
      p_owner, dream->>'id', dream - 'id' - 'createdAt' - 'chatHistory',
      coalesce(dream->'chatHistory', '[]'::jsonb), (dream->>'createdAt')::timestamptz
    ) on conflict (owner_id, id) do nothing;
    get diagnostics inserted_count = row_count;
    imported_count := imported_count + inserted_count;
    if existing_count + imported_count > 500 then
      raise exception 'ARCHIVE_LIMIT';
    end if;
  end loop;
  update public.cloud_accounts set initialized = true where owner_id = p_owner;
  return jsonb_build_object('imported', imported_count, 'skipped', incoming_count - imported_count, 'initialized', true);
end;
$$;
revoke all on function public.cloud_save_dreams(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.cloud_save_dreams(uuid, jsonb, text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'oneiros-media', 'oneiros-media', false, 41943040,
  array['image/png','image/jpeg','image/webp','audio/webm','audio/ogg','audio/mp4','audio/wav','audio/mpeg']
) on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies are created. Browsers receive short-lived signed
-- upload/download tokens scoped to a server-generated path under their UUID.
commit;
