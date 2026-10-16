'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api, imgUrl, openDocumentUrl, type PaymentRequestInfo } from '@/lib/api';
import { PaymentLinkModal } from '@/components/PaymentLinkModal';
import { SpecInputs, missingRequiredSpecs } from '../fabricacion/shared';
import type { SpecField } from '@/lib/api';
import { useAdminCompany } from '../AdminCompanyContext';
import { SkeletonCards } from '@/components/Skeleton';
import PosFilters from './PosFilters';
import { hasModule, matchesModule } from '@/lib/modules';
import { splitComboTotal } from './variablePrice';

interface CartItem {
  productId: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
  quantity: number;
  imageUrl?: string;
  type?: string;
  // Precio de catálogo (price puede cambiar al confirmar el precio real de un producto variable).
  listPrice: number;
  // Precio variable (módulo "variable_price"): el precio real se confirma al cobrar.
  variablePrice?: boolean;
  minPrice?: number | null;
  // Fabricación: a pedido (se vende sin stock) o servicio con proceso; especificaciones a pedir.
  madeToOrder?: boolean;
  withProcess?: boolean;
  specFields?: SpecField[] | null;
  advancePercent?: number | null;
  specs?: Record<string, string>;
}

const PAGE_SIZE = 20;
const VIEW_KEY = 'pos_products_view';

const fmtCLP = (n: number) => `$${Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 })}`;


const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  OTHER: 'Otro',
};

// Pasarelas en línea: solo aparecen si la empresa las tiene habilitadas (plan + conexión activa).
const ONLINE_METHODS = ['FLOW', 'MERCADO_PAGO'];

