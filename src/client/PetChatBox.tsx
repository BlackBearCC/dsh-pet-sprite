// Side chat box: opens beside the pet when the user left-clicks it.
// Hand-drawn comic style (single 2.5px ink outline, hard shadow), a short
// scrollable history plus an input row. Replies come from the plugin's
// node-side /plugins/dsh-pet-sprite/chat route; errors are shown inline
// instead of being swallowed.

import { useEffect, useRef, useState, type FC } from 'react'

export interface ChatTurn {
  role: 'user' | 'pet'
  text: string
}

export interface ChatModel {
  provider: string
  model: string
}

interface Props {
  petName: string // active companion name (builtin or custom)
  anchor: { x: number; y: number } // pet screen position (box opens beside it)
  model: ChatModel | null
  history: ChatTurn[]
  busy: boolean
  error: string | null
  onSend: (text: string) => void
  onClear: () => void
  onClose: () => void
}

let chatStyleInjected = false
function injectChatStyles(): void {
  if (chatStyleInjected) return
  chatStyleInjected = true
  const s = document.createElement('style')
  s.textContent = `
.dsh-pet-sprite-chat{position:absolute;z-index:1001;width:300px;max-width:calc(100vw - 24px);background:#fff;border:3px solid #4a4553;border-radius:16px;box-shadow:0 6px 0 rgba(0,0,0,.2);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;pointer-events:auto;animation:dshPetSpriteChatIn .38s cubic-bezier(.2,1.6,.4,1) both;overflow:hidden}
@keyframes dshPetSpriteChatIn{from{opacity:0;transform:translateY(14px) scale(.9)}to{opacity:1;transform:translateY(0) scale(1)}}
.dsh-pet-sprite-chat-hd{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:2.5px solid #4a4553;background:#ffd33d}
.dsh-pet-sprite-chat-hd .nm{font-size:13.5px;font-weight:900;color:#4a4553;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-pet-sprite-chat-hd .clr,.dsh-pet-sprite-chat-hd .x{border:2.5px solid #4a4553;border-radius:999px;background:#fff;color:#4a4553;cursor:pointer;font:800 10.5px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;padding:4px 9px;box-shadow:0 2px 0 rgba(0,0,0,.15);transition:transform .15s cubic-bezier(.2,1.5,.4,1)}
.dsh-pet-sprite-chat-hd .x{width:24px;height:24px;padding:0;font:900 14px/19px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;text-align:center}
.dsh-pet-sprite-chat-hd .clr:hover{transform:rotate(-4deg) scale(1.06)}
.dsh-pet-sprite-chat-hd .x:hover{transform:rotate(90deg) scale(1.1);background:#ffe3e3}
.dsh-pet-sprite-chat-log{max-height:218px;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px;background:repeating-linear-gradient(45deg,#fdfdff 0 8px,#f6f7fb 8px 16px)}
.dsh-pet-sprite-chat-msg{max-width:82%;padding:5px 11px;border:2.5px solid #4a4553;border-radius:12px;font-size:12.5px;line-height:1.55;color:#4a4553;white-space:pre-wrap;word-break:break-word;box-shadow:0 2px 0 rgba(0,0,0,.12)}
.dsh-pet-sprite-chat-msg.u{align-self:flex-end;background:#dcebff;border-bottom-right-radius:4px}
.dsh-pet-sprite-chat-msg.p{align-self:flex-start;background:#fff;border-bottom-left-radius:4px}
.dsh-pet-sprite-chat-empty{font-size:11.5px;color:#9a95a5;text-align:center;padding:18px 6px;line-height:1.7}
.dsh-pet-sprite-chat-ft{display:flex;gap:8px;padding:9px 10px;border-top:2.5px solid #4a4553;background:#fff}
.dsh-pet-sprite-chat-ft input{flex:1;min-width:0;border:2.5px solid #4a4553;border-radius:10px;padding:7px 11px;font:600 12.5px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#4a4553;background:#fff;outline:none}
.dsh-pet-sprite-chat-ft input:focus{background:#fffbe8}
.dsh-pet-sprite-chat-ft input:disabled{opacity:.55}
.dsh-pet-sprite-chat-send{border:2.5px solid #4a4553;border-radius:10px;background:#ffd33d;color:#4a4553;font:900 12px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;padding:0 15px;cursor:pointer;box-shadow:0 2.5px 0 rgba(0,0,0,.16);transition:transform .12s cubic-bezier(.2,1.5,.4,1)}
.dsh-pet-sprite-chat-send:hover{transform:translateY(-2px)}
.dsh-pet-sprite-chat-send:active{transform:translateY(1px)}
.dsh-pet-sprite-chat-send:disabled{opacity:.5;cursor:default;transform:none}
.dsh-pet-sprite-chat-err{margin:0 12px 8px;padding:6px 10px;border:2.5px solid #e8434e;border-radius:10px;background:#ffe9ec;color:#b32832;font-size:11.5px;font-weight:700;line-height:1.5;word-break:break-word}
.dsh-pet-sprite-chat-typing{align-self:flex-start;display:flex;gap:4px;padding:8px 12px;border:2.5px solid #4a4553;border-radius:12px;background:#fff;box-shadow:0 2px 0 rgba(0,0,0,.12)}
.dsh-pet-sprite-chat-typing i{width:6px;height:6px;border-radius:50%;background:#9a95a5;animation:dshPetSpriteChatDot 1s ease-in-out infinite}
.dsh-pet-sprite-chat-typing i:nth-child(2){animation-delay:.15s}
.dsh-pet-sprite-chat-typing i:nth-child(3){animation-delay:.3s}
@keyframes dshPetSpriteChatDot{0%,100%{transform:translateY(0);opacity:.4}50%{transform:translateY(-4px);opacity:1}}
@media (prefers-reduced-motion:reduce){.dsh-pet-sprite-chat{animation-duration:.01s}}
`
  document.head.appendChild(s)
}

