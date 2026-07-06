// src/pages/CheckoutPage.js
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useCart } from '../hooks/useCart';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../App';
import { placeOrder } from '../lib/orderService';
import { fetchWallet, previewCoupon, spendWalletForOrder, redeemCouponForOrder } from '../lib/walletService';
import styles from './CheckoutPage.module.css';

// ── Load Razorpay script ────────────────────────────────
function loadRazorpay() {
    return new Promise((resolve) => {
        if (window.Razorpay) { resolve(true); return; }
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.onload  = () => resolve(true);
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });
}

const INDIAN_STATES = [
    'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
    'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
    'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
    'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
    'Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh',
];

export default function CheckoutPage() {
    const { items, subtotal, tax, total, clearCart, totalItems } = useCart();
    const { user } = useAuth();
    const navigate  = useNavigate();
    const toast     = useToast();

    const [step, setStep]         = useState(1); // 1=address, 2=review, 3=done
    const [paying, setPaying]      = useState(false);
    const [orderId, setOrderId]    = useState(null);
    const [errors, setErrors]      = useState({});

    // ── Wallet & Coupon ──────────────────────────────────────
    const [walletBalance, setWalletBalance]     = useState(0);
    const [useWallet, setUseWallet]             = useState(false);
    const [walletApplyAmount, setWalletApplyAmount] = useState(0);
    const [couponCode, setCouponCode]           = useState('');
    const [couponApplied, setCouponApplied]     = useState(null); // { couponId, code, discountAmount }
    const [couponError, setCouponError]         = useState('');
    const [checkingCoupon, setCheckingCoupon]   = useState(false);

    useEffect(() => {
        if (!user) return;
        fetchWallet(user.id).then(w => setWalletBalance(w.balance)).catch(err => console.error('fetchWallet failed:', err));
    }, [user]);

    const discountAmount = couponApplied?.discountAmount || 0;
    const amountAfterDiscount = Math.max(0, total - discountAmount);
    const maxWalletUsable = Math.min(walletBalance, amountAfterDiscount);
    const walletUsed = useWallet ? Math.min(walletApplyAmount, maxWalletUsable) : 0;
    const grandTotal = Math.max(0, amountAfterDiscount - walletUsed);

    const handleToggleWallet = (checked) => {
        setUseWallet(checked);
        setWalletApplyAmount(checked ? maxWalletUsable : 0);
    };

    const handleApplyCoupon = async () => {
        if (!couponCode.trim()) return;
        setCheckingCoupon(true); setCouponError('');
        try {
            const result = await previewCoupon(couponCode.trim(), subtotal);
            setCouponApplied({ ...result, code: couponCode.trim().toUpperCase() });
            toast('Coupon applied!', 'success');
        } catch (err) {
            setCouponError(err.message || 'Invalid coupon code');
            setCouponApplied(null);
        } finally {
            setCheckingCoupon(false);
        }
    };

    const handleRemoveCoupon = () => {
        setCouponApplied(null);
        setCouponCode('');
        setCouponError('');
    };

    // After an order is successfully created, apply the wallet debit and
    // coupon redemption. These run after the order already exists so we
    // never charge/discount something that was never actually recorded.
    // If either fails (e.g. a balance changed in another tab in the same
    // instant), the order itself still stands — we surface a toast so it
    // can be reconciled rather than silently losing the discrepancy.
    const applyWalletAndCoupon = async (newOrderId) => {
        if (walletUsed > 0) {
            try {
                await spendWalletForOrder(user.id, walletUsed, newOrderId);
            } catch (err) {
                console.error('spendWalletForOrder failed:', err);
                toast(`Order placed, but wallet deduction failed: ${err.message}. Please contact support.`, 'error');
            }
        }
        if (couponApplied?.couponId) {
            try {
                await redeemCouponForOrder(couponApplied.couponId, newOrderId);
            } catch (err) {
                console.error('redeemCouponForOrder failed:', err);
                toast(`Order placed, but coupon redemption failed: ${err.message}. Please contact support.`, 'error');
            }
        }
    };

    const [address, setAddress] = useState({
        full_name:   user?.user_metadata?.full_name || '',
        phone:       '',
        email:       user?.email || '',
        line1:       '',
        line2:       '',
        city:        '',
        state:       '',
        pincode:     '',
        country:     'India',
    });

    useEffect(() => {
        if (!user)          { navigate('/login',  { state: { from: '/checkout' } }); return; }
        if (!totalItems)    { navigate('/cart'); }
    }, [user, totalItems, navigate]);

    const set = (field) => (e) => {
        setAddress(a => ({ ...a, [field]: e.target.value }));
        setErrors(er => ({ ...er, [field]: '' }));
    };

    // ── Validation ──────────────────────────────────────────
    const validate = () => {
        const e = {};
        if (!address.full_name.trim()) e.full_name  = 'Required';
        if (!address.phone.trim() || !/^\d{10}$/.test(address.phone.trim())) e.phone = 'Enter valid 10-digit mobile number';
        if (!address.email.trim())    e.email    = 'Required';
        if (!address.line1.trim())    e.line1    = 'Required';
        if (!address.city.trim())     e.city     = 'Required';
        if (!address.state)           e.state    = 'Required';
        if (!address.pincode.trim() || !/^\d{6}$/.test(address.pincode.trim())) e.pincode = 'Enter valid 6-digit pincode';
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    // ── Razorpay Payment ─────────────────────────────────────
    const handlePayment = async () => {
        if (!validate()) { toast('Please fill in all required fields correctly.', 'error'); return; }
        setPaying(true);

        const razorpayKey = process.env.REACT_APP_RAZORPAY_KEY_ID;

        // Fully covered by wallet + coupon — no payment gateway needed at all.
        if (grandTotal <= 0) {
            try {
                const order = await placeOrder({
                    userId: user.id, items, subtotal, tax, total: grandTotal,
                    address, paymentId: 'WALLET_COUPON_COVERED', paymentMethod: 'wallet',
                    walletAmountUsed: walletUsed,
                });
                await applyWalletAndCoupon(order.id);
                clearCart();
                setOrderId(order.id);
                setStep(3);
                toast('Order placed — fully covered by your wallet & coupon!', 'success');
            } catch (err) {
                toast(err.message || 'Order failed. Please try again.', 'error');
            } finally { setPaying(false); }
            return;
        }

        // If no Razorpay key — simulate payment (demo mode)
        if (!razorpayKey || razorpayKey === 'your_razorpay_key_id') {
            try {
                const order = await placeOrder({
                    userId:        user.id,
                    items,
                    subtotal,
                    tax,
                    total: grandTotal,
                    address,
                    paymentId:     'DEMO_PAY_' + Date.now(),
                    paymentMethod: 'demo',
                    walletAmountUsed: walletUsed,
                });
                await applyWalletAndCoupon(order.id);
                clearCart();
                setOrderId(order.id);
                setStep(3);
                toast('Order placed successfully! (Demo mode)', 'success');
            } catch (err) {
                toast(err.message || 'Order failed. Please try again.', 'error');
            } finally { setPaying(false); }
            return;
        }

        // Load Razorpay
        const loaded = await loadRazorpay();
        if (!loaded) { toast('Payment gateway failed to load. Please try again.', 'error'); setPaying(false); return; }

        const options = {
            key:          razorpayKey,
            amount:       Math.round(grandTotal) * 100, // in paise — after coupon/wallet reductions
            currency:     'INR',
            name:         'AURUM Luxury Boutique',
            description:  `Order of ${totalItems} item${totalItems > 1 ? 's' : ''}`,
            image:        '',   // add your logo URL here
            prefill: {
                name:    address.full_name,
                email:   address.email,
                contact: address.phone,
            },
            notes: {
                address: `${address.line1}, ${address.city}, ${address.state} - ${address.pincode}`,
            },
            theme: { color: '#C9A84C' },
            handler: async (response) => {
                // Payment successful — save order to Supabase
                try {
                    const order = await placeOrder({
                        userId:        user.id,
                        items,
                        subtotal,
                        tax,
                        total: grandTotal,
                        address,
                        paymentId:     response.razorpay_payment_id,
                        paymentMethod: 'razorpay',
                        walletAmountUsed: walletUsed,
                    });
                    await applyWalletAndCoupon(order.id);
                    clearCart();
                    setOrderId(order.id);
                    setStep(3);
                    toast('Payment successful! Order confirmed.', 'success');
                } catch (err) {
                    toast('Payment done but order save failed. Contact support.', 'error');
                } finally { setPaying(false); }
            },
            modal: {
                ondismiss: () => { setPaying(false); toast('Payment cancelled.', ''); }
            },
        };

        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', (response) => {
            toast('Payment failed: ' + (response.error?.description || 'Unknown error'), 'error');
            setPaying(false);
        });
        rzp.open();
    };

    const fmt = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

    // ── Step 3: Success ───────────────────────────────────────
    if (step === 3) return (
        <main className={styles.page}>
            <div className={styles.successCard}>
                <div className={styles.successIcon}>✦</div>
                <h1 className={styles.successTitle}>Order Confirmed</h1>
                <div className="divider-gold" />
                <p className={styles.successText}>
                    Thank you, {address.full_name}. Your order has been placed and will be delivered to:
                </p>
                <div className={styles.addressSummary}>
                    <p>{address.line1}{address.line2 ? ', ' + address.line2 : ''}</p>
                    <p>{address.city}, {address.state} — {address.pincode}</p>
                    <p>{address.country}</p>
                </div>
                <p className={styles.orderRef}>
                    Order Reference: <code>{orderId?.toString().slice(0, 20)}</code>
                </p>
                <p className={styles.confirmEmail}>A confirmation has been sent to <strong>{address.email}</strong></p>
                <div className={styles.successActions}>
                    <Link to="/my-orders" className="btn btn-primary">Track My Order</Link>
                    <Link to="/shop" className="btn btn-outline">Continue Shopping</Link>
                </div>
            </div>
        </main>
    );

    return (
        <main className={`${styles.page} fade-in`}>
            <div className="container section">

                {/* ── Progress Bar ── */}
                <div className={styles.progress}>
                    {['Delivery Address', 'Review & Pay'].map((label, i) => (
                        <React.Fragment key={label}>
                            <div className={`${styles.progressStep} ${step > i + 1 ? styles.done : step === i + 1 ? styles.active : ''}`}>
                                <div className={styles.progressDot}>{step > i + 1 ? '✓' : i + 1}</div>
                                <span className={styles.progressLabel}>{label}</span>
                            </div>
                            {i === 0 && <div className={`${styles.progressLine} ${step > 1 ? styles.progressLineDone : ''}`} />}
                        </React.Fragment>
                    ))}
                </div>

                <div className={styles.layout}>
                    {/* ── LEFT: Form / Review ── */}
                    <div className={styles.left}>

                        {/* STEP 1: Address */}
                        {step === 1 && (
                            <div className={`${styles.card} slide-up`}>
                                <h2 className={styles.cardTitle}>Delivery Address</h2>
                                <div className="divider-gold" />

                                <div className={styles.formGrid2}>
                                    <div className="form-group">
                                        <label className="form-label">Full Name *</label>
                                        <input className={`form-input ${errors.full_name ? 'error' : ''}`} value={address.full_name} onChange={set('full_name')} placeholder="As on government ID" />
                                        {errors.full_name && <p className="form-error">{errors.full_name}</p>}
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Mobile Number *</label>
                                        <input className={`form-input ${errors.phone ? 'error' : ''}`} value={address.phone} onChange={set('phone')} placeholder="10-digit mobile" maxLength={10} />
                                        {errors.phone && <p className="form-error">{errors.phone}</p>}
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Email Address *</label>
                                    <input className={`form-input ${errors.email ? 'error' : ''}`} type="email" value={address.email} onChange={set('email')} placeholder="For order confirmation" />
                                    {errors.email && <p className="form-error">{errors.email}</p>}
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Address Line 1 *</label>
                                    <input className={`form-input ${errors.line1 ? 'error' : ''}`} value={address.line1} onChange={set('line1')} placeholder="House / Flat / Building number & Street" />
                                    {errors.line1 && <p className="form-error">{errors.line1}</p>}
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Address Line 2</label>
                                    <input className="form-input" value={address.line2} onChange={set('line2')} placeholder="Landmark, Area (optional)" />
                                </div>

                                <div className={styles.formGrid3}>
                                    <div className="form-group">
                                        <label className="form-label">City *</label>
                                        <input className={`form-input ${errors.city ? 'error' : ''}`} value={address.city} onChange={set('city')} placeholder="City" />
                                        {errors.city && <p className="form-error">{errors.city}</p>}
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">State *</label>
                                        <select className={`form-input form-select ${errors.state ? 'error' : ''}`} value={address.state} onChange={set('state')}>
                                            <option value="">Select State</option>
                                            {INDIAN_STATES.map(s => <option key={s}>{s}</option>)}
                                        </select>
                                        {errors.state && <p className="form-error">{errors.state}</p>}
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">PIN Code *</label>
                                        <input className={`form-input ${errors.pincode ? 'error' : ''}`} value={address.pincode} onChange={set('pincode')} placeholder="6-digit PIN" maxLength={6} />
                                        {errors.pincode && <p className="form-error">{errors.pincode}</p>}
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Country</label>
                                    <input className="form-input" value={address.country} readOnly style={{opacity:0.6}} />
                                </div>

                                <button className="btn btn-primary" onClick={() => { if(validate()) setStep(2); }} style={{width:'100%', padding:'14px', marginTop:'0.5rem'}}>
                                    Continue to Review →
                                </button>
                            </div>
                        )}

                        {/* STEP 2: Review */}
                        {step === 2 && (
                            <div className={`${styles.card} slide-up`}>
                                <div className={styles.cardTitleRow}>
                                    <h2 className={styles.cardTitle}>Review Order</h2>
                                    <button className="btn btn-ghost btn-sm" onClick={() => setStep(1)}>← Edit Address</button>
                                </div>
                                <div className="divider-gold" />

                                {/* Address Preview */}
                                <div className={styles.addressPreview}>
                                    <div className={styles.addressPreviewIcon}>📍</div>
                                    <div>
                                        <p className={styles.addressPreviewName}>{address.full_name} · {address.phone}</p>
                                        <p className={styles.addressPreviewText}>
                                            {address.line1}{address.line2 ? ', ' + address.line2 : ''}, {address.city}, {address.state} — {address.pincode}
                                        </p>
                                    </div>
                                </div>

                                <div className="divider" />

                                {/* Items */}
                                <h3 className={styles.itemsTitle}>Items ({totalItems})</h3>
                                {items.map(item => (
                                    <div key={item.id} className={styles.reviewItem}>
                                        <div className={styles.reviewItemImg}>{item.emoji || '💎'}</div>
                                        <div className={styles.reviewItemInfo}>
                                            <p className={styles.reviewItemBrand}>{item.brand}</p>
                                            <p className={styles.reviewItemName}>{item.name}</p>
                                            <p className={styles.reviewItemQty}>Qty: {item.qty}</p>
                                        </div>
                                        <div className={styles.reviewItemPrice}>{fmt(item.price * item.qty)}</div>
                                    </div>
                                ))}

                                <div className="divider" />

                                {/* Coupon */}
                                <h3 className={styles.itemsTitle}>Have a Coupon?</h3>
                                {couponApplied ? (
                                    <div className="msg msg-success" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span>🎟 <strong>{couponApplied.code}</strong> applied — {fmt(couponApplied.discountAmount)} off</span>
                                        <button className="btn btn-ghost btn-sm" onClick={handleRemoveCoupon}>Remove</button>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                                        <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                                            <input
                                                className={`form-input ${couponError ? 'error' : ''}`}
                                                value={couponCode}
                                                onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponError(''); }}
                                                placeholder="Enter coupon code"
                                            />
                                            {couponError && <p className="form-error">{couponError}</p>}
                                        </div>
                                        <button className="btn btn-outline btn-sm" onClick={handleApplyCoupon} disabled={checkingCoupon || !couponCode.trim()}>
                                            {checkingCoupon ? 'Checking…' : 'Apply'}
                                        </button>
                                    </div>
                                )}

                                {/* Wallet */}
                                {walletBalance > 0 && (
                                    <>
                                        <div className="divider" />
                                        <h3 className={styles.itemsTitle}>Use Wallet Balance</h3>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: useWallet ? '0.75rem' : 0 }}>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                                                <input type="checkbox" checked={useWallet} onChange={e => handleToggleWallet(e.target.checked)} />
                                                Apply from wallet — {fmt(walletBalance)} available
                                            </label>
                                        </div>
                                        {useWallet && (
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <input
                                                    className="form-input"
                                                    type="number"
                                                    min="0"
                                                    max={maxWalletUsable}
                                                    value={walletApplyAmount}
                                                    onChange={e => setWalletApplyAmount(Math.max(0, Math.min(Number(e.target.value) || 0, maxWalletUsable)))}
                                                />
                                                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                                                    Up to {fmt(maxWalletUsable)} can be applied to this order.
                                                </p>
                                            </div>
                                        )}
                                    </>
                                )}

                                <div className="divider" />

                                {/* Payment Methods */}
                                <h3 className={styles.itemsTitle}>Payment Method</h3>
                                {grandTotal <= 0 ? (
                                    <div className="msg msg-success">
                                        ✓ Fully covered by your wallet &amp; coupon — no payment needed.
                                    </div>
                                ) : (
                                    <div className={styles.paymentMethods}>
                                        <div className={styles.paymentMethod}>
                                            <div className={styles.paymentMethodIcon}>💳</div>
                                            <div>
                                                <p className={styles.paymentMethodName}>Razorpay Secure Checkout</p>
                                                <p className={styles.paymentMethodSub}>Credit / Debit Card · UPI · Net Banking · Wallets</p>
                                            </div>
                                            <div className={styles.paymentMethodCheck}>✓</div>
                                        </div>
                                    </div>
                                )}

                                <div className={styles.secureNote}>
                                    🔒 Payments secured by Razorpay · PCI-DSS Compliant · 256-bit SSL
                                </div>

                                <button
                                    className="btn btn-razorpay"
                                    onClick={handlePayment}
                                    disabled={paying}
                                    style={{width:'100%', padding:'16px', marginTop:'1.5rem', fontSize:'13px', letterSpacing:'3px'}}
                                >
                                    {paying ? 'Processing…' : grandTotal <= 0 ? 'Place Order — No Payment Needed' : `Pay ${fmt(grandTotal)} Securely`}
                                </button>

                                <p className={styles.demoNote}>
                                    No Razorpay key set? Add <code>REACT_APP_RAZORPAY_KEY_ID</code> to <code>.env</code> — otherwise demo mode is used.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* ── RIGHT: Order Summary ── */}
                    <aside className={styles.summary}>
                        <div className={styles.summaryInner}>
                            <h2 className={styles.summaryTitle}>Order Summary</h2>

                            <div className={styles.summaryItems}>
                                {items.map(item => (
                                    <div key={item.id} className={styles.summaryItem}>
                                        <span className={styles.summaryEmoji}>{item.emoji}</span>
                                        <span className={styles.summaryItemName}>{item.name} <span className={styles.summaryQty}>×{item.qty}</span></span>
                                        <span className={styles.summaryItemPrice}>{fmt(item.price * item.qty)}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="divider" style={{margin:'1rem 0'}} />

                            <div className={styles.summaryRow}><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
                            <div className={styles.summaryRow}><span>GST (18%)</span><span>{fmt(tax)}</span></div>
                            <div className={styles.summaryRow}><span>Insured Delivery</span><span className={styles.free}>Complimentary</span></div>
                            {discountAmount > 0 && (
                                <div className={styles.summaryRow}><span>Coupon Discount</span><span className={styles.free}>−{fmt(discountAmount)}</span></div>
                            )}
                            {walletUsed > 0 && (
                                <div className={styles.summaryRow}><span>Wallet Applied</span><span className={styles.free}>−{fmt(walletUsed)}</span></div>
                            )}

                            <div className={`${styles.summaryRow} ${styles.summaryTotal}`}>
                                <span>Total to Pay</span>
                                <span>{fmt(grandTotal)}</span>
                            </div>

                            <div className={styles.trustBadges}>
                                <div className={styles.trustBadge}><span>🏛</span> Authenticated</div>
                                <div className={styles.trustBadge}><span>📦</span> Insured</div>
                                <div className={styles.trustBadge}><span>🔒</span> Secure</div>
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        </main>
    );
}
