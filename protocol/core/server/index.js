const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const Shared = require("../shared");

class RemoteServer {
	constructor(local, isServer, node, ws) {
		this.local = local;
		this.isServer = isServer;
		this.ws = new Shared.WebSocket(
			isServer ? new WebSocket(`ws://${node}`) : ws
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
		console.log(`Server connected: ${node}.`);

		this.ws.on("discover", this.onDiscover.bind(this));
		this.ws.on("send", this.onSend.bind(this));

		if (this.isServer) this.whoami();
		this.discover();
	}

	whoami() {
		this.ws.send("whoami", {
			isServer: true,
			port: this.local.port
		});
	}

	discover() {
		this.ws.send("discover", {
			list: this.local.encodeServerList(this.local.nodes)
		});
	}

	onDiscover({list}) {
		this.local.mergeList(list);
	}

	send(message) {
		this.ws.send("send", message);
	}

	onSend(message) {
		const client = this.local.clients[message.to];
		if (client) client.receive(message);
	}

	disconnect() {
		this.ws.disconnect();
		this.remove();
	}

	remove() {
		this.local.removeNode(this.node);
	}
}

class Client {
	constructor(local, publicKey, ws) {
		this.local = local;
		this.publicKey = publicKey;
		this.ws = new Shared.WebSocket(ws);

		this.ws.on("send", this.send.bind(onSend));

		this.discover();
	}

	discover() {
		this.ws.send("discover", {
			list: this.local.encodeServerList(this.local.nodes)
		});
	}

	onSend(message) {
		const node = this.local.getClientResidence(message.to);
		if (node) this.local.servers[node].send(message);
	}

	receive(message) {
		this.ws.send("receive", message);
	}
}

module.exports = class MeshServer extends Shared {
	constructor(node, bootstrapList, nodesStore) {
		super();

		this.node = node;
		this.port = Number(node.split(":").pop());

		this.http = http.createServer(this.serveList.bind(this));
		this.ws = new WebSocket.Server({server: this.http});

		this.servers = {};
		this.clients = {};

		this.nodesStore = nodesStore;
		this.nodes = new Set([node]);
		this.readStore(this.decodeServerList(bootstrapList));
	}

	start() {
		this.http.listen(this.port);

		this.ws.on("connection", (ws, req) => {
			ws = new Shared.WebSocket(ws);

			let address = req.socket.remoteAddress;
			if (address.includes("127.0.0.1")) address = "localhost";

			ws.on("whoami", (data) => {
				if (data.isServer) {
					this.handleServer(`${address}:${data.port}`, ws);
				} else {
					this.handleClient(data.publicKey, ws);
				}
			})
		});

		this.connect();
	}

	handleServer(node, ws) {
		if (this.servers[node] && intHash(this.node) > intHash(node)) {
			this.servers[node].disconnect();
			this.servers[node] = new RemoteServer(this, false, node, ws);
		}
	}

	handleClient(publicKey, ws) {
		this.clients[publicKey] = new Client(this, publicKey, ws);
	}

	connect() {
		this.nodes.forEach((node) => {
			if (node !== this.node && !(node in this.servers)) {
				this.servers[node] = new RemoteServer(this, true, node);
			}
		})
	}

	mergeNodes(nodes) {
		this.nodes = this.union(this.nodes, nodes);
		this.writeStore();
		for (let publicKey in this.clients) this.clients[publicKey].discover();
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

	removeNode(node) {
		this.servers[node] = null;
	}

	storeExists() {
		return fs.existsSync(this.nodesStore);
	}

	readStore(init) {
		if (!this.storeExists()) {
			this.mergeNodes(init);
			return;
		}

		this.mergeList(fs.readFileSync(this.nodesStore, "utf8"));
	}

	writeStore() {
		fs.writeFileSync(this.nodesStore, this.encodeServerList(this.nodes));
		this.connect();
	}
}