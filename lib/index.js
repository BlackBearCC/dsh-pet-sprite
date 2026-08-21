import { defineTool } from "@deepseek-ai/dsh-tools";
import fs from "node:fs";
import path from "node:path";

//#region src/pixel-format.ts
const GRID_W = 24;
const GRID_H = 28;
/** Every palette character a sprite cell may use ('.' = transparent). */
const PALETTE_CHARS = "ohHsSeXwtTkKbmlgzfFpuc";
const PALETTE_SET = new Set(PALETTE_CHARS.split(""));
/**
* Coerce arbitrary LLM output into a valid 24x28 grid: pad/truncate rows,
* blank out unknown characters, cap at 28 rows. Fails when the result is
* too empty to read as a sprite.
*/
function fixGrid(raw) {
	if (!Array.isArray(raw)) return { error: "rows is not an array" };
	const rows = [];
	for (let i = 0; i < GRID_H; i++) {
		const src = typeof raw[i] === "string" ? raw[i] : "";
		let row = "";
		for (const ch of src.slice(0, GRID_W)) row += ch === "." || PALETTE_SET.has(ch) ? ch : ".";
		rows.push(row + ".".repeat(GRID_W - row.length));
	}
	const filled = rows.join("").replace(/\./g, "").length;
	if (filled < 80) return { error: "generated sprite is too empty to use — try a more concrete description" };
	return { rows };
}

