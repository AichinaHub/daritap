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
    regDoc: null // дәрінің мемлекеттік тіркеу құжаты — сатушы бөлек жүктейді
  };
}

const tablet = { kk: 'Таблетка', en: 'Tablets' };
const capsule = { kk: 'Капсула', en: 'Capsules' };
const solution = { kk: 'Ерітінді', en: 'Solution' };

function createSeed() {
  return {
    version: 1,
    users: [
      user('u-customer', 'customer', 'customer', 'Демо сатып алушы'),
      user('u-seller1', 'seller1', 'seller', 'Демо сатушы (А)', 'ph-a'),
      user('u-seller2', 'seller2', 'seller', 'Демо сатушы (Б)', 'ph-b'),
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
      }
    ],
    applications: [],
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
      })
    ]
  };
}

module.exports = { createSeed, hashPassword };
