// Shared pixel-art system: three selectable companions, each a 24x28
// hand-written sprite with the full frame set (idle / bob / blink /
// sleep / work×2 / walk×2 / jump). Single-layer ink outline + flat
// fills, drawn on canvas with no image assets.

export type PetId = 'poka' | 'mikan' | 'puff'
export type FrameKey = 'I' | 'B' | 'BL' | 'ZZ' | 'WA' | 'WB' | 'KA' | 'KB' | 'JP'
export type Frames = Record<FrameKey, string[]>

export const PET_IDS: readonly PetId[] = ['poka', 'mikan', 'puff']

export const PAL: Record<string, string> = {
  o: '#4a4553', h: '#f6f7fc', H: '#dcdff0', s: '#ffe9dc', S: '#f2cdb9',
  e: '#3c3744', X: '#ffffff', w: '#ffffff', t: '#e8434e', T: '#b32832',
  k: '#9c6640', K: '#7d4e2c', b: '#ffb3ae', m: '#e8927c', l: '#39496b',
  g: '#8fd0ff', z: '#8fa3c8',
  f: '#f4a45c', F: '#d9803a', p: '#f2839b', u: '#4d6efa', c: '#e7edff',
}

function repl(rows: string[], edits: Record<number, string>): string[] {
  const c = rows.slice()
  for (const k in edits) c[+k] = edits[k]
  return c
}

export function drawPet(cv: HTMLCanvasElement, rows: string[]): void {
  const sc = cv.width / 24
  const x = cv.getContext('2d')
  if (!x) return
  x.clearRect(0, 0, cv.width, cv.height)
  for (let y = 0; y < rows.length; y++) {
    const r = rows[y]
    for (let i = 0; i < 24; i++) {
      const ch = r[i]
      if (ch === '.' || ch === undefined) continue
      x.fillStyle = PAL[ch] ?? '#f0f'
      x.fillRect(i * sc, y * sc, sc, sc)
    }
  }
}

// ── Poka: white long hair / white shirt + red tie / brown pleated skirt ─────
const POKA_BASE = [
  '........oooooooo........',
  '......oohhhhhhhhoo......',
  '.....ohhhhhhhhhhhho.....',
  '....ohhhhhhhhhhhhhho....',
  '...ohhhhhhhhhhhhhhhho...',
  '..ohhhhhhhhhhhhhhhhhho..',
  '..ohhhhhhhhhhhhhhhhhho..',
  '..ohhHhsssssssssshHhho..',
  '..ohhsssssssssssssshho..',
  '..ohsseXessssseXesshho..',
  '..ohsseeessssseeesshho..',
  '..ohsbsssssssssssbshho..',
  '..ohssssssmmssssssshho..',
  '...ohhsssssssssssshho...',
  '....ohhsssssssssshho....',
  '..ohho..osssso..ohho....',
  '..ohho.owwwwwwo.ohho....',
  '..ohhoowwwttwwwoohho....',
  '..ohHo.swwtTws..oHho....',
  '...oho.okkkkkko..oho....',
  '...oo.okkkkkkkko..oo....',
  '......okkkkkkkkko.......',
  '.....okKkKkKkKkKko......',
  '.....oKKKKKKKKKKKo......',
  '........ss....ss........',
  '........ss....ss........',
  '.......oss....sso.......',
  '.......ooo....ooo.......',
]
function pokaClosedEyes(rows: string[]): string[] {
  const c = rows.slice()
  c[9] = c[9].replace(/[eX]/g, 's')
  c[10] = c[10].replace(/e/g, 'S')
  return c
}
const POKA: Frames = {
  I: POKA_BASE,
  B: ['........................'].concat(POKA_BASE.slice(0, 16), POKA_BASE.slice(17)),
  BL: pokaClosedEyes(POKA_BASE),
  ZZ: repl(pokaClosedEyes(['........................'].concat(POKA_BASE.slice(0, 16), POKA_BASE.slice(17))), {
    1: '......oohhhhhhhhoo...z..',
    2: '.....ohhhhhhhhhhhho.z...',
    3: '....ohhhhhhhhhhhhhho..z.',
  }),
  WA: repl(POKA_BASE, { 19: '...oho.ollllllo..oho....' }),
  WB: repl(repl(POKA_BASE, { 19: '...oho.ollllllo..oho....' }), {
    18: '..ohHo..wwtTw...oHho....',
    16: '..ohho.owwwwwwo.ohho..g.',
  }),
  KA: repl(POKA_BASE, {
    24: '.......ss......ss.......', 25: '.......ss......ss.......',
    26: '......oss......sso......', 27: '......ooo......ooo......',
  }),
  KB: repl(POKA_BASE, {
    24: '.........ss..ss.........', 25: '.........ss..ss.........',
    26: '........oss..sso........', 27: '........ooo..ooo........',
  }),
  JP: repl(POKA_BASE, {
    24: '.........ss..ss.........', 25: '........oss..sso........',
    26: '........ooo..ooo........', 27: '........................',
  }),
}

