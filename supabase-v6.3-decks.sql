-- YGO Coach V6.3
-- À exécuter UNE FOIS dans Supabase > SQL Editor


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
