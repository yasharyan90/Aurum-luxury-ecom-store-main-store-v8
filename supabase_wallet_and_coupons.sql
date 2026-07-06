-- ═══════════════════════════════════════════════════════════
--  AURUM — Wallet + Coupon System
--  Run this in Supabase SQL Editor (safe to re-run)
-- ═══════════════════════════════════════════════════════════
--
-- WHAT THIS BUILDS
--  • wallets            — cached balance per customer (1 row each)
--  • wallet_credits     — every owner-granted top-up, each with its
--                         own optional expiry date
--  • wallet_transactions— append-only ledger. NEVER updated or
--                         deleted — this is what makes the wallet
--                         tamper-evident/auditable, the same property
--                         people reach for blockchain for.
--  • coupons            — per-customer coupons with expiry
--
-- SECURITY MODEL
--  Regular users (customers/owner) get SELECT-only access to these
--  tables via RLS. There are NO insert/update/delete policies on
--  them at all — every write goes through a SECURITY DEFINER
--  function below, which enforces the real business rules (only the
--  owner can grant credit/coupons, customers can only spend their
--  own wallet, balances can never go negative, etc). This means even
--  a modified/malicious frontend cannot forge a wallet balance.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── 0. is_owner() helper (safe to re-run even if it already exists
--        from a previous fix — same definition) ──────────────────
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'owner'
);
$$;