// ── Mikan: orange tabby cat — ears, forehead stripes, white muzzle/chest ────
const CAT_BASE = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '.......oo......oo.......',
  '......ofpo....opfo......',
  '.....offfo....offfo.....',
  '....offffffffffffffo....',
  '....ofFffffFFfffFffo....',
  '....offeeffffffeeffo....',
  '....offeeffffffeeffo....',
  '....offffffppffffffo....',
  '....offffffmmffffffo....',
  '..ww.offffffffffffo.ww..',
  '.....ofbffffffffbfo.....',
  '......offffffffffo......',
  '......offffffffffo......',
  '.....offfwwwwwwfffo.....',
  '....offffwwwwwwffffo....',
  '....offffwwwwwwffffo....',
  '....offffwwwwwwffffo....',
  '.....offffwwwwffffo.....',
  '.....offwwwffwwwffo.....',
  '.....offwwwffwwwffo.....',
  '.....offwwwffwwwffo.....',
  '......owwwo.owwwo.......',
  '.......ooo...ooo........',
]
const CAT_EYES_CLOSED = {
  10: '....offffffffffffffo....',
  11: '....offffffffffffffo....',
}
const CAT_TUCKED = {
  23: '.....offffffffffffo.....',
  24: '.....offffffffffffo.....',
  25: '......offffffffffo......',
  26: '.......oofffffoo........',
  27: '........................',
}
const CAT: Frames = {
  I: CAT_BASE,
  B: ['........................'].concat(CAT_BASE.slice(0, 16), CAT_BASE.slice(17)),
  BL: repl(CAT_BASE, CAT_EYES_CLOSED),
  ZZ: repl(repl(CAT_BASE, { ...CAT_EYES_CLOSED, ...CAT_TUCKED }), {
    5: '.......oo......oo....z..',
    6: '......ofpo....opfo..z...',
    7: '.....offfo....offfo....z',
  }),
  WA: repl(CAT_BASE, {
    25: '.....ollllllllllllo.....',
    26: '......oooooooooooo......',
    27: '........................',
  }),
  WB: repl(CAT_BASE, {
    ...CAT_EYES_CLOSED,
    25: '.....ollllllllllllo.....',
    26: '......oooooooooooo......',
    27: '........................',
  }),
  KA: CAT_BASE,
  KB: repl(CAT_BASE, { 24: '.....offffffffffffo.....' }),
  JP: repl(CAT_BASE, CAT_TUCKED),
}

