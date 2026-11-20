-- Migration 003: Allow quote confirmation/heartbeat when resting or identical tick arrives
-- Ensures received_at and updated_at are refreshed and accepted = true is returned.

create or replace function public.upsert_market_quote(
  p_symbol text,
  p_source_id text,
  p_external_symbol text,
  p_asset_class text,
  p_price numeric,
  p_bid numeric default null,
  p_ask numeric default null,
  p_previous_close numeric default null,
  p_change_value numeric default null,
  p_change_pct numeric default null,
  p_volume numeric default null,
  p_unit text default '',
  p_tick_seq bigint default 0,
  p_quote_timestamp timestamptz default now(),
  p_status text default 'LIVE',
  p_dedup_hash text default '',
  p_raw_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_updated boolean := false;
begin
  insert into public.market_quotes (
    symbol, source_id, external_symbol, asset_class, price, bid, ask,
    previous_close, change_value, change_pct, volume, unit, tick_seq,
    quote_timestamp, received_at, status, dedup_hash, raw_payload, updated_at
  ) values (
    p_symbol, p_source_id, p_external_symbol, p_asset_class, p_price, p_bid, p_ask,
    p_previous_close, p_change_value, p_change_pct, p_volume, p_unit, p_tick_seq,
    p_quote_timestamp, now(), p_status, p_dedup_hash, coalesce(p_raw_payload, '{}'::jsonb), now()
  )
  on conflict (symbol) do update set
    source_id = excluded.source_id,
    external_symbol = excluded.external_symbol,
    asset_class = excluded.asset_class,
    price = excluded.price,
    bid = excluded.bid,
    ask = excluded.ask,
    previous_close = excluded.previous_close,
    change_value = excluded.change_value,
    change_pct = excluded.change_pct,
    volume = excluded.volume,
    unit = excluded.unit,
    tick_seq = excluded.tick_seq,
    quote_timestamp = excluded.quote_timestamp,
    received_at = now(),
    status = excluded.status,
    dedup_hash = excluded.dedup_hash,
    raw_payload = excluded.raw_payload,
    updated_at = now()
  where (
    excluded.dedup_hash <> public.market_quotes.dedup_hash
    and (
      excluded.quote_timestamp > public.market_quotes.quote_timestamp
      or (
        excluded.quote_timestamp = public.market_quotes.quote_timestamp
        and excluded.tick_seq >= public.market_quotes.tick_seq
      )
    )
  )
  or excluded.dedup_hash = public.market_quotes.dedup_hash;

  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'accepted', v_updated,
    'symbol', p_symbol
  );
end;
$$;
