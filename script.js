import WaveSurfer from 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js';
import { Grid } from './grid.js';

// BASIC CONSTANTS AND VARIABLES

// ===== DATA SOURCE MODE =====
// 'dummy'  → only current dummy data
// 'mixed'  → dummy data + all groups from Strapi
// 'strapi' → only all groups from Strapi 
const DATA_MODE = 'strapi'; // change to 'mixed' or 'strapi' as needed

// ===== STRAPI SETUP =====
const STRAPI = {
  base: 'https://va-cms.mpgs.de/api', // e.g. http://localhost:1337/api
  token: 'Bearer 94b9db053fd8114aaa4fc125aaa584d3958c3ac9c24b480f206d132a45a6c14a44f286c4f754e775e1f6680a636bcd00f0632a1206da31c74914148f74f468ae95ccec1f913bec4170ef7c34d06de270a4b4569816d76e977c569e02951dc9a342c0ee70263822ee23953829549c560913d31c1dc43ea4cec78e1d17b8924130',                         // optional: 'Bearer xxx'
  pageSize: 1000                     // safety for pagination
};

// === STRAPI LOGGING ===
const slog = (kind, ...args) => console.log(`[strapi:${kind}]`, ...args);

// EMD BASIC CONSTANTS AND VARIABLES

// START TAGS DEFINITIONS

// =====================
// TAG GROUPS (10 groups, ≥20 tags each)
// =====================
const TAG_GROUPS = [
  {
    id: 'filetype',
    label: 'Filetype',
    tags: [
      'text','picture','video','sound'
    ]
  },
  {
    id: 'agency_response',
    label: 'Agency & Response',
    tags: [
      'agency','creativity','dissent & contestation','diverging perceptions','endurance',
      'navigating pandemic regulations','possibilities','responsibility','risk management',
      'sacrifice','self-reflection','stigma','pandemic narratives','pandemic practices','care'
    ]
  },
  {
    id: 'emotions_affective',
    label: 'Emotions & Affective Atmospheres',
    tags: [
      'anger','atmosphere of neglect','atmosphere of risk','atmosphere of suspicion','atmosphere of togetherness',
      'being forgotten','depression','experience of (un)acceptance','experience of urgency',
      'fear & anxiety','feeling of abandonment','feeling of connection','feeling of helplessness',
      'frustration','grief','loneliness','(experience of) isolation','experience of deprivation'
    ]
  },
  {
    id: 'economic_labor',
    label: 'Economic impacts & Labor',
    tags: [
      'mobile labor','impacted labor','essential work','economic impacts','loss of livelihood'
    ]
  },
  {
    id: 'governance_health',
    label: 'Governance, Virus & Health',
    tags: [
      'government','hospitalization','infection','lockdown','masks','quarantine',
      'pandemic regulations','pandemic adaptations','state control','(state) carelessness','viral risk'
    ]
  },
  {
    id: 'social_inequality',
    label: 'Social Fabric & Inequality',
    tags: [
      'care','essential needs','family','lack','loss of vitality','marginality','precarity',
      'scarcity','social cohesion','social exclusion','social impacts','social inequalities',
      'social policing','support (networks)','vulnerability'
    ]
  },
  {
    id: 'spatial_mobility',
    label: 'Spatialities & Mobility',
    tags: [
      'being stuck','border','border crossing','digital space','essential mobility',
      'felt space','immobility','infrastructure','mobility','one-room','periphery',
      'public space','spatial separation','urban space','unsafe environments'
    ]
  },
  {
    id: 'temporalities',
    label: 'Temporalities',
    tags: [
      '(altered) continuities','disruption','early phase','lingering','pre-existing grievances',
      'slow recovery','transformation','unfilled time'
    ]
  }
];

// Fast lookup: tag → groupId
const tagToGroup = new Map();
TAG_GROUPS.forEach(g => g.tags.forEach(t => tagToGroup.set(t, g.id)));

// Colors for ALL tags (stable per label)
const ALL_TAGS = TAG_GROUPS.flatMap(g => g.tags);
function hashHue(str){ let h=0; for(let i=0;i<str.length;i++) h=(h*31+str.charCodeAt(i))|0; return ((h%360)+360)%360; }
const tagColors = Object.fromEntries(ALL_TAGS.map(t => [t, `hsl(${hashHue(t)} 80% 45%)`]));
window.tagColors = tagColors;

// The group whose tags are currently displayed at the top
//let currentTagViewGroupId = TAG_GROUPS[0]?.id || null;

// No group selected by default: all tags clickable, default mode = All
let currentTagViewGroupId = null;

// Utility: did the user select ANY tags?
const hasSelection = () => activeTags.size > 0;

// Ensure a stable color for any label you show on the group button (optional)
function groupLabelById(id) {
  const g = TAG_GROUPS.find(x => x.id === id);
  return g ? g.label : id;
}

const activeTags = new Set();
window.activeTags = activeTags;

function getRandomTags() {
  const pool = ALL_TAGS;
  const tagCount = Math.floor(Math.random() * 3) + 1; // 1..3
  const s = new Set();
  while (s.size < tagCount) s.add(pool[Math.floor(Math.random() * pool.length)]);
  return [...s];
}

// END TAG DEFINITIONS

// START CREATE DUMMY OBJECTS

const videoPool = [
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  "https://samplelib.com/lib/preview/mp4/sample-5s.mp4"
];
/*
const audioPool = [
  "https://samplelib.com/lib/preview/mp3/sample-3s.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
];
*/
const audioPool = [
  "mp3/gorila-315977.mp3",
  "mp3/vlog-music-beat-trailer-showreel-promo-background-intro-theme-274290.mp3"
];

window.audioPool = audioPool;

let objectTypes = ['image', 'text', 'video', 'audio'];

let objects = [];
const groupCount = 5;

// Structured dummy meta per group (title, subtitle, location)
const groupMetaPool = [
  { title: "Covid-19 in Diepsloot",
    subtitle: "Paradoxies of State (Un-)Care in Diepsloot, South Africa",
    location: "Gauteng, South Africa" },
  { title: "Housing Strain in Khayelitsha",
    subtitle: "Paradoxies of State (Un-)Care in Cape Town’s Periphery, South Africa",
    location: "Western Cape, South Africa" },
  { title: "Water Access in Kibera",
    subtitle: "Paradoxies of State (Un-)Care in Nairobi’s Informal Settlements",
    location: "Nairobi County, Kenya" },
  { title: "Public Space in Mathare",
    subtitle: "Paradoxies of State (Un-)Care in Nairobi, Kenya",
    location: "Nairobi County, Kenya" },
  { title: "Street Vending in Fordsburg",
    subtitle: "Paradoxies of State (Un-)Care in Johannesburg’s Inner City",
    location: "Gauteng, South Africa" },
  { title: "Migration at Beitbridge",
    subtitle: "Paradoxies of State (Un-)Care at the Limpopo Border",
    location: "Limpopo, South Africa" },
  { title: "Load Shedding in Soweto",
    subtitle: "Paradoxies of State (Un-)Care in Everyday Electricity Cuts",
    location: "Gauteng, South Africa" },
  { title: "Work and Care in Umlazi",
    subtitle: "Paradoxies of State (Un-)Care in Durban’s Townships",
    location: "KwaZulu-Natal, South Africa" },
  { title: "Transit Lines in Kayole",
    subtitle: "Paradoxies of State (Un-)Care in Eastlands, Nairobi",
    location: "Nairobi County, Kenya" },
  { title: "Clinic Queues in Mitchells Plain",
    subtitle: "Paradoxies of State (Un-)Care in Cape Flats Clinics",
    location: "Western Cape, South Africa" },
];

const groupMetaById = {};
for (let gid = 1; gid <= groupCount; gid++) {
  groupMetaById[gid] = groupMetaPool[(gid - 1) % groupMetaPool.length];
}
// Expose for other modules (e.g., Grid UI if needed)
window.groupMetaById = groupMetaById;


function randomDateString(startYear = 2018, endYear = 2025) {
  const start = new Date(startYear, 0, 1);
  const end   = new Date(endYear, 11, 31);
  const d = new Date(start.getTime() + Math.random() * (end - start));
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm} / ${dd} / ${yyyy}`;
}

// ---- Global THEMES (not tags) ----
const THEMES = [
  {
    id: 'theme-1',
    title: 'Mobility',
    paragraphs: [
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere, elit quis cursus finibus, tortor lorem gravida nibh.',
      'Suspendisse potenti. Donec at ornare ipsum. Curabitur feugiat, arcu sed aliquet fermentum, erat lorem rutrum ex, vitae luctus arcu nisl sit amet justo.',
      'Proin varius, quam non semper malesuada, nibh tortor finibus felis, ac tristique velit lorem vel sapien.'
    ]
  },
  {
    id: 'theme-2',
    title: 'Essential Work',
    paragraphs: [
      'Morbi iaculis, nunc in condimentum lobortis, lorem massa lacinia lorem, vitae consequat sem ante vitae mauris.',
      'Nulla facilisi. In viverra, purus id tempor lacinia, dolor sapien commodo velit, a volutpat dui risus a nibh.',
      'Maecenas sit amet pharetra justo. Pellentesque habitant morbi tristique senectus et netus.'
    ]
  },
  {
    id: 'theme-3',
    title: 'Public Space',
    paragraphs: [
      'Etiam pharetra, sem sit amet bibendum iaculis, neque nisl auctor ipsum, sed feugiat nunc ex sed leo.',
      'Vestibulum eget leo at est fermentum dictum. Curabitur posuere, justo id facilisis consequat, augue nibh mattis ligula.',
      'Aliquam erat volutpat. Vivamus sagittis dui ut ultricies bibendum.'
    ]
  },
  {
    id: 'theme-4',
    title: 'Housing',
    paragraphs: [
      'Sed tristique, nibh at fermentum tincidunt, enim risus dignissim lectus, id gravida risus arcu vitae eros.',
      'Mauris varius, arcu at viverra consequat, ante leo efficitur est, sed condimentum sem massa vel urna.',
      'Donec feugiat, libero a consequat rutrum, augue quam tincidunt lacus, vitae sollicitudin turpis lorem nec nibh.'
    ]
  },
  {
    id: 'theme-5',
    title: 'Health & Care',
    paragraphs: [
      'Fusce faucibus, ante at blandit luctus, neque lorem convallis quam, a tempus lacus arcu sit amet nisl.',
      'Integer viverra pulvinar lorem, in fermentum sapien placerat non.',
      'Quisque et dapibus arcu. Cras efficitur porta risus, vitae pharetra ipsum cursus at.'
    ]
  },
  {
    id: 'theme-6',
    title: 'Education',
    paragraphs: [
      'Nunc tristique aliquam nunc, eu rutrum ipsum posuere quis.',
      'Integer sit amet sagittis leo. Duis nec luctus arcu, vitae malesuada arcu.',
      'Praesent venenatis, velit in ultrices laoreet, lacus lorem fringilla arcu, at sagittis magna felis nec ipsum.'
    ]
  },
  {
    id: 'theme-7',
    title: 'Memory',
    paragraphs: [
      'Curabitur nec varius nunc. Pellentesque ac sem non lorem bibendum posuere.',
      'Suspendisse hendrerit, arcu at varius tempor, sem diam ultrices metus, non dictum mi nisi non arcu.',
      'Phasellus aliquet gravida diam, ut mattis justo euismod at.'
    ]
  }
];

for(let i=0; i<100; i++) {

  let objectType = objectTypes[Math.floor(Math.random() * objectTypes.length)];
  let randomObjectWidth = Math.floor(Math.random() * (110 - 60 + 1)) + 60;
  let randomObjectHeight = Math.floor(Math.random() * (150 - 60 + 1)) + 60;
  const randomGroupId = Math.floor(Math.random() * groupCount + 1);

  //let angle = Math.random() * 2 * Math.PI;
  //let distance = Math.random() * 100;

  let newObject = {};

  if(objectType == 'image') {

    newObject = {
      id: `object_${i+1}`,
      type: 'image',
      groupId: randomGroupId,
      //groupName: groupNameById[randomGroupId],
      groupLocation: groupMetaById[randomGroupId].location,
      date: randomDateString(),
      grid_x: 0,
      grid_y: 0,
      width: randomObjectWidth,
      height: randomObjectHeight,
      image: `https://picsum.photos/${randomObjectWidth}/${randomObjectHeight}`,
      text: '',
    }

  } else if (objectType == 'text') {

    newObject = {
      id: `object_${i+1}`,
      type: 'text',
      groupId: randomGroupId,
      //groupName: groupNameById[randomGroupId],
      groupLocation: groupMetaById[randomGroupId].location,
      date: randomDateString(),
      grid_x: 0,
      grid_y: 0,
      width: randomObjectWidth,
      height: randomObjectHeight,
      image: '',
      text: 'hello world! This is some text. I am too long by the way',
    }
  } else if (objectType === 'video') {
    const w = Math.floor(Math.random() * (180 - 120 + 1)) + 120;
    const h = Math.floor(Math.random() * (160 - 90 + 1)) + 90;
    newObject = {
      id: `object_${i+1}`,
      type: 'video',
      groupId: randomGroupId,
      //groupName: groupNameById[randomGroupId],
      groupLocation: groupMetaById[randomGroupId].location,
      date: randomDateString(),
      grid_x: 0, grid_y: 0,
      width: w, height: h,
      video: videoPool[Math.floor(Math.random() * videoPool.length)],
      image: "", text: ""
    };
  
  } else if (objectType === 'audio') {
    const w = Math.floor(Math.random() * (220 - 160 + 1)) + 160;
    const h = Math.floor(Math.random() * (80 - 48 + 1)) + 48;
    newObject = {
      id: `object_${i+1}`,
      type: 'audio',
      groupId: randomGroupId,
      //groupName: groupNameById[randomGroupId],
      groupLocation: groupMetaById[randomGroupId].location,
      date: randomDateString(),
      grid_x: 0, grid_y: 0,
      width: w, height: h,
      audio: audioPool[Math.floor(Math.random() * audioPool.length)],
      image: "", text: ""
    };
  }

  newObject.tags = getRandomTags();

  objects.push(newObject);
  //console.log(newObject);
}

// END CREATE DUMMY OBJECTS


// START GROUP CALCULATION AND ADD TO OBJECTS

// END GROUP CALCULATION

// === Group labels (prefer whatever you already stored on objects) ===
const GROUP_IDS = [...new Set(objects.map(o => o.groupId))];
const GROUP_LABELS = {};
for (const gid of GROUP_IDS) {
  // Try to find a name from any object in that group; fallback to dummy
  //const any = objects.find(o => o.groupId === gid);
  //GROUP_LABELS[gid] = any?.groupName || `City ${gid}, Country`;
  const any = objects.find(o => o.groupId === gid);
  GROUP_LABELS[gid] = groupMetaById[gid]?.location || `Province ${gid}, Country`;
}

// === Dummy theme content per group (≥5 themes each) ===
const BASE_THEME_TITLES = [
  'Mobility', 'Essential Work', 'Public Space', 'Housing', 'Health & Care',
  'Education', 'Memory'
];
function lorem(n=3) {
  const p = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere, elit quis cursus finibus, tortor lorem gravida nibh, vitae luctus arcu nisl sit amet justo. Donec at ornare ipsum. Suspendisse potenti.";
  return Array.from({length:n}, ()=>p);
}
export const THEMES_BY_GROUP = {};
for (const gid of GROUP_IDS) {
  THEMES_BY_GROUP[gid] = BASE_THEME_TITLES.slice(0,5).map((title, idx) => ({
    id: `g${gid}-theme-${idx+1}`,
    title,
    paragraphs: lorem(3)
  }));
}


// ==============================
// STRAPI LOADER (all groups + objects)
// ==============================

