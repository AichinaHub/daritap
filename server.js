'use strict';
// DariTap демо-сервері. Тәуелділіксіз (тек Node.js стандартты кітапханасы).
// Дерекқор: data/db.json (жергілікті JSON файл). Жүктелген файлдар: data/uploads
// (жалпыға ашық емес — тек рұқсаты бар рөлдерге API арқылы беріледі).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createSeed } = require('./seed');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 МБ
const MAX_BODY_BYTES = 8 * 1024 * 1024; // base64 үшін қор
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// ---------- Дерекқор ----------
function resetDb() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const seed = createSeed();
  fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
  return seed;
}

function loadDb() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) return resetDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

if (process.argv.includes('--reset-only')) {
  resetDb();
  console.log('DariTap: демо деректер қалпына келтірілді (data/db.json).');
  process.exit(0);
}

let db = loadDb();

function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { operatorLicense: null };
  }
}

// ---------- Сессиялар ----------
const sessions = new Map(); // token -> { userId, expires }

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function currentUser(req) {
  const token = parseCookies(req).dt_sid;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return db.users.find((u) => u.id === s.userId) || null;
}

function publicUser(u) {
  if (!u) return null;
  const ph = u.pharmacyId ? db.pharmacies.find((p) => p.id === u.pharmacyId) : null;
  return { id: u.id, username: u.username, role: u.role, name: u.name, pharmacyId: u.pharmacyId, pharmacyName: ph ? ph.name : null };
}

// ---------- HTTP көмекшілері ----------
class HttpError extends Error {
  constructor(status, code, fields) {
    super(code);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'bad_json'));
      }
    });
    req.on('error', reject);
  });
}

function requireRole(user, role) {
  if (!user) throw new HttpError(401, 'auth_required');
  if (user.role !== role) throw new HttpError(403, 'forbidden');
}

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const today = () => new Date().toISOString().slice(0, 10);
const newId = (prefix) => `${prefix}-${crypto.randomBytes(6).toString('hex')}`;

