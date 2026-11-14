export type CategoryId =
  | "road_accident"
  | "traffic_violation"
  | "police_misconduct"
  | "infrastructure"
  | "public_safety"
  | "other";
export type SignShape = "triangle" | "circle" | "shield" | "diamond" | "square" | "octagon";

export interface Category {
  id: CategoryId;
  bn: string;
  en: string;
  hint: string;
  shape: SignShape;
  /** CSS variable holding the category colour */
  colorVar: string;
}

export const CATEGORIES: Category[] = [
  {
    id: "road_accident",
    bn: "সড়ক দুর্ঘটনা",
    en: "Road Accident",
    hint: "সংঘর্ষ, আহত, গাড়ি উল্টে যাওয়া",
    shape: "triangle",
    colorVar: "--cat-accident",
  },
  {
    id: "traffic_violation",
    bn: "ট্রাফিক আইন ভঙ্গ",
    en: "Traffic Violation",
    hint: "উল্টো পথ, সিগন্যাল অমান্য, বেপরোয়া চালনা",
    shape: "circle",
    colorVar: "--cat-violation",
  },
  {
    id: "police_misconduct",
    bn: "পুলিশি হয়রানি",
    en: "Police Misconduct / Harassment",
    hint: "চেকপোস্টে হয়রানি, অসদাচরণ",
    shape: "shield",
    colorVar: "--cat-police",
  },
  {
    id: "infrastructure",
    bn: "রাস্তা ও অবকাঠামো",
    en: "Road & Infrastructure",
    hint: "গর্ত, ভাঙা রাস্তা, নষ্ট লাইট",
    shape: "diamond",
    colorVar: "--cat-road",
  },
  {
    id: "public_safety",
    bn: "জননিরাপত্তা",
    en: "Public Safety Concern",
    hint: "ফুটপাত দখল, ঝুঁকিপূর্ণ এলাকা",
    shape: "square",
    colorVar: "--cat-safety",
  },
  {
    id: "other",
    bn: "অন্যান্য",
    en: "Other",
    hint: "অন্য যেকোনো রাস্তার ঘটনা",
    shape: "octagon",
    colorVar: "--cat-other",
  },
];

export const categoryById = (id: CategoryId) => CATEGORIES.find((c) => c.id === id)!;

export interface Incident {
  id: string;
  trackingId: string;
  title: string;
  description: string;
  category: CategoryId;
  lat: number;
  lng: number;
  roadName: string;
  areaName: string;
  incidentAt: number;
  createdAt: number;
  safetyTip?: string | undefined;
  support: number;
  dispute: number;
  flags: number;
  commentCount: number;
  isEdited?: boolean | undefined;
  editedAt?: number | undefined;
  byModerator?: boolean | undefined;
  viewerState: {
    vote: "support" | "dispute" | null;
    hasFlagged: boolean;
  };
}

export type CommentType = "info" | "correction" | "experience";
export const COMMENT_TYPES: { id: CommentType; bn: string; en: string }[] = [
  { id: "info", bn: "অতিরিক্ত তথ্য", en: "Extra information" },
  { id: "correction", bn: "সংশোধন", en: "Correction" },
  { id: "experience", bn: "আমার অভিজ্ঞতা", en: "My experience" },
];

export interface IncidentComment {
  id: string;
  incidentId: string;
  type: CommentType;
  text: string;
  createdAt: number;
  mine?: boolean | undefined;
  canDelete?: boolean | undefined;
  hasFlagged?: boolean | undefined;
}

export const INCIDENT_FLAG_REASONS = [
  { id: "spam", bn: "স্প্যাম", en: "Spam" },
  { id: "fake", bn: "ভুয়া", en: "Fake" },
  { id: "misleading", bn: "বিভ্রান্তিকর", en: "Misleading" },
  { id: "inappropriate", bn: "অনুপযুক্ত", en: "Inappropriate" },
  { id: "irrelevant", bn: "অপ্রাসঙ্গিক", en: "Irrelevant" },
] as const;

export const COMMENT_FLAG_REASONS = [
  { id: "spam", bn: "স্প্যাম", en: "Spam" },
  { id: "fake", bn: "ভুয়া", en: "Fake" },
  { id: "misleading", bn: "বিভ্রান্তিকর", en: "Misleading" },
  { id: "inappropriate", bn: "অনুপযুক্ত", en: "Inappropriate" },
  { id: "irrelevant", bn: "অপ্রাসঙ্গিক", en: "Irrelevant" },
] as const;

