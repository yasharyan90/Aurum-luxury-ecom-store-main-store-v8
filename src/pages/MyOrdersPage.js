// src/pages/MyOrdersPage.js
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { fetchUserOrders, subscribeToOrderUpdates } from '../lib/orderService';
import { STATUS_CONFIG, getStatusConfig, TRACKING_STEPS } from '../lib/orderStatus';
import Footer from '../components/Footer';
import LuxuryLoader from '../components/LuxuryLoader';
import WalletSummaryCard from '../components/WalletSummaryCard';
import styles from './MyOrdersPage.module.css';

// Status config now imported from shared lib/orderStatus.js so the
// owner dashboard and customer-facing pages never drift out of sync.
const STATUS = STATUS_CONFIG;

function StatusTracker({ status }) {
    const currentStep = STATUS[status]?.step ?? 1;
    const isCancelled = status === 'cancelled';

    if (isCancelled) {
        return (
            <div className={styles.cancelledBanner}>
                <span>✕</span> This order has been cancelled
            </div>
        );
    }

    return (
        <div className={styles.tracker}>
            {TRACKING_STEPS.map((label, i) => {
                const stepNum   = i + 1;
                const isDone    = currentStep > stepNum;
                const isActive  = currentStep === stepNum;
                return (
                    <React.Fragment key={label}>
                        <div className={`${styles.trackerStep} ${isDone ? styles.done : ''} ${isActive ? styles.active : ''}`}>
                            <div className={styles.trackerDot}>
                                {isDone ? '✓' : isActive ? STATUS[status]?.icon : stepNum}
                            </div>
                            <span className={styles.trackerLabel}>{label}</span>
                        </div>
                        {i < TRACKING_STEPS.length - 1 && (
                            <div className={`${styles.trackerLine} ${isDone ? styles.trackerLineDone : ''}`} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

function OrderCard({ order }) {
    const [expanded, setExpanded] = useState(false);
    const status  = STATUS[order.status] || STATUS.paid;
    const address = order.address || {};
    const items   = order.order_items || [];
    const fmt     = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
    const orderId = (order.id || '').toString();
    const shortId = orderId.length > 20 ? orderId.slice(0, 20) + '…' : orderId;
    const date    = new Date(order.created_at).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric',
    });
    const time    = new Date(order.created_at).toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit',
    });

    return (
        <div className={styles.orderCard}>
            {/* ── Card Header ── */}
            <div className={styles.cardHeader} onClick={() => setExpanded(v => !v)}>
                <div className={styles.headerLeft}>
                    <div className={styles.orderId}>
                        <span className={styles.orderIdLabel}>Order</span>
                        <code className={styles.orderIdCode}>{shortId}</code>
                    </div>
                    <div className={styles.orderMeta}>
                        <span>{date} · {time}</span>
                        <span className={styles.dot}>·</span>
                        <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                    </div>
                </div>
                <div className={styles.headerRight}>
                    <div className={styles.orderTotal}>{fmt(order.total)}</div>
                    <span
                        className={styles.statusBadge}
                        style={{ background: status.bg, color: status.color }}
                    >
            {status.icon} {status.label}
          </span>
                    <button className={styles.expandBtn} aria-label={expanded ? 'Collapse' : 'Expand'}>
                        {expanded ? '▲' : '▼'}
                    </button>
                </div>
            </div>

            {/* ── Items preview (always visible) ── */}
            <div className={styles.itemsPreview}>
                {items.slice(0, 3).map((item, i) => (
                    <div key={i} className={styles.itemChip}>
                        <span>{item.products?.emoji || item.emoji || '💎'}</span>
                        <span>{item.product_name || item.products?.name}</span>
                    </div>
                ))}
                {items.length > 3 && (
                    <div className={styles.itemChip} style={{ color: 'var(--text-muted)' }}>
                        +{items.length - 3} more
                    </div>
                )}
            </div>

            {/* ── Expanded Detail ── */}
            {expanded && (
                <div className={styles.expandedBody}>
                    {/* Status Tracker */}
                    <div className={styles.section}>
                        <h3 className={styles.sectionTitle}>Order Status</h3>
                        <StatusTracker status={order.status} />
                        {order.tracking_number && (
                            <div className={styles.trackingBox}>
                                <span>📦</span>
                                <div>
                                    <p className={styles.trackingLabel}>{order.carrier || 'Courier'} Tracking Number</p>
                                    <code className={styles.trackingCode}>{order.tracking_number}</code>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className={styles.detailGrid}>
                        {/* Items */}
                        <div className={styles.section}>
                            <h3 className={styles.sectionTitle}>Items Ordered</h3>
                            {items.map((item, i) => (
                                <div key={i} className={styles.itemRow}>
                                    <div className={styles.itemEmoji}>
                                        {item.products?.emoji || item.emoji || '💎'}
                                    </div>
                                    <div className={styles.itemInfo}>
                                        <div className={styles.itemBrand}>
                                            {item.products?.brand || item.brand || ''}
                                        </div>
                                        <div className={styles.itemName}>
                                            {item.product_name || item.products?.name}
                                        </div>
                                        <div className={styles.itemQty}>Qty: {item.quantity}</div>
                                    </div>
                                    <div className={styles.itemPrice}>
                                        {fmt(item.price * item.quantity)}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Delivery & Payment */}
                        <div>
                            {/* Address */}
                            <div className={styles.section}>
                                <h3 className={styles.sectionTitle}>Delivery Address</h3>
                                {address.full_name ? (
                                    <div className={styles.addressBox}>
                                        <p className={styles.addressName}>{address.full_name}</p>
                                        <p className={styles.addressLine}>{address.phone}</p>
                                        <p className={styles.addressLine}>{address.line1}{address.line2 ? ', ' + address.line2 : ''}</p>
                                        <p className={styles.addressLine}>{address.city}, {address.state} — {address.pincode}</p>
                                        <p className={styles.addressLine}>{address.country || 'India'}</p>
                                    </div>
                                ) : (
                                    <p className={styles.na}>No address on record</p>
                                )}
                            </div>

                            {/* Payment */}
                            <div className={styles.section}>
                                <h3 className={styles.sectionTitle}>Payment Summary</h3>
                                <div className={styles.payRow}>
                                    <span>Subtotal</span><span>{fmt(order.subtotal)}</span>
                                </div>
                                <div className={styles.payRow}>
                                    <span>GST (18%)</span><span>{fmt(order.tax)}</span>
                                </div>
                                <div className={styles.payRow}>
                                    <span>Delivery</span><span style={{ color: '#27AE60' }}>Free</span>
                                </div>
                                {order.discount_amount > 0 && (
                                    <div className={styles.payRow}>
                                        <span>Coupon Discount</span><span style={{ color: '#27AE60' }}>−{fmt(order.discount_amount)}</span>
                                    </div>
                                )}
                                {order.wallet_amount_used > 0 && (
                                    <div className={styles.payRow}>
                                        <span>Wallet Applied</span><span style={{ color: '#27AE60' }}>−{fmt(order.wallet_amount_used)}</span>
                                    </div>
                                )}
                                <div className={`${styles.payRow} ${styles.payTotal}`}>
                                    <span>Total Paid</span><span>{fmt(order.total)}</span>
                                </div>
                                {order.payment_id && (
                                    <div className={styles.paymentId}>
                                        <span className={styles.paymentIdLabel}>Payment ID</span>
                                        <code className={styles.paymentIdCode}>{order.payment_id}</code>
                                    </div>
                                )}
                                <div className={styles.paymentMethod}>
                                    Via {order.payment_method || 'Razorpay'} · {date}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className={styles.cardActions}>
                        <Link to="/shop" className="btn btn-outline btn-sm">
                            Shop Again
                        </Link>
                        {order.status === 'delivered' && (
                            <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>
                                Download Invoice
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────
export default function MyOrdersPage() {
    const { user, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const [orders,  setOrders]  = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter,  setFilter]  = useState('all');

    const load = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const data = await fetchUserOrders(user.id);
            setOrders(data);
        } catch (err) {
            console.error('Failed to load orders:', err);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        if (!authLoading && !user) { navigate('/login', { state: { from: '/my-orders' } }); return; }
        if (user) load();
    }, [user, authLoading, load, navigate]);

    // ── Live status updates ───────────────────────────────────────
    // The instant the owner changes a status in the Admin Dashboard,
    // this listener fires and patches the matching order in place —
    // no manual refresh needed.
    useEffect(() => {
        if (!user) return;
        const unsubscribe = subscribeToOrderUpdates(user.id, (updatedOrder) => {
            setOrders(prev => prev.map(o =>
                o.id === updatedOrder.id ? { ...o, ...updatedOrder } : o
            ));
        });
        return unsubscribe;
    }, [user]);

    const filtered = filter === 'all'
        ? orders
        : orders.filter(o => o.status === filter);

    const counts = orders.reduce((acc, o) => {
        acc[o.status] = (acc[o.status] || 0) + 1;
        return acc;
    }, {});

    if (authLoading || loading) {
        return (
            <main style={{ minHeight: '60vh' }}>
                <LuxuryLoader label="Loading Your Orders" />
            </main>
        );
    }

    return (
        <main className="fade-in">
            {/* ── Hero ── */}
            <div className={styles.hero}>
                <div className="container">
                    <p className={styles.heroEyebrow}>✦ Member Account</p>
                    <h1 className={styles.heroTitle}>My Orders</h1>
                    <p className={styles.heroSub}>Track and manage your AURUM purchases</p>
                </div>
            </div>

            <div className="container section">
                {user && (
                    <div style={{ marginBottom: '2rem', maxWidth: 420 }}>
                        <WalletSummaryCard userId={user.id} />
                    </div>
                )}
                {orders.length === 0 ? (
                    /* ── Empty State ── */
                    <div className={styles.empty}>
                        <div className={styles.emptyIcon}>🛍</div>
                        <h2 className={styles.emptyTitle}>No orders yet</h2>
                        <p className={styles.emptySub}>
                            Discover our curated collection of luxury pieces and place your first order.
                        </p>
                        <Link to="/shop" className="btn btn-primary btn-lg">
                            Explore Collection
                        </Link>
                    </div>
                ) : (
                    <div className={styles.layout}>
                        {/* ── Sidebar ── */}
                        <aside className={styles.sidebar}>
                            <div className={styles.sidebarCard}>
                                <h3 className={styles.sidebarTitle}>Filter Orders</h3>
                                <div className={styles.filterList}>
                                    {[
                                        { key: 'all',       label: 'All Orders',  count: orders.length },
                                        { key: 'paid',       label: 'Confirmed',   count: counts.paid || 0 },
                                        { key: 'processing', label: 'Processing',  count: counts.processing || 0 },
                                        { key: 'shipped',    label: 'Shipped',     count: counts.shipped || 0 },
                                        { key: 'delivered',  label: 'Delivered',   count: counts.delivered || 0 },
                                        { key: 'cancelled',  label: 'Cancelled',   count: counts.cancelled || 0 },
                                    ].map(f => (
                                        <button
                                            key={f.key}
                                            className={`${styles.filterBtn} ${filter === f.key ? styles.filterActive : ''}`}
                                            onClick={() => setFilter(f.key)}
                                        >
                                            <span>{f.label}</span>
                                            {f.count > 0 && (
                                                <span className={styles.filterCount}>{f.count}</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Account quick links */}
                            <div className={styles.sidebarCard} style={{ marginTop: '1rem' }}>
                                <h3 className={styles.sidebarTitle}>Quick Links</h3>
                                <Link to="/shop"  className={styles.quickLink}>💎 Continue Shopping</Link>
                                <Link to="/cart"  className={styles.quickLink}>🛍 View Cart</Link>
                                <Link to="/track-order" className={styles.quickLink}>📍 Track Order Status</Link>
                                <a href="mailto:concierge@aurum-boutique.com" className={styles.quickLink}>✉️ Contact Concierge</a>
                            </div>
                        </aside>

                        {/* ── Orders List ── */}
                        <div className={styles.ordersList}>
                            <div className={styles.listHeader}>
                                <h2 className={styles.listTitle}>
                                    {filter === 'all' ? 'All Orders' : STATUS[filter]?.label + ' Orders'}
                                </h2>
                                <span className={styles.listCount}>
                  {filtered.length} order{filtered.length !== 1 ? 's' : ''}
                </span>
                            </div>

                            {filtered.length === 0 ? (
                                <div className={styles.filterEmpty}>
                                    No {filter} orders found.
                                </div>
                            ) : (
                                filtered.map(order => (
                                    <OrderCard key={order.id} order={order} />
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>

            <Footer />
        </main>
    );
}
