-- Keep Used Stock creation restricted to Super Admin.
-- Operations and Finance can update according to the field-level controls
-- enforced by the stock_field_restrictions trigger.
drop policy if exists stock_insert on public.stock_transactions;
create policy stock_insert
  on public.stock_transactions
  for insert
  to authenticated
  with check (public.is_super_admin());
