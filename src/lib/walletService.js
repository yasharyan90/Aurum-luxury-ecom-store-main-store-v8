// src/lib/walletService.js
import { supabase } from './supabase';

const isConfigured = () =>
    process.env.REACT_APP_SUPABASE_URL &&
    process.env.REACT_APP_SUPABASE_URL !== 'https://placeholder.supabase.co';

// NOTE: The wallet/coupon system needs a real ledger to be meaningful
// (that's the whole point — an auditable trail of every credit and
// debit), so unlike products/orders there is no "demo mode" fallback
// here. If Supabase isn't configured yet, these functions simply
// return empty/zero values instead of fabricating fake balances.

// ══════════════════════════════════════════════════════════════
//  CUSTOMER-FACING
// ══════════════════════════════════════════════════════════════

// ── Wallet balance + active credit batches for one user ────────
export async function fetchWallet(userId) {
    if (!isConfigured() || !userId) return { balance: 0, credits: [] };

    // Sweep any newly-expired credits first so the balance shown is
    // always accurate, without needing a cron job.
    try { await supabase.rpc('expire_wallet_credits'); } catch (err) { console.warn('[expire_wallet_credits]', err); }

    const [walletRes, creditsRes] = await Promise.all([
        supabase.from('wallets').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('wallet_credits').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    ]);

    if (walletRes.error) {
        console.error('[fetchWallet] error:', walletRes.error);
        throw new Error(walletRes.error.message || 'Failed to load wallet');
    }
    if (creditsRes.error) {
        console.error('[fetchWallet] credits error:', creditsRes.error);
        throw new Error(creditsRes.error.message || 'Failed to load wallet credits');
    }

    return {
        balance: Number(walletRes.data?.balance || 0),
        credits: creditsRes.data || [],
    };
}

// ── Full transaction history for one user ───────────────────────
export async function fetchWalletTransactions(userId, limit = 100) {
    if (!isConfigured() || !userId) return [];
    const { data, error } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) {
        console.error('[fetchWalletTransactions] error:', error);
        throw new Error(error.message || 'Failed to load transaction history');
    }
    return data || [];
}

// ── Coupons belonging to one user (their own + any global ones,
//    excluding global coupons this specific customer already used) ─
export async function fetchMyCoupons(userId) {
    if (!isConfigured() || !userId) return [];
    try { await supabase.rpc('expire_coupons'); } catch (err) { console.warn('[expire_coupons]', err); }

    const [couponsRes, redemptionsRes] = await Promise.all([
        supabase.from('coupons').select('*').or(`user_id.eq.${userId},user_id.is.null`).order('created_at', { ascending: false }),
        supabase.from('coupon_redemptions').select('coupon_id').eq('user_id', userId),
    ]);

    if (couponsRes.error) {
        console.error('[fetchMyCoupons] error:', couponsRes.error);
        throw new Error(couponsRes.error.message || 'Failed to load coupons');
    }
    // If the redemptions table isn't there yet (SQL migration not run),
    // just skip this extra filter rather than breaking the whole list.
    const usedCouponIds = new Set((redemptionsRes.data || []).map(r => r.coupon_id));

    return (couponsRes.data || []).filter(c => !(c.user_id === null && usedCouponIds.has(c.id)));
}

// ── Live coupon preview at checkout (does not consume it) ───────
export async function previewCoupon(code, subtotal) {
    const { data, error } = await supabase.rpc('preview_coupon', { p_code: code, p_subtotal: subtotal });
    if (error) throw new Error(error.message || 'Failed to check coupon');
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.coupon_id) throw new Error(row?.message || 'Invalid or expired coupon');
    return { couponId: row.coupon_id, discountAmount: Number(row.discount_amount) };
}

// ── Deduct wallet balance for a placed order ────────────────────
export async function spendWalletForOrder(userId, amount, orderId) {
    const { data, error } = await supabase.rpc('spend_wallet', {
        p_user_id: userId, p_amount: amount, p_order_id: orderId,
    });
    if (error) throw new Error(error.message || 'Failed to apply wallet balance');
    return Number(data);
}

// ── Mark a coupon redeemed against a placed order ───────────────
export async function redeemCouponForOrder(couponId, orderId) {
    const { data, error } = await supabase.rpc('redeem_coupon_for_order', {
        p_coupon_id: couponId, p_order_id: orderId,
    });
    if (error) throw new Error(error.message || 'Failed to redeem coupon');
    return Number(data);
}

// ══════════════════════════════════════════════════════════════
//  OWNER-FACING
// ══════════════════════════════════════════════════════════════

