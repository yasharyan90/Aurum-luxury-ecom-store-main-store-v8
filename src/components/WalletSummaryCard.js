// src/components/WalletSummaryCard.js
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { fetchWallet, fetchMyCoupons, fetchWalletTransactions } from '../lib/walletService';
import { useToast } from '../App';
import styles from './WalletSummaryCard.module.css';

const fmt = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

function expiryBadge(expiryDate) {
    if (!expiryDate) return { label: 'No Expiry', cls: styles.badgeActive };
    const days = Math.ceil((new Date(expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (days < 0)  return { label: 'Expired', cls: styles.badgeExpired };
    if (days <= 7) return { label: `${days}d left`, cls: styles.badgeExpiring };
    return { label: new Date(expiryDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }), cls: styles.badgeActive };
}

// onData: optional callback(({ balance, coupons })) — lets a parent
// (e.g. CheckoutPage) reuse the fetched balance/coupons without a
// second network round-trip.
export default function WalletSummaryCard({ userId, onData }) {
    const toast = useToast();
    const [wallet, setWallet]   = useState({ balance: 0, credits: [] });
    const [coupons, setCoupons] = useState([]);
    const [txns, setTxns]       = useState([]);
    const [loading, setLoading] = useState(true);
    const [showHistory, setShowHistory] = useState(false);

    // Keep the latest onData callback in a ref so `load` below doesn't
    // need it in its dependency array — refs don't require exhaustive-deps
    // entries, and it avoids re-fetching every render if a parent ever
    // passes a new inline function for onData.
    const onDataRef = useRef(onData);
    useEffect(() => { onDataRef.current = onData; }, [onData]);

    const load = useCallback(async () => {
        if (!userId) return;
        setLoading(true);
        try {
            const [w, c] = await Promise.all([fetchWallet(userId), fetchMyCoupons(userId)]);
            setWallet(w);
            const activeCoupons = c.filter(cp => cp.status === 'active');
            setCoupons(activeCoupons);
            onDataRef.current?.({ balance: w.balance, coupons: activeCoupons });
        } catch (err) {
            console.error('WalletSummaryCard load failed:', err);
            toast?.(`Could not load wallet: ${err.message || 'Unknown error'}`, 'error');
        } finally {
            setLoading(false);
        }
    }, [userId, toast]);

    useEffect(() => { load(); }, [load]);

    const loadHistory = async () => {
        setShowHistory(v => !v);
        if (!showHistory && txns.length === 0) {
            try {
                const data = await fetchWalletTransactions(userId, 30);
                setTxns(data);
            } catch (err) {
                toast?.(`Could not load history: ${err.message || 'Unknown error'}`, 'error');
            }
        }
    };

    const copyCoupon = (code) => {
        navigator.clipboard.writeText(code)
            .then(() => toast?.('Coupon code copied', 'success'))
            .catch(() => {});
    };

    if (loading) {
        return (
            <div className={styles.card}>
                <p className={styles.title}>My Wallet</p>
                <p className={styles.empty}>Loading…</p>
            </div>
        );
    }

    const activeCredits = wallet.credits.filter(c => c.status === 'active');

    return (
        <div className={styles.card}>
            <p className={styles.title}>My Wallet</p>
            <div className={styles.balance}>{fmt(wallet.balance)}</div>
            <div className={styles.balanceLabel}>Available Balance</div>

            {/* Active credit batches with expiry */}
            <div className={styles.section}>
                <p className={styles.sectionTitle}>Credits</p>
                {activeCredits.length === 0 ? (
                    <p className={styles.empty}>No wallet credits yet.</p>
                ) : activeCredits.map(c => {
                    const badge = expiryBadge(c.expiry_date);
                    return (
                        <div key={c.id} className={styles.row}>
                            <div>
                                <div className={styles.rowMain}>{fmt(c.remaining_amount)}</div>
                                {c.note && <div className={styles.rowSub}>{c.note}</div>}
                            </div>
                            <span className={`${styles.badge} ${badge.cls}`}>{badge.label}</span>
                        </div>
                    );
                })}
            </div>

            {/* Active coupons */}
            <div className={styles.section}>
                <p className={styles.sectionTitle}>My Coupons</p>
                {coupons.length === 0 ? (
                    <p className={styles.empty}>No active coupons.</p>
                ) : coupons.map(cp => {
                    const badge = expiryBadge(cp.expiry_date);
                    return (
                        <div key={cp.id} className={styles.row}>
              <span className={styles.couponCode} onClick={() => copyCoupon(cp.code)} title="Click to copy">
                {cp.code}
              </span>
                            <div style={{ textAlign: 'right' }}>
                                <div className={styles.rowMain}>
                                    {cp.discount_type === 'percentage' ? `${cp.discount_value}% off` : `${fmt(cp.discount_value)} off`}
                                </div>
                                <span className={`${styles.badge} ${badge.cls}`}>{badge.label}</span>
                            </div>
                        </div>
                    );
                })}
            </div>

            <button className={styles.toggle} onClick={loadHistory}>
                {showHistory ? '▲ Hide Transaction History' : '▼ View Transaction History'}
            </button>

            {showHistory && (
                <div className={styles.txnList}>
                    {txns.length === 0 ? (
                        <p className={styles.empty}>No transactions yet.</p>
                    ) : txns.map(t => (
                        <div key={t.id} className={styles.txnRow}>
                            <div>
                                <div>{t.description || t.type}</div>
                                <div className={styles.txnDate}>
                                    {new Date(t.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </div>
                            </div>
                            <div className={t.amount >= 0 ? styles.txnCredit : styles.txnDebit}>
                                {t.amount >= 0 ? '+' : ''}{fmt(t.amount)}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
