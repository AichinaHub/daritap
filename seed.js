'use strict';
// Демонстрациялық бастапқы деректер.
// Маңызды: бағалар, дәріханалар, өндірушілер және рецепт белгілері — ДЕМО.
// Ешбір дәріханаға лицензия алдын ала берілмейді: барлығы «Лицензия тіркелмеген»
// мәртебесінен басталады. Нұсқаулық мәтіндері және тіркеу құжаттары ойдан жазылмайды.
const crypto = require('crypto');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function user(id, username, role, name, pharmacyId = null) {
  const { salt, hash } = hashPassword('demo123');
  return { id, username, role, name, pharmacyId, salt, passwordHash: hash };
}

function product(id, pharmacyId, o) {
  return {
    id,
    pharmacyId,
    name: o.name,
    inn: o.inn,
    category: o.category,
    form: o.form,
    dose: o.dose,
    pack: o.pack,
    price: o.price,
    stock: o.stock,
    rx: o.rx,
    image: o.image,
    manufacturer: null, // дерек жоқ — ойдан толтырылмайды
    instruction: null, // ресми нұсқаулық енгізілмеген
    regDoc: null, // дәрінің мемлекеттік тіркеу құжаты — сатушы бөлек жүктейді
    searches7d: (ACTIVITY_7D[id] || [0, 0])[0],
    orders7d: (ACTIVITY_7D[id] || [0, 0])[1]
  };
}

const tablet = { kk: 'Таблетка', en: 'Tablets' };
const capsule = { kk: 'Капсула', en: 'Capsules' };
const solution = { kk: 'Ерітінді', en: 'Solution' };

function demoApproved(id, pharmacyId, sellerId, licenseNumber, orgName) {
  const at = '2026-10-01T09:00:00.000Z';
  return {
    id, pharmacyId, orgName, bin: '000000000000', licenseNumber,
    issuer: 'ДЕМО — мемлекеттік тізілімде жоқ', issueDate: '2026-01-01', expiryDate: null,
    comment: 'Демо лицензия', file: null,
    submittedBy: sellerId, submittedAt: at, status: 'approved',
    reviewedAt: at, reviewerId: 'u-reviewer', reviewerName: 'Демо тексеруші', decision: 'approved', rejectReason: null,
    history: [{ action: 'submitted', at, by: 'Демо' }, { action: 'approved', at, by: 'Демо тексеруші' }]
  };
}

// Тексерушіге көрсетілетін демо құжат (resetDb кезінде data/uploads ішіне жазылады).
const DEMO_DOC = { storedName: 'demo-license-c.pdf', originalName: 'demo-license-pharmacy-C.pdf', mime: 'application/pdf' };

function demoPending(id, pharmacyId, sellerId, licenseNumber, orgName) {
  const at = '2026-10-28T10:30:00.000Z';
  return {
    id, pharmacyId, orgName, bin: '000000000003', licenseNumber,
    issuer: 'ДЕМО — мемлекеттік тізілімде жоқ', issueDate: '2026-02-01', expiryDate: null,
    comment: 'Демо өтінім: тексеруші мақұлдауы немесе қабылдамауы мүмкін.',
    file: { ...DEMO_DOC, size: 0, uploadedAt: at },
    submittedBy: sellerId, submittedAt: at, status: 'pending',
    reviewedAt: null, reviewerId: null, reviewerName: null, decision: null, rejectReason: null,
    history: [{ action: 'submitted', at, by: 'Демо сатушы (В)' }]
  };
}

