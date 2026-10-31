import { useCallback, useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { ArrowLeftRight, Boxes, CalendarClock, History, PackageMinus, Pencil, Plus, Search, SlidersHorizontal, TriangleAlert, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { formatINR } from '@salon/shared';
import ImportModal from '../../components/ImportModal.jsx';
import { Badge, Button, Card, CardHeader, Checkbox, cx, DataTable, EmptyState, Input, PageHeader, Pagination, Select, StatusBadge } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate } from '../../lib/format.js';
import { useDebounced } from '../../lib/hooks.js';
import { invalidateStock, productSize } from './common.jsx';
import { AdjustModal, MovementsModal, ProductFormModal, TransferModal, UsageModal } from './productDialogs.jsx';

const ALERT_PREVIEW = 6;

// Filter defaults are left out of the URL; anything else lives in it so links like /products?lowStock=true work.
const DEFAULT_PARAMS = { q: '', retail: '', status: 'active', lowStock: 'false', page: '1' };

function readFilters(searchParams) {
  const retail = searchParams.get('retail');
  const status = searchParams.get('status');
  return {
    retail: retail === 'true' || retail === 'false' ? retail : '',
    status: status === 'inactive' || status === 'all' ? status : 'active',
    lowStock: searchParams.get('lowStock') === 'true',
  };
}

export default function ProductsPage() {
  const { branchId, canManage, branches } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [dialog, setDialog] = useState(null); // null | { type: 'edit' | 'usage' | 'adjust' | 'movements' | 'transfer' | 'import', product? }
  const q = useDebounced(search.trim());
  const canTransfer = canManage && branches.length > 1;
  const filters = readFilters(searchParams);
  const page = Math.max(1, Number.parseInt(searchParams.get('page'), 10) || 1);

  const updateParams = useCallback(
    (changes) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            const text = String(value ?? '');
            if (text === DEFAULT_PARAMS[key] || text === '') next.delete(key);
            else next.set(key, text);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Push the debounced search into the URL (and back to page 1) once typing pauses.
  const urlQ = searchParams.get('q') ?? '';
  useEffect(() => {
    if (q !== urlQ) updateParams({ q, page: 1 });
  }, [q, urlQ, updateParams]);

  const params = { q: urlQ, retail: filters.retail, status: filters.status, page };
  if (filters.lowStock) params.lowStock = 'true';
  const products = useQuery({
    queryKey: [branchId, 'products', params],
    queryFn: () => api(`/products?${new URLSearchParams(params)}`),
    placeholderData: keepPreviousData,
  });

  const toggleStatus = useMutation({
    mutationFn: (product) => api(`/products/${product.id}/status`, { method: 'PATCH', body: { isActive: !product.isActive } }),
    onSuccess: (product) => {
      toast.success(`${product.name} ${product.isActive ? 'activated' : 'deactivated'}`);
      invalidateStock(queryClient, branchId);
    },
    onError: (err) => toast.error(err.message),
  });

  const setFilter = (key, value) => updateParams({ [key]: value, page: 1 });
  const setPage = (next) => updateParams({ page: next });
  const open = (type, product) => setDialog({ type, product });
  const filtered = Boolean(urlQ || filters.retail || filters.lowStock || filters.status !== 'active');

  const columns = [
    {
      key: 'name',
      header: 'Product',
      render: (p) => (
        <div>
          <div className="font-medium text-slate-900">{p.name}</div>
          <div className="text-xs text-slate-500">
            {[p.brand, productSize(p)].filter(Boolean).join(' · ')}
            {!p.isRetail && <Badge className="ml-1">Consumable</Badge>}
          </div>
        </div>
      ),
    },
    { key: 'barcode', header: 'Barcode', className: 'whitespace-nowrap', render: (p) => p.barcode ?? '—' },
    { key: 'sale', header: 'Sale price', className: 'text-right tabular-nums', render: (p) => formatINR(p.salePricePaise) },
    { key: 'mrp', header: 'MRP', className: 'text-right tabular-nums', render: (p) => formatINR(p.mrpPaise) },
    {
      key: 'stock',
      header: 'Stock',
      className: 'text-right tabular-nums whitespace-nowrap',
      render: (p) => (
        <span className="inline-flex items-center gap-1.5">
          {p.isLow && <Badge tone={p.stockOnHand <= 0 ? 'rose' : 'amber'}>{p.stockOnHand <= 0 ? 'Out' : 'Low'}</Badge>}
          <span className={cx('font-medium', p.stockOnHand < 0 ? 'text-rose-700' : 'text-slate-900')}>{p.stockOnHand}</span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge active={p.isActive} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (p) => (
        <div className="flex justify-end gap-0.5">
          <IconAction label="Stock history" icon={History} onClick={() => open('movements', p)} />
          <IconAction label="Use in salon" icon={PackageMinus} onClick={() => open('usage', p)} />
          {canManage && <IconAction label="Adjust stock" icon={SlidersHorizontal} onClick={() => open('adjust', p)} />}
          {canTransfer && <IconAction label="Transfer to another branch" icon={ArrowLeftRight} onClick={() => open('transfer', p)} />}
          {canManage && <IconAction label="Edit" icon={Pencil} onClick={() => open('edit', p)} />}
          {canManage && (
            <Button variant="ghost" size="sm" onClick={() => toggleStatus.mutate(p)} disabled={toggleStatus.isPending}>
              {p.isActive ? 'Deactivate' : 'Activate'}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Products & stock"
        description="Retail products and salon consumables, with live stock for this branch."
        actions={
          canManage && (
            <>
              {canTransfer && (
                <Button variant="secondary" onClick={() => open('transfer', null)}>
                  <ArrowLeftRight className="size-4" /> Transfer
                </Button>
              )}
              <Button variant="secondary" onClick={() => open('import')}>
                <Upload className="size-4" /> Import
              </Button>
              <Button onClick={() => open('edit', {})}>
                <Plus className="size-4" /> Add product
              </Button>
            </>
          )
        }
      />

      <StockAlerts onShowLow={() => setFilter('lowStock', true)} />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              type="search"
              placeholder="Search name, brand or barcode"
              aria-label="Search products"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select aria-label="Type" value={filters.retail} onChange={(e) => setFilter('retail', e.target.value)} className="sm:w-auto">
            <option value="">Retail & consumables</option>
            <option value="true">Retail only</option>
            <option value="false">Consumables only</option>
          </Select>
          <Select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className="sm:w-auto">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
          <Checkbox label="Low stock only" checked={filters.lowStock} onChange={(e) => setFilter('lowStock', e.target.checked)} />
        </div>
        <DataTable
          columns={columns}
          rows={products.data?.items}
          loading={products.isPending}
          error={products.error}
          empty={
            filtered ? (
              <EmptyState title="No products match these filters" />
            ) : (
              <EmptyState
                icon={Boxes}
                title="No products yet"
                description="Add the products you sell and use, or import your list from Excel."
                action={
                  canManage && (
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => open('import')}>Import from Excel</Button>
                      <Button onClick={() => open('edit', {})}>Add product</Button>
                    </div>
                  )
                }
              />
            )
          }
        />
        {products.data && <Pagination page={products.data.page} pageSize={products.data.pageSize} total={products.data.total} onChange={setPage} />}
      </Card>

      {dialog?.type === 'edit' && <ProductFormModal product={dialog.product} onClose={() => setDialog(null)} />}
      {dialog?.type === 'usage' && <UsageModal product={dialog.product} onClose={() => setDialog(null)} />}
      {dialog?.type === 'adjust' && <AdjustModal product={dialog.product} onClose={() => setDialog(null)} />}
      {dialog?.type === 'movements' && <MovementsModal product={dialog.product} onClose={() => setDialog(null)} />}
      {dialog?.type === 'transfer' && <TransferModal product={dialog.product} onClose={() => setDialog(null)} />}
      {dialog?.type === 'import' && (
        <ImportModal
          title="Import products from Excel"
          description="Rows matching an existing product name update it; blank cells keep the current details."
          columns="Name, Brand, Barcode, Unit, Volume, MRP, Sale price, Cost price, Opening stock"
          hint="Prices in rupees. Unit is pcs, ml, L, g, kg or pkt. Opening stock is only added for new products; a blank sale price means MRP."
          templatePath="/products/import-template"
          templateName="products-import-template.xlsx"
          uploadPath="/products/import"
          invalidate={[[branchId, 'products'], [branchId, 'stock-alerts']]}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

function IconAction({ label, icon: Icon, onClick }) {
  return (
    <Button variant="ghost" size="icon" onClick={onClick} aria-label={label} title={label}>
      <Icon className="size-4" />
    </Button>
  );
}

function StockAlerts({ onShowLow }) {
  const { branchId } = useAuth();
  const alerts = useQuery({ queryKey: [branchId, 'stock-alerts'], queryFn: () => api('/stock/alerts') });
  const { lowStock = [], expiring = [] } = alerts.data ?? {};
  if (!lowStock.length && !expiring.length) return null;

  return (
    <Card className="mb-4">
      <CardHeader title="Stock alerts" description="Products running low and purchase lots close to expiry." />
      <div className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0">
        <div className="p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-900">
            <TriangleAlert className="size-4 text-amber-500" aria-hidden /> Low stock ({lowStock.length})
          </p>
          {lowStock.length === 0 ? (
            <p className="text-sm text-slate-500">Everything is well stocked.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {lowStock.slice(0, ALERT_PREVIEW).map((p) => (
                <li key={p.id} className="flex justify-between gap-3">
                  <span className="truncate text-slate-700">{p.name}</span>
                  <span className={cx('shrink-0 tabular-nums', p.stockOnHand <= 0 ? 'text-rose-600' : 'text-amber-700')}>
                    {p.stockOnHand} left (alert at {p.lowStockAt})
                  </span>
                </li>
              ))}
            </ul>
          )}
          {lowStock.length > 0 && (
            <Button variant="ghost" size="sm" className="mt-2 -ml-2.5" onClick={onShowLow}>Show all low stock</Button>
          )}
        </div>
        <div className="p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-900">
            <CalendarClock className="size-4 text-rose-500" aria-hidden /> Expiring lots ({expiring.length})
          </p>
          {expiring.length === 0 ? (
            <p className="text-sm text-slate-500">No lots expire in the next 30 days.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {expiring.slice(0, ALERT_PREVIEW).map((lot) => (
                <li key={lot.id} className="flex justify-between gap-3">
                  <span className="truncate text-slate-700">
                    {lot.productName}
                    {lot.lotNo && <span className="text-slate-500"> · Lot {lot.lotNo}</span>}
                  </span>
                  <span className="shrink-0">
                    {lot.expired ? <Badge tone="rose">Expired {formatDate(lot.expiresOn)}</Badge> : <Badge tone="amber">{formatDate(lot.expiresOn)}</Badge>}
                  </span>
                </li>
              ))}
              {expiring.length > ALERT_PREVIEW && <li className="text-slate-500">and {expiring.length - ALERT_PREVIEW} more</li>}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
