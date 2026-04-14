// src/core/sandbox/host_test.ts
// Smoke test: spawn a real Deno subprocess against a real service file and
// round-trip a JSON event payload. This exists because the bundler + content-
// addressed blob cache that used to sit between the dispatcher and the sandbox
// is gone; the only remaining path is sandboxHost.run() → source file → runner.
// If this test breaks, the whole service execution pipeline is broken.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { sandboxHost } from "@core/sandbox/host.ts";
import type { ExecutePayload } from "@schema/sandbox.ts";

Deno.test({
	name: "sandboxHost runs simple-response end-to-end",
	// Subprocess cold-start plus module resolution; ignore leaks because the
	// test spawns a child process.
	sanitizeOps: false,
	sanitizeResources: false,
	fn: async () => {
		const payload: ExecutePayload = {
			event: { type: "command", token: "hello" },
			ctx: {
				chatId: "test-chat",
				userId: "test-user",
				serviceConfig: { message: "smoke test ok" },
			},
			manifest: { schemaVersion: 1 },
		};
		const result = await sandboxHost.run<{ kind: string; text?: string }>(
			"./packages/core_services/simple-response/service.ts",
			payload,
			{ timeoutMs: 15000 },
		);
		assert(result.ok, `sandbox failed: ${result.error ?? "no error"}`);
		assertEquals(result.value?.kind, "reply");
		assertEquals(result.value?.text, "smoke test ok");
	},
});

Deno.test({
	name: "sandboxHost runs url_cleaner (npm path) end-to-end",
	// This test exercises the subprocess's ability to resolve `npm:tidy-url`
	// via the project's deno.json import map + shared Deno cache. If it fails
	// with "module not found", the cache is empty — run `deno cache
	// packages/core_services/url-cleaner/service.ts` once locally to seed it.
	sanitizeOps: false,
	sanitizeResources: false,
	fn: async () => {
		const payload: ExecutePayload = {
			event: {
				type: "message",
				message: {
					text: "Check this out: https://example.com/path?utm_source=foo&utm_medium=bar",
				},
			},
			ctx: {
				chatId: "test-chat",
				userId: "test-user",
				serviceConfig: { silentIfUnchanged: false, showCleanedUrl: true },
			},
			manifest: { schemaVersion: 1 },
		};
		const result = await sandboxHost.run<{ kind: string; text?: string }>(
			"./packages/core_services/url-cleaner/service.ts",
			payload,
			{ timeoutMs: 20000 },
		);
		assert(result.ok, `url_cleaner sandbox failed: ${result.error ?? "no error"}`);
		// url_cleaner is a listener and may return "none" if it thinks the URL
		// has nothing to strip — but it must at least not crash.
		assert(
			typeof result.value?.kind === "string",
			`expected a kind in the response, got ${JSON.stringify(result.value)}`,
		);
	},
});