// ── List of customers to pick from when granting credit/coupons ──
export async function fetchCustomers() {
    if (!isConfigured()) return [];
    // NOTE: we deliberately don't filter with .eq('role', 'customer') here.
    // Depending on how your signup trigger populates the profiles table,
    // a regular customer's `role` column may be NULL or some other value
    // rather than the exact string 'customer' — that distinction was
    // never enforced before because only role = 'owner' mattered. So
    // instead we fetch every profile the owner is allowed to see and
    // simply exclude the owner account itself, which works regardless
    // of what value customer rows actually have.
    const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .order('full_name', { ascending: true });
    if (error) {
        console.error('[fetchCustomers] error:', error);
        throw new Error(error.message || 'Failed to load customers');
    }
    return (data || []).filter(p => p.role !== 'owner');
}

// Shared helper: attach profile info to a list of rows that have user_id
async function attachProfiles(rows) {
    const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
    if (userIds.length === 0) return rows;
    const { data: profiles, error } = await supabase
        .from('profiles').select('id, full_name, email').in('id', userIds);
    if (error) {
        console.warn('[attachProfiles] could not load profiles:', error);
        return rows;
    }
    const byId = Object.fromEntries((profiles || []).map(p => [p.id, p]));
    return rows.map(r => ({ ...r, profile: byId[r.user_id] || null }));
}

// ── Every customer's wallet balance ─────────────────────────────
export async function fetchAllWallets() {
    if (!isConfigured()) return [];
    try { await supabase.rpc('expire_wallet_credits'); } catch (err) { console.warn('[expire_wallet_credits]', err); }
    const { data, error } = await supabase.from('wallets').select('*').order('balance', { ascending: false });
    if (error) {
        console.error('[fetchAllWallets] error:', error);
        throw new Error(error.message || 'Failed to load wallets');
    }
    return attachProfiles(data || []);
}

// ── Every wallet credit batch ever granted ──────────────────────
export async function fetchAllWalletCredits() {
    if (!isConfigured()) return [];
    const { data, error } = await supabase.from('wallet_credits').select('*').order('created_at', { ascending: false });
    if (error) {
        console.error('[fetchAllWalletCredits] error:', error);
        throw new Error(error.message || 'Failed to load wallet credits');
    }
    return attachProfiles(data || []);
}

// ── Every coupon ever issued ─────────────────────────────────────
export async function fetchAllCoupons() {
    if (!isConfigured()) return [];
    try { await supabase.rpc('expire_coupons'); } catch (err) { console.warn('[expire_coupons]', err); }
    const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false });
    if (error) {
        console.error('[fetchAllCoupons] error:', error);
        throw new Error(error.message || 'Failed to load coupons');
    }
    return attachProfiles(data || []);
}

// ── Grant wallet credit to a customer ───────────────────────────
export async function grantWalletCredit({ userId, amount, expiryDate, note }) {
    const { data, error } = await supabase.rpc('owner_grant_wallet_credit', {
        p_user_id: userId, p_amount: amount, p_expiry_date: expiryDate || null, p_note: note || null,
    });
    if (error) throw new Error(error.message || 'Failed to grant wallet credit');
    return Number(data);
}

// ── Extend (or reactivate) a wallet credit's expiry ─────────────
export async function extendWalletCreditExpiry(creditId, newExpiryDate) {
    const { error } = await supabase.rpc('owner_extend_wallet_credit_expiry', {
        p_credit_id: creditId, p_new_expiry_date: newExpiryDate,
    });
    if (error) throw new Error(error.message || 'Failed to extend expiry');
}

// ── Issue a coupon to a customer ────────────────────────────────
export async function issueCoupon({ userId, code, discountType, discountValue, maxDiscount, minOrderValue, expiryDate, note }) {
    const { data, error } = await supabase.rpc('owner_issue_coupon', {
        p_user_id: userId,
        p_code: code,
        p_discount_type: discountType,
        p_discount_value: discountValue,
        p_max_discount: maxDiscount || null,
        p_min_order_value: minOrderValue || 0,
        p_expiry_date: expiryDate,
        p_note: note || null,
    });
    if (error) throw new Error(error.message || 'Failed to issue coupon');
    return data;
}

// ── Extend (or reactivate) a coupon's expiry ────────────────────
export async function extendCouponExpiry(couponId, newExpiryDate) {
    const { error } = await supabase.rpc('owner_extend_coupon_expiry', {
        p_coupon_id: couponId, p_new_expiry_date: newExpiryDate,
    });
    if (error) throw new Error(error.message || 'Failed to extend coupon expiry');
}

// ── Revoke an unused coupon ──────────────────────────────────────
export async function revokeCoupon(couponId) {
    const { error } = await supabase.rpc('owner_revoke_coupon', { p_coupon_id: couponId });
    if (error) throw new Error(error.message || 'Failed to revoke coupon');
}

// ── Generate a friendly random coupon code ──────────────────────
export function generateCouponCode(prefix = 'AURUM') {
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${rand}`;
}