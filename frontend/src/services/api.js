// Thin compatibility shim — pages that still import api call these Supabase-backed functions.
// New code should import from ./db.js directly.
import { supabase } from '../lib/supabase'

function buildQuery(table, params = {}) {
  const { category, search, minPrice, maxPrice, sort, limit } = params

  let q = supabase.from(table).select('*')

  if (category) {
    const catName = category.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    q = q.ilike('category', catName)
  }
  if (search) q = q.ilike('name', `%${search}%`)
  if (minPrice) q = q.gte('price', parseFloat(minPrice))
  if (maxPrice) q = q.lte('price', parseFloat(maxPrice))
  if (limit) q = q.limit(parseInt(limit))

  if (sort === 'price_asc') q = q.order('price', { ascending: true })
  else if (sort === 'price_desc') q = q.order('price', { ascending: false })
  else q = q.order('created_at', { ascending: false })

  return q
}

function parseUrl(url) {
  const [path, qs] = url.split('?')
  const parts = path.replace(/^\//, '').split('/')
  const params = Object.fromEntries(new URLSearchParams(qs))
  return { parts, params }
}

const api = {
  async get(url) {
    const { parts, params } = parseUrl(url)
    const resource = parts[0]
    const id = parts[1]

    if (resource === 'products') {
      if (id) {
        const { data, error } = await supabase.from('products').select('*').eq('id', id).single()
        if (error) throw error
        return { data: { ...data, _id: data.id } }
      }
      const { data, error } = await buildQuery('products', params)
      if (error) throw error
      return { data: data.map(p => ({ ...p, _id: p.id })) }
    }

    if (resource === 'categories') {
      const { data, error } = await supabase.from('products').select('category')
      if (error) throw error
      const cats = [...new Set(data.map(p => p.category))].sort()
      return { data: cats }
    }

    if (resource === 'orders') {
      const { data: { user } } = await supabase.auth.getUser()
      if (parts[1] === 'myorders' || parts[1] === 'my') {
        const { data, error } = await supabase.from('orders')
          .select('*').eq('customer_id', user.id).order('created_at', { ascending: false })
        if (error) throw error
        // Normalize for MyOrders page (_id → id)
        return { data: data.map(o => ({ ...o, _id: o.id, totalAmount: o.total_amount, createdAt: o.created_at })) }
      }
      const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return { data: data.map(o => ({ ...o, _id: o.id, totalAmount: o.total_amount, createdAt: o.created_at })) }
    }

    if (resource === 'customers') {
      if (parts[1] === 'wishlist') {
        const { data: { user } } = await supabase.auth.getUser()
        const { data, error } = await supabase.from('wishlists')
          .select('product_id, products(*)').eq('customer_id', user.id)
        if (error) throw error
        return { data: data.map(w => ({ ...w.products, _id: w.products.id })) }
      }
      const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return { data }
    }

    if (resource === 'reviews') {
      const productId = parts[1]
      const { data, error } = await supabase.from('reviews')
        .select('*').eq('product_id', productId).order('created_at', { ascending: false })
      if (error) throw error
      return { data }
    }

    if (resource === 'coupons') {
      const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return { data }
    }

    throw new Error(`api.get: unhandled route ${url}`)
  },

  async post(url, body = {}) {
    const { parts } = parseUrl(url)
    const resource = parts[0]

    if (resource === 'orders') {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase.from('orders').insert({
        customer_id: user.id,
        items: body.items,
        shipping_address: body.shippingAddress,
        total_amount: body.totalAmount,
        coupon_code: body.couponCode || null,
      }).select().single()
      if (error) throw error
      return { data }
    }

    if (resource === 'customers' && parts[1] === 'wishlist') {
      const productId = parts[2]
      const { data: { user } } = await supabase.auth.getUser()
      const { data: existing } = await supabase.from('wishlists')
        .select('id').eq('customer_id', user.id).eq('product_id', productId).maybeSingle()
      if (existing) {
        await supabase.from('wishlists').delete().eq('id', existing.id)
        return { data: { removed: true } }
      }
      const { data, error } = await supabase.from('wishlists').insert({ customer_id: user.id, product_id: productId })
      if (error) throw error
      return { data }
    }

    if (resource === 'coupons' && parts[1] === 'validate') {
      const { data, error } = await supabase.from('coupons')
        .select('*').eq('code', body.code.toUpperCase()).eq('active', true).maybeSingle()
      if (error || !data) throw new Error('Invalid or expired coupon')
      if (data.expires_at && new Date(data.expires_at) < new Date()) throw new Error('Coupon expired')
      return { data: { ...data, discountPercentage: data.discount_value } }
    }

    if (resource === 'products') {
      const { data, error } = await supabase.from('products').insert({
        ...body, price: parseFloat(body.price), stock: parseInt(body.stock)
      }).select().single()
      if (error) throw error
      return { data: { ...data, _id: data.id } }
    }

    if (resource === 'reviews') {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase.from('reviews').insert({
        product_id: body.productId,
        customer_id: user.id,
        customer_name: user.user_metadata?.full_name || user.email,
        rating: body.rating,
        comment: body.comment,
      }).select().single()
      if (error) throw error
      return { data }
    }

    throw new Error(`api.post: unhandled route ${url}`)
  },

  async put(url, body = {}) {
    const { parts } = parseUrl(url)
    const resource = parts[0]
    const id = parts[1]

    if (resource === 'products') {
      const { data, error } = await supabase.from('products').update({
        ...body, price: parseFloat(body.price), stock: parseInt(body.stock)
      }).eq('id', id).select().single()
      if (error) throw error
      return { data: { ...data, _id: data.id } }
    }

    if (resource === 'orders') {
      const { data, error } = await supabase.from('orders').update({ status: body.status }).eq('id', id).select().single()
      if (error) throw error
      return { data }
    }

    if (resource === 'coupons') {
      const { data, error } = await supabase.from('coupons').update(body).eq('id', id).select().single()
      if (error) throw error
      return { data }
    }

    throw new Error(`api.put: unhandled route ${url}`)
  },

  async delete(url) {
    const { parts } = parseUrl(url)
    const resource = parts[0]
    const id = parts[1]

    if (resource === 'products') {
      const { error } = await supabase.from('products').delete().eq('id', id)
      if (error) throw error
      return { data: { success: true } }
    }

    if (resource === 'coupons') {
      const { error } = await supabase.from('coupons').delete().eq('id', id)
      if (error) throw error
      return { data: { success: true } }
    }

    throw new Error(`api.delete: unhandled route ${url}`)
  },
}

export default api