/* ---------- Rules from the SRS ---------- */
export const RULES = {
  titleMin: 5,
  titleMax: 100,
  descMin: 20,
  descMax: 2000,
  tipMax: 500,
  commentMin: 5,
  commentMax: 500,
  commentsPerDay: 5,
  quickEditMinutes: 15,
  maxEditChangeRatio: 0.2,
  pageSize: 20,
  commentsPageSize: 10,
};

/** Bangladesh bounding box (approximate) */
export const BD_BOUNDS = { minLat: 20.55, maxLat: 26.65, minLng: 88.0, maxLng: 92.7 };
export const isInBangladesh = (lat: number, lng: number) =>
  lat >= BD_BOUNDS.minLat &&
  lat <= BD_BOUNDS.maxLat &&
  lng >= BD_BOUNDS.minLng &&
  lng <= BD_BOUNDS.maxLng;

export const DHAKA_CENTER: [number, number] = [23.7808, 90.4093];

export const DHAKA_AREAS = [
  { name: "ফার্মগেট", road: "কাজী নজরুল ইসলাম এভিনিউ", lat: 23.7577, lng: 90.3899 },
  { name: "মিরপুর ১০", road: "বেগম রোকেয়া সরণি", lat: 23.8069, lng: 90.3687 },
  { name: "গুলিস্তান", road: "বঙ্গবন্ধু এভিনিউ", lat: 23.7253, lng: 90.4126 },
  { name: "ধানমন্ডি ২৭", road: "সাতমসজিদ রোড", lat: 23.7559, lng: 90.3733 },
  { name: "মহাখালী", road: "মহাখালী ফ্লাইওভার", lat: 23.7778, lng: 90.4005 },
  { name: "সায়েদাবাদ", road: "ঢাকা-চট্টগ্রাম মহাসড়ক", lat: 23.7099, lng: 90.4295 },
  { name: "গুলশান ১", road: "গুলশান এভিনিউ", lat: 23.7806, lng: 90.4167 },
  { name: "বনানী", road: "কামাল আতাতুর্ক এভিনিউ", lat: 23.7937, lng: 90.4066 },
  { name: "উত্তরা", road: "এয়ারপোর্ট রোড", lat: 23.8759, lng: 90.3795 },
  { name: "মতিঝিল", road: "শাপলা চত্বর", lat: 23.7329, lng: 90.4176 },
  { name: "যাত্রাবাড়ী", road: "যাত্রাবাড়ী ফ্লাইওভার", lat: 23.7104, lng: 90.4348 },
  { name: "মোহাম্মদপুর", road: "আসাদ এভিনিউ", lat: 23.7644, lng: 90.3587 },
  { name: "বাড্ডা", road: "প্রগতি সরণি", lat: 23.7806, lng: 90.4265 },
  { name: "শাহবাগ", road: "শাহবাগ মোড়", lat: 23.7385, lng: 90.3958 },
];

