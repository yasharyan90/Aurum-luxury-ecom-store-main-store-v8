// src/pages/AdminPage.js
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../App';
import { fetchProducts, createProduct, updateProduct, deleteProduct } from '../lib/productService';
import { fetchOrders, updateOrderStatus } from '../lib/orderService';
import { ORDER_STATUSES, getStatusConfig } from '../lib/orderStatus';
import {
    fetchCustomers, fetchAllWallets, fetchAllWalletCredits, fetchAllCoupons,
    grantWalletCredit, extendWalletCreditExpiry, issueCoupon, extendCouponExpiry, revokeCoupon,
} from '../lib/walletService';
import ProductModal from '../components/ProductModal';
import GrantCreditModal from '../components/GrantCreditModal';
import IssueCouponModal from '../components/IssueCouponModal';
import ExtendExpiryModal from '../components/ExtendExpiryModal';
import LuxuryLoader from '../components/LuxuryLoader';
import TableSkeleton from '../components/TableSkeleton';
import styles from './AdminPage.module.css';

const TABS = ['dashboard', 'products', 'orders', 'wallet'];

const STOCK_COLOR = (stock) => (stock === 0 ? '#C0392B' : stock < 5 ? '#D97706' : '#27AE60');

function expiryBadge(expiryDate, status) {
    if (status === 'depleted')  return { label: 'Depleted', cls: styles.badgeNeutral };
    if (status === 'redeemed')  return { label: 'Redeemed', cls: styles.badgeNeutral };
    if (status === 'revoked')   return { label: 'Revoked',  cls: styles.badgeNeutral };
    if (status === 'expired')   return { label: 'Expired',  cls: styles.badgeExpired };
    if (!expiryDate) return { label: 'No Expiry', cls: styles.badgeActive };
    const days = Math.ceil((new Date(expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (days < 0)  return { label: 'Expired', cls: styles.badgeExpired };
    if (days <= 7) return { label: `${days}d left`, cls: styles.badgeExpiring };
    return { label: new Date(expiryDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }), cls: styles.badgeActive };
}

export default function AdminPage() {
    const { user, profile, signOut } = useAuth();
    const toast = useToast();
    const [tab, setTab]           = useState('dashboard');
    const [products, setProducts] = useState([]);
    const [orders, setOrders]     = useState([]);
    const [loadingProducts, setLoadingProducts] = useState(true);
    const [loadingOrders, setLoadingOrders]     = useState(true);
    const [modal, setModal]       = useState(null); // null | 'add' | product obj
    const [search, setSearch]     = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState(null);

    // ── Wallet & Coupons ──────────────────────────────────
    const [walletSubTab, setWalletSubTab]   = useState('wallets'); // 'wallets' | 'credits' | 'coupons'
    const [customers, setCustomers]         = useState([]);
    const [wallets, setWallets]             = useState([]);
    const [walletCredits, setWalletCredits] = useState([]);
    const [coupons, setCoupons]             = useState([]);
    const [loadingWallet, setLoadingWallet] = useState(true);
    const [grantModal, setGrantModal]       = useState(null); // null | true | { customer }
    const [couponModal, setCouponModal]     = useState(null); // null | true | { customer }
    const [extendTarget, setExtendTarget]   = useState(null); // { type: 'credit'|'coupon', id, currentExpiry, title }

    // ── Data loaders ─────────────────────────────────────
    const loadProducts = useCallback(async () => {
        setLoadingProducts(true);
        try {
            const data = await fetchProducts({ limit: 200 });
            setProducts(data);
        } finally { setLoadingProducts(false); }
    }, []);

    const loadOrders = useCallback(async () => {
        setLoadingOrders(true);
        try {
            const data = await fetchOrders();
            setOrders(data);
        } catch (err) {
            console.error('loadOrders failed:', err);
            toast(`Failed to load orders: ${err?.message || 'Unknown error — check browser console'}`, 'error');
        } finally { setLoadingOrders(false); }
    }, [toast]);

    const loadWallet = useCallback(async () => {
        setLoadingWallet(true);
        try {
            const [c, w, wc, cp] = await Promise.all([
                fetchCustomers(), fetchAllWallets(), fetchAllWalletCredits(), fetchAllCoupons(),
            ]);
            setCustomers(c);
            setWallets(w);
            setWalletCredits(wc);
            setCoupons(cp);
        } catch (err) {
            console.error('loadWallet failed:', err);
            toast(`Failed to load wallet data: ${err?.message || 'Unknown error — check browser console'}`, 'error');
        } finally { setLoadingWallet(false); }
    }, [toast]);

    useEffect(() => {
        if (tab === 'dashboard' || tab === 'products') loadProducts();
        if (tab === 'dashboard' || tab === 'orders')   loadOrders();
        if (tab === 'wallet')                          loadWallet();
    }, [tab, loadProducts, loadOrders, loadWallet]);

    // ── Wallet / Coupon handlers ────────────────────────────
    const handleGrantCredit = async (payload) => {
        await grantWalletCredit(payload);
        toast('Wallet credit granted successfully', 'success');
        await loadWallet();
    };

    const handleIssueCoupon = async (payload) => {
        await issueCoupon(payload);
        toast('Coupon issued successfully', 'success');
        await loadWallet();
    };

    const handleExtendExpiry = async (newDate) => {
        if (extendTarget.type === 'credit') {
            await extendWalletCreditExpiry(extendTarget.id, newDate);
        } else {
            await extendCouponExpiry(extendTarget.id, newDate);
        }
        toast('Expiry updated successfully', 'success');
        await loadWallet();
    };

    const handleRevokeCoupon = async (coupon) => {
        if (!window.confirm(`Revoke coupon ${coupon.code}? This cannot be undone.`)) return;
        try {
            await revokeCoupon(coupon.id);
            toast('Coupon revoked', 'success');
            await loadWallet();
        } catch (err) {
            toast(`Failed to revoke coupon: ${err.message}`, 'error');
        }
    };

    // ── Product CRUD ──────────────────────────────────────
    const handleSave = async (data) => {
        if (modal && modal !== 'add') {
            await updateProduct(modal.id, data);
            toast('Product updated successfully', 'success');
        } else {
            await createProduct({ ...data, created_by: user?.id });
            toast('Product added to collection', 'success');
        }
        await loadProducts();
        setModal(null);
    };

    const handleDelete = async (id) => {
        await deleteProduct(id);
        toast('Product removed from collection', 'success');
        setDeleteConfirm(null);
        await loadProducts();
    };

    const handleStatusChange = async (orderId, status) => {
        try {
            await updateOrderStatus(orderId, status);
            setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o));
            toast(`Order marked as ${getStatusConfig(status).label} — customer notified by email`, 'success');
        } catch (err) {
            // Log the real Supabase error so it shows in browser DevTools console
            console.error('updateOrderStatus failed:', err);
            const msg = err?.message || '';
            if (msg.includes('violates row-level security') || msg.includes('RLS')) {
                toast('Permission denied — make sure your profile has role = owner in Supabase', 'error');
            } else if (msg.includes('violates check constraint')) {
                toast('Invalid status value — run supabase_fix_status_and_tracking.sql in Supabase SQL Editor', 'error');
            } else {
                toast(`Failed to update status: ${msg || 'Unknown error — check browser console'}`, 'error');
            }
        }
    };

    const handleCopyTrackingLink = (order) => {
        const email = order.address?.email || order.profiles?.email || '';
        const url = `${window.location.origin}/track-order?orderId=${order.id}&email=${encodeURIComponent(email)}`;
        navigator.clipboard.writeText(url)
            .then(() => toast('Tracking link copied — share it with the customer', 'success'))
            .catch(() => toast('Could not copy link', 'error'));
    };

    // ── Stats ─────────────────────────────────────────────
    const inventoryValue   = products.reduce((s, p) => s + p.price * (p.stock || 0), 0);
    const lowStockCount    = products.filter(p => p.stock < 5 && p.stock > 0).length;
    const ordersTotal      = orders.reduce((s, o) => s + (o.total || 0), 0);
    const filteredProducts = products.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.brand.toLowerCase().includes(search.toLowerCase()) ||
        p.category.toLowerCase().includes(search.toLowerCase())
    );

    const fmt     = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
    const fmtLakh = (n) => n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : fmt(n);

    return (
        <div className={styles.layout}>
            {/* ── Sidebar ── */}
            <aside className={styles.sidebar}>
                <div className={styles.sidebarLogo}>
                    <span className={styles.logoText}>AURUM</span>
                    <span className={styles.logoSub}>Owner Panel</span>
                </div>

                <nav className={styles.sidebarNav}>
                    {TABS.map(t => (
                        <button
                            key={t}
                            className={`${styles.navItem} ${tab === t ? styles.navActive : ''}`}
                            onClick={() => setTab(t)}
                        >
              <span className={styles.navIcon}>
                {t === 'dashboard' ? '📊' : t === 'products' ? '💎' : t === 'orders' ? '📦' : '💰'}
              </span>
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </nav>

                <div className={styles.sidebarFooter}>
                    <div className={styles.ownerInfo}>
                        <div className={styles.ownerAvatar}>
                            {(profile?.full_name || user?.email || 'O')[0].toUpperCase()}
                        </div>
                        <div>
                            <p className={styles.ownerName}>{profile?.full_name || 'Owner'}</p>
                            <p className={styles.ownerRole}>Boutique Owner</p>
                        </div>
                    </div>
                    <button className="btn btn-outline btn-sm" onClick={signOut} style={{ width: '100%', marginTop: '1rem' }}>
                        Sign Out
                    </button>
                </div>
            </aside>

            {/* ── Main ── */}
            <main className={styles.main}>

                {/* ═══════════ DASHBOARD ═══════════ */}
                {tab === 'dashboard' && (
                    <div className="fade-in">
                        <div className={styles.pageHeader}>
                            <div>
                                <h1 className={styles.pageTitle}>Dashboard</h1>
                                <p className={styles.pageDate}>
                                    {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                                </p>
                            </div>
                        </div>

                        {loadingProducts || loadingOrders ? (
                            <LuxuryLoader label="Loading Dashboard" />
                        ) : (
                            <>
                                {/* Stats */}
                                <div className={styles.statsGrid}>
                                    {[
                                        { num: products.length,         label: 'Total Products',   icon: '💎' },
                                        { num: fmtLakh(inventoryValue), label: 'Inventory Value',  icon: '💰' },
                                        { num: lowStockCount,            label: 'Low Stock Items',  icon: '⚠️' },
                                        { num: fmtLakh(ordersTotal),     label: 'Total Revenue',    icon: '📈' },
                                    ].map(s => (
                                        <div key={s.label} className={styles.statCard}>
                                            <div className={styles.statIcon}>{s.icon}</div>
                                            <div className={styles.statNum}>{s.num}</div>
                                            <div className={styles.statLabel}>{s.label}</div>
                                        </div>
                                    ))}
                                </div>

                                {/* Category Breakdown + Recent Orders */}
                                <div className={styles.dashGrid}>
                                    <div className={styles.panel}>
                                        <h2 className={styles.panelTitle}>Category Breakdown</h2>
                                        {['Jewellery', 'Watches', 'Clothing', 'Accessories', 'Fragrance'].map(cat => {
                                            const count = products.filter(p => p.category === cat).length;
                                            const pct   = products.length ? Math.round((count / products.length) * 100) : 0;
                                            return (
                                                <div key={cat} className={styles.catRow}>
                                                    <span className={styles.catRowName}>{cat}</span>
                                                    <div className={styles.catBar}>
                                                        <div className={styles.catBarFill} style={{ width: `${pct}%` }} />
                                                    </div>
                                                    <span className={styles.catRowCount}>{count}</span>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className={styles.panel}>
                                        <h2 className={styles.panelTitle}>Recent Orders</h2>
                                        {orders.length === 0 ? (
                                            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>No orders yet.</p>
                                        ) : orders.slice(0, 5).map(o => {
                                            const sc = getStatusConfig(o.status);
                                            return (
                                                <div key={o.id} className={styles.recentOrder}>
                                                    <div>
                                                        <p className={styles.orderId}>{o.id?.toString().slice(0, 12)}…</p>
                                                        <p className={styles.orderCust}>{o.customer_name || o.profiles?.full_name || 'Customer'}</p>
                                                    </div>
                                                    <div style={{ textAlign: 'right' }}>
                                                        <p style={{ color: 'var(--gold-dark)', fontWeight: 500, fontSize: 13 }}>{fmt(o.total)}</p>
                                                        <span className={styles.statusPill} style={{ background: sc.color + '22', color: sc.color }}>
                              {sc.icon} {sc.label}
                            </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Low stock alert */}
                                {lowStockCount > 0 && (
                                    <div className={styles.alertBox}>
                                        <span className={styles.alertIcon}>⚠️</span>
                                        <div>
                                            <strong>{lowStockCount} item{lowStockCount > 1 ? 's' : ''} running low on stock.</strong>
                                            <span style={{ marginLeft: '0.75rem', color: 'var(--text-muted)', fontSize: 12 }}>
                        {products.filter(p => p.stock < 5 && p.stock > 0).map(p => p.name).join(', ')}
                      </span>
                                        </div>
                                        <button className="btn btn-ghost btn-sm" onClick={() => setTab('products')}>View Products</button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* ═══════════ PRODUCTS ═══════════ */}
                {tab === 'products' && (
                    <div className="fade-in">
                        <div className={styles.pageHeader}>
                            <div>
                                <h1 className={styles.pageTitle}>Products</h1>
                                <p className={styles.pageDate}>
                                    {loadingProducts ? 'Loading…' : `${products.length} pieces in collection`}
                                </p>
                            </div>
                            <button className="btn btn-primary" onClick={() => setModal('add')}>
                                + Add Product
                            </button>
                        </div>

                        {/* Search */}
                        <div className={styles.tableSearch}>
                            <input
                                className={styles.tableSearchInput}
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search products by name, brand or category…"
                            />
                            {search && (
                                <button className={styles.clearSearch} onClick={() => setSearch('')}>✕</button>
                            )}
                        </div>

                        <div className={styles.tableWrap}>
                            <table className={styles.table}>
                                <thead>
                                <tr>
                                    <th>Product</th>
                                    <th>Category</th>
                                    <th>Price</th>
                                    <th>Stock</th>
                                    <th>Rating</th>
                                    <th>Actions</th>
                                </tr>
                                </thead>
                                <tbody>
                                {loadingProducts ? (
                                    <TableSkeleton rows={6} cols={6} />
                                ) : filteredProducts.length === 0 ? (
                                    <tr>
                                        <td colSpan={6}>
                                            <div className={styles.emptyState}>
                                                <div className={styles.emptyStateIcon}>💎</div>
                                                <p>No products found{search ? ` matching "${search}"` : ''}.</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filteredProducts.map(p => (
                                    <tr key={p.id}>
                                        <td>
                                            <div className={styles.productCell}>
                                                <div className={styles.productThumb}>
                                                    {p.image_url ? (
                                                        <img src={p.image_url} alt={p.name} className={styles.productThumbImg} />
                                                    ) : (
                                                        <span className={styles.productEmojiLarge}>{p.emoji || '💎'}</span>
                                                    )}
                                                    {p.image_url && <span className={styles.productEmojiSmall}>{p.emoji || '💎'}</span>}
                                                </div>
                                                <div>
                                                    <div className={styles.productName}>{p.name}</div>
                                                    <div className={styles.productBrand}>{p.brand}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <span className={styles.categoryPill}>{p.category}</span>
                                        </td>
                                        <td className={styles.priceCell}>{fmt(p.price)}</td>
                                        <td>
                        <span style={{ color: STOCK_COLOR(p.stock ?? 0), fontWeight: 500 }}>
                          {p.stock ?? 0}
                            {p.stock === 0 && ' (Out)'}
                            {p.stock > 0 && p.stock < 5 && ' (Low)'}
                        </span>
                                        </td>
                                        <td>
                                            {p.rating > 0 ? (
                                                <span className={styles.ratingCell}>★ {p.rating}</span>
                                            ) : '—'}
                                        </td>
                                        <td>
                                            <div className={styles.actionBtns}>
                                                <button className="btn btn-ghost btn-sm" onClick={() => setModal(p)}>Edit</button>
                                                <button className="btn btn-danger btn-sm" onClick={() => setDeleteConfirm(p)}>Delete</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ═══════════ ORDERS ═══════════ */}
                {tab === 'orders' && (
                    <div className="fade-in">
                        <div className={styles.pageHeader}>
                            <div>
                                <h1 className={styles.pageTitle}>Orders</h1>
                                <p className={styles.pageDate}>
                                    {loadingOrders ? 'Loading…' : `${orders.length} total orders · ${fmt(orders.reduce((s, o) => s + (o.total || 0), 0))} revenue`}
                                </p>
                            </div>
                        </div>

                        {loadingOrders ? (
                            <LuxuryLoader label="Loading Orders" />
                        ) : orders.length === 0 ? (
                            <div className={styles.emptyState}>
                                <div className={styles.emptyStateIcon}>📦</div>
                                <p>No orders yet. Orders will appear here after customers checkout.</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {orders.map(o => {
                                    const addr    = o.address || {};
                                    const name    = addr.full_name || o.customer_name || o.profiles?.full_name || 'Customer';
                                    const phone   = addr.phone || '—';
                                    const email   = addr.email || o.profiles?.email || '—';
                                    const addrStr = [addr.line1, addr.line2, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
                                    const sc      = getStatusConfig(o.status);
                                    return (
                                        <div key={o.id} className={styles.orderCard}>
                                            <div className={styles.orderCardTop}>
                                                <div>
                                                    <code className={styles.orderId}>{(o.id || '').toString().slice(0, 20)}</code>
                                                    <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                                                        {new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                                    <span className={styles.priceCell} style={{ fontSize: 16 }}>{fmt(o.total)}</span>
                                                    <span className={styles.statusPill} style={{ background: sc.color + '22', color: sc.color }}>
                            {sc.icon} {sc.label}
                          </span>
                                                    <select
                                                        className={styles.statusSelect}
                                                        value={o.status}
                                                        onChange={e => handleStatusChange(o.id, e.target.value)}
                                                        aria-label={`Change status for order ${o.id}`}
                                                    >
                                                        {ORDER_STATUSES.map(s => (
                                                            <option key={s} value={s}>{getStatusConfig(s).label}</option>
                                                        ))}
                                                    </select>
                                                    <button
                                                        className="btn btn-ghost btn-sm"
                                                        onClick={() => handleCopyTrackingLink(o)}
                                                        title="Copy customer-facing tracking link"
                                                    >
                                                        🔗 Copy Link
                                                    </button>
                                                </div>
                                            </div>

                                            <div className={styles.orderCardBody}>
                                                <div className={styles.orderSection}>
                                                    <div className={styles.orderSectionTitle}>👤 Customer</div>
                                                    <div className={styles.orderDetail}><strong>{name}</strong></div>
                                                    <div className={styles.orderDetail}>📞 {phone}</div>
                                                    <div className={styles.orderDetail}>✉️ {email}</div>
                                                </div>
                                                <div className={styles.orderSection}>
                                                    <div className={styles.orderSectionTitle}>📍 Delivery Address</div>
                                                    {addrStr ? (
                                                        <>
                                                            <div className={styles.orderDetail}>{addr.line1}{addr.line2 ? ', ' + addr.line2 : ''}</div>
                                                            <div className={styles.orderDetail}>{addr.city}, {addr.state}</div>
                                                            <div className={styles.orderDetail}>PIN: {addr.pincode} · {addr.country || 'India'}</div>
                                                        </>
                                                    ) : <div className={styles.orderDetail} style={{ color: 'var(--text-muted)' }}>No address saved</div>}
                                                </div>
                                                <div className={styles.orderSection}>
                                                    <div className={styles.orderSectionTitle}>💳 Payment</div>
                                                    <div className={styles.orderDetail}>Method: <strong>{o.payment_method || 'razorpay'}</strong></div>
                                                    {o.payment_id && <div className={styles.orderDetail} style={{ wordBreak: 'break-all' }}>ID: <code style={{ fontSize: 10 }}>{o.payment_id}</code></div>}
                                                    <div className={styles.orderDetail}>Subtotal: {fmt(o.subtotal)} + GST: {fmt(o.tax)}</div>
                                                    {o.discount_amount > 0 && (
                                                        <div className={styles.orderDetail} style={{ color: '#27AE60' }}>Coupon Discount: −{fmt(o.discount_amount)}</div>
                                                    )}
                                                    {o.wallet_amount_used > 0 && (
                                                        <div className={styles.orderDetail} style={{ color: '#27AE60' }}>Wallet Applied: −{fmt(o.wallet_amount_used)}</div>
                                                    )}
                                                    {o.tracking_number && (
                                                        <div className={styles.orderDetail} style={{ marginTop: 6 }}>
                                                            📦 {o.carrier || 'Courier'}: <code style={{ fontSize: 10 }}>{o.tracking_number}</code>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {o.order_items && o.order_items.length > 0 && (
                                                <div className={styles.orderItems}>
                                                    {o.order_items.map((item, idx) => (
                                                        <span key={idx} className={styles.orderItemChip}>
                              {item.products?.emoji || '💎'} {item.product_name || item.products?.name} ×{item.quantity} · {fmt(item.price * item.quantity)}
                            </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
                {/* ═══════════ WALLET & COUPONS ═══════════ */}
                {tab === 'wallet' && (
                    <div className="fade-in">
                        <div className={styles.pageHeader}>
                            <div>
                                <h1 className={styles.pageTitle}>Wallet &amp; Coupons</h1>
                                <p className={styles.pageDate}>
                                    {loadingWallet ? 'Loading…' : `${wallets.length} customer wallet${wallets.length !== 1 ? 's' : ''} · ${fmt(wallets.reduce((s, w) => s + Number(w.balance || 0), 0))} total balance`}
                                </p>
                            </div>
                            <div className={styles.headerActions}>
                                <button className="btn btn-outline" onClick={() => setGrantModal(true)}>+ Grant Credit</button>
                                <button className="btn btn-primary" onClick={() => setCouponModal(true)}>+ Issue Coupon</button>
                            </div>
                        </div>

                        {loadingWallet ? (
                            <LuxuryLoader label="Loading Wallet Data" />
                        ) : (
                            <>
                                {/* Stats */}
                                <div className={styles.statsGrid}>
                                    {[
                                        { num: fmt(wallets.reduce((s, w) => s + Number(w.balance || 0), 0)), label: 'Total Wallet Balance', icon: '💰' },
                                        { num: coupons.filter(c => c.status === 'active').length, label: 'Active Coupons', icon: '🎟' },
                                        { num: walletCredits.filter(c => c.status === 'active' && c.expiry_date && Math.ceil((new Date(c.expiry_date) - new Date()) / 86400000) <= 7).length, label: 'Credits Expiring Soon', icon: '⏳' },
                                        { num: coupons.filter(c => c.status === 'redeemed').length, label: 'Coupons Redeemed', icon: '✅' },
                                    ].map(s => (
                                        <div key={s.label} className={styles.statCard}>
                                            <div className={styles.statIcon}>{s.icon}</div>
                                            <div className={styles.statNum}>{s.num}</div>
                                            <div className={styles.statLabel}>{s.label}</div>
                                        </div>
                                    ))}
                                </div>

                                {/* Sub-tabs */}
                                <div className={styles.subTabs}>
                                    {[
                                        { key: 'wallets', label: `Customer Wallets (${wallets.length})` },
                                        { key: 'credits', label: `Credit History (${walletCredits.length})` },
                                        { key: 'coupons', label: `Coupons (${coupons.length})` },
                                    ].map(t => (
                                        <button
                                            key={t.key}
                                            className={`${styles.subTab} ${walletSubTab === t.key ? styles.subTabActive : ''}`}
                                            onClick={() => setWalletSubTab(t.key)}
                                        >
                                            {t.label}
                                        </button>
                                    ))}
                                </div>

                                {/* ── Customer Wallets ── */}
                                {walletSubTab === 'wallets' && (
                                    <div className={styles.tableWrap}>
                                        <table className={styles.table}>
                                            <thead>
                                            <tr>
                                                <th>Customer</th>
                                                <th>Balance</th>
                                                <th>Active Credits</th>
                                                <th>Actions</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {wallets.length === 0 ? (
                                                <tr><td colSpan={4}>
                                                    <div className={styles.emptyState}>
                                                        <div className={styles.emptyStateIcon}>💰</div>
                                                        <p>No customer wallets yet. Grant credit to a customer to get started.</p>
                                                    </div>
                                                </td></tr>
                                            ) : wallets.map(w => {
                                                const activeCount = walletCredits.filter(c => c.user_id === w.user_id && c.status === 'active').length;
                                                return (
                                                    <tr key={w.user_id}>
                                                        <td>
                                                            <div className={styles.customerCell}>
                                                                <span className={styles.customerName}>{w.profile?.full_name || 'Customer'}</span>
                                                                <span className={styles.customerEmail}>{w.profile?.email}</span>
                                                            </div>
                                                        </td>
                                                        <td className={styles.walletBalanceCell}>{fmt(w.balance)}</td>
                                                        <td>{activeCount}</td>
                                                        <td>
                                                            <div className={styles.actionBtns}>
                                                                <button className="btn btn-ghost btn-sm" onClick={() => setGrantModal({ customer: w.profile ? { id: w.user_id, ...w.profile } : null })}>
                                                                    Grant Credit
                                                                </button>
                                                                <button className="btn btn-ghost btn-sm" onClick={() => setCouponModal({ customer: w.profile ? { id: w.user_id, ...w.profile } : null })}>
                                                                    Issue Coupon
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {/* ── Credit History ── */}
                                {walletSubTab === 'credits' && (
                                    <div className={styles.tableWrap}>
                                        <table className={styles.table}>
                                            <thead>
                                            <tr>
                                                <th>Customer</th>
                                                <th>Granted</th>
                                                <th>Remaining</th>
                                                <th>Expiry</th>
                                                <th>Note</th>
                                                <th>Actions</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {walletCredits.length === 0 ? (
                                                <tr><td colSpan={6}>
                                                    <div className={styles.emptyState}>
                                                        <div className={styles.emptyStateIcon}>🎁</div>
                                                        <p>No wallet credit has been granted yet.</p>
                                                    </div>
                                                </td></tr>
                                            ) : walletCredits.map(c => {
                                                const badge = expiryBadge(c.expiry_date, c.status);
                                                return (
                                                    <tr key={c.id}>
                                                        <td>
                                                            <div className={styles.customerCell}>
                                                                <span className={styles.customerName}>{c.profile?.full_name || 'Customer'}</span>
                                                                <span className={styles.customerEmail}>{c.profile?.email}</span>
                                                            </div>
                                                        </td>
                                                        <td className={styles.priceCell}>{fmt(c.amount)}</td>
                                                        <td>{fmt(c.remaining_amount)}</td>
                                                        <td><span className={`${styles.badge} ${badge.cls}`}>{badge.label}</span></td>
                                                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{c.note || '—'}</td>
                                                        <td>
                                                            {c.status !== 'depleted' && (
                                                                <button
                                                                    className="btn btn-ghost btn-sm"
                                                                    onClick={() => setExtendTarget({ type: 'credit', id: c.id, currentExpiry: c.expiry_date, title: 'Extend Wallet Credit Expiry', subtitle: `${c.profile?.full_name || 'Customer'} · ${fmt(c.remaining_amount)} remaining` })}
                                                                >
                                                                    Extend
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {/* ── Coupons ── */}
                                {walletSubTab === 'coupons' && (
                                    <div className={styles.tableWrap}>
                                        <table className={styles.table}>
                                            <thead>
                                            <tr>
                                                <th>Code</th>
                                                <th>Customer</th>
                                                <th>Discount</th>
                                                <th>Min Order</th>
                                                <th>Expiry</th>
                                                <th>Actions</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {coupons.length === 0 ? (
                                                <tr><td colSpan={6}>
                                                    <div className={styles.emptyState}>
                                                        <div className={styles.emptyStateIcon}>🎟</div>
                                                        <p>No coupons issued yet.</p>
                                                    </div>
                                                </td></tr>
                                            ) : coupons.map(c => {
                                                const badge = expiryBadge(c.expiry_date, c.status);
                                                return (
                                                    <tr key={c.id}>
                                                        <td className={styles.couponCodeCell}>{c.code}</td>
                                                        <td>
                                                            {c.user_id === null ? (
                                                                <div className={styles.customerCell}>
                                                                    <span className={styles.customerName}>🌐 All Customers</span>
                                                                    <span className={styles.customerEmail}>Anyone can use this coupon</span>
                                                                </div>
                                                            ) : (
                                                                <div className={styles.customerCell}>
                                                                    <span className={styles.customerName}>{c.profile?.full_name || 'Customer'}</span>
                                                                    <span className={styles.customerEmail}>{c.profile?.email}</span>
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td>{c.discount_type === 'percentage' ? `${c.discount_value}%${c.max_discount ? ` (max ${fmt(c.max_discount)})` : ''}` : fmt(c.discount_value)}</td>
                                                        <td>{c.min_order_value > 0 ? fmt(c.min_order_value) : '—'}</td>
                                                        <td><span className={`${styles.badge} ${badge.cls}`}>{badge.label}</span></td>
                                                        <td>
                                                            <div className={styles.actionBtns}>
                                                                {(c.status === 'active' || c.status === 'expired') && (
                                                                    <button
                                                                        className="btn btn-ghost btn-sm"
                                                                        onClick={() => setExtendTarget({ type: 'coupon', id: c.id, currentExpiry: c.expiry_date, title: 'Extend Coupon Expiry', subtitle: `${c.code} · ${c.profile?.full_name || 'Customer'}` })}
                                                                    >
                                                                        Extend
                                                                    </button>
                                                                )}
                                                                {(c.status === 'active' || c.status === 'expired') && (
                                                                    <button className="btn btn-danger btn-sm" onClick={() => handleRevokeCoupon(c)}>Revoke</button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </main>

            {/* ── Product Modal ── */}
            {modal && (
                <ProductModal
                    product={modal !== 'add' ? modal : null}
                    onClose={() => setModal(null)}
                    onSave={handleSave}
                />
            )}

            {/* ── Delete Confirm Modal ── */}
            {deleteConfirm && (
                <div className={styles.deleteOverlay} onClick={() => setDeleteConfirm(null)}>
                    <div className={styles.deleteModal} onClick={e => e.stopPropagation()}>
                        <div className={styles.deleteIcon}>🗑</div>
                        <h3 className={styles.deleteTitle}>Remove Product</h3>
                        <p className={styles.deleteText}>
                            Are you sure you want to remove <strong>{deleteConfirm.name}</strong> from the collection?
                            This action cannot be undone.
                        </p>
                        <div className={styles.deleteActions}>
                            <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm.id)}>
                                Remove Product
                            </button>
                            <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Grant Wallet Credit Modal ── */}
            {grantModal && (
                <GrantCreditModal
                    customers={customers}
                    defaultCustomer={grantModal.customer || null}
                    onClose={() => setGrantModal(null)}
                    onSave={handleGrantCredit}
                />
            )}

            {/* ── Issue Coupon Modal ── */}
            {couponModal && (
                <IssueCouponModal
                    customers={customers}
                    defaultCustomer={couponModal.customer || null}
                    onClose={() => setCouponModal(null)}
                    onSave={handleIssueCoupon}
                />
            )}

            {/* ── Extend Expiry Modal (wallet credit or coupon) ── */}
            {extendTarget && (
                <ExtendExpiryModal
                    title={extendTarget.title}
                    subtitle={extendTarget.subtitle}
                    currentExpiry={extendTarget.currentExpiry}
                    onClose={() => setExtendTarget(null)}
                    onSave={handleExtendExpiry}
                />
            )}
        </div>
    );
}
