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
* Sprite-generator prompt: the model must answer with one JSON object
* {name, tagline, rows}. The grid spec mirrors pixel-format.ts exactly.
*/
function generatePrompt(description) {
	return [
		"You are a pixel-art sprite generator. Output ONLY one JSON object, no markdown fences, no commentary:",
		`{"name":"<pet name, 2-6 characters, same language as the description>","tagline":"<one-line personality, max 16 characters, same language>","rows":[<${GRID_H} strings, each exactly ${GRID_W} characters>]}`,
		`Grid rules: ${GRID_W} columns x ${GRID_H} rows; '.' = transparent background.`,
		`Palette single characters (meaning: color): o=#4a4553 ink outline; h=#f6f7fc white; H=#dcdff0 white shade; s=#ffe9dc skin; S=#f2cdb9 skin shade; e=#3c3744 eye dark; X=#ffffff white; w=#ffffff white; t=#e8434e red; T=#b32832 dark red; k=#9c6640 brown; K=#7d4e2c dark brown; b=#ffb3ae blush; m=#e8927c mouth; l=#39496b navy; g=#8fd0ff light blue; z=#8fa3c8 gray blue; f=#f4a45c orange; F=#d9803a dark orange; p=#f2839b pink; u=#4d6efa vivid blue; c=#e7edff pale.`,
		"Every colored region must be enclosed by a 1px o outline so the sprite reads on any background.",
		"The character: cute chibi proportions, head about half the height, simple readable silhouette, centered horizontally (columns 4-19), feet near row 26, two e eyes, one small m mouth. Use 2-4 palette colors plus the o outline.",
		"Every row string is exactly 24 characters. Aim for readable, not detailed.",
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
	return {
		name: name$1,
		tagline,
		rows: grid.rows
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
	const llm = ctx.get("llm");
	const webServer = ctx.get("webServer");
	if (webServer !== void 0) ctx.effect(() => webServer.register({
		kind: "exact",
		path: "/plugins/dsh-pet-sprite/models",
		handler: async (rawReq, rawRes) => {
			const res = rawRes;
			if (llm === void 0) {
				json(res, 503, { error: "llm service unavailable" });
				return;
			}
			try {
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
				json(res, 200, { providers });
			} catch (error) {
				json(res, 500, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	}));
	if (webServer !== void 0 && llm !== void 0) ctx.effect(() => webServer.register({
		kind: "exact",
		path: "/plugins/dsh-pet-sprite/chat",
		handler: async (rawReq, rawRes) => {
			const req = rawReq;
			const res = rawRes;
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
				const system = personaPrompt(petName, body.persona ?? "", body.lang ?? "zh");
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
	if (webServer !== void 0 && llm !== void 0) ctx.effect(() => webServer.register({
		kind: "exact",
		path: "/plugins/dsh-pet-sprite/generate",
		handler: async (rawReq, rawRes) => {
			const req = rawReq;
			const res = rawRes;
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
					maxTokens: 1200
				};
				const reply = await streamText(llm, options);
				const pet = parseGeneratedPet(reply);
				json(res, 200, pet);
			} catch (error) {
				json(res, 500, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	}));
	if (webServer !== void 0 && llm !== void 0) ctx.effect(() => webServer.register({
		kind: "exact",
		path: "/plugins/dsh-pet-sprite/witness",
		handler: async (rawReq, rawRes) => {
			const req = rawReq;
			const res = rawRes;
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
					system: personaPrompt(petName, body.persona ?? "", lang),
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
}

//#endregion
export { apply, inject, name };