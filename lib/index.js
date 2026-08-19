//#region src/index.ts
const name = "dsh-pet-sprite";
const inject = [];
function json(res, status, payload) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(payload));
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
				for (const p of llm.listProviders()) {
					const models = await llm.listModels(p.id);
					providers.push({
						id: p.id,
						name: p.name,
						models: models.map((m) => ({
							id: m.id,
							name: m.name ?? m.id
						}))
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
				const system = [
					`你是「${petName}」，一只住在用户编程助手界面里的像素小宠物。`,
					"用第一人称以宠物口吻回复：简短（一到三句话）、口语化、有活力，偶尔撒娇但不过分。",
					"不使用 markdown、列表或代码块；不自称 AI 助手或模型；不要说教。",
					"用户是每天和你待在一起的开发者，你可以自然地关心他的工作和休息。"
				].join("");
				const options = {
					provider,
					model,
					system,
					messages: buildMessages(body.history ?? [], message, provider, model),
					maxTokens: 300
				};
				let reply = "";
				for await (const chunk of llm.stream(options)) {
					if (chunk.type === "text-delta" && typeof chunk.text === "string") reply += chunk.text;
					if (chunk.type === "finish" && chunk.reason?.kind === "error") throw new Error(chunk.reason.failure?.message ?? "llm stream failed");
				}
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
}

//#endregion
export { apply, inject, name };