const crypto = require("crypto");
const EventEmitter = require("events");

const hashBytes = 4;
const bufferRead = `readUInt${hashBytes * 8}BE`;
const hashMax = Buffer.alloc(hashBytes, 0xff)[bufferRead]();

class Shared extends EventEmitter {
	constructor() {
		super();
	}

	getClientResidence(publicKeyBuffer) {
		// Find the nearest node.
		return Array.from(this.nodes).reduce((a, b) => {
			const aDelta = this.getHashDistance(publicKeyBuffer, a);
			const bDelta = this.getHashDistance(publicKeyBuffer, b);
			return aDelta < bDelta ? a : b;
		});
	}

	getHashDistance(a, b) {
		const delta = Math.abs(this.intHash(a) - this.intHash(b));
		return Math.min(delta, hashMax - delta)
	}

	intHash(data) {
		return (
			crypto.createHash("sha3-256").update(data).digest()[bufferRead]()
		);
	}

	encodeServerList(nodes) {
		return Array.from(nodes).join("\n")
	};

	decodeServerList(list) {
		return new Set(list.split("\n").map(
			(line) => line.trim()
		).filter(
			(line) => line.length > 0
		));
	}

	union(a, b) {
		return new Set([...a, ...b])
	}
}

Shared.WebSocket = class extends EventEmitter {
	constructor(ws) {
		super();

		this.ws = ws;

		this.ws.on("message", (message) => {
			this.emit(...JSON.parse(message));
		});

		this.ws.on("open", () => this.emit("connected"));
		this.ws.on("close", () => this.emit("disconnected"));
		this.ws.on("error", () => this.emit("error"));
	}

	send(event, data) {
		data = data || {};
		this.ws.send(JSON.stringify([event, data]));
	}

	disconnect() {
		this.ws.close();
	}
}

module.exports = Shared;