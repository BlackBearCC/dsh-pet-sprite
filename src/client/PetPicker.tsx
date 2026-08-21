// Companion picker: hand-drawn comic style cards (single 2.5px ink
// outline, hard shadow, spring pop-in, halftone backdrop) for the three
// builtin companions plus the user's LLM-generated ones. Shown on first
// launch (no saved choice) and re-openable from the care panel. Each
// card previews the live sprite with a slow idle blink.

import { useEffect, useRef, useState, type FC } from 'react'
import { drawPet, PET_ART, PET_IDS, PET_META, type Frames } from './pet-art.ts'
import { downloadShareFile, framesFromRows, type CustomPet, type PetProfile } from './custom-pets.ts'
import { isCustomPetId } from '../pixel-format.ts'

interface Props {
  /** Currently active companion id (badge in the corner), null on first launch. */
  currentId: string | null
  /** User-generated companions from localStorage. */
  customPets: CustomPet[]
  /** Per-pet souls (persona + event lines), exported together with the sprite. */
  profiles: Record<string, PetProfile>
  onPick: (id: string) => void
  /** Dismiss without choosing (overlay click / × button). */
  onClose: () => void
  /**
   * LLM sprite generation (runs in ChatPet: wallet + storage live there).
   * Present only when a chat model is already picked — otherwise the care
   * panel's settings tab stays the only (guided) entry.
   */
  onGeneratePet?: (description: string) => Promise<{ ok: boolean; name?: string; error?: string }>
  /** Whether this would be the user's first custom pet (free). */
  firstGenerateFree?: boolean
}

/** One pickable card, builtin or custom — everything the card needs to draw. */
interface PickerPet {
  id: string
  name: string
  tagline: string
  frames: Frames
}