async function strapiFetch(path, params = {}) {
  // Ensure we always hit /api/<path> and never lose the prefix
  let base = String(STRAPI.base || '').replace(/\/+$/, '');
  if (!/\/api$/i.test(base)) base += '/api';
  const cleanPath = String(path || '').replace(/^\/+/, ''); // remove leading '/'

  const url = new URL(`${base}/${cleanPath}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const headers = { 'Content-Type': 'application/json' };
  if (STRAPI.token) headers['Authorization'] = STRAPI.token;

  slog('GET', url.toString());
  const res = await fetch(url.toString(), { headers });
  slog('RES', res.status, url.pathname + url.search);

  if (!res.ok) {
    const t = await res.text().catch(()=>'');
    throw new Error(`Strapi fetch failed ${res.status}: ${url}\n${t}`);
  }
  const json = await res.json();
  // after res.json()
  const len = Array.isArray(json) ? json.length
    : Array.isArray(json?.data) ? json.data.length
    : (json?.data ? 1 : 0);
  slog('DATA', `items=${len}`, json?.meta ? json.meta : '');
  return json;
}

// Fetch ALL pages for a collection endpoint (logs each page)
// Fetch ALL pages for a collection endpoint (robust against maxLimit/pageCount issues)
// Fetch ALL pages robustly, using the server-reported effective page size
// Fetch ALL pages robustly: keep paging until the API returns an empty page.
// Also break if a page doesn't add anything new (safety against servers that ignore page).
async function strapiFetchAll(path, baseParams = {}) {
  let page = 1;
  const acc = [];
  const seenIds = new Set();   // dedupe and detect no-progress pages

  while (true) {
    slog('PAGE', path, { page, pageSize: STRAPI.pageSize });
    const data = await strapiFetch(path, {
      ...baseParams,
      'pagination[page]': page,
      'pagination[pageSize]': STRAPI.pageSize,
      'pagination[withCount]': true
    });

    const arr = (data && data.data) || [];
    slog('PAGE:items', arr.length);

    // Append only new items (by Strapi entity id)
    let added = 0;
    for (const it of arr) {
      if (!it || seenIds.has(it.id)) continue;
      seenIds.add(it.id);
      acc.push(it);
      added++;
    }

    // Stop conditions (any one is enough):
    // 1) Empty page => no more data
    // 2) Page added nothing new => backend ignored page param or we reached the end
    // 3) Safety upper bound on pages
    if (arr.length === 0 || added === 0 || page > 2000) break;

    page++;
  }

  slog('TOTAL', path, acc.length);
  return acc;
}

// ==============================
// STRAPI LOADER (all groups + objects) — with media URL resolution
// ==============================
async function loadStrapiAllGroupsAndObjects() {
  // 1) Groups
  const groups = await strapiFetchAll('groups', { populate: '*' });
  slog('groups.count', groups.length);
  slog('groups.sample', groups.slice(0, 5).map(g => ({
    id: g.id,
    title: (getAttrs(g).Title || getAttrs(g).title || '')
  })));

  if (!groups.length) {
    slog('groups.empty', 'No groups found in Strapi.');
    return { objects: [], groupMeta: {} };
  }

  const groupIds = groups.map(g => g.id);

  // 2) Objects for those groups — robust fetch (avoids $in bug on relation ids)
  let objects = [];
  try {
    // Try 1: OR of equality checks (very stable in v5)
    const qp = { publicationState: 'preview', populate: '*' };
    groupIds.forEach((id, i) => { qp[`filters[$or][${i}][group][id][$eq]`] = String(id); });
    objects = await strapiFetchAll('live', qp);
  } catch (err1) {
    console.warn('[strapi:objects] $or[$eq] failed, falling back per-group', err1);
    // Try 2: Query per group id, then de-duplicate
    const seen = new Set();
    for (const gid of groupIds) {
      try {
        const part = await strapiFetchAll('objects', {
          'filters[group][id][$eq]': String(gid),
          'publicationState': 'live',
          'populate': '*'
        });
        part.forEach(o => { if (!seen.has(o.id)) { seen.add(o.id); objects.push(o); } });
      } catch (err2) {
        console.error('[strapi:objects] per-group fetch failed for', gid, err2);
      }
    }
  }
  slog('objects.count', objects.length);


  // 3) Normalize to app schema
  const normalized = normalizeStrapiToAppSchema(groups, objects);
  slog('normalize.objects', { in: objects.length, out: normalized.objects.length });

  // 4) Resolve media URLs from ImagePath/VideoPath/AudioPath (batched, cached)
  await resolveUploadUrlsForObjects(normalized.objects);
  slog('resolved.media',
    normalized.objects.reduce((acc, o) => {
      if (o.image) acc.image++;
      if (o.video) acc.video++;
      if (o.audio) acc.audio++;
      return acc;
    }, { image: 0, video: 0, audio: 0 })
  );

  return normalized;
}

// Resolve best URL for each object from its stored hint (filename + folder-ish path)
async function resolveUploadUrlsForObjects(objs) {
  // 1) collect unique filenames we need
  const needed = [];
  const hints = new Map(); // obj -> { name, dir , fields present }
  for (const o of objs) {
    const ph = o._pathHints;
    if (!ph) continue;
    const want = {};
    if (ph.image && !o.image) { want.image = splitPathHint(ph.image); needed.push(want.image.name); }
    if (ph.video && !o.video) { want.video = splitPathHint(ph.video); needed.push(want.video.name); }
    if (ph.audio && !o.audio) { want.audio = splitPathHint(ph.audio); needed.push(want.audio.name); }
    hints.set(o, want);
  }

  // 2) batch fetch all filenames once
  await batchFetchUploadFilesByNames([...new Set(needed)]);

  // 3) choose best match per object+field (prefer folderPath that contains the hint dir)
  const pickBest = (name, dir) => {
    const candidates = __uploadCache.get(name) || [];
    if (!candidates.length) return undefined;
    if (!dir) return candidates[0].url;
    // score by longest folderPath substring match
    let best = candidates[0], bestScore = 0;
    for (const c of candidates) {
      const fp = c.folderPath || '';
      const score = fp.includes(dir) ? dir.length : (fp.split('/').pop() === dir.split('/').pop() ? 1 : 0);
      if (score > bestScore) { best = c; bestScore = score; }
    }
    return best.url;
  };

  // 4) write resolved URLs back into objects
  for (const o of objs) {
    const want = hints.get(o);
    if (!want) continue;
    if (!o.image && want.image) o.image = pickBest(want.image.name, want.image.dir);
    if (!o.video && want.video) o.video = pickBest(want.video.name, want.video.dir);
    if (!o.audio && want.audio) o.audio = pickBest(want.audio.name, want.audio.dir);
  }
}

// Turn Strapi paths ("/uploads/…") into absolute URLs; pass through http(s) as-is
function strapiAssetUrl(p) {
  if (!p) return undefined;
  if (/^https?:\/\//i.test(p)) return p;
  let root = String(STRAPI.base || '').replace(/\/+$/,'');
  root = root.replace(/\/api$/i, ''); // strip trailing /api
  if (p[0] !== '/') p = '/' + p;
  return root + p;
}

// Convert Strapi entities into your current in-memory schema
function normalizeStrapiToAppSchema(groups, objectsArr) {
  // Build group meta and a map StrapiGroupId -> appGroupId "s<id>"
  const groupMeta = {};
  const groupIdMap = new Map();
  groups.forEach(g => {
    const a = getAttrs(g);
    const appGroupId = `s${g.id}`;
    groupIdMap.set(g.id, appGroupId);
    groupMeta[appGroupId] = {
      title: a.Title || a.title || `Group ${g.id}`,
      subtitle: a.Subtitle || a.subtitle || '',
      location: a.Location || a.location || ''
    };
  });
  slog('normalize.groups', Object.keys(groupMeta).length);

  
  // helpers
  const pick = (obj, ...keys) => {
    if (!obj) return undefined;
    for (const k of keys) if (obj[k] != null && obj[k] !== '') return obj[k];
    const lower = Object.create(null);
    Object.keys(obj).forEach(k => { lower[k.toLowerCase()] = k; });
    for (const k of keys) { const real = lower[k.toLowerCase()]; if (real && obj[real] != null && obj[real] !== '') return obj[real]; }
    return undefined;
  };
  const relNames = (rel) => {
    if (!rel) return [];
    // v4: { data: [{ attributes: { Name } }]}
    if (Array.isArray(rel?.data)) {
      return rel.data.map(it => (getAttrs(it)?.Name || getAttrs(it)?.name || '')).filter(Boolean);
    }
    // v5: [{ id, Name }] or [{ id, name }]
    if (Array.isArray(rel)) {
      return rel.map(it => (it?.Name || it?.name || '')).filter(Boolean);
    }
    return [];
  };
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  // If only one group was loaded, we can safely default missing group to it
  const singleGroupId = groupIdMap.size === 1 ? [...groupIdMap.keys()][0] : null;

  const out = [];
  let skippedNoGroup = 0;
  const skippedSamples = [];

  for (const entry of objectsArr) {
    const a = getAttrs(entry);

    // ---- robust group id extraction (v4/v5)
    let sGroup;
    const gRel = a.group ?? a.Group;
    if (gRel) {
      if (typeof gRel === 'number') sGroup = gRel;                       // numeric id
      else if (gRel.id) sGroup = gRel.id;                                 // v5 populated object
      else if (gRel.data) sGroup = Array.isArray(gRel.data) ? gRel.data[0]?.id : gRel.data?.id; // v4 populated
    }
    if ((!sGroup || !groupIdMap.has(sGroup)) && singleGroupId != null) {
      sGroup = singleGroupId;
      slog('normalize.fallback.group', { obj: entry.id, assigned: sGroup });
    }
    if (!sGroup || !groupIdMap.has(sGroup)) {
      skippedNoGroup++;
      if (skippedSamples.length < 5) skippedSamples.push({ id: entry.id, groupRel: gRel });
      continue;
    }
    const appGroupId = groupIdMap.get(sGroup);

    // ---- media fields (v4/v5 + your custom path fields)
    const imgStr = a.ImagePath || a.imagePath || a.image_path || null;
    const vidStr = a.VideoPath || a.videoPath || a.video_path || null;
    const audStr = a.AudioPath || a.audioPath || a.audio_path || null;

    // Upload plugin shapes (v5: field.url; v4: field.data.attributes.url)
    const im = a.image, vi = a.video, au = a.audio;
    const imUrl = im?.url || (im?.data ? (Array.isArray(im.data) ? im.data[0]?.attributes?.url : im.data?.attributes?.url) : undefined);
    const viUrl = vi?.url || (vi?.data ? (Array.isArray(vi.data) ? vi.data[0]?.attributes?.url : vi.data?.attributes?.url) : undefined);
    const auUrl = au?.url || (au?.data ? (Array.isArray(au.data) ? au.data[0]?.attributes?.url : au.data?.attributes?.url) : undefined);

    // === exact type rules (priority) =========================================
    // 1) ImagePath (or upload image url) → image
    // 2) else VideoPath (or upload video url) → video
    // 3) else AudioPath (or upload audio url) → audio
    // 4) else → text showing Name
    let type = 'text';
    let image, video, audio, text;

    if (imgStr || imUrl) {
      type  = 'image';
      image = imUrl ? strapiAssetUrl(imUrl) : undefined;   // keep undefined if only a path; will be resolved later
    } else if (vidStr || viUrl) {
      type  = 'video';
      video = viUrl ? strapiAssetUrl(viUrl) : undefined;
    } else if (audStr || auUrl) {
      type  = 'audio';
      audio = auUrl ? strapiAssetUrl(auUrl) : undefined;
    } else {
      type  = 'text';
      text  = a.Name || a.name || `Object ${entry.id}`;
    }

    // Keep original path strings so the batched resolver can translate them to upload URLs
    const pathHints = {
      image: imgStr || null,
      video: vidStr || null,
      audio: audStr || null
    };

    // ---- tags (unchanged)
    const tags = Array.from(new Set([
      ...relNames(a.connecting_tags || a['connecting-tags']),
      ...relNames(a.tags)
    ]));

    // ---- dimensions (same as before)
    let width, height;
    if (type === 'image') { width = rand(120, 200); height = rand(120, 160); }
    if (type === 'video') { width = rand(120, 180); height = rand(90, 160); }
    if (type === 'audio') { width = rand(140, 200); height = 60; }
    if (type === 'text')  { width = rand(120, 180); height = rand(120, 160); }

    // ---- push normalized object
    out.push({
      id: `sobj_${entry.id}`,
      type,
      groupId: appGroupId,
      groupLocation: groupMeta[appGroupId]?.location || '',
      date: a.createdAt || a.updatedAt || '',
      grid_x: 0, grid_y: 0,
      width, height,
      image, video, audio,
      text,
      tags,
      _pathHints: pathHints
    });
  }

  if (skippedNoGroup) slog('normalize.skipped.no-group', { count: skippedNoGroup, samples: skippedSamples });
  slog('normalize.objects', { in: objectsArr.length, out: out.length });
  slog('normalize.sample', out.slice(0, 5).map(x => ({
    id: x.id, type: x.type, groupId: x.groupId,
    media: x.image || x.video || x.audio || null,
    text: x.text ? (String(x.text).slice(0, 60) + (String(x.text).length > 60 ? '…' : '')) : null
  })));

  return { objects: out, groupMeta };
}

// Extract "filename.ext" and "dir part" from a hint like "Folder/Sub/images/file.jpg"
function splitPathHint(pathStr) {
  if (!pathStr) return { name: '', dir: '' };
  try { pathStr = decodeURIComponent(pathStr); } catch {}
  const parts = String(pathStr).split('/');
  const name = parts.pop() || '';
  const dir  = parts.join('/').toLowerCase(); // for fuzzy matching duplicates
  return { name, dir };
}

const __uploadCache = new Map();

// Fetch many upload files by name using $in (with a safe fallback syntax)
async function batchFetchUploadFilesByNames(names) {
  if (!names.length) return;
  const want = names.filter(n => !__uploadCache.has(n));
  if (!want.length) return;

  const CHUNK = 40;
  for (let i = 0; i < want.length; i += CHUNK) {
    const chunk = want.slice(i, i + CHUNK);

    // First try: array syntax that ALWAYS works in v5
    const qpEqOr = { 'pagination[page]': 1, 'pagination[pageSize]': 1000 };
    // filters[$or][0][name][$eq]=fileA, filters[$or][1][name][$eq]=fileB, ...
    chunk.forEach((n, idx) => { qpEqOr[`filters[$or][${idx}][name][$eq]`] = n; });
    let json = await strapiFetch('upload/files', qpEqOr);

    // Fallback 1: $in with indexed array
    const noResults = (Array.isArray(json) && json.length === 0) ||
                      (Array.isArray(json?.data) && json.data.length === 0);
    if (noResults) {
      const qpIn = { 'pagination[page]': 1, 'pagination[pageSize]': 1000 };
      chunk.forEach((n, idx) => { qpIn[`filters[name][$in][${idx}]`] = n; });
      json = await strapiFetch('upload/files', qpIn);
    }

    // Fallback 2: a loose search on URL (covers providers that rename files)
    const stillNone = (Array.isArray(json) && json.length === 0) ||
                      (Array.isArray(json?.data) && json.data.length === 0);
    if (stillNone) {
      const qpUrl = { 'pagination[page]': 1, 'pagination[pageSize]': 1000 };
      chunk.forEach((n, idx) => { qpUrl[`filters[$or][${idx}][url][$containsi]`] = n; });
      json = await strapiFetch('upload/files', qpUrl);
    }

    // Normalize both response shapes
    const items = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
    items.forEach(it => {
      const a = getAttrs(it);
      const key = a?.name;
      const url = a?.url ? strapiAssetUrl(a.url) : undefined;
      const folderPath = (a?.folderPath || a?.folder?.path || a?.folder?.name || '').toLowerCase();
      if (!key || !url) return;
      const arr = __uploadCache.get(key) || [];
      arr.push({ url, folderPath });
      __uploadCache.set(key, arr);
    });
  }
}

// Unified loader that returns {objects, groupMeta} based on DATA_MODE
async function loadData(DATA_MODE) {
  if (DATA_MODE === 'dummy') {
    return { objects, groupMeta: groupMetaById };
  }
  const s = await loadStrapiAllGroupsAndObjects();
  if (DATA_MODE === 'strapi') {
    return { objects: s.objects, groupMeta: s.groupMeta };
  }
  // mixed: dummy + strapi (merge metas; keep both sets of objects)
  const mergedMeta = { ...groupMetaById, ...s.groupMeta };
  return { objects: [...objects, ...s.objects], groupMeta: mergedMeta };
}

// START GRID OBJECT

//const gridObject = new Grid('grid', objects, {});
//window.gridObject = gridObject; // expose globally so the gallery click handler can read currentState & groups

// START GRID OBJECT (data-aware)
let gridObject;
window.gridObject = null;

(async () => {
  try {
    const loaded = await loadData(DATA_MODE);
    // Use the chosen data source
    objects = loaded.objects;
    Object.assign(groupMetaById, loaded.groupMeta);
    console.log('[data] mode=', DATA_MODE, 'groups=', Object.keys(loaded.groupMeta).length, 'objects=', loaded.objects.length);
    gridObject = new Grid('grid', objects, {});
    window.gridObject = gridObject;
    // wire header + set initial copy
    window.__wireHeaderToGrid?.();
    window.__dispatchViewChange?.();
  } catch (err) {
    console.error('Failed to load data / init grid:', err);
    alert('Strapi load failed. Check the console for details (network/permissions).');
  }
})();

// Pretty logging for Strapi objects
function dumpStrapiObjects(objects) {
  const unionKeys = new Set();
  let imgPath = 0, vidPath = 0, audPath = 0;
  let imgUpload = 0, vidUpload = 0, audUpload = 0;

  const firstN = objects.slice(0, 5);
  console.group('[strapi:objects.dump]');
  console.log('total', objects.length);

  objects.forEach(o => {
    const a = getAttrs(o);
    Object.keys(a || {}).forEach(k => unionKeys.add(k));
    if (a?.ImagePath || a?.imagePath || a?.image_path) imgPath++;
    if (a?.VideoPath || a?.videoPath || a?.video_path) vidPath++;
    if (a?.AudioPath || a?.audioPath || a?.audio_path) audPath++;
    // Upload media common shapes (v4: image.data.attributes.url; v5: image.url)
    const im = a?.image; const vi = a?.video; const au = a?.audio;
    const imUrl = (im?.data ? (Array.isArray(im.data) ? im.data[0]?.attributes?.url : im.data?.attributes?.url) : im?.url);
    const viUrl = (vi?.data ? (Array.isArray(vi.data) ? vi.data[0]?.attributes?.url : vi.data?.attributes?.url) : vi?.url);
    const auUrl = (au?.data ? (Array.isArray(au.data) ? au.data[0]?.attributes?.url : au.data?.attributes?.url) : au?.url);
    if (imUrl) imgUpload++;
    if (viUrl) vidUpload++;
    if (auUrl) audUpload++;
  });

  console.log('attribute keys (union):', Array.from(unionKeys).sort());
  console.log('counts: ImagePath=%d, VideoPath=%d, AudioPath=%d', imgPath, vidPath, audPath);
  console.log('upload-shape counts: image.url=%d, video.url=%d, audio.url=%d', imgUpload, vidUpload, audUpload);

  firstN.forEach((o, i) => {
    const a = getAttrs(o);
    console.group(`#${i} id=${o.id}`);
    console.log('attributes:', a);
    console.log('group relation:', a?.group || a?.Group);
    console.log('raw object:', o);
    console.groupEnd();
  });

  console.groupEnd();
}

// small helper to extract a URL if fields use Strapi Upload media (object/array with .data[].attributes.url)
function tryUploadUrl(mediaField) {
  if (!mediaField) return undefined;
  const d = mediaField.data;
  if (!d) return undefined;
  if (Array.isArray(d)) return d[0]?.attributes?.url;
  return d.attributes?.url;
}

// Strapi v5 returns fields on the top level; v4 used entry.attributes
function getAttrs(entry) {
  if (!entry) return {};
  return entry.attributes ? entry.attributes : entry;
}

// END GRID OBJECT

function refreshSlideInsVisibility() {
  const slideIns = document.getElementById('slide-ins');
  if (!slideIns) return;

  const galleryActive = document.getElementById('group-gallery')?.classList.contains('active');
  const state        = window.gridObject?.currentState;
  const detailActive = document.getElementById('detail-content')?.classList.contains('active');

  // Detect ad-hoc gallery via history.state or a body class (see Step 2)
  const isAdhoc = !!history.state?.adhoc || document.body.classList.contains('in-adhoc-gallery');

  // Normally we only show the sidebar in these grid states…
  const baseAllowedStates = (state === 'ungrouped' || state === 'clustered' || state === 'pre-cluster');

  // …but in ad-hoc gallery we want it visible regardless of state, and even though a gallery is active.
  const shouldShow = ((baseAllowedStates || isAdhoc) && (!galleryActive || isAdhoc) && !detailActive);

  slideIns.classList.toggle('visible', !!shouldShow);

  if (!shouldShow) {
    slideIns.querySelectorAll('.slide-in').forEach(el => {
      el.classList.remove('expanded', 'secondary-open');
      el.querySelector('.vertical-content')?.classList.remove('visible');
      const b = el.querySelector('.close-btn');
      if (b) b.textContent = '←';
    });
  }

  if (typeof updateRightCounterOffset === 'function') updateRightCounterOffset();
}

// Collapse all Discover Connections panels (keep the container visible)
function collapseDiscoverSidebar() {
  const wrap = document.getElementById('slide-ins');
  if (!wrap) return;

  wrap.querySelectorAll('.slide-in').forEach(el => {
    el.classList.remove('expanded', 'secondary-open');
    el.querySelector('.vertical-content')?.classList.remove('visible');
    const btn = el.querySelector('.close-btn');
    if (btn) btn.textContent = '←';
  });

  // keep layout math in sync with the new (collapsed) width
  if (typeof updateRightCounterOffset === 'function') {
    updateRightCounterOffset();
  }
}

// (optional) expose for debugging / future reuse
window.collapseDiscoverSidebar = collapseDiscoverSidebar;

