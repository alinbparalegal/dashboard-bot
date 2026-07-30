// Cliente de solo lectura para la API de GoHighLevel (contacts/search).
// Incorpora un limitador de ritmo global (~2.5 req/s) para no golpear el 429 de GHL,
// tal como se validó a mano en las sesiones anteriores del dashboard.

const GHL_URL = 'https://services.leadconnectorhq.com/contacts/search';
const MIN_INTERVAL_MS = 420; // ~2.4 req/s, con margen

let queue = Promise.resolve();

function rateLimited(fn) {
  const run = queue.then(async () => {
    const result = await fn();
    await new Promise(r => setTimeout(r, MIN_INTERVAL_MS));
    return result;
  });
  // Evita que un rechazo rompa la cola para las siguientes llamadas
  queue = run.catch(() => {});
  return run;
}

async function searchCount({ token, locationId, filters, sort }) {
  return rateLimited(async () => {
    const body = { locationId, pageLimit: 1, filters };
    if (sort) body.sort = sort;
    const res = await fetch(GHL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GHL ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    return data.total ?? 0;
  });
}

function dateRangeFilter(gte, lte) {
  return { field: 'dateAdded', operator: 'range', value: { gte, lte } };
}

async function countTag(brand, tag, gte, lte) {
  return searchCount({
    token: brand.token,
    locationId: brand.locationId,
    filters: [
      { field: 'tags', operator: 'contains', value: tag },
      dateRangeFilter(gte, lte),
    ],
  });
}

async function countTagPair(brand, tag1, tag2, gte, lte) {
  return searchCount({
    token: brand.token,
    locationId: brand.locationId,
    filters: [
      { field: 'tags', operator: 'contains', value: tag1 },
      { field: 'tags', operator: 'contains', value: tag2 },
      dateRangeFilter(gte, lte),
    ],
  });
}

async function countBotField(brand, gte, lte) {
  return searchCount({
    token: brand.token,
    locationId: brand.locationId,
    filters: [
      { field: `customFields.${brand.botFieldId}`, operator: 'eq', value: 'BOT' },
      dateRangeFilter(gte, lte),
    ],
  });
}

async function countAll(brand, gte, lte) {
  return searchCount({
    token: brand.token,
    locationId: brand.locationId,
    filters: [dateRangeFilter(gte, lte)],
  });
}

// Igual que countTag pero devuelve los contactos (id, nombre, tags), no solo el total.
async function listByTag(brand, tag, gte, lte, pageLimit = 100) {
  return rateLimited(async () => {
    const res = await fetch(GHL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${brand.token}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        locationId: brand.locationId,
        pageLimit,
        filters: [
          { field: 'tags', operator: 'contains', value: tag },
          dateRangeFilter(gte, lte),
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GHL ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    return (data.contacts || []).map(c => ({
      id: c.id,
      nombre: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' ') || '(sin nombre)',
      tags: c.tags || [],
      dateAdded: c.dateAdded,
      dateUpdated: c.dateUpdated,
    }));
  });
}

async function getContact(brand, contactId) {
  return rateLimited(async () => {
    const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
      headers: { Authorization: `Bearer ${brand.token}`, Version: '2021-07-28' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GHL ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    return data.contact;
  });
}

module.exports = { countTag, countTagPair, countBotField, countAll, listByTag, getContact };
