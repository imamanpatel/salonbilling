import { useState } from 'react';
import { Boxes, Scissors, Upload, Users, Wallet } from 'lucide-react';
import ImportModal from '../../components/ImportModal.jsx';
import { Button, Card, PageHeader } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';

// In the order a salon should run them when moving from another software.
const IMPORTS = [
  {
    id: 'services',
    icon: Scissors,
    title: 'Services',
    summary: 'Your service menu with categories, durations and prices.',
    modal: {
      title: 'Import services from Excel',
      description: 'Rows matching an existing service (same category and name) update it.',
      columns: 'Category, Service name, For, Duration, Price, Member price, Reward points',
      hint: 'New categories are created automatically. Prices are in rupees, excluding tax.',
      templatePath: '/services/import-template',
      templateName: 'services-import-template.xlsx',
      uploadPath: '/services/import',
      invalidate: (branchId) => [[branchId, 'services'], [branchId, 'service-categories']],
    },
  },
  {
    id: 'clients',
    icon: Users,
    title: 'Clients',
    summary: 'Names, phone numbers, birthdays and anniversaries. Shared by all branches.',
    modal: {
      title: 'Import clients from Excel',
      description: 'Clients are matched by phone number: existing ones are updated, blank cells keep current details.',
      columns: 'Name, Phone, Gender, Email, Date of birth, Anniversary, Source, Address',
      hint: 'Dates as DD/MM/YYYY. Exports from other salon software usually work after matching the column order.',
      templatePath: '/clients/import-template',
      templateName: 'clients-import-template.xlsx',
      uploadPath: '/clients/import',
      invalidate: (branchId) => [[branchId, 'clients'], [branchId, 'client-segments']],
    },
  },
  {
    id: 'products',
    icon: Boxes,
    title: 'Products',
    summary: 'Retail and consumable products with prices and opening stock.',
    modal: {
      title: 'Import products from Excel',
      description: 'Rows matching an existing product update it.',
      columns: 'as in the template',
      hint: 'Download the template to see the columns. Prices are in rupees.',
      templatePath: '/products/import-template',
      templateName: 'products-import-template.xlsx',
      uploadPath: '/products/import',
      invalidate: (branchId) => [[branchId, 'products']],
    },
  },
  {
    id: 'balances',
    icon: Wallet,
    title: 'Opening balances',
    summary: 'Wallet balances, reward points and pending dues carried over for existing clients.',
    modal: {
      title: 'Import opening balances',
      description: 'Each client can be imported once. Clients must already exist (import clients first).',
      columns: 'Phone, Wallet balance (₹), Reward points, Pending due (₹), Note',
      hint: 'Amounts in rupees; leave a cell blank for zero. A pending due becomes an unpaid “Opening balance” bill.',
      templatePath: '/imports/opening-balances/template',
      templateName: 'opening-balances-template.xlsx',
      uploadPath: '/imports/opening-balances',
      invalidate: (branchId) => [[branchId, 'clients']],
    },
  },
];

export default function ImportsPage() {
  const { branchId, branch } = useAuth();
  const [open, setOpen] = useState(null);
  const active = IMPORTS.find((i) => i.id === open);

  return (
    <>
      <PageHeader title="Data import" description={`Bring your existing data into ${branch?.name ?? 'this branch'} from Excel.`} />

      <Card className="mb-6 p-5">
        <h2 className="text-sm font-semibold text-slate-900">Moving from another salon software?</h2>
        <p className="mt-1 text-sm text-slate-500">
          Export your data to Excel from the old software, copy it into our templates and import in this order, so that each step can find
          what the previous one created:
        </p>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {IMPORTS.map((item, index) => (
            <li key={item.id} className="flex gap-3 rounded-lg bg-slate-50 p-3 text-sm">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">{index + 1}</span>
              <span>
                <span className="block font-medium text-slate-900">{item.title}</span>
                <span className="text-slate-500">{item.summary}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-slate-500">
          Services and products are imported into the selected branch; clients are shared by every branch. Importing the same file again
          updates services, clients and products, and skips opening balances that were already imported.
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {IMPORTS.map((item) => (
          <Card key={item.id} className="flex flex-col p-5">
            <div className="mb-3 grid size-10 place-items-center rounded-full bg-brand-50 text-brand-600">
              <item.icon className="size-5" aria-hidden />
            </div>
            <h3 className="font-semibold text-slate-900">{item.title}</h3>
            <p className="mt-1 flex-1 text-sm text-slate-500">{item.summary}</p>
            <Button variant="secondary" className="mt-4 self-start" onClick={() => setOpen(item.id)}>
              <Upload className="size-4" /> Import {item.title.toLowerCase()}
            </Button>
          </Card>
        ))}
      </div>

      {active && <ImportModal {...active.modal} invalidate={active.modal.invalidate(branchId)} onClose={() => setOpen(null)} />}
    </>
  );
}
