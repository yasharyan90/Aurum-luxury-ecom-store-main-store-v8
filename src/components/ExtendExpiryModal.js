// src/components/ExtendExpiryModal.js
import React, { useState } from 'react';
import styles from './WalletModal.module.css';

export default function ExtendExpiryModal({ title, subtitle, currentExpiry, onClose, onSave }) {
    const [date, setDate] = useState(currentExpiry || new Date().toISOString().slice(0, 10));
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSubmit = async () => {
        if (!date) { setError('Pick a new expiry date.'); return; }
        setSaving(true); setError('');
        try {
            await onSave(date);
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to extend expiry.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className={styles.modal} style={{ maxWidth: 380 }} role="dialog" aria-label="Extend Expiry">
                <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
                <h2 className={styles.title}>{title || 'Extend Expiry'}</h2>
                {subtitle && <p className={styles.subtitle}>{subtitle}</p>}

                {error && <div className="msg msg-error">{error}</div>}

                <div className="form-group">
                    <label className="form-label">Current Expiry</label>
                    <input className="form-input" value={currentExpiry || 'Never expires'} disabled style={{ opacity: 0.6 }} />
                </div>

                <div className="form-group">
                    <label className="form-label">New Expiry Date *</label>
                    <input
                        className="form-input" type="date" value={date}
                        onChange={e => setDate(e.target.value)}
                        min={new Date().toISOString().slice(0, 10)}
                    />
                </div>

                <div className={styles.actions}>
                    <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
                        {saving ? 'Saving…' : 'Save New Expiry'}
                    </button>
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                </div>
            </div>
        </div>
    );
}