// ── Puff: DeepSeek-blue baby whale — top fluke, light belly, spout ──────────
const WHALE_BASE = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '.........oo..oo.........',
  '........ouuoouuo........',
  '..........ouo...........',
  '.......ouuuuuuuuo.......',
  '.....ouuuuuuuuuuuuo.....',
  '....ouuuuuuuuuuuuuuo....',
  '...ouuuuuuuuuuuuuuuuo...',
  '...ouuuuuuuuuuuuuuuuo...',
  '..ouuuuuuuuuuuuuuuuuuo..',
  '..ouueeuuuuuuuueeuuuuo..',
  '..ouueeuuuuuuuueeuuuuo..',
  '..obbuuuuuummuuuuuubbo..',
  '..ouuuuuuccccccuuuuuuo..',
  '..ouuuuuccccccccuuuuuo..',
  '..ouuuuuccccccccuuuuuo..',
  '..ouuuuuccccccccuuuuuo..',
  '..ouuuuuuccccccuuuuuuo..',
  '...ouuuuuuccccuuuuuuo...',
  '....ouuuuuuuccuuuuuuo....',
  '.....ouuuuuccuuuuuo.....',
  '.......ouuuccuuuo.......',
  '.........oooooo.........',
]
const WHALE_EYES_CLOSED = {
  15: '..ouuuuuuuuuuuuuuuuuuo..',
  16: '..ouuuuuuuuuuuuuuuuuuo..',
}
const WHALE: Frames = {
  I: WHALE_BASE,
  B: ['........................'].concat(WHALE_BASE.slice(0, 12), WHALE_BASE.slice(13)),
  BL: repl(WHALE_BASE, WHALE_EYES_CLOSED),
  ZZ: repl(WHALE_BASE, {
    ...WHALE_EYES_CLOSED,
    0: '...................z....',
    1: '..................z.....',
    2: '....................z...',
  }),
  WA: repl(WHALE_BASE, {
    6: '......olllllllllllo.....',
    7: '......olllllllllllo.....',
    8: '........................',
  }),
  WB: repl(WHALE_BASE, {
    ...WHALE_EYES_CLOSED,
    6: '......olllllllllllo.....',
    7: '......olllllllllllo.....',
    8: '........................',
  }),
  KA: WHALE_BASE,
  KB: repl(WHALE_BASE, { 5: '...........gg...........' }),
  JP: repl(WHALE_BASE, {
    ...WHALE_EYES_CLOSED,
    4: '...........gg...........',
    5: '..........gggg..........',
  }),
}

export const PET_ART: Record<PetId, Frames> = { poka: POKA, mikan: CAT, puff: WHALE }

// ── The egg: pre-hatch state. Sits quietly in the corner (never blocks
// the chat), wobbles now and then, and clicking it opens the companion
// picker. A plump 18x23 silhouette (matching the pets' footprint) with a
// white shine patch upper-left, gray-blue speckles and right-side shade
// for volume, a light-blue base tint, and one red crack low-center hint-
// ing at something alive inside. Single frame — wobble + gleam + glow
// are CSS animations on the container.
export const EGG_ROWS: string[] = [
  '........................',
  '........................',
  '........................',
  '.........oooooo.........',
  '.......occcccccco.......',
  '......occwwcccczco......',
  '.....occwwwwcccczco.....',
  '....occcwwwwcccczzco....',
  '...occccwwwwczccczco....',
  '...occcccwwczcccczco....',
  '..occccccccccccccczco...',
  '..occcccczcccccczczzco..',
  '..occcccccccczccccczzo..',
  '..occcccccccccczccczzo..',
  '..occczcccccccccccczzo..',
  '..occcczcccccccccczczo..',
  '..occccccccczccccczzzo..',
  '..occcccccccccczcccczzo.',
  '..occcccccccccTcccczco..',
  '...occcccccccccccczzo...',
  '...occcccccccccccczzo...',
  '....oggggggggggggzzo....',
  '.....oggggggggggzzo.....',
  '......oggggggggzzo......',
  '.......oggggggzzo.......',
  '.........oooooo.........',
  '........................',
  '........................',
]

export interface PetMeta {
  /** Display name shown in the picker and panel. */
  name: string
  /** One-line flavor text under the name in the picker. */
  tagline: string
  /** Extra ambient bubble lines unique to this companion. */
  idleLines: readonly string[]
}

export const PET_META: Record<PetId, PetMeta> = {
  poka: {
    name: '波卡',
    tagline: '白发红领带的元气少女，初代形象',
    idleLines: [],
  },
  mikan: {
    name: '橘丸',
    tagline: '额带虎斑的小橘猫，安静黏人',
    idleLines: ['喵？', '喵呜~', '悄悄说：我想吃小鱼干。'],
  },
  puff: {
    name: '蓝噗',
    tagline: 'DeepSeek 蓝的小鲸鱼，思考时喷水花',
    idleLines: ['噗~', '咕噜咕噜。', '今天水温刚刚好。'],
  },
}

// Row-width sanity: one warn in the console if any hand-counted row drifted.
for (const id of PET_IDS) {
  for (const [key, rows] of Object.entries(PET_ART[id])) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].length !== 24) {
        console.warn(`[dsh-pet-sprite] art width drift: ${id}.${key}[${i}] = ${rows[i].length}`)
      }
    }
  }
}