// ---------- Файлдар ----------
const FILE_TYPES = [
  { mime: 'application/pdf', ext: '.pdf', test: (b) => b.slice(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', ext: '.png', test: (b) => b.length > 8 && b[0] === 0x89 && b.slice(1, 4).toString('latin1') === 'PNG' },
  { mime: 'image/jpeg', ext: '.jpg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }
];

// Клиенттен { name, data(base64) } түрінде келген файлды тексеріп сақтайды.
// Түрі кеңейтім бойынша емес, файлдың нақты мазмұны (magic bytes) бойынша анықталады.
function storeUpload(file) {
  if (!file || typeof file.data !== 'string') return { error: 'file_required' };
  const b64 = file.data.replace(/^data:[^,]*,/, '');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return { error: 'file_required' };
  if (buf.length > MAX_FILE_BYTES) return { error: 'file_too_large' };
  const type = FILE_TYPES.find((t) => t.test(buf));
  if (!type) return { error: 'file_type' };
  const storedName = crypto.randomBytes(16).toString('hex') + type.ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buf);
  const originalName = str(file.name, 120).replace(/[^\p{L}\p{N} ._()-]/gu, '_') || 'document' + type.ext;
  return { file: { storedName, originalName, mime: type.mime, size: buf.length, uploadedAt: new Date().toISOString() } };
}

function sendStoredFile(res, meta) {
  if (!meta) throw new HttpError(404, 'not_found');
  const full = path.join(UPLOAD_DIR, path.basename(meta.storedName));
  if (!fs.existsSync(full)) throw new HttpError(404, 'not_found');
  res.writeHead(200, {
    'Content-Type': meta.mime,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(meta.originalName)}`,
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff'
  });
  fs.createReadStream(full).pipe(res);
}

const fileMeta = (f) => (f ? { originalName: f.originalName, mime: f.mime, size: f.size, uploadedAt: f.uploadedAt } : null);

// ---------- Лицензия және тауар көріністері ----------
const appForPharmacy = (pharmacyId) => db.applications.find((a) => a.pharmacyId === pharmacyId) || null;

function licenseStatus(pharmacyId) {
  const a = appForPharmacy(pharmacyId);
  return a ? a.status : 'none'; // none | pending | approved | rejected
}

// Жалпыға ашық лицензия ақпараты: тек тексеруші мақұлдаған мәліметтер.
// БСН, файл және ішкі түсініктемелер ешқашан жалпыға берілмейді.
function publicLicense(pharmacyId) {
  const a = appForPharmacy(pharmacyId);
  const status = a ? a.status : 'none';
  if (!a || status !== 'approved') return { status };
  return {
    status,
    licenseNumber: a.licenseNumber,
    orgName: a.orgName,
    issuer: a.issuer,
    issueDate: a.issueDate,
    expiryDate: a.expiryDate || null,
    reviewedAt: a.reviewedAt
  };
}

function purchaseBlock(p) {
  const st = licenseStatus(p.pharmacyId);
  if (st !== 'approved') return 'license_' + st;
  if (p.stock <= 0) return 'out_of_stock';
  return null;
}

function publicPharmacy(ph) {
  return { id: ph.id, name: ph.name, city: ph.city, address: ph.address, phone: ph.phone, branches: ph.branches };
}

function publicProduct(p, detailed = false) {
  const ph = db.pharmacies.find((x) => x.id === p.pharmacyId);
  const out = {
    id: p.id,
    name: p.name,
    inn: p.inn,
    category: p.category,
    form: p.form,
    dose: p.dose,
    pack: p.pack,
    price: p.price,
    stock: p.stock,
    inStock: p.stock > 0,
    rx: p.rx,
    image: p.image,
    pharmacy: publicPharmacy(ph),
    license: { status: licenseStatus(p.pharmacyId) },
    blockReason: purchaseBlock(p)
  };
  if (detailed) {
    out.manufacturer = p.manufacturer;
    out.instruction = p.instruction;
    out.license = publicLicense(p.pharmacyId);
    out.regDoc = p.regDoc
      ? { number: p.regDoc.number, issueDate: p.regDoc.issueDate, expiryDate: p.regDoc.expiryDate, hasFile: !!p.regDoc.file, verified: false }
      : null;
  }
  return out;
}

// ---------- Валидация ----------
function validateApplication(body, existing) {
  const v = {
    orgName: str(body.orgName, 200),
    bin: str(body.bin, 20),
    licenseNumber: str(body.licenseNumber, 60),
    issuer: str(body.issuer, 200),
    issueDate: str(body.issueDate, 10),
    expiryDate: str(body.expiryDate, 10),
    comment: str(body.comment, 1000)
  };
  const f = {};
  if (v.orgName.length < 2) f.orgName = 'required';
  if (!/^\d{12}$/.test(v.bin)) f.bin = 'bin';
  if (v.licenseNumber.length < 3) f.licenseNumber = 'required';
  if (v.issuer.length < 2) f.issuer = 'required';
  if (!isDate(v.issueDate)) f.issueDate = 'required';
  else if (v.issueDate > today()) f.issueDate = 'future';
  if (v.expiryDate) {
    if (!isDate(v.expiryDate)) f.expiryDate = 'date';
    else if (isDate(v.issueDate) && v.expiryDate <= v.issueDate) f.expiryDate = 'after_issue';
  }
  if (!body.file && !(existing && existing.file)) f.file = 'file_required';
  return { values: v, fieldErrors: f };
}

function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return /^7\d{10}$/.test(d) ? '+' + d : null;
}

// ---------- Тапсырыстар ----------
function orderView(o, forSeller = false) {
  const ph = db.pharmacies.find((p) => p.id === o.pharmacyId);
  const br = ph && ph.branches.find((b) => b.id === o.pickupBranchId);
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    customerName: o.customerName,
    phone: o.phone,
    pharmacy: ph ? { id: ph.id, name: ph.name } : null,
    pickup: br ? br.name : null,
    items: o.items,
    total: o.total,
    rxRequired: o.rxRequired,
    prescription: fileMeta(o.prescription),
    rxRejectReason: o.rxRejectReason || null,
    history: o.history,
    canViewPrescription: !!o.prescription,
    forSeller
  };
}

function restoreStock(o) {
  o.items.forEach((it) => {
    const p = db.products.find((x) => x.id === it.productId);
    if (p) p.stock += it.qty;
  });
}

function pushHistory(o, status, by) {
  o.status = status;
  o.updatedAt = new Date().toISOString();
  o.history.push({ status, at: o.updatedAt, by });
}

function createOrders(user, body) {
  const customerName = str(body.customerName, 120);
  const phone = normalizePhone(body.phone);
  const f = {};
  if (customerName.length < 3) f.customerName = 'required';
  if (!phone) f.phone = 'phone';
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new HttpError(400, 'cart_empty');

  // Дәріхана бойынша топтау — әр дәріханаға жеке тапсырыс.
  const groups = new Map();
  for (const it of items) {
    const p = db.products.find((x) => x.id === it.productId);
    const qty = Math.floor(Number(it.qty));
    if (!p || !(qty >= 1 && qty <= 99)) throw new HttpError(400, 'bad_item');
    const block = purchaseBlock(p);
    if (block) throw new HttpError(409, 'blocked', { productId: p.id, reason: block });
    if (qty > p.stock) throw new HttpError(409, 'not_enough_stock', { productId: p.id, stock: p.stock });
    if (!groups.has(p.pharmacyId)) groups.set(p.pharmacyId, []);
    groups.get(p.pharmacyId).push({ p, qty });
  }

  const pickups = body.pickups || {};
  const prescriptions = body.prescriptions || {};
  for (const [phId, list] of groups) {
    const ph = db.pharmacies.find((x) => x.id === phId);
    if (!ph.branches.some((b) => b.id === pickups[phId])) f['pickup_' + phId] = 'required';
    if (list.some((x) => x.p.rx) && !prescriptions[phId]) f['rx_' + phId] = 'file_required';
  }
  if (Object.keys(f).length) throw new HttpError(400, 'validation', f);

  // Файлдарды алдымен тексеру (бірі қате болса — ештеңе сақталмайды).
  const storedRx = {};
  for (const [phId, list] of groups) {
    if (!list.some((x) => x.p.rx)) continue;
    const r = storeUpload(prescriptions[phId]);
    if (r.error) {
      Object.values(storedRx).forEach((m) => fs.rmSync(path.join(UPLOAD_DIR, m.storedName), { force: true }));
      throw new HttpError(400, 'validation', { ['rx_' + phId]: r.error });
    }
    storedRx[phId] = r.file;
  }

  const created = [];
  const now = new Date().toISOString();
  for (const [phId, list] of groups) {
    db.orderSeq += 1;
    const rxRequired = list.some((x) => x.p.rx);
    const o = {
      id: newId('ord'),
      number: `DT-${now.slice(0, 10).replace(/-/g, '')}-${String(db.orderSeq).padStart(4, '0')}`,
      userId: user.id,
      customerName,
      phone,
      pharmacyId: phId,
      pickupBranchId: pickups[phId],
      items: list.map(({ p, qty }) => ({
        productId: p.id, name: p.name, dose: p.dose, pack: p.pack, rx: p.rx, qty, price: p.price, sum: p.price * qty
      })),
      total: list.reduce((s, { p, qty }) => s + p.price * qty, 0),
      rxRequired,
      prescription: storedRx[phId] || null,
      createdAt: now,
      updatedAt: now,
      status: null,
      history: []
    };
    list.forEach(({ p, qty }) => { p.stock -= qty; });
    pushHistory(o, rxRequired ? 'rx_pending' : 'accepted', 'system');
    db.orders.push(o);
    created.push(o);
  }
  saveDb();
  return created.map((o) => orderView(o));
}

// ---------- Маршруттар ----------
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route('GET', /^\/api\/me$/, ({ user }) => ({ user: publicUser(user) }));

route('POST', /^\/api\/login$/, async ({ req, res }) => {
  const body = await readJson(req);
  const u = db.users.find((x) => x.username === str(body.username, 60));
  const pass = typeof body.password === 'string' ? body.password : '';
  let ok = false;
  if (u) {
    const hash = crypto.scryptSync(pass, u.salt, 64);
    ok = crypto.timingSafeEqual(hash, Buffer.from(u.passwordHash, 'hex'));
  }
  if (!ok) throw new HttpError(401, 'bad_credentials');
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: u.id, expires: Date.now() + SESSION_TTL_MS });
  res.setHeader('Set-Cookie', `dt_sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
  return { user: publicUser(u) };
});

route('POST', /^\/api\/logout$/, ({ req, res }) => {
  const token = parseCookies(req).dt_sid;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'dt_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  return { ok: true };
});

route('GET', /^\/api\/config$/, () => {
  const cfg = loadConfig();
  return { operatorLicense: cfg.operatorLicense || null, demo: true, maxFileBytes: MAX_FILE_BYTES };
});

route('GET', /^\/api\/catalog$/, ({ url }) => {
  const q = str(url.searchParams.get('q'), 100).toLowerCase();
  const category = url.searchParams.get('category') || '';
  const min = Number(url.searchParams.get('min')) || 0;
  const max = Number(url.searchParams.get('max')) || Infinity;
  const avail = url.searchParams.get('avail') || '';
  const list = db.products.filter((p) => {
    if (q && ![p.name.kk, p.name.en, p.inn].some((n) => n.toLowerCase().includes(q))) return false;
    if (category && p.category !== category) return false;
    if (p.price < min || p.price > max) return false;
    if (avail === 'in_stock' && p.stock <= 0) return false;
    if (avail === 'out_of_stock' && p.stock > 0) return false;
    if (avail === 'purchasable' && purchaseBlock(p)) return false;
    return true;
  });
  return { products: list.map((p) => publicProduct(p)) };
});

route('GET', /^\/api\/products\/([\w-]+)$/, ({ params }) => {
  const p = db.products.find((x) => x.id === params[0]);
  if (!p) throw new HttpError(404, 'not_found');
  return { product: publicProduct(p, true) };
});

// Бірнеше тауарды бір сұраумен алу (себет үшін)
route('GET', /^\/api\/products$/, ({ url }) => {
  const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
  return { products: db.products.filter((p) => ids.includes(p.id)).map((p) => publicProduct(p)) };
});

// ----- Сатушы -----
function sellerApplicationView(a) {
  if (!a) return null;
  return {
    id: a.id,
    status: a.status,
    orgName: a.orgName,
    bin: a.bin, // өз дерегі — тек сатушының өзіне
    licenseNumber: a.licenseNumber,
    issuer: a.issuer,
    issueDate: a.issueDate,
    expiryDate: a.expiryDate,
    comment: a.comment,
    file: fileMeta(a.file),
    submittedAt: a.submittedAt,
    reviewedAt: a.reviewedAt,
    reviewerName: a.reviewerName,
    decision: a.decision,
    rejectReason: a.rejectReason,
    history: a.history
  };
}

route('GET', /^\/api\/seller\/application$/, ({ user }) => {
  requireRole(user, 'seller');
  return { application: sellerApplicationView(appForPharmacy(user.pharmacyId)) };
});

route('POST', /^\/api\/seller\/application$/, async ({ req, user }) => {
  requireRole(user, 'seller');
  const body = await readJson(req);
  const existing = appForPharmacy(user.pharmacyId);
  if (existing && existing.status === 'pending') throw new HttpError(409, 'already_pending');
  if (existing && existing.status === 'approved') throw new HttpError(409, 'already_approved');
  const { values, fieldErrors } = validateApplication(body, existing);
  if (Object.keys(fieldErrors).length) throw new HttpError(400, 'validation', fieldErrors);
  let file = existing ? existing.file : null;
  if (body.file) {
    const r = storeUpload(body.file);
    if (r.error) throw new HttpError(400, 'validation', { file: r.error });
    file = r.file;
  }
  const now = new Date().toISOString();
  const a = existing || { id: newId('app'), pharmacyId: user.pharmacyId, history: [] };
  Object.assign(a, values, {
    file,
    submittedBy: user.id,
    submittedAt: now,
    status: 'pending', // жіберілген соң — «Тексерілуде»
    reviewedAt: null,
    reviewerId: null,
    reviewerName: null,
    decision: null,
    rejectReason: null
  });
  a.history.push({ action: existing ? 'resubmitted' : 'submitted', at: now, by: user.name });
  if (!existing) db.applications.push(a);
  saveDb();
  return { application: sellerApplicationView(a) };
});

route('GET', /^\/api\/seller\/application\/file$/, ({ user, res }) => {
  requireRole(user, 'seller');
  const a = appForPharmacy(user.pharmacyId);
  sendStoredFile(res, a && a.file);
});

function sellerProductView(p) {
  return { ...publicProduct(p), regDoc: p.regDoc ? { ...p.regDoc, file: fileMeta(p.regDoc.file) } : null };
}

function ownProduct(user, id) {
  const p = db.products.find((x) => x.id === id && x.pharmacyId === user.pharmacyId);
  if (!p) throw new HttpError(404, 'not_found');
  return p;
}

route('GET', /^\/api\/seller\/products$/, ({ user }) => {
  requireRole(user, 'seller');
  return { products: db.products.filter((p) => p.pharmacyId === user.pharmacyId).map(sellerProductView) };
});

route('GET', /^\/api\/seller\/products\/([\w-]+)$/, ({ user, params }) => {
  requireRole(user, 'seller');
  return { product: sellerProductView(ownProduct(user, params[0])) };
});

route('PUT', /^\/api\/seller\/products\/([\w-]+)$/, async ({ req, user, params }) => {
  requireRole(user, 'seller');
  const p = ownProduct(user, params[0]);
  const body = await readJson(req);
  const price = Number(body.price);
  const stock = Number(body.stock);
  const f = {};
  if (!Number.isInteger(price) || price < 1 || price > 10000000) f.price = 'price';
  if (!Number.isInteger(stock) || stock < 0 || stock > 100000) f.stock = 'stock';
  if (Object.keys(f).length) throw new HttpError(400, 'validation', f);
  p.price = price;
  p.stock = stock;
  saveDb();
  return { product: sellerProductView(p) };
});

// Дәрінің мемлекеттік тіркеу құжаты — дәріхана лицензиясынан бөлек.
route('POST', /^\/api\/seller\/products\/([\w-]+)\/regdoc$/, async ({ req, user, params }) => {
  requireRole(user, 'seller');
  const p = ownProduct(user, params[0]);
  const body = await readJson(req);
  const v = { number: str(body.number, 80), issueDate: str(body.issueDate, 10), expiryDate: str(body.expiryDate, 10) };
  const f = {};
  if (v.number.length < 3) f.number = 'required';
  if (v.issueDate && !isDate(v.issueDate)) f.issueDate = 'date';
  if (v.expiryDate && !isDate(v.expiryDate)) f.expiryDate = 'date';
  if (!body.file && !(p.regDoc && p.regDoc.file)) f.file = 'file_required';
  if (Object.keys(f).length) throw new HttpError(400, 'validation', f);
  let file = p.regDoc ? p.regDoc.file : null;
  if (body.file) {
    const r = storeUpload(body.file);
    if (r.error) throw new HttpError(400, 'validation', { file: r.error });
    file = r.file;
  }
  p.regDoc = { ...v, file, updatedAt: new Date().toISOString() };
  saveDb();
  return { product: sellerProductView(p) };
});

route('GET', /^\/api\/seller\/products\/([\w-]+)\/regdoc\/file$/, ({ user, params, res }) => {
  requireRole(user, 'seller');
  const p = ownProduct(user, params[0]);
  sendStoredFile(res, p.regDoc && p.regDoc.file);
});

route('GET', /^\/api\/seller\/orders$/, ({ user }) => {
  requireRole(user, 'seller');
  const list = db.orders.filter((o) => o.pharmacyId === user.pharmacyId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { orders: list.map((o) => orderView(o, true)) };
});

function ownOrder(user, id) {
  const o = db.orders.find((x) => x.id === id && x.pharmacyId === user.pharmacyId);
  if (!o) throw new HttpError(404, 'not_found');
  return o;
}

route('POST', /^\/api\/seller\/orders\/([\w-]+)\/prescription$/, async ({ req, user, params }) => {
  requireRole(user, 'seller');
  const o = ownOrder(user, params[0]);
  const body = await readJson(req);
  if (o.status !== 'rx_pending') throw new HttpError(409, 'bad_transition');
  if (body.decision === 'approve') {
    pushHistory(o, 'accepted', user.name);
  } else if (body.decision === 'reject') {
    const reason = str(body.reason, 500);
    if (reason.length < 5) throw new HttpError(400, 'validation', { reason: 'reason' });
    o.rxRejectReason = reason;
    restoreStock(o);
    pushHistory(o, 'rx_rejected', user.name);
  } else throw new HttpError(400, 'bad_request');
  saveDb();
  return { order: orderView(o, true) };
});

const SELLER_TRANSITIONS = { accepted: ['ready', 'cancelled'], ready: ['completed', 'cancelled'], rx_pending: ['cancelled'] };

route('POST', /^\/api\/seller\/orders\/([\w-]+)\/status$/, async ({ req, user, params }) => {
  requireRole(user, 'seller');
  const o = ownOrder(user, params[0]);
  const body = await readJson(req);
  // Рецепт тексерілмейінше тапсырыс «дайын»/«берілді» күйіне өте алмайды.
  if (!(SELLER_TRANSITIONS[o.status] || []).includes(body.status)) throw new HttpError(409, 'bad_transition');
  if (body.status === 'cancelled') restoreStock(o);
  pushHistory(o, body.status, user.name);
  saveDb();
  return { order: orderView(o, true) };
});

route('GET', /^\/api\/seller\/orders\/([\w-]+)\/prescription\/file$/, ({ user, params, res }) => {
  requireRole(user, 'seller');
  sendStoredFile(res, ownOrder(user, params[0]).prescription);
});

// ----- Сатып алушы -----
route('POST', /^\/api\/orders$/, async ({ req, user }) => {
  requireRole(user, 'customer');
  const body = await readJson(req);
  return { orders: createOrders(user, body) };
});

route('GET', /^\/api\/orders$/, ({ user }) => {
  requireRole(user, 'customer');
  const list = db.orders.filter((o) => o.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { orders: list.map((o) => orderView(o)) };
});

route('GET', /^\/api\/orders\/([\w-]+)\/prescription\/file$/, ({ user, params, res }) => {
  requireRole(user, 'customer');
  const o = db.orders.find((x) => x.id === params[0] && x.userId === user.id);
  if (!o) throw new HttpError(404, 'not_found');
  sendStoredFile(res, o.prescription);
});

// ----- Тексеруші -----
function reviewerAppView(a, full = false) {
  const ph = db.pharmacies.find((p) => p.id === a.pharmacyId);
  const submitter = db.users.find((u) => u.id === a.submittedBy);
  const base = {
    id: a.id,
    status: a.status,
    orgName: a.orgName,
    pharmacy: ph ? { id: ph.id, name: ph.name, city: ph.city, address: ph.address } : null,
    submittedAt: a.submittedAt,
    reviewedAt: a.reviewedAt,
    reviewerName: a.reviewerName,
    decision: a.decision
  };
  if (!full) return base;
  return {
    ...base,
    bin: a.bin,
    licenseNumber: a.licenseNumber,
    issuer: a.issuer,
    issueDate: a.issueDate,
    expiryDate: a.expiryDate,
    comment: a.comment,
    file: fileMeta(a.file),
    submitter: submitter ? { name: submitter.name, username: submitter.username } : null,
    rejectReason: a.rejectReason,
    history: a.history
  };
}

route('GET', /^\/api\/reviewer\/applications$/, ({ user }) => {
  requireRole(user, 'reviewer');
  const list = [...db.applications].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  return { applications: list.map((a) => reviewerAppView(a)) };
});

function findApp(id) {
  const a = db.applications.find((x) => x.id === id);
  if (!a) throw new HttpError(404, 'not_found');
  return a;
}

route('GET', /^\/api\/reviewer\/applications\/([\w-]+)$/, ({ user, params }) => {
  requireRole(user, 'reviewer');
  return { application: reviewerAppView(findApp(params[0]), true) };
});

route('GET', /^\/api\/reviewer\/applications\/([\w-]+)\/file$/, ({ user, params, res }) => {
  requireRole(user, 'reviewer');
  sendStoredFile(res, findApp(params[0]).file);
});

route('POST', /^\/api\/reviewer\/applications\/([\w-]+)\/decision$/, async ({ req, user, params }) => {
  requireRole(user, 'reviewer');
  const a = findApp(params[0]);
  // Мүдделер қақтығысы: өтінімді жіберген адам немесе сол дәріхананың қызметкері шешім шығара алмайды.
  if (a.submittedBy === user.id || (user.pharmacyId && user.pharmacyId === a.pharmacyId)) throw new HttpError(403, 'conflict_of_interest');
  if (a.status !== 'pending') throw new HttpError(409, 'not_pending');
  const body = await readJson(req);
  const now = new Date().toISOString();
  if (body.decision === 'approve') {
    a.status = 'approved';
    a.rejectReason = null;
  } else if (body.decision === 'reject') {
    const reason = str(body.reason, 1000);
    if (reason.length < 5) throw new HttpError(400, 'validation', { reason: 'reason' });
    a.status = 'rejected';
    a.rejectReason = reason;
  } else throw new HttpError(400, 'bad_request');
  a.decision = body.decision;
  a.reviewedAt = now;
  a.reviewerId = user.id;
  a.reviewerName = user.name;
  a.history.push({ action: a.status, at: now, by: user.name, reason: a.rejectReason || undefined });
  saveDb();
  return { application: reviewerAppView(a, true) };
});

// ---------- Статикалық файлдар ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
  fs.createReadStream(full).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  const r = routes.find((x) => x.method === req.method && x.pattern.test(url.pathname));
  if (!r) return sendJson(res, 404, { error: 'not_found' });
  try {
    const params = url.pathname.match(r.pattern).slice(1);
    const result = await r.handler({ req, res, url, params, user: currentUser(req) });
    if (result !== undefined && !res.headersSent) sendJson(res, 200, result);
  } catch (e) {
    if (e instanceof HttpError) {
      if (!res.headersSent) sendJson(res, e.status, { error: e.code, fields: e.fields || null });
    } else {
      console.error(e);
      if (!res.headersSent) sendJson(res, 500, { error: 'server_error' });
    }
  }
});

server.listen(PORT, () => {
  console.log(`DariTap (демо) іске қосылды: http://localhost:${PORT}`);
  console.log('Демо аккаунттар (құпиясөз: demo123): customer, seller1, seller2, reviewer');
});