// === GROUPED MODE: click any object -> open gallery; other modes unaffected ===
// DEBUG: log clicks on the grid; when grouped, log the object clicked
{
  const gridEl = document.getElementById('grid');
  const gridShellEl = document.getElementById('grid-shell');
  const groupGalleryEl = document.getElementById('group-gallery');
  const backBtnEl = document.getElementById('content-back-button');

  // DRAG-TO-CLICK GUARD (grouped mode)
  // Tracks pointer movement; if movement > 6px when releasing, we mark the last interaction as a drag.
  // The click handler will ignore the very next click in grouped mode.
  let __down = null;
  let __lastDragAt = 0;
  const __SLOP2 = 6 * 6; // squared px threshold

  gridEl.addEventListener('pointerdown', (e) => {
    __down = { x: e.clientX, y: e.clientY, moved: false };
  }, true);

  gridEl.addEventListener('pointermove', (e) => {
    if (!__down) return;
    const dx = e.clientX - __down.x;
    const dy = e.clientY - __down.y;
    if ((dx * dx + dy * dy) > __SLOP2) __down.moved = true;
  }, true);

  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => {
    gridEl.addEventListener(type, () => {
      if (__down?.moved) __lastDragAt = performance.now();
      __down = null;
    }, true);
  });

  function openGallery(gid) {
    if (!groupGalleryEl) {
      console.warn('[gallery] #group-gallery not found');
      return;
    }
  
    // Hide the grid shell, then show gallery
    if (gridShellEl) gridShellEl.style.display = 'none';
    groupGalleryEl.classList.add('active');
  
    // 1) Title + subtitle for this group
    if (gid && window.groupMetaById) {
      const meta = window.groupMetaById[gid];
      if (meta) {
        const tEl = document.querySelector('#group-gallery .title-box h2');
        const sEl = document.querySelector('#group-gallery .title-box h3');
        if (tEl) tEl.textContent = meta.title;
        if (sEl) sEl.textContent = meta.subtitle;
      }
    }
  
    // 2) Build the gallery items (columns + mixed .item nodes for this group)
    if (typeof window.renderGroupGallery === 'function') {
      window.renderGroupGallery(gid);  // creates columns and appends items
    }
  
    // 3) Bind fade-ins, counters, WaveSurfer (IO attaches to what's in the DOM now)
    window.__galleryIO__?.onOpen?.();
    window.__galleryVideos__?.onOpen?.();
    window.__galleryImages__?.onOpen?.();
  
    // 4) Push a history state so browser Back closes the gallery
    try {
      if (!history.state || !history.state.gallery) {
        history.pushState({ gallery: true, gid: String(gid ?? '') }, '', '#group-gallery');
      }
    } catch {}
  
    refreshSlideInsVisibility();

    document.body.classList.add('in-group-gallery');      // was: in-gallery
    document.body.dataset.currentGroupId = String(gid);
    window.__dispatchViewChange();

    // optional cleanup so you don’t keep layout padding:
    const bar = document.getElementById('selection-bar');      // NEW
    const ws  = document.getElementById('workspace');          // NEW
    bar?.classList.remove('show');                             // NEW
    ws?.classList.remove('has-selection-bar');                 // NEW

    console.log('[gallery] opened', { gid });
  }

  // Open gallery for a custom set of objects (e.g., current tag filter)
  window.openTagsGallery = function(objs = [], titleLines = []) {
    if (!groupGalleryEl) return;

    // Hide the grid shell, show gallery
    if (gridShellEl) gridShellEl.style.display = 'none';
    groupGalleryEl.classList.add('active');

    // Title: each tag on its own line; no group subtitle
    const tEl = document.querySelector('#group-gallery .title-box h2');
    const sEl = document.querySelector('#group-gallery .title-box h3');
    if (tEl) tEl.innerHTML = titleLines.map(s => String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    ).join('<br>');
    if (sEl) sEl.textContent = '';

    // Fresh content
    const box = groupGalleryEl.querySelector('.gallery-box');
    if (box) box.innerHTML = '';

    // Build items/columns from the provided list
    if (typeof window.renderAdhocGallery === 'function') {
      window.renderAdhocGallery(objs);
    }

    // Attach observers and push a gallery history state
    window.__galleryIO__?.onOpen?.();
    window.__galleryVideos__?.onOpen?.();
    window.__galleryImages__?.onOpen?.();
    try {
      if (!history.state || !history.state.gallery) {
        history.pushState({ gallery: true, adhoc: true }, '', '#group-gallery');
      }
    } catch {}

    refreshSlideInsVisibility();
    collapseDiscoverSidebar?.();

    document.body.classList.add('in-gallery', 'in-adhoc-gallery');   // mark ad-hoc mode
    window.__dispatchViewChange();
    if (typeof window.renderSelectionBar === 'function') {
      window.renderSelectionBar();                     // keep the bar visible, but no button
    }
  
    const bar = document.getElementById('selection-bar');      // NEW
    const ws  = document.getElementById('workspace');          // NEW

    console.log('[gallery] opened (adhoc)', { count: objs.length, titleLines });
  };

  // Refresh the current ad-hoc gallery from the *current* tag selection
  window.refreshAdhocGalleryFromTags = function(tagsMaybe) {
    const gg = document.getElementById('group-gallery');
    const isActive = gg?.classList.contains('active');
    // Treat as ad-hoc if we either set a body class or pushed adhoc state
    const isAdhoc = !!(history.state && history.state.adhoc) || document.body.classList.contains('in-adhoc-gallery');
    if (!isActive || !isAdhoc) return;

    // Normalize tags to an array
    const raw = (typeof tagsMaybe !== 'undefined') ? tagsMaybe : (window.activeTags || []);
    const tags = Array.isArray(raw) ? raw : (raw instanceof Set ? [...raw] : []);

    // 1) Update the title (each tag on its own line; no subtitle)
    const tEl = document.querySelector('#group-gallery .title-box h2');
    const sEl = document.querySelector('#group-gallery .title-box h3');
    if (tEl) tEl.innerHTML = tags.map(s => String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    ).join('<br>');
    if (sEl) sEl.textContent = '';

    // 2) Recompute which objects match the current filter and re-render
    const objs = objectsMatchingCurrentFilter();          // you already have this helper
    const box = gg.querySelector('.gallery-box');
    if (box) box.innerHTML = '';
    if (typeof window.renderAdhocGallery === 'function') {
      window.renderAdhocGallery(objs);                    // reuse your gallery item builder
    }

    // 3) Re-attach observers (same as openTagsGallery did)
    window.__galleryIO__?.onOpen?.();
    window.__galleryVideos__?.onOpen?.();
    window.__galleryImages__?.onOpen?.();
  };
  
  function closeGallery(options = {}) {
    const viaPopstate = !!options.viaPopstate;
  
    try {
      groupGalleryEl?.scrollTo({ left: 0, top: 0, behavior: 'auto' });
      groupGalleryEl?.querySelector('.gallery-box')?.scrollTo?.({ left: 0, top: 0, behavior: 'auto' });
    } catch {}
  
    window.__galleryIO__?.onClose?.();
    window.__galleryVideos__?.onClose?.();
    window.__galleryImages__?.onClose?.();
  
    const box = groupGalleryEl?.querySelector('.gallery-box');
    if (box) box.innerHTML = '';
  
    groupGalleryEl.classList.remove('active');
    if (gridShellEl) gridShellEl.style.display = '';
  
    // 👇 critical bits
    document.body.classList.remove('in-group-gallery');
    delete document.body.dataset.currentGroupId;
    window.__dispatchViewChange();

    document.body.classList.remove('in-adhoc-gallery');
    window.__dispatchViewChange();
    if (typeof window.renderSelectionBar === 'function') {
      window.renderSelectionBar();
    }
  
    refreshSlideInsVisibility();

    document.body.classList.remove('in-group-gallery', 'in-adhoc-gallery');
    window.__dispatchViewChange();
    if (typeof window.renderSelectionBar === 'function') {
      window.renderSelectionBar();           // if tags are still selected, bar (and button) come back
    }

    console.log('[gallery] closed');
  }
  

  // === Object Detail screen (full page) ===
  (function detailScreen() {
    const gridShellEl    = document.getElementById('grid-shell');
    const groupGalleryEl = document.getElementById('group-gallery');
    const detailEl       = document.getElementById('detail-content');

    // --- detail-page prev/next UI (inside vertical-content) ---
    function attachDetailNavUI() {
      const vc = detailEl?.querySelector('.vertical-content');
      if (!vc || vc.querySelector('.detail-nav-arrows')) return; // already added

      const wrap = document.createElement('div');
      wrap.className = 'detail-nav-arrows';
      wrap.innerHTML = `
        <button class="detail-nav-arrow prev" type="button" aria-label="Previous object"></button>
        <button class="detail-nav-arrow next" type="button" aria-label="Next object"></button>
      `;
      // put arrows at the top *inside* vertical-content
      vc.prepend(wrap);

      // wire the buttons
      wrap.querySelector('.detail-nav-arrow.prev')
          ?.addEventListener('click', () => { if (typeof window.stepDetail === 'function') window.stepDetail(-1); });
      wrap.querySelector('.detail-nav-arrow.next')
          ?.addEventListener('click', () => { if (typeof window.stepDetail === 'function') window.stepDetail(+1); });
    }

    // Ensure the arrows exist as soon as the detail module initializes
    attachDetailNavUI();


    let __detailWave = null;
    function destroyDetailWave() {
      try { __detailWave?.destroy(); } catch {}
      __detailWave = null;
    }

    // Keep the look identical to the gallery waves
    const DETAIL_WS_CONFIG = {
      waveColor: '#666',
      progressColor: '#aaa',
      cursorColor: '#ccc',
      height: 50,     // if you want a taller hero, e.g. 90, also change CSS below
      barWidth: 2,
      barGap: 1,
      barHeight: 40,
      normalize: true,
      responsive: true,
      interact: true,
      cursorWidth: 1,
    };

    // Render ONLY the primary slot (title or hero media) in the detail view
    function renderDetailPrimary(obj) {
      if (!detailEl || !obj) return;

      // Update location in the header (safe to do each time)
      const locEl = detailEl.querySelector('.content-header .location');
      if (locEl) locEl.textContent = obj.groupLocation || '';

      // Work only inside the primary slot
      const slot = detailEl.querySelector('#detail-primary');
      if (!slot) return;

      // basic escape
      const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

      // Replace the slot content according to object type
      switch (obj.type) {
        case 'image':
          slot.innerHTML = obj.image
            ? `<figure><img class="hero-media" src="${esc(obj.image)}" alt="${esc(obj.text || 'Image')}" /></figure>`
            : `<h1>${esc(obj.text || 'Untitled image')}</h1>`;
          break;

        case 'video':
          slot.innerHTML = obj.video
            ? `<figure><video class="hero-media" controls playsinline><source src="${esc(obj.video)}"></video></figure>`
            : `<h1>${esc(obj.text || 'Untitled video')}</h1>`;
          break;

        case 'audio': {
          const src = obj.audio;
          if (!src) {
            slot.innerHTML = `<h1>${esc(obj.text || 'Untitled audio')}</h1>`;
            break;
          }
        
          // ensure previous detail waveform is gone
          destroyDetailWave();
        
          // render just a container for WaveSurfer (no native controls)
          const id = `detail-wave-${obj.id || 'x'}`;
          slot.innerHTML = `
            <figure class="detail-media audio">
              <div id="${id}" class="wave" aria-label="Waveform"></div>
            </figure>
          `;
        
          // create the waveform
          __detailWave = WaveSurfer.create({ ...DETAIL_WS_CONFIG, container: `#${id}` });
          __detailWave.load(src);
        
          // same behavior as gallery: click toggles, hover plays, leave pauses
          const container = slot.querySelector(`#${id}`);
          container?.addEventListener('click', () => __detailWave?.playPause());
          container?.addEventListener('mouseenter', () => { try { __detailWave?.play(); } catch {} }, { passive: true });
          container?.addEventListener('mouseleave', () => { try { __detailWave?.pause(); } catch {} }, { passive: true });
        
          break;
        }          

        case 'text':
        default:
          slot.innerHTML = `<h1>${esc(obj.text || 'Untitled')}</h1>`;
          break;
      }
    }

    let __detailWS = null;
    let __detailWS_RO = null;
    
    function initDetailWave() {
      const waveDiv = document.getElementById('detail-wave');
      if (!waveDiv || !waveDiv.dataset.src) return;
    
      // Clean up any previous instance
      try { __detailWS_RO?.disconnect(); } catch {}
      try { __detailWS?.destroy(); } catch {}
      __detailWS = null; __detailWS_RO = null;
    
      // Create WaveSurfer
      __detailWS = WaveSurfer.create({
        container: waveDiv,
        height: 64,          // should match CSS height
        responsive: true,    // let it resize
        normalize: true
        // waveColor / progressColor optional – reuse your prefs if you have them
      });
    
      __detailWS.load(waveDiv.dataset.src);
    
      // Keep it in sync with layout changes
      __detailWS_RO = new ResizeObserver(() => {
        try { __detailWS?.resize(); } catch {}
      });
      __detailWS_RO.observe(waveDiv);
    }    

    // Holds return context so Back knows where to go
    window.__detailCtx = { from: null, gid: null, objectId: null };

    // Holds current nav state across clicks
    window.__detailNav = null; // { order: [id1,id2,...], index: 0, gid: '...' }

    // Compute ordered ID list for the current object's group
    function buildDetailNavFor(obj) {
      const all = (window.gridObject?.objects || window.objects || []);
      const groupId = String(obj.groupId);
      const inGroup = all.filter(o => String(o.groupId) === groupId);
      const ordered = inGroup.slice().sort(window.galleryComparator);
      return {
        order: ordered.map(o => String(o.id)),
        index: ordered.findIndex(o => String(o.id) === String(obj.id)),
        gid: groupId
      };
    }

    // Create or reuse nav for this object's group
    function ensureDetailNav(obj) {
      const g = String(obj.groupId);
      if (!window.__detailNav || window.__detailNav.gid !== g) {
        window.__detailNav = buildDetailNavFor(obj);
      } else {
        // If we jumped here via direct open, ensure index matches the currently opened id
        const i = window.__detailNav.order.indexOf(String(obj.id));
        if (i >= 0) window.__detailNav.index = i;
      }
      updateDetailNavUI();
    }

    // Enable/disable arrows at the ends
    function updateDetailNavUI() {
      const nav = window.__detailNav;
      if (!nav) return;
      const prevBtn = document.querySelector('#detail-content .vertical-content .detail-nav-arrow.prev');
      const nextBtn = document.querySelector('#detail-content .vertical-content .detail-nav-arrow.next');
      const total = nav.order.length;
      const i = nav.index; // 0-based
      if (prevBtn) {
        if (i <= 0) {
          prevBtn.hidden = true;
          prevBtn.textContent = '';
          prevBtn.setAttribute('aria-disabled', 'true');
        } else {
          prevBtn.hidden = false;
          prevBtn.textContent = `${i} / ${total}`; // previous item number (1-based)
          prevBtn.removeAttribute('aria-disabled');
          prevBtn.setAttribute('aria-label', `Go to item ${i} of ${total}`);
        }
      }
      if (nextBtn) {
        if (i >= total - 1) {
          nextBtn.hidden = true;
          nextBtn.textContent = '';
          nextBtn.setAttribute('aria-disabled', 'true');
        } else {
          nextBtn.hidden = false;
          nextBtn.textContent = `${i + 2} / ${total}`; // next item number (1-based)
          nextBtn.removeAttribute('aria-disabled');
          nextBtn.setAttribute('aria-label', `Go to item ${i + 2} of ${total}`);
        }
      }
    }

    // Go -1 / +1 within the cached order (no wrap)
    function stepDetail(delta) {
      const nav = window.__detailNav;
      if (!nav) return;
      let nextIndex = nav.index + delta;
      if (nextIndex < 0 || nextIndex >= nav.order.length) return; // stop at ends

      nav.index = nextIndex;
      const nextId = nav.order[nextIndex];

      // Keep same context, but swap objectId
      const ctx = window.__detailCtx || {};
      window.openObjectDetail({ objectId: nextId, from: ctx.from || null, gid: ctx.gid || null });
    }
    // after the closing brace of function stepDetail(delta) { ... }
    window.stepDetail = stepDetail;

    // --- keyboard navigation for detail view (← prev, → next) ---
    (function addDetailKeyboardNav() {
      const detailEl = document.getElementById('detail-content');

      // Ignore key presses while typing in inputs/textareas/contentEditable
      function isTypingTarget(el) {
        if (!el) return false;
        const tag = el.tagName;
        const editable = el.isContentEditable;
        return editable ||
              tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      }

      document.addEventListener('keydown', (e) => {
        // Only when the detail page is open/visible
        if (!detailEl || !detailEl.classList.contains('active')) return;
        if (isTypingTarget(e.target)) return;

        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          window.stepDetail?.(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          window.stepDetail?.(+1);
        }
      });
    })();

    window.openObjectDetail = function ({ objectId, from, gid } = {}) {
      if (!detailEl) return;

      // pause any grid waves so we don't hear two audios at once
      window.__gridWaves?.pauseAll?.();
      // make sure previous detail waveform is gone before rendering a new one
      destroyDetailWave();

      // Remember where we came from
      window.__detailCtx = { from: from || null, gid: gid || null, objectId: objectId || null };

      // Look up the object from in-memory data and render the primary slot
      const allObjects = (window.gridObject?.objects || window.objects || []);
      const obj = allObjects.find(o => String(o.id) === String(objectId));
      if (obj) {
        renderDetailPrimary(obj);
        ensureDetailNav(obj);
      } else {
        console.warn('[detail] object not found for id:', objectId);
      }

      // If we came from gallery: hide it (and detach observers) so nothing interferes
      if (from === 'gallery' && groupGalleryEl?.classList.contains('active')) {
        groupGalleryEl.classList.remove('active');
        window.__galleryIO__?.onClose?.();
      }

      // Hide grid shell (we'll come back to it on close)
      if (gridShellEl) gridShellEl.style.display = 'none';

      // Show the detail screen
      detailEl.classList.add('active');

      // Defer WaveSurfer init until after #detail-content is visible and laid out
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          initDetailWave();
        });
      });

      // Mark: we are in the full-page detail view
      document.body.classList.add('in-detail-page');

      // (Optional but useful) remember which object is open — used for the "Research project in …" text
      try {
        const all = window.gridObject?.objects || window.objects || [];
        const obj = all.find(o => String(o.id) === String(objectId));
        window._lastDetailObject = obj || null;
      } catch {
        window._lastDetailObject = null;
      }

      // Notify the header updater
      window.__dispatchViewChange?.();

      // Push a state so browser Back closes detail
      try {
        if (!history.state || !history.state.detail) {
          history.pushState(
            { detail: true, from: String(from || ''), gid: String(gid || ''), objectId: String(objectId || '') },
            '',
            '#detail'
          );
        }
      } catch {}

      refreshSlideInsVisibility();
      console.log('[detail] opened', window.__detailCtx);
    };

    window.closeObjectDetail = function ({ viaPopstate = false } = {}) {
      if (!detailEl?.classList.contains('active')) return;

      try { __detailWS_RO?.disconnect(); } catch {}
      try { __detailWS?.destroy(); } catch {}
      __detailWS = null; __detailWS_RO = null;

      destroyDetailWave();

      detailEl.classList.remove('active');

      // Unmark: we left the full-page detail
      document.body.classList.remove('in-detail-page');
      window._lastDetailObject = null;

      // Notify the header updater
      window.__dispatchViewChange?.();

      const { from, gid } = window.__detailCtx || {};

      if (from === 'gallery') {
        // Return to the same gallery without flicker
        if (groupGalleryEl) {
          groupGalleryEl.classList.add('active');
          // Re-attach observers/counters
          window.__galleryIO__?.onOpen?.();
        }
        if (gridShellEl) gridShellEl.style.display = 'none';
      } else {
        // Return to the grid (clustered/ungrouped card stays as it was)
        if (gridShellEl) gridShellEl.style.display = '';
      }

      refreshSlideInsVisibility();
      console.log('[detail] closed', { viaPopstate, from, gid });
    };

    // Back button: if detail is active, intercept before gallery handler
    document.addEventListener('click', (e) => {
      const back = e.target.closest('#content-back-button');
      if (!back) return;

      const isDetailActive = detailEl?.classList.contains('active');
      if (!isDetailActive) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      if (history.state?.detail) {
        history.back();
      } else {
        window.closeObjectDetail();
      }
    }, true); // capture, so we run before the gallery back handler

    // Popstate: close detail if we navigated away from its state
    window.addEventListener('popstate', () => {
      const active = detailEl?.classList.contains('active');
      const stillInDetail =
        !!history.state?.detail || location.hash === '#detail';

      if (active && !stillInDetail) {
        window.closeObjectDetail({ viaPopstate: true });
      }
    });
  })();

  (function galleryTextFit(){
    const gg = document.getElementById('group-gallery');
    if (!gg) return;
 
    let textObs = null;
    let mo = null;
    let resizeRaf = 0;
    let scrollRaf = 0;
 
    function fitScalingText(span) {
      const item = span.closest('.item.text');
      if (!item) return;
 
      // measure available box (subtract padding)
      const csItem = getComputedStyle(item);
      const padX = parseFloat(csItem.paddingLeft) + parseFloat(csItem.paddingRight);
      const padY = parseFloat(csItem.paddingTop)  + parseFloat(csItem.paddingBottom);
      const maxW = Math.max(0, item.clientWidth  - padX);
      const maxH = Math.max(0, item.clientHeight - padY);
 
      // early exit if nothing to do
      if (maxW <= 0 || maxH <= 0) return;
 
      // start from a sensible font size (computed)
      const csSpan = getComputedStyle(span);
      let fs = parseFloat(csSpan.fontSize) || 16;
 
      span.style.whiteSpace = 'normal';
      span.style.display = 'block';
      span.style.lineHeight = '1.1';
      span.style.maxWidth = maxW + 'px';
 
      // helper: does the span overflow the target box?
      const overflows = () => (span.scrollWidth > maxW + 0.5) || (span.scrollHeight > maxH + 0.5);
 
      // coarse downscale until it fits or we hit a floor
      let attempts = 0;
      while (attempts++ < 30 && overflows() && fs > 6) {
        fs *= 0.9;
        span.style.fontSize = fs + 'px';
      }
 
      // gentle upscale to approach the limit (optional)
      while (attempts++ < 60 && !overflows() && fs < 200) {
        fs *= 1.03;
        span.style.fontSize = fs + 'px';
        if (overflows()) {
          fs /= 1.03;
          span.style.fontSize = fs + 'px';
          break;
        }
      }
    }
 
    function fitAllVisibleTexts() {
      const spans = gg.querySelectorAll('.gallery-box .item.text .scaling-text');
      spans.forEach(s => fitScalingText(s));
    }
 
    function onResize() {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(fitAllVisibleTexts);
    }
 
   function onScroll() {
     cancelAnimationFrame(scrollRaf);
     scrollRaf = requestAnimationFrame(fitAllVisibleTexts);
   }
 
    function attachTextIO() {
      if (textObs) textObs.disconnect();
 
      const options = { root: gg, threshold: 0.15 };
      textObs = new IntersectionObserver((entries) => {
        entries.forEach(en => {
          if (!en.isIntersecting) return;
          const span = en.target;
          fitScalingText(span);
          textObs.unobserve(span); // one-shot per item; will re-fit on scroll/resize
        });
      }, options);
 
      // observe existing
      gg.querySelectorAll('.gallery-box .item.text .scaling-text').forEach(s => textObs.observe(s));
 
      // observe future nodes as the gallery is (re)rendered
      if (mo) mo.disconnect();
      mo = new MutationObserver(() => {
        gg.querySelectorAll('.gallery-box .item.text .scaling-text').forEach(s => {
          if (!s._observed) {
            s._observed = true;
            textObs.observe(s);
          }
        });
      });
      mo.observe(gg.querySelector('.gallery-box'), { childList: true, subtree: true });
    }
 
    // Optional external hook to force a pass
    window.__galleryTextFit = { refresh: fitAllVisibleTexts };
 
    (window.__galleryIO__ ||= { onOpen() {}, onClose() {} });
    const prevOpen = window.__galleryIO__.onOpen;
    const prevClose = window.__galleryIO__.onClose;
 
    window.__galleryIO__.onOpen = function () {
      prevOpen?.();
      attachTextIO();
      requestAnimationFrame(fitAllVisibleTexts);
      document.fonts?.ready.then(() => requestAnimationFrame(fitAllVisibleTexts));
      window.addEventListener('resize', onResize);
      gg.addEventListener('scroll', onScroll, { passive: true });
    };
 
    window.__galleryIO__.onClose = function () {
      prevClose?.();
      if (textObs) { textObs.disconnect(); textObs = null; }
      if (mo) { mo.disconnect(); mo = null; }
      window.removeEventListener('resize', onResize);
      gg.removeEventListener('scroll', onScroll);
    };
  })();
 

  backBtnEl?.addEventListener('click', (e) => { e.preventDefault(); closeGallery(); });

  if (!gridEl) {
    console.log('[debug] #grid element not found at script load');
  } else {
    gridEl.addEventListener('click', (e) => {
      const go = window.gridObject;
      const isGrouped = go?.currentState === 'grouped';

      // Robust object detection under the cursor:
      let objEl = null;

      // 1) composedPath (handles retargeting/shadow-ish cases)
      if (e.composedPath) {
        const path = e.composedPath();
        objEl = path.find(n => n && n.classList && n.classList.contains('object')) || null;
      }

      // 2) elementsFromPoint fallback (topmost element under pointer)
      if (!objEl && document.elementsFromPoint) {
        const stack = document.elementsFromPoint(e.clientX, e.clientY);
        objEl = stack.find(n => n && n.classList && n.classList.contains('object')) || null;
      }

      // 3) classic closest as a last resort
      if (!objEl && e.target && e.target.closest) {
        objEl = e.target.closest('.object');
      }

      // SWALLOW clicks that immediately follow a drag in grouped mode
      if (isGrouped && (performance.now() - __lastDragAt) < 200) {
        return;
      }

      // Debug what we actually found
      console.log('[debug] resolve objEl', {
        target: e.target.tagName,
        targetCls: e.target.className,
        found: !!objEl,
        objId: objEl && objEl.id
      });

      console.log('[click]', {
        target: e.target.tagName,
        isGrouped,
        hasObjectAncestor: !!objEl,
        objId: objEl?.id
      });

      // Only in grouped mode: any object click opens gallery
      if (isGrouped && objEl) {
        e.preventDefault();
        e.stopPropagation();
        const obj = (window.gridObject?.objects || objects || []).find(o => String(o.id) === String(objEl.id));
        const gid = obj?.groupId;
        openGallery(gid);
      }
    }, true); // capture so we log/handle even if child elements have handlers
  }
}

