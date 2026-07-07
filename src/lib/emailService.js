// src/lib/emailService.js
// ─────────────────────────────────────────────────────────────
//  Automated email notifications via Supabase Edge Functions
//  OR EmailJS (client-side, no backend needed)
//
//  Setup options (choose ONE):
//  A) EmailJS  — works instantly, no backend (recommended for beginners)
//  B) Supabase Edge Function — more professional, runs server-side
//  C) Demo mode — logs to console (works with no setup)
// ─────────────────────────────────────────────────────────────

// ── Config ──────────────────────────────────────────────────
const EMAILJS_SERVICE_ID  = process.env.REACT_APP_EMAILJS_SERVICE_ID  || '';
const EMAILJS_TEMPLATE_ID = process.env.REACT_APP_EMAILJS_TEMPLATE_ID || '';
const EMAILJS_STATUS_TEMPLATE_ID = process.env.REACT_APP_EMAILJS_STATUS_TEMPLATE_ID || 'template_status_update';
const EMAILJS_PUBLIC_KEY  = process.env.REACT_APP_EMAILJS_PUBLIC_KEY  || '';

const useEmailJS = EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID && EMAILJS_PUBLIC_KEY;

// Lets the UI be honest about whether an email will actually be sent,
// instead of always claiming success even in demo/console-only mode.
export function isEmailConfigured() {
    return !!useEmailJS;
}

// ── Load EmailJS SDK lazily ──────────────────────────────────
let emailjsLoaded = false;
async function loadEmailJS() {
    if (emailjsLoaded || window.emailjs) { emailjsLoaded = true; return true; }
    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
        script.onload = () => {
            window.emailjs.init(EMAILJS_PUBLIC_KEY);
            emailjsLoaded = true;
            resolve(true);
        };
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });
}

// ── Format helpers ───────────────────────────────────────────
const fmt = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

function buildItemsHTML(items = []) {
    return items.map(item =>
        `• ${item.emoji || '💎'} ${item.product_name || item.name} × ${item.quantity || item.qty} — ${fmt((item.price) * (item.quantity || item.qty))}`
    ).join('\n');
}

function buildItemsHTMLTable(items = []) {
    return items.map(item =>
        `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #E2DAC8">${item.emoji || '💎'} ${item.product_name || item.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E2DAC8;text-align:center">${item.quantity || item.qty}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E2DAC8;text-align:right;color:#9B7D2F">${fmt(item.price * (item.quantity || item.qty))}</td>
    </tr>`
    ).join('');
}

// ── Main email sender ────────────────────────────────────────
export async function sendOrderConfirmationEmail({ order, items, address }) {
    const customerName  = address?.full_name  || 'Valued Customer';
    const customerEmail = address?.email      || '';
    const orderId       = (order.id || '').toString().slice(0, 20);
    const addrLine      = [address?.line1, address?.line2, address?.city, address?.state, address?.pincode]
        .filter(Boolean).join(', ');
    const trackingUrl   = `${window.location.origin}/track-order?orderId=${order.id}&email=${encodeURIComponent(customerEmail)}`;

    // ── Option A: EmailJS ──────────────────────────────────────
    if (useEmailJS) {
        try {
            const loaded = await loadEmailJS();
            if (!loaded) throw new Error('EmailJS SDK failed to load');

            const templateParams = {
                to_name:      customerName,
                to_email:     customerEmail,
                order_id:     orderId,
                order_date:   new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
                items_text:   buildItemsHTMLTable(items),
                subtotal:     fmt(order.subtotal),
                tax:          fmt(order.tax),
                total:        fmt(order.total),
                address:      addrLine,
                payment_id:   order.payment_id || 'N/A',
                payment_method: order.payment_method || 'razorpay',
                tracking_url: trackingUrl,
                store_name:   'AURUM Luxury Boutique',
                store_email:  'noreply@aurum.com',
            };

            await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams);
            console.log('✅ Order confirmation email sent via EmailJS to', customerEmail);
            return { success: true, method: 'emailjs' };
        } catch (err) {
            console.error('EmailJS send failed:', err);
            // Fall through to demo mode
        }
    }

    // ── Option B: Supabase Edge Function ─────────────────────
    // Uncomment if you have set up the Edge Function (see supabase/functions/send-email/)
    /*
    try {
      const { supabase } = await import('./supabase');
      const { error } = await supabase.functions.invoke('send-email', {
        body: { order, items, address },
      });
      if (!error) return { success: true, method: 'edge-function' };
    } catch (err) {
      console.error('Edge function email failed:', err);
    }
    */

    // ── Option C: Demo / Console mode ─────────────────────────
    console.group('📧 ORDER CONFIRMATION EMAIL (Demo Mode)');
    console.log('To:     ', customerEmail);
    console.log('Subject:', `✦ AURUM Order Confirmed — ${orderId}`);
    console.log('---');
    console.log(`Dear ${customerName},`);
    console.log(`\nYour order has been confirmed and payment received.`);
    console.log(`\nOrder ID: ${orderId}`);
    console.log(`Date:     ${new Date().toLocaleDateString('en-IN')}`);
    console.log(`\nItems:\n${buildItemsHTML(items)}`);
    console.log(`\nSubtotal: ${fmt(order.subtotal)}`);
    console.log(`GST:      ${fmt(order.tax)}`);
    console.log(`Total:    ${fmt(order.total)}`);
    console.log(`\nDelivery Address:\n${addrLine}`);
    console.log(`\nPayment ID: ${order.payment_id || 'N/A'}`);
    console.log(`\nTrack your order: ${trackingUrl}`);
    console.log('\n— AURUM Luxury Boutique');
    console.groupEnd();

    return { success: true, method: 'demo' };
}

// ── Order status update email ────────────────────────────────
export async function sendOrderStatusEmail({ order, address, newStatus }) {
    const customerName  = address?.full_name || 'Valued Customer';
    const customerEmail = address?.email     || '';
    const orderId       = (order.id || '').toString().slice(0, 20);
    const trackingUrl   = `${window.location.origin}/track-order?orderId=${order.id}&email=${encodeURIComponent(customerEmail)}`;

    const statusMessages = {
        processing: { subject: 'Your AURUM order is being prepared', msg: 'Our team is carefully preparing your order for dispatch.' },
        shipped:    { subject: 'Your AURUM order has been shipped ✈️', msg: 'Your order is on its way! Expect delivery within 3-5 business days.' },
        delivered:  { subject: 'Your AURUM order has been delivered 🎁', msg: 'Your order has been delivered. We hope you love your new piece.' },
        cancelled:  { subject: 'Your AURUM order has been cancelled', msg: 'Your order has been cancelled. Any payment will be refunded in 5-7 business days.' },
    };

    const info = statusMessages[newStatus] || { subject: `Order ${newStatus}`, msg: `Your order status has been updated to ${newStatus}.` };

    if (useEmailJS) {
        try {
            const loaded = await loadEmailJS();
            if (loaded) {
                await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_STATUS_TEMPLATE_ID, {
                    to_name:    customerName,
                    to_email:   customerEmail,
                    order_id:   orderId,
                    new_status: newStatus.toUpperCase(),
                    status_message: info.msg,
                    tracking_url: trackingUrl,
                    store_name: 'AURUM Luxury Boutique',
                });
                console.log('✅ Status update email sent to', customerEmail);
                return { success: true, method: 'emailjs' };
            }
        } catch (err) { console.error('Status email failed:', err); }
    }

    console.log(`📧 STATUS EMAIL (demo): ${info.subject} → ${customerEmail}`);
    console.log(`   Track at: ${trackingUrl}`);
    return { success: true, method: 'demo' };
}