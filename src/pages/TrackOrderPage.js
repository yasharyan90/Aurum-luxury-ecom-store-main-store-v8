// src/pages/TrackOrderPage.js
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { trackOrder } from '../lib/orderService';
import { getStatusConfig, TRACKING_STEPS } from '../lib/orderStatus';
import Footer from '../components/Footer';
import styles from './TrackOrderPage.module.css';

// ── Visual timeline ─────────────────────────────────────────────
function TrackingTimeline({ status, statusUpdatedAt }) {
    const cfg = getStatusConfig(status);
    const currentStep = cfg.step;
    const isCancelled = status === 'cancelled';

    if (isCancelled) {
        return (
            <div className={styles.cancelledBanner}>
                <span className={styles.cancelledIcon}>✕</span>
                <div>
                    <strong>This order was cancelled</strong>
                    <p>
                        {statusUpdatedAt &&
                            `Cancelled on ${new Date(statusUpdatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}. `}
                        Any payment made will be refunded within 5–7 business days.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.timeline}>
            {TRACKING_STEPS.map((label, i) => {
                const stepNum  = i + 1;
                const isDone   = currentStep > stepNum;
                const isActive = currentStep === stepNum;
                return (
                    <div key={label} className={styles.timelineStep}>
                        <div className={styles.timelineMarkerCol}>
                            <div className={`${styles.timelineDot} ${isDone ? styles.dotDone : ''} ${isActive ? styles.dotActive : ''}`}>
                                {isDone ? '✓' : isActive ? cfg.icon : stepNum}
                            </div>
                            {i < TRACKING_STEPS.length - 1 && (
                                <div className={`${styles.timelineConnector} ${isDone ? styles.connectorDone : ''}`} />
                            )}
                        </div>
                        <div className={styles.timelineContent}>
                            <p className={`${styles.timelineLabel} ${(isDone || isActive) ? styles.timelineLabelActive : ''}`}>
                                {label}
                            </p>
                            {isActive && (
                                <p className={styles.timelineDesc}>{cfg.description}</p>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ── Search form ──────────────────────────────────────────────────
function TrackingSearchForm({ onSearch, loading, initialOrderId = '', initialEmail = '' }) {
    const [orderId, setOrderId] = useState(initialOrderId);
    const [email, setEmail]     = useState(initialEmail);
    const [touched, setTouched] = useState(false);

    const orderIdValid = orderId.trim().length > 5;
    const emailValid    = /\S+@\S+\.\S+/.test(email);

    const handleSubmit = (e) => {
        e.preventDefault();
        setTouched(true);
        if (orderIdValid && emailValid) onSearch(orderId.trim(), email.trim());
    };

    return (
        <form className={styles.searchCard} onSubmit={handleSubmit}>
            <h2 className={styles.searchTitle}>Track Your Order</h2>
            <p className={styles.searchSub}>
                Enter your Order ID and the email address used at checkout.
            </p>

            <div className={styles.formGroup}>
                <label className="form-label">Order ID</label>
                <input
                    className={`form-input ${touched && !orderIdValid ? 'error' : ''}`}
                    value={orderId}
                    onChange={e => setOrderId(e.target.value)}
                    placeholder="e.g. a1111111-1111-4111-8111-111111111111"
                />
                {touched && !orderIdValid && (
                    <span className="form-error">Enter the Order ID from your confirmation email</span>
                )}
            </div>

            <div className={styles.formGroup}>
                <label className="form-label">Email Address</label>
                <input
                    className={`form-input ${touched && !emailValid ? 'error' : ''}`}
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                />
                {touched && !emailValid && (
                    <span className="form-error">Enter a valid email address</span>
                )}
            </div>

            <button className="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: '100%' }}>
                {loading ? 'Searching…' : 'Track Order'}
            </button>

            <p className={styles.searchHint}>
                💡 Your Order ID was included in your confirmation email — it usually starts with letters/numbers like <code>a1111111…</code>
            </p>
        </form>
    );
}

// ── Order result card ────────────────────────────────────────────
function OrderResult({ order }) {
    const cfg     = getStatusConfig(order.status);
    const address = order.address || {};
    const items   = order.order_items || [];
    const fmt     = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
    const orderId = (order.id || '').toString();

    return (
        <div className={styles.resultCard}>
            {/* Header */}
            <div className={styles.resultHeader}>
                <div>
                    <p className={styles.resultEyebrow}>Order</p>
                    <code className={styles.resultId}>{orderId}</code>
                </div>
                <span className={styles.resultStatusBadge} style={{ background: cfg.color + '1A', color: cfg.color, borderColor: cfg.color + '40' }}>
          {cfg.icon} {cfg.label}
        </span>
            </div>

            <div className={styles.resultMeta}>
                Placed on {new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                {order.estimated_delivery && order.status !== 'delivered' && order.status !== 'cancelled' && (
                    <> · Estimated delivery <strong>{new Date(order.estimated_delivery).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}</strong></>
                )}
            </div>

            {/* Timeline */}
            <div className={styles.timelineSection}>
                <TrackingTimeline status={order.status} statusUpdatedAt={order.status_updated_at} />
            </div>

            {/* Tracking number */}
            {order.tracking_number && (
                <div className={styles.courierBox}>
                    <span className={styles.courierIcon}>📦</span>
                    <div>
                        <p className={styles.courierLabel}>{order.carrier || 'Courier'} Tracking Number</p>
                        <code className={styles.courierNumber}>{order.tracking_number}</code>
                    </div>
                </div>
            )}

            {/* Items */}
            {items.length > 0 && (
                <div className={styles.itemsSection}>
                    <h3 className={styles.sectionLabel}>Items in this order</h3>
                    {items.map((item, i) => (
                        <div key={i} className={styles.itemRow}>
                            <span className={styles.itemEmoji}>{item.emoji || item.products?.emoji || '💎'}</span>
                            <span className={styles.itemName}>{item.product_name}</span>
                            <span className={styles.itemQty}>×{item.quantity}</span>
                            <span className={styles.itemPrice}>{fmt(item.price * item.quantity)}</span>
                        </div>
                    ))}
                    <div className={styles.itemRow} style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Total Paid</span>
                        <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--gold-dark)' }}>{fmt(order.total)}</span>
                    </div>
                </div>
            )}

            {/* Delivery address */}
            {address.line1 && (
                <div className={styles.addressSection}>
                    <h3 className={styles.sectionLabel}>Delivering to</h3>
                    <p className={styles.addressText}>
                        {address.full_name}<br />
                        {address.line1}{address.line2 ? `, ${address.line2}` : ''}<br />
                        {address.city}, {address.state} — {address.pincode}<br />
                        {address.country || 'India'}
                    </p>
                </div>
            )}
        </div>
    );
}

// ── Help & Contact section ───────────────────────────────────────
function HelpSection() {
    return (
        <div className={styles.helpCard}>
            <h2 className={styles.helpTitle}>Need Help With Your Order?</h2>
            <p className={styles.helpSub}>Our concierge team is here for you.</p>

            <div className={styles.helpGrid}>
                <a href="mailto:concierge@aurum-boutique.com" className={styles.helpItem}>
                    <span className={styles.helpIcon}>✉️</span>
                    <div>
                        <p className={styles.helpItemTitle}>Email Concierge</p>
                        <p className={styles.helpItemSub}>concierge@aurum-boutique.com</p>
                    </div>
                </a>
                <a href="tel:+918000000000" className={styles.helpItem}>
                    <span className={styles.helpIcon}>📞</span>
                    <div>
                        <p className={styles.helpItemTitle}>Call Us</p>
                        <p className={styles.helpItemSub}>+91 800 000 0000 · Mon–Sat, 10am–7pm</p>
                    </div>
                </a>
                <a href="https://wa.me/918000000000" target="_blank" rel="noreferrer" className={styles.helpItem}>
                    <span className={styles.helpIcon}>💬</span>
                    <div>
                        <p className={styles.helpItemTitle}>WhatsApp Support</p>
                        <p className={styles.helpItemSub}>Quick replies during business hours</p>
                    </div>
                </a>
                <Link to="/my-orders" className={styles.helpItem}>
                    <span className={styles.helpIcon}>📋</span>
                    <div>
                        <p className={styles.helpItemTitle}>Signed In?</p>
                        <p className={styles.helpItemSub}>View all your orders in My Orders</p>
                    </div>
                </Link>
            </div>

            <div className={styles.faqBox}>
                <details className={styles.faqItem}>
                    <summary>How long does delivery take?</summary>
                    <p>Most orders are delivered within 3–5 business days after dispatch. Made-to-order or limited-edition pieces may take longer — you'll be notified by email.</p>
                </details>
                <details className={styles.faqItem}>
                    <summary>Can I change my delivery address?</summary>
                    <p>Contact our concierge team as soon as possible. We can update the address only before the order is marked "Shipped".</p>
                </details>
                <details className={styles.faqItem}>
                    <summary>What is your return policy?</summary>
                    <p>We accept returns within 14 days of delivery for unworn items in original packaging with certificates intact. Contact concierge to initiate a return.</p>
                </details>
                <details className={styles.faqItem}>
                    <summary>My tracking number isn't working yet</summary>
                    <p>Tracking numbers can take 24–48 hours to activate on the courier's website after dispatch. If it's been longer, please reach out to us.</p>
                </details>
            </div>
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────────
export default function TrackOrderPage() {
    const [searchParams] = useSearchParams();
    const [order, setOrder]     = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState('');
    const [searched, setSearched] = useState(false);

    const prefillId    = searchParams.get('orderId') || '';
    const prefillEmail = searchParams.get('email')   || '';

    const handleSearch = useCallback(async (orderId, email) => {
        setLoading(true);
        setError('');
        setSearched(true);
        try {
            const result = await trackOrder(orderId, email);
            if (!result) {
                setOrder(null);
                setError('No order found matching that ID and email. Please double-check and try again, or contact our concierge team below.');
            } else {
                setOrder(result);
            }
        } catch (err) {
            setOrder(null);
            setError(err.message || 'Something went wrong. Please try again.');
        } finally {
            setLoading(false);
        }
    }, []);

    // Auto-search if both params are present in the URL (e.g. from confirmation email link)
    useEffect(() => {
        if (prefillId && prefillEmail) handleSearch(prefillId, prefillEmail);
    }, [prefillId, prefillEmail, handleSearch]);

    return (
        <main className="fade-in">
            <div className={styles.hero}>
                <div className="container">
                    <p className={styles.heroEyebrow}>✦ Order Tracking</p>
                    <h1 className={styles.heroTitle}>Track Your Order</h1>
                    <p className={styles.heroSub}>Real-time status, right at your fingertips.</p>
                </div>
            </div>

            <div className="container section">
                <div className={styles.layout}>
                    <div>
                        <TrackingSearchForm
                            onSearch={handleSearch}
                            loading={loading}
                            initialOrderId={prefillId}
                            initialEmail={prefillEmail}
                        />

                        {error && (
                            <div className={styles.errorBox}>
                                <span>⚠</span>
                                <p>{error}</p>
                            </div>
                        )}

                        {order && <OrderResult order={order} />}

                        {!searched && !order && (
                            <div className={styles.placeholderBox}>
                                <div className={styles.placeholderIcon}>📍</div>
                                <p>Enter your order details above to see live tracking status.</p>
                            </div>
                        )}
                    </div>

                    <HelpSection />
                </div>
            </div>

            <Footer />
        </main>
    );
}