export const PetChatBox: FC<Props> = ({ petName, anchor, model, history, busy, error, onSend, onClear, onClose }) => {
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { injectChatStyles() }, [])

  // keep the latest turn in view and focus the input on open
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [history, busy, error])
  useEffect(() => { inputRef.current?.focus() }, [])

  // clamp the box inside the viewport, opening to the pet's right by default
  const left = Math.min(Math.max(anchor.x + 56, 12), window.innerWidth - 312)
  const top = Math.min(Math.max(anchor.y - 240, 12), Math.max(window.innerHeight - 340, 12))

  const send = (): void => {
    const text = draft.trim()
    if (text.length === 0 || busy) return
    setDraft('')
    onSend(text)
  }

  const modelHint = model === null
    ? '（未选择模型：在照顾面板 → 设置里选一个）'
    : `${model.provider} / ${model.model}`

  return (
    <div className="dsh-pet-sprite-chat" style={{ left, top }} role="dialog" aria-label={`和${petName}聊天`}>
      <div className="dsh-pet-sprite-chat-hd">
        <span className="nm">{petName}</span>
        <button type="button" className="clr" onClick={onClear} title="清空聊天记录">清空</button>
        <button type="button" className="x" aria-label="关闭" onClick={onClose}>×</button>
      </div>
      <div className="dsh-pet-sprite-chat-log" ref={logRef}>
        {history.length === 0 && !busy && (
          <div className="dsh-pet-sprite-chat-empty">
            和 {petName} 说点什么吧<br />
            <span style={{ fontSize: 10.5, color: '#b3aebe' }}>{modelHint}</span>
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className={`dsh-pet-sprite-chat-msg ${m.role === 'user' ? 'u' : 'p'}`}>{m.text}</div>
        ))}
        {busy && (
          <div className="dsh-pet-sprite-chat-typing"><i /><i /><i /></div>
        )}
      </div>
      {error !== null && <div className="dsh-pet-sprite-chat-err">{error}</div>}
      <div className="dsh-pet-sprite-chat-ft">
        <input
          ref={inputRef}
          value={draft}
          placeholder={busy ? '想一想……' : `对 ${petName} 说……`}
          maxLength={500}
          disabled={busy}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
        />
        <button type="button" className="dsh-pet-sprite-chat-send" disabled={busy || draft.trim().length === 0} onClick={send}>发送</button>
      </div>
    </div>
  )
}
