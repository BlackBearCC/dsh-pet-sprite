# dsh-pet-sprite

A **playable** pixel companion plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) Web UI.

Not a wallpaper mascot — the pet lives in your chat area, **platform-jumps over your message bubbles**, and you can grab the controls yourself. It also carries a full nurture system fed by your agent's **real token usage**.

## Features

- **Three companions, one egg** — on first launch a speckled egg wobbles quietly in the corner (never a forced popup). Click it to hatch and pick your companion: **Poka** the white-haired girl, **Mikan** the tabby cat, or **Puff** the DeepSeek-blue baby whale. Switch anytime from the care panel.
- **Generate & share your own companion** — describe it in one sentence ("a green dino with round glasses") and the model draws a new pixel sprite for 100 star coins, animated automatically. Every generated pet exports as a `.dsh-pet.json` file friends can import for free.
- **Left-click to chat** — clicking the pet opens a small chat box beside it. Replies come from the model you already configured in DSH (provider + model pickable in the care panel's settings tab), so it reuses your existing credentials — no extra API key. The pet answers in-character as a speech bubble; the last 30 turns persist locally.
- **Platform jumping playground** — the pet treats chat message bubbles as platforms: it wanders, climbs bubble edges, hops between messages on its own.
- **Player control** — click empty space in the chat area to take over: `A/D` move, `Space` jump (double-tap mid-air for a skill jump), `W` climb, `S` drop through platforms. Idle 10s and it goes back to autonomous mode.
- **Agent-state reactions** — while the model streams, the pet sits down and types on its own tiny laptop; idle, it blinks, strolls, and naps. Each companion has its own ambient chatter.
- **Nurture system** (ported from the PetClaw engine): mood / power / health attributes with decay and linkage, Lv.1–100 with titles, coins, inventory, and a shop with level-gated + daily-limited items.
- **Token-bound economy** — your input tokens drain the pet's power, each completed reply converts output tokens into XP, daily-first-open grants login coins, leveling slows attribute decay.

Right-click the pet to open the care panel (status / interactions / inventory / shop / settings), docked right next to the character.

## Install

```sh
dsh plugin --profile web add github:BlackBearCC/dsh-pet-sprite
```

Then restart DSH (`dsh web`) and open any conversation — the pet spawns at the bottom of the chat flow.

> `lib/` build output is committed, so git installs work without authorizing build scripts. To rebuild from source: `pnpm install && pnpm build`.

## How it works

- Registers into the DSH Web UI `shell.overlay` slot via the `dsh.client` browser-plugin manifest.
- The node half mounts two exact HTTP routes (`GET /plugins/dsh-pet-sprite/models`, `POST /plugins/dsh-pet-sprite/chat`) that proxy `ctx.llm` — the same LLM runtime the coding agent uses, with your configured providers and keys.
- Platforms are discovered from `[data-chat-flow-key]` message nodes; the arena is the conversation scroll viewport. Everything adapts live to scrolling and new messages.
- Game state and chat history (attributes, level, coins, inventory, last 30 chat turns, model choice) persist in `localStorage` — no telemetry, zero external network calls.

## Compatibility

- DSH developer preview (tested against `0.1.0-rc.7`). DSH is iterating fast with breaking changes; pin a commit (`github:<you>/dsh-pet-sprite#<sha>`) if stability matters.

## License

MIT