/** Mock reverse geocode: nearest known area (UI demo only). */
export function nearestArea(lat: number, lng: number) {
  let best = DHAKA_AREAS[0]!;
  let bestD = Infinity;
  for (const a of DHAKA_AREAS) {
    const d = (a.lat - lat) ** 2 + (a.lng - lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  // ~3 km threshold — outside it we don't know the road
  return bestD < 0.0008 ? best : { ...best, road: "", name: `${best.name} এর কাছে` };
}

/* ---------- Bangla formatting ---------- */
const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
export const bn = (v: number | string) =>
  String(v).replace(/\d/g, (d) => BN_DIGITS[Number(d)] ?? d);

export function timeAgo(ts: number, now = Date.now()) {
  const m = Math.max(0, Math.round((now - ts) / 60000));
  if (m < 1) return "এইমাত্র";
  if (m < 60) return `${bn(m)} মিনিট আগে`;
  const h = Math.round(m / 60);
  if (h < 24) return `${bn(h)} ঘণ্টা আগে`;
  const d = Math.round(h / 24);
  return `${bn(d)} দিন আগে`;
}

const BN_MONTHS = [
  "জানু",
  "ফেব্রু",
  "মার্চ",
  "এপ্রিল",
  "মে",
  "জুন",
  "জুলাই",
  "আগস্ট",
  "সেপ্টে",
  "অক্টো",
  "নভে",
  "ডিসে",
];
export function formatDateTime(ts: number) {
  const d = new Date(ts);
  let h = d.getHours();
  const part = h < 12 ? "সকাল" : h < 16 ? "দুপুর" : h < 19 ? "বিকাল" : "রাত";
  h = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${bn(d.getDate())} ${BN_MONTHS[d.getMonth()]}, ${part} ${bn(h)}:${bn(mm)}`;
}

/* ---------- Seed data (UI demo) ---------- */
const MIN = 60_000;
const now = Date.now();

type Seed = Omit<Incident, "id" | "createdAt" | "incidentAt" | "viewerState"> & { ago: number };

const SEEDS: Seed[] = [
  {
    trackingId: "MD-DEMO01",
    title: "শাহবাগ মোড়ে সিগন্যাল বন্ধ, গাড়ি জট",
    description:
      "শাহবাগ মোড়ের ট্রাফিক সিগন্যাল কাজ করছে না। চারদিক থেকে গাড়ি একসাথে ঢুকে পড়ায় বড় জট তৈরি হয়েছে, পথচারীদের পার হতে খুব কষ্ট হচ্ছে।",
    category: "traffic_violation",
    lat: 23.7385,
    lng: 90.3958,
    roadName: "শাহবাগ মোড়",
    areaName: "শাহবাগ, ঢাকা",
    ago: 5,
    support: 3,
    dispute: 0,
    flags: 0,
    commentCount: 0,
    safetyTip: "এই সময় মৎস্য ভবন হয়ে বিকল্প পথ ব্যবহার করুন।",
  },
  {
    trackingId: "MD-7K3Q9X",
    title: "ফার্মগেট মোড়ে বাস ও মোটরসাইকেলের সংঘর্ষ",
    description:
      "আজ সকাল সাড়ে ৯টার দিকে ফার্মগেট মোড়ে একটি বাসের সঙ্গে মোটরসাইকেলের সংঘর্ষ হয়েছে। মোটরসাইকেল চালক আহত হয়ে পাশের হাসপাতালে নেওয়া হয়েছে। এর ফলে কিছু সময়ের জন্য যান চলাচল ধীর হয়ে পড়ে।",
    category: "road_accident",
    lat: 23.7577,
    lng: 90.3899,
    roadName: "কাজী নজরুল ইসলাম এভিনিউ",
    areaName: "ফার্মগেট, ঢাকা",
    ago: 35,
    support: 48,
    dispute: 6,
    flags: 1,
    commentCount: 3,
    safetyTip: "মোড় পার হওয়ার সময় বাসের বাম পাশ দিয়ে ওভারটেক করবেন না।",
  },
  {
    trackingId: "MD-R2M8LP",
    title: "মিরপুর ১০ নম্বরের কাছে রাস্তার বড় গর্ত",
    description:
      "মেইন রোডের একপাশে বড় গর্ত দেখা যাচ্ছে। বৃষ্টির পানি জমে থাকায় গর্তটি বোঝা যায় না। বিশেষ করে সন্ধ্যার পর বাইক ও রিকশা চলাচলে সমস্যা হতে পারে।",
    category: "infrastructure",
    lat: 23.8069,
    lng: 90.3687,
    roadName: "বেগম রোকেয়া সরণি",
    areaName: "মিরপুর ১০, ঢাকা",
    ago: 62,
    support: 31,
    dispute: 3,
    flags: 0,
    commentCount: 2,
    safetyTip: "রাতে বাম লেন এড়িয়ে চলুন, গর্তে পানি জমে থাকে।",
  },
  {
    trackingId: "MD-G5T1WA",
    title: "গুলিস্তানে উল্টো পথে যান চলাচল",
    description:
      "গুলিস্তান এলাকায় কয়েকটি মোটরসাইকেল ও সিএনজি উল্টো পথে চলাচল করায় পথচারীদের রাস্তা পার হতে অসুবিধা হচ্ছে। ট্রাফিক পুলিশ উপস্থিত থাকলেও নিয়ন্ত্রণ হচ্ছে না।",
    category: "traffic_violation",
    lat: 23.7253,
    lng: 90.4126,
    roadName: "বঙ্গবন্ধু এভিনিউ",
    areaName: "গুলিস্তান, ঢাকা",
    ago: 128,
    support: 24,
    dispute: 12,
    flags: 2,
    commentCount: 1,
  },
  {
    trackingId: "MD-D9F4HN",
    title: "ধানমন্ডি ২৭-এ ফুটপাত দখলের কারণে ভিড়",
    description:
      "ফুটপাতের একাংশ দোকানের মালামালে বন্ধ থাকায় অনেক পথচারী মূল সড়কে নেমে হাঁটছেন। অফিস টাইমে দুর্ঘটনার ঝুঁকি বাড়তে পারে।",
    category: "public_safety",
    lat: 23.7559,
    lng: 90.3733,
    roadName: "সাতমসজিদ রোড",
    areaName: "ধানমন্ডি ২৭, ঢাকা",
    ago: 190,
    support: 19,
    dispute: 4,
    flags: 0,
    commentCount: 0,
    safetyTip: "শিশুদের নিয়ে হাঁটলে রাস্তার ভেতরের দিকে রাখুন।",
  },
  {
    trackingId: "MD-P8C2VB",
    title: "মহাখালীতে চেকপোস্টে হয়রানির অভিযোগ",
    description:
      "একজন যাত্রী জানিয়েছেন, মহাখালী এলাকায় চেকপোস্টে প্রয়োজনীয় কাগজপত্র দেখানোর পরেও তাকে প্রায় ৪০ মিনিট দাঁড় করিয়ে রাখা হয়। এটি পোস্টকারীর অভিযোগ।",
    category: "police_misconduct",
    lat: 23.7778,
    lng: 90.4005,
    roadName: "মহাখালী ফ্লাইওভার",
    areaName: "মহাখালী, ঢাকা",
    ago: 250,
    support: 17,
    dispute: 20,
    flags: 3,
    commentCount: 4,
  },
  {
    trackingId: "MD-S3L7QE",
    title: "সায়েদাবাদ এলাকায় রাস্তার আলো নষ্ট",
    description:
      "বাস টার্মিনালের পাশের রাস্তায় কয়েকটি স্ট্রিট লাইট কাজ করছে না। রাতের বেলা পথচারীদের চলাফেরায় অসুবিধা হচ্ছে, ছিনতাইয়ের ভয়ও আছে।",
    category: "other",
    lat: 23.7099,
    lng: 90.4295,
    roadName: "ঢাকা-চট্টগ্রাম মহাসড়ক",
    areaName: "সায়েদাবাদ, ঢাকা",
    ago: 370,
    support: 12,
    dispute: 2,
    flags: 0,
    commentCount: 0,
  },
  {
    trackingId: "MD-U1N6KR",
    title: "উত্তরায় ট্রাক ও প্রাইভেটকারের সংঘর্ষ",
    description:
      "এয়ারপোর্ট রোডে উত্তরা হাউস বিল্ডিংয়ের কাছে একটি ট্রাক পেছন থেকে প্রাইভেটকারকে ধাক্কা দেয়। কেউ গুরুতর আহত হননি, তবে দুই লেন প্রায় এক ঘণ্টা বন্ধ ছিল।",
    category: "road_accident",
    lat: 23.8759,
    lng: 90.3795,
    roadName: "এয়ারপোর্ট রোড",
    areaName: "উত্তরা, ঢাকা",
    ago: 60 * 22,
    support: 56,
    dispute: 2,
    flags: 0,
    commentCount: 5,
    isEdited: true,
  },
  {
    trackingId: "MD-B4A9ZT",
    title: "বাড্ডায় প্রগতি সরণির ম্যানহোল খোলা",
    description:
      "উত্তর বাড্ডা বাস স্টপের ঠিক সামনে একটি ম্যানহোলের ঢাকনা নেই। আশেপাশে কোনো সতর্কতা চিহ্ন দেওয়া হয়নি, রাতে খুব বিপজ্জনক।",
    category: "infrastructure",
    lat: 23.7806,
    lng: 90.4265,
    roadName: "প্রগতি সরণি",
    areaName: "বাড্ডা, ঢাকা",
    ago: 60 * 30,
    support: 41,
    dispute: 1,
    flags: 0,
    commentCount: 2,
    safetyTip: "বাস থেকে নামার সময় ফুটপাতের কিনারা দেখে নামুন।",
  },
  {
    trackingId: "MD-M6X3JD",
    title: "মতিঝিলে সিগন্যাল অমান্য করে বাস চলাচল",
    description:
      "শাপলা চত্বরে লাল বাতি থাকা অবস্থায় একাধিক বাস দ্রুত গতিতে মোড় পার হচ্ছে। পথচারী পারাপারের জন্য জেব্রা ক্রসিং থাকলেও বাস থামছে না।",
    category: "traffic_violation",
    lat: 23.7329,
    lng: 90.4176,
    roadName: "শাপলা চত্বর",
    areaName: "মতিঝিল, ঢাকা",
    ago: 60 * 52,
    support: 33,
    dispute: 5,
    flags: 0,
    commentCount: 1,
  },
  {
    trackingId: "MD-Y2H5CW",
    title: "যাত্রাবাড়ী ফ্লাইওভারের নিচে জলাবদ্ধতা",
    description:
      "রাতের বৃষ্টির পর যাত্রাবাড়ী ফ্লাইওভারের নিচে হাঁটু পানি জমেছে। রিকশা ও বাইক আটকে যাচ্ছে, অনেক গাড়ি উল্টো পাশ দিয়ে ঘুরে যাচ্ছে।",
    category: "public_safety",
    lat: 23.7104,
    lng: 90.4348,
    roadName: "যাত্রাবাড়ী ফ্লাইওভার",
    areaName: "যাত্রাবাড়ী, ঢাকা",
    ago: 60 * 24 * 4,
    support: 27,
    dispute: 3,
    flags: 0,
    commentCount: 0,
  },
  {
    trackingId: "MD-K7E2RS",
    title: "বনানীতে রাতে ছিনতাইয়ের চেষ্টা",
    description:
      "কামাল আতাতুর্ক এভিনিউয়ের ফুটওভার ব্রিজের কাছে রাত ১১টার দিকে দুইজন বাইক আরোহী এক পথচারীর ব্যাগ টেনে নেওয়ার চেষ্টা করে। আশেপাশের লোকজন এগিয়ে আসায় তারা পালিয়ে যায়।",
    category: "public_safety",
    lat: 23.7937,
    lng: 90.4066,
    roadName: "কামাল আতাতুর্ক এভিনিউ",
    areaName: "বনানী, ঢাকা",
    ago: 60 * 24 * 12,
    support: 64,
    dispute: 8,
    flags: 1,
    commentCount: 6,
    safetyTip: "রাতে ফুটওভার ব্রিজ ব্যবহারের সময় ব্যাগ রাস্তার উল্টো দিকে রাখুন।",
  },
];

export const SEED_INCIDENTS: Incident[] = SEEDS.map(({ ago, ...s }, i) => ({
  ...s,
  id: s.trackingId.toLowerCase(),
  createdAt: now - ago * MIN,
  incidentAt: now - (ago + 10 + i * 3) * MIN,
  editedAt: s.isEdited ? now - (ago - 8) * MIN : undefined,
  viewerState: { vote: null, hasFlagged: false },
}));

/** Demo credentials so the tracking screen can be tried right away. */
export const DEMO_TRACKING = { trackingId: "MD-DEMO01", secret: "SHAH-BAGH-2026-DEMO" };

export const SEED_COMMENTS: IncidentComment[] = [
  {
    id: "c1",
    incidentId: "md-7k3q9x",
    type: "info",
    text: "আমি পাশেই ছিলাম, এম্বুলেন্স ১০ মিনিটের মধ্যে এসেছিল।",
    createdAt: now - 20 * MIN,
  },
  {
    id: "c2",
    incidentId: "md-7k3q9x",
    type: "correction",
    text: "সংঘর্ষটা মোড়ের ঠিক আগে, তেজগাঁও কলেজের সামনে হয়েছে।",
    createdAt: now - 25 * MIN,
  },
  {
    id: "c3",
    incidentId: "md-7k3q9x",
    type: "experience",
    text: "এই মোড়ে প্রতিদিন বাসগুলো রেস করে। কঠোর ব্যবস্থা দরকার।",
    createdAt: now - 31 * MIN,
  },
  {
    id: "c4",
    incidentId: "md-r2m8lp",
    type: "info",
    text: "গর্তটা গত সপ্তাহ থেকে আছে, এখন আরও বড় হয়েছে।",
    createdAt: now - 40 * MIN,
  },
  {
    id: "c5",
    incidentId: "md-p8c2vb",
    type: "experience",
    text: "আমারও একই অভিজ্ঞতা হয়েছিল গত মাসে।",
    createdAt: now - 3 * 60 * MIN,
  },
];

export function generateTrackingId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "MD-";
  const arr = new Uint32Array(6);
  crypto.getRandomValues(arr);
  for (const n of arr) s += chars[n % chars.length];
  return s;
}

export function generateSecret() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint32Array(16);
  crypto.getRandomValues(arr);
  const raw = Array.from(arr, (n) => chars[n % chars.length]).join("");
  return raw.match(/.{4}/g)!.join("-");
}

/** Rough share of text changed between two strings (0..1). */
export function changeRatio(a: string, b: string) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 1;
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n]! / Math.max(m, n);
}

export const hasLink = (t: string) => /(https?:\/\/|www\.|\.[a-z]{2,}\/)/i.test(t);