//#endregion
//#region src/index.ts
const name = "dsh-pet-sprite";
const inject = [];
/**
* Block cross-origin POSTs that could silently spend the user's LLM quota.
* A `text/plain` body needs no CORS preflight, so a malicious page could
* otherwise fire this route from any website. Two gates: the browser's
* own `Sec-Fetch-Site` marker, and a strict content-type check.
*/
function sameOriginPost(req) {
	const site = req.headers?.["sec-fetch-site"];
	if (typeof site === "string" && site !== "same-origin" && site !== "same-site" && site !== "none") return false;
	const ct = req.headers?.["content-type"];
	const value = Array.isArray(ct) ? ct[0] : ct;
	return typeof value === "string" && value.toLowerCase().startsWith("application/json");
}
function json(res, status, payload) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(payload));
}
/** Drain one llm.stream() call into plain text; throws on stream errors. */
async function streamText(llm, options) {
	let text = "";
	for await (const chunk of llm.stream(options)) {
		if (chunk.type === "text-delta" && typeof chunk.text === "string") text += chunk.text;
		if (chunk.type === "finish" && chunk.reason?.kind === "error") throw new Error(chunk.reason.failure?.message ?? "llm stream failed");
	}
	return text;
}
/** The persona system prompt: user-authored wins, else the default voice. */
function personaPrompt(petName, persona, lang) {
	const zh = lang.toLowerCase().startsWith("zh");
	const custom = persona.trim();
	if (custom.length > 0) return zh ? [
		`你是「${petName}」，一只住在用户编程助手界面里的像素小宠物。`,
		"以下是用户为你写的角色设定，优先按它来演绎：",
		"「" + custom + "」",
		"回复保持简短（一到三句话）、口语化；不使用 markdown 或代码块；不自称 AI 助手或模型。"
	].join("") : [
		`You are "${petName}", a pixel pet living inside the user's coding assistant UI.`,
		"The user wrote this persona for you — follow it first:",
		`"${custom}"`,
		"Keep replies short (one to three sentences) and casual; no markdown or code blocks; never call yourself an AI assistant or a model."
	].join("");
	return zh ? [
		`你是「${petName}」，一只住在用户编程助手界面里的像素小宠物。`,
		"用第一人称以宠物口吻回复：简短（一到三句话）、口语化、有活力，偶尔撒娇但不过分。",
		"不使用 markdown、列表或代码块；不自称 AI 助手或模型；不要说教。",
		"用户是每天和你待在一起的开发者，你可以自然地关心他的工作和休息。"
	].join("") : [
		`You are "${petName}", a pixel pet living inside the user's coding assistant UI.`,
		"Reply in first person, pet voice: short (one to three sentences), casual, energetic, a little clingy but not over the top.",
		"No markdown, lists, or code blocks; never call yourself an AI assistant or a model; no lecturing.",
		"The user is a developer who spends every day with you; naturally caring about their work and rest is in character."
	].join("");
}
/**
* Appended context for the chat system prompt: which host session the
* pet is witnessing, what it remembers about the user, and how it feels
* right now. All parts are background — the prompt tells the model not
* to recite them. Pet state is only injected when something is wrong
* (hungry, sad, sick) — a healthy pet needs no extra instruction.
*/
function contextPrompt(lang, workspace, memories, petState) {
	const zh = lang.toLowerCase().startsWith("zh");
	const parts = [];
	const current = (workspace?.current ?? "").trim();
	const recent = (workspace?.recent ?? []).filter((t) => typeof t === "string" && t.trim().length > 0).slice(0, 5);
	if (current.length > 0 || recent.length > 0) parts.push(zh ? `主人当前的工作会话：${current.length > 0 ? `「${current}」` : "（未命名）"}${recent.length > 0 ? `；最近还在忙：${recent.map((t) => `「${t.trim().slice(0, 24)}」`).join("、")}` : ""}。` : `The user's current work session: "${current || "(untitled)"}"${recent.length > 0 ? `; also recently working on: ${recent.map((t) => `"${t.trim().slice(0, 24)}"`).join(", ")}` : ""}.`);
	if (memories !== void 0 && memories.length > 0) {
		const list = memories.filter((t) => typeof t === "string").map((t) => t.trim().slice(0, 60)).filter((t) => t.length > 0).slice(0, 10);
		if (list.length > 0) parts.push(zh ? `你对主人的记忆（背景，自然相关时才提起，不要罗列，也不要每句都往上面靠）：\n${list.map((t) => `- ${t}`).join("\n")}` : `Your memories of the user (background — mention only when naturally relevant, never recite):\n${list.map((t) => `- ${t}`).join("\n")}`);
	}
	if (petState !== void 0) {
		const lows = [];
		if (petState.moodLevel === "sad") lows.push(zh ? "心情不太好" : "in a low mood");
		if (petState.powerLevel === "starving" || petState.powerLevel === "hungry") lows.push(zh ? "肚子很饿、电量很低" : "very hungry and low on energy");
		if (petState.healthLevel === "sick" || petState.healthLevel === "subhealthy") lows.push(zh ? "身体不太舒服" : "not feeling well");
		if (lows.length > 0) parts.push(zh ? `你现在的状态：${lows.join("，")}。回复时自然地带出这些感受，但不要每句都抱怨。` : `Your current state: ${lows.join(", ")}. Let these feelings show naturally in your replies, but don't complain in every sentence.`);
	}
	return parts.join("\n");
}
/**
* Memory-extraction prompt: the model reads a recent conversation
* window plus the existing memory list and answers with 0-2 new
* facts about the user, in the pet's voice, as a JSON string array.
*/
function memoryPrompt(lang, petName, recentText, existing) {
	const zh = lang.toLowerCase().startsWith("zh");
	const have = existing.length > 0 ? zh ? `已有的记忆（相同或相近的不要再记）：\n${existing.map((t) => `- ${t}`).join("\n")}` : `Existing memories (do not repeat or paraphrase these):\n${existing.map((t) => `- ${t}`).join("\n")}` : zh ? "还没有任何记忆。" : "No memories yet.";
	return zh ? [
		`你是像素宠物「${petName}」，刚旁观完主人在编程助手会话里的一段对话。`,
		have,
		"请从下面的对话里提炼 0 到 2 条关于主人的新记忆：宠物视角的简明事实句（例如「主人在重构支付模块，被并发 bug 卡住」「主人习惯深夜干活」），每条不超过 40 字，只记事实，不要记闲聊。",
		"没有值得记的就输出空数组。只输出一个 JSON 字符串数组，例如 [\"……\",\"……\"]，不要 markdown、不要解释。",
		`对话片段：\n${recentText}`
	].join("\n") : [
		`You are "${petName}", a pixel pet that just watched a stretch of the user's coding-assistant conversation.`,
		have,
		"Distill 0-2 new memories about the user from the conversation below: short factual notes in the pet's perspective (e.g. \"the user is refactoring the payment module, stuck on a concurrency bug\"), each max 30 words. Facts only, no small talk.",
		"If nothing is worth remembering, output an empty array. Output ONLY one JSON string array, e.g. [\"...\",\"...\"] — no markdown, no commentary.",
		`Conversation excerpt:\n${recentText}`
	].join("\n");
}
/** Parse the model's memory answer into 0-2 clamped strings; never throws. */
function parseMemories(reply) {
	let text = reply.trim();
	const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
	if (fence?.[1] !== void 0) text = fence[1].trim();
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	if (start >= 0 && end > start) text = text.slice(start, end + 1);
	try {
		const v = JSON.parse(text);
		if (!Array.isArray(v)) return [];
		return v.filter((s) => typeof s === "string").map((s) => s.trim().slice(0, 60)).filter((s) => s.length > 0).slice(0, 2);
	} catch {
		return [];
	}
}
/**
* Sprite-generator prompt: the model must answer with one JSON object
* containing the pixel grid, persona, and event lines for every pool key.
* The grid spec mirrors pixel-format.ts exactly; the line keys mirror
* custom-pets.ts LINE_KEYS so a generated companion arrives fully voiced.
*/
function generatePrompt(description) {
	return [
		"You are a pixel-art sprite and character generator. Output ONLY one JSON object, no markdown fences, no commentary:",
		`{"name":"<pet name, 2-6 characters, same language as the description>","tagline":"<one-line personality, max 16 characters, same language>","persona":"<2-3 sentence personality description in the same language as the description>","rows":[<${GRID_H} strings, each exactly ${GRID_W} characters>],"lines":{"idle":[...],"work":[...],"done":[...],"low":[...],"feed":[...],"play":[...],"rest":[...],"switch":[...],"memory":[...],"think":[...],"error":[...],"ctl":[...],"drag":[...],"intro":[...]}}`,
		`Grid rules: ${GRID_W} columns x ${GRID_H} rows; '.' = transparent background.`,
		`Palette single characters (meaning: color): o=#4a4553 ink outline; h=#f6f7fc white; H=#dcdff0 white shade; s=#ffe9dc skin; S=#f2cdb9 skin shade; e=#3c3744 eye dark; X=#ffffff white; w=#ffffff white; t=#e8434e red; T=#b32832 dark red; k=#9c6640 brown; K=#7d4e2c dark brown; b=#ffb3ae blush; m=#e8927c mouth; l=#39496b navy; g=#8fd0ff light blue; z=#8fa3c8 gray blue; f=#f4a45c orange; F=#d9803a dark orange; p=#f2839b pink; u=#4d6efa vivid blue; c=#e7edff pale.`,
		"Every colored region must be enclosed by a 1px o outline so the sprite reads on any background.",
		"The character: cute chibi proportions, head about half the height, simple readable silhouette, centered horizontally (columns 4-19), feet near row 26, two e eyes, one small m mouth. Use 2-4 palette colors plus the o outline.",
		"Every row string is exactly 24 characters. Aim for readable, not detailed.",
		"Lines: each key maps to an array of 2-3 short bubble lines (max 14 chars each) in the pet's voice and the same language as the description. Write lines that fit the character's personality. Keys:",
		"  idle = ambient chatter while idling; work = agent starts streaming; done = agent turn completes; low = mood/power/health bad; feed = after being fed; play = after play; rest = after resting; switch = user changed work session; memory = pet memorized something new; think = chat request in flight; error = chat failed; ctl = WASD takeover begins; drag = being dragged; intro = first shown after birth.",
		"  The intro key may use {name} as a placeholder for the pet's name.",
		`Description of the pet to draw: ${description}`
	].join("\n");
}
/** Clamp one journal number coming off the wire. */
function num(v, max = 1e7) {
	const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0;
	return Math.max(0, Math.min(max, n));
}
/**
* Work-journal prompt: the day's witnessed numbers plus the assignment —
* one short log entry written TO the user, in the pet's own voice.
* Week scope summarizes the last 7 days instead of today.
*/
function witnessPrompt(lang, scope, day) {
	const zh = lang.toLowerCase().startsWith("zh");
	if (scope === "week") return zh ? [
		`最近 7 天你亲眼见证的数据：活跃 ${num(day.activeDays)} 天；对话 ${num(day.turns)} 轮；完成 ${num(day.tasks)} 个任务；输入约 ${num(day.inChars)} 字；输出约 ${num(day.outChars)} 字；其中 ${num(day.nights)} 天干到凌晨；喂食 ${num(day.feed)} 次、玩耍 ${num(day.play)} 次、休息 ${num(day.rest)} 次、升级 ${num(day.levelUps)} 次。`,
		"请以你的口吻替用户写一条本周工作周报：写给用户本人，回顾他这一周，120 字以内，两到四句话。",
		"可以看趋势和对比（哪几天最猛、有没有连着熬夜、周末歇没歇），挑一两个数字自然地写进去，不要罗列清单；带一点你作为见证者的态度。如果这一周基本没动静，就轻轻调侃一下。",
		"不要 markdown、不要代码块、不要标题。"
	].join("\n") : [
		`Data you witnessed over the last 7 days: active on ${num(day.activeDays)} days; ${num(day.turns)} chat turns; ${num(day.tasks)} tasks completed; ~${num(day.inChars)} chars in; ~${num(day.outChars)} chars out; worked past midnight on ${num(day.nights)} nights; fed ${num(day.feed)}, played ${num(day.play)}, rested ${num(day.rest)}, leveled up ${num(day.levelUps)}.`,
		"Write this week's work report for the user in your own voice: addressed to them, looking back at their week, max 90 words, two to four sentences.",
		"Trends and comparisons are welcome (which days were heaviest, any late-night streaks, whether the weekend got a rest) — weave in one or two numbers naturally, no lists; a little witness attitude is welcome. If the week was quiet, tease them gently.",
		"No markdown, no code blocks, no headings."
	].join("\n");
	return zh ? [
		`今天你亲眼见证的数据：对话 ${num(day.turns)} 轮；完成 ${num(day.tasks)} 个任务；输入约 ${num(day.inChars)} 字；输出约 ${num(day.outChars)} 字；活跃跨度约 ${num(day.spanMinutes)} 分钟${day.night === true ? "；凌晨还在干活" : ""}；喂食 ${num(day.feed)} 次、玩耍 ${num(day.play)} 次、休息 ${num(day.rest)} 次、升级 ${num(day.levelUps)} 次。`,
		"请以你的口吻替用户写一条今天的工作日志：写给用户本人，关于他今天的工作，80 字以内，一到三句话。",
		"从数据里挑一两个最有特点的数字自然地写进去，不要罗列清单；带一点你作为见证者的态度（心疼、骄傲、吐槽都行）。如果今天什么都没发生，就轻轻调侃一下。",
		"不要 markdown、不要代码块、不要标题。"
	].join("\n") : [
		`Data you witnessed today: ${num(day.turns)} chat turns; ${num(day.tasks)} tasks completed; ~${num(day.inChars)} chars in; ~${num(day.outChars)} chars out; ~${num(day.spanMinutes)} min active${day.night === true ? "; worked past midnight" : ""}; fed ${num(day.feed)}, played ${num(day.play)}, rested ${num(day.rest)}, leveled up ${num(day.levelUps)}.`,
		"Write today's work journal for the user in your own voice: addressed to them, about their day, max 60 words, one to three sentences.",
		"Weave in one or two standout numbers naturally — no lists; a little witness attitude (proud, concerned, teasing) is welcome. If nothing happened today, tease them gently.",
		"No markdown, no code blocks, no headings."
	].join("\n");
}
/** Parse the generator reply: strip fences, find the JSON, fix the grid. */
function parseGeneratedPet(reply) {
	let text = reply.trim();
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence !== null) text = fence[1].trim();
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) throw new Error("model did not return a JSON object");
	const data = JSON.parse(text.slice(start, end + 1));
	const name$1 = typeof data.name === "string" && data.name.trim().length > 0 ? data.name.trim().slice(0, 12) : "小家伙";
	const tagline = typeof data.tagline === "string" && data.tagline.trim().length > 0 ? data.tagline.trim().slice(0, 24) : "";
	const grid = fixGrid(data.rows);
	if ("error" in grid) throw new Error(grid.error);
	const persona = typeof data.persona === "string" && data.persona.trim().length > 0 ? data.persona.trim().slice(0, 500) : void 0;
	const lines = data.lines !== null && typeof data.lines === "object" && !Array.isArray(data.lines) ? Object.fromEntries(Object.entries(data.lines).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.filter((s) => typeof s === "string").map((s) => s.trim().slice(0, 24)).filter((s) => s.length > 0).slice(0, 8)]).filter(([, v]) => v.length > 0)) : void 0;
	return {
		name: name$1,
		tagline,
		rows: grid.rows,
		persona,
		lines
	};
}
async function readBody(req, limitBytes = 64 * 1024) {
	return await new Promise((resolve, reject) => {
		const parts = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > limitBytes) {
				reject(new Error("request body too large"));
				return;
			}
			parts.push(chunk);
		});
		req.on("end", () => {
			resolve(Buffer.concat(parts).toString("utf8"));
		});
		req.on("error", reject);
	});
}
/** Build the model-facing message list: chat history plus the new user turn. */
function buildMessages(history, message, provider, model) {
	const messages = [];
	for (const turn of history.slice(-16)) if (turn.role === "assistant") messages.push({
		id: crypto.randomUUID(),
		role: "assistant",
		content: [{
			type: "text",
			text: turn.content
		}],
		source: {
			kind: "model",
			provider,
			model
		}
	});
	else messages.push({
		id: crypto.randomUUID(),
		role: "user",
		content: [{
			type: "text",
			text: turn.content
		}],
		source: { kind: "user" }
	});
	messages.push({
		id: crypto.randomUUID(),
		role: "user",
		content: [{
			type: "text",
			text: message
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-pet-sprite"
		}
	});
	return messages;
}
function apply(ctx) {
	const storagesDir = () => {
		const home = process.env.DSH_HOME ?? path.join(process.env.HOME ?? "/home", ".dsh");
		return path.join(home, "storages");
	};
	const memoryFile = () => path.join(storagesDir(), "dsh-pet-sprite-memory.json");
	const readMemories = () => {
		try {
			const v = JSON.parse(fs.readFileSync(memoryFile(), "utf8"));
			if (!Array.isArray(v)) return [];
			return v.filter((m) => m !== null && typeof m === "object" && typeof m.text === "string" && m.text.length > 0);
		} catch {
			return [];
		}
	};
	const writeMemories = (list) => {
		fs.mkdirSync(storagesDir(), { recursive: true });
		const tmp = memoryFile() + ".tmp";
		const capped = list.slice(0, 30);
		fs.writeFileSync(tmp, JSON.stringify(capped));
		fs.renameSync(tmp, memoryFile());
	};
	try {
		const tools = ctx.tools;
		if (tools !== void 0) {
			const { list, read, write } = {
				list: defineTool({
					name: "pet_memory_list",
					description: "列出宠物对主人的全部记忆（每条：内容 + 来源会话 + 时间）。宠物在用户工作时旁观察到的持久事实；跨会话可用。",
					parameters: {},
					output: {
						schema: { type: "string" },
						render: (_a, v) => [{
							type: "text",
							text: String(v)
						}]
					},
					execute() {
						const all = readMemories();
						if (all.length === 0) return "（宠物还没有任何记忆）";
						return all.map((m) => `- ${m.text}（来源：${m.sessionTitle || "未知会话"}，${new Date(m.createdAt).toLocaleString("zh-CN")}）`).join("\n");
					}
				}),
				read: defineTool({
					name: "pet_memory_search",
					description: "按关键词检索宠物记忆（多关键词 AND）。先查这个再决定是否需要 pet_memory_list 全量。",
					parameters: { keywords: {
						type: "string",
						description: "空格分隔的关键词"
					} },
					output: {
						schema: { type: "string" },
						render: (_a, v) => [{
							type: "text",
							text: String(v)
						}]
					},
					execute(args) {
						const kws = String(args.keywords ?? "").split(/\s+/).filter(Boolean);
						if (kws.length === 0) return "（没有给出关键词）";
						const hits = readMemories().filter((m) => kws.every((k) => m.text.includes(k)));
						if (hits.length === 0) return "（没有命中）";
						return hits.map((m) => `- ${m.text}（来源：${m.sessionTitle || "未知会话"}）`).join("\n");
					}
				}),
				write: defineTool({
					name: "pet_memory_write",
					description: "给宠物写一条关于主人的新记忆（≤60字）。用户说「让宠物记住…」或 agent 判断有跨会话价值的持久事实时使用；重复事实会被去重拒绝。",
					parameters: { text: {
						type: "string",
						description: "记忆内容，宠物视角，≤60 字"
					} },
					output: {
						schema: { type: "string" },
						render: (_a, v) => [{
							type: "text",
							text: String(v)
						}]
					},
					execute(args) {
						const text = String(args.text ?? "").trim().slice(0, 60);
						if (text.length === 0) return "（内容为空）";
						const all = readMemories();
						if (all.some((m) => m.text === text)) return "（已有相同记忆，未重复写入）";
						writeMemories([{
							id: `mem:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 6)}`,
							text,
							sessionTitle: "agent 写入",
							createdAt: Date.now()
						}, ...all]);
						return `已记住：${text}`;
					}
				})
			};
			tools.register(list);
			tools.register(read);
			tools.register(write);
		}
	} catch {}
	const llmNow = () => ctx.get("llm");
	const defaultModelNow = () => ctx.get("agentDefaultModel");
	const webServerNow = () => ctx.get("webServer");
	const registerWhenReady = (register) => {
		const attempt = () => {
			const webServer = webServerNow();
			if (webServer === void 0) {
				const timer = setTimeout(attempt, 250);
				ctx.effect(() => () => clearTimeout(timer));
				return;
			}
			ctx.effect(() => register(webServer));
		};
		attempt();
	};
	registerWhenReady((webServer) => webServer.register({
		kind: "exact",
		path: "/plugins/dsh-pet-sprite/models",
		handler: async (rawReq, rawRes) => {
			const res = rawRes;
			const llm = llmNow();
			if (llm === void 0) {
				json(res, 503, { error: "llm service unavailable" });
				return;
			}
			try {
				let def;
				try {
					const sel = defaultModelNow()?.currentSelection();
					if (sel !== void 0 && typeof sel.provider === "string" && typeof sel.model === "string") def = {
						provider: sel.provider,
						model: sel.model
					};
				} catch {}
				const providers = [];
				for (const p of llm.listProviders()) try {
					const models = await llm.listModels(p.id);
					providers.push({
						id: p.id,
						name: p.name,
						models: models.map((m) => ({
							id: m.id,
							name: m.name ?? m.id
						}))
					});
				} catch (error) {
					providers.push({
						id: p.id,
						name: p.name,
						models: [],
						error: error instanceof Error ? error.message : String(error)
					});
				}
				json(res, 200, {
					providers,
					default: def
				});
			} catch (error) {
				json(res, 500, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	}));
	registerWhenReady((webServer) => webServer.register({
		kind: "exact",
		path: "/plugins/dsh-pet-sprite/chat",
		handler: async (rawReq, rawRes) => {
			const req = rawReq;
			const res = rawRes;
			const llm = llmNow();
			if (llm === void 0) {
				json(res, 503, { error: "llm service unavailable" });
				return;
			}
			try {
				if (!sameOriginPost(req)) {
					json(res, 415, { error: "content-type must be application/json (same-origin)" });
					return;
				}
				const body = JSON.parse(await readBody(req));
				const message = (body.message ?? "").trim();
				const provider = (body.provider ?? "").trim();
				const model = (body.model ?? "").trim();
				if (message.length === 0) {
					json(res, 400, { error: "message is required" });
					return;
				}
				if (provider.length === 0 || model.length === 0) {
					json(res, 400, { error: "provider and model are required (pick one in the pet settings tab)" });
					return;
				}
				const petName = (body.petName ?? "").trim() || "小宠物";
				const system = personaPrompt(petName, body.persona ?? "", body.lang ?? "zh") + contextPrompt(body.lang ?? "zh", body.workspace, body.memories, body.petState);
				const options = {
					provider,
					model,
					system,
					messages: buildMessages(body.history ?? [], message, provider, model),
					maxTokens: 300
				};
				const reply = await streamText(llm, options);
				if (reply.trim().length === 0) {
					json(res, 502, { error: "model produced no text" });
					return;
				}
				json(res, 200, {
					reply: reply.trim(),
					provider,
					model
				});
			} catch (error) {
				json(res, 500, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	}));
	registerWhenReady((webServer) => webServer.register({
		kind: "exact",
		path: "/plugins/dsh-pet-sprite/generate",
		handler: async (rawReq, rawRes) => {
			const req = rawReq;
			const res = rawRes;
			const llm = llmNow();
			if (llm === void 0) {
				json(res, 503, { error: "llm service unavailable" });
				return;
			}
			try {
				if (!sameOriginPost(req)) {
					json(res, 415, { error: "content-type must be application/json (same-origin)" });
					return;
				}
				const body = JSON.parse(await readBody(req));
				const description = (body.description ?? "").trim();
				const provider = (body.provider ?? "").trim();
				const model = (body.model ?? "").trim();
				if (description.length === 0) {
					json(res, 400, { error: "description is required" });
					return;
				}
				if (description.length > 200) {
					json(res, 400, { error: "description too long (max 200 characters)" });
					return;
				}
				if (provider.length === 0 || model.length === 0) {
					json(res, 400, { error: "provider and model are required (pick one in the pet settings tab)" });
					return;
				}
				const options = {
					provider,
					model,
					messages: [{
						id: crypto.randomUUID(),
						role: "user",
						content: [{
							type: "text",
							text: generatePrompt(description)
						}],
						source: {
							kind: "plugin",
							plugin: "dsh-pet-sprite"
						}
					}],
					maxTokens: 2e3
				};
				const reply = await streamText(llm, options);
				const pet = parseGeneratedPet(reply);
				json(res, 200, pet);
			} catch (error) {
				json(res, 500, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	}));
	registerWhenReady((webServer) => webServer.register({
		kind: "exact",
		path: "/plugins/dsh-pet-sprite/witness",
		handler: async (rawReq, rawRes) => {
			const req = rawReq;
			const res = rawRes;
			const llm = llmNow();
			if (llm === void 0) {
				json(res, 503, { error: "llm service unavailable" });
				return;
			}
			try {
				if (!sameOriginPost(req)) {
					json(res, 415, { error: "content-type must be application/json (same-origin)" });
					return;
				}
				const body = JSON.parse(await readBody(req));
				const provider = (body.provider ?? "").trim();
				const model = (body.model ?? "").trim();
				if (provider.length === 0 || model.length === 0) {
					json(res, 400, { error: "provider and model are required (pick one in the pet settings tab)" });
					return;
				}
				const petName = (body.petName ?? "").trim() || "小宠物";
				const lang = body.lang ?? "zh";
				const scope = body.scope === "week" ? "week" : "day";
				const options = {
					provider,
					model,
					system: personaPrompt(petName, body.persona ?? "", lang) + contextPrompt(lang, void 0, body.memories, body.petState),
					messages: [{
						id: crypto.randomUUID(),
						role: "user",
						content: [{
							type: "text",
							text: witnessPrompt(lang, scope, body.day ?? {})
						}],
						source: {
							kind: "plugin",
							plugin: "dsh-pet-sprite"
						}
					}],
					maxTokens: scope === "week" ? 300 : 200
				};
				const reply = await streamText(llm, options);
				const log = reply.trim();
				if (log.length === 0) {
					json(res, 502, { error: "model produced no text" });
					return;
				}
				json(res, 200, { log });
			} catch (error) {
				json(res, 500, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	}));
	registerWhenReady((webServer) => webServer.register({
		kind: "exact",
		path: "/plugins/dsh-pet-sprite/memory",
		handler: async (rawReq, rawRes) => {
			const req = rawReq;
			const res = rawRes;
			const llm = llmNow();
			if (llm === void 0) {
				json(res, 503, { error: "llm service unavailable" });
				return;
			}
			try {
				if (!sameOriginPost(req)) {
					json(res, 415, { error: "content-type must be application/json (same-origin)" });
					return;
				}
				const body = JSON.parse(await readBody(req));
				const recentText = (body.recentText ?? "").trim().slice(0, 6e3);
				const provider = (body.provider ?? "").trim();
				const model = (body.model ?? "").trim();
				if (recentText.length === 0) {
					json(res, 400, { error: "recentText is required" });
					return;
				}
				if (provider.length === 0 || model.length === 0) {
					json(res, 400, { error: "provider and model are required (pick one in the pet settings tab)" });
					return;
				}
				const petName = (body.petName ?? "").trim() || "小宠物";
				const lang = body.lang ?? "zh";
				const shared = readMemories().map((m) => m.text);
				const existing = [...new Set([...shared, ...(body.existing ?? []).filter((t) => typeof t === "string").map((t) => t.trim().slice(0, 60)).filter((t) => t.length > 0)])].slice(0, 30);
				const options = {
					provider,
					model,
					system: personaPrompt(petName, body.persona ?? "", lang),
					messages: [{
						id: crypto.randomUUID(),
						role: "user",
						content: [{
							type: "text",
							text: memoryPrompt(lang, petName, recentText, existing)
						}],
						source: {
							kind: "plugin",
							plugin: "dsh-pet-sprite"
						}
					}],
					maxTokens: 200
				};
				const reply = await streamText(llm, options);
				const fresh = parseMemories(reply);
				if (fresh.length > 0) {
					const known = new Set(readMemories().map((m) => m.text));
					const additions = fresh.filter((t) => !known.has(t)).map((t) => ({
						id: `mem:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 6)}`,
						text: t,
						sessionTitle: petName + " 观察",
						createdAt: Date.now()
					}));
					if (additions.length > 0) writeMemories([...additions, ...readMemories()]);
				}
				json(res, 200, { memories: fresh });
			} catch (error) {
				json(res, 500, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	}));
	registerWhenReady((webServer) => webServer.register({
		kind: "exact",
		path: "/plugins/dsh-pet-sprite/memories",
		handler: async (rawReq, rawRes) => {
			const res = rawRes;
			json(res, 200, { memories: readMemories() });
		}
	}));
	const stateDir = () => {
		const home = process.env.DSH_HOME ?? path.join(process.env.HOME ?? "/home", ".dsh");
		return path.join(home, "storages");
	};
	const stateFile = () => path.join(stateDir(), "dsh-pet-sprite-state.json");
	const readState = () => {
		try {
			return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
		} catch {
			return {};
		}
	};
	const writeState = (data) => {
		fs.mkdirSync(stateDir(), { recursive: true });
		const tmp = stateFile() + ".tmp";
		fs.writeFileSync(tmp, JSON.stringify(data));
		fs.renameSync(tmp, stateFile());
	};
	registerWhenReady((webServer) => webServer.register({
		kind: "exact",
		path: "/plugins/dsh-pet-sprite/state",
		handler: async (rawReq, rawRes) => {
			const req = rawReq;
			const res = rawRes;
			try {
				if (req.method === "GET") {
					json(res, 200, readState());
					return;
				}
				if (req.method !== "POST") {
					json(res, 405, { error: "method not allowed" });
					return;
				}
				if (!sameOriginPost(req)) {
					json(res, 415, { error: "content-type must be application/json (same-origin)" });
					return;
				}
				const body = JSON.parse(await readBody(req, 256 * 1024));
				if (body === null || typeof body !== "object" || Array.isArray(body)) {
					json(res, 400, { error: "body must be a JSON object" });
					return;
				}
				const prev = readState();
				const prevAt = typeof prev.savedAt === "number" ? prev.savedAt : 0;
				const nextAt = typeof body.savedAt === "number" ? body.savedAt : 0;
				if (nextAt < prevAt) {
					json(res, 409, {
						error: "stale state",
						savedAt: prevAt
					});
					return;
				}
				writeState(body);
				json(res, 200, {
					ok: true,
					savedAt: nextAt
				});
			} catch (error) {
				json(res, 500, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	}));
}

//#endregion
export { apply, inject, name };