// === IntersectionObserver for #group-gallery (title + item-by-item) ===
(function galleryIntersectionObservers() {
  const gg = document.getElementById('group-gallery');
  if (!gg) return;

  function setupGalleryIO() {
    if (gg._ioBound) return;          // bind once per open
    gg._ioBound = true;

    // Title box fades in when it comes into view (viewport is fine)
    const title = gg.querySelector('.title-box');
    if (title) {
      const titleObs = new IntersectionObserver((entries, obs) => {
        entries.forEach(en => {
          if (en.isIntersecting) {
            en.target.classList.add('visible');   // put .visible on the title itself
            obs.unobserve(en.target);             // one-shot
          }
        });
      }, { root: null, threshold: 0.35, rootMargin: '0px 0px -10% 0px' });
      titleObs.observe(title);
      gg._titleObs = titleObs;
    }

    // Items fade in individually as you horizontally scroll the gallery box
    //const box = gg.querySelector('.gallery-box');
    //const itemObs = new IntersectionObserver((entries, obs) => {
    const box = gg.querySelector('.gallery-box');
    if (!box) return; // require the horizontal scroller as the IO root
    const scroller = gg; // #group-gallery is the scroll container (has overflow-x: scroll)
    const itemObs = new IntersectionObserver((entries, obs) => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        // if the observed node is an <img> that got wrapped later,
        // add .visible to the nearest .item wrapper:
        const item = en.target.classList.contains('item')
          ? en.target
          : en.target.closest('.item');
        if (item) item.classList.add('visible');
        obs.unobserve(en.target);   // one-shot
      });
    }, {
      root: scroller,
      threshold: 0.15,
      rootMargin: '0px'
    });

    // Observe all current items
    //(box ? box.querySelectorAll('.item') : gg.querySelectorAll('.item'))
    //  .forEach(el => itemObs.observe(el));

    // Optional: small stagger for items initially visible at open
    let idx = 0;
    box.querySelectorAll('.column > .item, .column img.item').forEach(el => {
      // Set delay on the actual flex item (wrapper if present)
      const item = el.classList.contains('item') ? el : el.closest('.item') || el;
      item.style.transitionDelay = `${(idx++ % 6) * 40}ms`;
      // Observe the original node; the callback will add .visible to the wrapper
      itemObs.observe(el);
    });

    gg._itemObs = itemObs;
  }

  // Expose tiny helpers so your existing open/close can call them
  window.__galleryIO__ = {
    onOpen() {
      // (Re)bind observers after the gallery becomes visible in the layout
      requestAnimationFrame(() => {
        setupGalleryIO();
      });
    },
    onClose() {
      if (gg._itemObs) { gg._itemObs.disconnect(); gg._itemObs = null; }
      if (gg._titleObs) { gg._titleObs.disconnect(); gg._titleObs = null; }
      gg._ioBound = false;
      // Reset visibility so next open fades again
      gg.querySelector('.title-box')?.classList.remove('visible');
      gg.querySelectorAll('.gallery-box .item').forEach(el => { 
        el.style.transitionDelay = ''; 
        el.classList.remove('visible');
      });
    }
  };
})();

// === Wrap gallery side counters so only the inner rotates ===
(() => {
  const gg = document.getElementById('group-gallery');
  if (!gg) return;

  function ensureRot(node) {
    if (!node) return;
    if (!node.querySelector('.rot')) {
      const span = document.createElement('span');
      span.className = 'rot';
      span.innerHTML = node.innerHTML;
      node.innerHTML = '';
      node.appendChild(span);
    }
  }

  (window.__galleryIO__ ||= { onOpen() {}, onClose() {} });
  const prevOpen  = window.__galleryIO__.onOpen;
  const prevClose = window.__galleryIO__.onClose;

  window.__galleryIO__.onOpen = function () {
    prevOpen?.();
    gg.querySelectorAll('.count-invisible-objects.left, .count-invisible-objects.right')
      .forEach(ensureRot);
  };

  window.__galleryIO__.onClose = function () {
    prevClose?.();
    // nothing special to undo; gallery DOM is rebuilt on next open
  };
})();

// === Gallery audio waveforms (WaveSurfer) ===
// Builds one waveform per entry in audioPool, lazy-creates on intersection, destroys on close.
(() => {
  const gg = document.getElementById('group-gallery');
  if (!gg) return;

  // Registry of WaveSurfer instances for this gallery session
  let wsRegistry = new Map();
  let audioObserver = null;

  // Config cloned from demo-sidebars.html
  const WS_CONFIG = {
    waveColor: '#666',
    progressColor: '#aaa',
    cursorColor: '#ccc',
    height: 50,          // overall container height
    barWidth: 2,         // wider bars = lower resolution
    barGap: 1,           // spacing between bars
    barHeight: 40,       // shorter bars
    normalize: true,
    responsive: true,
    interact: true,
    cursorWidth: 1,
  };

  // Lazy-create waves when items enter the visible gallery viewport
  function attachAudioIO() {
    // Ensure previous observer is gone
    if (audioObserver) {
      audioObserver.disconnect();
      audioObserver = null;
    }

    const scroller = gg; // #group-gallery is the horizontal scroller (your viewport)
    const options = { root: scroller, threshold: 0.15, rootMargin: '0px' };

    audioObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;

        const item = en.target;
        const wave = item.querySelector('.wave');
        const src  = item.dataset.audioSrc;
        if (!wave || !src) return;

        // Create WaveSurfer once per container
        if (!wsRegistry.has(wave.id)) {
          const ws = WaveSurfer.create({ ...WS_CONFIG, container: `#${wave.id}` });
          ws.load(src);

          // Simple play/pause on click (mirror demo behavior)
          item.addEventListener('click', () => ws.playPause());
          item.addEventListener('mouseenter', () => { try { ws.play(); } catch {} }, { passive: true });
          item.addEventListener('mouseleave', () => { try { ws.pause(); } catch {} }, { passive: true });

          wsRegistry.set(wave.id, ws);
        }

        // Stop observing after first creation
        obs.unobserve(item);
      });
    }, options);

    // Observe any audio items currently in DOM
    gg.querySelectorAll('.gallery-box .item.audio').forEach(el => audioObserver.observe(el));
  }

  // Destroy all WaveSurfer instances and clear the column
  function destroyAllAudio() {
    if (audioObserver) { audioObserver.disconnect(); audioObserver = null; }
    wsRegistry.forEach(ws => { try { ws.destroy?.(); } catch(_){} });
    wsRegistry.clear();
  }

  // Hook into gallery lifecycle (fade-in/counters already use these hooks)
  (window.__galleryIO__ ||= { onOpen(){}, onClose(){} });
  const prevOpen  = window.__galleryIO__.onOpen;
  const prevClose = window.__galleryIO__.onClose;

  window.__galleryIO__.onOpen = function() {
    prevOpen?.();
    attachAudioIO();      // lazy-create for any .item.audio present
  };

  window.__galleryIO__.onClose = function() {
    prevClose?.();
    destroyAllAudio();    // clean up for a fresh reopen
  };
})();

// === Grid audio waveforms (WaveSurfer) ===
// Creates one WaveSurfer per #grid .object.audio tile; plays on hover, pauses on mouseout.
(() => {
  const grid = document.getElementById('grid');
  if (!grid) return;

  const WS_CONFIG = {
    waveColor: '#666',
    progressColor: '#aaa',
    cursorColor: '#ccc',
    height: 50,
    barWidth: 2,
    barGap: 1,
    barHeight: 40,
    normalize: true,
    responsive: true,
    interact: true,
    cursorWidth: 1,
  };

  const wsMap = new Map(); // key = wave.id, val = ws instance

  function initTile(el) {
    const wave = el.querySelector('.wave');
    const src  = el.dataset.audioSrc;
    if (!wave || !src) return;

    if (!wsMap.has(wave.id)) {
      const ws = WaveSurfer.create({ ...WS_CONFIG, container: `#${wave.id}` });
      ws.load(src);

      // Hover behavior
      el.addEventListener('mouseenter', () => { try { ws.play(); } catch {} }, { passive: true });
      el.addEventListener('mouseleave', () => { try { ws.pause(); } catch {} }, { passive: true });

      wsMap.set(wave.id, ws);
    }
  }

  // Lazy-init when tiles are visible
  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      initTile(en.target);
      io.unobserve(en.target);
    });
  }, { root: null, threshold: 0.2 });

  function observeAudioTiles(root = grid) {
    root.querySelectorAll('.object.audio').forEach(el => io.observe(el));
  }

  // Observe existing tiles now…
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => observeAudioTiles(), { once: true });
  } else {
    observeAudioTiles();
  }

  // …and any tiles added later (cluster/ungrouped changes or Strapi loads)
  const mo = new MutationObserver((muts) => {
    muts.forEach(m => {
      m.addedNodes?.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.classList?.contains('object') && node.classList.contains('audio')) {
          io.observe(node);
        }
        node.querySelectorAll?.('.object.audio').forEach(el => io.observe(el));
      });
    });
  });
  mo.observe(grid, { childList: true, subtree: true });

  // Optional API: allow grid.js to pause all waves when opening a detail card
  window.__gridWaves ||= {
    pauseAll() { wsMap.forEach(ws => { try { ws.pause(); } catch {} }); }
  };
})();


// === Grid audio waveforms (WaveSurfer) ===
// Creates a waveform inside each #grid .object.audio .wave, lazy-inits on intersection.
(() => {
  const grid = document.getElementById('grid');
  if (!grid) return;

  // Shared registry and API exposed for grid.js to pause waves on detail open
  const wsRegistry = new Map();
  window.__gridWaves = {
    pauseAll() {
      wsRegistry.forEach(ws => { try { ws.pause?.(); } catch(_){} });
    },
    rescan() {
      observeAllAudioTiles();
    }
  };

  // Same visual config as the gallery (keep UX consistent)
  const WS_CONFIG = {
    waveColor: '#666',
    progressColor: '#aaa',
    cursorColor: '#ccc',
    height: 50,
    barWidth: 2,
    barGap: 1,
    barHeight: 40,
    normalize: true,
    responsive: true,
    interact: true,
    cursorWidth: 1,
  };

  // Lazy-create when a tile is on screen
  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const el = en.target;
      const wave = el.querySelector('.wave');
      const src  = el.dataset.audioSrc;
      if (!wave || !src) return;

      if (!wsRegistry.has(wave.id)) {
        const ws = WaveSurfer.create({ ...WS_CONFIG, container: `#${wave.id}` });
        ws.load(src);

        // Simple play/pause toggle on click
        el.addEventListener('click', (e) => {
          // don't steal clicks from detail open links etc.
          if ((e.target.closest('.detail-panel')) || (e.target.tagName === 'A')) return;
          ws.playPause();
        });

        wsRegistry.set(wave.id, ws);
      }

      io.unobserve(el); // only need to init once
    });
  }, { root: null, threshold: 0.2 });

  // Observe all existing audio tiles (grid items are built once at load)
  function observeAllAudioTiles() {
    grid.querySelectorAll('.object.audio').forEach(el => io.observe(el));
  }

  // Watch for future .object.audio tiles and observe them when they appear
  const mo = new MutationObserver((muts) => {
    muts.forEach(m => {
      m.addedNodes?.forEach(node => {
        if (node.nodeType !== 1) return;

        // A tile added directly
        if (node.classList?.contains('object') && node.classList?.contains('audio')) {
          io.observe(node);
        }

        // Or audio tiles added deeper inside a wrapper
        node.querySelectorAll?.('.object.audio').forEach(el => io.observe(el));
      });
    });
  });
  mo.observe(grid, { childList: true, subtree: true });

  // Kick it off after the grid is created/populated
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeAllAudioTiles, { once: true });
  } else {
    observeAllAudioTiles();
  }
})();