let pickerStyleInjected = false
function injectPickerStyles(): void {
  if (pickerStyleInjected) return
  pickerStyleInjected = true
  const s = document.createElement('style')
  s.textContent = `
.dsh-pet-sprite-picker{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background-color:rgba(74,69,83,.34);background-image:radial-gradient(rgba(255,255,255,.15) 1.2px,transparent 1.3px);background-size:11px 11px;pointer-events:auto;animation:dshPetSpritePickerIn .25s ease both;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
@keyframes dshPetSpritePickerIn{from{opacity:0}to{opacity:1}}
.dsh-pet-sprite-picker-panel{background:#fff;border:3px solid #4a4553;border-radius:20px;padding:24px 26px 22px;box-shadow:0 8px 0 rgba(0,0,0,.22);max-width:min(92vw,540px);max-height:86vh;overflow-y:auto;animation:dshPetSpritePickerPop .5s cubic-bezier(.2,1.7,.4,1) both;position:relative}
.dsh-pet-sprite-picker-x{position:absolute;top:9px;right:11px;width:26px;height:26px;border:2.5px solid #4a4553;border-radius:50%;background:#fff;color:#4a4553;font:900 15px/22px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;cursor:pointer;box-shadow:0 2px 0 rgba(0,0,0,.15);transition:transform .15s cubic-bezier(.2,1.5,.4,1)}
.dsh-pet-sprite-picker-x:hover{transform:rotate(90deg) scale(1.1);background:#ffe3e3}
@keyframes dshPetSpritePickerPop{from{opacity:0;transform:translateY(26px) scale(.84)}to{opacity:1;transform:translateY(0) scale(1)}}
.dsh-pet-sprite-picker-title{font-size:19px;font-weight:900;color:#4a4553;text-align:center;letter-spacing:.5px}
.dsh-pet-sprite-picker-sub{font-size:11.5px;font-weight:600;color:#9a95a5;text-align:center;margin:5px 0 16px}
.dsh-pet-sprite-picker-cards{display:flex;flex-wrap:wrap;gap:15px}
.dsh-pet-sprite-picker-card{flex:1 1 140px;min-width:0;background:#fff;border:2.5px solid #4a4553;border-radius:14px;padding:14px 8px 12px;cursor:pointer;box-shadow:0 4px 0 rgba(0,0,0,.16);transition:transform .18s cubic-bezier(.2,1.5,.4,1),box-shadow .18s;text-align:center;position:relative}
.dsh-pet-sprite-picker-card:hover{transform:translateY(-5px) rotate(-1.2deg);box-shadow:0 8px 0 rgba(0,0,0,.2)}
.dsh-pet-sprite-picker-card canvas{width:72px;height:84px;image-rendering:pixelated;display:block;margin:0 auto}
.dsh-pet-sprite-picker-card .nm{display:block;font-size:14px;font-weight:800;color:#4a4553;margin-top:8px}
.dsh-pet-sprite-picker-card .tg{display:block;font-size:10.5px;font-weight:600;color:#9a95a5;margin-top:3px;line-height:1.45}
.dsh-pet-sprite-picker-card.cur::before{content:'当前';position:absolute;top:-11px;right:10px;font-size:10px;font-weight:800;color:#4a4553;background:#ffd33d;border:2px solid #4a4553;border-radius:999px;padding:1px 8px;box-shadow:0 2px 0 rgba(0,0,0,.15)}
.dsh-pet-sprite-picker-card.picked{transform:scale(1.07) rotate(0deg);background:#fffbe8;box-shadow:0 8px 0 rgba(0,0,0,.2)}
.dsh-pet-sprite-picker-card.dim{opacity:.45;transform:scale(.96)}
.dsh-pet-sprite-picker-share{position:absolute;bottom:8px;right:8px;font-size:10px;font-weight:800;color:#4a4553;background:#ffd33d;border:2px solid #4a4553;border-radius:999px;padding:1px 8px;box-shadow:0 2px 0 rgba(0,0,0,.15);cursor:pointer;user-select:none}
.dsh-pet-sprite-picker-share:hover{background:#ffe27a;transform:scale(1.08)}
.dsh-pet-sprite-picker-share:active{transform:scale(.92)}
.dsh-pet-sprite-picker-card .tg{padding-bottom:18px}
.dsh-pet-sprite-picker-gen{margin-top:18px;border-top:2px dashed #e3e0ea;padding-top:14px}
.dsh-pet-sprite-picker-gen-open{display:block;width:100%;background:#fffbe8;border:2.5px solid #4a4553;border-radius:12px;padding:10px 12px;font:800 13px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#4a4553;cursor:pointer;box-shadow:0 3px 0 rgba(0,0,0,.14);transition:transform .15s cubic-bezier(.2,1.5,.4,1)}
.dsh-pet-sprite-picker-gen-open:hover{transform:translateY(-2px);background:#fff6cf}
.dsh-pet-sprite-picker-gen-row{display:flex;gap:8px;align-items:stretch}
.dsh-pet-sprite-picker-gen-row input{flex:1;min-width:0;border:2.5px solid #4a4553;border-radius:10px;padding:8px 10px;font:600 13px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:#fff}
.dsh-pet-sprite-picker-gen-row input:focus{outline:none;border-color:#4d6efa}
.dsh-pet-sprite-picker-gen-go{border:2.5px solid #4a4553;border-radius:10px;background:#4d6efa;color:#fff;font:800 13px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;padding:8px 16px;cursor:pointer;box-shadow:0 3px 0 rgba(0,0,0,.15);white-space:nowrap}
.dsh-pet-sprite-picker-gen-go:disabled{opacity:.5;cursor:default}
.dsh-pet-sprite-picker-gen-x{border:none;background:none;color:#9a95a5;font:700 12px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;cursor:pointer;white-space:nowrap}
.dsh-pet-sprite-picker-gen-err{color:#d64545;font:700 12px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;margin-top:7px}
.dsh-pet-sprite-picker-gen-note{color:#9a95a5;font:600 11px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;margin-top:7px}
@media (prefers-reduced-motion:reduce){.dsh-pet-sprite-picker-panel{animation-duration:.01s}.dsh-pet-sprite-picker-card{transition:none}}
`
  document.head.appendChild(s)
}

const PetCard: FC<{
  pet: PickerPet
  custom?: CustomPet // present on generated pets — enables the share button
  profile?: PetProfile // the custom pet's soul, rides along in the share file
  isCurrent: boolean
  state: 'idle' | 'picked' | 'dim'
  onPick: () => void
}> = ({ pet, custom, profile, isCurrent, state, onPick }) => {
  const ref = useRef<HTMLCanvasElement>(null)
  const [blinking, setBlinking] = useState(false)
  useEffect(() => {
    // slow idle preview: blink for ~150ms every 2.4-3.6s
    let blinkTimer: ReturnType<typeof setTimeout>
    const schedule = (): void => {
      blinkTimer = setTimeout(() => {
        setBlinking(true)
        setTimeout(() => setBlinking(false), 150)
        schedule()
      }, 2400 + Math.random() * 1200)
    }
    schedule()
    return () => clearTimeout(blinkTimer)
  }, [])
  useEffect(() => {
    const cv = ref.current
    if (cv) drawPet(cv, blinking ? pet.frames.BL : pet.frames.I)
  }, [pet, blinking])
  return (
    <button
      type="button"
      className={`dsh-pet-sprite-picker-card${isCurrent ? ' cur' : ''}${state !== 'idle' ? ` ${state}` : ''}`}
      onClick={onPick}
      style={{ fontFamily: 'inherit' }}
    >
      <canvas ref={ref} width={96} height={112} aria-hidden="true" />
      <span className="nm">{pet.name}</span>
      <span className="tg">{pet.tagline}</span>
      {custom !== undefined && (
        <span
          role="button"
          tabIndex={0}
          className="dsh-pet-sprite-picker-share"
          title="导出分享文件"
          // nested interactive element inside a <button> is invalid HTML and
          // would also pick the pet — stop the chain and download instead
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); downloadShareFile(custom, profile) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation()
              downloadShareFile(custom, profile)
            }
          }}
        >
          分享
        </span>
      )}
    </button>
  )
}

