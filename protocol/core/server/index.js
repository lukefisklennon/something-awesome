const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const Shared = require("../shared");
require("colors");

class RemoteServer {
	constructor(local, isServer, node, ws) {
		this.local = local;
		this.isServer = isServer;
		this.node = node;

		this.ws = (
			isServer ? new Shared.WebSocket(new WebSocket(`ws://${node}`)) : ws
		);

		if (isServer) {
			this.ws.on("connected", this.ready.bind(this));
			this.ws.on("disconnected", this.remove.bind(this));
			this.ws.on("error", this.remove.bind(this));
		} else {
			this.ready();
		}
	}

	ready() {
		this.ws.on("discover", this.onDiscover.bind(this));
		this.ws.on("send", this.onSend.bind(this));

		if (this.isServer) this.whoami();
		this.discover();

		console.log(`Server connected: ${this.node.brightCyan}.`);
	}

	whoami() {
		this.ws.send("whoami", {
			isServer: true,
			port: this.local.port
		});
	}

	discover() {
		if (this.ws.ws.readyState) {
			this.ws.send("discover", {
				list: this.local.encodeServerList(this.local.nodes)
			});
		}
	}

	onDiscover({list}) {
		try {
			this.local.mergeList(list);
		} catch(error) {
			console.log(error);
		}
	}

	send(message) {
		this.ws.send("send", message);
	}

	onSend(message) {
		try {
			const client = this.local.clients[message.to];

			if (client) {
				client.receive(message);
			} else {
				this.local.getUser(message.to).enqueueMessage(message);
			}

			console.log(
				`Message sent from ${
					message.from.substr(0, 5).brightCyan
				} to ${
					message.to.substr(0, 5).brightCyan
				}: "...${
					message.content.substr(-20).brightCyan
				}" (routed from ${
					this.node.brightCyan
				}${
					!client ? ", queued" : ""
				}).`
			);
		} catch(error) {
			console.log(error);
		}
	}

	disconnect() {
		this.ws.disconnect();
		this.remove();
	}

	remove() {
		this.local.removeServer(this.node);
	}
}

class Client {
	constructor(local, publicKey, ws) {
		this.local = local;
		this.publicKey = publicKey;
		this.ws = ws;
		this.user = local.getUser(publicKey);

		this.ws.on("disconnected", this.remove.bind(this));
		this.ws.on("send", this.onSend.bind(this));

		console.log(`Client connected: ${this.publicKey.brightCyan}.`);

		this.discover();
		this.dequeueMessages();
	}

	discover() {
		this.ws.send("discover", {
			list: this.local.encodeServerList(this.local.nodes)
		});
	}

	dequeueMessages() {
		const message = this.user.dequeueMessage();

		if (message) {
			console.log(
				`Message from ${
					message.from.substr(0, 5).brightCyan
				} to ${
					message.to.substr(0, 5).brightCyan
				}: "...${
					message.content.substr(-20).brightCyan
				}" (released from queue).`
			);

			this.receive(message);
			this.dequeueMessages();
		}
	}

	onSend(message) {
		try {
			const node = this.local.getClientResidence(message.to);

			if (node === this.local.node) {
				const client = this.local.clients[message.to];

				if (client) {
					client.receive(message);
				} else {
					this.local.getUser(message.to).enqueueMessage(message);
				}
			} else {
				this.local.servers[node].send(message);
			}

			console.log(
				`Message sent from ${
					message.from.substr(0, 5).brightCyan
				} to ${
					message.to.substr(0, 5).brightCyan
				}: "...${
					message.content.substr(-20).brightCyan
				}" (${
					node === this.local.node ? (
						this.local.clients[message.to]
						? "routed directly" : "queued"
					): `routed to ${node.brightCyan}`
				}).`
			);
		} catch(error) {
			console.log(error);
		}
	}

	receive(message) {
		this.ws.send("receive", message);
	}

