const crypto = require("crypto");
const fetch = require("node-fetch");
const WebSocket = require("ws");
const base58 = require("bs58");
const Shared = require("../shared");

const discoverTimeout = 5000;

const delay = (time) => new Promise((resolve) => setTimeout(resolve, time));

module.exports = class CoreProtocol extends Shared {
	constructor() {
		super();

		this.keyMaxLength = 46;

		this.ws = null;
		this.ecdh = crypto.createECDH("secp256k1");
		this.nodes = new Set();
	}

	generateKeys() {
		this.ecdh.generateKeys();
	}

	setPrivateKey(string) {
		return this.ecdh.setPrivateKey(base58.decode(string));
	}

	getPrivateKey() {
		return base58.encode(this.ecdh.getPrivateKey());
	}

	getPublicKeyBuffer() {
		return this.ecdh.getPublicKey(null, "compressed");
	}

	getPublicKey() {
		return base58.encode(this.getPublicKeyBuffer());
	}

	getResidence() {
		return getClientResidence(this.getPublicKey());
	}

	mergeNodes(nodes) {
		this.nodes = this.union(this.nodes, nodes);
		this.emit("discover", this.encodeServerList(this.nodes));
	}

	mergeList(list) {
		this.mergeNodes(this.decodeServerList(list));
	}

	async bootstrap(list) {
		this.nodes = this.decodeServerList(list);

		const promises = [];

		this.nodes.forEach(async (node) => {
			try {
				const promise = (
					await fetch(`http://${node}/discover`)
				).text();

				promises.push(promise);

				this.mergeList(await promise);
			} catch(error) {}
		});

		const allRes = Promise.all(promises);
		const timeout = delay(discoverTimeout);

		await Promise.race([allRes, timeout]);

		this.connect();

		return this.getResidence();
	}

	connect() {
		const ws = new Websocket(`ws://${this.getResidence()}`);
		this.ws = new Shared.WebSocket(ws);

		this.ws.on("discover", this.onDiscover.bind(this));
		this.ws.on("receive", this.onReceive.bind(this));

		this.whoami();
	}

	onDiscover({list}) {
		this.mergeList(list);
	}

	send(to, content) {
		this.ws.send("send", {
			to,
			from: this.getPublicKey(),
			timeSent: Date.now(),
			isAck: false,
			requiresAck: false,
			content
		});
	}

	onReceive(message) {
		this.emit("message", {
			from: message.from,
			timeSent: message.timeSent,
			content: message.content
		});
	}

	whoami() {
		this.ws.send("whoami", {
			isServer: false,
			publicKey: this.getPublicKey()
		});
	}
}
