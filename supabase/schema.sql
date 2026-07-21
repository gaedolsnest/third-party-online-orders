-- 타사 온라인 주문 예외관리 baseline schema. Supabase SQL Editor에서 한 번 실행하세요.
create extension if not exists pgcrypto;

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  store_code text not null unique,
  store_name text not null,
  region text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','store')),
  store_code text references public.stores(store_code),
  display_name text not null,
  created_at timestamptz not null default now(),
  constraint store_user_scope check (role <> 'store' or store_code is not null)
);

create table public.sla_policies (
  id bigint generated always as identity primary key,
  shipping_days integer not null default 2 check (shipping_days > 0),
  settlement_days integer not null default 5 check (settlement_days > 0),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

create table public.sync_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_hash text,
  scope text not null default 'nationwide' check (scope in ('nationwide','partial')),
  status text not null default 'processing' check (status in ('processing','completed','failed')),
  total_rows integer not null default 0,
  inserted_rows integer not null default 0,
  updated_rows integer not null default 0,
  missing_rows integer not null default 0,
  error_message text,
  uploaded_by uuid not null default auth.uid() references public.app_users(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'intranet',
  source_no text not null default '',
  source_flag text not null default '',
  order_no text not null,
  line_no integer not null default 1,
  store_code text not null references public.stores(store_code), store_name text not null default '',
  sale_type text not null default '', brand text not null default '', product_name text not null default '',
  style_code text not null default '', color text not null default '', size text not null default '',
  quantity integer not null default 1, stock_quantity integer not null default 0,
  regular_price numeric(14,2) not null default 0, sale_amount numeric(14,2) not null default 0,
  shipping_type text not null default '', status text not null check (status in ('등록','출고','정산')),
  store_transfer_status text not null default '',
  registered_at timestamptz not null, shipped_at timestamptz, shipped_by text not null default '',
  settled_at timestamptz, settled_by text not null default '',
  sales_date date, pos_no text not null default '', transaction_no text not null default '',
  status_changed_at timestamptz not null default now(),
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  last_seen_batch_id uuid references public.sync_batches(id), missing_streak integer not null default 0,
  archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(source_system, order_no, line_no)
);

create table public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  sync_batch_id uuid references public.sync_batches(id),
  old_status text, new_status text not null,
  changed_at timestamptz not null default now()
);

create table public.order_exceptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  exception_type text not null check (exception_type in ('shipping_delay','settlement_delay')),
  due_at timestamptz not null, opened_at timestamptz not null default now(), resolved_at timestamptz,
  acknowledged_at timestamptz, acknowledged_by uuid references public.app_users(id), memo text not null default '',
  unique(order_id, exception_type, opened_at)
);

create table public.store_snapshot_manifests (
  store_code text primary key references public.stores(store_code),
  current_object_path text not null,
  previous_object_path text,
  content_hash text not null,
  byte_size bigint not null,
  row_count integer not null,
  schema_version integer not null default 1,
  sync_batch_id uuid not null references public.sync_batches(id),
  generated_at timestamptz not null default now()
);

create unique index one_open_exception_per_order on public.order_exceptions(order_id) where resolved_at is null;
create index orders_store_active_idx on public.orders(store_code, status, registered_at) where archived_at is null;
create index exceptions_open_due_idx on public.order_exceptions(due_at) where resolved_at is null;
create index history_order_changed_idx on public.order_status_history(order_id, changed_at desc);

create function public.is_admin() returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from app_users where id=auth.uid() and role='admin') $$;
create function public.my_store_code() returns text language sql stable security definer set search_path=public
as $$ select store_code from app_users where id=auth.uid() $$;

-- 로그인 전 매장 선택 목록. 주문 데이터나 계정 정보는 반환하지 않는다.
create function public.list_active_stores()
returns table(store_code text, store_name text)
language sql stable security definer set search_path=public as $$
  select s.store_code, s.store_name from stores s where s.is_active order by s.store_name
$$;
revoke all on function public.list_active_stores() from public;
grant execute on function public.list_active_stores() to anon, authenticated;

create or replace function public.track_order_status_change() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if old.status is distinct from new.status then
    new.status_changed_at = now();
    insert into order_status_history(order_id,sync_batch_id,old_status,new_status)
    values(old.id,new.last_seen_batch_id,old.status,new.status);
  end if;
  new.updated_at = now();
  new.last_seen_at = now();
  return new;
