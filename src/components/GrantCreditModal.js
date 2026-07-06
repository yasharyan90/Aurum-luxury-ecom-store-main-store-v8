// src/components/GrantCreditModal.js
import React, { useState } from 'react';
import CustomerSelect from './CustomerSelect';
import styles from './WalletModal.module.css';

export default function GrantCreditModal({ customers = [], defaultCustomer = null, onClose, onSave }) {
    const [customer, setCustomer] = useState(defaultCustomer);
    const [amount, setAmount]     = useState('');
    const [noExpiry, setNoExpiry] = useState(false);
    const [expiryDate, setExpiryDate] = useState(defaultExpiry());
    const [note, setNote]         = useState('');
    const [error, setError]       = useState('');
    const [saving, setSaving]     = useState(false);

    function defaultExpiry() {
        const d = new Date();
        d.setMonth(d.getMonth() + 6); // sensible default: 6 months out
        return d.toISOString().slice(0, 10);
    }

    const handleSubmit = async () => {
        if (!customer) { setError('Please select a customer.'); return; }
        const amt = parseFloat(amount);
        if (!amt || amt <= 0) { setError('Enter an amount greater than zero.'); return; }
        if (!noExpiry && !expiryDate) { setError('Pick an expiry date, or check "Never expires".'); return; }

        setSaving(true); setError('');
        try {
            await onSave({
                userId: customer.id,
                amount: amt,
                expiryDate: noExpiry ? null : expiryDate,
                note: note.trim() || null,
            });
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to grant wallet credit.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className={styles.modal} role="dialog" aria-label="Grant Wallet Credit">
                <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
                <h2 className={styles.title}>Grant Wallet Credit</h2>
                <p className={styles.subtitle}>Add funds to a customer's wallet, with an optional expiry date.</p>

                {error && <div className="msg msg-error">{error}</div>}

                <div className="form-group">
                    <label className="form-label">Customer *</label>
                    <CustomerSelect customers={customers} value={customer} onChange={setCustomer} allowAll={false} />
                </div>

                <div className="form-group">
                    <label className="form-label">Amount (₹) *</label>
                    <input className="form-input" type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="1000" />
                </div>

                <div className="form-group">
                    <label className="form-label">Expiry Date</label>
                    <input
                        className="form-input"
                        type="date"
                        value={expiryDate}
                        onChange={e => setExpiryDate(e.target.value)}
                        disabled={noExpiry}
                        min={new Date().toISOString().slice(0, 10)}
                    />
                    <div className={styles.expiryRow}>
                        <label>
                            <input type="checkbox" checked={noExpiry} onChange={e => setNoExpiry(e.target.checked)} />
                            Never expires
                        </label>
                    </div>
                </div>

                <div className="form-group">
                    <label className="form-label">Note (optional)</label>
                    <input className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Birthday gift credit" />
                </div>

                <div className={styles.actions}>
                    <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
                        {saving ? 'Granting…' : 'Grant Credit'}
                    </button>
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                </div>
            </div>
        </div>
    );
}