// === Dynamic gallery renderer (fixed 3 items per column; random item widths 100–200px) ===
(function galleryRenderer() {
  const gg  = document.getElementById('group-gallery');
  const box = gg?.querySelector('.gallery-box');
  if (!gg || !box) return;

  // random width between 100–200 px
  function randItemWidth() {
    return 100 + Math.floor(Math.random() * 101); // 100..200
  }

  function uid() {
    return (crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
  }

  function createGalleryItem(o) {
    // IMAGE (allow up to 1.5x intrinsic CSS width, DPR-aware)
    if (o.type === 'image') {
      const img = document.createElement('img');
      img.className = 'item image';
      img.alt = o.alt || '';
      img.loading = 'lazy';
      img.src = o.image || o.src || o.url || '';

      const desired = randItemWidth();      // your 100–200 px random width
      const dpr = window.devicePixelRatio || 1;
      const UPSCALE_MAX = 2;              // allow up to 150% of intrinsic CSS width

      // helper to apply width and keep counters in sync
      const setCssWidth = (px) => {
        img.style.width = `${px}px`;
        img.style.height = 'auto';
        img.style.display = 'block';
        requestAnimationFrame(() => window.__galleryIO__?._updateCounts?.());
      };

      // If dummy data has intrinsic pixel width, clamp immediately
      if (typeof o.width === 'number' && o.width > 0) {
        const intrinsicCss = o.width / dpr;                         // pixels → CSS px on this DPR
        const maxCss = Math.max(1, Math.floor(intrinsicCss * UPSCALE_MAX));
        setCssWidth(Math.min(desired, maxCss));
      } else {
        // Otherwise set desired first, then clamp after the image loads
        setCssWidth(desired);
        img.addEventListener('load', () => {
          const intrinsic = img.naturalWidth || desired;            // pixel width
          const intrinsicCss = intrinsic / dpr;
          const maxCss = Math.max(1, Math.floor(intrinsicCss * UPSCALE_MAX));
          if (desired > maxCss) setCssWidth(maxCss);
        }, { once: true });
      }

      img.dataset.oid = o.id || '';
      return img;
    }

    // VIDEO
    if (o.type === 'video') {
      const vid = document.createElement('video');
      vid.className = 'item';
      vid.setAttribute('playsinline', '');
      vid.setAttribute('muted', '');
      vid.setAttribute('loop', '');
      vid.src = o.video || o.src || o.url || '';
      vid.style.width  = `${randItemWidth()}px`;   // ← random width
      vid.style.height = 'auto';                   // ← auto height
      vid.style.display = 'block';
      //vid.addEventListener('mouseover', () => { try { vid.play(); } catch {} });
      //vid.addEventListener('mouseout',  () => { try { vid.pause(); } catch {} });

      vid.dataset.oid = o.id || '';
      return vid;
    }

    // TEXT
    if (o.type === 'text') {
      const d = document.createElement('div');
      d.className = 'item text';
      d.style.width = `${randItemWidth()}px`;      // ← random width
      const span = document.createElement('span');
      span.className = 'scaling-text';
      span.textContent = o.text || o.caption || o.title || '';
      d.appendChild(span);

      d.dataset.oid = o.id || '';
      return d;
    }

    // AUDIO (WaveSurfer picks these up via IO)
    if (o.type === 'audio') {
      const item = document.createElement('div');
      item.className = 'item audio';
      item.style.width = `${randItemWidth()}px`;   // ← random width for the whole item
      item.style.display = 'block';

      const wave = document.createElement('div');
      wave.className = 'wave';
      wave.id = `wave_${o.id || uid()}_g`;
      wave.style.width = '100%';                   // fill the item’s random width
      wave.style.height = '50px';
      item.dataset.audioSrc = o.audio || o.src || o.url || '';
      item.appendChild(wave);

      item.dataset.oid = o.id || '';
      return item;
    }

    // Fallback
    const d = document.createElement('div');
    d.className = 'item text';
    d.style.width = `${randItemWidth()}px`;        // ← random width
    const span = document.createElement('span');
    span.className = 'scaling-text';
    span.textContent = o.title || '[unknown]';
    d.appendChild(span);

    d.dataset.oid = o.id || '';
    return d;
  }

    // ---- Deterministic gallery order (detail-page-only for now) ----
  function galleryComparator(a, b) {
    // Primary: by a stable timestamp if available (earlier first)
    const ta = a.date ? new Date(a.date).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.date ? new Date(b.date).getTime() : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;

    // Secondary: by type (consistent grouping of media kinds)
    const w = { image: 1, text: 2, video: 3, audio: 4 };
    const da = (w[a.type] || 999) - (w[b.type] || 999);
    if (da) return da;

    // Tertiary: by human text if present
    const sa = (a.text || a.title || '').localeCompare(b.text || b.title || '');
    if (sa) return sa;

    // Fallback: by id to be fully deterministic
    return String(a.id).localeCompare(String(b.id));
  }
  window.galleryComparator = window.galleryComparator || galleryComparator;

  function groupObjects(gid) {
    const all = (window.gridObject?.objects || window.objects || []);
    return all.filter(o => String(o.groupId) === String(gid));
  }

  // Fisher–Yates shuffle (returns a new array)
  function shuffleArray(src) {
    const a = src.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Heuristic weight so tall items spread out.
  // Tune the numbers if needed; lower = "lighter", higher = "taller".
  function estimateGalleryWeight(o) {
    if (o.video) return 3.0;                     // videos tend to be tall in your layout
    if (o.image) return 2.6;                     // images a bit less
    if (o.audio) return 1.0;                     // waveform ~60px
    if (o.text) {
      const len = (o.text || '').length;
      return Math.min(3, 0.6 + len / 140);       // longer text = a bit "heavier"
    }
    return 1.0;
  }

  // Return index of the smallest value in an array
  function pickLightestIndex(arr) {
    let idx = 0, min = arr[0] ?? 0;
    for (let i = 1; i < arr.length; i++) {
      const v = arr[i] ?? 0;
      if (v < min) { min = v; idx = i; }
    }
    return idx;
  }

  // Public: build the gallery for a given group id (3 items per column)
  window.renderGroupGallery = function(gid) {
    if (!gid) return;
    //const objs = groupObjects(gid);
    const objs = shuffleArray(groupObjects(gid));

    const itemsPerCol = 3;
    const colCount = Math.max(1, Math.ceil(objs.length / itemsPerCol));

    // make fresh columns
    box.innerHTML = '';
    const cols = [];
    for (let i = 0; i < colCount; i++) {
      const c = document.createElement('div');
      c.className = 'column';
      cols.push(c);
      box.appendChild(c);
    }

    // Greedy placement: always append to the shortest column so far
    const colWeights = new Array(cols.length).fill(0);
    objs.forEach((o) => {
      const el = createGalleryItem(o);
      const idx = pickLightestIndex(colWeights);
      cols[idx].appendChild(el);
      colWeights[idx] += estimateGalleryWeight(o);
    });

    requestAnimationFrame(() => {
      window.__galleryIO__?._updateCounts?.();
      window.__galleryTextFit?.refresh?.();
    });
  };

  // Build gallery from an explicit object list (tags selection)
 // Build gallery from an explicit object list (same layout rules as groups)
window.renderAdhocGallery = function(objs = []) {
  const gg  = document.getElementById('group-gallery');
  const box = gg?.querySelector('.gallery-box');
  if (!gg || !box) return;

  // 1) fresh columns: 3 items per column → ceil(N/3) columns
  const N = Array.isArray(objs) ? objs.length : 0;
  const itemsPerCol = 3;
  const colCount = Math.max(1, Math.ceil(N / itemsPerCol));

  box.innerHTML = '';
  const cols = [];
  for (let i = 0; i < colCount; i++) {
    const c = document.createElement('div');
    c.className = 'column';
    cols.push(c);
    box.appendChild(c);
  }

  // 2) same placement: greedy to the shortest column using the same weights
  const colWeights = new Array(colCount).fill(0);

  // Optional: mimic group gallery randomness
  const list = (typeof shuffleArray === 'function') ? shuffleArray([...objs]) : [...objs];

  list.forEach((o) => {
    const el = createGalleryItem(o);           // <-- reuse existing builder
    const idx = pickLightestIndex(colWeights); // <-- reuse existing helper
    cols[idx].appendChild(el);
    colWeights[idx] += estimateGalleryWeight(o);
  });

  // 3) same post-pass as groups (if you call counts/text-fit there)
  requestAnimationFrame(() => {
    window.__galleryIO__?._updateCounts?.();
    window.__galleryTextFit?.refresh?.();
  });
};
})();

// === Invisible item counters (left/right) scoped to #group-gallery ===
(function galleryCounters() {
  const gg = document.getElementById('group-gallery');
  if (!gg) return;

  function attachCountersOnce() {
    if (gg._countsBound) return;
    gg._countsBound = true;

    const scroller   = gg; // #group-gallery IS the horizontal scroller (overflow-x)
    const leftBadge  = gg.querySelector('.count-invisible-objects.left .value');
    const rightBadge = gg.querySelector('.count-invisible-objects.right .value');
    const items      = () => gg.querySelectorAll('.gallery-box .item');

    if (!leftBadge || !rightBadge) return;

    function updateCounts() {
      // Compare each item rect to the scroller's visible window
      const viewport = scroller.getBoundingClientRect();
      let left = 0, right = 0;

      items().forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.right <= viewport.left)  left++;       // fully left of view
        else if (r.left >= viewport.right) right++;  // fully right of view
      });

      leftBadge.textContent  = String(left);
      rightBadge.textContent = String(right);
    }

    // Update on horizontal scroll of the scroller, and on resize
    scroller.addEventListener('scroll', updateCounts, { passive: true });
    window.addEventListener('resize', updateCounts);

    // Recalculate when images load (sizes change after load)
    gg.querySelectorAll('img').forEach(img => {
      if (!img.complete) img.addEventListener('load', updateCounts, { once: true });
    });

    // Initial calculate once the gallery is visible in layout
    requestAnimationFrame(updateCounts);

    // keep references for cleanup on close (optional)
    gg._updateCounts = updateCounts;
  }

  // hook into the same open/close lifecycle used for the fade-ins
  (window.__galleryIO__ ||= { onOpen(){}, onClose(){} });
  const prevOpen  = window.__galleryIO__.onOpen;
  const prevClose = window.__galleryIO__.onClose;

  window.__galleryIO__.onOpen = function() {
    prevOpen?.();
    attachCountersOnce();
    // ensure the counts reflect current scroll after opening
    gg._updateCounts?.();
  };

  window.__galleryIO__.onClose = function() {
    prevClose?.();
    // optional: nothing to detach (listeners can persist); if you want full cleanup:
    // window.removeEventListener('resize', gg._updateCounts);
    // gg._countsBound = false;
  };
})();


// --- Smooth "Explore" scroll (bind once on open) ---
(function bindExploreScroll(){
  const gg = document.getElementById('group-gallery');
  if (!gg || gg._exploreBound) return;
  gg._exploreBound = true;

  const btn     = gg.querySelector('#scroll-on');
  const target  = gg.querySelector('#gallery-scroll') || gg.querySelector('.gallery-box');

  if (!btn || !target) return;

  btn.addEventListener('click', (e) => {
    e.preventDefault(); // stop the page from jumping to the hash

    // Prefer element-based scroll; it uses the nearest scrollable ancestor (#group-gallery)
    if (target.scrollIntoView) {
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
      return;
    }

    // Fallback: manual horizontal scroll on the scroller
    const scroller = gg;
    const x = target.offsetLeft - scroller.offsetLeft;
    scroller.scrollTo({ left: x, top: 0, behavior: 'smooth' });
  });
})();

// === Gallery back-button + history integration ===
{
  const gridShellEl    = document.getElementById('grid-shell');
  const groupGalleryEl = document.getElementById('group-gallery');

  // Ensure we only bind once
  if (!window.__galleryHistoryBound) {
    window.__galleryHistoryBound = true;

    // 1) Delegate click for the back button: go back in navigation if we created a gallery state;
    //    otherwise just close the gallery.
    document.addEventListener('click', (e) => {
      const back = e.target.closest('#content-back-button');
      if (!back) return;
      e.preventDefault();

      // If we pushed a gallery state, let browser back close it via popstate:
      if (history.state && history.state.gallery) {
        history.back();
      } else {
        // Fallback: close directly if no history state
        window.closeGallery?.();
      }
    }, true);

    // 2) Listen for back/forward to restore the grid when leaving the gallery state
    window.addEventListener('popstate', () => {
      const active = groupGalleryEl?.classList.contains('active');
      const stillInGallery = !!history.state?.gallery || location.hash === '#gallery' || location.hash === '#group-gallery';
      if (active && !stillInGallery) {
        window.closeGallery?.({ viaPopstate: true });
      }
    });
  }
}

// === Gallery videos: autoplay muted, sound on hover, pause when off-screen ===
(() => {
  const gg = document.getElementById('group-gallery');
  if (!gg) return;

  let io = null;
  let videos = [];

  function bindVideo(v) {
    // Attributes needed for autoplay on all browsers
    v.muted = true;
    v.loop = true;
    v.autoplay = true;                 // attribute; we'll still call play() via IO
    v.playsInline = true;              // iOS Safari
    v.controls = false;
    v.preload = 'metadata';

    // Sound on hover
    v.addEventListener('mouseenter', () => { v.muted = false; }, { passive: true });
    v.addEventListener('mouseleave', () => { v.muted = true;  }, { passive: true });
  }

  function onIO(entries) {
    entries.forEach(en => {
      const v = en.target;
      if (en.isIntersecting) {
        v.muted = true;                // ensure autoplay is allowed
        v.play().catch(() => {});      // ignore user-gesture errors
      } else {
        v.pause();
      }
    });
  }

  window.__galleryVideos__ = {
    onOpen() {
      // find all <video> elements inside the gallery
      videos = Array.from(gg.querySelectorAll('video'));
      videos.forEach(bindVideo);

      // Observe visibility (prefer the scroller if present)
      const root = gg.querySelector('.gallery-box') || gg;
      io = new IntersectionObserver(onIO, { root, threshold: 0.5 });
      videos.forEach(v => io.observe(v));
    },
    onClose() {
      if (io) { io.disconnect(); io = null; }
      videos.forEach(v => { try { v.pause(); } catch {} v.muted = true; });
      videos = [];
    }
  };
})();

// === Gallery images: Ken Burns (randomized pan+zoom, only while visible) ===
(() => {
  const gg = document.getElementById('group-gallery');
  if (!gg) return;

  // Pick one of several gentle pan directions + zoom combo
  function randomKBVars() {
    const dirs = [
      { x0: '-4%', y0: '-3%', x1: ' 4%', y1: ' 3%' }, // TL -> BR
      { x0: ' 4%', y0: ' 3%', x1: '-4%', y1: '-3%' }, // BR -> TL
      { x0: ' 0%', y0: '-4%', x1: ' 0%', y1: ' 4%' }, // T -> B
      { x0: ' 0%', y0: ' 4%', x1: ' 0%', y1: '-4%' }, // B -> T
      { x0: '-4%', y0: ' 0%', x1: ' 4%', y1: ' 0%' }, // L -> R
      { x0: ' 4%', y0: ' 0%', x1: '-4%', y1: ' 0%' }, // R -> L
      { x0: '-3%', y0: ' 3%', x1: ' 3%', y1: '-3%' }, // BL <-> TR
    ];
    const d = dirs[Math.floor(Math.random() * dirs.length)];
    const s0 = 1.06 + Math.random() * 0.02; // 1.06–1.08
    const s1 = s0 + 0.04;                    // +0.04 zoom
    const base = 11 + Math.random() * 3;           // was ~11–14s
    return { ...d, s0, s1, duration: (base / 2).toFixed(2) + 's' }; // now ~5.5–7s
  }

  // Ensure each image has a cropping viewport (.kb-wrap) and mark img as .kb-img
  function ensureKB(itemOrImg) {
    let item = itemOrImg;
    let img = itemOrImg;

    // If a DIV.item.image contains an IMG
    if (item.tagName !== 'IMG') {
      img = item.querySelector('img');
      if (!img) return null;
    }

    // If already wrapped, ensure wrapper has the right classes/data
    const existing = img.closest('.kb-wrap');
    if (existing) {
      existing.classList.add('item', 'image');     // make wrapper the flex item
      if (img.dataset.oid) existing.dataset.oid = img.dataset.oid; // move data to wrapper
      img.classList.add('kb-img');                 // keep animation class on IMG
      img.classList.remove('item', 'image');       // avoid duplicate .item on child
      return img;
    }

    // Insert a .kb-wrap right above the img; make wrapper the flex item
    const wrap = document.createElement('div');
    wrap.className = 'kb-wrap';
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);

    // make the WRAPPER the gallery item
    wrap.classList.add('item', 'image');

    // move data attributes needed by delegation (e.g., data-oid) to wrapper
    if (img.dataset.oid) wrap.dataset.oid = img.dataset.oid;

    // the IMG keeps only the animation class (and any intrinsic classes), not .item
    img.classList.add('kb-img');
    img.classList.remove('item', 'image');

    return img;

  }

  // Toggle animation only when visible
  let io = null;
  let bound = false;

  function bindAll() {
    if (bound) return;
    bound = true;

    const root = gg.querySelector('.gallery-box') || gg;
    io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        // We observe the ITEM (.item.image), but animate the IMG (.kb-img)
        const item = en.target;
        const img  = item.tagName === 'IMG' ? item : item.querySelector('img');
        if (!img) return;

        const kbImg = ensureKB(item); // wrap if needed
        if (!kbImg) return;

        if (en.isIntersecting) {
          // Randomize per-image variables only once
          if (!kbImg.__kbInit) {
            const vars = randomKBVars();
            const wrap = kbImg.closest('.kb-wrap');
            wrap.style.setProperty('--kb-x0', vars.x0);
            wrap.style.setProperty('--kb-y0', vars.y0);
            wrap.style.setProperty('--kb-x1', vars.x1);
            wrap.style.setProperty('--kb-y1', vars.y1);
            wrap.style.setProperty('--kb-s0', String(vars.s0));
            wrap.style.setProperty('--kb-s1', String(vars.s1));
            wrap.style.setProperty('--kb-duration', vars.duration);

            // PRE-SEED so hover doesn't jump
            kbImg.style.transform = `translate(${vars.x0}, ${vars.y0}) scale(${vars.s0})`;

            kbImg.__kbInit = true;
          }
        }
      });
    }, { root, threshold: 0.35 });

    // Observe all current gallery image items (supports either IMG.item.image or DIV.item.image)
    const items = gg.querySelectorAll('.gallery-box .column .item.image, .gallery-box .column img.item');
    items.forEach(el => io.observe(el));
  }

  window.__galleryImages__ = {
    onOpen() {
      bindAll();
    },
    onClose() {
      if (io) io.disconnect();
      gg.querySelectorAll('.kb-img.kb-anim').forEach(img => img.classList.remove('kb-anim'));
    }
  };
})();