// Минималды жарамды PDF: «демо құжат, нақты лицензия емес».
function demoPdf() {
  const text = 'DEMO licence document - Demo Pharmacy C - not a real licence';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  const stream = `BT /F1 16 Tf 60 760 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// Соңғы 7 күндегі белсенділік: [іздеулер, тапсырыстар]. СИМУЛЯЦИЯЛАНҒАН демо деректер (нақты сату емес).
// Тексерілуде тұрған В дәріханасының тауарларын сатып алу мүмкін емес, сондықтан тапсырыстары 0.
const ACTIVITY_7D = {
  'p-1': [58, 10], 'p-2': [68, 14], 'p-3': [40, 7], 'p-4': [64, 7], 'p-5': [15, 1], 'p-6': [12, 1],
  'p-7': [31, 5], 'p-8': [23, 4], 'p-9': [18, 4], 'p-10': [16, 2], 'p-11': [7, 1], 'p-12': [9, 2],
  'p-13': [55, 12], 'p-14': [32, 5], 'p-15': [37, 6], 'p-16': [45, 10], 'p-17': [33, 2], 'p-18': [26, 4],
  'p-19': [34, 4], 'p-20': [72, 13], 'p-21': [78, 17], 'p-22': [49, 4], 'p-23': [21, 5], 'p-24': [25, 6],
  'p-25': [44, 4], 'p-26': [34, 5], 'p-27': [48, 10], 'p-28': [45, 10], 'p-29': [37, 7], 'p-30': [29, 7],
  'p-31': [35, 4], 'p-32': [33, 8], 'p-33': [25, 4], 'p-34': [14, 1], 'p-35': [26, 6], 'p-36': [14, 2],
  'p-37': [19, 4], 'p-38': [16, 4], 'p-39': [25, 4], 'p-40': [26, 1], 'p-41': [25, 4], 'p-42': [16, 3],
  'p-43': [9, 2], 'p-44': [20, 2], 'p-45': [19, 3], 'p-46': [21, 3], 'p-47': [15, 1], 'p-48': [9, 1],
  'p-49': [19, 2], 'p-50': [16, 1], 'p-51': [10, 1], 'p-52': [16, 2], 'p-53': [9, 1], 'p-54': [13, 2],
  'p-55': [8, 1], 'p-56': [16, 2], 'p-57': [10, 1], 'p-58': [11, 1], 'p-59': [7, 1], 'p-60': [8, 1],
  'p-61': [13, 2], 'p-62': [6, 1], 'p-63': [49, 12], 'p-64': [12, 1], 'p-65': [54, 10], 'p-66': [47, 0],
  'p-67': [43, 0], 'p-68': [23, 0], 'p-69': [31, 0], 'p-70': [27, 0], 'p-71': [13, 0], 'p-72': [26, 0]
};


function createSeed() {
  return {
    version: 7,
    users: [
      user('u-customer', 'customer', 'customer', 'Демо сатып алушы'),
      user('u-seller1', 'seller1', 'seller', 'Демо сатушы (А)', 'ph-a'),
      user('u-seller2', 'seller2', 'seller', 'Демо сатушы (Б)', 'ph-b'),
      user('u-seller3', 'seller3', 'seller', 'Демо сатушы (В)', 'ph-c'),
      user('u-reviewer', 'reviewer', 'reviewer', 'Демо тексеруші')
    ],
    pharmacies: [
      {
        id: 'ph-a',
        name: { kk: 'Демо дәріхана А', en: 'Demo Pharmacy A' },
        city: { kk: 'Астана', en: 'Astana' },
        address: { kk: 'Демо мекенжай, 1', en: 'Demo address, 1' },
        phone: null,
        branches: [
          { id: 'br-a1', name: { kk: 'А — №1 алып кету нүктесі (демо)', en: 'A — pickup point #1 (demo)' } },
          { id: 'br-a2', name: { kk: 'А — №2 алып кету нүктесі (демо)', en: 'A — pickup point #2 (demo)' } }
        ]
      },
      {
        id: 'ph-b',
        name: { kk: 'Демо дәріхана Б', en: 'Demo Pharmacy B' },
        city: { kk: 'Алматы', en: 'Almaty' },
        address: { kk: 'Демо мекенжай, 2', en: 'Demo address, 2' },
        phone: null,
        branches: [
          { id: 'br-b1', name: { kk: 'Б — №1 алып кету нүктесі (демо)', en: 'B — pickup point #1 (demo)' } }
        ]
      },
      {
        id: 'ph-c',
        name: { kk: 'Демо дәріхана В', en: 'Demo Pharmacy C' },
        city: { kk: 'Астана', en: 'Astana' },
        address: { kk: 'Демо мекенжай, 3', en: 'Demo address, 3' },
        phone: null,
        branches: [
          { id: 'br-c1', name: { kk: 'В — №1 алып кету нүктесі (демо)', en: 'C — pickup point #1 (demo)' } }
        ]
      }
    ],
    // Сатып алуды көрсету үшін екі демо дәріханаға ДЕМО лицензия мақұлданған күйде беріледі.
    // Бұл нақты лицензия емес: нөмірі мен беруші органы әдейі «ДЕМО» деп белгіленген.
    applications: [demoApproved('app-demo-a', 'ph-a', 'u-seller1', 'ДЕМО-А-0001', 'Демо дәріхана А (демо ұйым)'),
      demoApproved('app-demo-b', 'ph-b', 'u-seller2', 'ДЕМО-Б-0002', 'Демо дәріхана Б (демо ұйым)'),
      // Үшінші дәріхана — өтінімі тексерілуде: лицензия ағынын, 1-ереже мен 3-ережені көрсету үшін.
      demoPending('app-demo-c', 'ph-c', 'u-seller3', 'ДЕМО-В-0003', 'Демо дәріхана В (демо ұйым)')],
    orders: [],
    orderSeq: 0,
    products: [
      product('p-1', 'ph-a', {
        name: { kk: 'Парацетамол', en: 'Paracetamol' }, inn: 'Paracetamol', category: 'pain',
        form: tablet, dose: { kk: '500 мг', en: '500 mg' }, pack: { kk: '10 таблетка', en: '10 tablets' },
        price: 350, stock: 40, rx: false, image: 'tablet'
      }),
      product('p-2', 'ph-a', {
        name: { kk: 'Парацетамол', en: 'Paracetamol' }, inn: 'Paracetamol', category: 'pain',
        form: tablet, dose: { kk: '500 мг', en: '500 mg' }, pack: { kk: '20 таблетка', en: '20 tablets' },
        price: 590, stock: 25, rx: false, image: 'tablet'
      }),
      product('p-3', 'ph-b', {
        name: { kk: 'Ибупрофен', en: 'Ibuprofen' }, inn: 'Ibuprofen', category: 'pain',
        form: tablet, dose: { kk: '200 мг', en: '200 mg' }, pack: { kk: '20 таблетка', en: '20 tablets' },
        price: 720, stock: 18, rx: false, image: 'tablet'
      }),
      product('p-4', 'ph-b', {
        name: { kk: 'Ибупрофен', en: 'Ibuprofen' }, inn: 'Ibuprofen', category: 'pain',
        form: tablet, dose: { kk: '400 мг', en: '400 mg' }, pack: { kk: '20 таблетка', en: '20 tablets' },
        price: 980, stock: 0, rx: false, image: 'tablet'
      }),
      product('p-5', 'ph-a', {
        name: { kk: 'Амоксициллин', en: 'Amoxicillin' }, inn: 'Amoxicillin', category: 'antibiotic',
        form: capsule, dose: { kk: '250 мг', en: '250 mg' }, pack: { kk: '16 капсула', en: '16 capsules' },
        price: 1150, stock: 12, rx: true, image: 'capsule'
      }),
      product('p-6', 'ph-b', {
        name: { kk: 'Амоксициллин', en: 'Amoxicillin' }, inn: 'Amoxicillin', category: 'antibiotic',
        form: capsule, dose: { kk: '500 мг', en: '500 mg' }, pack: { kk: '16 капсула', en: '16 capsules' },
        price: 1640, stock: 9, rx: true, image: 'capsule'
      }),
      product('p-7', 'ph-a', {
        name: { kk: 'Цетиризин', en: 'Cetirizine' }, inn: 'Cetirizine', category: 'allergy',
        form: tablet, dose: { kk: '10 мг', en: '10 mg' }, pack: { kk: '10 таблетка', en: '10 tablets' },
        price: 860, stock: 30, rx: false, image: 'tablet'
      }),
      product('p-8', 'ph-b', {
        name: { kk: 'Лоратадин', en: 'Loratadine' }, inn: 'Loratadine', category: 'allergy',
        form: tablet, dose: { kk: '10 мг', en: '10 mg' }, pack: { kk: '10 таблетка', en: '10 tablets' },
        price: 690, stock: 22, rx: false, image: 'tablet'
      }),
      product('p-9', 'ph-a', {
        name: { kk: 'Омепразол', en: 'Omeprazole' }, inn: 'Omeprazole', category: 'digestive',
        form: capsule, dose: { kk: '20 мг', en: '20 mg' }, pack: { kk: '30 капсула', en: '30 capsules' },
        price: 1290, stock: 14, rx: false, image: 'capsule'
      }),
      product('p-10', 'ph-b', {
        name: { kk: 'Аскорбин қышқылы (С дәрумені)', en: 'Ascorbic acid (Vitamin C)' }, inn: 'Ascorbic acid', category: 'vitamins',
        form: tablet, dose: { kk: '50 мг', en: '50 mg' }, pack: { kk: '50 таблетка', en: '50 tablets' },
        price: 420, stock: 60, rx: false, image: 'tablet'
      }),
      product('p-11', 'ph-b', {
        name: { kk: 'Метформин', en: 'Metformin' }, inn: 'Metformin', category: 'endocrine',
        form: tablet, dose: { kk: '500 мг', en: '500 mg' }, pack: { kk: '60 таблетка', en: '60 tablets' },
        price: 1480, stock: 0, rx: true, image: 'tablet'
      }),
      product('p-12', 'ph-a', {
        name: { kk: 'Натрий хлориді', en: 'Sodium chloride' }, inn: 'Sodium chloride', category: 'solutions',
        form: solution, dose: { kk: '0,9%', en: '0.9%' }, pack: { kk: '200 мл құты', en: '200 ml bottle' },
        price: 540, stock: 20, rx: false, image: 'bottle'
      }),
      // Қосымша 50 танымал дәрі: атаулары мен дозалары — жалпы мәлімет; бағасы мен қалдығы — ДЕМО.
      product('p-13', 'ph-a', {"name": {"kk": "Дротаверин", "en": "Drotaverine"}, "inn": "Drotaverine", "category": "pain", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "40 мг", "en": "40 mg"}, "pack": {"kk": "24 таблетка", "en": "24 tablets"}, "price": 520, "stock": 4, "rx": false, "image": "tablet"}),
      product('p-14', 'ph-b', {"name": {"kk": "Ацетилсалицил қышқылы", "en": "Acetylsalicylic acid"}, "inn": "Acetylsalicylic acid", "category": "pain", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "500 мг", "en": "500 mg"}, "pack": {"kk": "10 таблетка", "en": "10 tablets"}, "price": 180, "stock": 5, "rx": false, "image": "tablet"}),
      product('p-15', 'ph-a', {"name": {"kk": "Ацетилсалицил қышқылы + парацетамол + кофеин", "en": "Acetylsalicylic acid + paracetamol + caffeine"}, "inn": "Acetylsalicylic acid + Paracetamol + Caffeine", "category": "pain", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "240/180/30 мг", "en": "240/180/30 mg"}, "pack": {"kk": "10 таблетка", "en": "10 tablets"}, "price": 210, "stock": 20, "rx": false, "image": "tablet"}),
      product('p-16', 'ph-b', {"name": {"kk": "Метамизол натрий", "en": "Metamizole sodium"}, "inn": "Metamizole", "category": "pain", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "500 мг", "en": "500 mg"}, "pack": {"kk": "20 таблетка", "en": "20 tablets"}, "price": 250, "stock": 50, "rx": false, "image": "tablet"}),
      product('p-17', 'ph-a', {"name": {"kk": "Кеторолак", "en": "Ketorolac"}, "inn": "Ketorolac", "category": "pain", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "10 мг", "en": "10 mg"}, "pack": {"kk": "20 таблетка", "en": "20 tablets"}, "price": 690, "stock": 0, "rx": true, "image": "tablet"}),
      product('p-18', 'ph-b', {"name": {"kk": "Диклофенак", "en": "Diclofenac"}, "inn": "Diclofenac", "category": "pain", "form": {"kk": "Гель", "en": "Gel"}, "dose": {"kk": "1%", "en": "1%"}, "pack": {"kk": "40 г түтік", "en": "40 g tube"}, "price": 890, "stock": 3, "rx": false, "image": "bottle"}),
      product('p-19', 'ph-a', {"name": {"kk": "Нимесулид", "en": "Nimesulide"}, "inn": "Nimesulide", "category": "pain", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "100 мг", "en": "100 mg"}, "pack": {"kk": "30 таблетка", "en": "30 tablets"}, "price": 1150, "stock": 30, "rx": true, "image": "tablet"}),
      product('p-20', 'ph-b', {"name": {"kk": "Парацетамол (балаларға)", "en": "Paracetamol (children)"}, "inn": "Paracetamol", "category": "pain", "form": {"kk": "Суспензия", "en": "Suspension"}, "dose": {"kk": "120 мг/5 мл", "en": "120 mg/5 ml"}, "pack": {"kk": "100 мл құты", "en": "100 ml bottle"}, "price": 780, "stock": 3, "rx": false, "image": "bottle"}),
      product('p-21', 'ph-a', {"name": {"kk": "Ибупрофен (балаларға)", "en": "Ibuprofen (children)"}, "inn": "Ibuprofen", "category": "pain", "form": {"kk": "Суспензия", "en": "Suspension"}, "dose": {"kk": "100 мг/5 мл", "en": "100 mg/5 ml"}, "pack": {"kk": "100 мл құты", "en": "100 ml bottle"}, "price": 1240, "stock": 15, "rx": false, "image": "bottle"}),
      product('p-22', 'ph-b', {"name": {"kk": "Ксилометазолин", "en": "Xylometazoline"}, "inn": "Xylometazoline", "category": "cold", "form": {"kk": "Мұрын спрейі", "en": "Nasal spray"}, "dose": {"kk": "0,1%", "en": "0.1%"}, "pack": {"kk": "10 мл құты", "en": "10 ml bottle"}, "price": 640, "stock": 0, "rx": false, "image": "bottle"}),
      product('p-23', 'ph-a', {"name": {"kk": "Оксиметазолин", "en": "Oxymetazoline"}, "inn": "Oxymetazoline", "category": "cold", "form": {"kk": "Мұрын спрейі", "en": "Nasal spray"}, "dose": {"kk": "0,05%", "en": "0.05%"}, "pack": {"kk": "10 мл құты", "en": "10 ml bottle"}, "price": 1390, "stock": 30, "rx": false, "image": "bottle"}),
      product('p-24', 'ph-b', {"name": {"kk": "Амброксол", "en": "Ambroxol"}, "inn": "Ambroxol", "category": "cold", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "30 мг", "en": "30 mg"}, "pack": {"kk": "30 таблетка", "en": "30 tablets"}, "price": 410, "stock": 8, "rx": false, "image": "tablet"}),
      product('p-25', 'ph-a', {"name": {"kk": "Амброксол (шәрбат)", "en": "Ambroxol (syrup)"}, "inn": "Ambroxol", "category": "cold", "form": {"kk": "Шәрбат", "en": "Syrup"}, "dose": {"kk": "15 мг/5 мл", "en": "15 mg/5 ml"}, "pack": {"kk": "100 мл құты", "en": "100 ml bottle"}, "price": 720, "stock": 0, "rx": false, "image": "bottle"}),
      product('p-26', 'ph-b', {"name": {"kk": "Ацетилцистеин", "en": "Acetylcysteine"}, "inn": "Acetylcysteine", "category": "cold", "form": {"kk": "Көпіршитін таблетка", "en": "Effervescent tablets"}, "dose": {"kk": "200 мг", "en": "200 mg"}, "pack": {"kk": "20 таблетка", "en": "20 tablets"}, "price": 1680, "stock": 3, "rx": false, "image": "tablet"}),
      product('p-27', 'ph-a', {"name": {"kk": "Бромгексин", "en": "Bromhexine"}, "inn": "Bromhexine", "category": "cold", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "8 мг", "en": "8 mg"}, "pack": {"kk": "50 таблетка", "en": "50 tablets"}, "price": 330, "stock": 20, "rx": false, "image": "tablet"}),
      product('p-28', 'ph-b', {"name": {"kk": "Умифеновир", "en": "Umifenovir"}, "inn": "Umifenovir", "category": "cold", "form": {"kk": "Капсула", "en": "Capsules"}, "dose": {"kk": "100 мг", "en": "100 mg"}, "pack": {"kk": "10 капсула", "en": "10 capsules"}, "price": 1950, "stock": 20, "rx": false, "image": "capsule"}),
      product('p-29', 'ph-a', {"name": {"kk": "Гексэтидин", "en": "Hexetidine"}, "inn": "Hexetidine", "category": "cold", "form": {"kk": "Ерітінді", "en": "Solution"}, "dose": {"kk": "0,1%", "en": "0.1%"}, "pack": {"kk": "200 мл құты", "en": "200 ml bottle"}, "price": 1820, "stock": 3, "rx": false, "image": "bottle"}),
      product('p-30', 'ph-b', {"name": {"kk": "Дезлоратадин", "en": "Desloratadine"}, "inn": "Desloratadine", "category": "allergy", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "5 мг", "en": "5 mg"}, "pack": {"kk": "10 таблетка", "en": "10 tablets"}, "price": 1260, "stock": 8, "rx": false, "image": "tablet"}),
      product('p-31', 'ph-a', {"name": {"kk": "Левоцетиризин", "en": "Levocetirizine"}, "inn": "Levocetirizine", "category": "allergy", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "5 мг", "en": "5 mg"}, "pack": {"kk": "10 таблетка", "en": "10 tablets"}, "price": 1430, "stock": 0, "rx": false, "image": "tablet"}),
      product('p-32', 'ph-b', {"name": {"kk": "Хлоропирамин", "en": "Chloropyramine"}, "inn": "Chloropyramine", "category": "allergy", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "25 мг", "en": "25 mg"}, "pack": {"kk": "20 таблетка", "en": "20 tablets"}, "price": 980, "stock": 30, "rx": false, "image": "tablet"}),
      product('p-33', 'ph-a', {"name": {"kk": "Фексофенадин", "en": "Fexofenadine"}, "inn": "Fexofenadine", "category": "allergy", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "120 мг", "en": "120 mg"}, "pack": {"kk": "10 таблетка", "en": "10 tablets"}, "price": 2150, "stock": 20, "rx": false, "image": "tablet"}),
      product('p-34', 'ph-b', {"name": {"kk": "Смектит диоктаэдрлік", "en": "Diosmectite"}, "inn": "Diosmectite", "category": "digestive", "form": {"kk": "Ұнтақ", "en": "Powder"}, "dose": {"kk": "3 г", "en": "3 g"}, "pack": {"kk": "10 пакет", "en": "10 sachets"}, "price": 1560, "stock": 0, "rx": false, "image": "capsule"}),
      product('p-35', 'ph-a', {"name": {"kk": "Лоперамид", "en": "Loperamide"}, "inn": "Loperamide", "category": "digestive", "form": {"kk": "Капсула", "en": "Capsules"}, "dose": {"kk": "2 мг", "en": "2 mg"}, "pack": {"kk": "10 капсула", "en": "10 capsules"}, "price": 290, "stock": 40, "rx": false, "image": "capsule"}),
      product('p-36', 'ph-b', {"name": {"kk": "Панкреатин", "en": "Pancreatin"}, "inn": "Pancreatin", "category": "digestive", "form": {"kk": "Капсула", "en": "Capsules"}, "dose": {"kk": "10 000 ӘБ", "en": "10,000 U"}, "pack": {"kk": "20 капсула", "en": "20 capsules"}, "price": 1870, "stock": 3, "rx": false, "image": "capsule"}),
      product('p-37', 'ph-a', {"name": {"kk": "Белсендірілген көмір", "en": "Activated charcoal"}, "inn": "Activated charcoal", "category": "digestive", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "250 мг", "en": "250 mg"}, "pack": {"kk": "10 таблетка", "en": "10 tablets"}, "price": 90, "stock": 8, "rx": false, "image": "tablet"}),
      product('p-38', 'ph-b', {"name": {"kk": "Пероральді регидратация тұзы", "en": "Oral rehydration salts"}, "inn": "Oral rehydration salts", "category": "digestive", "form": {"kk": "Ұнтақ", "en": "Powder"}, "dose": {"kk": "18,9 г", "en": "18.9 g"}, "pack": {"kk": "20 пакет", "en": "20 sachets"}, "price": 2240, "stock": 50, "rx": false, "image": "capsule"}),
      product('p-39', 'ph-a', {"name": {"kk": "Фамотидин", "en": "Famotidine"}, "inn": "Famotidine", "category": "digestive", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "20 мг", "en": "20 mg"}, "pack": {"kk": "20 таблетка", "en": "20 tablets"}, "price": 480, "stock": 50, "rx": false, "image": "tablet"}),
      product('p-40', 'ph-b', {"name": {"kk": "Метоклопрамид", "en": "Metoclopramide"}, "inn": "Metoclopramide", "category": "digestive", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "10 мг", "en": "10 mg"}, "pack": {"kk": "50 таблетка", "en": "50 tablets"}, "price": 560, "stock": 0, "rx": true, "image": "tablet"}),
      product('p-41', 'ph-a', {"name": {"kk": "Бисакодил", "en": "Bisacodyl"}, "inn": "Bisacodyl", "category": "digestive", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "5 мг", "en": "5 mg"}, "pack": {"kk": "30 таблетка", "en": "30 tablets"}, "price": 340, "stock": 40, "rx": false, "image": "tablet"}),
      product('p-42', 'ph-b', {"name": {"kk": "Колекальциферол (D3 дәрумені)", "en": "Colecalciferol (Vitamin D3)"}, "inn": "Colecalciferol", "category": "vitamins", "form": {"kk": "Тамшы", "en": "Drops"}, "dose": {"kk": "15 000 ХБ/мл", "en": "15,000 IU/ml"}, "pack": {"kk": "10 мл құты", "en": "10 ml bottle"}, "price": 1490, "stock": 40, "rx": false, "image": "bottle"}),
      product('p-43', 'ph-a', {"name": {"kk": "Фолий қышқылы", "en": "Folic acid"}, "inn": "Folic acid", "category": "vitamins", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "1 мг", "en": "1 mg"}, "pack": {"kk": "50 таблетка", "en": "50 tablets"}, "price": 260, "stock": 20, "rx": false, "image": "tablet"}),
      product('p-44', 'ph-b', {"name": {"kk": "Магний лактаты + пиридоксин", "en": "Magnesium lactate + pyridoxine"}, "inn": "Magnesium lactate + Pyridoxine", "category": "vitamins", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "470/5 мг", "en": "470/5 mg"}, "pack": {"kk": "50 таблетка", "en": "50 tablets"}, "price": 1940, "stock": 0, "rx": false, "image": "tablet"}),
      product('p-45', 'ph-a', {"name": {"kk": "Темір (III) гидроксид полимальтозат", "en": "Iron(III) hydroxide polymaltose"}, "inn": "Iron(III) hydroxide polymaltose", "category": "vitamins", "form": {"kk": "Шайнайтын таблетка", "en": "Chewable tablets"}, "dose": {"kk": "100 мг", "en": "100 mg"}, "pack": {"kk": "30 таблетка", "en": "30 tablets"}, "price": 2860, "stock": 8, "rx": false, "image": "tablet"}),
      product('p-46', 'ph-b', {"name": {"kk": "Кальций карбонаты + колекальциферол", "en": "Calcium carbonate + colecalciferol"}, "inn": "Calcium carbonate + Colecalciferol", "category": "vitamins", "form": {"kk": "Шайнайтын таблетка", "en": "Chewable tablets"}, "dose": {"kk": "500 мг/200 ХБ", "en": "500 mg/200 IU"}, "pack": {"kk": "60 таблетка", "en": "60 tablets"}, "price": 2390, "stock": 0, "rx": false, "image": "tablet"}),
      product('p-47', 'ph-a', {"name": {"kk": "Азитромицин", "en": "Azithromycin"}, "inn": "Azithromycin", "category": "antibiotic", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "500 мг", "en": "500 mg"}, "pack": {"kk": "3 таблетка", "en": "3 tablets"}, "price": 990, "stock": 30, "rx": true, "image": "tablet"}),
      product('p-48', 'ph-b', {"name": {"kk": "Ципрофлоксацин", "en": "Ciprofloxacin"}, "inn": "Ciprofloxacin", "category": "antibiotic", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "500 мг", "en": "500 mg"}, "pack": {"kk": "10 таблетка", "en": "10 tablets"}, "price": 620, "stock": 5, "rx": true, "image": "tablet"}),
      product('p-49', 'ph-a', {"name": {"kk": "Амоксициллин + клавулан қышқылы", "en": "Amoxicillin + clavulanic acid"}, "inn": "Amoxicillin + Clavulanic acid", "category": "antibiotic", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "875/125 мг", "en": "875/125 mg"}, "pack": {"kk": "14 таблетка", "en": "14 tablets"}, "price": 2780, "stock": 4, "rx": true, "image": "tablet"}),
      product('p-50', 'ph-b', {"name": {"kk": "Цефтриаксон", "en": "Ceftriaxone"}, "inn": "Ceftriaxone", "category": "antibiotic", "form": {"kk": "Инъекцияға арналған ұнтақ", "en": "Powder for injection"}, "dose": {"kk": "1 г", "en": "1 g"}, "pack": {"kk": "1 флакон", "en": "1 vial"}, "price": 390, "stock": 20, "rx": true, "image": "bottle"}),
      product('p-51', 'ph-a', {"name": {"kk": "Доксициклин", "en": "Doxycycline"}, "inn": "Doxycycline", "category": "antibiotic", "form": {"kk": "Капсула", "en": "Capsules"}, "dose": {"kk": "100 мг", "en": "100 mg"}, "pack": {"kk": "10 капсула", "en": "10 capsules"}, "price": 450, "stock": 5, "rx": true, "image": "capsule"}),
      product('p-52', 'ph-b', {"name": {"kk": "Амлодипин", "en": "Amlodipine"}, "inn": "Amlodipine", "category": "cardio", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "10 мг", "en": "10 mg"}, "pack": {"kk": "30 таблетка", "en": "30 tablets"}, "price": 540, "stock": 30, "rx": true, "image": "tablet"}),
      product('p-53', 'ph-a', {"name": {"kk": "Лизиноприл", "en": "Lisinopril"}, "inn": "Lisinopril", "category": "cardio", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "10 мг", "en": "10 mg"}, "pack": {"kk": "30 таблетка", "en": "30 tablets"}, "price": 610, "stock": 3, "rx": true, "image": "tablet"}),
      product('p-54', 'ph-b', {"name": {"kk": "Бисопролол", "en": "Bisoprolol"}, "inn": "Bisoprolol", "category": "cardio", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "5 мг", "en": "5 mg"}, "pack": {"kk": "30 таблетка", "en": "30 tablets"}, "price": 790, "stock": 40, "rx": true, "image": "tablet"}),
      product('p-55', 'ph-a', {"name": {"kk": "Аторвастатин", "en": "Atorvastatin"}, "inn": "Atorvastatin", "category": "cardio", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "20 мг", "en": "20 mg"}, "pack": {"kk": "30 таблетка", "en": "30 tablets"}, "price": 1620, "stock": 12, "rx": true, "image": "tablet"}),
      product('p-56', 'ph-b', {"name": {"kk": "Ацетилсалицил қышқылы (кардио)", "en": "Acetylsalicylic acid (cardio)"}, "inn": "Acetylsalicylic acid", "category": "cardio", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "75 мг", "en": "75 mg"}, "pack": {"kk": "30 таблетка", "en": "30 tablets"}, "price": 690, "stock": 30, "rx": false, "image": "tablet"}),
      product('p-57', 'ph-a', {"name": {"kk": "Левотироксин натрий", "en": "Levothyroxine sodium"}, "inn": "Levothyroxine", "category": "endocrine", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "50 мкг", "en": "50 mcg"}, "pack": {"kk": "50 таблетка", "en": "50 tablets"}, "price": 1180, "stock": 50, "rx": true, "image": "tablet"}),
      product('p-58', 'ph-b', {"name": {"kk": "Гликлазид", "en": "Gliclazide"}, "inn": "Gliclazide", "category": "endocrine", "form": {"kk": "Таблетка", "en": "Tablets"}, "dose": {"kk": "60 мг", "en": "60 mg"}, "pack": {"kk": "30 таблетка", "en": "30 tablets"}, "price": 1710, "stock": 0, "rx": true, "image": "tablet"}),
      product('p-59', 'ph-a', {"name": {"kk": "Хлоргексидин", "en": "Chlorhexidine"}, "inn": "Chlorhexidine", "category": "skin", "form": {"kk": "Ерітінді", "en": "Solution"}, "dose": {"kk": "0,05%", "en": "0.05%"}, "pack": {"kk": "100 мл құты", "en": "100 ml bottle"}, "price": 230, "stock": 3, "rx": false, "image": "bottle"}),
      product('p-60', 'ph-b', {"name": {"kk": "Сутегі асқын тотығы", "en": "Hydrogen peroxide"}, "inn": "Hydrogen peroxide", "category": "skin", "form": {"kk": "Ерітінді", "en": "Solution"}, "dose": {"kk": "3%", "en": "3%"}, "pack": {"kk": "100 мл құты", "en": "100 ml bottle"}, "price": 150, "stock": 40, "rx": false, "image": "bottle"}),
      product('p-61', 'ph-a', {"name": {"kk": "Декспантенол", "en": "Dexpanthenol"}, "inn": "Dexpanthenol", "category": "skin", "form": {"kk": "Крем", "en": "Cream"}, "dose": {"kk": "5%", "en": "5%"}, "pack": {"kk": "30 г түтік", "en": "30 g tube"}, "price": 1350, "stock": 40, "rx": false, "image": "bottle"}),
      product('p-62', 'ph-b', {"name": {"kk": "Клотримазол", "en": "Clotrimazole"}, "inn": "Clotrimazole", "category": "skin", "form": {"kk": "Крем", "en": "Cream"}, "dose": {"kk": "1%", "en": "1%"}, "pack": {"kk": "20 г түтік", "en": "20 g tube"}, "price": 470, "stock": 50, "rx": false, "image": "bottle"}),
      // Endterm: 1-ереже үшін бір дәрінің бірнеше дәріханадағы нұсқалары.
      product('p-63', 'ph-a', { name: { kk: 'Ибупрофен', en: 'Ibuprofen' }, inn: 'Ibuprofen', category: 'pain', form: tablet, dose: { kk: '400 мг', en: '400 mg' }, pack: { kk: '20 таблетка', en: '20 tablets' }, price: 1010, stock: 14, rx: false, image: 'tablet' }),
      product('p-64', 'ph-a', { name: { kk: 'Метформин', en: 'Metformin' }, inn: 'Metformin', category: 'endocrine', form: tablet, dose: { kk: '500 мг', en: '500 mg' }, pack: { kk: '60 таблетка', en: '60 tablets' }, price: 1520, stock: 10, rx: true, image: 'tablet' }),
      product('p-65', 'ph-a', { name: { kk: 'Ксилометазолин', en: 'Xylometazoline' }, inn: 'Xylometazoline', category: 'cold', form: { kk: 'Мұрын спрейі', en: 'Nasal spray' }, dose: { kk: '0,1%', en: '0.1%' }, pack: { kk: '10 мл құты', en: '10 ml bottle' }, price: 690, stock: 12, rx: false, image: 'bottle' }),
      product('p-66', 'ph-c', { name: { kk: 'Парацетамол', en: 'Paracetamol' }, inn: 'Paracetamol', category: 'pain', form: tablet, dose: { kk: '500 мг', en: '500 mg' }, pack: { kk: '20 таблетка', en: '20 tablets' }, price: 560, stock: 40, rx: false, image: 'tablet' }),
      product('p-67', 'ph-c', { name: { kk: 'Ибупрофен', en: 'Ibuprofen' }, inn: 'Ibuprofen', category: 'pain', form: tablet, dose: { kk: '400 мг', en: '400 mg' }, pack: { kk: '20 таблетка', en: '20 tablets' }, price: 930, stock: 25, rx: false, image: 'tablet' }),
      product('p-68', 'ph-c', { name: { kk: 'Цетиризин', en: 'Cetirizine' }, inn: 'Cetirizine', category: 'allergy', form: tablet, dose: { kk: '10 мг', en: '10 mg' }, pack: { kk: '10 таблетка', en: '10 tablets' }, price: 820, stock: 30, rx: false, image: 'tablet' }),
      product('p-69', 'ph-c', { name: { kk: 'Ксилометазолин', en: 'Xylometazoline' }, inn: 'Xylometazoline', category: 'cold', form: { kk: 'Мұрын спрейі', en: 'Nasal spray' }, dose: { kk: '0,1%', en: '0.1%' }, pack: { kk: '10 мл құты', en: '10 ml bottle' }, price: 610, stock: 20, rx: false, image: 'bottle' }),
      product('p-70', 'ph-c', { name: { kk: 'Смектит диоктаэдрлік', en: 'Diosmectite' }, inn: 'Diosmectite', category: 'digestive', form: { kk: 'Ұнтақ', en: 'Powder' }, dose: { kk: '3 г', en: '3 g' }, pack: { kk: '10 пакет', en: '10 sachets' }, price: 1490, stock: 15, rx: false, image: 'capsule' }),
      product('p-71', 'ph-c', { name: { kk: 'Амоксициллин', en: 'Amoxicillin' }, inn: 'Amoxicillin', category: 'antibiotic', form: capsule, dose: { kk: '500 мг', en: '500 mg' }, pack: { kk: '16 капсула', en: '16 capsules' }, price: 1590, stock: 10, rx: true, image: 'capsule' }),
      product('p-72', 'ph-c', { name: { kk: 'Лоратадин', en: 'Loratadine' }, inn: 'Loratadine', category: 'allergy', form: tablet, dose: { kk: '10 мг', en: '10 mg' }, pack: { kk: '10 таблетка', en: '10 tablets' }, price: 650, stock: 18, rx: false, image: 'tablet' }),
      // Жаңа қосылған дәрілер (62 әртүрлі дәрі). Апталық белсенділік әлі жоқ: ACTIVITY_7D-де жазба жоқ → 0.
      product('p-73', 'ph-a', { name: { kk: 'Ацикловир', en: 'Aciclovir' }, inn: 'Aciclovir', category: 'skin', form: { kk: 'Крем', en: 'Cream' }, dose: { kk: '5%', en: '5%' }, pack: { kk: '5 г түтік', en: '5 g tube' }, price: 390, stock: 25, rx: false, image: 'bottle' }),
      product('p-74', 'ph-b', { name: { kk: 'Пантопразол', en: 'Pantoprazole' }, inn: 'Pantoprazole', category: 'digestive', form: tablet, dose: { kk: '20 мг', en: '20 mg' }, pack: { kk: '14 таблетка', en: '14 tablets' }, price: 1180, stock: 20, rx: false, image: 'tablet' }),
      product('p-75', 'ph-a', { name: { kk: 'Ментил изовалераты', en: 'Menthyl isovalerate' }, inn: 'Menthyl isovalerate', category: 'cardio', form: { kk: 'Тіл астындағы таблетка', en: 'Sublingual tablets' }, dose: { kk: '60 мг', en: '60 mg' }, pack: { kk: '10 таблетка', en: '10 tablets' }, price: 160, stock: 35, rx: false, image: 'tablet' }),
      product('p-76', 'ph-b', { name: { kk: 'Инъекцияға арналған су', en: 'Water for injections' }, inn: 'Water for injections', category: 'solutions', form: { kk: 'Еріткіш', en: 'Solvent' }, dose: { kk: '200 мл', en: '200 ml' }, pack: { kk: '1 құты', en: '1 bottle' }, price: 290, stock: 30, rx: false, image: 'bottle' }),
      product('p-77', 'ph-a', { name: { kk: 'Натрий гиалуронаты', en: 'Sodium hyaluronate' }, inn: 'Sodium hyaluronate', category: 'eye', form: { kk: 'Көз тамшысы', en: 'Eye drops' }, dose: { kk: '0,4%', en: '0.4%' }, pack: { kk: '10 мл құты', en: '10 ml bottle' }, price: 2950, stock: 15, rx: false, image: 'bottle' })
    ]
  };
}

module.exports = { createSeed, hashPassword, demoPdf, DEMO_DOC };
