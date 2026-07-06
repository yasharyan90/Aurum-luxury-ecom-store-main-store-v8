// src/components/IssueCouponModal.js
import React, { useState } from 'react';
import { generateCouponCode } from '../lib/walletService';
import CustomerSelect from './CustomerSelect';
import styles from './WalletModal.module.css';

export default function IssueCouponModal({ customers = [], defaultCustomer = null, onClose, onSave }) {
    const [customer, setCustomer]     = useState(defaultCustomer);
    const [code, setCode]             = useState(generateCouponCode());
    const [discountType, setDiscountType] = useState('percentage'); // 'percentage' | 'fixed'
    const [discountValue, setDiscountValue] = useState('');
    const [maxDiscount, setMaxDiscount]     = useState('');
    const [minOrderValue, setMinOrderValue] = useState('');
    const [expiryDate, setExpiryDate] = useState(defaultExpiry());
    const [note, setNote]             = useState('');
    const [error, setError]           = useState('');
    const [saving, setSaving]         = useState(false);

    function defaultExpiry() {
        const d = new Date();
        d.setMonth(d.getMonth() + 1); // sensible default: 1 month out
        return d.toISOString().slice(0, 10);
    }

    const handleSubmit = async () => {
        if (!customer) { setError('Please select a customer, or "All Customers".'); return; }
        if (!code.trim()) { setError('Enter a coupon code.'); return; }
        const val = parseFloat(discountValue);
        if (!val || val <= 0) { setError('Enter a discount value greater than zero.'); return; }
        if (discountType === 'percentage' && val > 100) { setError('Percentage discount cannot exceed 100.'); return; }
        if (!expiryDate) { setError('Pick an expiry date.'); return; }

        setSaving(true); setError('');
        try {
            await onSave({
                userId: customer.id, // null when "All Customers" is selected → global coupon
                code: code.trim().toUpperCase(),
                discountType,
                discountValue: val,
                maxDiscount: discountType === 'percentage' && maxDiscount ? parseFloat(maxDiscount) : null,
                minOrderValue: minOrderValue ? parseFloat(minOrderValue) : 0,
                expiryDate,
                note: note.trim() || null,
            });
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to issue coupon.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className={styles.modal} role="dialog" aria-label="Issue Coupon">
                <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
                <h2 className={styles.title}>Issue Coupon</h2>
                <p className={styles.subtitle}>Create a discount coupon for one customer, or for everyone.</p>

                {error && <div className="msg msg-error">{error}</div>}

                <div className="form-group">
                    <label className="form-label">Customer *</label>
                    <CustomerSelect
                        customers={customers}
                        value={customer}
                        onChange={setCustomer}
                        allowAll={true}
                        placeholder="Select a customer or All Customers…"
                    />
                </div>

                <div className="form-group">
                    <label className="form-label">Coupon Code *</label>
                    <div className={styles.codeRow}>
                        <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                            <input className="form-input" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="AURUM-XXXXXX" />
                        </div>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setCode(generateCouponCode())}>
                            Generate
                        </button>
                    </div>
                </div>

                <div className={styles.discountTypeRow}>
                    <button
                        type="button"
                        className={`${styles.discountTypeBtn} ${discountType === 'percentage' ? styles.discountTypeActive : ''}`}
                        onClick={() => setDiscountType('percentage')}
                    >
                        % Percentage
                    </button>
                    <button
                        type="button"
                        className={`${styles.discountTypeBtn} ${discountType === 'fixed' ? styles.discountTypeActive : ''}`}
                        onClick={() => setDiscountType('fixed')}
                    >
                        ₹ Fixed Amount
                    </button>
                </div>

                <div className={styles.grid}>
                    <div className="form-group">
                        <label className="form-label">{discountType === 'percentage' ? 'Discount (%) *' : 'Discount (₹) *'}</label>
                        <input
                            className="form-input" type="number" min="1"
                            max={discountType === 'percentage' ? 100 : undefined}
                            value={discountValue} onChange={e => setDiscountValue(e.target.value)}
                            placeholder={discountType === 'percentage' ? '10' : '500'}
                        />
                    </div>
                    {discountType === 'percentage' && (
                        <div className="form-group">
                            <label className="form-label">Max Discount Cap (₹)</label>
                            <input className="form-input" type="number" min="0" value={maxDiscount} onChange={e => setMaxDiscount(e.target.value)} placeholder="Optional" />
                        </div>
                    )}
                </div>

                <div className={styles.grid}>
                    <div className="form-group">
                        <label className="form-label">Min Order Value (₹)</label>
                        <input className="form-input" type="number" min="0" value={minOrderValue} onChange={e => setMinOrderValue(e.target.value)} placeholder="0" />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Expiry Date *</label>
                        <input
                            className="form-input" type="date" value={expiryDate}
                            onChange={e => setExpiryDate(e.target.value)}
                            min={new Date().toISOString().slice(0, 10)}
                        />
                    </div>
                </div>

                <div className="form-group">
                    <label className="form-label">Note (optional)</label>
                    <input className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Loyalty reward" />
                </div>

                <div className={styles.actions}>
                    <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
                        {saving ? 'Issuing…' : 'Issue Coupon'}
                    </button>
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                </div>
            </div>
        </div>
    );
}