// === Grid images: Ken Burns (only while visible; works in clustered/ungrouped) ===
(() => {
  const grid = document.getElementById('grid');
  if (!grid) return;

  function randomKBVars() {
    const dirs = [
      { x0: '-4%', y0: '-3%', x1: ' 4%', y1: ' 3%' },
      { x0: ' 4%', y0: ' 3%', x1: '-4%', y1: '-3%' },
      { x0: ' 0%', y0: '-4%', x1: ' 0%', y1: ' 4%' },
      { x0: ' 0%', y0: ' 4%', x1: ' 0%', y1: '-4%' },
      { x0: '-4%', y0: ' 0%', x1: ' 4%', y1: ' 0%' },
      { x0: ' 4%', y0: ' 0%', x1: '-4%', y1: ' 0%' },
    ];
    const d = dirs[Math.floor(Math.random() * dirs.length)];
    const s0 = 1.05 + Math.random() * 0.02;
    const s1 = s0 + 0.05;
    const base = 10 + Math.random() * 3;          // was ~10–13s
    return { ...d, s0, s1, duration: (base / 2).toFixed(2) + 's' }; // now ~5–6.5s
  }

  function ensureKB(img) {
    if (!img) return null;
    if (img.closest('.kb-wrap')) return img;
    const wrap = document.createElement('div');
    wrap.className = 'kb-wrap';
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);
    img.classList.add('kb-img');
    return img;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      const img = en.target;
      const kbImg = ensureKB(img);
      if (!kbImg) return;

      if (en.isIntersecting) {
        if (!kbImg.__kbInit) {
          const v = randomKBVars();
          const wrap = kbImg.closest('.kb-wrap');
          wrap.style.setProperty('--kb-x0', v.x0);
          wrap.style.setProperty('--kb-y0', v.y0);
          wrap.style.setProperty('--kb-x1', v.x1);
          wrap.style.setProperty('--kb-y1', v.y1);
          wrap.style.setProperty('--kb-s0', String(v.s0));
          wrap.style.setProperty('--kb-s1', String(v.s1));
          wrap.style.setProperty('--kb-duration', v.duration);

          // PRE-SEED so hover doesn't jump
          kbImg.style.transform = `translate(${v.x0}, ${v.y0}) scale(${v.s0})`;

          kbImg.__kbInit = true;
        }
      }
    });
  }, { root: null, threshold: 0.35 });

  function observeAll() {
    // Images inside grid objects marked as image
    grid.querySelectorAll('.object.image img, .object[data-type="image"] img').forEach(img => io.observe(img));
  }

  // Initial pass
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeAll, { once: true });
  } else {
    observeAll();
  }

  // Watch for new/changed tiles (e.g., after Strapi loads or state switches)
  const mo = new MutationObserver((muts) => {
    muts.forEach(m => {
      m.addedNodes?.forEach(node => {
        if (node.nodeType !== 1) return;
        node.querySelectorAll?.('.object.image img, .object[data-type="image"] img').forEach(img => io.observe(img));
        if (node.matches?.('.object.image img, .object[data-type="image"] img')) io.observe(node);
      });
    });
  });
  mo.observe(grid, { childList: true, subtree: true });
})();

// === Clicking a single item in the gallery opens the object detail ===
(function galleryItemToDetail() {
  const gg = document.getElementById('group-gallery');
  if (!gg) return;

  const box = gg.querySelector('.gallery-box');
  if (!box || box._detailBound) return;
  box._detailBound = true;

  box.addEventListener('click', (e) => {
    const item = e.target.closest('.item');
    if (!item) return;

    const oid = item.dataset.oid;
    if (!oid) return;

    const gid = (history.state && history.state.gid) ? history.state.gid : null;
    window.openObjectDetail?.({ objectId: oid, from: 'gallery', gid });
  });
})();

// START DEFINE CONTROLS

// FAB bindings
const fabGroup   = document.getElementById('fab-group');
const fabCluster = document.getElementById('fab-cluster');
const fabUngroup = document.getElementById('fab-ungroup');
const fabZoomIn  = document.getElementById('fab-zoom-in');
const fabZoomOut = document.getElementById('fab-zoom-out');
const fabFitAll  = document.getElementById('fab-fit-all');

fabGroup?.addEventListener('click',  (e) => { e.preventDefault(); gridObject.groupObjects();   markActive('group'); refreshSlideInsVisibility();  });
fabCluster?.addEventListener('click',(e) => { e.preventDefault(); gridObject.clusterGroupedObjects(); markActive('cluster'); refreshSlideInsVisibility(); });
fabUngroup?.addEventListener('click',(e) => { e.preventDefault(); gridObject.ungroupObjects(); markActive('ungroup'); refreshSlideInsVisibility(); });
fabZoomIn?.addEventListener('click', (e) => { e.preventDefault(); gridObject.zoomIn(); });
fabZoomOut?.addEventListener('click',(e) => { e.preventDefault(); gridObject.zoomOut(); });
fabFitAll?.addEventListener('click', (e) => { e.preventDefault(); gridObject.fitAll(120); });

// Recalculate counters after any camera/state change
;[fabGroup, fabCluster, fabUngroup, fabZoomIn, fabZoomOut].forEach(btn => btn?.addEventListener('click', scheduleOffgridUpdate));

// Optional: highlight active mode button (purely visual)
function markActive(which) {
  [fabGroup, fabCluster, fabUngroup].forEach(btn => btn?.classList.remove('is-active'));
  if (which === 'group')   fabGroup?.classList.add('is-active');
  if (which === 'cluster') fabCluster?.classList.add('is-active');
  if (which === 'ungroup') fabUngroup?.classList.add('is-active');
}

document.getElementById('reset-grid')?.addEventListener('click', (e) => {
  e.preventDefault();
  gridObject.resetGrid();
});

// END DEFINE CONTROLS

// ===== Off-grid Debug Harness =====
window.OFFGRID = window.OFFGRID || {};
const OFFGRID = window.OFFGRID;
OFFGRID.debug = OFFGRID.debug || new URLSearchParams(location.search).has('debug');
OFFGRID.log = (...args) => { if (OFFGRID.debug) console.debug('[offgrid]', ...args); };
OFFGRID.table = (rows) => { if (OFFGRID.debug && rows?.length) console.table(rows); };
OFFGRID.version = 'offgrid-debug-2025-09-16-01';

OFFGRID.flash = (el, color = 'magenta') => {
  if (!el) return;
  el.classList.add('offgrid-highlight');
  el.style.setProperty('--offgrid-highlight-color', color);
  setTimeout(() => el.classList.remove('offgrid-highlight'), 900);
};

// quick helpers you can call from console
window.testOffgrid = (dir, tag=null) => flyToNearest?.(dir, tag);
window.scanOffgrid = (dir=null, tag=null) => {
  const out = __collectOffscreenCandidates({tag});
  OFFGRID.table(out.map(x => ({
    id: x.id, side: x.side, sep: Math.round(x.sep),
    dCenter: Math.round(x.dCenter),
    dxL: Math.round(x.dxL), dxR: Math.round(x.dxR), dyT: Math.round(x.dyT), dyB: Math.round(x.dyB)
  })));
  if (dir) OFFGRID.log('filtered', dir, out.filter(x => x.side === dir).map(x => x.id));
  return out;
};

// --- Off-grid counters (Top/Bottom/Left/Right) ---
const workspaceEl = document.getElementById('workspace');
const gridEl = document.getElementById('grid');
const counters = {
  top:    document.getElementById('offgrid-top'),
  bottom: document.getElementById('offgrid-bottom'),
  left:   document.getElementById('offgrid-left'),
  right:  document.getElementById('offgrid-right'),
};

function scheduleOffgridUpdate() {
  if (scheduleOffgridUpdate._raf) return;
  scheduleOffgridUpdate._raf = requestAnimationFrame(() => {
    scheduleOffgridUpdate._raf = null;
    updateOffgridCounters();
    // Keep offset in sync in case layout changed during pan/zoom flows
    updateRightCounterOffset();
  });
}

function updateOffgridCounters() {
  if (!workspaceEl || !gridEl) return;
  const vp = workspaceEl.getBoundingClientRect();
  const items = Array.from(gridEl.querySelectorAll('.object'));

  const data = {
    top: { total: 0, perTag: {} },
    bottom: { total: 0, perTag: {} },
    left: { total: 0, perTag: {} },
    right: { total: 0, perTag: {} },
  };
  //const selectedTags = Array.from((typeof activeTags !== 'undefined' ? activeTags : new Set()));
  let selectedTags = Array.from((typeof activeTags !== 'undefined' ? activeTags : new Set()));
  // Ignore tags currently disabled in the UI (defensive; clicks are already blocked)
  const disabledNow = new Set(
    Array.from(document.querySelectorAll('#tags-visible li.disabled,[aria-disabled="true"]'))
         .map(li => li.dataset.tag)
  );
  selectedTags = selectedTags.filter(t => !disabledNow.has(t));

  for (const el of items) {
    const r = el.getBoundingClientRect();
    // Skip if any overlap with viewport (i.e., at least partly visible)
    const overlaps = !(r.right <= vp.left || r.left >= vp.right || r.bottom <= vp.top || r.top >= vp.bottom);
    if (overlaps) continue;

    // Measure "how far outside" on each side and assign to the dominant side
    const dTop    = Math.max(vp.top    - r.bottom, 0);
    const dBottom = Math.max(r.top     - vp.bottom, 0);
    const dLeft   = Math.max(vp.left   - r.right, 0);
    const dRight  = Math.max(r.left    - vp.right, 0);
    let dir = 'top', maxD = dTop;
    if (dBottom > maxD) { dir = 'bottom'; maxD = dBottom; }
    if (dLeft   > maxD) { dir = 'left';   maxD = dLeft; }
    if (dRight  > maxD) { dir = 'right';  maxD = dRight; }

    data[dir].total++;
    if (selectedTags.length) {
      const tags = (el.dataset.tags || '').split(',').filter(Boolean);
      for (const t of selectedTags) {
        if (tags.includes(t)) data[dir].perTag[t] = (data[dir].perTag[t] || 0) + 1;
      }
    }
  }

  const render = (dir) => {
    const node = counters[dir];
    if (!node) return;
    const { total, perTag } = data[dir];
    const valueEl = node.querySelector('.value');
    if (valueEl) valueEl.textContent = String(total);

    // Clear previous breakdown (inside rot if present)
    const host = node.querySelector('.rot') || node;
    host.querySelector('.breakdown')?.remove();
    if (total === 0) {
      node.setAttribute('aria-hidden', 'true');
      return;
    }
    node.removeAttribute('aria-hidden');

    // Default: no breakdown → ensure class is off
    host.classList.remove('has-breakdown');

    if (selectedTags.length) {
      host.classList.add('has-breakdown');
      const wrap = document.createElement('span');
      wrap.className = 'breakdown';
    
      for (const t of selectedTags) {
        const n = perTag[t] || 0;
    
        // separator
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = ' / ';
        wrap.appendChild(sep);
    
        // ONE CLICKABLE SEGMENT per tag
        const seg = document.createElement('span');
        seg.className = 'offgrid-seg';
        seg.setAttribute('role', 'button');
        seg.tabIndex = 0;
        seg.dataset.dir = dir;
        seg.dataset.tag = t;
        seg.title = n > 0
          ? `Show nearest ${dir} item with tag “${t}”`
          : `No ${dir} items with tag “${t}”`;
        if (!n) seg.classList.add('is-zero');
    
        // number
        const cnt = document.createElement('span');
        cnt.className = 'tag-count';
        cnt.textContent = String(n);
        if (typeof tagColors !== 'undefined' && tagColors[t]) {
          cnt.style.color = tagColors[t];
        }
        seg.appendChild(cnt);
    
        // dot
        const dot = document.createElement('span');
        dot.className = 'tag-dot';
        dot.textContent = ' •';
        if (typeof tagColors !== 'undefined' && tagColors[t]) {
          dot.style.color = tagColors[t];
        }
        seg.appendChild(dot);
    
        wrap.appendChild(seg);
      }
      host.appendChild(wrap);

      const valueEl = node.querySelector('.value');
      if (valueEl) {
        valueEl.textContent = String(total);
        // make totals clickable
        valueEl.classList.add('offgrid-total');
        valueEl.dataset.dir = dir;
        valueEl.title = total > 0
          ? `Show nearest ${dir} item`
          : `No ${dir} items`;
      }
    }    
  };

  // right before render('top'), render('bottom'), ...
  OFFGRID.lastCounters = JSON.parse(JSON.stringify(data));
  OFFGRID.log('counters snapshot', OFFGRID.lastCounters);

  render('top'); render('bottom'); render('left'); render('right');

  // after render(...) calls
  // Attach once, outside of any render cycle
  (function bindOffgridDelegates(){
    const root = document.getElementById('workspace');
    if (!root || root._offgridDelegatesBound) return;
    root._offgridDelegatesBound = true;

    root.addEventListener('click', (e) => {
      const hit = e.target.closest('.offgrid-seg, .offgrid-total');
      if (!hit) return;
    
      const container = hit.closest('.count-invisible-objects');
      const dir = hit.dataset.dir || (container ? container.id.replace('offgrid-','') : null);
      const tag = hit.classList.contains('offgrid-seg') ? (hit.dataset.tag || null) : null;
    
      OFFGRID.log('CLICK', { dir, tag, el: hit });
    
      // show what counters think for that dir/tag
      const perDir = OFFGRID.lastCounters?.[dir];
      if (perDir) {
        const n = tag ? (perDir.perTag?.[tag] || 0) : perDir.total;
        OFFGRID.log('counters say', { dir, tag, count: n });
      } else {
        OFFGRID.log('no counter snapshot for', dir);
      }
    
      flyToNearest(dir, tag);
    });    

    // keyboard: Enter/Space on focused segments
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const hit = e.target.closest('.offgrid-seg, .offgrid-total');
      if (!hit) return;
      e.preventDefault();
      const container = hit.closest('.count-invisible-objects');
      const dir = hit.dataset.dir || (container ? container.id.replace('offgrid-','') : null);
      const tag = hit.classList.contains('offgrid-seg') ? hit.dataset.tag || null : null;
      if (dir) flyToNearest(dir, tag);
    });
  })();

}

// === Off-grid navigation helpers ===

function worldCenterForObject(obj) {
  const state = window.gridObject?.currentState || 'ungrouped';
  if (state === 'clustered' && obj.cluster_x != null && obj.cluster_y != null) {
    return { x: obj.cluster_x + obj.width / 2, y: obj.cluster_y + obj.height / 2 };
  }
  if ((state === 'grouped' || state === 'pre-cluster') && obj.group_x != null && obj.group_y != null) {
    return { x: obj.group_x + obj.width / 2, y: obj.group_y + obj.height / 2 };
  }

  // compute, then (optionally) log
  const x = obj.grid_x + obj.width / 2;
  const y = obj.grid_y + obj.height / 2;
  OFFGRID.log('world center for', obj.id, 'state=', window.gridObject?.currentState, { x, y });
  return { x, y };
}

function __collectOffscreenCandidates({ tag = null } = {}) {
  const workspaceEl = document.getElementById('workspace');
  const gridEl = document.getElementById('grid');
  if (!workspaceEl || !gridEl) return [];

  const vp = workspaceEl.getBoundingClientRect();
  const eps = 0.5;

  const vcx = (vp.left + vp.right) / 2;
  const vcy = (vp.top  + vp.bottom) / 2;

  const out = [];
  for (const el of gridEl.querySelectorAll('.object')) {
    const r = el.getBoundingClientRect();

    // fully outside?
    const fullyOff =
      (r.right <= vp.left + eps)  || // left
      (r.left  >= vp.right - eps) || // right
      (r.bottom<= vp.top  + eps)  || // top
      (r.top   >= vp.bottom - eps);  // bottom
    if (!fullyOff) continue;

    if (tag) {
      const tags = (el.dataset.tags || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!tags.includes(tag)) continue;
    }

    const dxL = vp.left - r.right;
    const dxR = r.left - vp.right;
    const dyT = vp.top  - r.bottom;
    const dyB = r.top  - vp.bottom;

    let side = 'left', sep = dxL;
    if (dxR > sep) { side = 'right'; sep = dxR; }
    if (dyT > sep) { side = 'top';   sep = dyT; }
    if (dyB > sep) { side = 'bottom'; sep = dyB; }

    const cx = (r.left + r.right) / 2;
    const cy = (r.top  + r.bottom) / 2;
    const dCenter = Math.hypot(cx - vcx, cy - vcy);

    out.push({ el, id: el.id, side, sep, dCenter, dxL, dxR, dyT, dyB, rect: r });
  }
  return out;
}

function findNearestOffscreen({ dir, tag = null }) {
  const workspaceEl = document.getElementById('workspace');
  const gridEl = document.getElementById('grid');
  if (!workspaceEl || !gridEl) return null;

  const vp = workspaceEl.getBoundingClientRect();
  let best = { el: null, d: Infinity };

  const items = Array.from(gridEl.querySelectorAll('.object'));
  for (const el of items) {
    const r = el.getBoundingClientRect();

    // must be fully off-screen
    const overlaps = !(r.right <= vp.left || r.left >= vp.right || r.bottom <= vp.top || r.top >= vp.bottom);
    if (overlaps) continue;

    // classify side exactly like the counters do
    const dTop    = Math.max(vp.top    - r.bottom, 0);
    const dBottom = Math.max(r.top     - vp.bottom, 0);
    const dLeft   = Math.max(vp.left   - r.right, 0);
    const dRight  = Math.max(r.left    - vp.right, 0);

    let side = 'top', maxD = dTop;
    if (dBottom > maxD) { side = 'bottom'; maxD = dBottom; }
    if (dLeft   > maxD) { side = 'left';   maxD = dLeft;   }
    if (dRight  > maxD) { side = 'right';  maxD = dRight;  }

    if (side !== dir) continue;

    if (tag) {
      const tags = (el.dataset.tags || '').split(',').map(s=>s.trim()).filter(Boolean);
      if (!tags.includes(tag)) continue;
    }

    // “nearest” = smallest distance to viewport center
    const cx = (r.left + r.right) / 2;
    const cy = (r.top  + r.bottom) / 2;
    const vcx = (vp.left + vp.right) / 2;
    const vcy = (vp.top  + vp.bottom) / 2;
    const d = Math.hypot(cx - vcx, cy - vcy);

    if (d < best.d) best = { el, d };
  }

  return best.el; // ← IMPORTANT: return the element (not id)
}

function flyToNearest(dir, tag = null) {
  // 0) sanity + debug
  const el = findNearestOffscreen({ dir, tag });
  if (!el) { console.debug('[offgrid] no target element', { dir, tag }); return; }

  const grid = document.getElementById('grid');
  const zoom = window.gridObject?.zoomLevel || 1;
  const left = parseFloat(grid?.style.left) || 0;
  const top  = parseFloat(grid?.style.top)  || 0;

  // 1) try to resolve the object from the data model
  const id  = el.id;
  const obj = window.gridObject?.objects?.find(o => o.id === id);

  let world;
  if (obj) {
    world = worldCenterForObject(obj);  // uses state-aware world coords
    console.debug('[offgrid] target via model', { id, state: window.gridObject?.currentState, world });
  } else {
    // 2) fallback: infer world coords from the DOM rect
    const r  = el.getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    const cy = (r.top  + r.bottom) / 2;
    world = { x: (cx - left) / zoom, y: (cy - top) / zoom };
    console.debug('[offgrid] model miss → using DOM fallback', { id, zoom, left, top, world });
  }

  // 3) center + clamp using Grid’s camera helpers (animated)
  const before = { x: left, y: top, zoom };
  window.gridObject.centerViewportOnWorldPoint(world.x, world.y, true);
  //window.gridObject.clampCameraToBounds(true);
  setTimeout(() => window.gridObject.clampCameraToBounds?.(true), 650);
  console.debug('[offgrid] camera', { before, after: { left: grid.style.left, top: grid.style.top, zoom } });

  // 4) optional: quick visual pulse on the target
  el.classList.add('focus-pulse');
  setTimeout(() => el.classList.remove('focus-pulse'), 600);
}

function summarizeRect(r) {
  return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
}

// Observe grid pan/zoom (style changes), viewport resize, and object visibility
const mo = new MutationObserver(scheduleOffgridUpdate);
if (gridEl) mo.observe(gridEl, { attributes: true, attributeFilter: ['style', 'class'] });
window.addEventListener('resize', scheduleOffgridUpdate);

