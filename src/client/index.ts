import type { Context } from '@deepseek-ai/cordis'
import { ChatPet } from './ChatPet'
import { setSessionsService } from './workspace.ts'

export const name = 'dsh-pet-sprite'
export const inject = ['slots', 'sessions']

export function apply(ctx: Context): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slots = (ctx as any).slots
  if (slots === undefined) return
  // workspace awareness is progressive: the sessions service is injected
  // above (rc.8 hosts always provide it); the tracker degrades to an empty
  // view when the service object lacks the expected shape
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSessionsService((ctx as any).sessions)
  slots.inject('shell.overlay', () => {
    return slots.register(
      {
        name: 'shell.overlay',
        id: 'dsh-pet-sprite',
        registrant: 'dsh-pet-sprite',
      },
      ChatPet,
    )
  })
}