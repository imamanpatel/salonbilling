/*
 * Easy Salon → Sabilling exporter (read-only).
 *
 * Sign in to your Easy Salon panel as superadmin, open the browser console (F12 → Console), paste this whole
 * file and press Enter. It reads your data page by page (nothing is changed in Easy Salon) and downloads
 * `easysalon-export-<date>.json`. Then run, from apps/api:
 *
 *   npm run import:easysalon -- --file path/to/easysalon-export-<date>.json --branch "Jaunpur"
 *
 * The file contains client names and phone numbers: keep it private and delete it after importing.
 */
(() => {
  const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const strip = (html) =>
    text(new DOMParser().parseFromString(`<div>${String(html ?? '').replace(/<br\s*\/?>/gi, '; ')}</div>`, 'text/html').body);
  const pick = (value, re) => (String(value ?? '').match(re) || [])[1];
  const absolute = (src) => (src ? new URL(src, location.href).href : null);

  async function get(url, init) {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, { credentials: 'include', ...init });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.text();
      } catch (err) {
        if (attempt >= 3) throw err;
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  const page = async (url, init) => new DOMParser().parseFromString(await get(url, init), 'text/html');
  const post = (url, data) =>
    get(url, { method: 'POST', body: new URLSearchParams(data), headers: { 'X-Requested-With': 'XMLHttpRequest' } });

  async function pool(items, size, fn, label) {
    const out = new Array(items.length);
    let next = 0;
    let done = 0;
    await Promise.all(
      Array.from({ length: size }, async () => {
        while (next < items.length) {
          const i = next++;
          out[i] = await fn(items[i]);
          if (++done % 100 === 0) console.log(`  ${label}: ${done}/${items.length}`);
        }
      }),
    );
    return out;
  }

  /** Form fields of a page as { name: [values] } (selects give "label#value"; unchecked boxes are skipped). */
  function formValues(doc, keep) {
    const values = {};
    doc.querySelectorAll('form input, form select, form textarea').forEach((el) => {
      const key = el.name || el.id;
      if (!key || (keep && !keep.includes(key))) return;
      let value;
      if (el.tagName === 'SELECT') value = [...el.selectedOptions].map((o) => `${o.textContent.trim()}#${o.value}`).join(',');
      else if (el.type === 'checkbox' || el.type === 'radio') value = el.checked ? el.value : null;
      else value = el.value;
      if (value !== null) (values[key] ??= []).push(value);
    });
    return values;
  }

  const tableRows = (table) =>
    [...(table?.querySelectorAll('tbody tr') ?? [])].map((tr) => ({
      cells: [...tr.querySelectorAll('td')].map(text),
      links: [...tr.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
      imgs: [...tr.querySelectorAll('img')].map((img) => absolute(img.getAttribute('src'))),
    }));
  const tableWithHeader = (doc, header) =>
    [...doc.querySelectorAll('table')].filter((t) => [...t.querySelectorAll('thead th')].some((th) => text(th) === header));

  /** All rows of a server-side DataTables endpoint in one request (paging on these endpoints is unreliable). */
  async function dataTable(url, columns) {
    const body = { draw: '1', start: '0', length: '100000', 'search[value]': '', 'order[0][column]': '1', 'order[0][dir]': 'asc' };
    for (let i = 0; i < columns; i++) {
      body[`columns[${i}][data]`] = String(i);
      body[`columns[${i}][searchable]`] = 'true';
      body[`columns[${i}][orderable]`] = 'true';
    }
    return JSON.parse(await post(url, body)).aaData;
  }

  const decodeCfEmail = (hex) => {
    if (!hex) return null;
    const key = parseInt(hex.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    return out;
  };

  async function invoice(id) {
    const doc = await page(`invoice.php?inv=${id}`);
    const tables = [...doc.querySelectorAll('table')];
    const head = {};
    tables[0]?.querySelectorAll('tr').forEach((tr) => {
      const cells = [...tr.children].map(text);
      if (cells.length >= 2) head[cells[0]] = cells[1].replace(/^:\s*/, '');
    });
    const items = tables.find((t) => /Service & Product/.test(t.textContent));
    const summary = tables.find((t) => /Amount Paid/.test(t.textContent));
    return {
      head,
      items: [...(items?.querySelectorAll('tr') ?? [])].slice(1).map((tr) => [...tr.children].map(text)).filter((c) => c.length >= 6),
      summary: [...(summary?.querySelectorAll('tr') ?? [])].map((tr) => [...tr.children].map(text)),
      letterhead: text(doc.body).split('Contact :')[0].trim(),
    };
  }

  async function staffPages(listUrl, editParam) {
    const doc = await page(listUrl);
    const rows = [...doc.querySelectorAll('table')].flatMap(tableRows);
    const ids = [...new Set(rows.flatMap((r) => r.links.map((l) => pick(l, new RegExp(`^${listUrl.replace('.', '\\.')}\\?(?:id|activeid)=(\\d+)$`)))).filter(Boolean))];
    return pool(ids, 4, async (id) => {
      const row = rows.find((r) => r.links.some((l) => l === `${listUrl}?id=${id}` || l === `${listUrl}?activeid=${id}`));
      return {
        id: Number(id),
        active: !!doc.querySelector(`a[href="${listUrl}?d=${id}"]`),
        cells: row?.cells ?? [],
        form: formValues(await page(`${listUrl}?${editParam}=${id}`)),
      };
    }, listUrl);
  }

  async function exportEasySalon({ download = true } = {}) {
    const started = Date.now();
    const out = { source: 'easysalon', version: 1, exportedAt: new Date().toISOString(), baseUrl: location.href.replace(/[^/]*$/, '') };

    console.log('Easy Salon export: branch & settings');
    const branches = await page('all_branches.php');
    const branchRow = tableRows(tableWithHeader(branches, 'Branch name')[0])[0];
    out.branch = {
      cells: branchRow?.cells ?? [],
      logo: branchRow?.imgs[0] ?? null,
      email: decodeCfEmail(branches.querySelector('[data-cfemail]')?.getAttribute('data-cfemail')),
    };
    out.settings = formValues(await page('software_setting.php'), ['redeempoints', 'redeempointsprice', 'maxredeempoints']);

    console.log('Easy Salon export: catalogue');
    out.categories = (await dataTable('ajax/fetch_category.php', 2)).map((r) => ({ id: Number(pick(r.action, /deleteCat\((\d+)\)/)), name: strip(r.cat) }));
    const services = await page('services.php');
    out.services = tableRows(tableWithHeader(services, 'Membership price')[0]).map((r) => ({
      id: Number(pick(r.links.join(' '), /services\.php\?id=(\d+)/)),
      cells: r.cells,
    }));
    const products = await page('products.php');
    out.products = tableRows(products.querySelector('#product_table')).map((r) => ({ id: Number(pick(r.links.join(' '), /eid=(\d+)/)), cells: r.cells }));
    const stock = await page('productsreport.php');
    out.stock = tableRows(stock.querySelector('#available_stock_tbl')).map((r) => ({ productId: Number(pick(r.links.join(' '), /pid=(\d+)/)), cells: r.cells }));
    out.vendors = tableRows((await page('vendor.php')).querySelector('#vendors_table')).map((r) => ({ id: Number(pick(r.links.join(' '), /vid=(\d+)/)), cells: r.cells }));
    out.memberships = tableRows(tableWithHeader(await page('memberships.php'), 'Membership name')[0]).map((r) => ({ id: Number(pick(r.links.join(' '), /eid=(\d+)/)), cells: r.cells }));
    out.coupons = tableRows(tableWithHeader(await page('coupons.php'), 'Coupon Code')[0]).map((r) => ({ id: Number(pick(r.links.join(' '), /id=(\d+)/)), cells: r.cells }));
    const packageIds = [...new Set(tableRows(tableWithHeader(await page('packages.php'), 'Package')[0]).map((r) => pick(r.links.join(' '), /packages\.php\?id=(\d+)/)).filter(Boolean))];
    out.packages = await pool(packageIds, 4, async (id) => ({ id: Number(id), form: formValues(await page(`packages.php?id=${id}`)) }), 'packages');

    console.log('Easy Salon export: team');
    out.providers = await staffPages('beauticians.php', 'id');
    out.employees = await staffPages('employees.php', 'id');

    console.log('Easy Salon export: clients');
    const clientRows = await dataTable('ajax/fetch_clients_info.php', 13);
    out.clients = await pool(clientRows, 6, async (r) => ({
      id: Number(r.id),
      name: strip(r.name),
      phone: strip(r.cont),
      referralCode: strip(r.referral_code),
      gender: strip(r.gender),
      points: Number(r.points) || 0,
      detail: JSON.parse(await post(`ajax/fetch_clients_info.php?clientID=${r.id}`, {})),
    }), 'clients');
    out.wallet = (await dataTable('ajax/fetch_wallet_details.php', 5)).map((r) => ({
      clientId: Number(pick(r.action, /cid=(\d+)/)),
      phone: strip(r.cont),
      amount: strip(r.remaning_amount),
      date: strip(r.time_update),
    }));

    console.log('Easy Salon export: bills');
    const billRows = await dataTable('ajax/fetch_billing_history.php', 12);
    const paymentKeys = ['paid[]', 'method[]', 'adv', 'total'];
    out.bills = await pool(billRows, 6, async (r) => {
      const id = Number(pick(r.action, /inv=(\d+)/));
      const payMode = strip(r.pay_mode);
      const split = payMode.split(';').filter((m) => m.trim()).length > 1 || /Reward|E-wallet/.test(payMode);
      return {
        id,
        clientId: Number(pick(r.action, /c_id=(\d+)/)),
        date: strip(r.doa),
        phone: strip(r.cont),
        advance: strip(r.advance),
        notes: strip(r.notes),
        payMode,
        invoice: await invoice(id),
        payments: split ? formValues(await page(`billing.php?beid=${id}`), paymentKeys) : null,
      };
    }, 'bills');

    console.log('Easy Salon export: appointments, enquiries, expenses, website');
    const appointmentRows = await dataTable('ajax/fetch_appointment_history.php', 12);
    out.appointments = await pool(appointmentRows, 4, async (r) => {
      const id = Number(pick(r.action, /appointment\.php\?id=(\d+)/));
      return { id, bookedOn: strip(r.appdate), providers: strip(r.providers), form: formValues(await page(`appointment.php?id=${id}`)) };
    }, 'appointments');
    const enquiries = await page('enquiryreport.php', {
      method: 'POST',
      body: new URLSearchParams({ date: '01/01/2000 - 12/31/2099', enquirytype: '', leadsource: '', leadstatus: '', leaduser: '', submit: 'Filter' }),
    });
    out.enquiries = [...enquiries.querySelectorAll('table')].flatMap(tableRows).map((r) => ({ id: Number(pick(r.links.join(' '), /enquiry\.php\?id=(\d+)/)), cells: r.cells }));
    const expenses = await post('ajax/expenses_filter.php', { startdate: '2000-01-01', enddate: '2099-12-31', filter_type: 'expenses' });
    out.expenses = tableRows(new DOMParser().parseFromString(`<table><tbody>${expenses}</tbody></table>`, 'text/html').querySelector('table'))
      .map((r) => ({ id: Number(pick(r.links.join(' '), /eid=(\d+)/)), cells: r.cells }))
      .filter((r) => r.id);
    out.feedback = tableRows(tableWithHeader(await page('feedback.php'), 'Review')[0]).map((r) => ({ cells: r.cells }));
    out.gallery = tableRows(tableWithHeader(await page('photo_gallery.php'), 'Gallery Photo')[0]).flatMap((r) => r.imgs).filter(Boolean);
    out.offers = tableRows(tableWithHeader(await page('offers.php'), 'Offer image')[0]).flatMap((r) => r.imgs).filter(Boolean);

    out.counts = Object.fromEntries(Object.entries(out).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]));
    console.log(`Easy Salon export finished in ${Math.round((Date.now() - started) / 1000)}s`, out.counts);
    if (download) {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
      link.download = `easysalon-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
    }
    return out;
  }

  window.exportEasySalon = exportEasySalon;
  if (!window.__EASYSALON_NO_AUTORUN) exportEasySalon().catch((err) => console.error('Easy Salon export failed:', err));
})();