export default function PosPage() {
  const { selectedCompanyId, companies: adminCompanies } = useAdminCompany();
  const [token, setToken] = useState('');
  const [user, setUser] = useState<any>(null);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [products, setProducts] = useState<any[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [view, setView] = useState<'list' | 'grid' | 'compact'>('list');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Checkout modal state
  const [showCheckout, setShowCheckout] = useState(false);
  // Paso previo al cobro: confirmar el precio real de los productos con precio variable,
  // por producto o como un total de combo que se reparte entre ellos.
  const [showPriceConfirm, setShowPriceConfirm] = useState(false);
  const [priceMode, setPriceMode] = useState<'line' | 'combo'>('line');
  const [linePrices, setLinePrices] = useState<Record<string, string>>({});
  const [comboTotal, setComboTotal] = useState('');
  const [priceError, setPriceError] = useState('');
  // En móvil el carrito es un panel que se abre con el botón flotante (no tapa el catálogo).
  const [showCartMobile, setShowCartMobile] = useState(false);
  const [fulfillmentType, setFulfillmentType] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [address, setAddress] = useState('');
  const [commune, setCommune] = useState('');
  const [city, setCity] = useState('');
  // Medios de pago: una fila = pago con un solo medio (por el total). Con "+ Agregar otro medio
  // de pago" se cobra con varios; un monto vacío toma el saldo que falta.
  const [payments, setPayments] = useState<{ method: string; amount: string }[]>([{ method: 'CASH', amount: '' }]);
  const [notes, setNotes] = useState('');
  // Cobros en línea: pasarelas habilitadas, cobro en curso y link a distancia.
  const [onlineProviders, setOnlineProviders] = useState<Array<{ provider: string; name: string; environment: string }>>([]);
  const [payReq, setPayReq] = useState<PaymentRequestInfo | null>(null);
  const [remoteLink, setRemoteLink] = useState(false);
  // Fabricación: cobrar un abono y dejar el saldo pendiente.
  const [abonoOn, setAbonoOn] = useState(false);
  const [abonoAmount, setAbonoAmount] = useState('');
  // Bodega de venta: el vendedor vende desde la asignada en Usuarios (fija); un administrador
  // puede elegirla ('' = la bodega de cada producto). El stock mostrado es el de esa bodega.
  // canChoose (administrador): cualquier bodega o la de cada producto. assigned: tiendas del vendedor
  // (con varias elige entre ellas; con una queda fija; sin ninguna vende como antes).
  const [posWh, setPosWh] = useState<{ canChoose: boolean; warehouses: { id: string; name: string }[]; assigned: { id: string; name: string }[] }>({ canChoose: false, warehouses: [], assigned: [] });
  const [saleWarehouseId, setSaleWarehouseId] = useState('');

  // Cliente registrado
  const [clients, setClients] = useState<any[]>([]);
  const [clientId, setClientId] = useState('');
  const [showNewClient, setShowNewClient] = useState(false);
  const emptyClient = { name: '', rut: '', giro: '', email: '', phone: '', address: '', commune: '', city: '' };
  const [newClient, setNewClient] = useState(emptyClient);

  // Orden de trabajo (mismo carrito, sin cobrar ni descontar stock hasta que se acepte)
  const [showWorkOrderModal, setShowWorkOrderModal] = useState(false);
  const [creatingWorkOrder, setCreatingWorkOrder] = useState(false);
  const [workOrderError, setWorkOrderError] = useState('');
  const [createdWorkOrder, setCreatedWorkOrder] = useState<any>(null);
  const [sendEmailTo, setSendEmailTo] = useState('');
  const [sendingWorkOrderEmail, setSendingWorkOrderEmail] = useState(false);
  const [workOrderEmailMsg, setWorkOrderEmailMsg] = useState('');
  // Última venta cobrada, para imprimir su comprobante (formato según tu configuración de ticket).
  const [lastSaleId, setLastSaleId] = useState('');

  function closeWorkOrderModal() {
    setShowWorkOrderModal(false);
    setCreatedWorkOrder(null);
    setSendEmailTo('');
    setWorkOrderEmailMsg('');
  }

  function printWorkOrder(id: string) {
    window.open(`/imprimir/orden-trabajo/${id}`, '_blank');
  }

  function printSale(id: string) {
    window.open(`/imprimir/venta/${id}`, '_blank');
  }

  async function sendWorkOrderEmail() {
    if (!createdWorkOrder || !sendEmailTo.trim()) return;
    setSendingWorkOrderEmail(true);
    setWorkOrderEmailMsg('');
    try {
      const res = await api.pos.workOrders.sendEmail(createdWorkOrder.id, sendEmailTo.trim(), token);
      setWorkOrderEmailMsg(`Enviado a ${res.to}`);
    } catch (err: any) {
      setWorkOrderEmailMsg(err.message || 'No se pudo enviar el correo.');
    } finally {
      setSendingWorkOrderEmail(false);
    }
  }

  // Documento tributario (DTE)
  const [billingConns, setBillingConns] = useState<any[]>([]);
  const [emitDte, setEmitDte] = useState(false);
  const [dteFamily, setDteFamily] = useState<'BOLETA' | 'FACTURA'>('BOLETA');
  const [dteType, setDteType] = useState<'BOLETA' | 'FACTURA' | 'FACTURA_EXENTA'>('BOLETA');
  const FACTURA_DOCS = [
    { value: 'FACTURA', label: 'Factura Electrónica (33)' },
    { value: 'FACTURA_EXENTA', label: 'Factura Exenta (34)' },
  ] as const;
  const isFactura = dteType === 'FACTURA' || dteType === 'FACTURA_EXENTA';
  const [dteConnId, setDteConnId] = useState('');
  const [lastInvoice, setLastInvoice] = useState<any>(null);
  const [emailBusy, setEmailBusy] = useState(false);

  const selectedClient = clients.find((c) => c.id === clientId) || null;

  useEffect(() => {
    const t = getToken();
    const u = getUser();
    if (t && u) {
      setToken(t);
      setUser(u);
    }
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === 'list' || v === 'grid' || v === 'compact') setView(v);
    } catch { /* ignore */ }
  }, []);

  function changeView(v: 'list' | 'grid' | 'compact') {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  }

  const loadProducts = useCallback(async (p: number) => {
    if (!token) return;
    if (isSuperAdmin && !selectedCompanyId) {
      setProducts([]);
      setTotalProducts(0);
      setPages(1);
      return;
    }
    setProductsLoading(true);
    try {
      const res = await api.catalog.search({
        page: p,
        search: search || undefined,
        category: categoryFilter || undefined,
        active: 'true',
        inStock: onlyInStock || undefined,
        companyId: isSuperAdmin ? selectedCompanyId : undefined,
        pageSize: PAGE_SIZE,
        stockWarehouseId: saleWarehouseId || undefined,
      }, token);
      // Con bodega de venta, el stock del producto es el de esa bodega.
      setProducts(saleWarehouseId ? res.products.map((p: any) => ({ ...p, stock: p.warehouseStock ?? 0 })) : res.products);
      setTotalProducts(res.total);
      setPage(res.page);
      setPages(res.pages);
    } catch {
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  }, [token, search, categoryFilter, onlyInStock, isSuperAdmin, selectedCompanyId, saleWarehouseId]);

  useEffect(() => {
    const t = setTimeout(() => loadProducts(1), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, search, categoryFilter, onlyInStock, selectedCompanyId, saleWarehouseId]);

  useEffect(() => {
    if (!token) return;
    const cid = isSuperAdmin ? selectedCompanyId : undefined;
    if (isSuperAdmin && !selectedCompanyId) return;
    api.pos.settings.get(token, cid || undefined).then((st) => {
      const assigned = st.assignedWarehouses || [];
      const canChoose = !!st.canChooseWarehouse;
      setPosWh({ canChoose, warehouses: st.warehouses || [], assigned });
      // Recuerda la última tienda elegida (si sigue disponible para este usuario).
      let saved = '';
      try { saved = localStorage.getItem(`pos_sale_wh_${getUser()?.id || ''}`) || ''; } catch {}
      const options = canChoose ? (st.warehouses || []) : assigned;
      const keep = saved && options.some((w) => w.id === saved) ? saved : '';
      setSaleWarehouseId(keep || st.saleWarehouse?.id || '');
      setCart([]);
    }).catch(() => {});
  }, [token, isSuperAdmin, selectedCompanyId]);

  useEffect(() => {
    if (!token) return;
    const cid = isSuperAdmin ? selectedCompanyId : undefined;
    if (isSuperAdmin && !selectedCompanyId) {
      setCategories([]); setClients([]); setBillingConns([]); setOnlineProviders([]);
      return;
    }
    api.catalog.categories(token, cid).then(setCategories).catch(() => {});
    api.payments.available(token, cid).then(setOnlineProviders).catch(() => setOnlineProviders([]));
    api.clients.list(token, cid).then((d) => setClients(d.filter((c: any) => c.active))).catch(() => setClients([]));
    api.billing.connections.list(token, cid ? { companyId: cid } : undefined)
      .then((cs) => { setBillingConns(cs); if (cs[0]) setDteConnId(cs[0].id); })
      .catch(() => setBillingConns([]));
  }, [token, isSuperAdmin, selectedCompanyId]);

  // Venta solo de servicios: no hay nada que preparar ni despachar (no genera orden de
  // pedido), solo se factura — al abrir el cobro se deja marcado el documento tributario.
  const servicesOnly = cart.length > 0 && cart.every((c) => c.type === 'SERVICIO');

  // Módulo de precio variable de la empresa (Super Admin: la empresa que está gestionando).
  const activeCompany = isSuperAdmin ? (adminCompanies || []).find((c: any) => c.id === selectedCompanyId) : null;
  const variablePriceEnabled = isSuperAdmin
    ? !!activeCompany && matchesModule(activeCompany.modules, 'variable_price')
    : hasModule(user, 'variable_price');
  // Fabricación: los productos a pedido se venden sin stock y abren su orden al cobrar.
  const productionEnabled = isSuperAdmin
    ? !!activeCompany && matchesModule(activeCompany.modules, 'produccion')
    : hasModule(user, 'produccion');
  const isMadeToOrder = (p: any) => productionEnabled && p.type !== 'SERVICIO' && p.supplyMode === 'MADE_TO_ORDER';

  function addToCart(product: any) {
    const isService = product.type === 'SERVICIO' || isMadeToOrder(product);
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.productId === product.id);
      if (idx >= 0) {
        const updated = [...prev];
        if (isService || updated[idx].quantity < product.stock) {
          updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 };
        }
        return updated;
      }
      if (!isService && product.stock < 1) return prev;
      const primaryImg = product.images?.find((i: any) => i.isPrimary) || product.images?.[0];
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          price: Number(product.price),
          listPrice: Number(product.price),
          stock: product.stock,
          quantity: 1,
          imageUrl: primaryImg?.url,
          type: product.type,
          variablePrice: variablePriceEnabled && !!product.variablePrice,
          minPrice: product.minPrice != null ? Number(product.minPrice) : null,
          madeToOrder: isMadeToOrder(product),
          withProcess: productionEnabled && (isMadeToOrder(product) || (product.type === 'SERVICIO' && !!product.requiresProcess)),
          specFields: productionEnabled ? (product.specFields || null) : null,
          advancePercent: product.advancePercent ?? null,
          specs: {},
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
      if (prev[idx].type !== 'SERVICIO' && !prev[idx].madeToOrder && newQty > prev[idx].stock) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], quantity: newQty };
      return updated;
    });
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((c) => c.productId !== productId));
  }

  const variableItems = cart.filter((c) => c.variablePrice);

  function openCheckout() {
    setErrorMsg('');
    setSuccessMsg('');
    if (variableItems.length > 0) {
      // Se pide siempre al cobrar, con lo último confirmado como sugerencia.
      setLinePrices(Object.fromEntries(variableItems.map((c) => [c.productId, String(c.price)])));
      setComboTotal(String(variableItems.reduce((s, c) => s + c.price * c.quantity, 0)));
      setPriceError('');
      setShowPriceConfirm(true);
      return;
    }
    proceedToCheckout();
  }

  function proceedToCheckout() {
    if (servicesOnly && billingConns.length > 0) setEmitDte(true);
    setShowCheckout(true);
  }

  // Precio por unidad de cada producto variable según lo ingresado (null si falta un dato).
  const comboMode = priceMode === 'combo' && variableItems.length > 1;
  const confirmedPrices: Record<string, number> | null = comboMode
    ? (Number(comboTotal) > 0
      ? splitComboTotal(variableItems.map((c) => ({ id: c.productId, quantity: c.quantity, weight: c.listPrice })), Number(comboTotal))
      : null)
    : (variableItems.every((c) => Number(linePrices[c.productId]) > 0)
      ? Object.fromEntries(variableItems.map((c) => [c.productId, Number(linePrices[c.productId])]))
      : null);
  const fixedTotal = cart.filter((c) => !c.variablePrice).reduce((s, c) => s + c.price * c.quantity, 0);
  const confirmedTotal = confirmedPrices
    ? fixedTotal + variableItems.reduce((s, c) => s + (confirmedPrices[c.productId] ?? 0) * c.quantity, 0)
    : null;

  function confirmPrices() {
    if (!confirmedPrices) {
      setPriceError(comboMode ? 'Ingresa el total del combo' : 'Ingresa el precio de cada producto');
      return;
    }
    for (const c of variableItems) {
      const unit = confirmedPrices[c.productId];
      if (c.minPrice != null && unit < c.minPrice - 0.005) {
        setPriceError(`"${c.name}" queda en ${clp(unit)} por unidad, bajo su mínimo de ${clp(c.minPrice)}`);
        return;
      }
    }
    setCart((prev) => prev.map((c) => (c.variablePrice ? { ...c, price: confirmedPrices[c.productId] } : c)));
    setShowPriceConfirm(false);
    proceedToCheckout();
  }

  function closeCheckout() {
    setShowCheckout(false);
  }

  const total = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const units = cart.reduce((n, c) => n + c.quantity, 0);
  const clp = (n: number) => `$${n.toLocaleString('es-CL', { maximumFractionDigits: 0 })}`;

  // F2 = Cobrar (atajo de caja). Se guarda la última versión de la función para el listener.
  const openCheckoutRef = useRef<() => void>(() => {});
  useEffect(() => {
    openCheckoutRef.current = () => { if (cart.length > 0 && !showCheckout && !showPriceConfirm) openCheckout(); };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); openCheckoutRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const contactVisible = !servicesOnly && fulfillmentType === 'DELIVERY';
  const contactName = contactVisible ? customerName : '';
  const contactPhone = contactVisible ? customerPhone : '';
  const contactEmail = contactVisible ? customerEmail : '';
  const multiPay = payments.length > 1;
  // Fabricación: líneas con orden (a pedido o con proceso) y abono sugerido según su anticipo.
  const productionLines = cart.filter((c) => c.withProcess);
  const suggestedAbono = Math.round(cart.reduce((s, c) => s + c.price * c.quantity * (c.withProcess ? (c.advancePercent ?? 50) / 100 : 1), 0));
  const abonoValue = Math.round(Number(abonoAmount) || 0);
  const abonoActive = abonoOn && productionLines.length > 0 && !(!multiPay && ['FLOW', 'MERCADO_PAGO'].includes(payments[0].method));
  // Lo que se cobra ahora: el total o el abono.
  const payTarget = abonoActive ? abonoValue : total;
  const resolvedPayments = (() => {
    if (!multiPay) return [{ method: payments[0].method, amount: payTarget }];
    const empties = payments.filter((p) => p.amount === '').length;
    const filledSum = payments.reduce((s, p) => s + (p.amount === '' ? 0 : Number(p.amount) || 0), 0);
    return payments.map((p) => ({
      method: p.method,
      amount: p.amount === '' ? (empties === 1 ? Math.max(0, payTarget - filledSum) : 0) : Number(p.amount) || 0,
    }));
  })();
  const paidSum = resolvedPayments.reduce((s, p) => s + p.amount, 0);
  const payDiff = payTarget - paidSum;
  const abonoOk = !abonoActive || (abonoValue > 0 && abonoValue < total);
  const payOk = abonoOk && (!multiPay || (Math.abs(payDiff) < 1 && resolvedPayments.every((p) => p.amount > 0)));
  const paymentMethod = multiPay ? 'MIXED' : payments[0].method;

  // Cobro en línea (Flow / Mercado Pago): un solo medio, sin pago mixto.
  const onlineMethod = !multiPay && ONLINE_METHODS.includes(payments[0].method) ? payments[0].method : '';

  // Datos de la venta tal como los recibe el servidor (venta directa o cobro en línea).
  const buildSaleDto = () => {
    const companyId = isSuperAdmin ? selectedCompanyId : undefined;
    const dto: any = {
      channel: 'POS',
      paymentMethod,
      payments: resolvedPayments,
      ...(posWh.canChoose || posWh.assigned.length > 0 ? { warehouseId: saleWarehouseId } : {}),
      notes: notes || undefined,
      fulfillmentType: servicesOnly ? undefined : fulfillmentType,
      clientId: clientId || undefined,
      // Sin cliente, los datos de contacto solo se usan (y se muestran) con despacho.
      customerName: (selectedClient?.name || contactName) || undefined,
      customerPhone: (selectedClient?.phone || contactPhone) || undefined,
      customerEmail: (selectedClient?.email || contactEmail) || undefined,
      address: !servicesOnly && fulfillmentType === 'DELIVERY' ? (address || undefined) : undefined,
      commune: !servicesOnly && fulfillmentType === 'DELIVERY' ? (commune || undefined) : undefined,
      city: !servicesOnly && fulfillmentType === 'DELIVERY' ? (city || undefined) : undefined,
      items: cart.map((c) => ({ productId: c.productId, quantity: c.quantity, unitPrice: c.price, ...(c.specs && Object.keys(c.specs).length ? { specs: c.specs } : {}) })),
      ...(abonoActive ? { allowBalance: true } : {}),
    };
    if (companyId) dto.companyId = companyId;
    return dto;
  };

  const resetCheckout = () => {
    setCart([]);
    setCustomerName(''); setCustomerPhone(''); setCustomerEmail('');
    setAddress(''); setCommune(''); setCity('');
    setNotes(''); setFulfillmentType('PICKUP');
    setPayments([{ method: 'CASH', amount: '' }]);
    setRemoteLink(false);
    setAbonoOn(false); setAbonoAmount('');
    setClientId(''); setShowNewClient(false); setNewClient(emptyClient);
    setEmitDte(false); setDteType('BOLETA'); setDteFamily('BOLETA');
    setShowCheckout(false);
  };

  // Venta registrada: boleta/factura (si se pidió) y punto de venta limpio.
  const finishSale = async (saleId: string, method: string, saleTotal: number) => {
    setLastSaleId(saleId);
    let dteMsg = '';
    if (emitDte) {
      try {
        const inv = await api.billing.invoices.issue({
          connectionId: dteConnId,
          dteType,
          rut: selectedClient?.rut || '66666666-6',
          razonSocial: selectedClient?.name || contactName || 'Consumidor final',
          giro: selectedClient?.giro || undefined,
          address: selectedClient?.address || undefined,
          commune: selectedClient?.commune || undefined,
          email: selectedClient?.email || contactEmail || undefined,
          items: cart.map((c) => ({ name: c.name, quantity: c.quantity, unitPrice: c.price })),
          saleId,
          clientId: clientId || undefined,
          paymentCondition: 'CONTADO',
          markPaid: true,
          paymentMethod: method,
        }, token);
        const docLabel = dteType === 'BOLETA' ? 'Boleta' : dteType === 'FACTURA_EXENTA' ? 'Factura exenta' : 'Factura';
        dteMsg = ` · ${docLabel}${inv?.folio ? ` N° ${inv.folio}` : ''} emitida`;
        setLastInvoice({
          ...inv,
          docLabel,
          defaultEmail: selectedClient?.email || contactEmail || '',
        });
      } catch (e: any) {
        dteMsg = ` · Venta OK, pero el DTE falló: ${e.message}`;
        setLastInvoice(null);
      }
    } else {
      setLastInvoice(null);
    }

    const balanceNote = abonoActive && abonoValue < saleTotal ? ` · Abono $${abonoValue.toLocaleString('es-CL')}, saldo $${(saleTotal - abonoValue).toLocaleString('es-CL')}` : '';
    const productionNote = productionLines.length ? ` · ${productionLines.length} orden(es) de fabricación creada(s)` : '';
    setSuccessMsg(`Venta registrada por $${saleTotal.toLocaleString('es-CL', { maximumFractionDigits: 0 })}${balanceNote}${productionNote}${dteMsg}`);
    resetCheckout();
    await loadProducts(page);
  };

  const checkout = useCallback(async () => {
    if (cart.length === 0) return;
    if (!abonoOk) { setErrorMsg('El abono debe ser mayor a 0 y menor al total'); return; }
    if (!payOk) { setErrorMsg(abonoActive ? 'Los montos de los medios de pago deben sumar el abono' : 'Los montos de los medios de pago deben sumar el total de la venta'); return; }
    const missingSpecs = cart.flatMap((c) => missingRequiredSpecs(c.specFields, c.specs).map((l) => `${c.name}: ${l}`));
    if (missingSpecs.length) { setErrorMsg(`Completa las especificaciones: ${missingSpecs.join(', ')}`); return; }
    if (isSuperAdmin && !selectedCompanyId) return;

    // Validación del DTE
    if (emitDte) {
      if (!dteConnId) { setErrorMsg('Selecciona la conexión de facturación'); return; }
      if (isFactura) {
        const rut = selectedClient?.rut;
        if (!clientId || !rut || !selectedClient?.name) {
          setErrorMsg('Para emitir Factura selecciona un cliente con RUT y razón social');
          return;
        }
      }
    }

    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    setLastSaleId('');
    try {
      const dto = buildSaleDto();
      if (onlineMethod) {
        // La venta se registra cuando la pasarela confirma el pago.
        const { payments: _p, paymentMethod: _m, ...rest } = dto;
        const req = await api.payments.create({ ...rest, provider: onlineMethod, remote: remoteLink }, token);
        setPayReq(req);
        return;
      }
      const sale = await api.pos.createSale(dto, token);
      await finishSale(sale.id, paymentMethod, total);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al procesar la venta');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, posWh.canChoose, posWh.assigned.length, saleWarehouseId, servicesOnly, contactName, contactPhone, contactEmail, paymentMethod, payOk, resolvedPayments, notes, fulfillmentType, customerName, customerPhone, customerEmail, address, commune, city, token, isSuperAdmin, selectedCompanyId, total, loadProducts, page, clientId, selectedClient, emitDte, dteType, dteConnId, onlineMethod, remoteLink, abonoOk, abonoActive]);

  // Cierre del cobro en línea: si ya se pagó, la venta quedó registrada; si sigue pendiente,
  // queda en Cobros en línea y el punto de venta pasa a la siguiente venta; si se canceló,
  // vuelve al checkout con el mismo carrito para cobrar de otra forma.
  const closePayReq = (req: PaymentRequestInfo) => {
    setPayReq(null);
    if (req.status === 'PENDING' || req.status === 'PROCESSING' || req.status === 'NEEDS_REVIEW') {
      resetCheckout();
      setSuccessMsg(req.status === 'PENDING'
        ? `Cobro de $${Math.round(req.amount).toLocaleString('es-CL')} pendiente: la venta se registrará sola cuando el cliente pague (Ventas → Cobros en línea)`
        : 'Pago recibido: revisa el cobro en Ventas → Cobros en línea');
    }
  };

  const createWorkOrderFromCart = useCallback(async () => {
    if (cart.length === 0) return;
    const companyId = isSuperAdmin ? selectedCompanyId : undefined;
    if (isSuperAdmin && !selectedCompanyId) return;

    setCreatingWorkOrder(true);
    setWorkOrderError('');
    try {
      const dto: any = {
        clientId: clientId || undefined,
        customerName: (selectedClient?.name || customerName) || undefined,
        customerPhone: (selectedClient?.phone || customerPhone) || undefined,
        customerEmail: (selectedClient?.email || customerEmail) || undefined,
        notes: notes || undefined,
        items: cart.map((c) => ({
          productId: c.productId,
          productName: c.name,
          productSku: c.sku,
          quantity: c.quantity,
          unitPrice: c.price,
        })),
      };
      if (companyId) dto.companyId = companyId;

      const workOrder = await api.pos.workOrders.create(dto, token);

      setSuccessMsg(`Orden de trabajo N° ${String(workOrder.folio).padStart(4, '0')} creada — sin cobrar ni descontar stock.`);
      setCreatedWorkOrder(workOrder);
      setSendEmailTo(dto.customerEmail || '');
      setWorkOrderEmailMsg('');
      printWorkOrder(workOrder.id);
      setCart([]);
      setCustomerName(''); setCustomerPhone(''); setCustomerEmail('');
      setNotes('');
      setClientId(''); setShowNewClient(false); setNewClient(emptyClient);
    } catch (err: any) {
      setWorkOrderError(err.message || 'No se pudo crear la orden de trabajo.');
    } finally {
      setCreatingWorkOrder(false);
    }
  }, [cart, isSuperAdmin, selectedCompanyId, clientId, selectedClient, customerName, customerPhone, customerEmail, notes, token]);

  async function saveNewClient() {
    if (newClient.name.trim().length < 2) { setErrorMsg('Nombre del cliente requerido'); return; }
    try {
      const created = await api.clients.create(
        {
          name: newClient.name.trim(),
          rut: newClient.rut || undefined,
          giro: newClient.giro || undefined,
          email: newClient.email || undefined,
          phone: newClient.phone || undefined,
          address: newClient.address || undefined,
          commune: newClient.commune || undefined,
          city: newClient.city || undefined,
          ...(isSuperAdmin && selectedCompanyId ? { companyId: selectedCompanyId } : {}),
        },
        token,
      );
      setClients((cs) => [created, ...cs]);
      setClientId(created.id);
      setShowNewClient(false);
      setNewClient(emptyClient);
      setErrorMsg('');
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  }

  async function viewInvoice() {
    if (!lastInvoice?.pdfUrl) { setErrorMsg('El documento no tiene PDF disponible aún'); return; }
    try { await openDocumentUrl(lastInvoice.pdfUrl); }
    catch { window.open(lastInvoice.pdfUrl, '_blank', 'noopener,noreferrer'); }
  }

  async function emailInvoice() {
    if (!lastInvoice) return;
    const to = window.prompt('Enviar el documento a:', lastInvoice.defaultEmail || '');
    if (to === null) return;
    setEmailBusy(true);
    try {
      const res = await api.billing.invoices.sendEmail(lastInvoice.id, to.trim() || undefined, token);
      setSuccessMsg(`${lastInvoice.docLabel} enviada a ${res.to}`);
    } catch (err: any) {
      setErrorMsg(err.message || 'No se pudo enviar el correo');
    } finally {
      setEmailBusy(false);
    }
  }

  // Cambiar la bodega de venta vacía el carrito (el stock es otro) y se recuerda por usuario.
  function changeSaleWarehouse(id: string) {
    setSaleWarehouseId(id);
    setCart([]);
    try { localStorage.setItem(`pos_sale_wh_${user?.id || ''}`, id); } catch {}
  }

  // Filtros activos como chips bajo la búsqueda (con «Más filtros» cerrado).
  const saleWhName = (posWh.canChoose ? posWh.warehouses : posWh.assigned).find((w) => w.id === saleWarehouseId)?.name
    ?? (posWh.assigned.length === 1 ? posWh.assigned[0].name : null);
  const posFilterChips: { key: string; label: string; onRemove?: () => void }[] = [
    ...(saleWhName ? [{ key: 'wh', label: `Vender desde: ${saleWhName}`, onRemove: posWh.canChoose ? () => changeSaleWarehouse('') : undefined }] : []),
    ...(categoryFilter ? [{ key: 'cat', label: categoryFilter, onRemove: () => setCategoryFilter('') }] : []),
    ...(onlyInStock ? [{ key: 'stock', label: 'Solo con stock', onRemove: () => setOnlyInStock(false) }] : []),
  ];

  // Alto fijo para que carrito y catálogo calcen en una pantalla (el selector de empresa del
  // Super Admin está en la barra superior, no ocupa espacio dentro de la página).
  const posHeightClass = 'h-[calc(100dvh-5.5rem)] sm:h-[calc(100dvh-6.5rem)] lg:h-[calc(100dvh-7.5rem)]';

  return (
    <div className={`flex flex-col lg:flex-row gap-4 sm:gap-6 ${posHeightClass}`}>
      {/* Productos */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {isSuperAdmin && !selectedCompanyId ? (
          <div className="flex-1 flex items-center justify-center text-center text-gray-400 text-sm border border-dashed border-gray-300 rounded-2xl">
            <div>
              <p className="text-3xl mb-2">🏢</p>
              <p>Selecciona una empresa arriba para ver su catálogo y vender.</p>
            </div>
          </div>
        ) : (
        <>
        {/* Búsqueda a la vista; Categoría, Vender desde y Solo con stock en el panel «Filtros». */}
        <div className="mb-3 flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <label className="text-xs text-gray-500 block mb-1">Buscar</label>
              <input
                type="text"
                placeholder="Buscar por nombre o SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <PosFilters
              categories={categories}
              values={{ category: categoryFilter, onlyInStock, warehouseId: saleWarehouseId }}
              warehouses={posWh.canChoose ? posWh.warehouses : posWh.assigned}
              canChooseWarehouse={posWh.canChoose}
              singleStore={posWh.assigned.length === 1 ? posWh.assigned[0].name : null}
              activeCount={(categoryFilter ? 1 : 0) + (onlyInStock ? 1 : 0) + (posWh.canChoose && saleWarehouseId ? 1 : 0)}
              onApply={(v) => {
                setCategoryFilter(v.category);
                setOnlyInStock(v.onlyInStock);
                if (v.warehouseId !== saleWarehouseId) changeSaleWarehouse(v.warehouseId);
              }}
            />
          </div>
          {posFilterChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {posFilterChips.map((c) => (
                <span key={c.key} className={`inline-flex items-center gap-1.5 rounded-full pl-2.5 ${c.onRemove ? 'pr-1' : 'pr-2.5'} py-0.5 text-xs ${c.key === 'wh' ? 'bg-emerald-50 text-emerald-700' : 'bg-[var(--brand-light)] text-[var(--brand-ink)]'}`}>
                  {c.label}
                  {c.onRemove && (
                    <button type="button" onClick={c.onRemove} aria-label={`Quitar ${c.label}`} className="w-[18px] h-[18px] rounded-full bg-black/5 hover:bg-black/10 text-[10px] leading-none">✕</button>
                  )}
                </span>
              ))}
              {(search || categoryFilter || onlyInStock) && (
                <button type="button" onClick={() => { setSearch(''); setCategoryFilter(''); setOnlyInStock(false); }} className="text-xs text-[var(--brand)] hover:underline px-1">Limpiar filtros</button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 className="ui-section-title">
            Productos <span className="text-sm font-normal text-gray-400">· {totalProducts}</span>
          </h2>
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            {([
              { k: 'list', label: 'Lista' },
              { k: 'grid', label: 'Cuadrícula' },
              { k: 'compact', label: 'Compacta' },
            ] as const).map((v) => (
              <button
                key={v.k}
                onClick={() => changeView(v.k)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  view === v.k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto border border-gray-200 rounded-2xl bg-white">
          {productsLoading && (
            <SkeletonCards count={9} className="grid grid-cols-2 md:grid-cols-3 gap-3 p-3" height={150} />
          )}

          {!productsLoading && view === 'grid' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 p-3">
              {products.map((p) => {
                const primaryImg = p.images?.find((i: any) => i.isPrimary) || p.images?.[0];
                const isService = p.type === 'SERVICIO';
                const toOrder = isMadeToOrder(p);
                const out = !isService && !toOrder && p.stock === 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    disabled={out}
                    className={`flex flex-col text-left border border-gray-200 rounded-xl overflow-hidden transition hover:border-blue-400 hover:shadow-sm ${out ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <div className="px-4 pt-3">
                      <div className="relative aspect-square bg-gray-50 overflow-hidden rounded-lg">
                        {primaryImg ? (
                          <img src={imgUrl(primaryImg.url)} alt={p.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-300 text-3xl">
                            {isService ? '🛠️' : '📦'}
                          </div>
                        )}
                        <span className={`absolute bottom-1.5 right-1.5 text-[15px] leading-none px-2.5 py-1 rounded-full font-bold shadow-sm ${isService ? 'bg-blue-100 text-blue-700' : toOrder ? 'bg-indigo-100 text-indigo-700' : p.stock > 5 ? 'bg-green-100 text-green-700' : p.stock > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                          {isService ? 'Serv.' : toOrder ? 'A pedido' : `${p.stock > 0 ? p.stock : 0} u.`}
                        </span>
                      </div>
                    </div>
                    <div className="p-2.5 flex-1 flex flex-col gap-1.5">
                      <p className="text-xs font-semibold text-gray-900 leading-tight line-clamp-2 text-center">{p.name}</p>
                      {/* En el punto de venta solo importa el precio de venta directa. */}
                      <p className="mt-auto text-center text-sm text-blue-600 font-bold">{fmtCLP(p.price)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!productsLoading && view !== 'grid' && (
            <div className="divide-y divide-gray-100">
              {products.map((p) => {
                const primaryImg = p.images?.find((i: any) => i.isPrimary) || p.images?.[0];
                const isService = p.type === 'SERVICIO';
                const toOrder = isMadeToOrder(p);
                const out = !isService && !toOrder && p.stock === 0;
                const compact = view === 'compact';
                return (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    disabled={out}
                    className={`w-full flex items-center gap-3 px-4 text-left transition hover:bg-blue-50 focus:outline-none ${compact ? 'py-2' : 'py-3'} ${out ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {!compact && (
                      <div className="w-14 h-14 rounded-lg bg-gray-50 overflow-hidden shrink-0">
                        {primaryImg ? (
                          <img src={imgUrl(primaryImg.url)} alt={p.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-300 text-2xl">{isService ? '🛠️' : '📦'}</div>
                        )}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`font-bold text-gray-900 leading-tight truncate ${compact ? 'text-[13px]' : 'text-sm'}`}>{p.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{p.sku}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium shrink-0 ${isService ? 'bg-blue-100 text-blue-700' : toOrder ? 'bg-indigo-100 text-indigo-700' : p.stock > 5 ? 'bg-green-100 text-green-700' : p.stock > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                      {isService ? 'Servicio' : toOrder ? 'A pedido' : p.stock > 0 ? `${p.stock} uds` : 'Sin stock'}
                    </span>
                    <span className={`text-blue-600 font-bold w-20 text-right shrink-0 ${compact ? 'text-xs' : 'text-sm'}`}>
                      ${Number(p.price).toLocaleString('es-CL', { maximumFractionDigits: 0 })}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {!productsLoading && products.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-12">
              {search || categoryFilter || onlyInStock ? 'Sin resultados para los filtros aplicados.' : 'No hay productos disponibles.'}
            </p>
          )}
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between pt-3 shrink-0">
            <button
              onClick={() => loadProducts(page - 1)}
              disabled={page <= 1 || productsLoading}
              className="text-sm text-blue-600 disabled:text-gray-300 hover:underline"
            >
              ← Anterior
            </button>
            <span className="text-xs text-gray-500">Página {page} de {pages} · {totalProducts} producto(s)</span>
            <button
              onClick={() => loadProducts(page + 1)}
              disabled={page >= pages || productsLoading}
              className="text-sm text-blue-600 disabled:text-gray-300 hover:underline"
            >
              Siguiente →
            </button>
          </div>
        )}
        </>
        )}
      </div>

      {/* Botón flotante del carrito (solo móvil) */}
      {!showCartMobile && (
        <button
          type="button"
          onClick={() => setShowCartMobile(true)}
          aria-label="Ver carrito"
          className="lg:hidden fixed bottom-5 right-5 z-30 flex items-center gap-2 bg-blue-600 text-white rounded-full shadow-lg pl-4 pr-5 py-3 text-sm font-semibold"
        >
          <span className="relative text-lg leading-none">
            🛒
            {cart.length > 0 && (
              <span className="absolute -top-2 -right-3 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[11px] leading-[18px] text-center">
                {cart.reduce((n, c) => n + c.quantity, 0)}
              </span>
            )}
          </span>
          <span className="ml-1">${total.toLocaleString('es-CL', { maximumFractionDigits: 0 })}</span>
        </button>
      )}

      {/* Carrito */}
      <div className={`${showCartMobile ? 'flex' : 'hidden'} lg:flex fixed inset-0 z-40 lg:static lg:z-auto lg:w-[340px] xl:w-[380px] lg:shrink-0 min-h-0 flex-col bg-white lg:border lg:border-gray-200 lg:rounded-2xl lg:shadow-sm`}>
        <div className="px-4 py-3 border-b border-gray-100 shrink-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="ui-section-title">
              Carrito{units > 0 && <span className="ml-1.5 text-sm font-medium text-gray-400">({units})</span>}
            </h2>
            <div className="flex items-center gap-3">
              {cart.length > 0 && (
                <button type="button" onClick={() => setCart([])}
                  className="text-xs font-medium text-gray-400 hover:text-red-500">
                  Vaciar
                </button>
              )}
              <button type="button" onClick={() => setShowCartMobile(false)}
                className="lg:hidden text-sm font-semibold text-blue-600">
                ← Seguir agregando
              </button>
            </div>
          </div>
          {/* Cliente de la venta: se elige al cobrar */}
          <button type="button" onClick={openCheckout} disabled={cart.length === 0}
            className="w-full flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-100 disabled:hover:bg-gray-50">
            <span aria-hidden="true">👤</span>
            <span className="min-w-0 flex-1 truncate">
              {selectedClient?.name || customerName || 'Consumidor final'}
            </span>
            <span className="text-gray-400" aria-hidden="true">✎</span>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
          {cart.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-gray-400">
              <span className="text-3xl" aria-hidden="true">🛒</span>
              <p className="text-sm">Busca o escanea un producto para agregarlo</p>
            </div>
          )}
          <ul className="divide-y divide-gray-100">
            {cart.map((item) => (
              <li key={item.productId} className="flex items-center gap-2.5 py-2">
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                  {item.imageUrl ? (
                    <img src={imgUrl(item.imageUrl)} alt={item.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300 text-lg">📦</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 leading-tight truncate" title={item.name}>{item.name}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <button onClick={() => updateQty(item.productId, -1)} aria-label="Quitar uno"
                        className="w-6 h-6 rounded-md border border-gray-200 text-gray-600 text-sm font-bold hover:bg-gray-100 flex items-center justify-center">
                        −
                      </button>
                      <span className="w-6 text-center text-sm font-semibold tabular-nums">{item.quantity}</span>
                      <button onClick={() => updateQty(item.productId, 1)} aria-label="Agregar uno"
                        className="w-6 h-6 rounded-md border border-gray-200 text-gray-600 text-sm font-bold hover:bg-gray-100 flex items-center justify-center">
                        +
                      </button>
                      <span className="ml-1 text-[11px] text-gray-400 whitespace-nowrap">× {clp(item.price)}</span>
                      {item.variablePrice && (
                        <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 whitespace-nowrap"
                          title="El precio real se confirma al cobrar">Precio variable</span>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-gray-900 tabular-nums">{clp(item.price * item.quantity)}</span>
                  </div>
                </div>
                <button onClick={() => removeFromCart(item.productId)} aria-label={`Quitar ${item.name}`}
                  className="w-7 h-7 shrink-0 rounded-md text-gray-300 hover:bg-red-50 hover:text-red-500 flex items-center justify-center">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 7h12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="px-4 py-3 border-t border-gray-100 space-y-3 shrink-0">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-gray-500">Total</p>
              <p className="text-[11px] text-gray-400">{units} {units === 1 ? 'unidad' : 'unidades'}</p>
            </div>
            <span className="text-[28px] font-bold leading-none tracking-tight text-gray-900 tabular-nums">{clp(total)}</span>
          </div>

          {successMsg && (
            <div className="bg-green-50 text-green-700 text-xs rounded-lg px-3 py-2">{successMsg}</div>
          )}

          {lastSaleId && (
            <button onClick={() => printSale(lastSaleId)}
              className="w-full py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-semibold">
              🖨️ Imprimir comprobante
            </button>
          )}

          {lastInvoice && (
            <div className="border border-blue-200 bg-blue-50 rounded-lg p-2.5 space-y-2">
              <p className="text-xs font-medium text-blue-800">
                {lastInvoice.docLabel}{lastInvoice.folio ? ` N° ${lastInvoice.folio}` : ''} emitida
              </p>
              <div className="flex gap-2">
                <button onClick={viewInvoice} disabled={!lastInvoice.pdfUrl}
                  className="flex-1 py-1.5 bg-white border border-blue-300 text-blue-700 rounded-lg text-xs font-semibold disabled:opacity-40">
                  Ver documento
                </button>
                <button onClick={emailInvoice} disabled={emailBusy}
                  className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
                  {emailBusy ? 'Enviando…' : 'Enviar por correo'}
                </button>
              </div>
              <button onClick={() => setLastInvoice(null)} className="text-[11px] text-blue-400 hover:underline">Ocultar</button>
            </div>
          )}

          <button
            onClick={openCheckout}
            disabled={cart.length === 0}
            className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 text-base transition flex items-center justify-center gap-2"
          >
            {cart.length > 0 ? `Cobrar ${clp(total)}` : 'Cobrar'}
            <kbd className="hidden lg:inline rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold">F2</kbd>
          </button>
          <button
            onClick={() => { setErrorMsg(''); setSuccessMsg(''); setWorkOrderError(''); setShowWorkOrderModal(true); }}
            disabled={cart.length === 0}
            className="w-full text-center text-sm font-medium text-indigo-600 hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
          >
            Crear orden de trabajo
          </button>
        </div>
      </div>

      {/* Confirmar precios de productos con precio variable (antes de cobrar) */}
      {showPriceConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="ui-section-title">Confirmar precios</h2>
              <button onClick={() => setShowPriceConfirm(false)} aria-label="Cerrar"
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-lg font-bold transition">
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <p className="text-sm text-gray-600">
                {variableItems.length === 1 ? 'Este producto tiene' : 'Estos productos tienen'} precio variable. Ingresa el precio real de venta.
              </p>

              {variableItems.length > 1 && (
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 text-sm">
                  <button type="button" onClick={() => { setPriceMode('line'); setPriceError(''); }}
                    className={`rounded-md py-1.5 font-medium transition ${!comboMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    Precio por producto
                  </button>
                  <button type="button" onClick={() => { setPriceMode('combo'); setPriceError(''); }}
                    className={`rounded-md py-1.5 font-medium transition ${comboMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    Total del combo
                  </button>
                </div>
              )}

              {comboMode && (
                <div>
                  <label className="block text-xs text-gray-500 font-medium mb-1">Total cobrado por estos productos</label>
                  <input type="number" min="0" step="1" inputMode="numeric" autoFocus value={comboTotal}
                    onChange={(e) => { setComboTotal(e.target.value); setPriceError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmPrices(); }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <p className="text-[11px] text-gray-400 mt-1">Se reparte entre los productos en proporción a su precio de referencia.</p>
                </div>
              )}

              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                {variableItems.map((c, idx) => {
                  const unit = confirmedPrices?.[c.productId];
                  const belowMin = unit != null && c.minPrice != null && unit < c.minPrice - 0.005;
                  return (
                    <li key={c.productId} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate" title={c.name}>{c.name}</p>
                        <p className="text-[11px] text-gray-400">
                          {c.quantity} {c.quantity === 1 ? 'unidad' : 'unidades'} · referencia {clp(c.listPrice)}{c.minPrice != null ? ` · mínimo ${clp(c.minPrice)}` : ''}
                        </p>
                      </div>
                      {comboMode ? (
                        <div className={`text-right text-sm tabular-nums ${belowMin ? 'text-red-600' : 'text-gray-700'}`}>
                          <p className="font-semibold">{unit != null ? clp(unit * c.quantity) : '—'}</p>
                          {unit != null && c.quantity > 1 && <p className="text-[11px] text-gray-400">{clp(unit)} c/u</p>}
                        </div>
                      ) : (
                        <div className="w-32">
                          <input type="number" min="0" step="1" inputMode="numeric" autoFocus={idx === 0}
                            aria-label={`Precio por unidad de ${c.name}`}
                            value={linePrices[c.productId] ?? ''}
                            onChange={(e) => { setLinePrices((lp) => ({ ...lp, [c.productId]: e.target.value })); setPriceError(''); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') confirmPrices(); }}
                            className={`w-full border ${belowMin ? 'border-red-400' : 'border-gray-300'} rounded-lg px-2 py-1.5 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500`} />
                          <p className="text-[10px] text-gray-400 text-right mt-0.5">por unidad</p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {fixedTotal > 0 && (
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Otros productos (precio fijo)</span>
                  <span className="tabular-nums">{clp(fixedTotal)}</span>
                </div>
              )}

              {priceError && <div className="bg-red-50 text-red-700 text-xs rounded-lg px-3 py-2">{priceError}</div>}
            </div>

            <div className="px-6 py-4 border-t border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-600">Total de la venta</span>
                <span className="text-xl font-bold text-gray-900 tabular-nums">{confirmedTotal != null ? clp(confirmedTotal) : '—'}</span>
              </div>
              <button onClick={confirmPrices}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl py-3 text-sm transition">
                Confirmar y continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de checkout */}
      {showCheckout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="ui-section-title">Finalizar compra</h2>
              <button
                onClick={closeCheckout}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-lg font-bold transition"
              >
                ×
              </button>
            </div>

            {/* Body con scroll */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

              {/* Cliente */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="ui-subsection-title">Cliente</h3>
                  <button type="button" onClick={() => { setShowNewClient((s) => !s); setClientId(''); }}
                    className="text-xs font-medium text-blue-600 hover:underline">
                    {showNewClient ? 'Usar cliente existente' : '+ Nuevo cliente'}
                  </button>
                </div>

                {!showNewClient ? (
                  <div className="space-y-3">
                    <select value={clientId} onChange={(e) => setClientId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                      <option value="">— Sin cliente / consumidor final —</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}{c.rut ? ` · ${c.rut}` : ''}</option>
                      ))}
                    </select>
                    {selectedClient ? (
                      <p className="text-xs text-gray-500">
                        {selectedClient.rut ? `RUT ${selectedClient.rut}` : 'Sin RUT'}
                        {selectedClient.email ? ` · ${selectedClient.email}` : ''}
                        {selectedClient.phone ? ` · ${selectedClient.phone}` : ''}
                      </p>
                    ) : contactVisible && (
                      // Sin cliente: los datos de contacto solo se piden si la venta va con despacho.
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nombre (opcional)"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                        <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Teléfono (opcional)"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                        <input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="Email (opcional)"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm sm:col-span-2" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-xl p-3 space-y-2 bg-gray-50">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input value={newClient.name} onChange={(e) => setNewClient((f) => ({ ...f, name: e.target.value }))} placeholder="Nombre / Razón social *"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm sm:col-span-2" />
                      <input value={newClient.rut} onChange={(e) => setNewClient((f) => ({ ...f, rut: e.target.value }))} placeholder="RUT"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                      <input value={newClient.giro} onChange={(e) => setNewClient((f) => ({ ...f, giro: e.target.value }))} placeholder="Giro"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                      <input value={newClient.email} onChange={(e) => setNewClient((f) => ({ ...f, email: e.target.value }))} placeholder="Email"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                      <input value={newClient.phone} onChange={(e) => setNewClient((f) => ({ ...f, phone: e.target.value }))} placeholder="Teléfono"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                      <input value={newClient.address} onChange={(e) => setNewClient((f) => ({ ...f, address: e.target.value }))} placeholder="Dirección"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm sm:col-span-2" />
                      <input value={newClient.commune} onChange={(e) => setNewClient((f) => ({ ...f, commune: e.target.value }))} placeholder="Comuna"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                      <input value={newClient.city} onChange={(e) => setNewClient((f) => ({ ...f, city: e.target.value }))} placeholder="Ciudad"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <button type="button" onClick={saveNewClient}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">
                      Guardar cliente
                    </button>
                  </div>
                )}
              </div>

              {/* Documento tributario */}
              {billingConns.length > 0 && (
                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2 cursor-pointer">
                    <input type="checkbox" checked={emitDte} onChange={(e) => setEmitDte(e.target.checked)} className="rounded" />
                    Emitir documento tributario
                  </label>
                  {emitDte && (
                    <div className="space-y-2 pl-6">
                      <div className="flex gap-2">
                        <button type="button"
                          onClick={() => { setDteFamily('BOLETA'); setDteType('BOLETA'); }}
                          className={`flex-1 py-2 rounded-lg border-2 text-xs font-semibold ${dteFamily === 'BOLETA' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>
                          Boleta
                        </button>
                        <button type="button"
                          onClick={() => { setDteFamily('FACTURA'); setDteType('FACTURA'); }}
                          className={`flex-1 py-2 rounded-lg border-2 text-xs font-semibold ${dteFamily === 'FACTURA' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>
                          Factura
                        </button>
                      </div>

                      {dteFamily === 'FACTURA' && (
                        <div>
                          <label className="block text-xs text-gray-500 font-medium mb-1">Documento</label>
                          <select value={dteType} onChange={(e) => setDteType(e.target.value as any)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                            {FACTURA_DOCS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                          </select>
                        </div>
                      )}
                      {dteFamily === 'BOLETA' && (
                        <p className="text-xs text-gray-400">Boleta Electrónica (39)</p>
                      )}

                      {billingConns.length > 1 && (
                        <select value={dteConnId} onChange={(e) => setDteConnId(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                          {billingConns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      )}
                      {isFactura && !selectedClient?.rut && (
                        <p className="text-xs text-amber-600">La Factura necesita un cliente con RUT y razón social.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {servicesOnly && (
                <div className="px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800">
                  Venta de servicios: no genera orden de pedido ni despacho, solo se registra y se factura.
                </div>
              )}

              {/* Tipo de entrega (no aplica a servicios) */}
              {!servicesOnly && (<>
              <div>
                <h3 className="ui-subsection-title mb-3">Tipo de entrega</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <h3 className="ui-subsection-title mb-3">Dirección de despacho</h3>
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              </>)}

              {/* Fabricación: especificaciones de cada producto a pedido y abono */}
              {productionLines.length > 0 && (
                <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
                  <h3 className="ui-subsection-title">Fabricación</h3>
                  <p className="text-xs text-indigo-800">
                    {productionLines.length === 1 ? 'Se creará 1 orden de fabricación' : `Se crearán ${productionLines.length} órdenes de fabricación`} al confirmar la venta.
                  </p>
                  {productionLines.filter((c) => c.specFields?.length).map((c) => (
                    <div key={c.productId} className="rounded-lg border border-indigo-100 bg-white p-3">
                      <p className="mb-2 text-sm font-semibold text-gray-800">{c.name}{c.quantity > 1 && ` × ${c.quantity}`}</p>
                      <SpecInputs fields={c.specFields || []} value={c.specs || {}} compact
                        onChange={(v) => setCart((prev) => prev.map((x) => (x.productId === c.productId ? { ...x, specs: v } : x)))} />
                    </div>
                  ))}
                  {!onlineMethod && (
                    <div>
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" checked={abonoOn} onChange={(e) => { setAbonoOn(e.target.checked); if (e.target.checked && !abonoAmount) setAbonoAmount(String(suggestedAbono)); }} className="accent-blue-600" />
                        Cobrar un abono y dejar el saldo pendiente
                      </label>
                      {abonoOn && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="relative w-40">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                            <input type="number" min="1" value={abonoAmount} onChange={(e) => setAbonoAmount(e.target.value)}
                              className="w-full rounded-lg border border-gray-300 py-2 pl-6 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          </div>
                          <span className={`text-xs ${abonoOk ? 'text-gray-600' : 'text-red-600'}`}>
                            Saldo ${Math.max(0, total - abonoValue).toLocaleString('es-CL')} · sugerido ${suggestedAbono.toLocaleString('es-CL')}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Método de pago */}
              <div>
                <h3 className="ui-subsection-title mb-3">Método de pago</h3>
                {!multiPay ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[...Object.entries(PAYMENT_LABELS), ...onlineProviders.map((o) => [o.provider, o.name] as [string, string])].map(([v, l]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setPayments([{ method: v, amount: '' }])}
                        className={`py-2 rounded-lg border-2 text-xs font-semibold transition ${
                          payments[0].method === v
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {payments.map((p, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <select
                          value={p.method}
                          onChange={(e) => setPayments((ps) => ps.map((x, i) => (i === idx ? { ...x, method: e.target.value } : x)))}
                          className="w-36 shrink-0 border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {Object.entries(PAYMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <div className="relative flex-1 min-w-0">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                          <input
                            type="number" min="0" step="1" inputMode="numeric"
                            value={p.amount}
                            onChange={(e) => setPayments((ps) => ps.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))}
                            placeholder={p.amount === '' && resolvedPayments[idx].amount > 0 ? `${Math.round(resolvedPayments[idx].amount).toLocaleString('es-CL')} (saldo)` : 'Monto'}
                            className="w-full border border-gray-300 rounded-lg pl-6 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setPayments((ps) => ps.filter((_, i) => i !== idx))}
                          aria-label="Quitar medio de pago"
                          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 text-lg leading-none"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <p className={`text-xs ${Math.abs(payDiff) < 1 ? 'text-emerald-700' : 'text-amber-700'}`}>
                      Pagado ${Math.round(paidSum).toLocaleString('es-CL')} de ${Math.round(total).toLocaleString('es-CL')}
                      {payDiff >= 1 && ` · Falta $${Math.round(payDiff).toLocaleString('es-CL')}`}
                      {payDiff <= -1 && ` · Sobra $${Math.round(-payDiff).toLocaleString('es-CL')}`}
                      {payments.filter((x) => x.amount === '').length > 1 && ' · Deja vacío solo un monto (toma el saldo)'}
                    </p>
                  </div>
                )}
                {onlineMethod && (
                  <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5 space-y-2">
                    <p className="text-xs text-blue-800">
                      Se genera un link y un QR de {onlineMethod === 'FLOW' ? 'Flow' : 'Mercado Pago'}. La venta se registra (y descuenta stock) cuando el cliente paga.
                      {onlineProviders.find((o) => o.provider === onlineMethod)?.environment === 'test' && ' · Cuenta en modo prueba.'}
                    </p>
                    <label className="flex items-center gap-2 text-xs text-gray-700">
                      <input type="checkbox" checked={remoteLink} onChange={(e) => setRemoteLink(e.target.checked)} className="accent-blue-600" />
                      El cliente paga a distancia (el link dura 24 horas)
                    </label>
                  </div>
                )}
                {payments.length < 4 && !onlineMethod && (
                  <button
                    type="button"
                    onClick={() => setPayments((ps) => {
                      const used = new Set(ps.map((x) => x.method));
                      const next = Object.keys(PAYMENT_LABELS).find((k) => !used.has(k)) || 'OTHER';
                      return [...ps, { method: next, amount: '' }];
                    })}
                    className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-800"
                  >
                    + Agregar otro medio de pago
                  </button>
                )}
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
                <span className="text-sm text-gray-600">{abonoActive ? `Abono (total $${total.toLocaleString('es-CL', { maximumFractionDigits: 0 })})` : 'Total a cobrar'}</span>
                <span className="text-xl font-bold text-gray-900">${payTarget.toLocaleString('es-CL', { maximumFractionDigits: 0 })}</span>
              </div>
              <button
                onClick={checkout}
                disabled={loading || !payOk}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm transition"
              >
                {loading ? 'Procesando...' : onlineMethod ? `Generar cobro con ${onlineMethod === 'FLOW' ? 'Flow' : 'Mercado Pago'}` : 'Confirmar venta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cobro en línea en curso (QR / link) */}
      {payReq && (
        <PaymentLinkModal
          request={payReq}
          onClose={closePayReq}
          onPaid={(r) => { if (r.saleId) finishSale(r.saleId, r.provider, r.amount).catch(() => {}); }}
          note={emitDte ? 'La boleta/factura se emite al confirmarse el pago con esta ventana abierta. Si la cierras antes, emítela desde la venta.' : undefined}
        />
      )}

      {/* Modal de orden de trabajo */}
      {showWorkOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="ui-section-title">
                {createdWorkOrder ? 'Orden de trabajo creada' : 'Crear orden de trabajo'}
              </h2>
              <button
                onClick={closeWorkOrderModal}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-lg font-bold transition"
              >
                ×
              </button>
            </div>

            {createdWorkOrder ? (
              <div className="px-6 py-5 space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
                  Orden de trabajo N° {String(createdWorkOrder.folio).padStart(4, '0')} creada — sin cobrar ni descontar stock.
                  Se abrió el formato en una pestaña nueva para imprimir; si tu navegador bloqueó la ventana, usa el botón de abajo.
                </div>

                <button
                  onClick={() => printWorkOrder(createdWorkOrder.id)}
                  className="w-full border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold rounded-xl py-2.5 text-sm transition"
                >
                  🖨️ Imprimir
                </button>

                <div>
                  <label className="block text-xs text-gray-500 font-medium mb-1">Enviar por correo</label>
                  <div className="flex gap-2">
                    <input value={sendEmailTo} onChange={(e) => setSendEmailTo(e.target.value)}
                      placeholder="correo@cliente.com" type="email"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                    <button
                      onClick={sendWorkOrderEmail}
                      disabled={sendingWorkOrderEmail || !sendEmailTo.trim()}
                      className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg px-4 text-sm transition"
                    >
                      {sendingWorkOrderEmail ? 'Enviando...' : 'Enviar'}
                    </button>
                  </div>
                  {workOrderEmailMsg && (
                    <p className={`text-xs mt-1.5 ${workOrderEmailMsg.startsWith('Enviado') ? 'text-green-600' : 'text-red-600'}`}>
                      {workOrderEmailMsg}
                    </p>
                  )}
                </div>

                <button
                  onClick={closeWorkOrderModal}
                  className="w-full bg-gray-900 hover:bg-black text-white font-semibold rounded-xl py-2.5 text-sm transition"
                >
                  Listo
                </button>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                  <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    Queda pendiente, sin cobrar ni descontar stock. Se puede imprimir para el cliente y, si acepta, se cobra desde "Órdenes de trabajo".
                  </p>

                  <div>
                    <h3 className="ui-subsection-title mb-2">Cliente (opcional)</h3>
                    <select value={clientId} onChange={(e) => setClientId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white mb-2">
                      <option value="">— Sin cliente registrado —</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}{c.rut ? ` · ${c.rut}` : ''}</option>
                      ))}
                    </select>
                    {!selectedClient && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nombre (opcional)"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                        <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Teléfono (opcional)"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                        <input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="Email (opcional)"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm sm:col-span-2" />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs text-gray-500 font-medium mb-1">Notas (opcional)</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      placeholder="Observaciones..."
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="border-t border-gray-100 pt-3 space-y-1">
                    {cart.map((item) => (
                      <div key={item.productId} className="flex justify-between text-xs text-gray-500">
                        <span className="truncate max-w-[220px]">{item.name} x{item.quantity}</span>
                        <span>${(item.price * item.quantity).toLocaleString('es-CL', { maximumFractionDigits: 0 })}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-gray-100">
                  {workOrderError && (
                    <div className="bg-red-50 text-red-700 text-xs rounded-lg px-3 py-2 mb-3">{workOrderError}</div>
                  )}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-gray-600">Total estimado</span>
                    <span className="text-xl font-bold text-gray-900">${total.toLocaleString('es-CL', { maximumFractionDigits: 0 })}</span>
                  </div>
                  <button
                    onClick={createWorkOrderFromCart}
                    disabled={creatingWorkOrder}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm transition"
                  >
                    {creatingWorkOrder ? 'Creando...' : 'Crear orden de trabajo'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