// IntersectionObserver to react when items enter/leave
const io = new IntersectionObserver(() => scheduleOffgridUpdate(), { root: workspaceEl, threshold: 0 });
Array.from(gridEl.querySelectorAll('.object')).forEach(el => io.observe(el));

// Kick an initial paint
requestAnimationFrame(updateOffgridCounters);

// Keep the right badge offset aligned with the current slide-ins width
const slideInsEl = document.getElementById('slide-ins');

/*
function updateRightCounterOffset() {
  const w = slideInsEl ? Math.round(slideInsEl.getBoundingClientRect().width) : 0;
  workspaceEl?.style.setProperty('--slideins-width', `${w}px`);
}
*/
// Visible width of the slide-in (in px) → used by the grid's RIGHT counter only
function updateRightCounterOffset() {
  const ws = document.getElementById('workspace') || document.documentElement;
  const slideIns = document.getElementById('slide-ins');
  let visible = 0;

  if (slideIns) {
    const r = slideIns.getBoundingClientRect();
    // How much of the slide-in is currently on-screen (it sits on the right)
    visible = Math.max(0, Math.min(r.width, window.innerWidth - r.left));
  }

  // Expose as a CSS var the RIGHT counter can read
  ws.style.setProperty('--slideins-visible', `${Math.round(visible)}px`);
}

// On init and whenever #slide-ins resizes (open/close), update the CSS var
if (slideInsEl && 'ResizeObserver' in window) {
  const ro = new ResizeObserver(() => updateRightCounterOffset());
  ro.observe(slideInsEl);
  // initial set
  updateRightCounterOffset();
} else {
  // Fallback: update on window resize
  window.addEventListener('resize', updateRightCounterOffset);
  updateRightCounterOffset();
}


// START DRAG AND DROP
// END DRAG AND DROP

// START DOM LOADED

window.addEventListener('DOMContentLoaded', () => {
  setTagGroupPolicy('GLOBAL');       // 'GLOBAL' or 'SCOPED'
  setTagMode('AND');                 // 'AND' or 'OR'

  initSlideInTags();

  initSlideInAccordion('#discover-connections'); // reads data-section-mode="accordion"

  attachSecondaryAutoClose('#discover-connections');

  // Close secondary when any section is opened in this slide-in
  const dc = document.getElementById('discover-connections');
  dc?.addEventListener('slidein:sectionOpened', () => {
    closeMenuSecondary('#discover-connections');
  });

  renderThemesUI();

  // Remove active underline when the Themes section is closed
  const themesSection = document.querySelector('#discover-connections #themes-section')?.closest('.content-section');
  if (themesSection) {
    const ro = new MutationObserver(() => {
      if (!themesSection.classList.contains('is-open')) {
        clearThemesActiveState();
      }
    });
    ro.observe(themesSection, { attributes: true, attributeFilter: ['class'] });
  }
});

// END DOM LOADED

// START INIT WHEN DOM LOADED


// END INIT WHEN DOM LOADED

// START TAG SETUP

// ---- CONFIG: tag matching mode ----
// 'OR' (default) or 'AND'
// Mode config (defaults to OR). You can change at runtime via setTagMode('AND'|'OR').
// Tag mode config
const TAG_MODES = { OR: 'OR', AND: 'AND' };
let TAG_MODE = TAG_MODES.OR;   // default

const TAG_GROUP_POLICIES = { GLOBAL: 'GLOBAL', SCOPED: 'SCOPED' };
let TAG_GROUP_POLICY = TAG_GROUP_POLICIES.GLOBAL; // or 'SCOPED'
let activeTagGroupId = null; // used only in SCOPED policy

function setTagMode(mode) {
  TAG_MODE = (mode === TAG_MODES.AND) ? TAG_MODES.AND : TAG_MODES.OR;
  updateTagAvailability?.();
  updateObjectGlowsWithGradient?.();
  syncTagModeToggleUI?.();
}

function setTagGroupPolicy(policy) {
  TAG_GROUP_POLICY = (policy === TAG_GROUP_POLICIES.SCOPED) ? TAG_GROUP_POLICIES.SCOPED : TAG_GROUP_POLICIES.GLOBAL;
  updateTagAvailability?.();
}

function renderTagModeToggle(container) {
  if (!container || renderTagModeToggle._rendered) return;

  const wrap = document.createElement('div');
  wrap.className = 'tag-match-toggle';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Tag match mode');

  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = 'Match:';
  wrap.appendChild(label);

  const btnAny = document.createElement('button');
  btnAny.type = 'button'; btnAny.className = 'seg'; btnAny.textContent = 'Any'; btnAny.dataset.mode = 'OR';
  const btnAll = document.createElement('button');
  btnAll.type = 'button'; btnAll.className = 'seg'; btnAll.textContent = 'All'; btnAll.dataset.mode = 'AND';

  wrap.appendChild(btnAny);
  wrap.appendChild(btnAll);

  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (!b) return;
    setTagMode(b.dataset.mode);
  });

  container.appendChild(wrap);
  renderTagModeToggle._rendered = true;
  renderTagModeToggle._els = { btnAny, btnAll };
}
function syncTagModeToggleUI() {
  const els = renderTagModeToggle._els;
  if (!els) return;
  els.btnAny.classList.toggle('is-selected', TAG_MODE !== TAG_MODES.AND);
  els.btnAll.classList.toggle('is-selected', TAG_MODE === TAG_MODES.AND);
  els.btnAny.setAttribute('aria-pressed', TAG_MODE !== TAG_MODES.AND);
  els.btnAll.setAttribute('aria-pressed', TAG_MODE === TAG_MODES.AND);
}

// Build a fast lookup: tag -> objects that have it
const tagToObjects = new Map();
function buildTagIndex(objects) {
  tagToObjects.clear();
  for (const o of objects) {
    for (const t of o.tags) {
      if (!tagToObjects.has(t)) tagToObjects.set(t, []);
      tagToObjects.get(t).push(o);
    }
  }
}

// call once after `objects` are generated:
buildTagIndex(objects);

// Helper
function objectHasAllTags(objTags, requiredSet) {
  for (const t of requiredSet) if (!objTags.includes(t)) return false;
  return true;
}

function updateTagAvailability() {
  const ul = document.getElementById('tags-visible');
  if (!ul) return;

  const lis = [...ul.querySelectorAll('li')];

  const activeGroup = currentTagViewGroupId; // null = no group selected
  
  // 0) Group gating: if a group is selected, disable chips from other groups
  if (activeGroup) {
    lis.forEach(li => {
      const inGroup = (li.dataset.group === activeGroup);
      if (!inGroup) {
        li.classList.add('disabled');
        li.setAttribute('aria-disabled', 'true');
      } else {
        li.classList.remove('disabled');
        li.setAttribute('aria-disabled', 'false');
      }
    });
  }
  
  // 1) OR mode or no tag selection -> availability only depends on group gating (if any)
  if (TAG_MODE === TAG_MODES.OR || activeTags.size === 0) {
    if (!activeGroup) {
      // no gating: make sure everything is enabled
      lis.forEach(li => { li.classList.remove('disabled'); li.setAttribute('aria-disabled','false'); });
    }
    return;
  }

  // AND mode: grey out a candidate if no object contains (selected + candidate)
  const required = [...activeTags];
  lis.forEach(li => {
    // if already disabled by group gating, skip the expensive check
    if (li.classList.contains('disabled')) return;
    const tag = li.dataset.tag;
    const isActive = li.classList.contains('active');
    if (isActive) { li.classList.remove('disabled'); li.setAttribute('aria-disabled','false'); return; }

    // If SCOPED is locked to a different group, visible list is always the locked group anyway.
    const pool = tagToObjects.get(tag) || [];
    const ok = pool.some(o => objectHasAllTags(o.tags || [], new Set([...required, tag])));
    li.classList.toggle('disabled', !ok);
    li.setAttribute('aria-disabled', (!ok).toString());
  });
}

// Reseed selection from a detail-panel tag and keep UI in sync
function reseedTagsFromDetail(tag) {
  if (!tag) return;

  // Toggle semantics from detail views:
  // - If the clicked tag is the ONLY active tag, clear selection (unselect).
  // - Otherwise, replace selection with the clicked tag.
  const wasSoleActive = activeTags.size === 1 && activeTags.has(tag);
  if (wasSoleActive) {
    activeTags.clear();
    // clear SCOPED lock if present
    if (typeof activeTagGroupId !== 'undefined') activeTagGroupId = null;
  } else {
    activeTags.clear();
    activeTags.add(tag);
    const gid = tagToGroup.get(tag);
    // keep SCOPED lock consistent with the clicked tag's group
    if (typeof activeTagGroupId !== 'undefined') activeTagGroupId = gid || null;
    // If your policy scopes the visible group, switch the menu to this tag's group
    if (typeof TAG_GROUP_POLICIES !== 'undefined' && typeof TAG_GROUP_POLICY !== 'undefined') {
      if (TAG_GROUP_POLICY === TAG_GROUP_POLICIES.SCOPED && gid) {
        currentTagViewGroupId = gid;
      }
    }
  }

  // 3) Re-render the visible tag row and active group button
  if (typeof renderTagsForCurrentGroup === 'function') renderTagsForCurrentGroup();
  if (typeof markActiveGroupButton === 'function') markActiveGroupButton();

  // 4) Availability, glows, and counters
  if (typeof updateTagAvailability === 'function') updateTagAvailability();
  if (typeof updateObjectGlowsWithGradient === 'function') updateObjectGlowsWithGradient();
  if (typeof scheduleOffgridUpdate === 'function') scheduleOffgridUpdate();
  if (typeof renderSelectionBar === 'function') renderSelectionBar();
  syncDetailTagHighlights();
}
// expose for grid.js
window.reseedTagsFromDetail = reseedTagsFromDetail;

function updateObjectGlowsWithGradient() {
  const selected = [...activeTags];
  document.querySelectorAll(".object").forEach(div => {
    const tags = (div.dataset.tags || '').split(",").filter(Boolean);
    const glow = div.querySelector(".object-glow");
    if (!glow) return;

    let matches = false;
    if (selected.length === 0) {
      matches = false;
    } else if (TAG_MODE === TAG_MODES.OR) {
      matches = tags.some(t => activeTags.has(t));
    } else {
      matches = selected.every(t => tags.includes(t));
    }

    if (!matches) {
      glow.style.background = "transparent";
    } else {
      const colors = (TAG_MODE === TAG_MODES.OR)
        ? tags.filter(t => activeTags.has(t)).map(t => tagColors[t])
        : selected.map(t => tagColors[t]);
      glow.style.background = `linear-gradient(to bottom, ${colors.join(", ")})`;
    }
  });
}

function initSlideInTags() {
  const section = document.querySelector('#discover-connections .section-content');
  if (!section) return;

  section.innerHTML = '';

  // 1) Visible tags (single group at a time)
  const ul = document.createElement('ul');
  ul.className = 'tags';
  ul.id = 'tags-visible';
  section.appendChild(ul);

  // Tag clicks (delegated)
  ul.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li || !li.dataset.tag) return;
    // If this chip is disabled, ignore the click entirely
    if (li.classList.contains('disabled') || li.getAttribute('aria-disabled') === 'true') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const tag = li.dataset.tag;
    const color = tagColors[tag];

    // In SCOPED policy: lock to the group of the first selection
    if (TAG_GROUP_POLICY === TAG_GROUP_POLICIES.SCOPED) {
      const tagGroup = li.dataset.group;
      if (!li.classList.contains('active')) {
        // if switching to a different group than the locked one → reset
        if (activeTagGroupId && tagGroup !== activeTagGroupId) {
          clearAllTagSelectionsUI();
          activeTags.clear();
          activeTagGroupId = null;
        }
      }
    }

    // Toggle selection
    if (activeTags.has(tag)) {
      activeTags.delete(tag);
      li.classList.remove('active');
      li.style.borderColor = '#000';
      li.style.color = '';
      li.style.boxShadow = '';
    } else {
      activeTags.add(tag);
      li.classList.add('active');
      li.style.borderColor = color;
      li.style.color = color;
      li.style.boxShadow = `${color}66 0 0 8px`;
      // Set lock on first selection in SCOPED
      if (TAG_GROUP_POLICY === TAG_GROUP_POLICIES.SCOPED) {
        activeTagGroupId = li.dataset.group;
      }
    }

    // Update off-grid counters for any tag change
    scheduleOffgridUpdate();
    updateTagAvailability();
    updateObjectGlowsWithGradient();
    renderSelectionBar();

    // If we are in ad-hoc gallery, live-refresh the items
    if (typeof window.refreshAdhocGalleryFromTags === 'function') {
      window.refreshAdhocGalleryFromTags();
    }

    syncDetailTagHighlights();
  });

  // 2) Group switcher (buttons shown under the tags)
  const switcher = document.createElement('div');
  switcher.className = 'tag-group-switch';
  TAG_GROUPS.forEach(g => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'group-btn';
    b.dataset.groupId = g.id;
    b.textContent = g.label;
    switcher.appendChild(b);
  });
  section.appendChild(switcher);

  // Switcher clicks (toggle): click a group to restrict to that group; click again to clear
  switcher.addEventListener('click', (e) => {
    const btn = e.target.closest('.group-btn');
    if (!btn) return;
    const gid = btn.dataset.groupId;
    if (!gid) return;
    
    const wasSelected = currentTagViewGroupId === gid;
    if (wasSelected) {
      // Clear selection: all tags clickable; default match = All
      currentTagViewGroupId = null;
      setTagMode('AND');
      // keep current activeTags as-is
    } else {
      // Select this group: non-member tags disabled; default match = Any
      currentTagViewGroupId = gid;
      setTagMode('OR');
      // Remove any active tags that do not belong to this group (avoid “active but disabled”)
      [...activeTags].forEach(t => { if (tagToGroup.get(t) !== gid) activeTags.delete(t); });
    }
    
    // Refresh UI
    renderTagsForCurrentGroup();   // now renders all tags; availability applies gating
    markActiveGroupButton();       // highlight selected group (or none)
    updateObjectGlowsWithGradient();
    scheduleOffgridUpdate?.();
    renderSelectionBar?.();
    syncDetailTagHighlights();
  });

  // 3) Match toggle (last)
  renderTagModeToggle(section);
  syncTagModeToggleUI();

  // Initial paint
  renderTagsForCurrentGroup();
  markActiveGroupButton();
  updateTagAvailability();
}

// Sync .active styling of tag pills inside detail cards with global activeTags
function syncDetailTagHighlights() {
  const active = window.activeTags || new Set();
  const colors = window.tagColors || {};

  // Select any tag chip rendered in detail cards (works whether they use data-tag or innerText)
  const candidates = document.querySelectorAll(
    '.detail-card [data-tag], .detail-tags [data-tag], .detail-card .tag, .detail-tags .tag'
  );

  candidates.forEach(el => {
    // prefer data-tag; fallback to text
    const tag = (el.dataset?.tag || el.textContent || '').trim();
    if (!tag) return;

    const isActive = active.has(tag);
    el.classList.toggle('active', isActive);

    // Apply the same color treatment you use elsewhere
    const c = colors[tag];
    if (isActive && c) {
      el.style.borderColor = c;
      el.style.color = c;
      el.style.boxShadow = `${c}66 0 0 8px`;
    } else {
      el.style.removeProperty('border-color');
      el.style.removeProperty('color');
      el.style.removeProperty('box-shadow');
    }
  });
}

function openMenuSecondary(slideInSelector, { title, paragraphs }) {
  const host  = document.querySelector(slideInSelector);
  const panel = document.querySelector(`${slideInSelector} .secondary-pane`);
  if (!host || !panel) return;

  host.classList.add('expanded');        // ensure the slide-in is open
  host.classList.add('secondary-open');  // widen to include secondary

  panel.setAttribute('aria-hidden', 'false');
  panel.innerHTML = `
    <h3>${title}</h3>
    ${paragraphs.map(p => `<p>${p}</p>`).join('')}
  `;
}

function closeMenuSecondary(slideInSelector) {
  const host  = document.querySelector(slideInSelector);
  const panel = document.querySelector(`${slideInSelector} .secondary-pane`);
  if (!host || !panel) return;

  host.classList.remove('secondary-open');
  panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML = '';
}

function attachSecondaryAutoClose(slideInSelector) {
  const host = document.querySelector(slideInSelector);
  if (!host) return;

  const mo = new MutationObserver((mutations, obs) => {
    const removedExpanded =
      !host.classList.contains('expanded') &&
      mutations.some(m => m.attributeName === 'class' &&
                          m.oldValue && m.oldValue.includes('expanded'));

    if (removedExpanded) {
      // Prevent re-entrancy while we mutate classes/attributes
      obs.disconnect();
      closeMenuSecondary(slideInSelector);
      // Re-arm after the current frame
      requestAnimationFrame(() => {
        obs.observe(host, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
      });
    }
  });

  mo.observe(host, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
}

function initSlideInAccordion(slideInSelector, opts = {}) {
  const root = document.querySelector(slideInSelector);
  if (!root) return;

  // Resolve mode: html data-attr > opts > default
  const mode = (root.dataset.sectionMode || opts.mode || 'static').toLowerCase();
  if (mode === 'static') return; // no collapsing for this slide-in

  const singleOpen = (mode === 'accordion');
  const sections = Array.from(root.querySelectorAll('.content-section'));
  if (!sections.length) return;

  // Mark collapsible and set ARIA on headers
  const observers = new WeakMap();

  function measureOpenHeight(sec) {
    const content = sec.querySelector('.section-content');
    if (!content) return;
    // Set to actual content height so CSS transition has a pixel target
    content.style.maxHeight = content.scrollHeight + 'px';
  }

  function openSection(sec, focusHeader = false) {
    if (sec.classList.contains('is-open')) return;

    if (singleOpen) {
      sections.forEach(s => { if (s !== sec) closeSection(s); });
    }
    sec.classList.add('is-open');

    // NEW: notify the slide-in that a section opened
    root.dispatchEvent(new CustomEvent('slidein:sectionOpened', { detail: { section: sec } }));

    const header = sec.querySelector('.section-header, h3');
    const content = sec.querySelector('.section-content');
    header?.setAttribute('aria-expanded', 'true');

    // Prepare animation target
    measureOpenHeight(sec);

    // Keep height in sync as content changes
    if (content && !observers.get(content) && 'ResizeObserver' in window) {
      const ro = new ResizeObserver(() => {
        if (sec.classList.contains('is-open')) {
          content.style.maxHeight = content.scrollHeight + 'px';
        }
      });
      ro.observe(content);
      observers.set(content, ro);
    }

    if (focusHeader && header) header.focus();
  }

  function closeSection(sec) {
    if (!sec.classList.contains('is-open')) return;
    const header = sec.querySelector('.section-header, h3');
    const content = sec.querySelector('.section-content');
    header?.setAttribute('aria-expanded', 'false');

    // Lock to current height first, then animate to 0
    if (content) {
      content.style.maxHeight = content.scrollHeight + 'px';
      requestAnimationFrame(() => { content.style.maxHeight = '0px'; });
    }
    sec.classList.remove('is-open');
  }

  function toggleSection(sec) {
    if (sec.classList.contains('is-open')) closeSection(sec);
    else openSection(sec);
  }

  // Make headers interactive
  sections.forEach((sec, idx) => {
    sec.classList.add('collapsible');
    const header = sec.querySelector('.section-header, h3');
    if (!header) return;
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');

    header.addEventListener('click', () => toggleSection(sec));
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection(sec); }
      if (e.key === 'ArrowDown') { e.preventDefault(); openNext(idx); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); openPrev(idx); }
    });
  });

  function openNext(i){ const s = sections[i+1]; if (s) openSection(s, true); }
  function openPrev(i){ const s = sections[i-1]; if (s) openSection(s, true); }

  // Initial state: open the first; others closed
  openSection(sections[0]);
  sections.slice(1).forEach(closeSection);

  // Public API (optional)
  root._accordion = { openSection, closeSection, toggleSection };
}  

