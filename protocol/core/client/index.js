const crypto = require("crypto");
const fetch = require("node-fetch");
const WebSocket = require("ws");
const base58 = require("bs58");
const Shared = require("../shared");

const discoverTimeout = 5000;
const ivLength = 16;
const saltLength = 16;
const cipherKeyLength = 32;
const cipherAlgorithm = `aes-${cipherKeyLength * 8}-cbc-hmac-sha256`;

const delay = (time) => new Promise((resolve) => setTimeout(resolve, time));

module.exports = class CoreProtocol extends Shared {
	constructor() {
		super();

		this.idLength = 8;
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

	getSharedSecret(remoteKey) {
		return this.ecdh.computeSecret(base58.decode(remoteKey));
	}

	saltedSecret(secret, salt) {
		return crypto.scryptSync(secret, salt, cipherKeyLength);
	}

	// Adapted from <https://stackoverflow.com/a/60370205/5583289>.
	encrypt(text, secret) {
		const iv = crypto.randomBytes(ivLength);
		const salt = crypto.randomBytes(saltLength);
		const key = this.saltedSecret(secret, salt);
		const cipher = crypto.createCipheriv(cipherAlgorithm, key, iv);

		let encrypted = cipher.update(text);
		encrypted = Buffer.concat([encrypted, cipher.final()]);

		return [iv, salt, encrypted].map(
			(x) => (x).toString("base64")
		).join(",");
	}

	// Adapted from <https://stackoverflow.com/a/60370205/5583289>.
	decrypt(text, secret) {
		const [iv, salt, encrypted] = text.split(",").map(
			(x) => Buffer.from(x, "base64")
		);

		const key = this.saltedSecret(secret, salt);
		const decipher = crypto.createDecipheriv(cipherAlgorithm, key, iv);

		let decrypted = decipher.update(encrypted);
		decrypted = Buffer.concat([decrypted, decipher.final()]);

		return decrypted.toString();
	}

	getNodes() {
		return Array.from(this.nodes);
	}

	mergeNodes(nodes) {
		this.nodes = this.union(this.nodes, nodes);
		this.emit("discover", this.encodeServerList(this.nodes));
	}

	mergeList(list) {
		this.mergeNodes(this.decodeServerList(list));
	}

	getResidence() {
		return this.getClientResidence(this.getPublicKey());
	}

	async bootstrap(list, callback) {
		this.nodes = this.decodeServerList(list);

		const promises = [];

		this.nodes.forEach(async (node) => {
			try {
				const promise = (await fetch(`http://${node}/discover`)).text();
				promises.push(promise);
				this.mergeList(await promise);
			} catch(error) {}
		});

		const allRes = Promise.all(promises);
		const timeout = delay(discoverTimeout);

		await Promise.race([allRes, timeout]);

		this.connect(() => {
			callback(this.getResidence());
		});
	}

	connect(callback) {
		const ws = new WebSocket(`ws://${this.getResidence()}`);
		this.ws = new Shared.WebSocket(ws);

		this.ws.on("connected", () => {
			this.ws.on("discover", this.onDiscover.bind(this));
			this.ws.on("receive", this.onReceive.bind(this));

			this.whoami();

			callback();
		});

		this.ws.on("error", () => this.emit("disconnected"));
		this.ws.on("disconnected", () => this.emit("disconnected"));
	}

	onDiscover({list}) {
		this.mergeList(list);
	}

	send(to, isAck, requiresAck, content) {
		const id = base58.encode(crypto.randomBytes(this.idLength));

		const secret = this.getSharedSecret(to);
		const encrypted = this.encrypt(content, secret);

		this.ws.send("send", {
			id,
			to,
			from: this.getPublicKey(),
			timeSent: Date.now(),
			isAck,
			requiresAck,
			content: encrypted
		});

		return id;
	}

	onReceive(message) {
		const secret = this.getSharedSecret(message.from);
		const decrypted = this.decrypt(message.content, secret);

		if (message.isAck) {
			this.emit("ack", message.from, message.timeSent, decrypted);
		} else {
			this.emit(
				"receive", message.id, message.from, message.timeSent, decrypted
			);

			if (message.requiresAck) {
				this.send(message.from, true, false, message.id);
			}
		}
	}

	whoami() {
		this.ws.send("whoami", {
			isServer: false,
			publicKey: this.getPublicKey()
		});
	}
}
