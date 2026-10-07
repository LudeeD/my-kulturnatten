// The sync server for shared plans: it stores each shared plan and relays changes between the
// phones that have it open. There are no accounts, so anyone can connect; the limits below keep
// a stranger from filling the disk or crowding everyone else out.

import { readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { Repo } from '@automerge/automerge-repo';
import { WebSocketServerAdapter } from '@automerge/automerge-repo-network-websocket';
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 3030);
const DATA_DIR = process.env.DATA_DIR ?? './data';
// Only pages from here may connect. A script can fake this; other websites cannot.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'https://kulturnatten.luissilva.eu')
	.split(',')
	.map((origin) => origin.trim());
// A plan is a few kilobytes; nothing honest comes near this.
const MAX_MESSAGE_BYTES = Number(process.env.MAX_MESSAGE_BYTES ?? 512 * 1024);
const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS ?? 400);
// A household or a café shares one address, so not too low.
const MAX_CONNECTIONS_PER_IP = Number(process.env.MAX_CONNECTIONS_PER_IP ?? 12);
const MAX_MESSAGES_PER_MINUTE = Number(process.env.MAX_MESSAGES_PER_MINUTE ?? 600);
// Past this, nobody new is let in until the data is cleaned up. Open plans keep syncing.
const MAX_DATA_BYTES = Number(process.env.MAX_DATA_MB ?? 500) * 1024 * 1024;
const CHECK_DISK_MS = 60_000;

const TRY_AGAIN_LATER = 1013;
const POLICY_VIOLATION = 1008;

let full = false;
const disk = { bytes: 0, files: 0 };
async function checkDisk() {
	try {
		let bytes = 0;
		let files = 0;
		for (const entry of await readdir(DATA_DIR, { recursive: true, withFileTypes: true })) {
			if (!entry.isFile()) continue;
			bytes += (await stat(join(entry.parentPath, entry.name))).size;
			files++;
		}
		if (full !== bytes > MAX_DATA_BYTES) console.log(`data is ${bytes} bytes; full: ${!full}`);
		full = bytes > MAX_DATA_BYTES;
		Object.assign(disk, { bytes, files });
	} catch {
		// No data directory yet: nothing has been stored.
	}
}
await checkDisk();
setInterval(checkDisk, CHECK_DISK_MS).unref();

const megabytes = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;

// `/health` is for keeping an eye on the server. It is public, so it only has counts and sizes:
// nothing about who is connected or which plans are stored.
const http = createServer((req, res) => {
	if (req.url !== '/health') {
		res.writeHead(200, { 'content-type': 'text/plain' });
		return res.end(full ? 'full' : 'ok');
	}
	const health = {
		status: full ? 'full' : 'ok',
		upSince: new Date(Date.now() - process.uptime() * 1000).toISOString(),
		data: { megabytes: megabytes(disk.bytes), limit: megabytes(MAX_DATA_BYTES), files: disk.files },
		memory: { megabytes: megabytes(process.memoryUsage.rss()) },
		connections: { open: sockets.clients.size, limit: MAX_CONNECTIONS, addresses: perIp.size }
	};
	res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
	res.end(JSON.stringify(health, null, 2) + '\n');
});

const perIp = new Map();
// Behind the reverse proxy every connection comes from localhost; it passes the real address on.
const addressOf = (req) =>
	String(req.headers['x-forwarded-for'] ?? '')
		.split(',')[0]
		.trim() || req.socket.remoteAddress;

const sockets = new WebSocketServer({
	server: http,
	maxPayload: MAX_MESSAGE_BYTES,
	verifyClient: ({ origin }) => ALLOWED_ORIGINS.includes(origin)
});

// Registered before the adapter's own listener, so a refused connection is closed first.
sockets.on('connection', (socket, req) => {
	const ip = addressOf(req);
	const open = perIp.get(ip) ?? 0;
	if (full || sockets.clients.size > MAX_CONNECTIONS || open >= MAX_CONNECTIONS_PER_IP) {
		return socket.close(TRY_AGAIN_LATER);
	}
	perIp.set(ip, open + 1);
	socket.on('close', () => {
		const left = perIp.get(ip) - 1;
		if (left > 0) perIp.set(ip, left);
		else perIp.delete(ip);
	});

	let messages = 0;
	const reset = setInterval(() => (messages = 0), 60_000);
	socket.on('close', () => clearInterval(reset));
	socket.on('message', () => {
		if (++messages > MAX_MESSAGES_PER_MINUTE) socket.close(POLICY_VIOLATION);
	});
});

new Repo({
	network: [new WebSocketServerAdapter(sockets)],
	storage: new NodeFSStorageAdapter(DATA_DIR),
	peerId: `sync-server-${process.env.HOSTNAME ?? 'local'}`,
	// Never offers a plan to anyone: a phone gets a plan only by asking for it by its id.
	sharePolicy: async () => false
});

http.listen(PORT, () => console.log(`sync server on :${PORT}, origins: ${ALLOWED_ORIGINS}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		for (const socket of sockets.clients) socket.terminate();
		http.close(() => process.exit(0));
	});
}