-- ─── 1. Tables ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.wallets (
                                              user_id     UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    balance     NUMERIC(12,2) NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS public.wallet_credits (
                                                     id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    remaining_amount  NUMERIC(12,2) NOT NULL,
    expiry_date       DATE,                 -- NULL = never expires
    status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','depleted')),
    note              TEXT,
    granted_by        UUID REFERENCES public.profiles(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
                                                          id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    wallet_credit_id  UUID REFERENCES public.wallet_credits(id),
    type              TEXT NOT NULL CHECK (type IN ('credit','debit','expiry','refund')),
    amount            NUMERIC(12,2) NOT NULL,   -- positive = credit, negative = debit/expiry
    balance_after     NUMERIC(12,2) NOT NULL,
    description       TEXT,
    order_id          UUID REFERENCES public.orders(id),
    created_by        UUID REFERENCES public.profiles(id),  -- owner who acted, NULL = system
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS public.coupons (
                                              id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code              TEXT NOT NULL UNIQUE,
    user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    discount_type     TEXT NOT NULL CHECK (discount_type IN ('percentage','fixed')),
    discount_value    NUMERIC(12,2) NOT NULL CHECK (discount_value > 0),
    max_discount      NUMERIC(12,2),          -- cap for percentage-type coupons
    min_order_value   NUMERIC(12,2) NOT NULL DEFAULT 0,
    expiry_date       DATE NOT NULL,
    status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','redeemed','revoked')),
    note              TEXT,
    used_at           TIMESTAMPTZ,
    used_order_id     UUID REFERENCES public.orders(id),
    created_by        UUID REFERENCES public.profiles(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS idx_wallet_credits_user   ON public.wallet_credits(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_txns_user       ON public.wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_coupons_user           ON public.coupons(user_id);

-- Order-level record of what was applied at checkout
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS wallet_amount_used NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS coupon_id          UUID REFERENCES public.coupons(id);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_amount    NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ─── 2. RLS: read-only for everyone; all writes go through functions ─
ALTER TABLE public.wallets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_credits      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallets_select"             ON public.wallets;
DROP POLICY IF EXISTS "wallet_credits_select"      ON public.wallet_credits;
DROP POLICY IF EXISTS "wallet_transactions_select" ON public.wallet_transactions;
DROP POLICY IF EXISTS "coupons_select"             ON public.coupons;

CREATE POLICY "wallets_select" ON public.wallets
FOR SELECT USING (auth.uid() = user_id OR public.is_owner());

CREATE POLICY "wallet_credits_select" ON public.wallet_credits
FOR SELECT USING (auth.uid() = user_id OR public.is_owner());

CREATE POLICY "wallet_transactions_select" ON public.wallet_transactions
FOR SELECT USING (auth.uid() = user_id OR public.is_owner());

CREATE POLICY "coupons_select" ON public.coupons
FOR SELECT USING (auth.uid() = user_id OR public.is_owner());

GRANT SELECT ON public.wallets, public.wallet_credits, public.wallet_transactions, public.coupons
    TO authenticated;

-- ─── 3. Helper: make sure a wallet row exists for a user ─────────
CREATE OR REPLACE FUNCTION public.ensure_wallet(p_user_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
INSERT INTO public.wallets (user_id, balance) VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
END; $$;

-- ─── 4. Owner grants wallet credit (with optional expiry) ────────
CREATE OR REPLACE FUNCTION public.owner_grant_wallet_credit(
  p_user_id UUID, p_amount NUMERIC, p_expiry_date DATE, p_note TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
v_credit_id   UUID;
  v_new_balance NUMERIC;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'Only the owner can grant wallet credit';
END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
END IF;

  PERFORM public.ensure_wallet(p_user_id);

INSERT INTO public.wallet_credits (user_id, amount, remaining_amount, expiry_date, note, granted_by)
VALUES (p_user_id, p_amount, p_amount, p_expiry_date, p_note, auth.uid())
    RETURNING id INTO v_credit_id;

UPDATE public.wallets SET balance = balance + p_amount, updated_at = NOW()
WHERE user_id = p_user_id
    RETURNING balance INTO v_new_balance;

INSERT INTO public.wallet_transactions (user_id, wallet_credit_id, type, amount, balance_after, description, created_by)
VALUES (p_user_id, v_credit_id, 'credit', p_amount, v_new_balance, COALESCE(p_note, 'Wallet credit granted by owner'), auth.uid());

RETURN v_new_balance;
END; $$;

GRANT EXECUTE ON FUNCTION public.owner_grant_wallet_credit(UUID, NUMERIC, DATE, TEXT) TO authenticated;

-- ─── 5. Owner extends (or reactivates) a wallet credit's expiry ──
CREATE OR REPLACE FUNCTION public.owner_extend_wallet_credit_expiry(
  p_credit_id UUID, p_new_expiry_date DATE
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
v_credit      RECORD;
  v_new_balance NUMERIC;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'Only the owner can extend wallet credit expiry';
END IF;

SELECT * INTO v_credit FROM public.wallet_credits WHERE id = p_credit_id FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Wallet credit not found'; END IF;

  -- If it had already expired and still has value left, extending the
  -- date restores that value back into the customer's usable balance.
  IF v_credit.status = 'expired' AND v_credit.remaining_amount > 0 THEN
UPDATE public.wallets SET balance = balance + v_credit.remaining_amount, updated_at = NOW()
WHERE user_id = v_credit.user_id
    RETURNING balance INTO v_new_balance;

INSERT INTO public.wallet_transactions (user_id, wallet_credit_id, type, amount, balance_after, description, created_by)
VALUES (v_credit.user_id, v_credit.id, 'credit', v_credit.remaining_amount, v_new_balance,
        'Credit reactivated — expiry extended by owner', auth.uid());

UPDATE public.wallet_credits SET status = 'active', expiry_date = p_new_expiry_date WHERE id = p_credit_id;
ELSE
UPDATE public.wallet_credits SET expiry_date = p_new_expiry_date WHERE id = p_credit_id;
END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.owner_extend_wallet_credit_expiry(UUID, DATE) TO authenticated;

-- ─── 6. Lazy expiry sweeps ────────────────────────────────────────
-- Called by the app every time a wallet/coupon list is fetched, so
-- expired items are reflected immediately without needing pg_cron.
-- (Optional: schedule these with pg_cron to run nightly too — see
-- note at the bottom of this file.)

CREATE OR REPLACE FUNCTION public.expire_wallet_credits()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
r RECORD;
  v_new_balance NUMERIC;
BEGIN
FOR r IN
SELECT * FROM public.wallet_credits
WHERE status = 'active' AND expiry_date IS NOT NULL
  AND expiry_date < CURRENT_DATE AND remaining_amount > 0
    FOR UPDATE
    LOOP
UPDATE public.wallets SET balance = balance - r.remaining_amount, updated_at = NOW()
WHERE user_id = r.user_id
    RETURNING balance INTO v_new_balance;

INSERT INTO public.wallet_transactions (user_id, wallet_credit_id, type, amount, balance_after, description)
VALUES (r.user_id, r.id, 'expiry', -r.remaining_amount, v_new_balance, 'Wallet credit expired');

UPDATE public.wallet_credits SET status = 'expired' WHERE id = r.id;
END LOOP;
END; $$;

GRANT EXECUTE ON FUNCTION public.expire_wallet_credits() TO authenticated;

CREATE OR REPLACE FUNCTION public.expire_coupons()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
UPDATE public.coupons SET status = 'expired'
WHERE status = 'active' AND expiry_date < CURRENT_DATE;
END; $$;

GRANT EXECUTE ON FUNCTION public.expire_coupons() TO authenticated;

-- ─── 7. Spend wallet balance at checkout (FIFO by soonest expiry) ─
CREATE OR REPLACE FUNCTION public.spend_wallet(
  p_user_id UUID, p_amount NUMERIC, p_order_id UUID
) RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
v_remaining_to_spend NUMERIC := p_amount;
  v_new_balance        NUMERIC;
  r                     RECORD;
  v_take                NUMERIC;
BEGIN
  IF auth.uid() <> p_user_id AND NOT public.is_owner() THEN
    RAISE EXCEPTION 'Not authorized to spend this wallet';
END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
END IF;

  PERFORM public.expire_wallet_credits();

  IF COALESCE((SELECT balance FROM public.wallets WHERE user_id = p_user_id), 0) < p_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
END IF;

FOR r IN
SELECT * FROM public.wallet_credits
WHERE user_id = p_user_id AND status = 'active' AND remaining_amount > 0
ORDER BY expiry_date ASC NULLS LAST, created_at ASC
    FOR UPDATE
    LOOP
    EXIT WHEN v_remaining_to_spend <= 0;
v_take := LEAST(r.remaining_amount, v_remaining_to_spend);

UPDATE public.wallet_credits
SET remaining_amount = remaining_amount - v_take,
    status = CASE WHEN remaining_amount - v_take <= 0 THEN 'depleted' ELSE status END
WHERE id = r.id;

v_remaining_to_spend := v_remaining_to_spend - v_take;
END LOOP;

UPDATE public.wallets SET balance = balance - p_amount, updated_at = NOW()
WHERE user_id = p_user_id
    RETURNING balance INTO v_new_balance;

INSERT INTO public.wallet_transactions (user_id, type, amount, balance_after, description, order_id)
VALUES (p_user_id, 'debit', -p_amount, v_new_balance, 'Applied to order', p_order_id);

RETURN v_new_balance;
END; $$;

GRANT EXECUTE ON FUNCTION public.spend_wallet(UUID, NUMERIC, UUID) TO authenticated;

-- ─── 8. Owner issues a coupon to a specific customer ─────────────
CREATE OR REPLACE FUNCTION public.owner_issue_coupon(
  p_user_id UUID, p_code TEXT, p_discount_type TEXT, p_discount_value NUMERIC,
  p_max_discount NUMERIC, p_min_order_value NUMERIC, p_expiry_date DATE, p_note TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
v_id UUID;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'Only the owner can issue coupons';
END IF;
  IF p_discount_type NOT IN ('percentage','fixed') THEN
    RAISE EXCEPTION 'discount_type must be percentage or fixed';
END IF;
  IF p_expiry_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Expiry date must be in the future';
END IF;

INSERT INTO public.coupons (code, user_id, discount_type, discount_value, max_discount, min_order_value, expiry_date, note, created_by)
VALUES (upper(p_code), p_user_id, p_discount_type, p_discount_value, p_max_discount, COALESCE(p_min_order_value, 0), p_expiry_date, p_note, auth.uid())
    RETURNING id INTO v_id;

RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.owner_issue_coupon(UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT) TO authenticated;

-- ─── 9. Owner extends (or reactivates) a coupon's expiry ─────────
CREATE OR REPLACE FUNCTION public.owner_extend_coupon_expiry(p_coupon_id UUID, p_new_expiry_date DATE)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_coupon RECORD;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'Only the owner can extend coupon expiry';
END IF;
SELECT * INTO v_coupon FROM public.coupons WHERE id = p_coupon_id FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Coupon not found'; END IF;
  IF v_coupon.status = 'redeemed' THEN
    RAISE EXCEPTION 'Cannot extend a coupon that has already been redeemed';
END IF;

UPDATE public.coupons
SET expiry_date = p_new_expiry_date,
    status = CASE WHEN status = 'expired' THEN 'active' ELSE status END
WHERE id = p_coupon_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.owner_extend_coupon_expiry(UUID, DATE) TO authenticated;

-- ─── 10. Owner revokes an unused coupon ───────────────────────────
CREATE OR REPLACE FUNCTION public.owner_revoke_coupon(p_coupon_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'Only the owner can revoke coupons';
END IF;
UPDATE public.coupons SET status = 'revoked' WHERE id = p_coupon_id AND status IN ('active','expired');
END; $$;

GRANT EXECUTE ON FUNCTION public.owner_revoke_coupon(UUID) TO authenticated;

-- ─── 11. Customer-side: live preview of a coupon at checkout ─────
-- Read-only, does not mark anything used. Safe to call on every
-- keystroke of a coupon code field.
CREATE OR REPLACE FUNCTION public.preview_coupon(p_code TEXT, p_subtotal NUMERIC)
RETURNS TABLE(coupon_id UUID, discount_amount NUMERIC, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
v_coupon  RECORD;
  v_discount NUMERIC;
BEGIN
  PERFORM public.expire_coupons();

SELECT * INTO v_coupon FROM public.coupons
WHERE code = upper(p_code) AND user_id = auth.uid();

IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::UUID, 0::NUMERIC, 'Coupon not found on your account';
RETURN;
END IF;
  IF v_coupon.status <> 'active' THEN
    RETURN QUERY SELECT NULL::UUID, 0::NUMERIC, ('This coupon is ' || v_coupon.status);
RETURN;
END IF;
  IF p_subtotal < v_coupon.min_order_value THEN
    RETURN QUERY SELECT NULL::UUID, 0::NUMERIC,
                          ('Minimum order value ₹' || v_coupon.min_order_value || ' required');
RETURN;
END IF;

  IF v_coupon.discount_type = 'percentage' THEN
    v_discount := p_subtotal * v_coupon.discount_value / 100;
    IF v_coupon.max_discount IS NOT NULL THEN
      v_discount := LEAST(v_discount, v_coupon.max_discount);
END IF;
ELSE
    v_discount := LEAST(v_coupon.discount_value, p_subtotal);
END IF;

RETURN QUERY SELECT v_coupon.id, ROUND(v_discount, 2), 'ok';
END; $$;

GRANT EXECUTE ON FUNCTION public.preview_coupon(TEXT, NUMERIC) TO authenticated;

-- ─── 12. Actually redeem a coupon against a placed order ─────────
-- Recomputes the discount server-side from the order's real subtotal
-- (never trusts a client-supplied discount figure) and marks the
-- coupon used exactly once.
CREATE OR REPLACE FUNCTION public.redeem_coupon_for_order(p_coupon_id UUID, p_order_id UUID)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
v_coupon   RECORD;
  v_order    RECORD;
  v_discount NUMERIC;
BEGIN
SELECT * INTO v_coupon FROM public.coupons WHERE id = p_coupon_id FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Coupon not found'; END IF;
  IF v_coupon.user_id <> auth.uid() THEN RAISE EXCEPTION 'This coupon does not belong to you'; END IF;
  IF v_coupon.status <> 'active' THEN RAISE EXCEPTION 'Coupon is %', v_coupon.status; END IF;
  IF v_coupon.expiry_date < CURRENT_DATE THEN RAISE EXCEPTION 'Coupon has expired'; END IF;

SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND user_id = auth.uid();
IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.subtotal < v_coupon.min_order_value THEN
    RAISE EXCEPTION 'Order does not meet the minimum value for this coupon';
END IF;

  IF v_coupon.discount_type = 'percentage' THEN
    v_discount := v_order.subtotal * v_coupon.discount_value / 100;
    IF v_coupon.max_discount IS NOT NULL THEN v_discount := LEAST(v_discount, v_coupon.max_discount); END IF;
ELSE
    v_discount := LEAST(v_coupon.discount_value, v_order.subtotal);
END IF;
  v_discount := ROUND(v_discount, 2);

UPDATE public.coupons SET status = 'redeemed', used_at = NOW(), used_order_id = p_order_id WHERE id = p_coupon_id;
UPDATE public.orders  SET coupon_id = p_coupon_id, discount_amount = v_discount WHERE id = p_order_id;

RETURN v_discount;
END; $$;

GRANT EXECUTE ON FUNCTION public.redeem_coupon_for_order(UUID, UUID) TO authenticated;

-- ─── Done ─────────────────────────────────────────────────────────
-- OPTIONAL — automatic nightly expiry instead of lazy (on-read) sweeps:
-- Supabase projects on paid plans can enable the pg_cron extension
-- (Database → Extensions → pg_cron) and then run:
--
--   SELECT cron.schedule('expire-wallet-credits', '0 0 * * *',
--     $$ SELECT public.expire_wallet_credits(); $$);
--   SELECT cron.schedule('expire-coupons', '0 0 * * *',
--     $$ SELECT public.expire_coupons(); $$);
--
-- Not required — the app already sweeps expiries lazily every time
-- a wallet or coupon list loads.
