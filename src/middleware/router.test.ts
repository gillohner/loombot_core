// src/middleware/router.test.ts
import { _testPublishCommands, buildMiddleware } from "@middleware/router.ts";
import { initDb, setChatConfig } from "@core/config/store.ts";
import { type Context } from "grammy";

Deno.test("buildMiddleware returns a Composer instance with use method", () => {
	const composer = buildMiddleware();
	if (!composer || typeof (composer as unknown as { use: unknown }).use !== "function") {
		throw new Error("Composer should have a use method");
	}
});

Deno.test("publishCommands sets both public and admin scopes", async () => {
	const calls: { scope: string; commands: string[] }[] = [];
	const fakeCtx: Partial<Context> = {
		chat: { id: 789 } as unknown as Context["chat"],
		api: {
			setMyCommands: (
				cmds: { command: string }[],
				opts: { scope: { type: string; chat_id: number } },
			) => {
				calls.push({ scope: opts.scope.type, commands: cmds.map((c) => c.command) });
				return Promise.resolve(true as unknown as never);
			},
		} as unknown as Context["api"],
	};
	// Prepare in-memory DB and minimal config so snapshot builder runs
	initDb(":memory:");
	setChatConfig("789", "default", { services: [] }, "hash-test");
	await _testPublishCommands(fakeCtx as Context, "789");
	const publicCall = calls.find((c) => c.scope === "chat");
	const adminCall = calls.find((c) => c.scope === "chat_administrators");
	if (!publicCall) throw new Error("Expected public chat scope commands to be set");
	if (!adminCall) throw new Error("Expected admin chat_administrators scope commands to be set");
	for (const cmd of ["setconfig", "updateconfig", "showconfig", "resetconfig"]) {
		if (!adminCall.commands.includes(cmd)) {
			throw new Error(`Admin commands should include ${cmd}`);
		}
	}
});
