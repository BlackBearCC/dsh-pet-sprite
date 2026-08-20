// Companion picker: hand-drawn comic style cards (single 2.5px ink
// outline, hard shadow, spring pop-in, halftone backdrop) for the three
// builtin companions plus the user's LLM-generated ones. Shown on first
// launch (no saved choice) and re-openable from the care panel. Each
// card previews the live sprite with a slow idle blink.

import { useEffect, useRef, useState, type FC } from 'react'
import { drawPet, PET_ART, PET_IDS, PET_META, type Frames } from './pet-art.ts'
import { framesFromRows, type CustomPet } from './custom-pets.ts'

interface Props {
  /** Currently active companion id (badge in the corner), null on first launch. */
  currentId: string | null
  /** User-generated companions from localStorage. */
  customPets: CustomPet[]
  onPick: (id: string) => void
  /** Dismiss without choosing (overlay click / × button). */
  onClose: () => void
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
@media (prefers-reduced-motion:reduce){.dsh-pet-sprite-picker-panel{animation-duration:.01s}.dsh-pet-sprite-picker-card{transition:none}}
`
  document.head.appendChild(s)
}

const PetCard: FC<{ pet: PickerPet; isCurrent: boolean; state: 'idle' | 'picked' | 'dim'; onPick: () => void }> = ({ pet, isCurrent, state, onPick }) => {
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
    </button>
  )
}

export const PetPicker: FC<Props> = ({ currentId, customPets, onPick, onClose }) => {
  const [picked, setPicked] = useState<string | null>(null)
  useEffect(() => { injectPickerStyles() }, [])

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
              isCurrent={currentId === pet.id}
              state={picked === null ? 'idle' : picked === pet.id ? 'picked' : 'dim'}
              onPick={() => handlePick(pet.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