export const PetPicker: FC<Props> = ({ currentId, customPets, profiles, onPick, onClose, onGeneratePet, firstGenerateFree }) => {
  const [picked, setPicked] = useState<string | null>(null)
  useEffect(() => { injectPickerStyles() }, [])
  const [genOpen, setGenOpen] = useState(false)
  const [genDesc, setGenDesc] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const doGenerate = async (): Promise<void> => {
    const description = genDesc.trim()
    if (description.length === 0 || genBusy || onGeneratePet === undefined) return
    setGenBusy(true)
    setGenError(null)
    const r = await onGeneratePet(description)
    setGenBusy(false)
    if (r.ok) {
      setGenDesc('')
      // handleGeneratePet already switched to the newborn — just close
      onClose()
    } else {
      setGenError(r.error ?? '生成失败，再试一次。')
    }
  }

  const pets: PickerPet[] = [
    ...PET_IDS.map(id => ({
      id,
      name: PET_META[id].name,
      tagline: PET_META[id].tagline,
      frames: PET_ART[id],
    })),
    ...customPets.map(c => ({
      id: c.id,
      name: c.name,
      tagline: c.tagline.length > 0 ? c.tagline : '自定义伙伴',
      frames: framesFromRows(c.rows),
    })),
  ]

  const handlePick = (id: string): void => {
    if (picked) return
    setPicked(id)
    // let the picked-card pop land before unmounting the overlay
    setTimeout(() => onPick(id), 260)
  }

  return (
    <div
      className="dsh-pet-sprite-picker"
      role="dialog"
      aria-label="选择伙伴形象"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="dsh-pet-sprite-picker-panel">
        <button type="button" className="dsh-pet-sprite-picker-x" aria-label="关闭" onClick={onClose}>×</button>
        <div className="dsh-pet-sprite-picker-title">选择你的伙伴</div>
        <div className="dsh-pet-sprite-picker-sub">随时可以在照顾面板中更换形象</div>
        <div className="dsh-pet-sprite-picker-cards">
          {pets.map((pet) => (
            <PetCard
              key={pet.id}
              pet={pet}
              custom={isCustomPetId(pet.id) ? customPets.find(c => c.id === pet.id) : undefined}
              profile={profiles[pet.id]}
              isCurrent={currentId === pet.id}
              state={picked === null ? 'idle' : picked === pet.id ? 'picked' : 'dim'}
              onPick={() => handlePick(pet.id)}
            />
          ))}
        </div>
        {onGeneratePet !== undefined && (
          <div className="dsh-pet-sprite-picker-gen">
            {!genOpen ? (
              <button type="button" className="dsh-pet-sprite-picker-gen-open" onClick={() => setGenOpen(true)}>
                ✨ 捏一只自己的{firstGenerateFree ? '（首次免费）' : '（100 星币）'}
              </button>
            ) : (
              <>
                <div className="dsh-pet-sprite-picker-gen-row">
                  <input
                    value={genDesc}
                    onChange={(e) => setGenDesc(e.target.value)}
                    placeholder="例如：戴圆眼镜的绿色小恐龙"
                    maxLength={200}
                    disabled={genBusy}
                    onKeyDown={(e) => { if (e.key === 'Enter') void doGenerate() }}
                  />
                  <button
                    type="button"
                    className="dsh-pet-sprite-picker-gen-go"
                    onClick={() => { void doGenerate() }}
                    disabled={genBusy || genDesc.trim().length === 0}
                  >
                    {genBusy ? '绘制中……' : '生成'}
                  </button>
                  {!genBusy && (
                    <button type="button" className="dsh-pet-sprite-picker-gen-x" onClick={() => { setGenOpen(false); setGenError(null) }}>收起</button>
                  )}
                </div>
                {genError !== null && <div className="dsh-pet-sprite-picker-gen-err">{genError}</div>}
                <div className="dsh-pet-sprite-picker-gen-note">用一句话描述，模型画出像素形象并直接成为你的伙伴{firstGenerateFree ? '——第一只免费' : ''}。</div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
