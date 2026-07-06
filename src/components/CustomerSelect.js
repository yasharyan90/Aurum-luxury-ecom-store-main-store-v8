// src/components/CustomerSelect.js
import React, { useState, useMemo, useRef, useEffect } from 'react';
import styles from './WalletModal.module.css';

// Sentinel value representing "issue to every customer" — a coupon
// with this selected is saved with user_id = null (global coupon).
export const ALL_CUSTOMERS_OPTION = {
    id: null,
    full_name: 'All Customers',
    email: 'Any customer can use this coupon',
};

// value: null (nothing picked yet) | ALL_CUSTOMERS_OPTION | a customer { id, full_name, email }
export default function CustomerSelect({ customers = [], value, onChange, allowAll = false, placeholder = 'Select a customer…' }) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const boxRef = useRef(null);
    const searchInputRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        const handleClickOutside = (e) => {
            if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    useEffect(() => {
        if (open) {
            setSearch('');
            // let the panel render before focusing
            setTimeout(() => searchInputRef.current?.focus(), 0);
        }
    }, [open]);

    const filtered = useMemo(() => {
        if (!search.trim()) return customers;
        const q = search.toLowerCase();
        return customers.filter(c =>
            (c.full_name || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)
        );
    }, [customers, search]);

    const handleSelect = (customer) => {
        onChange(customer);
        setOpen(false);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') setOpen(false);
    };

    return (
        <div className={styles.comboBox} ref={boxRef}>
            <button
                type="button"
                className={`${styles.comboTrigger} ${open ? styles.comboTriggerOpen : ''}`}
                onClick={() => setOpen(o => !o)}
            >
                {value ? (
                    <div className={styles.comboSelectedLine}>
                        <span className={styles.comboSelectedName}>{value.full_name || 'Customer'}</span>
                        <span className={styles.comboSelectedSub}>{value.email}</span>
                    </div>
                ) : (
                    <span className={styles.comboTriggerPlaceholder}>{placeholder}</span>
                )}
                <span className={`${styles.comboArrow} ${open ? styles.comboArrowOpen : ''}`}>▼</span>
            </button>

            {open && (
                <div className={styles.comboPanel}>
                    <div className={styles.comboSearchWrap}>
                        <input
                            ref={searchInputRef}
                            className={styles.comboSearchInput}
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Type a name or email to search…"
                        />
                    </div>
                    <div className={styles.comboList}>
                        {allowAll && (
                            <button
                                type="button"
                                className={`${styles.comboOption} ${styles.comboOptionAll}`}
                                onClick={() => handleSelect(ALL_CUSTOMERS_OPTION)}
                            >
                                <div className={styles.comboOptionName}>🌐 All Customers</div>
                                <div className={styles.comboOptionSub}>Any customer can use this coupon</div>
                            </button>
                        )}
                        {customers.length === 0 ? (
                            <div className={styles.comboEmpty}>
                                No customer profiles found in your database at all — this isn't a search
                                problem. Check that <code>public.profiles</code> actually has rows for your
                                customers (see <code>supabase_fix_missing_profiles.sql</code>).
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className={styles.comboEmpty}>No customers match "{search}".</div>
                        ) : filtered.map(c => (
                            <button
                                key={c.id}
                                type="button"
                                className={styles.comboOption}
                                onClick={() => handleSelect(c)}
                            >
                                <div className={styles.comboOptionName}>{c.full_name || 'Customer'}</div>
                                <div className={styles.comboOptionSub}>{c.email}</div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}