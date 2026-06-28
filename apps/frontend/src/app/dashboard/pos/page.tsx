'use client';

import { useEffect, useState, useCallback } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api, imgUrl } from '@/lib/api';

interface CartItem {
  productId: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
  quantity: number;
  imageUrl?: string;
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  OTHER: 'Otro',
};

export default function PosPage() {
  const [token, setToken] = useState('');
  const [user, setUser] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Checkout modal state
  const [showCheckout, setShowCheckout] = useState(false);
  const [fulfillmentType, setFulfillmentType] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [address, setAddress] = useState('');
  const [commune, setCommune] = useState('');
  const [city, setCity] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('CASH');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const t = getToken();
    const u = getUser();
    if (t && u) {
      setToken(t);
      setUser(u);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    api.catalog.list(token).then(setProducts).catch(() => {});
  }, [token]);

  const filtered = products.filter(
    (p) =>
      p.active &&
      (search === '' ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku.toLowerCase().includes(search.toLowerCase())),
  );

  function addToCart(product: any) {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.productId === product.id);
      if (idx >= 0) {
        const updated = [...prev];
        if (updated[idx].quantity < product.stock) {
          updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 };
        }
        return updated;
      }
      if (product.stock < 1) return prev;
      const primaryImg = product.images?.find((i: any) => i.isPrimary) || product.images?.[0];
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          price: Number(product.price),
          stock: product.stock,
          quantity: 1,
          imageUrl: primaryImg?.url,
        },
      ];
    });
  }

  function updateQty(productId: string, delta: number) {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.productId === productId);
      if (idx < 0) return prev;
      const newQty = prev[idx].quantity + delta;
      if (newQty <= 0) return prev.filter((c) => c.productId !== productId);
      if (newQty > prev[idx].stock) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], quantity: newQty };
      return updated;
    });
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((c) => c.productId !== productId));
  }

  function openCheckout() {
    setErrorMsg('');
    setSuccessMsg('');
    setShowCheckout(true);
  }

  function closeCheckout() {
    setShowCheckout(false);
  }

  const total = cart.reduce((s, c) => s + c.price * c.quantity, 0);

  const checkout = useCallback(async () => {
    if (cart.length === 0) return;
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const dto: any = {
        channel: 'POS',
        paymentMethod,
        notes: notes || undefined,
        fulfillmentType,
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        customerEmail: customerEmail || undefined,
        address: fulfillmentType === 'DELIVERY' ? (address || undefined) : undefined,
        commune: fulfillmentType === 'DELIVERY' ? (commune || undefined) : undefined,
        city: fulfillmentType === 'DELIVERY' ? (city || undefined) : undefined,
        items: cart.map((c) => ({
          productId: c.productId,
          quantity: c.quantity,
          unitPrice: c.price,
        })),
      };
      if (user?.role === 'SUPER_ADMIN') {
        const companyId = prompt('Ingresa el ID de empresa para esta venta:');
        if (!companyId) { setLoading(false); return; }
        dto.companyId = companyId;
      }
      await api.pos.createSale(dto, token);
      setSuccessMsg(`Venta registrada por $${total.toLocaleString('es-CL')}`);
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerEmail('');
      setAddress('');
      setCommune('');
      setCity('');
      setNotes('');
      setFulfillmentType('PICKUP');
      setShowCheckout(false);
      const updated = await api.catalog.list(token);
      setProducts(updated);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al procesar la venta');
    } finally {
      setLoading(false);
    }
  }, [cart, paymentMethod, notes, fulfillmentType, customerName, customerPhone, customerEmail, address, commune, city, token, user, total]);

  return (
    <div className="flex gap-6 h-[calc(100vh-8rem)]">
      {/* Productos */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900">Punto de Venta</h1>
        </div>

        <input
          type="text"
          placeholder="Buscar por nombre o SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <div className="flex-1 overflow-y-auto grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 content-start">
          {filtered.map((p) => {
            const primaryImg = p.images?.find((i: any) => i.isPrimary) || p.images?.[0];
            return (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                disabled={p.stock === 0}
                className={`bg-white border rounded-xl overflow-hidden text-left transition hover:shadow-md hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                  p.stock === 0 ? 'opacity-40 cursor-not-allowed' : ''
                }`}
              >
                <div className="w-full aspect-square bg-gray-100 overflow-hidden">
                  {primaryImg ? (
                    <img
                      src={imgUrl(primaryImg.url)}
                      alt={p.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300 text-3xl">
                      📦
                    </div>
                  )}
                </div>
                <div className="p-2.5">
                  <p className="text-xs text-gray-400 mb-0.5">{p.sku}</p>
                  <p className="text-sm font-semibold text-gray-800 leading-tight line-clamp-2">{p.name}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-blue-600 font-bold text-sm">
                      ${Number(p.price).toLocaleString('es-CL')}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${p.stock > 5 ? 'bg-green-100 text-green-700' : p.stock > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                      {p.stock > 0 ? `${p.stock} uds` : 'Sin stock'}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="col-span-full text-gray-400 text-sm text-center py-12">
              {search ? 'Sin resultados para tu búsqueda.' : 'No hay productos disponibles.'}
            </p>
          )}
        </div>
      </div>

      {/* Carrito */}
      <div className="w-80 flex flex-col bg-white border border-gray-200 rounded-2xl shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Carrito</h2>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {cart.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-8">Agrega productos al carrito</p>
          )}
          {cart.map((item) => (
            <div key={item.productId} className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                {item.imageUrl ? (
                  <img src={imgUrl(item.imageUrl)} alt={item.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300 text-lg">📦</div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 leading-tight truncate">{item.name}</p>
                <p className="text-xs text-gray-400">${item.price.toLocaleString('es-CL')} c/u</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => updateQty(item.productId, -1)}
                  className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-sm font-bold hover:bg-gray-200 flex items-center justify-center"
                >
                  −
                </button>
                <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                <button
                  onClick={() => updateQty(item.productId, 1)}
                  className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-sm font-bold hover:bg-gray-200 flex items-center justify-center"
                >
                  +
                </button>
                <button
                  onClick={() => removeFromCart(item.productId)}
                  className="w-6 h-6 rounded-full bg-red-50 text-red-400 text-xs font-bold hover:bg-red-100 flex items-center justify-center ml-1"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-gray-100 space-y-3">
          {cart.length > 0 && (
            <div className="text-xs text-gray-500 space-y-1">
              {cart.map((item) => (
                <div key={item.productId} className="flex justify-between">
                  <span className="truncate max-w-[140px]">{item.name} x{item.quantity}</span>
                  <span>${(item.price * item.quantity).toLocaleString('es-CL')}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between font-bold text-gray-900 text-base border-t pt-2">
            <span>Total</span>
            <span>${total.toLocaleString('es-CL')}</span>
          </div>

          {successMsg && (
            <div className="bg-green-50 text-green-700 text-xs rounded-lg px-3 py-2">{successMsg}</div>
          )}

          <button
            onClick={openCheckout}
            disabled={cart.length === 0}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-2.5 text-sm transition flex items-center justify-center gap-2"
          >
            Cobrar
            <span className="text-base leading-none">→</span>
          </button>
        </div>
      </div>

      {/* Modal de checkout */}
      {showCheckout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Finalizar compra</h2>
              <button
                onClick={closeCheckout}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-lg font-bold transition"
              >
                ×
              </button>
            </div>

            {/* Body con scroll */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

              {/* Datos del cliente */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Datos del cliente</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 font-medium mb-1">Nombre</label>
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Nombre del cliente"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 font-medium mb-1">Teléfono</label>
                      <input
                        type="tel"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="+56 9 XXXX XXXX"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 font-medium mb-1">Email</label>
                      <input
                        type="email"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        placeholder="correo@ejemplo.cl"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Tipo de entrega */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Tipo de entrega</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFulfillmentType('PICKUP')}
                    className={`py-3 rounded-xl border-2 text-sm font-semibold transition ${
                      fulfillmentType === 'PICKUP'
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    Retiro en tienda
                  </button>
                  <button
                    type="button"
                    onClick={() => setFulfillmentType('DELIVERY')}
                    className={`py-3 rounded-xl border-2 text-sm font-semibold transition ${
                      fulfillmentType === 'DELIVERY'
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    Despacho a domicilio
                  </button>
                </div>
              </div>

              {/* Dirección (solo si DELIVERY) */}
              {fulfillmentType === 'DELIVERY' && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Dirección de despacho</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-500 font-medium mb-1">Dirección</label>
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="Calle y número"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 font-medium mb-1">Comuna</label>
                        <input
                          type="text"
                          value={commune}
                          onChange={(e) => setCommune(e.target.value)}
                          placeholder="Comuna"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 font-medium mb-1">Ciudad</label>
                        <input
                          type="text"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          placeholder="Ciudad"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Método de pago */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Método de pago</h3>
                <div className="grid grid-cols-4 gap-2">
                  {Object.entries(PAYMENT_LABELS).map(([v, l]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setPaymentMethod(v)}
                      className={`py-2 rounded-lg border-2 text-xs font-semibold transition ${
                        paymentMethod === v
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notas */}
              <div>
                <label className="block text-xs text-gray-500 font-medium mb-1">Notas (opcional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Observaciones..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100">
              {errorMsg && (
                <div className="bg-red-50 text-red-700 text-xs rounded-lg px-3 py-2 mb-3">{errorMsg}</div>
              )}
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-600">Total a cobrar</span>
                <span className="text-xl font-bold text-gray-900">${total.toLocaleString('es-CL')}</span>
              </div>
              <button
                onClick={checkout}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm transition"
              >
                {loading ? 'Procesando...' : 'Confirmar venta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