	remove() {
		delete this.local.clients[this.publicKey];

		console.log(`Client disconnected: ${this.publicKey.brightCyan}.`);
	}
}

class User {
	constructor(local, queue) {
		this.local = local;
		this.queue = queue || [];
	}

	enqueueMessage(message) {
		this.queue.push(message);
		this.local.writeStore();
	}

	dequeueMessage() {
		const message = this.queue.shift();
		this.local.writeStore();
		return message;
	}
}

module.exports = class MeshServer extends Shared {
	constructor(node, bootstrapList, storeFile) {
		super();

		this.node = node;
		this.port = Number(node.split(":").pop());

		this.servers = {};
		this.clients = {};
		this.users = {};

		this.storeFile = storeFile;
		this.nodes = new Set([node]);
		this.readStore(this.decodeServerList(bootstrapList));

		this.http = http.createServer(this.serveList.bind(this));
		this.ws = new WebSocket.Server({server: this.http});
	}

	start() {
		this.http.listen(this.port);

		this.ws.on("connection", (ws, req) => {
			ws = new Shared.WebSocket(ws);

			let address = req.socket.remoteAddress;
			if (address.includes("127.0.0.1")) address = "localhost";
			ws.on("whoami", (data) => {
				try {
					if (data.isServer) {
						this.handleServer(`${address}:${data.port}`, ws);
					} else {
						this.handleClient(data.publicKey, ws);
					}
				} catch(error) {
					console.log(error);
				}
			});
		});

		this.connect();
	}

	handleServer(node, ws) {
		if (this.servers[node]) {
			if (this.intHash(this.node) > this.intHash(node)) {
				this.servers[node].disconnect();
			} else {
				return;
			}
		}

		this.servers[node] = new RemoteServer(this, false, node, ws);
	}

	handleClient(publicKey, ws) {
		if (publicKey in this.clients) {
			ws.disconnect();
		} else {
			this.clients[publicKey] = new Client(this, publicKey, ws);
		}
	}

	getUser(publicKey) {
		let user = this.users[publicKey];

		if (!user) {
			user = new User(this);
			this.users[publicKey] = user;
		}

		return user;
	}

	connect() {
		this.nodes.forEach((node) => {
			if (node !== this.node && !this.servers[node]) {
				this.servers[node] = new RemoteServer(this, true, node);
			}
		})
	}

	mergeNodes(nodes) {
		const oldNodes = new Set(this.nodes);
		this.nodes = this.union(this.nodes, nodes);
		this.writeStore();

		if (this.nodes.size !== oldNodes.size) {
			for (let node in this.servers) {
				if (this.servers[node]) this.servers[node].discover();
			}

			for (let publicKey in this.clients) {
				this.clients[publicKey].discover();
			}
		}
	}

	mergeList(list) {
		this.mergeNodes(this.decodeServerList(list));
	}

	serveList(req, res) {
		if (req.url.split("/")[1].toLowerCase() === "discover") {
			res.write(this.encodeServerList(this.nodes));
			res.end();
		}
	}

	removeServer(node) {
		this.servers[node] = null;
	}

	storeExists() {
		return fs.existsSync(this.storeFile);
	}

	readStore(init) {
		if (!this.storeExists()) {
			this.mergeNodes([...init, this.node]);
			return;
		}

		const store = JSON.parse(fs.readFileSync(this.storeFile, "utf8"));

		this.mergeList(store.nodes);

		Object.keys(store.users).forEach((publicKey) => {
			this.users[publicKey] = new User(
				this, store.users[publicKey].queue
			);
		});
	}

	writeStore() {
		const users = {};

		Object.keys(this.users).forEach((publicKey) => {
			users[publicKey] = {queue: this.users[publicKey].queue};
		});

		fs.writeFileSync(this.storeFile, JSON.stringify({
			nodes: this.encodeServerList(this.nodes),
			users
		}));

		this.connect();
	}
}
