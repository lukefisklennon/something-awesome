const crypto = require("crypto");
const fetch = require("node-fetch");
const base58 = require("bs58");

const discoverTimeout = 5000;
const hashBytes = 4;

const delay = (time) => new Promise((resolve) => setTimeout(resolve, time));

module.exports = class CoreProtocol {
	constructor() {
		this.keyMaxLength = 46;

		this.ecdh = crypto.createECDH("secp256k1");
		this.nodes = new Set();
	}

	generateKeys() {
		this.ecdh.generateKeys();
	}

	setPrivateKey(base58) {
		return this.ecdh.setPrivateKey(base58.decode(base58));
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

	async bootstrap(list) {
		this.nodes = decodeServerList(list);
		console.log(Array.from(this.nodes).map((node) => `http:${node}/discover`));

		const promises = [];

		this.nodes.forEach(async (node) => {
			try {
				const promise = (
					await fetch(`http://${node}/discover`)
				).text();

				promises.push(promise);

				const list = await promise;

				this.nodes = [...this.nodes, decodeServerList(list)];
			} catch(error) {}
		});

		const allRes = Promise.all(promises);
		const timeout = delay(discoverTimeout);

		await Promise.race([allRes, timeout]);

		return this.getResidence();
	}

	getResidence() {
		const self = this.getPublicKeyBuffer();

		// Find the nearest node.
		return Array.from(this.nodes).reduce((a, b) => {
			const aDelta = getHashDistance(self, a);
			const bDelta = getHashDistance(self, b);
			return aDelta < bDelta ? a : b;
		});
	}
}

const bufferReadFunction = `readUInt${hashBytes * 8}BE`;
const hashMax = Buffer.alloc(hashBytes, 0xff)[bufferReadFunction]();

const getHashDistance = (a, b) => {
	const delta = Math.abs(intHash(a) - intHash(b));
	return Math.min(delta, hashMax - delta)
}

const intHash = (data) => (
	crypto.createHash("sha3-256").update(data).digest()[bufferReadFunction]()
);

const decodeServerList = (list) => {
	return new Set(list.split("\n").map(
		(line) => line.trim()
	).filter(
		(line) => line.length > 0
	));
}