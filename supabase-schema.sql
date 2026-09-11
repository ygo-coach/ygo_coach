-- ============================================================
-- YGO Coach V6.3 - Supabase schema
-- À exécuter UNE FOIS dans Supabase > SQL Editor
-- ============================================================

create table if not exists public.ygo_matches (
    user_id uuid not null references auth.users(id) on delete cascade,
    id text not null,
    data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, id)
);

create table if not exists public.ygo_tournaments (
    user_id uuid not null references auth.users(id) on delete cascade,
    id text not null,
    data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, id)
);

create table if not exists public.ygo_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    data jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

create index if not exists ygo_matches_user_updated_idx
    on public.ygo_matches (user_id, updated_at desc);

create index if not exists ygo_tournaments_user_updated_idx
    on public.ygo_tournaments (user_id, updated_at desc);

alter table public.ygo_matches enable row level security;
alter table public.ygo_tournaments enable row level security;
alter table public.ygo_profiles enable row level security;

-- L'utilisateur non connecté ne doit avoir aucun accès à ces tables.
revoke all on table public.ygo_matches from anon, authenticated;
revoke all on table public.ygo_tournaments from anon, authenticated;
revoke all on table public.ygo_profiles from anon, authenticated;

-- Les utilisateurs connectés peuvent utiliser les opérations nécessaires.
-- Les policies ci-dessous limitent ensuite chaque opération à leurs propres lignes.
grant select, insert, update, delete on table public.ygo_matches to authenticated;
grant select, insert, update, delete on table public.ygo_tournaments to authenticated;
grant select, insert, update, delete on table public.ygo_profiles to authenticated;

-- MATCHES
drop policy if exists "ygo_matches_select_own" on public.ygo_matches;
create policy "ygo_matches_select_own"
on public.ygo_matches
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "ygo_matches_insert_own" on public.ygo_matches;
create policy "ygo_matches_insert_own"
on public.ygo_matches
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "ygo_matches_update_own" on public.ygo_matches;
create policy "ygo_matches_update_own"
on public.ygo_matches
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "ygo_matches_delete_own" on public.ygo_matches;
create policy "ygo_matches_delete_own"
on public.ygo_matches
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- TOURNAMENTS
drop policy if exists "ygo_tournaments_select_own" on public.ygo_tournaments;
create policy "ygo_tournaments_select_own"
on public.ygo_tournaments
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "ygo_tournaments_insert_own" on public.ygo_tournaments;
create policy "ygo_tournaments_insert_own"
on public.ygo_tournaments
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "ygo_tournaments_update_own" on public.ygo_tournaments;
create policy "ygo_tournaments_update_own"
on public.ygo_tournaments
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "ygo_tournaments_delete_own" on public.ygo_tournaments;
create policy "ygo_tournaments_delete_own"
on public.ygo_tournaments
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- PROFILE
drop policy if exists "ygo_profiles_select_own" on public.ygo_profiles;
create policy "ygo_profiles_select_own"
on public.ygo_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "ygo_profiles_insert_own" on public.ygo_profiles;
create policy "ygo_profiles_insert_own"
on public.ygo_profiles
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "ygo_profiles_update_own" on public.ygo_profiles;
create policy "ygo_profiles_update_own"
on public.ygo_profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "ygo_profiles_delete_own" on public.ygo_profiles;
create policy "ygo_profiles_delete_own"
on public.ygo_profiles
for delete
to authenticated
using ((select auth.uid()) = user_id);


-- ============================================================
-- V6.3 - Base partagée de decks adverses
-- Lecture : tout le monde (même hors connexion au compte)
-- Ajout : utilisateurs authentifiés uniquement
-- ============================================================

create table if not exists public.ygo_opponent_decks (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    normalized_name text generated always as (lower(btrim(name))) stored,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    constraint ygo_opponent_decks_name_length
        check (char_length(btrim(name)) between 2 and 80)
);

create unique index if not exists ygo_opponent_decks_normalized_name_uidx
    on public.ygo_opponent_decks (normalized_name);

create index if not exists ygo_opponent_decks_name_idx
    on public.ygo_opponent_decks (name);

alter table public.ygo_opponent_decks enable row level security;

revoke all on table public.ygo_opponent_decks from anon, authenticated;
grant select (id, name, created_at) on table public.ygo_opponent_decks to anon, authenticated;
grant insert (name, created_by) on table public.ygo_opponent_decks to authenticated;

-- La liste peut être lue par tous pour alimenter l'autocomplétion.
drop policy if exists "ygo_opponent_decks_select_all" on public.ygo_opponent_decks;
create policy "ygo_opponent_decks_select_all"
on public.ygo_opponent_decks
for select
to anon, authenticated
using (true);

-- Un utilisateur connecté peut proposer un deck, mais uniquement en son nom.
drop policy if exists "ygo_opponent_decks_insert_authenticated" on public.ygo_opponent_decks;
create policy "ygo_opponent_decks_insert_authenticated"
on public.ygo_opponent_decks
for insert
to authenticated
with check ((select auth.uid()) = created_by);
