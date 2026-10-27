import { addDays, addMinutes, format, setHours, setMinutes, startOfDay, subDays } from 'date-fns';

import type {
  Appointment,
  AppNotification,
  Assessment,
  Center,
  Expense,
  ExpenseCategory,
  Goal,
  Invoice,
  Patient,
  PatientPackage,
  PatientStatus,
  Payment,
  PaymentMethod,
  SessionNote,
  Therapist,
  TherapyPackage,
  TherapyPlan,
  TherapyType,
  User,
} from '../types';
import { seedTemplates } from './templates';

/**
 * Prototype seed data, generated relative to "today" so the dashboard always looks
 * alive. Deterministic (seeded RNG), so the same records appear on every reload.
 * This file is never imported by production data paths once the API is connected.
 */

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const at = (day: Date, h: number, m = 0) => setMinutes(setHours(startOfDay(day), h), m);

export function createSeed() {
  const random = rng(42);
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];
  const chance = (p: number) => random() < p;
  const today = startOfDay(new Date());
  const nowIso = new Date().toISOString();

  const center: Center = {
    id: 'ctr_1',
    name: 'Shishu Bikash Therapy Center',
    branch: 'Dhanmondi',
    address: 'House 27, Road 8, Dhanmondi, Dhaka 1205',
    phone: '01711-234567',
    email: 'hello@shishubikash.example',
    workingDays: [6, 0, 1, 2, 3, 4],
    openTime: '09:00',
    closeTime: '19:00',
    weekStartsOn: 6,
  };

  const therapyTypes: TherapyType[] = [
    {
      id: 'tt_ot',
      code: 'OT',
      name: 'Occupational therapy',
      accent: 'ot',
      defaultDurationMinutes: 45,
      active: true,
    },
    {
      id: 'tt_aba',
      code: 'ABA',
      name: 'Applied behaviour analysis',
      accent: 'aba',
      defaultDurationMinutes: 60,
      active: true,
    },
    {
      id: 'tt_slt',
      code: 'SLT',
      name: 'Speech & language therapy',
      accent: 'slt',
      defaultDurationMinutes: 45,
      active: true,
    },
    {
      id: 'tt_pt',
      code: 'PT',
      name: 'Physiotherapy',
      accent: 'other',
      defaultDurationMinutes: 45,
      active: false,
    },
  ];

  const satToThu = (start: string, end: string) =>
    [6, 0, 1, 2, 3, 4].map((day) => ({ day, start, end }));

  const therapists: Therapist[] = [
    {
      id: 'th_1',
      name: 'Farhana Rahman',
      title: 'Senior occupational therapist',
      email: 'farhana@shishubikash.example',
      phone: '01712345601',
      specializationIds: ['tt_ot'],
      qualifications: 'BSc in Occupational Therapy (BHPI), SIPT certified',
      status: 'active',
      workingHours: satToThu('09:00', '17:00'),
      joinedAt: '2021-03-01',
    },
    {
      id: 'th_2',
      name: 'Tanvir Ahmed',
      title: 'Occupational therapist',
      email: 'tanvir@shishubikash.example',
      phone: '01712345602',
      specializationIds: ['tt_ot'],
      qualifications: 'BSc in Occupational Therapy (BHPI)',
      status: 'active',
      workingHours: satToThu('11:00', '19:00'),
      joinedAt: '2022-07-15',
    },
    {
      id: 'th_3',
      name: 'Nusrat Jahan',
      title: 'Speech & language therapist',
      email: 'nusrat@shishubikash.example',
      phone: '01712345603',
      specializationIds: ['tt_slt'],
      qualifications: 'BSc in Speech & Language Therapy (BHPI)',
      status: 'active',
      workingHours: satToThu('09:00', '17:00'),
      joinedAt: '2021-09-01',
    },
    {
      id: 'th_4',
      name: 'Sadia Islam',
      title: 'Speech & language therapist',
      email: 'sadia@shishubikash.example',
      phone: '01712345604',
      specializationIds: ['tt_slt'],
      qualifications: 'MSc in Speech & Language Pathology',
      status: 'active',
      workingHours: [0, 1, 2, 3].map((day) => ({ day, start: '10:00', end: '18:00' })),
      joinedAt: '2023-01-10',
    },
    {
      id: 'th_5',
      name: 'Mahmudul Hasan',
      title: 'Behaviour analyst (BCBA)',
      email: 'mahmud@shishubikash.example',
      phone: '01712345605',
      specializationIds: ['tt_aba'],
      qualifications: 'MS in ABA, BCBA',
      status: 'active',
      workingHours: satToThu('09:00', '17:00'),
      joinedAt: '2020-11-01',
    },
    {
      id: 'th_6',
      name: 'Rumana Akter',
      title: 'Behaviour therapist',
      email: 'rumana@shishubikash.example',
      phone: '01712345606',
      specializationIds: ['tt_aba'],
      qualifications: 'RBT, BSc in Psychology',
      status: 'active',
      workingHours: satToThu('10:00', '18:00'),
      joinedAt: '2022-02-01',
    },
    {
      id: 'th_7',
      name: 'Arif Hossain',
      title: 'Occupational & behaviour therapist',
      email: 'arif@shishubikash.example',
      phone: '01712345607',
      specializationIds: ['tt_ot', 'tt_aba'],
      qualifications: 'BSc in OT, RBT',
      status: 'active',
      workingHours: [6, 1, 2, 4].map((day) => ({ day, start: '09:00', end: '17:00' })),
      joinedAt: '2023-06-01',
    },
    {
      id: 'th_8',
      name: 'Shirin Sultana',
      title: 'Speech & language therapist',
      email: 'shirin@shishubikash.example',
      phone: '01712345608',
      specializationIds: ['tt_slt', 'tt_aba'],
      qualifications: 'BSc in SLT, RBT',
      status: 'on_leave',
      workingHours: satToThu('09:00', '15:00'),
      joinedAt: '2022-10-01',
    },
  ];

  const users: User[] = [
    {
      id: 'usr_manager',
      name: 'Nadia Chowdhury',
      email: 'nadia@shishubikash.example',
      role: 'MANAGER',
    },
    {
      id: 'usr_admin',
      name: 'Kamrul Islam',
      email: 'kamrul@shishubikash.example',
      role: 'CENTER_ADMIN',
    },
    {
      id: 'usr_reception',
      name: 'Rafiq Uddin',
      email: 'rafiq@shishubikash.example',
      role: 'RECEPTIONIST',
    },
    {
      id: 'usr_therapist',
      name: 'Farhana Rahman',
      email: 'farhana@shishubikash.example',
      role: 'THERAPIST',
      therapistId: 'th_1',
    },
  ];

  const packages: TherapyPackage[] = [
    {
      id: 'pkg_ot_single',
      name: 'OT single session',
      therapyTypeId: 'tt_ot',
      billingCadence: 'single',
      price: 1500,
      sessionCount: 1,
      sessionMinutes: 45,
      validityDays: 7,
      status: 'active',
    },
    {
      id: 'pkg_ot_month',
      name: 'OT monthly (12 sessions)',
      therapyTypeId: 'tt_ot',
      billingCadence: 'monthly',
      price: 15000,
      sessionCount: 12,
      sessionMinutes: 45,
      validityDays: 35,
      status: 'active',
      description: '3 sessions a week for a month',
    },
    {
      id: 'pkg_slt_week',
      name: 'SLT weekly (3 sessions)',
      therapyTypeId: 'tt_slt',
      billingCadence: 'weekly',
      price: 4200,
      sessionCount: 3,
      sessionMinutes: 45,
      validityDays: 10,
      status: 'active',
    },
    {
      id: 'pkg_slt_month',
      name: 'SLT monthly (12 sessions)',
      therapyTypeId: 'tt_slt',
      billingCadence: 'monthly',
      price: 14400,
      sessionCount: 12,
      sessionMinutes: 45,
      validityDays: 35,
      status: 'active',
    },
    {
      id: 'pkg_aba_day',
      name: 'ABA daily intensive',
      therapyTypeId: 'tt_aba',
      billingCadence: 'daily',
      price: 3000,
      sessionCount: 1,
      sessionMinutes: 120,
      validityDays: 1,
      status: 'active',
      description: 'One 2-hour 1:1 session',
    },
    {
      id: 'pkg_aba_month',
      name: 'ABA monthly (20 sessions)',
      therapyTypeId: 'tt_aba',
      billingCadence: 'monthly',
      price: 36000,
      sessionCount: 20,
      sessionMinutes: 60,
      validityDays: 35,
      status: 'active',
      description: '5 sessions a week for a month',
    },
    {
      id: 'pkg_ot_block',
      name: 'OT 8-session block',
      therapyTypeId: 'tt_ot',
      billingCadence: 'custom',
      price: 10800,
      sessionCount: 8,
      sessionMinutes: 45,
      validityDays: 60,
      status: 'active',
    },
    {
      id: 'pkg_slt_old',
      name: 'SLT trial pack (legacy)',
      therapyTypeId: 'tt_slt',
      billingCadence: 'custom',
      price: 2500,
      sessionCount: 2,
      sessionMinutes: 30,
      validityDays: 14,
      status: 'archived',
    },
  ];

  // ── Patients ──────────────────────────────────────────────────────────────
  const firstNames = [
    'Ayaan',
    'Ariyan',
    'Zara',
    'Raisa',
    'Rayhan',
    'Nabila',
    'Tahmid',
    'Ishraq',
    'Maliha',
    'Farhan',
    'Samiha',
    'Adiba',
    'Rafsan',
    'Inaya',
    'Sameer',
    'Labiba',
    'Arham',
    'Nuha',
    'Zayan',
    'Mehreen',
    'Tasnim',
    'Rumaisa',
    'Saad',
    'Anaya',
    'Yusuf',
    'Ridwan',
    'Tanha',
    'Ahnaf',
    'Fatiha',
    'Wasif',
    'Ishita',
    'Rafid',
    'Sumaiya',
    'Nafis',
    'Orpa',
    'Shayan',
    'Lamisa',
    'Tazim',
    'Prottoy',
    'Ananya',
    'Arnob',
    'Jannat',
    'Mahir',
    'Afia',
    'Ruhan',
    'Sneha',
  ];
  const surnames = [
    'Rahman',
    'Hossain',
    'Ahmed',
    'Islam',
    'Chowdhury',
    'Khan',
    'Siddiqui',
    'Karim',
    'Haque',
    'Uddin',
    'Kabir',
    'Sarker',
    'Das',
    'Roy',
    'Mahmud',
    'Alam',
  ];
  const parentFirst = {
    father: [
      'Mizanur',
      'Shafiqul',
      'Habibur',
      'Jahangir',
      'Rezaul',
      'Monirul',
      'Saiful',
      'Anisur',
      'Tapan',
      'Faisal',
    ],
    mother: [
      'Sharmin',
      'Nasrin',
      'Taslima',
      'Rokeya',
      'Shahnaz',
      'Farzana',
      'Sabina',
      'Mitu',
      'Rina',
      'Lubna',
    ],
  };
  const bnNames: Record<string, string> = {
    Ayaan: 'আয়ান',
    Zara: 'জারা',
    Raisa: 'রাইসা',
    Rayhan: 'রায়হান',
    Nabila: 'নাবিলা',
    Tahmid: 'তাহমিদ',
    Maliha: 'মালিহা',
    Farhan: 'ফারহান',
    Samiha: 'সামিহা',
    Inaya: 'ইনায়া',
  };
  const concerns = {
    tt_ot: [
      'Difficulty with handwriting and holding a pencil',
      'Sensory sensitivity to noise and textures',
      'Poor balance and coordination',
      'Needs help with dressing and feeding',
    ],
    tt_aba: [
      'Frequent tantrums during transitions',
      'Limited eye contact and joint attention',
      'Difficulty following instructions',
      'Self-injurious behaviour when frustrated',
    ],
    tt_slt: [
      'Not yet speaking in sentences',
      'Unclear speech, hard for others to understand',
      'Stuttering when excited',
      'Limited vocabulary for age',
    ],
  } as const;
  const schools = [
    'Scholastica',
    'Sunbeams',
    'Mastermind',
    'Playpen',
    'Not enrolled',
    'Local madrasa',
    'Kindergarten (home)',
  ];
  const referrals = [
    'Pediatrician',
    'Neurologist',
    'School',
    'Parent / self-referred',
    'Another family',
  ];

  const statusPool: PatientStatus[] = [
    ...Array(36).fill('active'),
    ...Array(4).fill('waitlist'),
    ...Array(3).fill('on_hold'),
    ...Array(3).fill('discharged'),
  ];
  const activeTherapists = therapists.filter((t) => t.status === 'active');

  const patients: Patient[] = statusPool.map((status, i) => {
    const first = firstNames[i % firstNames.length];
    const surname = pick(surnames);
    const ageMonths = 26 + Math.floor(random() * 110);
    const primaryType = pick(['tt_ot', 'tt_ot', 'tt_slt', 'tt_slt', 'tt_aba', 'tt_aba'] as const);
    const types = new Set<string>([primaryType]);
    if (chance(0.3)) types.add(pick(['tt_ot', 'tt_slt', 'tt_aba']));
    const therapist = pick(
      activeTherapists.filter((t) => t.specializationIds.includes(primaryType)),
    );
    const guardianIsMother = chance(0.6);
    const guardianFirst = pick(guardianIsMother ? parentFirst.mother : parentFirst.father);
    return {
      id: `pt_${i + 1}`,
      code: `CZ-${String(1001 + i).padStart(4, '0')}`,
      fullName: `${first} ${surname}`,
      nameBn: bnNames[first],
      dateOfBirth: iso(subDays(today, ageMonths * 30.4)),
      gender: i % 3 === 0 ? 'female' : 'male',
      guardian: {
        name: `${guardianFirst} ${guardianIsMother ? pick(['Begum', 'Akter', 'Khatun', surname]) : surname}`,
        relationship: guardianIsMother ? 'Mother' : 'Father',
        phone: `01${pick(['7', '8', '9', '5', '3'])}${String(10000000 + Math.floor(random() * 89999999))}`,
        email: chance(0.4) ? `${guardianFirst.toLowerCase()}${i}@gmail.com` : undefined,
      },
      address: `${pick(['Dhanmondi', 'Mohammadpur', 'Lalmatia', 'Mirpur', 'Kalabagan', 'Jigatola'])}, Dhaka`,
      school: pick(schools),
      therapyTypeIds: [...types],
      primaryTherapistId: status === 'waitlist' ? undefined : therapist.id,
      status,
      referralSource: pick(referrals),
      primaryConcern: pick(concerns[primaryType]),
      registeredAt: iso(
        subDays(
          today,
          status === 'waitlist' ? Math.floor(random() * 10) : 40 + Math.floor(random() * 400),
        ),
      ),
    };
  });

  // ── Packages per patient ──────────────────────────────────────────────────
  const patientPackages: PatientPackage[] = [];
  const monthly: Record<string, string> = {
    tt_ot: 'pkg_ot_month',
    tt_slt: 'pkg_slt_month',
    tt_aba: 'pkg_aba_month',
  };
  for (const patient of patients.filter((p) => p.status === 'active')) {
    for (const typeId of patient.therapyTypeIds) {
      const templateId = typeId === 'tt_ot' && chance(0.15) ? 'pkg_ot_block' : monthly[typeId];
      const pkgTemplate = packages.find((p) => p.id === templateId)!;
      const start = subDays(today, 3 + Math.floor(random() * 26));
      const paidRoll = random();
      const paidAmount =
        paidRoll < 0.6
          ? pkgTemplate.price
          : paidRoll < 0.85
            ? Math.round(pkgTemplate.price / 2 / 100) * 100
            : 0;
      patientPackages.push({
        id: `pp_${patientPackages.length + 1}`,
        patientId: patient.id,
        packageId: pkgTemplate.id,
        name: pkgTemplate.name,
        therapyTypeId: typeId,
        totalSessions: pkgTemplate.sessionCount,
        usedSessions: 0,
        scheduledSessions: 0,
        startDate: iso(start),
        expiresAt: iso(addDays(start, pkgTemplate.validityDays)),
        price: pkgTemplate.price,
        paidAmount,
        status: 'active',
      });
    }
  }
  // A couple of historical, completed packages for richer profiles
  for (const patient of patients.slice(0, 8)) {
    const typeId = patient.therapyTypeIds[0];
    const tpl = packages.find((p) => p.id === monthly[typeId])!;
    const start = subDays(today, 70);
    patientPackages.push({
      id: `pp_${patientPackages.length + 1}`,
      patientId: patient.id,
      packageId: tpl.id,
      name: tpl.name,
      therapyTypeId: typeId,
      totalSessions: tpl.sessionCount,
      usedSessions: tpl.sessionCount,
      scheduledSessions: 0,
      startDate: iso(start),
      expiresAt: iso(addDays(start, tpl.validityDays)),
      price: tpl.price,
      paidAmount: tpl.price,
      status: 'completed',
    });
  }

  // ── Weekly schedules → appointments ───────────────────────────────────────
  const appointments: Appointment[] = [];
  const busy = new Set<string>(); // `${therapistId}|${weekday}|${hour}`
  const rooms = ['Sensory gym', 'Room 1', 'Room 2', 'Room 3', 'Speech room', 'ABA suite'];
  type Slot = {
    patientId: string;
    therapistId: string;
    therapyTypeId: string;
    weekday: number;
    hour: number;
    minutes: number;
  };
  const weekly: Slot[] = [];

  for (const patient of patients.filter((p) => p.status === 'active' || p.status === 'on_hold')) {
    for (const typeId of patient.therapyTypeIds) {
      const candidates = activeTherapists.filter((t) => t.specializationIds.includes(typeId));
      const therapist =
        candidates.find((t) => t.id === patient.primaryTherapistId) ?? pick(candidates);
      const perWeek = typeId === 'tt_aba' ? 3 : 2;
      const minutes = typeId === 'tt_aba' ? 60 : 45;
      let placed = 0;
      for (let attempt = 0; attempt < 40 && placed < perWeek; attempt++) {
        const hours = therapist.workingHours[Math.floor(random() * therapist.workingHours.length)];
        const startH = Number(hours.start.slice(0, 2));
        const endH = Number(hours.end.slice(0, 2));
        const hour = startH + Math.floor(random() * (endH - startH));
        if (hour === 13) continue; // lunch
        const key = `${therapist.id}|${hours.day}|${hour}`;
        if (
          busy.has(key) ||
          weekly.some(
            (w) => w.patientId === patient.id && w.weekday === hours.day && w.hour === hour,
          )
        )
          continue;
        busy.add(key);
        weekly.push({
          patientId: patient.id,
          therapistId: therapist.id,
          therapyTypeId: typeId,
          weekday: hours.day,
          hour,
          minutes,
        });
        placed++;
      }
    }
  }

  const now = new Date();
  for (let offset = -28; offset <= 21; offset++) {
    const day = addDays(today, offset);
    const weekday = day.getDay();
    if (!center.workingDays.includes(weekday)) continue;
    for (const slot of weekly.filter((w) => w.weekday === weekday)) {
      const patient = patients.find((p) => p.id === slot.patientId)!;
      if (patient.status === 'on_hold' && offset > -7) continue;
      const start = at(day, slot.hour);
      const end = addMinutes(start, slot.minutes);
      let status: Appointment['status'] = 'scheduled';
      if (end < now) {
        const roll = random();
        status = roll < 0.86 ? 'completed' : roll < 0.94 ? 'cancelled' : 'no_show';
      } else if (start <= now) {
        status = 'checked_in';
      } else if (offset <= 7 && chance(0.04)) {
        status = 'cancelled';
      }
      const pkg = patientPackages.find(
        (p) =>
          p.patientId === patient.id &&
          p.therapyTypeId === slot.therapyTypeId &&
          p.status === 'active',
      );
      const inPackage = pkg && day >= new Date(pkg.startDate) ? pkg : undefined;
      const noteStatus: Appointment['noteStatus'] =
        status === 'completed'
          ? offset >= -2 && chance(0.35)
            ? chance(0.5)
              ? 'draft'
              : 'none'
            : 'submitted'
          : 'none';
      appointments.push({
        id: `ap_${appointments.length + 1}`,
        patientId: patient.id,
        therapistId: slot.therapistId,
        therapyTypeId: slot.therapyTypeId,
        kind: 'session',
        start: start.toISOString(),
        end: end.toISOString(),
        status,
        room: pick(rooms),
        patientPackageId: inPackage?.id,
        seriesId: `ser_${slot.patientId}_${slot.therapyTypeId}`,
        noteStatus,
        cancelReason:
          status === 'cancelled'
            ? pick(['Child unwell', 'Family travelling', 'Rescheduled by guardian'])
            : undefined,
      });
      if (inPackage) {
        if (status === 'completed' || status === 'no_show') inPackage.usedSessions++;
        if (status === 'scheduled' || status === 'checked_in') inPackage.scheduledSessions++;
      }
    }
  }
  for (const pkg of patientPackages) {
    if (pkg.status !== 'active') continue;
    pkg.usedSessions = Math.min(pkg.usedSessions, pkg.totalSessions);
    pkg.scheduledSessions = Math.min(pkg.scheduledSessions, pkg.totalSessions - pkg.usedSessions);
  }

  // Upcoming assessments for waitlisted patients
  const waitlist = patients.filter((p) => p.status === 'waitlist');
  waitlist.forEach((patient, i) => {
    const typeId = patient.therapyTypeIds[0];
    const therapist = activeTherapists.find((t) => t.specializationIds.includes(typeId))!;
    let day = addDays(today, i + 1);
    while (!center.workingDays.includes(day.getDay())) day = addDays(day, 1);
    // First afternoon hour where the therapist has a two-hour gap in their weekly schedule
    const hour =
      [14, 15, 11, 10].find(
        (h) =>
          !busy.has(`${therapist.id}|${day.getDay()}|${h}`) &&
          !busy.has(`${therapist.id}|${day.getDay()}|${h + 1}`),
      ) ?? 14;
    const start = at(day, hour, 0);
    appointments.push({
      id: `ap_${appointments.length + 1}`,
      patientId: patient.id,
      therapistId: therapist.id,
      therapyTypeId: typeId,
      kind: 'assessment',
      start: start.toISOString(),
      end: addMinutes(start, 90).toISOString(),
      status: 'scheduled',
      room: 'Assessment room',
      noteStatus: 'none',
    });
  });

  // ── Clinical records ─────────────────────────────────────────────────────
  const goalBank = {
    tt_ot: [
      'Holds pencil with tripod grasp for 5 minutes',
      'Tolerates new food textures at snack time',
      'Buttons shirt independently',
      'Maintains seated attention for 10 minutes',
      'Climbs and descends stairs with alternating feet',
    ],
    tt_aba: [
      'Responds to name in 4 of 5 opportunities',
      'Requests preferred items using 2-word phrases',
      'Transitions between activities with visual schedule',
      'Reduces tantrum duration to under 2 minutes',
      'Follows 2-step instructions',
    ],
    tt_slt: [
      'Produces /s/ in initial position of words',
      'Uses 3-word sentences to request',
      'Names 20 common objects',
      'Answers simple “what” and “where” questions',
      'Takes 3 conversational turns',
    ],
  } as const;

  const goals: Goal[] = [];
  const therapyPlans: TherapyPlan[] = [];
  const assessments: Assessment[] = [];

  for (const patient of patients) {
    for (const typeId of patient.therapyTypeIds as (keyof typeof goalBank)[]) {
      if (patient.status === 'waitlist') continue;
      const bank = goalBank[typeId];
      const count = 2 + Math.floor(random() * 2);
      const offset = Math.floor(random() * bank.length);
      for (let g = 0; g < count; g++) {
        goals.push({
          id: `gl_${goals.length + 1}`,
          patientId: patient.id,
          therapyTypeId: typeId,
          title: bank[(offset + g) % bank.length],
          status: g === 0 && chance(0.25) ? 'achieved' : 'active',
          targetDate: iso(addDays(today, 30 + Math.floor(random() * 60))),
          createdAt: patient.registeredAt,
        });
      }
      const therapistId =
        weekly.find((w) => w.patientId === patient.id && w.therapyTypeId === typeId)?.therapistId ??
        patient.primaryTherapistId ??
        activeTherapists[0].id;
      therapyPlans.push({
        id: `tp_${therapyPlans.length + 1}`,
        patientId: patient.id,
        therapyTypeId: typeId,
        therapistId,
        sessionsPerWeek:
          weekly.filter((w) => w.patientId === patient.id && w.therapyTypeId === typeId).length ||
          2,
        sessionMinutes: typeId === 'tt_aba' ? 60 : 45,
        startDate: patient.registeredAt,
        reviewDate: iso(addDays(today, 10 + Math.floor(random() * 50))),
        focus: patient.primaryConcern ?? '',
      });
      assessments.push({
        id: `as_${assessments.length + 1}`,
        patientId: patient.id,
        therapistId,
        therapyTypeId: typeId,
        templateId: 'tpl_assess_general',
        templateVersion: 3,
        date: patient.registeredAt,
        status: 'completed',
        updatedAt: new Date(patient.registeredAt).toISOString(),
        values: {
          assessment_type: 'initial',
          referral_source: 'pediatrician',
          primary_concern: patient.primaryConcern,
          domains:
            typeId === 'tt_ot'
              ? ['fine_motor', 'sensory']
              : typeId === 'tt_slt'
                ? ['communication']
                : ['behavior', 'social'],
          motor_level: 'moderate',
          receptive_language: 'mild',
          expressive_language: 'moderate',
          observations:
            'Engaged well with play-based tasks after a short warm-up. Needed frequent breaks.',
          functional_ability: 'needs_some_support',
          strengths: 'Curious, enjoys music and visual activities, good family support.',
          difficulties: patient.primaryConcern,
          summary:
            'Presents with needs consistent with the referral concern. Recommend structured therapy with home program.',
          recommended_therapy: [typeId],
          frequency: '2',
        },
      });
    }
  }
  waitlist.forEach((patient) => {
    const appt = appointments.find((a) => a.patientId === patient.id && a.kind === 'assessment');
    assessments.push({
      id: `as_${assessments.length + 1}`,
      patientId: patient.id,
      therapistId: appt?.therapistId ?? activeTherapists[0].id,
      therapyTypeId: patient.therapyTypeIds[0],
      templateId: patient.therapyTypeIds[0] === 'tt_slt' ? 'tpl_assess_slt' : 'tpl_assess_general',
      templateVersion: patient.therapyTypeIds[0] === 'tt_slt' ? 1 : 3,
      date: appt ? iso(new Date(appt.start)) : iso(today),
      status: 'scheduled',
      updatedAt: nowIso,
      values: { primary_concern: patient.primaryConcern },
    });
  });

  const activities = {
    tt_ot: [
      'Obstacle course, theraputty, bead threading',
      'Swing, scooter board, pegboard',
      'Handwriting warm-ups, scissor skills',
      'Sensory bin play, dressing practice',
    ],
    tt_aba: [
      'DTT: receptive labels, manding with PECS',
      'Natural environment teaching during snack',
      'Turn-taking games, visual schedule practice',
      'Token economy, waiting practice',
    ],
    tt_slt: [
      'Articulation drills with picture cards',
      'Shared book reading, expanding utterances',
      'Oral motor exercises, bubble play',
      'Barrier games for following directions',
    ],
  } as const;
  const sessionNotes: SessionNote[] = [];
  for (const appt of appointments) {
    if (appt.noteStatus === 'none') continue;
    const typeId = appt.therapyTypeId as keyof typeof activities;
    const patientGoals = goals.filter(
      (g) => g.patientId === appt.patientId && g.therapyTypeId === typeId && g.status === 'active',
    );
    sessionNotes.push({
      id: `sn_${sessionNotes.length + 1}`,
      appointmentId: appt.id,
      patientId: appt.patientId,
      therapistId: appt.therapistId,
      therapyTypeId: appt.therapyTypeId,
      date: iso(new Date(appt.start)),
      status: appt.noteStatus === 'submitted' ? 'submitted' : 'draft',
      activities: pick(activities[typeId]),
      participation: pick(['excellent', 'good', 'good', 'fair', 'poor'] as const),
      goals: patientGoals.slice(0, 2).map((g) => ({
        goalId: g.id,
        progress: pick(['emerging', 'progressing', 'progressing', 'achieved'] as const),
      })),
      observations:
        appt.noteStatus === 'draft'
          ? ''
          : pick([
              'Settled quickly, good eye contact today.',
              'Needed more prompting than last session; tired after school.',
              'Showed new spontaneous words during play.',
              'Tolerated transitions well with timer.',
            ]),
      nextPlan:
        appt.noteStatus === 'draft'
          ? ''
          : pick([
              'Continue current targets, add one new activity.',
              'Introduce visual timer at home.',
              'Increase task duration by 2 minutes.',
            ]),
      custom: {},
      updatedAt: appt.end,
      submittedAt: appt.noteStatus === 'submitted' ? appt.end : undefined,
    });
  }

  // ── Billing ──────────────────────────────────────────────────────────────
  const invoices: Invoice[] = [];
  const payments: Payment[] = [];
  const methods: PaymentMethod[] = ['cash', 'cash', 'bkash', 'bkash', 'nagad', 'card', 'bank'];
  const receivers = ['Rafiq Uddin', 'Rafiq Uddin', 'Nadia Chowdhury'];

  for (const pkg of patientPackages) {
    const issued = new Date(pkg.startDate);
    const due = addDays(issued, 7);
    const invoice: Invoice = {
      id: `inv_${invoices.length + 1}`,
      number: `INV-${format(issued, 'yyMM')}-${String(invoices.length + 101).padStart(4, '0')}`,
      patientId: pkg.patientId,
      patientPackageId: pkg.id,
      issuedAt: iso(issued),
      dueAt: iso(due),
      items: [{ description: pkg.name, quantity: 1, unitPrice: pkg.price }],
      discount: 0,
      total: pkg.price,
      paid: pkg.paidAmount,
      status:
        pkg.paidAmount >= pkg.price
          ? 'paid'
          : pkg.paidAmount > 0
            ? 'partial'
            : due < today
              ? 'overdue'
              : 'unpaid',
    };
    invoices.push(invoice);
    if (pkg.paidAmount > 0) {
      const instalments = pkg.paidAmount === pkg.price && chance(0.3) ? 2 : 1;
      for (let k = 0; k < instalments; k++) {
        const received = at(
          addDays(issued, k * 5),
          9 + Math.floor(random() * 9),
          pick([0, 15, 30, 45]),
        );
        payments.push({
          id: `pay_${payments.length + 1}`,
          receiptNumber: `RCP-${String(payments.length + 5001)}`,
          invoiceId: invoice.id,
          patientId: pkg.patientId,
          amount: Math.round(pkg.paidAmount / instalments),
          method: pick(methods),
          reference: undefined,
          receivedAt: (received > now ? now : received).toISOString(),
          receivedBy: pick(receivers),
        });
      }
    }
  }
  // Single sessions and assessment fees collected today, so "today's collection" is non-zero
  patients
    .filter((p) => p.status === 'active')
    .slice(0, 6)
    .forEach((patient, i) => {
      const issued = today;
      const amount = i % 2 === 0 ? 1500 : 2500;
      const invoice: Invoice = {
        id: `inv_${invoices.length + 1}`,
        number: `INV-${format(issued, 'yyMM')}-${String(invoices.length + 101).padStart(4, '0')}`,
        patientId: patient.id,
        issuedAt: iso(issued),
        dueAt: iso(issued),
        items: [
          {
            description: i % 2 === 0 ? 'OT single session' : 'Progress review assessment',
            quantity: 1,
            unitPrice: amount,
          },
        ],
        discount: 0,
        total: amount,
        paid: i < 4 ? amount : 0,
        status: i < 4 ? 'paid' : 'unpaid',
      };
      invoices.push(invoice);
      if (i < 4) {
        const received = at(today, 9 + i, 20);
        payments.push({
          id: `pay_${payments.length + 1}`,
          receiptNumber: `RCP-${String(payments.length + 5001)}`,
          invoiceId: invoice.id,
          patientId: patient.id,
          amount,
          method: pick(methods),
          receivedAt: (received > now ? subDays(now, 0) : received).toISOString(),
          receivedBy: 'Rafiq Uddin',
        });
      }
    });

  const expenses: Expense[] = [];
  const expenseLines: [ExpenseCategory, string, number, string][] = [
    ['rent', 'Monthly rent – Dhanmondi premises', 180000, 'Landlord'],
    ['salary', 'Therapist & staff salaries', 640000, 'Payroll'],
    ['utilities', 'Electricity (DESCO)', 14500, 'DESCO'],
    ['utilities', 'Internet & phone', 4200, 'Link3'],
    ['supplies', 'Therapy materials & toys', 18600, 'Toy World'],
    ['maintenance', 'AC servicing', 6000, 'CoolTech'],
    ['marketing', 'Facebook page promotion', 5000, 'Meta'],
  ];
  for (let m = 2; m >= 0; m--) {
    const monthStart = new Date(today.getFullYear(), today.getMonth() - m, 1);
    expenseLines.forEach(([category, description, amount, paidTo], i) => {
      const date = addDays(monthStart, i * 3 + 1);
      if (date > today) return;
      expenses.push({
        id: `exp_${expenses.length + 1}`,
        date: iso(date),
        category,
        description,
        amount: category === 'supplies' ? amount + Math.floor(random() * 5000) : amount,
        method: category === 'salary' || category === 'rent' ? 'bank' : pick(['cash', 'bkash']),
        paidTo,
      });
    });
  }

  const notifications: AppNotification[] = [
    {
      id: 'nt_1',
      title: 'Session notes pending',
      body: 'Some completed sessions from the last two days still need notes.',
      href: '/sessions?note=PENDING',
      createdAt: subDays(now, 0).toISOString(),
      read: false,
    },
    {
      id: 'nt_2',
      title: 'Package expiring soon',
      body: 'Several patient packages expire within 7 days.',
      href: '/packages',
      createdAt: subDays(now, 1).toISOString(),
      read: false,
    },
    {
      id: 'nt_3',
      title: 'Shirin Sultana is on leave',
      body: 'She is unavailable for new bookings until marked active.',
      href: '/therapists/th_8',
      createdAt: subDays(now, 2).toISOString(),
      read: true,
    },
  ];

  return {
    center,
    users,
    therapyTypes,
    therapists,
    patients,
    packages,
    patientPackages,
    appointments,
    templates: seedTemplates(nowIso),
    assessments,
    goals,
    therapyPlans,
    sessionNotes,
    invoices,
    payments,
    expenses,
    notifications,
  };
}

export type MockDb = ReturnType<typeof createSeed>;