function renderThemesUI() {
  const host = document.getElementById('themes-section');
  if (!host) return;

  host.innerHTML = `
    <ul class="themes-list">
      ${THEMES.map(t => `
        <li class="theme-item" data-tid="${t.id}">
          <button type="button" class="theme-link">
            <span class="theme-icon" aria-hidden="true">?</span>
            <span class="theme-label">${t.title}</span>
          </button>
        </li>
      `).join('')}
    </ul>
  `;

  // Click → mark active and open secondary content
  host.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-link');
    if (!btn) return;

    const li = btn.closest('.theme-item');
    const tid = li.dataset.tid;
    const theme = THEMES.find(x => x.id === tid);
    if (!theme) return;

    // switch active state to this row
    host.querySelectorAll('.theme-item.active').forEach(n => n.classList.remove('active'));
    li.classList.add('active');

    openMenuSecondary('#discover-connections', {
      title: theme.title,
      paragraphs: theme.paragraphs
    });
  });
}

function clearThemesActiveState() {
  const list = document.querySelector('#themes-section .themes-list');
  if (!list) return;
  list.querySelectorAll('.theme-item.active').forEach(n => n.classList.remove('active'));
}

function renderTagsForCurrentGroup() {
  // Renders ALL tags from ALL groups. Group selection is enforced via disabled state.
  const ul = document.getElementById('tags-visible');
  if (!ul) return;
  ul.innerHTML = '';

  TAG_GROUPS.forEach(group => {
    group.tags.forEach(tag => {
      const li = document.createElement('li');
      li.dataset.tag = tag;
      li.dataset.group = group.id;
      li.textContent = tag;

      if (activeTags.has(tag)) {
        const color = tagColors[tag];
        li.classList.add('active');
        li.style.borderColor = color;
        li.style.color = color;
        li.style.boxShadow = `${color}66 0 0 8px`;
      }
      ul.appendChild(li);
    });
  });
  // After (re)render, enforce availability rules (AND logic  group gating)
  updateTagAvailability();
}

function markActiveGroupButton() {
  document
    .querySelectorAll('.tag-group-switch .group-btn')
    .forEach(b => b.classList.toggle('is-active', b.dataset.groupId === currentTagViewGroupId));
}

function clearAllTagSelectionsUI() {
  document.querySelectorAll('#discover-connections .tags li.active').forEach(n => {
    n.classList.remove('active');
    n.style.borderColor = '#000';
    n.style.color = '';
    n.style.boxShadow = '';
  });
}


// --- Slide-ins: expand/collapse ---
function initSlideIns() {
  const container = document.getElementById('slide-ins');
  if (!container) return;

  // Prevent duplicate listeners
  if (container.dataset.inited === '1') return;
  container.dataset.inited = '1';

  //container.classList.add('visible');

  container.addEventListener('click', (e) => {
    const wrap = e.target.closest('.slide-in');
    if (!wrap) return;

    if (e.target.matches('.vertical-text')) {
      document.querySelectorAll('#slide-ins .slide-in').forEach(el => {
        if (el === wrap) {
          el.classList.add('expanded');
          el.querySelector('.vertical-content')?.classList.add('visible');
          el.querySelector('.close-btn').textContent = '×';
        } else {
          el.classList.remove('expanded', 'secondary-open'); // collapse others + secondary
          el.querySelector('.vertical-content')?.classList.remove('visible');
          const b = el.querySelector('.close-btn');
          if (b) b.textContent = '→';
        }
      });
    }

    if (e.target.matches('.close-btn')) {
      // stop other click handlers from reacting to the same click
      e.stopPropagation();

      wrap.classList.remove('expanded', 'secondary-open');

      clearThemesActiveState();
      
      wrap.querySelector('.vertical-content')?.classList.remove('visible');
      e.target.textContent = '←';

      // also hide secondary, just in case
      const panel = wrap.querySelector('.secondary-pane');
      if (panel) {
        panel.setAttribute('aria-hidden', 'true');
        panel.innerHTML = '';
      }
    }
  });
}

// END TAG SETUP

// --- Full-screen overlay menu (burger) ---
function initOverlayMenu() {
  // Works with: <button id="menu-button" class="menu-trigger">…</button>
  // …or legacy: <img id="burger-btn" …>
  const trigger =
    document.getElementById('menu-button') ||
    document.querySelector('.menu-trigger') ||
    document.getElementById('burger-btn');

  const overlay  = document.getElementById('overlay-menu');
  const closeBtn = document.getElementById('overlay-close');
  if (!overlay) return; // nothing to do

  const mainItems = overlay.querySelectorAll('.menu-item');
  const subMenu   = document.getElementById('sub-menu');

  const subItemsMap = {
    viralatmospheres: ['Blah','Blub'],
    about:            ['The Research Project','Summer School','The Book'],
    projects:         ['Project One','Project Two','Project Three'],
    team:             ['Member One','Member Two','Member Three']
  };

  function setActiveMenu(target){
    mainItems.forEach(i => i.classList.remove('active'));
    overlay.querySelector(`.menu-item[data-target="${target}"]`)?.classList.add('active');

    subMenu.innerHTML = '';
    (subItemsMap[target] || []).forEach(text => {
      const div = document.createElement('div');
      div.className = 'sub-item';
      div.textContent = text;
      div.addEventListener('click', () => {
        subMenu.querySelectorAll('.sub-item').forEach(i => i.classList.remove('active'));
        div.classList.add('active');
      });
      subMenu.appendChild(div);
    });
  }

  const openOverlay = (e) => {
    e?.preventDefault();
    overlay.classList.add('active');
    setActiveMenu('viralatmospheres');      // default section
    closeBtn?.focus?.();                    // accessibility nicety
  };

  const closeOverlay = (e) => {
    e?.preventDefault();
    overlay.classList.remove('active');
  };

  // Open/close bindings
  trigger?.addEventListener('click', openOverlay);
  // Keyboard open on Enter/Space for the button
  trigger?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') openOverlay(e);
  });

  closeBtn?.addEventListener('click', closeOverlay);

  // Click outside (backdrop) closes
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeOverlay(e);
  });

  // ESC closes
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeOverlay(e);
  });

  // Main items switch the active submenu
  mainItems.forEach(i => i.addEventListener('click', () => setActiveMenu(i.dataset.target)));
}

// Run once DOM is ready (keep your existing DOMContentLoaded handlers)
document.addEventListener('DOMContentLoaded', () => {
  initSlideIns();
  initOverlayMenu();
  refreshSlideInsVisibility();

  updateRightCounterOffset();

  const slideIns = document.getElementById('slide-ins');
  if (slideIns) {
    ['transitionrun','transitionstart','transitionend'].forEach(evt => {
      slideIns.addEventListener(evt, (e) => {
        if (e.propertyName === 'transform' || !e.propertyName) {
          requestAnimationFrame(updateRightCounterOffset);
        }
      });
    });
  }
  window.addEventListener('resize', updateRightCounterOffset);
});

function applyHeaderOffset() {
  const header = document.querySelector('header');
  if (!header) return;
  const h = Math.ceil(header.getBoundingClientRect().height); // includes borders
  document.documentElement.style.setProperty('--header-h', `${h}px`);

  // If the grid is already mounted, make sure the camera is still in legal bounds
  if (window.gridObject?.clampCameraToBounds) {
    window.gridObject.clampCameraToBounds(true);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  applyHeaderOffset();

  // Update on window resize
  window.addEventListener('resize', applyHeaderOffset);

  // Update when the header’s size changes (fonts, dynamic content, etc.)
  const header = document.querySelector('header');
  if (header && 'ResizeObserver' in window) {
    const ro = new ResizeObserver(applyHeaderOffset);
    ro.observe(header);
  }
});

function objectsMatchingCurrentFilter() {
  const all = window.gridObject?.objects || [];
  const tags = [...(window.activeTags || [])];
  const mode = (window.TAG_MODE || 'OR').toUpperCase();

  // Respect tag scoping if enabled
  let candidates = all;
  // 🔧 FIX: normalize group ids so "s42" and 42 match
  if (window.TAG_GROUP_POLICY === 'SCOPED' && window.activeTagGroupId != null) {
    const normalize = v => String(v).replace(/^s/i, ''); // strip leading 's'
    const gid = normalize(window.activeTagGroupId);
    candidates = candidates.filter(o => normalize(o.groupId) === gid);
  }

  if (tags.length === 0) return candidates;

  return candidates.filter(o => {
    const own = new Set(o.tags || []);
    return (mode === 'AND')
      ? tags.every(t => own.has(t))
      : tags.some(t => own.has(t));
  });
}

// ==== Header-left dynamic copy (centralised) ====
const HEADER_COPY = {
  home: 'Home',
  connections: 'Make new connections',
  research: (loc) => `Research project in ${loc || '—'}`
};

// Expose the setter in case you want to call it directly
function setHeaderLeft(mode, ctx = {}) {
  const el = document.getElementById('header-left');
  if (!el) return;

  let text = '';
  switch (mode) {
    case 'home':         text = HEADER_COPY.home; break;
    case 'connections':  text = HEADER_COPY.connections; break;
    case 'research':     text = HEADER_COPY.research(ctx.location); break;
    default:             text = ''; break;
  }

  HeaderTyper.type(el, text, {
    // tweak if you want a slower/faster feel
    minDelay: 14,
    maxDelay: 32,
    punctPause: 160,
    caret: true
  });
}
window.setHeaderLeft = setHeaderLeft;

// Single place that decides what the header should show right now
function refreshHeaderLeftFromState() {
  const body = document.body;
  const grid = window.gridObject; 

  // Object detail (full page) or Group Gallery → "Research project in <location>"
  if (body.classList.contains('in-group-gallery')) {
    const gid = body.dataset.currentGroupId;
    // GROUP_LABELS[gid] is already built from your group metadata
    // see where you computed it from groupMetaById[...] .location
    // (GROUP_LABELS creation is in your script already). :contentReference[oaicite:0]{index=0}
    const loc = gid
    ? (window.groupMetaById?.[gid]?.location || window.GROUP_LABELS?.[gid] || '')
    : '';
    return setHeaderLeft('research', { location: loc });
  }

  if (body.classList.contains('in-detail-page')) {
    // set on open detail (see below)
    const obj = window._lastDetailObject || null;
    const loc = obj?.groupLocation || '';
    // objects carry groupLocation already when created. :contentReference[oaicite:1]{index=1}
    return setHeaderLeft('research', { location: loc });
  }

  // Adhoc (custom) gallery → “Make new connections”
  if (body.classList.contains('in-adhoc-gallery')) {
    return setHeaderLeft('connections');
  }

  // Grid states
  const state = grid?.currentState; // 'grouped' | 'clustered' | 'ungrouped' | 'pre-cluster'
  if (state === 'grouped')      return setHeaderLeft('home');
  if (state === 'clustered' || state === 'ungrouped' || state === 'pre-cluster') {
    return setHeaderLeft('connections');
  }

  // Fallback
  setHeaderLeft('home');
}
window.refreshHeaderLeftFromState = refreshHeaderLeftFromState;

// Fire a single custom event whenever the view changes.
// We hook header updates to this event.
function dispatchViewChange() {
  document.dispatchEvent(new CustomEvent('app:viewchange', {
    detail: {
      bodyClasses: [...document.body.classList],
      gridState: window.gridObject?.currentState || null,
      currentGroupId: document.body.dataset.currentGroupId || null
    }
  }));
}
document.addEventListener('app:viewchange', refreshHeaderLeftFromState);

// Patch grid mode-switch so the header updates automatically
function wireHeaderToGrid() {
  const g = window.gridObject;
  if (!g || g.__headerWired) return;
  g.__headerWired = true;

  const _group   = g.groupObjects?.bind(g);
  const _cluster = g.clusterGroupedObjects?.bind(g);
  const _ungroup = g.ungroupObjects?.bind(g);

  if (_group) {
    g.groupObjects = function(...args) {
      const out = _group(...args);
      setTimeout(dispatchViewChange, 0);
      return out;
    };
  }
  if (_cluster) {
    g.clusterGroupedObjects = function(...args) {
      const out = _cluster(...args);
      setTimeout(dispatchViewChange, 0);
      return out;
    };
  }
  if (_ungroup) {
    g.ungroupObjects = function(...args) {
      const out = _ungroup(...args);
      setTimeout(dispatchViewChange, 0);
      return out;
    };
  }
}

// Call this *once* after grid is created (see next step)
window.__wireHeaderToGrid = wireHeaderToGrid;
window.__dispatchViewChange = dispatchViewChange;

// ==== Header-left typewriter (cancelable) ====
const HeaderTyper = (() => {
  let token = 0;

  const defaults = {
    minDelay: 12,     // ms between chars
    maxDelay: 30,
    punctPause: 180,  // extra pause after , . ; : ! ?
    caret: true
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand  = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

  async function type(el, text, opts = {}) {
    if (!el) return;
    const o = { ...defaults, ...opts };

    // Cancel any previous typing
    const my = ++token;

    // Respect reduced-motion
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduced) {
      el.classList.remove('typing');
      el.textContent = text;
      return;
    }

    el.classList.toggle('typing', !!o.caret);

    // If text is identical, avoid retyping
    if (el.textContent === text) {
      el.classList.remove('typing');
      return;
    }

    el.textContent = '';
    const letters = Array.from(String(text)); // handles emoji / surrogate pairs

    for (let i = 0; i < letters.length; i++) {
      if (my !== token) return; // canceled by a newer call
      el.textContent += letters[i];

      let d = rand(o.minDelay, o.maxDelay);
      if (/[.,;:!?]/.test(letters[i])) d += o.punctPause;
      await sleep(d);
    }

    if (my !== token) return;
    el.classList.remove('typing');
  }

  function cancel() { token++; }

  return { type, cancel };
})();

// === Selected Tags Bottom Bar ===
function renderSelectionBar() {
  const bar  = document.getElementById('selection-bar');
  const list = document.getElementById('selected-tags-list');
  const ws   = document.getElementById('workspace');
  if (!bar || !list || !ws) return;

  // --- derive tags array robustly (supports Set or Array) ---
  const raw = window.activeTags;
  const tags = Array.isArray(raw) ? raw
            : (raw instanceof Set) ? [...raw]
            : [];

  // Always clear existing content first
  list.innerHTML = '';

  let actions = bar.querySelector('.sb-actions');
  if (actions) actions.innerHTML = '';

  // Hide the bar while ANY gallery is open
  if (document.body.classList.contains('in-group-gallery')) {
    bar.classList.remove('show');
    ws.classList.remove('has-selection-bar');
    return;
  }

  // No tags selected → hide the bar and ensure no stale UI remains
  if (tags.length === 0) {
    bar.classList.remove('show');
    ws.classList.remove('has-selection-bar');
    // Also remove the actions node altogether (optional, keeps DOM clean)
    if (actions) actions.remove();
    return;
  }

  // If we are currently viewing the ad-hoc gallery, live-refresh it
  if (document.getElementById('group-gallery')?.classList.contains('active')) {
    // history.state.adhoc or the body class identifies ad-hoc mode
    if ((history.state && history.state.adhoc) || document.body.classList.contains('in-adhoc-gallery')) {
      window.refreshAdhocGalleryFromTags?.(tags);
    }
  }

  // --- Create a pill for each selected tag (center area) ---
  for (const tag of tags) {
    const li = document.createElement('li');
    li.dataset.tag = tag;
    li.innerHTML = `${tag} <span class="x" aria-hidden="true">×</span>`;
    const color = window.tagColors?.[tag];
    if (color) {
      li.classList.add('active');
      li.style.borderColor = color;
      li.style.color = color;
      li.style.boxShadow = `${color}66 0 0 8px`;
    }
    list.appendChild(li);
  }

  // --- Right-side actions (Create new gallery) ---
  actions = bar.querySelector('.sb-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'sb-actions';
    bar.appendChild(actions);
  }
  actions.innerHTML = '';

  if (!document.body.classList.contains('in-adhoc-gallery')) {
    const btn = document.createElement('button');           // keep a <button>, not an <a>
    btn.type = 'button';
    btn.className = 'button btn-create-gallery';            // reuse gallery’s .button styles
    btn.innerHTML = '<span class="text">Create new gallery</span><span class="icon">→</span>';  
    btn.addEventListener('click', () => {
      const objs = objectsMatchingCurrentFilter();
      window.openTagsGallery(objs, tags);
    });
    actions.appendChild(btn);
  }

  // Finally, show the bar
  bar.classList.add('show');
  ws.classList.add('has-selection-bar');
}

window.renderSelectionBar = renderSelectionBar;

function initSelectionBar() {
  const bar = document.getElementById('selection-bar');
  if (!bar || bar.dataset.inited === '1') return;
  bar.dataset.inited = '1';

  // Clicking a pill removes that tag from the selection
  bar.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-tag]');
    if (!li) return;
    const tag = li.dataset.tag;
    if (window.activeTags && activeTags.has(tag)) {
      activeTags.delete(tag);
      // keep the rest of the UI consistent
      if (typeof renderTagsForCurrentGroup === 'function') renderTagsForCurrentGroup();
      if (typeof updateTagAvailability === 'function') updateTagAvailability();
      if (typeof updateObjectGlowsWithGradient === 'function') updateObjectGlowsWithGradient();
      if (typeof scheduleOffgridUpdate === 'function') scheduleOffgridUpdate();
      renderSelectionBar();
    }
  });

  // First paint (empty)
  renderSelectionBar();
}

document.addEventListener('DOMContentLoaded', () => {
  // Initial sync (in case something is preselected)
  syncDetailTagHighlights();

  // Keep detail pills in sync when panels/cards are re-rendered
  const detailRoot =
    document.getElementById('right-side') ||
    document.getElementById('detail') ||
    document.body;

  const mo = new MutationObserver(() => {
    syncDetailTagHighlights();
  });
  mo.observe(detailRoot, { childList: true, subtree: true });
});


document.addEventListener('DOMContentLoaded', initSelectionBar);


// TODO: content type video
// TODO: integrate offsetX again
// TODO: dynamic random placement of groups within viewport
// TODO: fix problem with transition from ungrouped to group (viewport)
// TODO: reverse group ungroup logic
// TODO: add grid debug mode

// TODO: non repeating image placing (to be done)

// TODO: content type text (done)
// TODO: set boundaries for dragging (done)
// TODO: calculate amount of rows and cols without waste of space (done)
// TODO: dynamic random placement of group items (done)
// TODO: get back grid margins (done)
// TODO: canvas dragging (done)
// TODO: center grid view (done)
// TODO: animation from pile to unklinked, unlinked to pile (done)
// TODO: dynamic cell sizes (not for now)
// TODO: cell margins (done)
// TODO: add video, text, image (to be done)
