# dsh-pet-sprite

A **playable** pixel companion plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) Web UI.

Not a wallpaper mascot — the pet lives in your chat area, **platform-jumps over your message bubbles**, and you can grab the controls yourself. It also carries a full nurture system fed by your agent's **real token usage**.

## Features

- **Three companions, one egg** — on first launch a speckled egg wobbles quietly in the corner (never a forced popup). Click it to hatch and pick your companion: **Poka** the white-haired girl, **Mikan** the tabby cat, or **Puff** the DeepSeek-blue baby whale. Switch anytime from the care panel.
- **Platform jumping playground** — the pet treats chat message bubbles as platforms: it wanders, climbs bubble edges, hops between messages on its own.
- **Player control** — click empty space in the chat area to take over: `A/D` move, `Space` jump (double-tap mid-air for a skill jump), `W` climb, `S` drop through platforms. Idle 10s and it goes back to autonomous mode.
- **Click combo** — click the pet for combo counts (persisted) plus a golden particle burst.
- **Agent-state reactions** — while the model streams, the pet sits down and types on its own tiny laptop; idle, it blinks, strolls, and naps. Each companion has its own ambient chatter.
- **Nurture system** (ported from the PetClaw engine): mood / power / health attributes with decay and linkage, Lv.1–100 with titles, coins, inventory, and a shop with level-gated + daily-limited items.
- **Token-bound economy** — your input tokens drain the pet's power, each completed reply converts output tokens into XP, daily-first-open grants login coins, leveling slows attribute decay.

Right-click the pet to open the care panel (status / interactions / inventory / shop), docked right next to the character.

## Install

```sh
dsh plugin --profile web add github:<your-account>/dsh-pet-sprite
```

Then restart DSH (`dsh web`) and open any conversation — the pet spawns at the bottom of the chat flow.

> `lib/` build output is committed, so git installs work without authorizing build scripts. To rebuild from source: `pnpm install && pnpm build`.

## How it works

- Registers into the DSH Web UI `shell.overlay` slot via the `dsh.client` browser-plugin manifest.
- Platforms are discovered from `[data-chat-flow-key]` message nodes; the arena is the conversation scroll viewport. Everything adapts live to scrolling and new messages.
- Game state (attributes, level, coins, inventory) persists in `localStorage` — no server, no telemetry, zero network calls.

## Compatibility

- DSH developer preview (tested against `0.1.0-rc.7`). DSH is iterating fast with breaking changes; pin a commit (`github:<you>/dsh-pet-sprite#<sha>`) if stability matters.

## License

MIT