end $$;

create trigger orders_track_status before update on public.orders
for each row execute function public.track_order_status_change();

create or replace function public.refresh_order_exceptions() returns void
language plpgsql security definer set search_path=public as $$
declare policy sla_policies%rowtype;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into policy from sla_policies
  where effective_from <= now() and (effective_to is null or effective_to > now())
  order by effective_from desc limit 1;

  update order_exceptions e set resolved_at=now()
  from orders o where e.order_id=o.id and e.resolved_at is null
    and (o.status='정산'
      or (e.exception_type='shipping_delay' and o.status<>'등록')
      or (e.exception_type='settlement_delay' and o.status<>'출고'));

  insert into order_exceptions(order_id,exception_type,due_at)
  select o.id,'shipping_delay',o.registered_at + make_interval(days=>policy.shipping_days)
  from orders o where o.status='등록' and o.archived_at is null
    and o.registered_at + make_interval(days=>policy.shipping_days) < now()
    and not exists(select 1 from order_exceptions e where e.order_id=o.id and e.resolved_at is null)
  union all
  select o.id,'settlement_delay',coalesce(o.shipped_at,o.status_changed_at) + make_interval(days=>policy.settlement_days)
  from orders o where o.status='출고' and o.archived_at is null
    and coalesce(o.shipped_at,o.status_changed_at) + make_interval(days=>policy.settlement_days) < now()
    and not exists(select 1 from order_exceptions e where e.order_id=o.id and e.resolved_at is null);
end $$;

create or replace function public.set_sla_policy(p_shipping_days integer, p_settlement_days integer) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_shipping_days not between 1 and 30 or p_settlement_days not between 1 and 30 then raise exception 'invalid SLA'; end if;
  update sla_policies set effective_to=now() where effective_to is null;
  insert into sla_policies(shipping_days,settlement_days,created_by) values(p_shipping_days,p_settlement_days,auth.uid());
  perform public.refresh_order_exceptions();
end $$;

alter table public.stores enable row level security;
alter table public.app_users enable row level security;
alter table public.sla_policies enable row level security;
alter table public.sync_batches enable row level security;
alter table public.orders enable row level security;
alter table public.order_status_history enable row level security;
alter table public.order_exceptions enable row level security;
alter table public.store_snapshot_manifests enable row level security;

create policy "own profile" on public.app_users for select to authenticated using (id=auth.uid());
create policy "visible stores" on public.stores for select to authenticated using (public.is_admin() or store_code=public.my_store_code());
create policy "admin manage stores" on public.stores for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read policies" on public.sla_policies for select to authenticated using (true);
create policy "admin manage policies" on public.sla_policies for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin batches" on public.sync_batches for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "scoped order read" on public.orders for select to authenticated using (public.is_admin() or store_code=public.my_store_code());
create policy "admin order write" on public.orders for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "scoped history read" on public.order_status_history for select to authenticated using (exists(select 1 from orders o where o.id=order_id and (public.is_admin() or o.store_code=public.my_store_code())));
create policy "admin history write" on public.order_status_history for insert to authenticated with check (public.is_admin());
create policy "scoped exception read" on public.order_exceptions for select to authenticated using (exists(select 1 from orders o where o.id=order_id and (public.is_admin() or o.store_code=public.my_store_code())));
create policy "store acknowledge exception" on public.order_exceptions for update to authenticated using (exists(select 1 from orders o where o.id=order_id and (public.is_admin() or o.store_code=public.my_store_code())));
create policy "scoped snapshot manifest" on public.store_snapshot_manifests for select to authenticated using (public.is_admin() or store_code=public.my_store_code());
create policy "admin manage snapshot manifest" on public.store_snapshot_manifests for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke update on public.order_exceptions from authenticated;
grant update(acknowledged_at,acknowledged_by,memo) on public.order_exceptions to authenticated;

insert into public.sla_policies(shipping_days,settlement_days)
select 2,5 where not exists(select 1 from public.sla_policies);

-- 운영 권장: 엑셀 upsert와 예외 재계산은 하나의 RPC/Edge Function 트랜잭션으로 이동합니다.
-- 클라이언트 MVP에서는 orders를 500행씩 upsert하되 service_role 키를 절대 브라우저에 넣지 않습니다.
