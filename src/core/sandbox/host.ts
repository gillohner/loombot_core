// src/core/sandbox/host.ts
// Moved from src/core/sandbox.ts
import type { ExecutePayload, SandboxCaps, SandboxResult } from "@schema/sandbox.ts";
import { log } from "@core/util/logger.ts";

// Get Deno cache directory for npm packages
function getDenoCacheDir(): string {
	// Check DENO_DIR env first, then default locations
	const denoDir = Deno.env.get("DENO_DIR");
	if (denoDir) return denoDir;

	// Default cache locations by OS
	const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
	if (Deno.build.os === "darwin") {
		return `${home}/Library/Caches/deno`;
	} else if (Deno.build.os === "windows") {
		return `${Deno.env.get("LOCALAPPDATA") || home}/deno`;
	} else {
		// Linux and others
		return `${Deno.env.get("XDG_CACHE_HOME") || `${home}/.cache`}/deno`;
	}
}

export class SandboxHost {
	async run<T = unknown>(
		entry: string,
		payload: ExecutePayload,
		caps: SandboxCaps = {},
	): Promise<SandboxResult<T>> {
		const requestedTimeout = caps.timeoutMs ?? 3000;
		const timeoutMs = Math.min(Math.max(requestedTimeout, 100), 20000);
		function sanitizeList(list?: string[]): string[] | undefined {
			if (!list) return undefined;
			const filtered = list.filter((v) => v && v !== "*" && v !== "<all>");
			return filtered.length ? filtered : undefined;
		}
		const net = sanitizeList(caps.net)?.slice(0, 5);
		// Run with minimal permissions; also disable remote network module fetching to block dynamic remote imports
		// This enforces that example services must be fully local. If a service attempts to import a remote URL,
		// it will fail and we capture the error in the sandbox result.
		const args: string[] = [
			"run",
			"--quiet",
			"--no-remote", // deny fetching remote modules (dynamic import of URLs will fail)
			"--no-config", // prevent inheriting project's deno.json (import map, lock, etc.)
			"--no-lock", // prevent lock file validation (sandbox bundles aren't in project lock)
		];

		// All services are bundled to temp files in /tmp, so they need read access.
		// npm services additionally need access to the Deno cache for npm: imports.
		if (caps.hasNpm) {
			const cacheDir = getDenoCacheDir();
			args.push(`--allow-read=${cacheDir},/tmp`);
		} else {
			args.push("--allow-read=/tmp");
		}

		// Allow network access to specific domains declared by the service
		if (net) {
			args.push(`--allow-net=${net.join(",")}`);
		}

		args.push(entry);
		// Minimal env to avoid ARG_MAX limit and prevent leaking secrets to sandboxed services
		const sandboxEnv: Record<string, string> = {
			HOME: Deno.env.get("HOME") || "",
			PATH: Deno.env.get("PATH") || "",
		};
		if (Deno.env.get("DENO_DIR")) sandboxEnv.DENO_DIR = Deno.env.get("DENO_DIR")!;
		if (Deno.env.get("XDG_CACHE_HOME")) sandboxEnv.XDG_CACHE_HOME = Deno.env.get("XDG_CACHE_HOME")!;
		const cmd = new Deno.Command("deno", {
			args,
			stdin: "piped",
			stdout: "piped",
			stderr: "piped",
			env: sandboxEnv,
		});
		const child = cmd.spawn();
		const writer = child.stdin.getWriter();
		await writer.write(
			new TextEncoder().encode(JSON.stringify(payload) + "\n"),
		);
		await writer.close();
		let output;
		const to = setTimeout(() => {
			try {
				child.kill();
			} catch {
				/* ignore */
			}
		}, timeoutMs);
		try {
			output = await child.output();
			clearTimeout(to);
		} catch (err) {
			clearTimeout(to);
			try {
				child.kill();
			} catch {
				/* ignore */
			}
			return { ok: false, error: (err as Error).message };
		}
		const stdout = new TextDecoder().decode(output.stdout).trim();
		const stderr = new TextDecoder().decode(output.stderr).trim();
		if (stderr) {
			log.debug("sandbox.stderr", { entry, stderr: stderr.slice(0, 500) });
		}
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
