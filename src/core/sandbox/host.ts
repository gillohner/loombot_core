// src/core/sandbox/host.ts
// Spawns a Deno subprocess to execute a service in isolation.
//
// The subprocess runs the service source file directly (no pre-bundling).
// Deno resolves `@sdk/` / `@eventky/` / `npm:` imports itself via the project's
// deno.json import map — the subprocess is granted read access to the project
// root and the Deno cache so that import map resolution + cached npm modules
// both work. Network access is gated per-service via `caps.net`.

import type { ExecutePayload, SandboxCaps, SandboxResult } from "@schema/sandbox.ts";
import { log } from "@core/util/logger.ts";

// Fixed at module load time: the directory `deno task dev/serve` is invoked
// from, which is the project root in every deployment we care about.
const PROJECT_ROOT = Deno.cwd();

function getDenoCacheDir(): string {
	const denoDir = Deno.env.get("DENO_DIR");
	if (denoDir) return denoDir;
	const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
	if (Deno.build.os === "darwin") return `${home}/Library/Caches/deno`;
	if (Deno.build.os === "windows") {
		return `${Deno.env.get("LOCALAPPDATA") || home}/deno`;
	}
	return `${Deno.env.get("XDG_CACHE_HOME") || `${home}/.cache`}/deno`;
}

const DENO_CACHE = getDenoCacheDir();

function sanitizeList(list?: string[]): string[] | undefined {
	if (!list) return undefined;
	const filtered = list.filter((v) => v && v !== "*" && v !== "<all>");
	return filtered.length ? filtered : undefined;
}

export class SandboxHost {
	async run<T = unknown>(
		entry: string,
		payload: ExecutePayload,
		caps: SandboxCaps = {},
	): Promise<SandboxResult<T>> {
		const requestedTimeout = caps.timeoutMs ?? 3000;
		const timeoutMs = Math.min(Math.max(requestedTimeout, 100), 20000);
		const net = sanitizeList(caps.net)?.slice(0, 5);

		// Run with minimal permissions. --no-remote blocks dynamic fetching of
		// arbitrary remote modules; --no-lock skips lock-file validation against
		// our main deno.lock (services share the parent's Deno cache, so
		// modules are already fetched by the parent — no lock work needed).
		const args: string[] = [
			"run",
			"--quiet",
			"--no-remote",
			"--no-lock",
			`--allow-read=${PROJECT_ROOT},${DENO_CACHE},/tmp`,
		];
		if (net) args.push(`--allow-net=${net.join(",")}`);
		args.push(entry);

		const sandboxEnv: Record<string, string> = {
			HOME: Deno.env.get("HOME") || "",
			PATH: Deno.env.get("PATH") || "",
		};
		if (Deno.env.get("DENO_DIR")) sandboxEnv.DENO_DIR = Deno.env.get("DENO_DIR")!;
		if (Deno.env.get("XDG_CACHE_HOME")) {
			sandboxEnv.XDG_CACHE_HOME = Deno.env.get("XDG_CACHE_HOME")!;
		}

		const cmd = new Deno.Command("deno", {
			args,
			stdin: "piped",
			stdout: "piped",
			stderr: "piped",
			env: sandboxEnv,
			cwd: PROJECT_ROOT,
		});
		const child = cmd.spawn();

		const writer = child.stdin.getWriter();
		await writer.write(new TextEncoder().encode(JSON.stringify(payload) + "\n"));
		await writer.close();

		const killTimer = setTimeout(() => {
			try {
				child.kill();
			} catch {
				/* ignore */
			}
		}, timeoutMs);

		let output;
		try {
			output = await child.output();
		} catch (err) {
			clearTimeout(killTimer);
			return { ok: false, error: (err as Error).message };
		}
		clearTimeout(killTimer);

		const stdout = new TextDecoder().decode(output.stdout).trim();
		const stderr = new TextDecoder().decode(output.stderr).trim();
		if (stderr) log.debug("sandbox.stderr", { entry, stderr: stderr.slice(0, 500) });
		if (output.code !== 0) {
			return { ok: false, error: `sandbox exit ${output.code}: ${stderr}` };
		}
		if (!stdout) return { ok: true, value: undefined };
		try {
			return { ok: true, value: JSON.parse(stdout) };
		} catch (err) {
			return { ok: false, error: `invalid JSON: ${(err as Error).message}` };
		}
	}
}

export const sandboxHost = new SandboxHost();
