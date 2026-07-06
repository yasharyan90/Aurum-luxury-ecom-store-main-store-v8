// src/lib/orderService.js
import { supabase } from './supabase';
import { MOCK_ORDERS } from './mockData';
import { sendOrderConfirmationEmail, sendOrderStatusEmail } from './emailService';

const isConfigured = () =>
    process.env.REACT_APP_SUPABASE_URL &&
    !process.env.REACT_APP_SUPABASE_URL.includes('placeholder');

// ── Place a new order ─────────────────────────────────────────
export async function placeOrder({ userId, items, subtotal, tax, total, address, paymentId, paymentMethod, walletAmountUsed = 0 }) {
    const orderData = {
        user_id:        userId,
        status:         'paid',
        subtotal,
        tax,
        total,
        address,
        payment_id:     paymentId || null,
        payment_method: paymentMethod || 'razorpay',
        wallet_amount_used: walletAmountUsed || 0,
    };

    let order;

    if (!isConfigured()) {
        // Demo mode
        order = {
            ...orderData,
            id:            'ORD-' + Date.now(),
            created_at:    new Date().toISOString(),
            customer_name: address?.full_name || 'Customer',
            order_items:   items.map(item => ({
                product_name: item.name,
                price:        item.price,
                quantity:     item.qty,
                emoji:        item.emoji,
                products:     { name: item.name, emoji: item.emoji },
            })),
        };
        MOCK_ORDERS.unshift(order);
    } else {
        // Real Supabase
        const { data: newOrder, error: orderError } = await supabase
            .from('orders')
            .insert([orderData])
            .select()
            .single();
        if (orderError) throw orderError;

        const orderItems = items.map(item => ({
            order_id:     newOrder.id,
            product_id:   item.id,
            product_name: item.name,
            price:        item.price,
            quantity:     item.qty,
        }));
        const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
        if (itemsError) throw itemsError;

        order = { ...newOrder, order_items: orderItems };
    }

    // ── Send confirmation email (non-blocking) ──────────────
    sendOrderConfirmationEmail({ order, items: order.order_items || items.map(i => ({ ...i, quantity: i.qty })), address })
        .catch(err => console.warn('Email send skipped:', err));

    return order;
}

// ── Fetch orders for a specific user ─────────────────────────
export async function fetchUserOrders(userId) {
    if (!isConfigured()) {
        return MOCK_ORDERS.filter(o => o.user_id === userId || true).slice(0, 5); // demo: show all
    }
    try {
        const { data, error } = await supabase
            .from('orders')
            .select(`
        *,
        order_items (
          id, product_name, price, quantity,
          products ( name, emoji, brand, category )
        )
      `)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('fetchUserOrders error:', err);
        return [];
    }
}

// ── Fetch all orders (owner) ──────────────────────────────────
export async function fetchOrders(userId = null) {
    if (!isConfigured()) return MOCK_ORDERS;

    // NOTE: we deliberately do NOT embed `profiles:user_id (...)` in this
    // query. Embedding requires PostgREST to see a real foreign-key
    // relationship from orders.user_id -> profiles.id in its schema cache.
    // If that FK is missing (or PostgREST hasn't reloaded its cache), the
    // ENTIRE query fails with a "Could not find a relationship" error —
    // which used to be silently swallowed below and replaced with demo
    // data. order_items -> products embedding is fine (proven working on
    // the customer side in fetchUserOrders), so we keep that.
    let query = supabase
        .from('orders')
        .select(`
      *,
      order_items (*, products (name, emoji))
    `)
        .order('created_at', { ascending: false });
    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query;
    if (error) {
        // Surface the real error instead of masking it with demo data.
        console.error('[fetchOrders] Supabase error:', error);
        throw new Error(error.message || 'Failed to load orders from Supabase');
    }

    const orders = data || [];
    if (orders.length === 0) return orders;

    // Fetch matching profiles separately (own query, no embedding needed)
    // so a missing FK / relationship-cache issue can never take down the
    // whole orders list.
    const userIds = [...new Set(orders.map(o => o.user_id).filter(Boolean))];
    let profilesById = {};
    if (userIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .in('id', userIds);
        if (profilesError) {
            // Don't fail the whole order list just because profile lookup
            // failed (e.g. RLS not yet updated) — just log it.
            console.warn('[fetchOrders] Could not load profiles:', profilesError);
        } else {
            profilesById = Object.fromEntries((profiles || []).map(p => [p.id, p]));
        }
    }

    return orders.map(o => ({ ...o, profiles: profilesById[o.user_id] || null }));
}

// ── Update order status (owner) ───────────────────────────────
export async function updateOrderStatus(orderId, status) {
    let updatedOrder;

    if (!isConfigured()) {
        // Demo mode — update in-memory
        const order = MOCK_ORDERS.find(o => o.id === orderId);
        if (order) {
            order.status = status;
            order.status_updated_at = new Date().toISOString();
        }
        updatedOrder = order;
    } else {
        // Real Supabase — update only the status column
        const { data, error } = await supabase
            .from('orders')
            .update({ status, status_updated_at: new Date().toISOString() })
            .eq('id', orderId)
            .select('*')
            .single();

        // Surface the real error message — never silently swallow it
        if (error) {
            console.error('[updateOrderStatus] Supabase error:', error);
            throw new Error(error.message || JSON.stringify(error));
        }
        updatedOrder = data;
    }

    // Send status email non-blocking — never let it fail the update
    if (updatedOrder?.address) {
        sendOrderStatusEmail({
            order:     updatedOrder,
            address:   updatedOrder.address,
            newStatus: status,
        }).catch(err => console.warn('Status email skipped:', err));
    }

    return updatedOrder;
}

// ── Public order tracking lookup (no auth required) ──────────
// Customer enters Order ID + the email used at checkout.
// Backed by a SECURITY DEFINER Supabase function so it can only
// ever return the single matching order — never the full table.
export async function trackOrder(orderId, email) {
    if (!isConfigured()) {
        const order = MOCK_ORDERS.find(o =>
            o.id === orderId &&
            (o.address?.email || '').toLowerCase() === email.toLowerCase()
        );
        if (!order) return null;
        return {
            ...order,
            tracking_number:    order.tracking_number    || null,
            carrier:             order.carrier             || null,
            estimated_delivery:  order.estimated_delivery  || null,
            status_updated_at:   order.status_updated_at   || order.created_at,
        };
    }

    try {
        const { data, error } = await supabase.rpc('track_order', {
            p_order_id: orderId,
            p_email:    email,
        });
        if (error) throw error;
        if (!data || data.length === 0) return null;

        const order = data[0];

        const { data: items } = await supabase.rpc('track_order_items', {
            p_order_id: orderId,
            p_email:    email,
        });

        return { ...order, order_items: items || [] };
    } catch (err) {
        console.error('trackOrder error:', err);
        throw new Error('Could not find an order matching that ID and email.');
    }
}

// ── Subscribe to live status changes for a user's orders ─────
// Returns an unsubscribe function. Used by MyOrdersPage so the
// status badge updates the instant the owner changes it — no
// manual refresh needed.
export function subscribeToOrderUpdates(userId, onUpdate) {
    if (!isConfigured() || !userId) return () => {};

    const channel = supabase
        .channel(`orders-user-${userId}`)
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'orders', filter: `user_id=eq.${userId}` },
            (payload) => onUpdate(payload.new)
        )
        .subscribe();

    return () => supabase.removeChannel(channel);
}
